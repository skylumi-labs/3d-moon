import { announce } from './announce'

/**
 * A small, one-time hint for a device that cannot keep up: "This device is struggling to keep up. The Moon looks its best on a laptop or desktop."
 * Owner decision 2026-10-22 (PERSONAS-REVIEW Q5): "works" is enough for launch; say so kindly where the full view is out of reach.
 *
 * It rests on MEASURED performance only, never on the user agent or a device guess, and only while the view really moves (the frame loop's
 * loopQuiet is false, main.ts): most of the motion time spent in slow frames (over SLOW_FRAME_MS, sustained for SUSTAIN_MOVE_MS), or
 * LONG_TASKS_N long tasks over LONG_TASK_MS within LONG_TASK_WINDOW_MS while moving. Start-up work (shaders, the first tiles) is outside
 * the WARMUP_MS after mounting, and a gap over MAX_GAP_MS (tab hidden, idle sleep) is not a frame. A device that runs smoothly never reaches either bar.
 *
 * Shown at most once per visit, never during a flight's first FLIGHT_GRACE_MS (it waits, then shows), at the top right, clear of the
 * bottom controls. Dismissal is remembered in localStorage (wrapped: a private window may throw). Announced politely (announce.ts).
 * The decision is pure (lowEndFrame, lowEndLongTask, lowEndShouldShow: scripts/low-end-hint.test.mts); mountLowEndHint is the DOM part.
 */
export const SLOW_FRAME_MS = 50
export const SUSTAIN_MOVE_MS = 4000
export const SLOW_SHARE = 0.6
/** The motion time the frame share looks back over (about 10 to 20 s: both sums halve when it is reached). */
export const MOVE_WINDOW_MS = 10000
export const MAX_GAP_MS = 1000
export const LONG_TASK_MS = 200
export const LONG_TASKS_N = 3
export const LONG_TASK_WINDOW_MS = 30000
/** A long task counts as interaction when the view moved this recently. */
export const MOVING_RECENT_MS = 1000
export const WARMUP_MS = 10000
export const FLIGHT_GRACE_MS = 6000
/** The hint fades out by itself after this long (owner 2026-10-26, persona run: pinned until Got it, it covered the top of every later view). */
export const LOW_END_SHOW_MS = 9000
export const LOW_END_KEY = 'moon.lowEndHint'
export const LOW_END_TEXT = 'This device is struggling to keep up. The Moon looks its best on a laptop or desktop.'

/** The performance hint is advice for touch-first handhelds only. */
export function lowEndHintDevice(coarsePrimaryPointer: boolean, maxTouchPoints: number): boolean {
  return coarsePrimaryPointer && maxTouchPoints > 0
}

export interface LowEndState {
  /** Motion time measured and the part of it spent in slow frames (ms). */
  moveMs: number; slowMs: number
  /** Start times of long tasks seen while moving. */
  longTasks: number[]
  /** The previous moving frame (-1: none), the last moving moment, when the current flight began (-1: no flight). */
  prevMoveAt: number; lastMoveAt: number; flyingSince: number
}
export const initialLowEnd: LowEndState = { moveMs: 0, slowMs: 0, longTasks: [], prevMoveAt: -1, lastMoveAt: -Infinity, flyingSince: -1 }

/** One frame-loop tick: `moving` is !loopQuiet, `flying` a camera flight is playing. Frames before `warmFrom` set the clock but count nothing. */
export function lowEndFrame(s: LowEndState, moving: boolean, flying: boolean, now: number, warmFrom: number): LowEndState {
  const flyingSince = flying ? (s.flyingSince < 0 ? now : s.flyingSince) : -1
  if (!moving) return { ...s, prevMoveAt: -1, flyingSince }
  let { moveMs, slowMs } = s
  const dt = s.prevMoveAt < 0 ? 0 : now - s.prevMoveAt
  if (now >= warmFrom && dt > 0 && dt <= MAX_GAP_MS) {
    moveMs += dt
    if (dt > SLOW_FRAME_MS) slowMs += dt
    if (moveMs >= MOVE_WINDOW_MS) { moveMs /= 2; slowMs /= 2 }
  }
  return { ...s, moveMs, slowMs, prevMoveAt: now, lastMoveAt: now, flyingSince }
}

/** A long task (PerformanceObserver 'longtask'): kept when it is over LONG_TASK_MS, after the warm-up, while the view moves. */
export function lowEndLongTask(s: LowEndState, start: number, duration: number, warmFrom: number): LowEndState {
  if (duration <= LONG_TASK_MS || start < warmFrom || start - s.lastMoveAt > MOVING_RECENT_MS) return s
  return { ...s, longTasks: [...s.longTasks.filter((t) => start - t <= LONG_TASK_WINDOW_MS), start] }
}

/** True when the measurements say this device struggles. */
export function lowEndStruggling(s: LowEndState, now: number): boolean {
  const slow = s.moveMs >= SUSTAIN_MOVE_MS && s.slowMs / s.moveMs >= SLOW_SHARE
  const stalls = s.longTasks.filter((t) => now - t <= LONG_TASK_WINDOW_MS).length >= LONG_TASKS_N
  return slow || stalls
}

/** Show now? Struggling, not dismissed before, not yet shown this visit, and not in a flight's opening seconds. */
export function lowEndShouldShow(s: LowEndState, now: number, dismissed: boolean, shown: boolean): boolean {
  if (dismissed || shown) return false
  if (s.flyingSince >= 0 && now - s.flyingSince < FLIGHT_GRACE_MS) return false
  return lowEndStruggling(s, now)
}

export interface LowEndHintUi { tick(quiet: boolean, flying: boolean, now: number): void }

export function mountLowEndHint(parent: HTMLElement): LowEndHintUi {
  let s = initialLowEnd
  let shown = false
  let dismissed = false
  try { dismissed = localStorage.getItem(LOW_END_KEY) === 'dismissed' } catch { /* private window */ }
  const warmFrom = performance.now() + WARMUP_MS
  let observer: PerformanceObserver | null = null
  if (!dismissed && typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) s = lowEndLongTask(s, e.startTime, e.duration, warmFrom) })
    observer.observe({ type: 'longtask' })
  }
  const show = (): void => {
    shown = true
    observer?.disconnect()
    const el = document.createElement('div')
    el.className = 'low-end-hint'
    el.style.cssText = 'pointer-events:auto;position:absolute;top:max(16px,env(safe-area-inset-top,0px));right:max(18px,env(safe-area-inset-right,0px));z-index:30;max-width:min(320px,calc(100vw - 36px));box-sizing:border-box;display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:12px;background:rgba(14,18,28,.88);border:1px solid rgba(255,255,255,.14);color:#e8eefc;font-size:0.75rem;line-height:1.45;box-shadow:0 4px 18px rgba(0,0,0,.5)'
    const text = document.createElement('p')
    text.style.cssText = 'margin:0;flex:1'
    text.textContent = LOW_END_TEXT
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = 'Got it'
    close.setAttribute('aria-label', 'Dismiss the performance hint')
    close.style.cssText = 'flex:none;min-height:32px;padding:0 10px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:inherit;font:inherit;cursor:pointer'
    close.addEventListener('click', () => {
      el.remove()
      try { localStorage.setItem(LOW_END_KEY, 'dismissed') } catch { /* private window */ }
    })
    el.append(text, close)
    el.style.transition = 'opacity 600ms ease'
    parent.append(el)
    // Shown once per visit either way; only Got it is remembered across visits.
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 650) }, LOW_END_SHOW_MS)
    announce({ kind: 'hint', text: LOW_END_TEXT })
  }
  return {
    tick(quiet, flying, now) {
      if (dismissed || shown) return
      s = lowEndFrame(s, !quiet, flying, now, warmFrom)
      if (!document.hidden && lowEndShouldShow(s, now, dismissed, shown)) show()
    },
  }
}
