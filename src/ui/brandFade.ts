/**
 * The brand line ("<BRAND_LINE> (Credits)", src/branding.ts) stays out of the way while the camera moves and fades IN once the view has been still for
 * more than BRAND_STILL_MS, then stays visible while still. Any input or camera motion fades it out again. The stillness signal is the frame loop's own `loopQuiet` (main.ts), read on each frame tick; the fade-in is due on its own timer, because the loop idles at 2.5 s and then beats once a second, so a tick alone would show it up to 1 s late. The line is
 * held visible while the Credits popover is open or its button has keyboard focus. The opacity ceiling (0.5) and the fade times live in index.html.
 */
export const BRAND_STILL_MS = 2000

export interface BrandFadeState { shown: boolean; quietSince: number }
export const initialBrandFade: BrandFadeState = { shown: false, quietSince: -1 }

/** One frame-loop tick: `quiet` is the loop's still flag, `pinned` holds the line (popover open, keyboard focus on Credits). */
export function brandTick(s: BrandFadeState, quiet: boolean, pinned: boolean, now: number): BrandFadeState {
  if (pinned) return s.shown ? s : { shown: true, quietSince: -1 }
  if (!quiet) return !s.shown && s.quietSince < 0 ? s : { shown: false, quietSince: -1 }
  const since = s.quietSince < 0 ? now : s.quietSince
  return { shown: now - since > BRAND_STILL_MS, quietSince: since }
}

/** Any pointer, touch, wheel or key input: hidden again, the still spell starts over (unless the line is held, which the next tick restores). */
export function brandInput(s: BrandFadeState): BrandFadeState {
  return !s.shown && s.quietSince < 0 ? s : { shown: false, quietSince: -1 }
}

/** Milliseconds until the line is due to fade in (0 if already due), or null when no still spell is running or it is already in. */
export function brandDueIn(s: BrandFadeState, now: number): number | null {
  if (s.shown || s.quietSince < 0) return null
  return Math.max(0, s.quietSince + BRAND_STILL_MS + 1 - now)
}

/** Inputs that start moving the view. Not pointermove: a mouse on its way to (Credits) must not hide it (a drag moves the camera, which the loop's quiet flag reports). */
const INPUTS = ['pointerdown', 'wheel', 'keydown', 'touchstart'] as const

export interface BrandFadeUi { tick(quiet: boolean, now: number): void }

export function mountBrandFade(el: HTMLElement, pinned: () => boolean): BrandFadeUi {
  let s = initialBrandFade
  const apply = (next: BrandFadeState): void => {
    const was = s.shown
    s = next
    if (was !== s.shown) el.dataset.brand = s.shown ? 'in' : 'out'
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  const held = (): boolean => pinned() || !!el.querySelector('.credit-link:focus-visible')
  // Independent of the render loop: a timeout for exactly the due moment, re-armed on every state change (activity cancels it).
  const update = (next: BrandFadeState): void => {
    apply(next)
    if (timer !== null) { clearTimeout(timer); timer = null }
    const due = brandDueIn(s, performance.now())
    if (due !== null) timer = setTimeout(() => { timer = null; update(brandTick(s, true, held(), performance.now())) }, due)
  }
  el.dataset.brand = 'out'
  // Input on the line itself (a press on Credits) or Tab towards it does not hide it; keyboard focus on it shows it at once.
  const onInput = (e: Event): void => {
    if (held() || (e.target instanceof Node && el.contains(e.target)) || (e as KeyboardEvent).key === 'Tab') return
    update(brandInput(s))
  }
  for (const ev of INPUTS) document.addEventListener(ev, onInput, { capture: true, passive: true })
  el.addEventListener('focusin', () => update(brandTick(s, true, held(), performance.now())))
  return { tick: (quiet, now) => update(brandTick(s, quiet, held(), now)) }
}
