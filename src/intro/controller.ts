import type { ViewCamera } from '../camera/pose'
import { FLYBY, type Opening, type OpeningScene } from './openings'
import { mountSplash, type SplashApi } from './splash'

/**
 * The opening (owner, 2026-10-14): the title splash covers the page until what the flyby needs is on screen, the flyby's first
 * camera already drawn (and refined) underneath it; the splash fades and the flyby flies to Home, where the rig takes over with
 * no cut. Whether a visit gets it at all is parse.ts. With prefers-reduced-motion the splash fades straight onto Home.
 */

export interface IntroReadiness { fraction: number; done: boolean }

export interface IntroHost {
  scene(): OpeningScene
  /** What has arrived of what the flight needs. */
  readiness(needs: Opening['needs']): IntroReadiness
  /** Starts the loads the flight needs (the surface tiles). */
  prepare(needs: Opening['needs']): void
  /** The camera jumps to the flight's first frame: the exposure starts over. */
  cut(): void
  /** Hands the camera shown to the rig (a grab part-way). */
  settle(cam: ViewCamera): void
  moved(): void
}

const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
/** The splash stays at least this long (it is the title card), ms. */
const MIN_SPLASH_MS = 2600
/** After everything has arrived, a moment for the first frames to refine under the splash, ms. */
const SETTLE_MS = 900
/** Never hold the page longer than this, whatever is missing, ms. */
const MAX_SPLASH_MS = 25000

export class IntroController {
  private opening: Opening | null = null
  /** When the flight started; null while it holds on its first camera under the splash. */
  private t0: number | null = null
  /** Review hook (__moon.introSeek): the flight held at this progress, or null. */
  private held: number | null = null
  private splash: SplashApi | null = null
  private shown: ViewCamera | null = null
  private host: IntroHost | null = null

  /** Puts the splash up at once (before the maps load), so the page never shows anything else first. */
  mountEarly(): void {
    document.body.classList.add('intro', 'intro-on')
    document.getElementById('preview')?.remove()
    this.splash = mountSplash()
  }

  /** True while the flight owns the camera (holding or moving). */
  get active(): boolean { return this.opening !== null }
  /** True while the camera is moving. */
  get moving(): boolean { return this.opening !== null && this.t0 !== null }

  private progress(now: number): number {
    const o = this.opening
    if (!o) return 0
    return this.t0 === null ? this.held ?? 0 : Math.min(1, Math.max(0, (now - this.t0) / o.ms))
  }

  /** The flight's camera at `now`, given this frame's Home camera; null when it is not running. */
  camera(home: ViewCamera, now: number): ViewCamera | null {
    if (!this.opening || !this.host) return null
    return this.opening.camera(this.progress(now), home, this.host.scene())
  }

  /** The camera drawn this frame (render() reports it), so a grab settles the rig on exactly what was on screen. */
  drawn(cam: ViewCamera): void { this.shown = cam }

  /** Per frame: true while the camera moves; ends the flight on Home. */
  step(now: number): boolean {
    const o = this.opening
    if (!o || this.t0 === null) return false
    if (now - this.t0 >= o.ms) this.finish()
    return true
  }

  /** The visitor took the camera: the rig continues from the picture shown. */
  interrupt(): void {
    if (!this.moving || !this.host) return
    if (this.shown) this.host.settle(this.shown)
    this.finish()
  }

  /** The GPU context was lost (issue #206): the splash goes and the flight ends now, so the page's message is seen. The frame loop that would end the flight has stopped. */
  abort(): void {
    this.splash?.dispose()
    this.splash = null
    if (this.opening || document.body.classList.contains('intro-on')) this.finish()
  }

  /** Review hook (__moon.introSeek, for frame reviews on the rig): holds the flight at progress u with no splash; null runs it from there. */
  seek(u: number | null): void {
    if (!this.host) return
    this.splash?.dispose()
    this.splash = null
    document.body.classList.add('intro-on')
    this.opening = FLYBY
    this.held = u === null ? null : Math.max(0, Math.min(1, u))
    this.t0 = u === null ? performance.now() : null
    this.host.moved()
  }

  /** From init, the splash already up: holds the flight's first frame under it until the data is in, then lets it go. */
  start(host: IntroHost): void {
    this.host = host
    const splash = this.splash
    const opening = REDUCED ? null : FLYBY
    const needs = opening?.needs ?? {}
    host.prepare(needs)
    this.opening = opening
    this.t0 = null
    host.cut()
    host.moved()
    const t0 = performance.now()
    let doneAt: number | null = null
    const poll = (): void => {
      if (this.splash !== splash) return
      const r = host.readiness(needs)
      splash?.setProgress(r.fraction)
      const now = performance.now()
      if (r.done && doneAt === null) doneAt = now
      const ready = doneAt !== null && now - doneAt >= SETTLE_MS && now - t0 >= MIN_SPLASH_MS
      if (!ready && now - t0 < MAX_SPLASH_MS) { setTimeout(poll, 50); return }
      void (splash ? splash.exit() : Promise.resolve()).then(() => {
        this.splash = null
        if (!this.opening) { this.finish(); return }
        this.t0 = performance.now()
        host.moved()
      })
    }
    poll()
  }

  private finish(): void {
    this.opening = null
    this.held = null
    this.t0 = null
    this.shown = null
    document.body.classList.remove('intro-on')
    this.host?.moved()
  }
}
