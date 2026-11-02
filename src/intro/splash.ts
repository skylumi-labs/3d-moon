import './splash.css'
import { loadedLabel } from './parse'

/**
 * The opening's splash (v6, owner request 2026-10-24): a cinematic title card.
 * Black letterbox bars top and bottom, a faint still of Tycho's rim between them, "THE MOON" in thin wide-tracked capitals and a
 * hairline loading line. It covers the page from the first script until the Moon and what the flight needs are on screen; then
 * the title fades up, the still cross-fades into the live canvas (already rendering underneath) and the bars retreat (controller.ts).
 */

export interface SplashApi {
  /** Share of what the flight needs that is on screen, 0..1 (the line never runs backwards). */
  setProgress(fraction: number): void
  /** Removes it at once. */
  dispose(): void
  /** Starts the unveil; resolves when the middle of the screen is clear enough for the flight to start under it. */
  exit(): Promise<void>
}

/** The unveil's timings, ms (splash.css carries the same numbers). */
export const TEXT_OUT_MS = 600
export const STILL_OUT_MS = 900
export const BARS_OUT_MS = 1200
export const BARS_DELAY_MS = 200
/** The middle is clear once the title is gone and the still is mostly faded. */
const CLEAR_MS = 700
const REMOVE_MS = BARS_DELAY_MS + BARS_OUT_MS + 80
const REDUCED_MS = 450
/** The line's final run to 100 % gets at most this long before the unveil starts, ms. */
const FINAL_RUN_MAX_MS = 700
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The displayed progress, decoupled from the raw fraction (which arrives in coarse steps). It is a smooth monotone curve in time:
 * an "expected duration" model, shown' = (CAP - shown) / tau, whose tau starts so the line is near 85 % at EXPECTED_S and then adapts
 * to what the raw progress has actually done. A small minimum speed (decaying slowly) keeps it from ever stopping, a catch-up term
 * pulls it toward raw progress when it lags, and it never runs more than LEAD ahead of raw. The speed itself is eased (first-order
 * lag plus an acceleration limit), so there are no visible velocity jumps. finish() ends with a short Hermite ease-out to 100 %.
 * Under reduced motion it is linear.
 */
export class SmoothLine {
  shown = 0
  private vel = 0
  private raw = 0
  private time = 0
  private tau = 1.9
  private final = false
  private doneT = 0
  private s0 = 0
  private v0 = 0
  private readonly CAP = 0.97
  private readonly LEAD = 0.15
  private readonly HARD = 0.985
  private readonly FINISH_S = 0.4
  constructor(private readonly reduced = false) {}

  setTarget(f: number): void {
    const t = Math.max(0, Math.min(1, f))
    if (t > this.raw) this.raw = t
  }
  finish(): void {
    if (this.final) return
    this.final = true
    this.raw = 1
    this.doneT = 0
    this.s0 = this.shown
    this.v0 = this.vel
  }

  /** Where the line will be `ahead` seconds from now if nothing new arrives (the model is not changed). */
  peek(ahead: number): number {
    const c = Object.assign(Object.create(Object.getPrototypeOf(this)) as SmoothLine, this)
    for (let t = 0; t < ahead; t += 0.05) c.step(0.05)
    return c.shown
  }

  /** Advances by dt seconds; returns the value to draw. */
  step(dt: number): number {
    dt = Math.max(0, Math.min(0.1, dt))
    if (this.reduced) {
      const goal = this.final ? 1 : Math.min(this.HARD, this.raw)
      this.shown = Math.max(this.shown, Math.min(goal, this.shown + dt * (this.final ? 2 : 0.5)))
      return this.shown
    }
    if (this.final) {
      this.doneT = Math.min(this.FINISH_S, this.doneT + dt)
      const D = this.FINISH_S, u = this.doneT / D
      const v0 = Math.max(0, Math.min(this.v0, 3 * (1 - this.s0) / D))
      const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2
      const p = h00 * this.s0 + h10 * D * v0 + h01
      this.shown = Math.min(1, Math.max(this.shown, p))
      if (u >= 1) this.shown = 1
      return this.shown
    }
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n
    for (let i = 0; i < n; i++) {
      this.time += h
      const r = this.raw
      // What the raw progress implies for tau (it lags the model at first, so only trusted once there is something to see).
      if (r > 0.05 && this.time > 0.3) {
        const obs = Math.max(0.6, Math.min(8, -this.time / Math.log(1 - Math.min(r, 0.96) / this.CAP)))
        this.tau += (obs - this.tau) * Math.min(1, h / 1.5)
      }
      const vmin = 0.012 * Math.exp(-this.time / 20)
      const lag = Math.max(0, r - this.shown)
      const room = Math.max(0, Math.min(1, 1 - (this.shown + this.vel * 0.6 - r) / this.LEAD))
      const top = Math.max(0, Math.min(1, (this.HARD - this.shown) / 0.02))
      const want = (Math.max(vmin, (this.CAP - this.shown) / this.tau) + lag * 1.2) * room * top
      let dv = (want - this.vel) / 0.5 * h
      const cap = 0.5 * h
      dv = Math.max(-cap, Math.min(cap, dv))
      this.vel = Math.max(0, this.vel + dv)
      this.shown = Math.min(this.HARD, this.shown + this.vel * h)
    }
    return this.shown
  }
}

/** Anything with the Web Animations `animate` (an Element, or a fake in the test). */
export interface Animatable { animate(keyframes: Record<string, string>[], options: Record<string, unknown>): { cancel(): void } }

/**
 * Draws SmoothLine on the compositor. The model runs in rAF, but the main thread can stall (shader compiles, texture uploads)
 * and a line written from JS then freezes and jumps. So every ~200 ms it starts a 400 ms linear transform animation from where
 * the line is now to where the model predicts it will be 400 ms ahead; the compositor keeps it gliding through a stall.
 */
export class LineAnimator {
  private lastStart = -1e9
  private done = false
  private anims: ({ cancel(): void } | null)[]
  private readonly ahead = 0.4
  private readonly every = 200
  /** A glide never runs faster than this (per second), so a catch-up after a stall cannot snap. */
  private readonly maxSpeed = 0.6
  /** `drawn` reads what the compositor has actually drawn (the bar's computed scaleX), never the model's guess. */
  constructor(
    private readonly line: SmoothLine,
    private readonly bar: Animatable,
    private readonly glow: Animatable,
    private readonly now: () => number,
    private readonly drawn: () => number,
  ) { this.anims = [null, null] }

  private run(to: number, ms: number, easing: string): void {
    const from = Math.max(0, Math.min(1, this.drawn()))
    to = Math.max(from, to)
    this.lastStart = this.now()
    const opts = { duration: ms, easing, fill: 'forwards' }
    this.anims[0]?.cancel(); this.anims[1]?.cancel()
    this.anims[0] = this.bar.animate([{ transform: `scaleX(${from})` }, { transform: `scaleX(${to})` }], opts)
    this.anims[1] = this.glow.animate([{ transform: `translateX(${(from - 1) * 100}%)` }, { transform: `translateX(${(to - 1) * 100}%)` }], opts)
  }
  /** Once per rAF: advances the model, and starts the next glide when it is time. */
  frame(dt: number): void {
    this.line.step(dt)
    if (this.done || this.now() - this.lastStart < this.every) return
    const from = this.drawn()
    this.run(Math.min(1, this.line.peek(this.ahead), from + this.maxSpeed * this.ahead), this.ahead * 1000, 'linear')
  }
  /** The last glide: to 100 % with an ease-out. */
  finish(): void {
    if (this.done) return
    this.line.finish()
    this.done = true
    this.run(1, this.ahead * 1000, 'cubic-bezier(0.33, 1, 0.68, 1)')
  }
}

export function mountSplash(root: HTMLElement = document.body): SplashApi {
  const el = document.createElement('div')
  el.className = 'splash'
  el.setAttribute('role', 'status')
  el.setAttribute('aria-label', 'Loading the Moon')
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
  el.innerHTML = `<div class="splash-bg"></div><img class="splash-still" alt="" decoding="async" src="${base}splash/still.webp"><div class="splash-glow"></div><div class="splash-vignette"></div>`
    + '<div class="splash-content"><h1 class="splash-title">The Moon in 3D</h1><p class="splash-sub"></p><div class="splash-progress"><span class="splash-bar"><b></b><i></i></span></div></div>'
    + '<div class="splash-band splash-top"></div><div class="splash-band splash-bottom"></div>'
  ;(el.querySelector('.splash-sub') as HTMLElement).textContent = 'High-resolution craters, ridges, and lunar oceans in 3D'
  const bar = el.querySelector('.splash-bar > b') as HTMLElement
  const glow = el.querySelector('.splash-bar > i') as HTMLElement
  root.appendChild(el)
  requestAnimationFrame(() => el.classList.add('in'))
  const line = new SmoothLine(REDUCED)
  let raf = 0, lastT = performance.now()
  const draw = (v: number): void => {
    bar.style.transform = `scaleX(${v.toFixed(4)})`
    glow.style.transform = `translateX(${((v - 1) * 100).toFixed(3)}%)`
  }
  // What the compositor has drawn: the animated scaleX shows in the computed matrix(a, ...).
  const drawnScale = (): number => {
    const m = /^matrix\(([-\d.e]+)/.exec(getComputedStyle(bar).transform)
    return m ? Number(m[1]) : 0
  }
  const glide = !REDUCED && typeof bar.animate === 'function' && typeof glow.animate === 'function'
  const animator = glide ? new LineAnimator(line, bar, glow, () => performance.now(), drawnScale) : null
  const loop = (t: number): void => {
    if (animator) animator.frame((t - lastT) / 1000)
    else draw(line.step((t - lastT) / 1000))
    lastT = t
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
  const remove = (): void => { cancelAnimationFrame(raf); el.remove() }
  let exiting: Promise<void> | null = null
  return {
    setProgress(f) { line.setTarget(f) },
    dispose: remove,
    exit() {
      if (exiting) return exiting
      if (animator) animator.finish()
      else line.finish()
      exiting = new Promise((resolve) => {
        const t0 = performance.now()
        const begin = (): void => {
          el.classList.add('out')
          setTimeout(resolve, REDUCED ? REDUCED_MS * 0.6 : CLEAR_MS)
          setTimeout(remove, REDUCED ? REDUCED_MS : REMOVE_MS)
        }
        const wait = (): void => {
          if (line.shown >= 0.995 || performance.now() - t0 >= FINAL_RUN_MAX_MS) { begin(); return }
          setTimeout(wait, 30)
        }
        wait()
      })
      return exiting
    },
  }
}

/** After this long on the bare loading screen a second line says the page is alive, ms. */
export const SLOW_LOAD_MS = 4000

/**
 * The cold-load state for visits without the splash (a shared link, an automated browser): ONE centred "Loading the Moon…"
 * (#preview in index.html) plus what the page has really received so far, from the Resource Timing entries of finished
 * downloads: bytes, or the file count once a cross-origin download hides its size (the data bucket sends no Timing-Allow-Origin,
 * so on skylumi.org its tiles report 0 bytes; a byte total would stall at the script's size). No percentage: the total is not known.
 */
export function mountLoadingLine(preview: HTMLElement | null = document.getElementById('preview')): () => void {
  if (!preview) return () => undefined
  const detail = preview.querySelector('.preview-detail') as HTMLElement | null
  if (!detail) return () => undefined
  let bytes = 0, files = 0, opaque = 0
  let obs: PerformanceObserver | null = null
  try {
    obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const r = e as PerformanceResourceTiming
        const size = r.encodedBodySize || r.transferSize || 0
        files++; bytes += size; if (!size) opaque++
      }
    })
    obs.observe({ type: 'resource', buffered: true })
  } catch { obs = null }
  const t0 = performance.now()
  let timer = 0
  const stop = (): void => { clearInterval(timer); obs?.disconnect() }
  const tick = (): void => {
    if (!preview.isConnected) { stop(); return }
    const slow = performance.now() - t0 >= SLOW_LOAD_MS
    const loaded = obs ? loadedLabel(bytes, files, opaque) : ''
    detail.textContent = slow ? `Still loading${loaded ? ` (${loaded})` : ''}. A slow connection can take a minute.` : loaded
  }
  timer = window.setInterval(tick, 250)
  tick()
  return stop
}
