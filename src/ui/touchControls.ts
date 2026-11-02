import './touchControls.css'
import { BUTTON_LABELS, EasedButton, PAD_LABELS, STICK_FULL_UNITS_PER_S, STICK_TAP_MS, STICK_TAP_PX, TILT_CLICK_UNITS, TILT_HOLD_UNITS_PER_S, TILT_WORDS, axisUnits, ZOOM_CLICK_OCTAVES, ZOOM_HOLD_OCTAVES_PER_S, springSettled, springStep, stickAngleDeg, stickKeyDeflection, stickKnob, stickRates, stickTapDirection, type StickAxis } from './touchControlsLogic'
export { initiallyOpen, hintFor, sideControlStep } from './touchControlsLogic'
import { padChoice, padOpenFor } from './touchControlsLogic'
import { padFitsRow } from './dockRow'
import { TABLER_STROKE, tablerIcon } from './tablerIcons'

/**
 * Optional on-screen flight controls: always the complete group [look up | down] [- +] [stick], at every width (owner decision 2026-10-24: all the flight buttons or none).
 * Where it stands (dockRow.ts padFitsRow): if the closed bar and the whole pad fit one bar (a wide screen) it is in the bar's row, between the navigator's buttons and the last icons
 * (More, and the toggle that opens and closes the pad). Otherwise it has a glass row of its own, directly above the bar in the same dock (bar.ts padRow); the bar row below is then
 * exactly the closed bar. A flight's slider never moves the pad.
 * A zoom or tilt half glides on a press (EasedButton: a critically damped follower, zero speed at both ends) and repeats while held, at a steady rate per second.
 * With hooks.wake the host's frame loop steps the halves (`frame(now)`, the frame's own timestamp, so the camera change and the drawn frame are one frame); the stick maps its drag
 * distance to a rate (dead zone and curve in touchControlsLogic), springs back when let go, and a tap on it is one small step.
 * Open by itself on a desktop while manual navigation is on (the bar's `barmanual` event; padOpenFor), else closed; the C key, the toggle, or ?controls=1 or 0,
 * decide instead, and the visitor's own toggle is remembered. While manual navigation is on the bar keeps the toggle in its More sheet.
 */
export interface TouchControlHooks {
  /** Distance factor for this step (< 1 zooms in). */
  zoom(factor: number): void
  /** Tilt the view (drag-equivalent CSS px: positive looks up, toward the horizon; negative back toward the ground). In the ground view it turns the view up or down. */
  tilt(px: number): void
  /** Degrees to turn the heading, positive counter-clockwise on screen (the heading grows). */
  roll(deg: number): void
  /** Fly along the view direction over the ground (drag-equivalent CSS px; negative flies back). */
  move(px: number): void
  /** Current short-side size and view field, so one press is a consistent share of the visible frame. */
  frame(): { shortCss: number; fovDeg: number }
  /**
   * A zoom or tilt half was pressed and needs frames: the host makes sure its frame loop runs and calls the api's `frame(now)` every frame
   * with the frame's timestamp. Without it the halves run their own requestAnimationFrame loop (a mount with no host loop, a test).
   */
  wake?(): void
}

export interface TouchControlsApi {
  readonly element: HTMLElement; setOpen(open: boolean, persist?: boolean): void; toggle(): void; isOpen(): boolean
  /** Advance the pressed zoom and tilt halves to the frame time `nowMs` (the rAF timestamp); true while any still moves. Called by the host's frame loop (hooks.wake). */
  frame(nowMs: number): boolean
  /** A scripted move starts (a fly-to): the released halves' glide tails stop, so they do not take it over on their next step. A held half keeps going. */
  cancelGlides(): void
}

/** Rate per second of a held zoom button (octaves). */
export const ZOOM_OCTAVES_PER_S = ZOOM_HOLD_OCTAVES_PER_S
const KEY = 'moon.touchControls'

// One icon family: the bar's 24 px grid and stroke (tablerIcons.ts), round caps and joins.
const barIcon = (path: string): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${TABLER_STROKE}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
const ICONS = {
  // The stick's edge chevrons, on the bar's 24 px grid and stroke too.
  edgeUp: barIcon('<path d="M8.5 13.8l3.5-3.6 3.5 3.6"/>'),
  edgeDown: barIcon('<path d="M8.5 10.2l3.5 3.6 3.5-3.6"/>'),
  edgeLeft: barIcon('<path d="M13.8 8.5l-3.6 3.5 3.6 3.5"/>'),
  edgeRight: barIcon('<path d="M10.2 8.5l3.6 3.5-3.6 3.5"/>'),
  // The tilt pair: a chevron over a horizon line (up: toward the horizon; down: back toward the ground). On the bar's 24 px grid and stroke
  // (tablerIcons.ts), so the pad's icons match the bar's below it (owner 2026-10-31, item E).
  lookUp: barIcon('<path d="M6 11.5l6-6 6 6M5 18.5h14"/>'),
  lookDown: barIcon('<path d="M6 12.5l6 6 6-6M5 5.5h14"/>'),
}
/** A light tick under the thumb where the device has one (not iOS Safari, which has no web haptics; there the scale feedback stands in). */
const tick = (): void => { try { navigator.vibrate?.(6) } catch { /* not allowed */ } }
const reducedMotion = (): boolean => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }

export function mountTouchControls(parent: HTMLElement, hooks: TouchControlHooks): TouchControlsApi {
  const wrap = document.createElement('div')
  wrap.className = 'touch-ctl'
  wrap.dataset.touchControls = ''
  const pad = document.createElement('div')
  pad.className = 'touch-ctl-pad'
  const fixed = document.createElement('div')
  fixed.className = 'touch-ctl-fixed'
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'tc-surface tc-toggle'
  // The word shows only in the More sheet, where bar.ts keeps the toggle while manual navigation is on (bar.css hides .lbl in the row).
  toggle.innerHTML = `<span class="tc-ico open">${tablerIcon('handMove', 22)}</span><span class="tc-ico close">${tablerIcon('chevronDown', 22)}</span><span class="lbl">Controls</span>`

  // Every capsule half is an EasedButton and the stick a per-frame driver. The halves are stepped by the host's frame loop when it gave a wake
  // hook (glideSteps, frame(now)); the stick, and the halves of a host with no wake hook, run on this module's own animation loop.
  const glideSteps = new Set<(nowMs: number) => boolean>()
  const tails = new Set<() => void>()
  const frame = (nowMs: number): boolean => {
    for (const f of [...glideSteps]) if (!f(nowMs)) glideSteps.delete(f)
    return glideSteps.size > 0
  }
  const driven = new Set<() => boolean>()
  let raf = 0
  const loop = (): void => {
    for (const f of [...driven]) if (!f()) driven.delete(f)
    raf = driven.size ? requestAnimationFrame(loop) : 0
  }
  const stops = new WeakMap<HTMLButtonElement, () => void>()
  const drive = (svg: string, label: string, perPress: number, perSecond: number, apply: (units: number) => void, word = '', motion = new EasedButton()): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    // A word beside the icon only where the half stands in the More sheet (touchControls.css); the name stays for screen readers and the tooltip.
    b.innerHTML = word ? `${svg}<span class="lbl">${word}</span>` : svg
    b.title = label
    b.setAttribute('aria-label', label)
    let tPrev = 0
    // `n` is the frame's own timestamp. A press lands inside a frame, after that frame's timestamp: the time since the press counts at the next frame.
    const step = (n: number): boolean => {
      const units = motion.tick(Math.max(0, n - tPrev) / 1000, perSecond)
      tPrev = Math.max(tPrev, n)
      if (units !== 0) apply(units)
      return motion.active
    }
    const own = (): boolean => step(performance.now())
    const start = (): void => {
      motion.press(perPress)
      // A re-press while the glide runs keeps its clock: resetting it to the press time dropped the time since the last frame (a one-frame stall).
      if (!glideSteps.has(step) && !driven.has(own)) tPrev = performance.now()
      if (hooks.wake) { glideSteps.add(step); hooks.wake() } else { driven.add(own); if (!raf) raf = requestAnimationFrame(loop) }
    }
    b.addEventListener('pointerdown', (e) => {
      if (b.disabled) return
      e.preventDefault()
      try { b.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
      b.dataset.down = ''
      tick()
      start()
    })
    const stop = (): void => { delete b.dataset.down; motion.release() }
    tails.add(() => { if (b.dataset.down !== undefined) return; motion.stop(); glideSteps.delete(step); driven.delete(own) })
    stops.set(b, stop)
    b.addEventListener('pointerup', stop)
    b.addEventListener('pointercancel', stop)
    b.addEventListener('lostpointercapture', stop)
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) { start(); motion.release() } } })
    return b
  }
  const zoomButton = (svg: string, label: string, sign: 1 | -1): HTMLButtonElement =>
    drive(svg, label, sign * ZOOM_CLICK_OCTAVES, sign * ZOOM_OCTAVES_PER_S, (octaves) => hooks.zoom(Math.pow(2, -octaves)))
  /** Look up or down: units are frame steps of the tilt axis (axisUnits), so a press tilts by the same share of the view at every lens. */
  const tiltButton = (svg: string, label: string, word: string, sign: 1 | -1): HTMLButtonElement =>
    drive(svg, label, sign * TILT_CLICK_UNITS, sign * TILT_HOLD_UNITS_PER_S, (units) => { const { shortCss, fovDeg } = hooks.frame(); hooks.tilt(axisUnits('tilt', units, shortCss, fovDeg).tiltPx) }, word)
  /** A capsule: two opposite directions of one motion in one glass pill, a hairline divider between the halves. */
  const capsule = (name: string, first: HTMLButtonElement, second: HTMLButtonElement): HTMLElement => {
    const cap = document.createElement('div')
    cap.className = 'tc-surface tc-cap tc-item'
    cap.dataset.rocker = name.toLowerCase()
    cap.setAttribute('role', 'group')
    cap.setAttribute('aria-label', name)
    first.classList.add('tc-half')
    second.classList.add('tc-half')
    cap.append(first, second)
    return cap
  }
  const zoomCap = capsule(PAD_LABELS.zoom, zoomButton(tablerIcon('plus', 22), BUTTON_LABELS.zoomIn, 1), zoomButton(tablerIcon('minus', 22), BUTTON_LABELS.zoomOut, -1))
  // The pitch control the owner asked back (review 2026-10-23, #11): tilt was Shift-drag, right-drag and Shift with the up and down arrows only.
  const tiltCap = capsule(PAD_LABELS.tilt, tiltButton(ICONS.lookUp, BUTTON_LABELS.lookUp, TILT_WORDS.up, 1), tiltButton(ICONS.lookDown, BUTTON_LABELS.lookDown, TILT_WORDS.down, -1))

  /**
   * The analogue thumbstick. The drag distance from the centre is a rate (stickRates: dead zone, then a smooth curve), applied every
   * frame: up and down fly, left and right turn. Let go and the knob springs back. A short press with no drag is a tap: one small
   * step toward the side tapped. Arrow keys hold the stick over while it has focus.
   */
  const stick = (): HTMLElement => {
    const el = document.createElement('div')
    el.className = 'tc-surface tc-stick tc-item'
    el.dataset.stick = 'fly'
    el.tabIndex = 0
    el.setAttribute('role', 'application')
    el.setAttribute('aria-roledescription', 'joystick')
    el.setAttribute('aria-label', PAD_LABELS.stick)
    el.title = PAD_LABELS.stick
    el.innerHTML = '<svg class="rim" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48.5" pathLength="360" stroke-dasharray="60 300"/></svg>'
      + [ICONS.edgeUp, ICONS.edgeDown, ICONS.edgeLeft, ICONS.edgeRight].map((g, i) => `<span class="g ${['top', 'bottom', 'left', 'right'][i]}">${g}</span>`).join('') + '<span class="knob"></span>'
    const knob = el.querySelector('.knob') as HTMLElement
    const pos = { x: 0, y: 0 }
    const vel = { x: 0, y: 0 }
    let grow = 1
    let angle = 0
    let R = 30
    let ptr: { id: number; cx: number; cy: number; downAt: number; sx: number; sy: number; moved: number; engaged: boolean; dx: number; dy: number } | null = null
    const keys = new Set<string>()
    const tap = new EasedButton()
    let tapDir: { x: number; y: number } | null = null
    let tPrev = 0
    const apply = (axis: StickAxis, units: number): void => {
      if (units === 0) return
      const { shortCss, fovDeg } = hooks.frame()
      const m = axisUnits(axis, units, shortCss, fovDeg)
      if (m.rollDeg) hooks.roll(m.rollDeg)
      if (m.movePx) hooks.move(m.movePx)
    }
    const paint = (magnitude: number): void => {
      knob.style.transform = `translate3d(${pos.x.toFixed(2)}px, ${pos.y.toFixed(2)}px, 0) scale(${grow.toFixed(3)})`
      el.style.setProperty('--m', magnitude.toFixed(3))
      el.style.setProperty('--a', angle.toFixed(1))
    }
    const step = (): boolean => {
      const n = performance.now()
      const dt = Math.min(0.1, Math.max(0, (n - tPrev) / 1000))
      tPrev = n
      const tu = tap.tick(dt, 0)
      if (tu !== 0 && tapDir) { apply('turn', tapDir.x * tu); apply('move', tapDir.y * tu) }
      let live = tap.active
      let deflect: { x: number; y: number } | null = null
      if (ptr) {
        live = true
        if (ptr.engaged) deflect = { x: ptr.dx, y: ptr.dy }
        else if (n - ptr.downAt > STICK_TAP_MS || ptr.moved > STICK_TAP_PX) { ptr.engaged = true; deflect = { x: ptr.dx, y: ptr.dy } }
      } else if (keys.size) {
        const k = stickKeyDeflection(keys)
        const len = Math.hypot(k.x, k.y) || 1
        deflect = { x: (k.x / len) * R, y: (-k.y / len) * R }
        live = true
      }
      if (ptr || keys.size) {
        el.dataset.engaged = ''
        const target = ptr ? stickKnob(ptr.dx, ptr.dy, R) : stickKnob(deflect?.x ?? 0, deflect?.y ?? 0, R)
        // The knob follows the finger with a short ease (a pointer jump would look like a snap), or lands at once under reduced motion.
        const f = reducedMotion() ? 1 : 1 - Math.exp(-dt / 0.035)
        pos.x += (target.x - pos.x) * f
        pos.y += (target.y - pos.y) * f
        grow += (1.06 - grow) * f
        vel.x = vel.y = 0
        let magnitude = 0
        if (deflect) {
          const r = stickRates(deflect.x, deflect.y, R)
          magnitude = r.magnitude
          if (magnitude > 0) angle = stickAngleDeg(deflect.x, deflect.y)
          const secs = dt * STICK_FULL_UNITS_PER_S
          apply('turn', r.x * secs)
          apply('move', r.y * secs)
        }
        paint(magnitude)
        return true
      }
      // Let go: the knob springs back to the centre (straight there under reduced motion).
      delete el.dataset.engaged
      grow = reducedMotion() ? 1 : grow + (1 - grow) * (1 - Math.exp(-dt / 0.08))
      if (reducedMotion()) { pos.x = pos.y = 0; vel.x = vel.y = 0 } else {
        const sx = springStep(pos.x, vel.x, dt)
        const sy = springStep(pos.y, vel.y, dt)
        pos.x = sx.pos; vel.x = sx.vel; pos.y = sy.pos; vel.y = sy.vel
      }
      const settled = springSettled(pos.x, vel.x) && springSettled(pos.y, vel.y)
      if (settled) { pos.x = pos.y = 0; vel.x = vel.y = 0; grow = 1 }
      paint(0)
      return live || !settled || Math.abs(grow - 1) > 0.002
    }
    const wake = (): void => { tPrev = performance.now(); driven.add(step); if (!raf) raf = requestAnimationFrame(loop) }
    const radius = (): number => Math.max(10, (el.getBoundingClientRect().width - knob.offsetWidth) / 2)
    const offset = (e: PointerEvent): { dx: number; dy: number } => {
      if (!ptr) return { dx: 0, dy: 0 }
      return { dx: e.clientX - ptr.cx, dy: e.clientY - ptr.cy }
    }
    el.addEventListener('pointerdown', (e) => {
      if (ptr) return
      e.preventDefault()
      try { el.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
      const r = el.getBoundingClientRect()
      R = radius()
      ptr = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, downAt: performance.now(), sx: e.clientX, sy: e.clientY, moved: 0, engaged: false, dx: 0, dy: 0 }
      const o = offset(e)
      ptr.dx = o.dx; ptr.dy = o.dy
      el.dataset.down = ''
      tick()
      wake()
    })
    el.addEventListener('pointermove', (e) => {
      if (!ptr || ptr.id !== e.pointerId) return
      const o = offset(e)
      ptr.dx = o.dx; ptr.dy = o.dy
      ptr.moved = Math.max(ptr.moved, Math.hypot(e.clientX - ptr.sx, e.clientY - ptr.sy))
    })
    const end = (e: PointerEvent, cancelled: boolean): void => {
      if (!ptr || ptr.id !== e.pointerId) return
      const isTap = !cancelled && !ptr.engaged && ptr.moved <= STICK_TAP_PX && performance.now() - ptr.downAt <= STICK_TAP_MS
      if (isTap) {
        const d = stickTapDirection(ptr.dx, ptr.dy, R)
        if (d) { tapDir = d; tap.press(1); tap.release() }
      }
      ptr = null
      delete el.dataset.down
      wake()
    }
    el.addEventListener('pointerup', (e) => end(e, false))
    el.addEventListener('pointercancel', (e) => end(e, true))
    el.addEventListener('keydown', (e) => {
      if (!e.key.startsWith('Arrow')) return
      // The stick has the arrows while it has focus; the page's own arrow-key handling stays out of it.
      e.preventDefault()
      e.stopPropagation()
      if (!keys.has(e.key)) { keys.add(e.key); R = radius(); wake() }
    })
    el.addEventListener('keyup', (e) => { if (keys.delete(e.key)) { e.stopPropagation(); wake() } })
    el.addEventListener('blur', () => { if (keys.size) { keys.clear(); wake() } })
    return el
  }
  const flyStick = stick()

  // One group, in this order: tilt, zoom, stick (the Orbit | Turn switch went on 2026-10-31: every drag flies around the Moon under a fixed Sun). In the bar's row (padSlot) on a wide screen, else in the pad row above the bar (a mount without a bar keeps it in the wrap).
  // A thin divider between the groups, like the bar's own separator (shown in the bar's rows only, touchControls.css .tc-sep).
  const sep = (): HTMLElement => { const d = document.createElement('span'); d.className = 'tc-sep tc-item'; d.setAttribute('aria-hidden', 'true'); return d }
  pad.append(tiltCap, sep(), zoomCap, sep(), flyStick)
  pad.setAttribute('role', 'group')
  pad.setAttribute('aria-label', 'On-screen controls')
  const barEl = parent.querySelector<HTMLElement>('.dock > .bar')
  const padSlot = barEl?.querySelector<HTMLElement>('.bar-padslot') ?? null
  const padRow = parent.querySelector<HTMLElement>('.dock > .bar-padrow')
  const iconSlot = barEl?.querySelector<HTMLElement>('.bar-icons') ?? null
  // The toggle is the last icon of the bar (it is the Close button too); without a bar it stays a round button at the corner.
  if (iconSlot) { toggle.classList.add('in-bar'); toggle.classList.remove('tc-surface'); toggle.style.order = '70'; iconSlot.append(toggle) } else fixed.append(toggle)
  wrap.append(pad, fixed)
  parent.append(wrap)
  const inset = document.createElement('div')
  inset.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:0 env(safe-area-inset-right,0px) 0 env(safe-area-inset-left,0px)'
  document.body.append(inset)
  let inRow = false
  /** The text size and the safe-area insets, for dockRow.ts. */
  const metrics = (): { rem: number; l: number; r: number } => {
    const cs = getComputedStyle(inset)
    return { rem: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16, l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0 }
  }
  /** Where the pad stands: in the bar's row when dockRow.ts says the whole row fits one bar, else in the pad row above the bar. */
  const placePad = (): void => {
    const { rem, l, r } = metrics()
    inRow = !!padSlot && padFitsRow(window.innerWidth, rem, l, r)
    const target = inRow ? padSlot! : padRow ?? wrap
    if (pad.parentElement !== target) { if (target === wrap) wrap.prepend(pad); else target.append(pad) }
    wrap.classList.toggle('above', target === wrap)
    // The pad row shows while the pad is open in it (the 180 ms fold keeps it until the pad is hidden).
    if (padRow) padRow.hidden = pad.parentElement !== padRow || pad.hidden
    // The bar's row gives up its width only once the pad is really in it, and gets it back only after a closing pad has left it (the fold takes 180 ms).
    barEl?.dispatchEvent(new CustomEvent('barcompact', { detail: inRow && (open || hideTimer !== 0) }))
  }
  window.addEventListener('resize', placePad)
  // Track open sheets explicitly: a universal :has rule restyled the whole page on every text/attribute write in a motion frame.
  const syncSheet = (): void => {
    let open = false
    for (let a: Element | null = parent; a && !open; a = a.parentElement) open = !!a.querySelector(':scope > .dock .bar-sheet:not([hidden])')
    if (wrap.classList.contains('sheet-open') !== open) wrap.classList.toggle('sheet-open', open)
  }
  if (typeof MutationObserver !== 'undefined') new MutationObserver(syncSheet).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] })
  syncSheet()

  // The pad stands above the caption band, which can change height at any moment (the New Moon note goes at the first touch, a
  // caption flashes). A press must never find the control moved under the thumb, so the pad holds its place while any pointer is
  // down on it and glides to its new place when the last one lifts (a tap on the toggle that dismisses the note would otherwise
  // lose its click: the toggle slides away between down and up).
  const held = new Set<number>()
  wrap.addEventListener('pointerdown', (e) => {
    if (!held.size && pad.parentElement === wrap) wrap.style.bottom = `${Number.parseFloat(getComputedStyle(wrap).bottom) || 0}px`
    held.add(e.pointerId)
  }, true)
  const letGo = (e: PointerEvent): void => { if (held.delete(e.pointerId) && !held.size) wrap.style.removeProperty('bottom') }
  window.addEventListener('pointerup', letGo, true)
  window.addEventListener('pointercancel', letGo, true)

  let open = false
  let hideTimer = 0
  const setOpen = (v: boolean, persist = false): void => {
    open = v
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0 }
    if (v) {
      pad.hidden = false
      if (wrap.dataset.mounted !== undefined) void pad.offsetWidth // the unfold starts from the folded state
      wrap.dataset.open = ''
      pad.dataset.open = ''
    } else {
      delete wrap.dataset.open
      delete pad.dataset.open
      // Let the 140 ms fold finish before the pad leaves the layout (and the accessibility tree).
      if (wrap.dataset.mounted === undefined) pad.hidden = true
      else hideTimer = window.setTimeout(() => { pad.hidden = true; hideTimer = 0; placePad() }, 180)
    }
    placePad()
    toggle.setAttribute('aria-pressed', String(v))
    const label = v ? PAD_LABELS.close : PAD_LABELS.open
    toggle.setAttribute('aria-label', label)
    toggle.title = v ? 'Close the on-screen controls (C)' : 'On-screen controls (C)'
    // Only the visitor's own choice is remembered, never the one a ?controls=1 link made.
    if (persist) try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* private window */ }
  }
  toggle.addEventListener('click', () => setOpen(!open, true))
  // No choice of the visitor's own (?controls=, the remembered toggle): on a desktop the pad follows manual navigation (bar.ts setCompact tells it).
  const choice = (): boolean | null => { let stored: string | null = null; try { stored = localStorage.getItem(KEY) } catch { /* private window */ } return padChoice(location.search, stored) }
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)')
  const desktop = (): boolean => fine.matches
  let manual = !!barEl?.classList.contains('compact')
  const follow = (): void => { const want = padOpenFor(choice(), desktop(), manual); if (want !== open) setOpen(want) }
  barEl?.addEventListener('barmanual', (e) => { manual = (e as CustomEvent<boolean>).detail; follow() })
  window.addEventListener('resize', follow)
  setOpen(padOpenFor(choice(), desktop(), manual))
  wrap.dataset.mounted = ''
  return { element: wrap, setOpen, toggle: () => setOpen(!open, true), isOpen: () => open, frame, cancelGlides: () => { for (const f of tails) f() } }
}
