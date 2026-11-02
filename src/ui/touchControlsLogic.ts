// The pure parts of the on-screen controls (no DOM, no CSS), so a test can import them.

export const FRAME_STEP_FRACTION = 0.15
export const FRAME_REPEAT_PER_S = 0.75

export type SideDirection = 'up' | 'down' | 'counterclockwise' | 'clockwise' | 'forward' | 'back'

/**
 * One side-control step, signed so the view follows the direction shown by its arrow. Up tilts the camera toward the horizon (the
 * way Google Earth's tilt-up does), down back toward straight down. Forward and back are CSS px of drag-equivalent travel along the
 * ground (CameraRig.moveForward). Rotation is the compass heading: counter-clockwise turns the picture that way.
 */
export function sideControlStep(direction: SideDirection, shortCss: number, fovDeg: number): { tiltPx: number; rollDeg: number; movePx: number } {
  const px = Math.max(1, shortCss) * FRAME_STEP_FRACTION
  const deg = Math.max(0, fovDeg) * FRAME_STEP_FRACTION
  switch (direction) {
    case 'up': return { tiltPx: px, rollDeg: 0, movePx: 0 }
    case 'down': return { tiltPx: -px, rollDeg: 0, movePx: 0 }
    // CameraRig.turnHeading turns the picture the way a counter-clockwise gesture on screen would.
    case 'counterclockwise': return { tiltPx: 0, rollDeg: deg, movePx: 0 }
    case 'clockwise': return { tiltPx: 0, rollDeg: -deg, movePx: 0 }
    case 'forward': return { tiltPx: 0, rollDeg: 0, movePx: px }
    case 'back': return { tiltPx: 0, rollDeg: 0, movePx: -px }
  }
}

/** The gesture help (now in the Credits panel, no longer under the controls): what the moves are with the hand or the mouse in use. */
export function hintFor(coarse: boolean): string {
  return coarse
    ? 'Two-finger twist to rotate · two fingers up or down to tilt · drag the Moon to turn it or the sky to fly around it (the shadows stay: only the clock moves the light) · pinch to zoom · the on-screen controls (round button, bottom right) fly the camera: forward and back, turn, zoom'
    : 'Shift-drag or right-drag to tilt · drag the Moon to turn it or the sky to fly around it (the shadows stay: only the clock moves the light) · scroll to zoom · W and S fly forward and back over the surface, A and D sidestep, Q and E turn, Shift with the left and right arrows turns too, Shift with up and down tilts, R points north again (the arrow keys still turn the Moon, + and - zoom, C shows the on-screen controls)'
}

/** Whether the controls start open by the visitor's own say: ?controls=1 or the remembered choice; else closed (padOpenFor adds the desktop rule). */
export function initiallyOpen(search: string, stored: string | null): boolean {
  return padChoice(search, stored) ?? false
}

/** The visitor's own say on the pad: ?controls=1 or 0 beats the remembered toggle; null when neither was given. */
export function padChoice(search: string, stored: string | null): boolean | null {
  const q = new URLSearchParams(search).get('controls')
  if (q === '1') return true
  if (q === '0') return false
  return stored === '1' ? true : stored === '0' ? false : null
}

/**
 * Whether the pad is open: the visitor's choice when there is one; else on a desktop (a fine pointer that hovers, the pad fitting the row) it follows
 * manual navigation, open while there is no viewpoint or the visitor has moved off one, closed at a viewpoint (owner review 2026-10-23, #11 and #12:
 * the tilt pair and the stick are the movement controls, and they are there when the visitor is moving by hand). A phone keeps the toggle and starts closed.
 */
export function padOpenFor(choice: boolean | null, desktop: boolean, manual: boolean): boolean {
  return choice ?? (desktop && manual)
}

/** What each side button is, in plain words: the tooltip and the accessible name. Zoom changes the distance; Look up and down only the view angle; Forward and Back fly over the surface. */
export const BUTTON_LABELS = {
  zoomIn: 'Zoom in (toward the centre of the view)',
  zoomOut: 'Zoom out (away from the centre of the view)',
  lookUp: 'Look up (tilt the view toward the horizon)',
  lookDown: 'Look down (tilt the view back toward the ground)',
} as const
/** The words in the tilt pair's halves (shown in the More sheet only, under 560 px). */
export const TILT_WORDS = { up: 'Look up', down: 'Look down' } as const

/** One click of Look up or down tilts by one frame step (FRAME_STEP_FRACTION of the view's angle, 4.5 degrees at a 30 degree lens); held, it carries on at TILT_HOLD_UNITS_PER_S steps a second (0.6 of the view's angle). */
export const TILT_CLICK_UNITS = 1
export const TILT_HOLD_UNITS_PER_S = 4

/** One click of + or - zooms this many octaves (a factor of 2 per octave); held, the zoom carries on at ZOOM_HOLD_OCTAVES_PER_S. */
export const ZOOM_CLICK_OCTAVES = 0.35
export const ZOOM_HOLD_OCTAVES_PER_S = 1.2
/**
 * A side button follows its target with a critically damped THIRD-order response (three equal poles at -BUTTON_GLIDE_OMEGA_PER_S), and a
 * held button starts to repeat after the delay. Why third order and not second: a second-order follower starts a press at its largest
 * acceleration (the speed is continuous but climbs to 48 % of its peak within the first 60 Hz frame); the third order starts at zero
 * acceleration too, so the first frame is 14 % of the peak and no frame changes the speed by more than 26 % of it (the best a glide of
 * this length can do is about 28 %). A tap settles to 95 % in 0.33 s (the old exponential ease: 0.36 s). The hold delay is short on purpose
 * (0.1 s, about a tap's length): the click's glide then runs into the held rate and the speed never falls below it on the way.
 */
export const BUTTON_GLIDE_OMEGA_PER_S = 19
export const BUTTON_HOLD_DELAY_S = 0.1
/** The glide counts as finished (and snaps onto its target) inside this distance and speed: far below one pixel of any button's motion. */
const GLIDE_REST_UNITS = 1e-4
const GLIDE_REST_UNITS_PER_S = 1e-3

export interface GlideState { x: number; v: number; a: number }
/**
 * One exact step of the triple-pole follower (the third derivative of x is w^3 (T - x) - 3 w^2 x' - 3 w x'') whose target moves at the
 * constant speed `c` during `dt` (c = 0: a fixed target; `t0` is the target at the start). Closed form, so the result does not depend on
 * how the time is cut into frames. With z = x - T + 3c/w the error obeys the homogeneous equation, which keeps a moving target exact:
 * z(t) = (c0 + c1 t + c2 t^2) e^(-w t).
 */
export function glideStep(s: GlideState, t0: number, c: number, w: number, dt: number): GlideState {
  if (!(dt > 0)) return s
  const k = 3 * c / w
  const c0 = s.x - t0 + k
  const c1 = (s.v - c) + w * c0
  const c2 = (s.a + 2 * w * c1 - w * w * c0) / 2
  const e = Math.exp(-w * dt)
  const p = c0 + (c1 + c2 * dt) * dt
  const p1 = c1 + 2 * c2 * dt
  return { x: t0 + c * dt + p * e - k, v: c + (p1 - w * p) * e, a: (2 * c2 - 2 * w * p1 + w * w * p) * e }
}

/**
 * A side button's motion: a click moves the target by a fixed amount, a held button keeps moving the target at a steady rate, and the
 * camera follows the target with the glide above. A press therefore starts from zero speed and zero acceleration, the speed rises and falls
 * in one S-shaped glide that ends at zero speed on the click amount, a held button's speed ramps up smoothly to its rate with no jump or dip,
 * and a released one eases to a stop. Units are the caller's (octaves for zoom, one frame step for tilt). Frame-rate independent.
 */
export class EasedButton {
  private target = 0
  private s: GlideState = { x: 0, v: 0, a: 0 }
  private heldFor = -1
  /** The button went down: `units` is added to the target (the camera follows from rest). */
  press(units: number): void { this.target += units; this.heldFor = 0 }
  release(): void { this.heldFor = -1 }
  /** Drop what is left of the glide (a scripted move started over its tail): no more units, at rest. */
  stop(): void { this.heldFor = -1; this.target = this.s.x; this.s.v = 0; this.s.a = 0 }
  /** Anything left to apply, or the button still down. */
  get active(): boolean { return this.heldFor >= 0 || Math.abs(this.target - this.s.x) > GLIDE_REST_UNITS || Math.abs(this.s.v) > GLIDE_REST_UNITS_PER_S }
  /** The speed now (units per second), for tests and measurements. */
  get speed(): number { return this.s.v }
  /** Advance by `dtS`; `repeatPerS` is the held rate (units per second). Returns the units to apply this frame. */
  tick(dtS: number, repeatPerS: number): number {
    const dt = Math.max(0, Math.min(0.1, dtS))
    const w = BUTTON_GLIDE_OMEGA_PER_S
    let s = this.s
    let t = this.target
    // The hold starts at BUTTON_HOLD_DELAY_S of held time, possibly inside this frame: a fixed target before it, a moving one after.
    let still = dt, moving = 0
    if (this.heldFor >= 0) {
      const h0 = this.heldFor
      this.heldFor = h0 + dt
      moving = Math.max(0, Math.min(dt, h0 + dt - BUTTON_HOLD_DELAY_S))
      still = dt - moving
    }
    if (still > 0) s = glideStep(s, t, 0, w, still)
    if (moving > 0) { s = glideStep(s, t, repeatPerS, w, moving); t += repeatPerS * moving }
    this.target = t
    const out = s.x - this.s.x
    if (this.heldFor < 0 && Math.abs(t - s.x) < GLIDE_REST_UNITS && Math.abs(s.v) < GLIDE_REST_UNITS_PER_S) {
      // Arrived: the last sliver (under a ten-thousandth of a unit) lands with this frame, and the follower starts over from zero.
      const rest = t - this.s.x
      this.target = 0
      this.s = { x: 0, v: 0, a: 0 }
      return rest
    }
    this.s = s
    return out
  }
}

// ---- The flight pad (stick + rail): the pure parts of the analogue stick and the pad's small rules. ----

/** Share of the stick's travel that does nothing (a resting thumb), and the curve exponent that keeps small deflections fine. */
export const STICK_DEAD_ZONE = 0.14
export const STICK_CURVE = 1.7
/** Frame steps per second at full deflection (a held rocker half runs at FRAME_REPEAT_PER_S / FRAME_STEP_FRACTION = 5). */
export const STICK_FULL_UNITS_PER_S = 7
/** A press shorter than this and no further than STICK_TAP_PX is a tap (one small step), not a push. */
export const STICK_TAP_MS = 220
export const STICK_TAP_PX = 6

export interface StickRates { x: number; y: number; magnitude: number }
/**
 * Pointer offset from the stick's centre (CSS px, screen y down) to rates in [-1, 1] (x right, y up). Inside the dead zone nothing
 * moves; beyond it the speed rises smoothly (a power curve) to 1 at the full travel `radius`, so small pushes are fine and a full push is quick.
 */
export function stickRates(dx: number, dy: number, radius: number): StickRates {
  const len = Math.hypot(dx, dy)
  const r = len / Math.max(1e-6, radius)
  const clamped = Math.min(1, r)
  if (!(clamped > STICK_DEAD_ZONE)) return { x: 0, y: 0, magnitude: 0 }
  const t = (clamped - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE)
  const magnitude = Math.pow(t, STICK_CURVE)
  return { x: (dx / len) * magnitude, y: (-dy / len) * magnitude, magnitude }
}

/** The knob's position for a pointer offset: the offset itself, held inside the travel circle. */
export function stickKnob(dx: number, dy: number, radius: number): { x: number; y: number } {
  const r = Math.hypot(dx, dy)
  if (r <= radius || r === 0) return { x: dx, y: dy }
  return { x: (dx / r) * radius, y: (dy / r) * radius }
}

/** One step of the spring that returns a released knob to the centre (underdamped a little, so it settles with a soft overshoot). */
export function springStep(pos: number, vel: number, dtS: number, stiffness = 380, damping = 26): { pos: number; vel: number } {
  let p = pos
  let v = vel
  const dt = Math.min(0.1, Math.max(0, dtS))
  const n = Math.max(1, Math.ceil(dt / 0.004))
  const h = dt / n
  for (let i = 0; i < n; i++) { v += (-stiffness * p - damping * v) * h; p += v * h }
  return { pos: p, vel: v }
}
export const springSettled = (pos: number, vel: number): boolean => Math.abs(pos) < 0.05 && Math.abs(vel) < 0.5

export type StickAxis = 'move' | 'turn' | 'tilt'
/**
 * The camera motion for one frame of a stick axis. `value` is in [-1, 1]: positive flies forward, yaws right (picture counter-clockwise), tilts up
 * toward the horizon. Built from sideControlStep so a stick and a rocker half move the view by the same amount per unit.
 */
export function stickMotion(axis: StickAxis, value: number, dtS: number, shortCss: number, fovDeg: number): { tiltPx: number; rollDeg: number; movePx: number } {
  return axisUnits(axis, value * STICK_FULL_UNITS_PER_S * Math.max(0, Math.min(0.1, dtS)), shortCss, fovDeg)
}
/**
 * `units` frame steps of a stick axis (positive: forward, right, up). Right yaws the view to the right at every tilt: the picture
 * turns counter-clockwise (CameraRig.turnHeading positive, the compass heading grows), so the turn axis uses the 'counterclockwise' step.
 * (The stick's turn axis is a yaw, not a picture roll: the old 'clockwise' step panned the view left at the horizon.)
 * One unit is the same share of the frame as one rocker press. */
export function axisUnits(axis: StickAxis, units: number, shortCss: number, fovDeg: number): { tiltPx: number; rollDeg: number; movePx: number } {
  const dir: SideDirection = axis === 'move' ? 'forward' : axis === 'turn' ? 'counterclockwise' : 'up'
  const s = sideControlStep(dir, shortCss, fovDeg)
  return { tiltPx: s.tiltPx * units, rollDeg: s.rollDeg * units, movePx: s.movePx * units }
}

/** A tap on the stick at offset (dx, dy): the direction of one small step (dominant axis), or null for a tap on the resting centre. */
export function stickTapDirection(dx: number, dy: number, radius: number): { x: -1 | 0 | 1; y: -1 | 0 | 1 } | null {
  if (Math.hypot(dx, dy) / Math.max(1e-6, radius) <= STICK_DEAD_ZONE) return null
  return Math.abs(dx) >= Math.abs(dy) ? { x: dx > 0 ? 1 : -1, y: 0 } : { x: 0, y: dy < 0 ? 1 : -1 }
}

/** Keyboard on a focused stick: the arrow keys hold the stick at full deflection while down. */
export function stickKeyDeflection(down: ReadonlySet<string>): { x: number; y: number } {
  return { x: (down.has('ArrowRight') ? 1 : 0) - (down.has('ArrowLeft') ? 1 : 0), y: (down.has('ArrowUp') ? 1 : 0) - (down.has('ArrowDown') ? 1 : 0) }
}

/** Accessible names of the pad's parts (the pad shows icons only). */
export const PAD_LABELS = {
  zoom: 'Zoom', fly: 'Fly', tilt: 'Look up or down',
  stick: 'Fly stick: push up to fly forward, down to fly back, left or right to turn. Arrow keys work too',
  open: 'On-screen controls', close: 'Close the on-screen controls',
} as const

/** The direction a stick is pushed, in degrees clockwise from straight up (for the rim arc); 0 for a centred stick. */
export function stickAngleDeg(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0
  return (Math.atan2(dx, -dy) * 180) / Math.PI
}

/** The first few opens name the three rails for a moment; this counts them (stored under moon.touchControls.labels). */
export const FIRST_OPEN_LABELS = 3
export function labelsLeft(stored: string | null): boolean {
  const n = Number.parseInt(stored ?? '0', 10)
  return !(Number.isFinite(n) && n >= FIRST_OPEN_LABELS)
}
export function nextLabelCount(stored: string | null): string {
  const n = Number.parseInt(stored ?? '0', 10)
  return String((Number.isFinite(n) && n > 0 ? n : 0) + 1)
}

/** What a caption or note publishes as --caption-h: its height plus the 8 px gap, or 0 when it is not shown. */
export function bandPx(offsetHeight: number, hidden: boolean): number {
  return hidden || !(offsetHeight > 0) ? 0 : Math.ceil(offsetHeight) + 8
}
