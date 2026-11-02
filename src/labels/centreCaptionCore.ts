/**
 * The centre caption's state machine: pure, with no DOM and no renderer. The renderer publishes the camera of the scene it PRESENTED
 * (`sawCamera`); `step` runs every animation frame. Times are `performance.now()` milliseconds, passed in.
 *
 * Motion is read from the presented camera only (never from "something moved" flags: a paused cinematic flight still reports motion).
 * The pause anchor is replaced by a sample whenever that sample is farther than the tolerance from it, and stays fixed in between, so
 * slow drift accumulates until it crosses. A name is shown after STILL_MS without a crossing, from a hit read once at the pause.
 *
 * Owner feedback 2026-10-31 (phone walkthrough, "it appears almost never"): the name is due 0.5 s into the pause, and the lock label (lockLabelCore HOLD_MS)
 * types it 0.3 s later, so it is on screen 0.8 s after the camera stops; only frames under MAX_SPAN_KM are named (never the whole Moon from afar); and
 * the active viewpoint's own feature is named on arrival too (the pill naming it no longer silences the caption), preferred by the picker (PREFER_BOOST).
 */
import { HYST, OCCLUSION_FLOOR_KM, hitFromRange, labelById, pickCentre, raySphereV, texelRay, type CentreHit, type PickResult, type V3 } from './centrePick'
import { MOON_R_KM as R_KM } from '../glsl/common'

/** The pause before a name is due (the lock label adds HOLD_MS: 0.8 s in all). */
export const STILL_MS = 500
export const FADE_OUT_MS = 350
export const MIN_SHOW_MS = 1500
export const RECHECK_MS = 500
export const RECHECK_READ_MS = 2000
/** A readback that has not arrived in this long is abandoned for the CPU estimate. */
export const READ_TIMEOUT_MS = 600
/** A zoom is a change of the frame's span by more than this share, measured from the span the name was chosen at. */
export const ZOOM_FRAC = 0.15
/** Eligible while the frame's short-side ground span is at most this, km: about a quarter of the Moon's 3,475 km diameter (owner 2026-10-31). Home is ~2,400 km. */
export const MAX_SPAN_KM = 900
export const MAX_READ_TRIES = 3
/** A read is started this long before the pause ends, so a normal one has landed by the deadline. It only confirms: the name never waits for it. */
export const READ_LEAD_MS = 300
/** Between read attempts after a refusal, a failure or a timeout. */
export const READ_RETRY_MS = 2000
/** Motion picks are CPU-only and sampled a few times per second; the label picker retains winners across adjacent samples. */
export const MOTION_PICK_MS = 250
/** A shown name that came from the CPU estimate waits at most this long for a read to confirm it before only the CPU re-checks apply. */
export const CONFIRM_WAIT_MS = 1500
/** A CPU-estimate name keeps polling for a confirming read this long, even while the CPU keeps agreeing with it (refused or failed reads are retried within it). */
export const CONFIRM_POLL_MS = 7000
const EPS_POS = 1e-4
const EPS_ANG_RAD = 0.05 * Math.PI / 180
const EPS_TAN = 1e-4
const DIST_FLOOR = 1.004
/**
 * Settling: the rig flags motion that is the tail of a user's input (inertia coast, roll levelling, waiting to level). While it is flagged, a crossing of the
 * tolerance moves the anchor and keeps the clock, so the name is due STILL_MS after the LAST USER INPUT, not after the tail has died away. Any user input newer than
 * the clock (`inputAt`: pointer up/down, wheel, key) restarts it. Automated motion (a flight, a wheel glide) is not flagged: its clock starts when it stops.
 * With the short pause the deadline usually falls inside the coast: nothing is read or picked while the tail still moves the camera (TAIL_QUIET_MS after its
 * last crossing), so the name is picked where the camera comes to rest, at once if the deadline has passed.
 */
export const TAIL_QUIET_MS = 100

/** The effective camera in Moon coordinates (x to longitude 0, z north). */
export interface CamSample { pos: V3; back: V3; up: V3; tanHalf: number; aspect: number }

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2])
const angle = (a: V3, b: V3): number => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b) || 1))))

/** True when `b` differs from the anchor `a` by more than the tolerance (position, view, roll or zoom). */
export function differs(a: CamSample, b: CamSample): boolean {
  const dist = len(b.pos)
  const dp = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2])
  return dp > EPS_POS * Math.max(0.01, dist - 1) || angle(a.back, b.back) > EPS_ANG_RAD || angle(a.up, b.up) > EPS_ANG_RAD || Math.abs(a.tanHalf - b.tanHalf) > EPS_TAN
}

/** The frame's short-side ground span at the camera's nadir, km (declutter.spanKm with the short-side field: tanHalf x min(1, aspect)). */
export function sampleSpanKm(s: CamSample): number {
  return 2 * s.tanHalf * Math.min(1, s.aspect) * Math.max(0, len(s.pos) - 1) * R_KM
}

/** The unit direction of the centre ray. */
export const centreDir = (s: CamSample): V3 => [-s.back[0], -s.back[1], -s.back[2]]

/** What the renderer's hit target held at the centre texel, in Moon coordinates, with the camera that drew it. */
export type ReadResult =
  // `gen` is the surface generation the read was started for; a result for another generation than the presented one is stale.
  // `w` x `h` is the hit target's own size when it was drawn; (ix, iy) the texel that was read. Without them the read is the exact centre ray of an `h`-row target.
  | { kind: 'hit'; cam: CamSample; rangeRadii: number; w: number; h: number; ix?: number; iy?: number; gen?: number }
  | { kind: 'sky'; gen?: number }

export interface CaptionHost {
  /** Whether a read can ever run on this device and quality (the hit target is shared at all). Checked before every attempt; a device that never shares is not asked again. */
  readable?(): boolean
  /** Starts the one non-blocking readback of the presented scene's centre texel. False when it cannot run (no async read, no hit target). */
  beginRead(): boolean
  /** The finished read: undefined while pending; null when it failed or is unavailable. */
  pollRead(): ReadResult | null | undefined
  /** Why the last beginRead was refused or the last poll came back null (diagnostics for the rig). */
  why?(): string
  /** The CPU prediction of the surface along an arbitrary ray (the same estimate as `fallback`, along that ray), or null when unavailable. Used to tell terrain in front from ordinary relief. */
  predict?(pos: V3, dir: V3): CentreHit | null
  /** The CPU estimate from the sphere and the retained height level. */
  fallback(s: CamSample): CentreHit
}

export interface CaptionCtx {
  enabled: boolean
  hidden: boolean
  panorama: boolean
  sheet: boolean
  splash: boolean
  dragging: boolean
  /** Camera motion: keep the centre name tracking the presented view instead of waiting for a pause. */
  moving?: boolean
  /** The lock style retains the current name between throttled moving picks; classic keeps its pause behavior. */
  preserveMovingLock?: boolean
  /** The dock row has a central interval wide enough for a name. */
  usable: boolean
  /**
   * The gazetteer feature ids the active viewpoint (the navigator pill) names, or null/empty when none is active or the visitor has moved away. The picker
   * prefers these exact features (an explicit list, never a name match: "Hadley Rille" is Rima Hadley, not Mons Hadley), so arriving names the subject.
   */
  viewpointFeatures?: readonly string[] | null
}

export type Phase = 'hidden' | 'arming' | 'shown' | 'fadingOut'
/** `id` is the Gazetteer id of the name in `text` (null when there is none). */
export interface CaptionView { text: string; id: string | null; visible: boolean; occupied: boolean; phase: Phase }

interface Retained { id: string; mode: 'contain' | 'near' | 'prominent'; acceptRad: number; baselineSpan: number; shownAt: number; provisional: boolean }

export class CentreCaption {
  private sample: CamSample | null = null
  private anchor: CamSample | null = null
  private stillSince = 0
  private epoch = 0
  private phase: Phase = 'hidden'
  private text = ''
  private retained: Retained | null = null
  private fadeStart = 0
  private shownAt = 0
  private shownFallback = false
  private nextCheckAt = 0
  /** The next time the CPU estimate may run for the pause (it is cheap, but not every frame). */
  private nextCpuAt = 0
  private nextMotionPickAt = 0
  private reading: { at: number; epoch: number; gen: number } | null = null
  /** A valid read for the current pause and surface, held until the deadline (or used to confirm). */
  private readHit: { hit: CentreHit; epoch: number; gen: number } | null = null
  private readRetryAt = 0
  private revalidateSince = 0
  /** The presented surface generation, and whether the name on screen still has to be confirmed against the current surface. */
  private gen = 0
  private revalidate = false
  private readTries = 0
  private lastHidden = false
  /** The last time a settling tail (coast, levelling) moved the camera without restarting the pause. */
  private tailAt = -Infinity
  /** The active viewpoint's feature ids (CaptionCtx.viewpointFeatures), preferred by the picker. */
  private prefer: readonly string[] | null = null
  /** Lock style keeps the current name while moving; classic captions still wait for the pause. */
  private preserveMovingLock = false
  private domDirty = false
  /** Readback count and kinds, for the rig and the tests. */
  readonly stats = { reads: 0, readHits: 0, fallbacks: 0, picks: 0, why: {} as Record<string, number> }
  private note(reason: string): void { this.stats.why[reason] = (this.stats.why[reason] ?? 0) + 1 }

  /** The pause before a name is due, ms (STILL_MS; the controller's own mechanics tests run it at their original 2 s). */
  private readonly stillMs: number

  constructor(private readonly host: CaptionHost, opts: { stillMs?: number } = {}) { this.stillMs = opts.stillMs ?? STILL_MS }

  get pauseEpoch(): number { return this.epoch }
  /** The last presented camera (Moon coordinates), for the lock label's brackets. */
  get camera(): CamSample | null { return this.sample }

  /**
   * The camera of the scene that was just PRESENTED. Replaces the anchor and restarts the pause only when it has left the tolerance.
   * `settling` is the rig's flag for the tail of a user input; `inputAt` the time of the last user input (both optional). A gap between samples carries no information.
   */
  sawCamera(s: CamSample, now: number, gen = 0, settling = false, inputAt = -Infinity): void {
    this.sample = s
    if (!this.anchor || differs(this.anchor, s)) {
      if (!this.anchor || !settling || inputAt > this.stillSince) { this.gen = gen; this.restart(now, s); return }
      this.anchor = s
      // The tail moved the camera: a read in flight or a CPU pick would describe a pose the camera is leaving.
      this.tailAt = now; this.reading = null; this.readHit = null
    }
    if (gen !== this.gen) {
      // A new surface was presented at (nearly) the same camera: a read in flight belongs to the old one, and an accepted name is confirmed again
      // against the new one while it stays on screen (it fades only through the normal rules if it is not confirmed).
      this.gen = gen
      // Refinement bands keep presenting new generations for a while after a move: the clock of the pause is NOT restarted by them, and the CPU estimate is
      // unaffected; only the read (which belongs to one surface) starts again, no sooner than 100 ms later so a stream of generations cannot make a read per frame.
      this.reading = null; this.readHit = null; this.readTries = 0
      this.readRetryAt = Math.max(this.readRetryAt, now + 100)
      if (this.phase === 'shown') { this.revalidate = true; this.revalidateSince = now }
    }
  }

  /** A visibility change or a user-visible discontinuity: the pause begins again from the current camera. */
  resetStill(now: number): void {
    if (this.sample) this.restart(now, this.sample)
  }

  private restart(now: number, s: CamSample): void {
    this.anchor = s
    this.stillSince = now
    this.epoch++
    this.reading = null
    this.readHit = null
    this.readTries = 0
    this.readRetryAt = 0
    this.nextCpuAt = 0
    this.revalidate = false
    if ((this.phase === 'shown' && !this.preserveMovingLock) || this.phase === 'arming') this.fadeOut(now, this.phase === 'arming')
  }

  private fadeOut(now: number, silent = false): void {
    if (silent) { this.phase = 'hidden'; return }
    this.phase = 'fadingOut'
    this.fadeStart = now
    this.domDirty = true
  }

  /**
   * True when `step` has nothing to do until the camera moves, a context flag changes or a surface arrives: no name is up, none is arming or fading, no read
   * is in flight, and the view is not one that can be named (too wide). The frame loop may sleep only while this holds
   * (src/loop/idle.ts); any of those changes arrives with an input or a redraw, which wakes it.
   */
  quiescent(_now: number): boolean {
    if (this.phase !== 'hidden' || this.reading) return false
    const s = this.sample
    return !s || !this.eligible(s)
  }

  /** True once after each visible-state change (the label layer re-measures its exclusion once, without a GPU redraw). */
  consumeDomDirty(): boolean { const d = this.domDirty; this.domDirty = false; return d }

  /** The name on screen or on its way out (for tests and the rig). */
  get current(): { id: string; text: string } | null { return this.retained && this.text ? { id: this.retained.id, text: this.text } : null }

  step(now: number, ctx: CaptionCtx): CaptionView {
    this.preserveMovingLock = ctx.moving === true && ctx.preserveMovingLock === true
    const suppressed = !ctx.enabled || ctx.hidden || ctx.panorama || ctx.sheet || ctx.splash || !ctx.usable
    if (ctx.hidden && !this.lastHidden) this.resetStill(now)
    this.lastHidden = ctx.hidden
    this.prefer = ctx.viewpointFeatures?.length ? ctx.viewpointFeatures : null
    if (ctx.dragging) this.resetStill(now)
    // The fade-out finishes on this clock, never on a CSS event.
    if (this.phase === 'fadingOut' && now >= this.fadeStart + FADE_OUT_MS) { this.phase = 'hidden'; this.domDirty = true }
    if (suppressed) {
      if (this.phase === 'shown') this.fadeOut(now)
      if (this.phase === 'arming') this.phase = 'hidden'
      this.reading = null
      return this.view()
    }
    const s = this.sample
    if (!s) return this.view()
    if (ctx.moving) {
      this.stepMoving(now, s)
      return this.view()
    }
    if ((this.phase === 'hidden' || this.phase === 'arming') && now - this.tailAt < TAIL_QUIET_MS) return this.view()
    // The read starts shortly BEFORE the deadline so that it has landed by then; before the deadline nothing is shown.
    if (now - this.stillSince < this.stillMs) {
      if (now - this.stillSince >= this.stillMs - READ_LEAD_MS && (this.phase === 'hidden' || this.phase === 'arming') && this.eligible(s)) this.driveRead(now, s)
      return this.view()
    }
    if (this.phase === 'shown') { if (this.revalidate) this.revalidateShown(now, s); else this.recheckShown(now, s); return this.view() }
    if (this.phase === 'fadingOut') return this.view()
    this.arm(now, s)
    return this.view()
  }

  /** Pick against the CPU surface estimate while moving. A stale name is removed when the centre no longer supports it. */
  private stepMoving(now: number, s: CamSample): void {
    // A camera crossing starts a new pause before this throttled pick is due. Keep the current lock visible until
    // that pick confirms it or reports that the centre has no confident feature.
    if (this.preserveMovingLock && this.phase === 'fadingOut' && this.retained && this.text) {
      this.phase = 'shown'
      this.domDirty = true
    }
    if (now < this.nextMotionPickAt) return
    this.nextMotionPickAt = now + MOTION_PICK_MS
    if (!this.eligible(s)) { this.clearMovingPick(); return }
    const hit = this.host.fallback(s)
    if (!Number.isFinite(hit.lonDeg) || !Number.isFinite(hit.latDeg) || !Number.isFinite(hit.errKm)) { this.clearMovingPick(); return }
    const r = pickCentre(hit, sampleSpanKm(s), this.retained && { id: this.retained.id, acceptRad: this.retained.acceptRad, provisional: this.retained.provisional }, s, this.prefer)
    this.stats.picks++
    this.stats.fallbacks++
    if (r.retainedHolds && this.retained) {
      if (this.phase !== 'shown') {
        const label = labelById(this.retained.id)
        if (label) { this.text = label.name; this.phase = 'shown'; this.shownAt = now; this.shownFallback = true; this.domDirty = true }
      }
      return
    }
    if (r.status === 'ok' && r.choice) {
      if (this.phase === 'shown' && this.retained?.id === r.choice.label.id) return
      const span = sampleSpanKm(s)
      const previous = this.retained
      const c = r.choice
      this.retained = { id: c.label.id, mode: c.mode, acceptRad: c.entryRad * (1 + HYST), baselineSpan: previous?.id === c.label.id ? previous.baselineSpan : span, shownAt: now, provisional: !!c.provisional }
      this.text = c.label.name; this.phase = 'shown'; this.shownAt = now; this.shownFallback = true; this.revalidate = false; this.nextCheckAt = now + RECHECK_MS
      this.domDirty = true
      return
    }
    this.clearMovingPick()
  }

  private clearMovingPick(): void {
    if (this.phase === 'hidden' && !this.text) return
    this.phase = 'hidden'; this.text = ''; this.retained = null; this.revalidate = false
    this.domDirty = true
  }

  private view(): CaptionView {
    // The retained name is internal: text and occupancy exist only for a name that was accepted and is on screen or fading out.
    const live = this.phase === 'shown' || this.phase === 'fadingOut'
    return { text: live ? this.text : '', id: live && this.text !== '' ? this.retained?.id ?? null : null, visible: this.phase === 'shown', occupied: live && this.text !== '', phase: this.phase }
  }

  /** A frame can be named: above the floor, and no wider than MAX_SPAN_KM on its short side (the whole Moon from afar is never named). */
  private eligible(s: CamSample): boolean {
    if (len(s.pos) < DIST_FLOOR) return false
    const span = sampleSpanKm(s)
    return span > 0 && span <= MAX_SPAN_KM
  }

  /**
   * Hidden or arming, at or after the deadline: the name appears on the pause itself, whatever the read's latency. Whichever comes first wins:
   * a valid read that has landed, or the CPU estimate when it passes the certainty gate. A read that lands late can only confirm or revalidate a name
   * (see revalidateShown), never delay it.
   */
  private arm(now: number, s: CamSample): void {
    if (!this.eligible(s)) { this.phase = 'hidden'; return }
    if (this.phase === 'hidden') this.phase = 'arming'
    this.driveRead(now, s)
    if (this.readHit && this.readHit.epoch === this.epoch && this.readHit.gen === this.gen) {
      if (this.useHit(now, s, this.readHit.hit, false)) return
      // The landed read cannot name anything (an uncertain or empty pick): drop it, try the CPU candidate below, and read again later (the surface may refine).
      this.note('readNamedNothing')
      // A read that found terrain IN FRONT of the predicted surface (withOcclusion) vetoes the CPU estimate for this pause and surface: the estimate cannot see
      // the obstruction, and its screen-space prominence would name the crater the ridge hides.
      if (this.readHit.hit.occludedKm !== undefined && this.readHit.hit.occludedKm > 0) { this.occluded = { epoch: this.epoch, gen: this.gen }; this.occludedNoted = false }
      this.readHit = null
      this.readRetryAt = Math.max(this.readRetryAt, now + READ_RETRY_MS)
    }
    if (this.occluded && this.occluded.epoch === this.epoch && this.occluded.gen === this.gen) { if (!this.occludedNoted) { this.occludedNoted = true; this.note('occludedNoCpu') } return }
    if (now >= this.nextCpuAt) {
      this.nextCpuAt = now + RECHECK_MS
      const hit = this.host.fallback(s)
      const r = pickCentre(hit, sampleSpanKm(s), this.retained && { id: this.retained.id, acceptRad: this.retained.acceptRad }, s, this.prefer)
      if (r.status === 'ok' || r.retainedHolds) this.useHit(now, s, hit, true)
      else this.note(`cpuNotCertain:${r.status}`)
    }
  }

  /**
   * Keeps one read alive for the current pause and surface: begin it (when the device can read, no sooner than READ_RETRY_MS after a refusal, failure
   * or timeout), poll it, and keep a valid result in `readHit`. A result for another surface generation or another camera is dropped.
   */
  private driveRead(now: number, s: CamSample): void {
    if (this.reading) {
      const r = this.host.pollRead()
      if (r === undefined) {
        if (now - this.reading.at > READ_TIMEOUT_MS) { this.reading = null; this.note('readTimeout'); this.readRetryAt = now + READ_RETRY_MS }
        return
      }
      const { epoch, gen } = this.reading
      this.reading = null
      if (epoch !== this.epoch || gen !== this.gen) return
      if (r === null) { this.note(`nullRead/${this.host.why?.() ?? ''}`); this.readRetryAt = now + READ_RETRY_MS; return }
      const bad = r.gen !== undefined && r.gen !== this.gen ? 'staleGeneration' : r.kind === 'sky' ? 'sky' : differs(r.cam, s) ? 'cameraMismatch' : ''
      if (bad) { this.note(`retry:${bad}`); this.readTries++; this.readRetryAt = now + RECHECK_MS; return }
      if (r.kind !== 'hit') return
      this.stats.readHits++
      this.readHit = { hit: withOcclusion(hitOfRead(r), this.host.predict?.bind(this.host)), epoch, gen }
      return
    }
    if (this.readHit && this.readHit.epoch === this.epoch && this.readHit.gen === this.gen) return
    if (this.host.readable && !this.host.readable()) { if (!this.unreadableNoted) { this.unreadableNoted = true; this.note('unreadable') } return }
    if (now < this.readRetryAt || this.readTries >= MAX_READ_TRIES) return
    this.stats.reads++
    if (this.host.beginRead()) this.reading = { at: now, epoch: this.epoch, gen: this.gen }
    else { this.note(`beginRefused/${this.host.why?.() ?? ''}`); this.readRetryAt = now + READ_RETRY_MS }
  }
  private unreadableNoted = false
  /** The pause and surface whose read showed an obstruction in front (no CPU-estimate name for them). */
  private occluded: { epoch: number; gen: number } | null = null
  private occludedNoted = false

  private retainedArg(): { id: string; acceptRad: number; provisional: boolean } | null {
    return this.retained && { id: this.retained.id, acceptRad: this.retained.acceptRad, provisional: this.retained.provisional }
  }

  /**
   * The surface under a shown name was replaced (or the name came from the CPU estimate): confirm it against a READ while it stays on screen. The confirmation
   * stays pending until a read lands (or the poll cap CONFIRM_POLL_MS runs out), independently of what the CPU estimate says: the CPU agreeing with its own
   * name keeps the name up but does not end the wait, and a refused read keeps its retry (driveRead is called every frame the confirmation is pending).
   */
  private revalidateShown(now: number, s: CamSample): void {
    if (!this.eligible(s)) { this.revalidate = false; this.fadeOut(now); return }
    this.driveRead(now, s)
    const arg = this.retainedArg()
    const span = sampleSpanKm(s)
    const waited = now - this.revalidateSince
    let hit: CentreHit | null = null
    let fallback = false
    let final = false
    if (this.readHit && this.readHit.epoch === this.epoch && this.readHit.gen === this.gen) {
      if (now >= this.nextCheckAt) { hit = this.readHit.hit; final = true }
    } else if (this.host.readable && !this.host.readable()) {
      if (now >= this.nextCheckAt) { this.nextCheckAt = now + RECHECK_MS; hit = this.host.fallback(s); fallback = true; final = true }
    } else if (now >= this.nextCheckAt) {
      // No read yet: the CPU estimate may keep the name up; only a read (or the wait running out) may take it down.
      this.nextCheckAt = now + RECHECK_MS
      const est = this.host.fallback(s)
      const holds = pickCentre(est, span, arg, s, this.prefer).retainedHolds
      if (holds) { hit = est; fallback = true; final = waited > CONFIRM_POLL_MS }
      else if (waited > CONFIRM_WAIT_MS) { hit = est; fallback = true; final = true }
    }
    if (!hit) return
    const r = pickCentre(hit, span, arg, s, this.prefer)
    this.stats.picks++
    if (fallback) this.stats.fallbacks++
    if (r.retainedHolds) {
      if (final) { this.revalidate = false; this.shownFallback = fallback; this.nextCheckAt = now + (fallback ? RECHECK_MS : RECHECK_READ_MS) }
      return
    }
    if (now - this.shownAt < MIN_SHOW_MS) { this.nextCheckAt = this.shownAt + MIN_SHOW_MS; return }
    // Not confirmed: fade out through the normal rules; the pause continues and the next arm names whatever the new surface supports.
    this.revalidate = false
    this.fadeOut(now)
  }

  private useHit(now: number, s: CamSample, hit: CentreHit, fallback: boolean): boolean {
    if (fallback) this.stats.fallbacks++
    this.stats.picks++
    // A rendered hit that named nothing is read again slowly (tiles arrive); the CPU estimate is cheap and re-checked quickly.
    this.nextCheckAt = now + (fallback ? RECHECK_MS : RECHECK_READ_MS)
    const span = sampleSpanKm(s)
    // A zoom since the name was chosen drops the retained record: specificity is reconsidered at the new span.
    if (this.retained && Math.abs(Math.log(span / this.retained.baselineSpan)) > Math.log(1 + ZOOM_FRAC)) this.retained = null
    const r: PickResult = pickCentre(hit, span, this.retained && { id: this.retained.id, acceptRad: this.retained.acceptRad, provisional: this.retained.provisional }, s, this.prefer)
    let id: string | null = null
    let mode: 'contain' | 'near' | 'prominent' = 'contain'
    let entry = 0
    if (this.retained && r.retainedHolds) { id = this.retained.id; mode = this.retained.mode; entry = this.retained.acceptRad / (1 + HYST) }
    else if (r.status === 'ok' && r.choice) { id = r.choice.label.id; mode = r.choice.mode; entry = r.choice.entryRad }
    if (!id) return false
    const label = labelById(id)
    if (!label) return false
    const keep = this.retained && this.retained.id === id
    // A prominence-only name chosen without a known hit stays provisional until a known hit has confirmed it.
    const unknownHit = !Number.isFinite(hit.errKm) || !Number.isFinite(hit.lonDeg) || !Number.isFinite(hit.latDeg)
    const provisional = this.retained && r.retainedHolds ? this.retained.provisional && unknownHit : !!r.choice?.provisional
    this.retained = { id, mode, acceptRad: entry * (1 + HYST), baselineSpan: keep ? this.retained!.baselineSpan : span, shownAt: now, provisional }
    this.text = label.name
    this.phase = 'shown'
    this.shownAt = now
    this.shownFallback = fallback
    this.domDirty = true
    // A name taken from the CPU estimate is confirmed by a read when the device can make one (no pop: see revalidateShown).
    if (fallback && (!this.host.readable || this.host.readable())) { this.revalidate = true; this.revalidateSince = now }
    return true
  }

  /** A name made from the CPU estimate is re-checked (the height map may arrive); a rendered hit is final for the pause. */
  private recheckShown(now: number, s: CamSample): void {
    if (!this.shownFallback || now < this.nextCheckAt) return
    this.nextCheckAt = now + RECHECK_MS
    if (!this.eligible(s)) { this.fadeOut(now); return }
    const hit = this.host.fallback(s)
    const r = pickCentre(hit, sampleSpanKm(s), this.retainedArg(), s, this.prefer)
    if (r.retainedHolds) return
    if (now - this.shownAt < MIN_SHOW_MS) return
    this.fadeOut(now)
  }
}

/** The hit a read describes: the sampled texel's own ray, with the error bounding its displacement from the screen-centre hit. */
export function hitOfRead(r: Extract<ReadResult, { kind: 'hit' }>): CentreHit {
  const pixelTan = 2 * r.cam.tanHalf / r.h
  const { dir, offPx } = r.ix === undefined || r.iy === undefined ? { dir: centreDir(r.cam), offPx: 0 } : texelRay(r.cam, r.w, r.h, r.ix, r.iy)
  let range = r.rangeRadii
  if (!(range > 0)) {
    const p = raySphereV(r.cam.pos, dir, 1)
    if (!p) return { lonDeg: NaN, latDeg: NaN, errKm: Infinity, fallback: false }
    range = Math.hypot(p[0] - r.cam.pos[0], p[1] - r.cam.pos[1], p[2] - r.cam.pos[2])
  }
  const hit = hitFromRange(r.cam.pos, dir, range, pixelTan, offPx)
  // Grazing and silhouette cases are never certain: near the limb the displacement between the read ray and the centre ray is unbounded (one pixel can span
  // tens of km), and just past tangency the centre ray misses while the read texel still hits. The surface radius at the hit stands in for the terrain.
  const p: V3 = [r.cam.pos[0] + dir[0] * range, r.cam.pos[1] + dir[1] * range, r.cam.pos[2] + dir[2] * range]
  const rHit = Math.hypot(p[0], p[1], p[2])
  const centre = centreDir(r.cam)
  const cHit = raySphereV(r.cam.pos, centre, rHit)
  if (!cHit) return { ...hit, errKm: Infinity }
  const sinC = Math.abs(centre[0] * cHit[0] + centre[1] * cHit[1] + centre[2] * cHit[2]) / rHit
  const sinT = Math.abs(dir[0] * p[0] + dir[1] * p[1] + dir[2] * p[2]) / rHit
  if (Math.min(sinC, sinT) < GRAZE_SIN_MIN) return { ...hit, errKm: Infinity }
  return { ...hit, ray: { pos: r.cam.pos, dir, rangeRadii: range } }
}
/**
 * Marks a rendered hit as OBSTRUCTED when its range falls short of the range predicted along the same texel ray from the CPU height sample (with the effective
 * relief scale): `rendered < predicted - tolerance`. The expected height is never derived from the rendered hit. A depression or ordinary elevation moves
 * both ranges together (the prediction includes it), so they do not count; a pending height map gives no prediction and no test.
 */
export function withOcclusion(hit: CentreHit, predict?: (pos: V3, dir: V3) => CentreHit | null): CentreHit {
  if (!hit.ray || !predict || !Number.isFinite(hit.errKm)) return hit
  const p = predict(hit.ray.pos, hit.ray.dir)
  if (!p || !Number.isFinite(p.errKm) || p.rangeRadii === undefined) return hit
  const tolKm = 3 * (p.sigmaRangeKm ?? 0) + hit.errKm + OCCLUSION_FLOOR_KM
  const gap = (p.rangeRadii - hit.ray.rangeRadii) * R_KM - tolKm
  return gap > 0 ? { ...hit, occludedKm: gap } : hit
}
/** Below this sine of the ray's elevation over the local horizontal (about 9 degrees) a read hit is too foreshortened to trust. */
export const GRAZE_SIN_MIN = 0.15
