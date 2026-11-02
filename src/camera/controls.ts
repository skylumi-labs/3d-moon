import { MAX_GESTURE_STEP_RAD, type CameraRig } from './rig'
import type { Ephemeris } from '../ephemeris'
import { newTwoFingerState, twoFingerStep } from './gesture'
import { skyDragGain, spinRadiansPerPixel, TWIST_MIN_SPREAD_PX, newTwistState, twistDeg, twistStep } from './grab'
import { PointerState, POINTER_DRAG_START_PX } from './pointerState'
import { safariPinchLogDelta, shouldPreventTouchPageZoom, wheelZoomLogDelta } from './zoomInput'

/**
 * Pointer, wheel and keys to the camera rig. Every gesture works on the first frame: there is no mode to leave first.
 * One rule for every drag, touch or mouse (owner 2026-10-31: no Orbit / Turn switch): the camera flies around the Moon under the
 * Sun, Earth and stars, so the lighting on the ground never changes with a drag (only the clock changes it). A drag that starts on the
 * Moon grabs it (the point under the finger stays under it, so the Moon seems to turn in the hand); one that starts over the sky turns
 * the camera about the Moon in screen axes at the rate a grab of the disc's centre would (skyDragGain), so both feel the same. It carries
 * on with inertia after a fast release. Close to the ground the same grab flies over the surface. The wheel, a pinch and the + and - keys zoom toward the centre of the view (never the cursor, so the Moon does not turn); two fingers moving together,
 * Shift-drag and a right drag tilt toward the horizon (only near the ground); a double tap or double click flies to the
 * point and halves the altitude. No handler settles the camera or stops a journey by itself: a gesture takes the
 * camera over from where it is (`CameraRig.takeOver`), and main.ts stops whatever script was running.
 */

export interface ControlHooks {
  /** The camera moved: coarse frames now, a refine at rest. */
  moved(): void
  /** The visitor moved the camera by hand with a free-flight key (see `isFlyKey`). */
  manual?(): void
  /** What zoom-to-cursor and double tap need: the ephemeris of the frame and the canvas's width over height. */
  context(): { e: Ephemeris; aspect: number }
  /** Home (the H key, Escape with nothing open). */
  home(): void
  /** Escape: closes what is open (a sheet, the notes), else goes Home. */
  escape(): void
  /** Sky drags at the grab's rate (default); false: the older damped rate (`?skydrag=damped`). */
  skyDragMatch?(): boolean
  /** Rotate the Moon's body under the fixed camera and lamp for a drag that starts on its disc. */
  turnMoon?(cameraTurn: import('./grab').Rotation, now: number): void
  /** Turn the Moon by the finger's screen travel (CSS px): sideways spins it about its north axis, vertical tilts it. A drag that starts on the disc stays a turn to the end (no hand-off to the camera orbit, which rolled the view). */
  turnMoonBy?(dxCss: number, dyCss: number, now: number): void
  stopMoonTurn?(now: number, phase: 'down' | 'cancel' | 'release'): void
  /** The clock to now (the N key). */
  now(): void
  /** The provenance notes (the I key). */
  notes(): void
  /** Share (Shift+S; plain S flies back). */
  share(): void
  /** Steps the time slider by one tick, -1 or +1 (the [ and ] keys). */
  timeStep(dir: -1 | 1): void
  /** A fly-to ends here (double tap): main hands the pose to the rig's glide, or to the planner. */
  flyTo(nx: number, ny: number): void
  /** Keys that belong to other features (the pins' 1 to 8, the eclipse player's Space). Return true when handled. */
  extraKey?(e: KeyboardEvent): boolean
  /** Diagnostic count only; it is never rendered. */
  pointerCount?(count: number): void
}

/** A press that travels less than this (CSS px) and ends within TAP_MS is a tap. */
export const DRAG_START_PX = POINTER_DRAG_START_PX
/** The free-flight keys (W A S D forward/back/sidestep, Q E turn, R north up); a capital S is Share, not flight. */
export function isFlyKey(e: { key: string; shiftKey?: boolean }): boolean {
  return ['w', 'W', 'a', 'A', 's', 'd', 'D', 'q', 'Q', 'e', 'E', 'r', 'R'].includes(e.key)
}
/** Keys that do one thing per press; arrows, + and -, W A S D, Q E and the time-step brackets legitimately repeat while held. */
export function isOneShotKey(e: { key: string; shiftKey?: boolean }): boolean {
  if (e.key === 'S') return true
  if (e.key.length === 1 && e.key >= '1' && e.key <= '9') return true
  return ['h', 'H', 'n', 'N', 'i', 'I', 'r', 'R', 'c', 'C'].includes(e.key)
}
const TAP_MOVE_PX = 6
const TAP_MS = 300
/** Two taps within this time and distance are a double tap. */
const DOUBLE_MS = 350
const DOUBLE_PX = 30
/** One arrow-key press turns the Moon by the angle this many CSS px span. */
const KEY_ORBIT_PX = 14
/** One W, S, A or D key event flies this many CSS px of drag-equivalent travel (a held key repeats); Q and E turn this many degrees. */
const FLY_KEY_PX = 14
const FLY_KEY_TURN_DEG = 2.5
/** A grab that repeatedly achieves less than this share of a spin step is stuck on a constrained view. */
const GRAB_SPIN_HANDOFF_RATIO = 0.05
const GRAB_SPIN_HANDOFF_STEPS = 3

export function attachControls(canvas: HTMLCanvasElement, rig: CameraRig, hooks: ControlHooks): () => void {
  const pointerState = new PointerState()
  const { pointers } = pointerState
  const doc = typeof document === 'undefined' ? null : document
  const overlayPointers = new Map<number, { x: number; y: number; target: HTMLElement; pointerType: string; buttons: number; shiftKey: boolean }>()
  let lastTap: { x: number; y: number; t: number } | null = null
  let two = newTwoFingerState()
  let twisting = newTwistState()
  // Pinch samples advance on every event for responsive zoom. Tilt keeps a
  // separate accumulated delta so alternating pointer events still compare
  // motion from both fingers over the same interval.
  /** The one-finger drag began on the Moon's disc (grab it) or over the sky (turn the view). */
  let onMoon = false
  let weakGrabSteps = 0
  let spinForGesture = false
  /**
   * The finger left on the glass after a two-finger tilt does nothing until it lifts (owner 2026-10-31: the tilt was "zappy"): the fingers of a
   * tilt rarely lift together, and the last one used to start an orbit for the few pixels it still moved.
   */
  let afterTilt = false
  let wheelFrame = 0, wheelTarget = 0, wheelApplied = 0, wheelTime = 0
  const cancelWheelZoom = (): void => {
    if (wheelFrame) cancelAnimationFrame(wheelFrame)
    wheelFrame = 0; wheelTarget = 0; wheelApplied = 0; wheelTime = 0
  }
  const queueZoomLogDelta = (delta: number): void => {
    if (rig.mode !== 'fly' || !Number.isFinite(delta) || delta === 0) return
    const now = performance.now()
    wheelTarget = Math.max(-Math.LN2 * 4, Math.min(Math.LN2 * 4, wheelTarget + delta))
    rig.takeOver(now)
    rig.stopInertia()
    if (!wheelFrame) {
      wheelTime = now
      const tick = (t: number): void => {
        wheelFrame = 0
        const dt = Math.max(0, Math.min(64, t - wheelTime))
        wheelTime = t
        const remaining = wheelTarget - wheelApplied
        const step = Math.abs(remaining) < 0.0005 ? remaining : remaining * (1 - Math.exp(-dt / 55))
        if (step !== 0) {
          wheelApplied += step
          const { e: frameEphemeris, aspect: frameAspect } = hooks.context()
          rig.zoomCentre(Math.exp(step), frameEphemeris, frameAspect, t)
          hooks.moved()
        }
        if (Math.abs(wheelTarget - wheelApplied) >= 0.0005) wheelFrame = requestAnimationFrame(tick)
        else { wheelApplied = wheelTarget; wheelTarget = 0; wheelApplied = 0 }
      }
      wheelFrame = requestAnimationFrame(tick)
    }
  }

  /** A point of the canvas as NDC (x right, y up). */
  const ndc = (cx: number, cy: number): { nx: number; ny: number } => {
    const r = canvas.getBoundingClientRect()
    return { nx: ((cx - r.left) / Math.max(1, r.width)) * 2 - 1, ny: 1 - ((cy - r.top) / Math.max(1, r.height)) * 2 }
  }

  const forwardPointer = (type: string, source: PointerEvent | { pointerId: number; clientX: number; clientY: number; pointerType?: string; buttons?: number; shiftKey?: boolean }): void => {
    const init = { pointerId: source.pointerId, clientX: source.clientX, clientY: source.clientY,
      pointerType: source.pointerType ?? 'touch', buttons: source.buttons ?? 1, shiftKey: source.shiftKey ?? false }
    let forwarded: Event
    if (typeof PointerEvent !== 'undefined') forwarded = new PointerEvent(type, { ...init, bubbles: true, cancelable: true })
    else forwarded = Object.assign(new Event(type, { bubbles: true, cancelable: true }), init)
    canvas.dispatchEvent(forwarded)
  }

  const suppressFollowingClick = (pointerId: number): void => {
    if (!doc) return
    const blocker = (event: Event): void => {
      const click = event as MouseEvent & { pointerId?: number }
      if (click.pointerId !== pointerId) return
      event.preventDefault()
      event.stopImmediatePropagation()
      doc.removeEventListener('click', blocker, true)
    }
    doc.addEventListener('click', blocker, true)
    setTimeout(() => doc.removeEventListener('click', blocker, true), 500)
  }

  const promoteOverlayPointer = (id: number, current?: PointerEvent): void => {
    const point = overlayPointers.get(id)
    if (!point) return
    overlayPointers.delete(id)
    forwardPointer('pointerdown', { pointerId: id, clientX: point.x, clientY: point.y,
      pointerType: point.pointerType, buttons: point.buttons, shiftKey: point.shiftKey })
    if (current) forwardPointer('pointermove', current)
  }

  /** UI the camera never takes a press from, even as a second finger of a pinch: fields, the bar and its sheets (the viewpoints strip scrolls under a drag), the panorama, dialogs, anything marked data-no-drag. */
  const PROTECTED_UI = 'input, textarea, select, [contenteditable="true"], .bar, .dock, .ml-search, .ml-search-result, .panorama, [role="dialog"], [data-no-drag]'
  const protectedUi = (target: EventTarget | null): boolean => typeof Element !== 'undefined' && target instanceof Element && !!target.closest(PROTECTED_UI)
  const eligibleOverlay = (target: EventTarget | null): HTMLElement | null => {
    if (typeof Element === 'undefined' || !(target instanceof Element)) return null
    const control = target.closest<HTMLElement>('.pin, .ml, [data-pass-drag]')
    if (!control || protectedUi(control)) return null
    return control
  }

  // Pins and labels sit above the canvas. Keep a press there as a normal click
  // until it crosses the drag threshold, then replay it into the canvas gesture handlers.
  const overlayDown = (event: Event): void => {
    const e = event as PointerEvent
    // Protected UI first: a press there is never forwarded, whatever the canvas is doing.
    if (protectedUi(e.target)) return
    const target = eligibleOverlay(e.target)
    if (!target) {
      // A canvas second finger joins a pending overlay press as a pinch.
      if (pointers.size || overlayPointers.size) {
        for (const id of [...overlayPointers.keys()]) promoteOverlayPointer(id)
        if (!canvas.contains(e.target as Node)) {
          forwardPointer('pointerdown', e)
          try { canvas.setPointerCapture(e.pointerId) } catch { /* synthetic pointer in a test harness */ }
          e.preventDefault()
        }
      }
      return
    }
    const activeGesture = pointers.size > 0 || overlayPointers.size > 0
    if (activeGesture) {
      for (const id of [...overlayPointers.keys()]) promoteOverlayPointer(id)
      forwardPointer('pointerdown', e)
      try { canvas.setPointerCapture(e.pointerId) } catch { /* synthetic pointer in a test harness */ }
      e.preventDefault()
      return
    }
    overlayPointers.set(e.pointerId, { x: e.clientX, y: e.clientY, target, pointerType: e.pointerType, buttons: e.buttons, shiftKey: e.shiftKey })
  }
  const overlayMove = (event: Event): void => {
    const e = event as PointerEvent
    const start = overlayPointers.get(e.pointerId)
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_START_PX) return
    promoteOverlayPointer(e.pointerId, e)
    suppressFollowingClick(e.pointerId)
  }
  const overlayEnd = (event: Event): void => { overlayPointers.delete((event as PointerEvent).pointerId) }
  if (doc) {
    doc.addEventListener('pointerdown', overlayDown, true)
    doc.addEventListener('pointermove', overlayMove, true)
    doc.addEventListener('pointerup', overlayEnd, true)
    doc.addEventListener('pointercancel', overlayEnd, true)
  }

  canvas.addEventListener('pointerdown', (e) => {
    for (const id of [...overlayPointers.keys()]) promoteOverlayPointer(id)
    cancelWheelZoom()
    const purged = pointerState.down(e.pointerId, e.clientX, e.clientY, performance.now(), (id) => {
      try { return canvas.hasPointerCapture(id) } catch { return false }
    })
    for (const id of purged) try { canvas.releasePointerCapture(id) } catch { /* already released, or a synthetic pointer */ }
    hooks.pointerCount?.(pointers.size)
    two = newTwoFingerState()
    twisting = newTwistState()
    // A new finger starts a new gesture: a lock left by an earlier tilt ends (a second finger back down tilts again).
    afterTilt = false
    if (pointers.size === 1) {
      weakGrabSteps = 0
      spinForGesture = false
      const c = ndc(e.clientX, e.clientY)
      const { e: eph, aspect } = hooks.context()
      onMoon = rig.pickMoon(c.nx, c.ny, eph, aspect, performance.now()) !== null
    }
    else onMoon = false
    // A hand on the Moon stops it: any fly-to and any coasting end here.
    const downAt = performance.now()
    rig.takeOver(downAt)
    rig.stopInertia()
    hooks.stopMoonTurn?.(downAt, 'down')
    rig.dragging = true
    try { canvas.setPointerCapture(e.pointerId) } catch { /* a synthetic pointer (a test harness) has nothing to capture */ }
  })

  canvas.addEventListener('pointermove', (e) => {
    const moved = pointerState.move(e.pointerId, e.clientX, e.clientY, performance.now())
    if (!moved) return
    const { prev } = moved
    const cur = { x: e.clientX, y: e.clientY }
    // Keep the original grab point until a deliberate drag begins. Tiny
    // pointer jitter must not change either the camera or the render quality.
    if (cur.x === prev.x && cur.y === prev.y) return
    const now = performance.now()
    if (pointerState.pointers.size === 1 && !moved.started && !pointerState.dragStarted) return
    if (rig.mode !== 'fly' || rig.frozen) return
    rig.lastInputAt = now
    if (pointers.size >= 2) {
      let changed = false
      // Pointer events arrive one finger at a time. Apply each update against the last pair sample so a single moving
      // finger can zoom immediately; waiting for both IDs made ordinary pinches feel intermittent.
      const now2 = [...pointers.entries()].slice(0, 2)
      if (pointerState.pairPrev && pointerState.pairPrev.size >= 2) {
        const [[ia, a], [ib, b]] = now2
        const pa = pointerState.pairPrev.get(ia), pb = pointerState.pairPrev.get(ib)
        if (pa && pb) {
          const step = twoFingerStep(pa, pb, a, b, two)
          if (step.zoom !== 1) {
            const { e: eph, aspect } = hooks.context()
            rig.zoomCentre(step.zoom, eph, aspect, now)
            changed = true
          }
          const spread = Math.hypot(a.x - b.x, a.y - b.y)
          if (!two.tilting && spread >= TWIST_MIN_SPREAD_PX) {
            const d0 = Math.hypot(pa.x - pb.x, pa.y - pb.y)
            const roll = twistStep(twisting, twistDeg(pa, pb, a, b), d0 > 0 ? spread / d0 : 1)
            if (roll) { const { e: eph, aspect } = hooks.context(); rig.twist(roll, eph, aspect, now); changed = true }
          }
          if (step.tilt) { rig.tilt(step.tilt, Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight)), now); changed = true }
        }
        pointerState.pairPrev = new Map(now2.map(([id, v]) => [id, { x: v.x, y: v.y }]))
      }
      if (changed) hooks.moved()
      return
    }
    if (afterTilt) return
    const shortCss = Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight))
    // Shift (or the right button) and drag: tilt toward the horizon instead of turning the Moon.
    if (e.shiftKey || (e.buttons & 2)) {
      rig.tilt(cur.y - prev.y, shortCss, now)
      hooks.moved()
      return
    }
    const { e: eph, aspect } = hooks.context()
    const a = ndc(prev.x, prev.y), b = ndc(cur.x, cur.y)
    let grabbed = false
    if (onMoon && hooks.turnMoonBy) {
      hooks.turnMoonBy(cur.x - prev.x, cur.y - prev.y, now)
      hooks.moved()
      return
    }
    if (onMoon && !spinForGesture) {
      const rotation = rig.grabRotation(a, b, eph, aspect, now)
      grabbed = rotation !== null
      if (grabbed) {
        const movedRad = rotation!.angle
        if (hooks.turnMoon) hooks.turnMoon(rotation!, now)
        else rig.grab(a, b, eph, aspect, now)
        // Measured against what the sky drag that takes over would do (with its gain), so the hand-off threshold means the same at every height.
        const alt = rig.pose.dist - 1 - rig.groundAt(rig.pose.lon, rig.pose.lat)
        const spinRad = Math.min(MAX_GESTURE_STEP_RAD,
          Math.hypot(cur.x - prev.x, cur.y - prev.y) * spinRadiansPerPixel(alt, rig.fovDeg, shortCss)
          * ((hooks.skyDragMatch?.() ?? true) ? skyDragGain(alt) : 1))
        if (spinRad > 0 && movedRad < spinRad * GRAB_SPIN_HANDOFF_RATIO) weakGrabSteps++
        else weakGrabSteps = 0
        if (weakGrabSteps >= GRAB_SPIN_HANDOFF_STEPS) spinForGesture = true
      }
    }
    if (!grabbed || spinForGesture) {
      // Over the sky (or a grab that left the disc): the Moon moves with the finger as fast as a grab of the disc's centre would move it.
      const gain = (hooks.skyDragMatch?.() ?? true) ? skyDragGain(rig.pose.dist - 1 - rig.groundAt(rig.pose.lon, rig.pose.lat)) : 1
      rig.spin(cur.x - prev.x, cur.y - prev.y, shortCss, eph, aspect, now, gain)
    }
    hooks.moved()
  })

  for (const type of ['pointerup', 'pointercancel'] as const) {
    canvas.addEventListener(type, (e) => {
      const tapDown = pointerState.downAt
      const tapTravelled = pointerState.travelled
      const tapEligible = pointerState.tapEligible
      const { had, remaining } = pointerState.remove(e.pointerId, performance.now())
      const now = performance.now()
      if (type === 'pointercancel') hooks.stopMoonTurn?.(now, 'cancel')
      hooks.pointerCount?.(pointers.size)
      if (remaining && two.mode === 'tilt') afterTilt = true
      two = newTwoFingerState()
      twisting = newTwistState()
      if (remaining) {
        weakGrabSteps = 0
        spinForGesture = false
        const c = ndc(remaining.x, remaining.y)
        const { e: eph, aspect } = hooks.context()
        onMoon = rig.pickMoon(c.nx, c.ny, eph, aspect, performance.now()) !== null
      } else onMoon = false
      if (pointers.size === 0) {
        rig.dragging = false
        if (type === 'pointercancel') rig.abandonGesture()
        else { hooks.stopMoonTurn?.(now, 'release'); rig.release(now) }
        // A quick press that hardly moved is a tap; two of them close together fly to the point.
        if (had && type === 'pointerup' && tapEligible && tapDown && tapTravelled < TAP_MOVE_PX && now - tapDown.t < TAP_MS) {
          const here = { x: e.clientX, y: e.clientY, t: now }
          if (lastTap && now - lastTap.t < DOUBLE_MS && Math.hypot(here.x - lastTap.x, here.y - lastTap.y) < DOUBLE_PX) {
            lastTap = null
            const p = ndc(here.x, here.y)
            hooks.flyTo(p.nx, p.ny)
          } else lastTap = here
        }
      }
    })
  }

  canvas.addEventListener('lostpointercapture', (e) => {
    const { had } = pointerState.remove(e.pointerId, performance.now())
    hooks.pointerCount?.(pointers.size)
    if (!had) return
    hooks.stopMoonTurn?.(performance.now(), 'cancel')
    if (pointers.size === 1 && two.mode === 'tilt') afterTilt = true
    two = newTwoFingerState(); twisting = newTwistState()
    if (pointers.size === 0) {
      rig.dragging = false
      rig.abandonGesture()
    } else if (pointers.size === 1) {
      weakGrabSteps = 0
      spinForGesture = false
      const remaining = [...pointers.values()][0]
      const c = ndc(remaining.x, remaining.y)
      const { e: eph, aspect } = hooks.context()
      onMoon = rig.pickMoon(c.nx, c.ny, eph, aspect, performance.now()) !== null
    }
  })

  const clearPointers = (): void => {
    const hadGesture = pointers.size > 0 || overlayPointers.size > 0 || rig.dragging
    overlayPointers.clear()
    if (hadGesture) {
      pointerState.clear()
      hooks.pointerCount?.(0)
      two = newTwoFingerState(); twisting = newTwistState()
      rig.dragging = false
      hooks.stopMoonTurn?.(performance.now(), 'cancel')
      rig.release(performance.now())
      onMoon = false
      weakGrabSteps = 0
      spinForGesture = false
      afterTilt = false
    }
  }
  window.addEventListener('blur', clearPointers)
  // A page backgrounded mid-gesture gets no up or cancel on Android, and may come back without a visibilitychange to hidden (a freeze, the back-forward cache):
  // clear on every way out and on the way back in, so no finger from before the switch survives it.
  window.addEventListener('pagehide', clearPointers)
  window.addEventListener('pageshow', clearPointers)
  if (doc) {
    doc.addEventListener('visibilitychange', () => clearPointers())
    doc.addEventListener('freeze', clearPointers)
    doc.addEventListener('resume', clearPointers)
  }
  // A finger that lifts outside the canvas ends only itself: an unrelated finger on the bar or a sheet must not drop a running pinch.
  for (const type of ['pointerup', 'pointercancel'] as const) window.addEventListener(type, (e) => {
    const id = (e as PointerEvent).pointerId
    if (canvas.contains(e.target as Node) || overlayPointers.has(id) || !pointers.has(id)) return
    if (type === 'pointercancel') hooks.stopMoonTurn?.(performance.now(), 'cancel')
    pointerState.remove(id, performance.now())
    hooks.pointerCount?.(pointers.size)
    if (pointers.size === 1 && two.mode === 'tilt') afterTilt = true
    two = newTwoFingerState(); twisting = newTwistState()
    if (pointers.size === 0) {
      rig.dragging = false
      if (type === 'pointercancel') rig.abandonGesture(); else { hooks.stopMoonTurn?.(performance.now(), 'release'); rig.release(performance.now()) }
      onMoon = false
    }
  })

  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    // Ctrl+wheel was already caught at document level, including when it began on the canvas.
    if (e.ctrlKey) return
    queueZoomLogDelta(wheelZoomLogDelta(e))
  }, { passive: false })
  let gestureScale = 1
  if (doc) {
    doc.addEventListener('wheel', (event) => {
      const e = event as WheelEvent
      if (!e.ctrlKey) return
      e.preventDefault()
      queueZoomLogDelta(wheelZoomLogDelta(e))
    }, { capture: true, passive: false })
    doc.addEventListener('gesturestart', (event) => {
      event.preventDefault()
      gestureScale = (event as Event & { scale?: number }).scale ?? 1
    }, { capture: true, passive: false })
    doc.addEventListener('gesturechange', (event) => {
      event.preventDefault()
      const next = (event as Event & { scale?: number }).scale ?? gestureScale
      queueZoomLogDelta(safariPinchLogDelta(gestureScale, next))
      gestureScale = next
    }, { capture: true, passive: false })
    doc.addEventListener('gestureend', (event) => { event.preventDefault(); gestureScale = 1 }, { capture: true, passive: false })
    doc.addEventListener('touchstart', (event) => {
      if (shouldPreventTouchPageZoom((event as TouchEvent).touches.length)) event.preventDefault()
    }, { capture: true, passive: false })
  }

  window.addEventListener('keydown', (e) => {
    const t = e.target
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // Escape closes what is open even while a slider (the time slider, the eclipse scrubber, the star boost) has focus; only a field that is typed into keeps it.
    if (e.key === 'Escape' && escapeReachesPage(t)) { cancelWheelZoom(); hooks.escape(); return }
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return
    // A held one-shot key (Home, Now, notes, share, north up, the pins, touch controls) acts once, not at the OS key-repeat rate.
    if (e.repeat && isOneShotKey(e)) { e.preventDefault(); return }
    if (hooks.extraKey?.(e)) { cancelWheelZoom(); e.preventDefault(); return }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', 'h', 'H', 'n', 'N', '[', ']', 'w', 'W', 'a', 'A', 's', 'd', 'D', 'q', 'Q', 'e', 'E', 'r', 'R'].includes(e.key)) cancelWheelZoom()
    if (isFlyKey(e)) hooks.manual?.()
    const now = performance.now()
    const shortCss = Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight))
    const arrow = (dx: number, dy: number): void => {
      e.preventDefault()
      rig.takeOver(now)
      if (e.shiftKey && dx === 0) rig.tilt(dy * KEY_ORBIT_PX, shortCss, now)
      else { const { e: eph, aspect } = hooks.context(); rig.spin(dx * KEY_ORBIT_PX, dy * KEY_ORBIT_PX, shortCss, eph, aspect, now) }
      hooks.moved()
    }
    // Free-flying camera keys (Google Earth's street-level convention): W and S fly forward and back over the surface, A and D
    // sidestep, Q and E turn the heading, R points north up again. They repeat while held. Shift+left/right turns too (as in Google Earth): right yaws the view right (heading grows).
    const fly = (kind: 'forward' | 'side' | 'turn', sign: 1 | -1): void => {
      e.preventDefault()
      cancelWheelZoom()
      rig.takeOver(now)
      const { e: eph, aspect } = hooks.context()
      if (kind === 'forward') rig.moveForward(sign * FLY_KEY_PX, shortCss, eph, aspect, now)
      else if (kind === 'side') rig.moveSideways(sign * FLY_KEY_PX, shortCss, eph, aspect, now)
      else rig.turnHeading(sign * FLY_KEY_TURN_DEG, now)
      hooks.moved()
    }
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { fly('turn', e.key === 'ArrowLeft' ? -1 : 1); return }
    switch (e.key) {
      case 'w': case 'W': fly('forward', 1); return
      case 's': if (!e.shiftKey) { fly('forward', -1); return } break
      case 'a': case 'A': fly('side', -1); return
      case 'd': case 'D': fly('side', 1); return
      case 'q': case 'Q': fly('turn', -1); return
      case 'e': case 'E': fly('turn', 1); return
      case 'r': case 'R': {
        e.preventDefault()
        rig.takeOver(now)
        const { e: eph, aspect } = hooks.context()
        rig.resetNorth(eph, aspect, now)
        hooks.moved()
        return
      }
      default: break
    }
    switch (e.key) {
      case 'ArrowLeft': arrow(-1, 0); return
      case 'ArrowRight': arrow(1, 0); return
      case 'ArrowUp': arrow(0, -1); return
      case 'ArrowDown': arrow(0, 1); return
      case '+': case '=': case '-': case '_': {
        e.preventDefault()
        const { e: eph, aspect } = hooks.context()
        rig.takeOver(now)
        rig.zoomCentre(e.key === '+' || e.key === '=' ? 0.9 : 1 / 0.9, eph, aspect, now)
        hooks.moved()
        return
      }
      case 'h': case 'H': hooks.home(); return
      case 'n': case 'N': hooks.now(); return
      case 'i': case 'I': hooks.notes(); return
      case 'S': hooks.share(); return
      case '[': hooks.timeStep(-1); return
      case ']': hooks.timeStep(1); return
    }
  })

  // main.ts calls this on every scripted move: it only stops the wheel's eased tail. The listeners above stay for the page's life.
  return cancelWheelZoom
}

/** Escape belongs to the page unless the focused element is one that takes typed text (or a picker that Escape cancels). */
export function escapeReachesPage(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; type?: string } | null
  const tag = el?.tagName?.toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return false
  if (tag === 'INPUT') return ['range', 'checkbox', 'radio', 'button'].includes(String(el?.type))
  return true
}
