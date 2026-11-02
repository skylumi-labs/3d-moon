/**
 * Two fingers on the Moon: a pinch zooms, and two fingers moving together vertically tilt toward the horizon.
 *
 * The decision is made from the fingers' coherent motion since the gesture began, never from a single pointer event (events arrive
 * one finger at a time, so one event alone always looks like a spread change or a scissor):
 *  - It is judged only at a "paired" moment, when both fingers have moved since the last judgement (or one finger alone has
 *    travelled SINGLE_PX, which is never a tilt). At a paired moment the fingers are in step to within one frame.
 *  - ZOOM: the spread has moved more than max(ZOOM_MIN_PX, ZOOM_FRAC of the starting spread). From then on the gesture is a zoom
 *    until the fingers lift, whatever the centroid does. The zoom measures from the starting spread, so nothing is lost while the
 *    decision was pending, and a slow pinch accumulates.
 *  - TILT: both fingers' displacement vectors are near-parallel and similar in size (their difference under TILT_PARALLEL of the
 *    centroid's travel), the travel is mostly vertical, the centroid has travelled TILT_START_PX, and the spread is near-constant
 *    (it moved under TILT_SPREAD_PER_TRAVEL of the travel). A tilt stops being a tilt only for a clear pinch: the spread moves past
 *    tiltExitPx (the zoom threshold, or TILT_EXIT_PER_TRAVEL of the tilt's own travel when that is more, up to TILT_EXIT_MAX_PX), so the
 *    few pixels a long vertical drag drifts in spread no longer flip it into a zoom halfway (owner 2026-10-31: the tilt was "zappy").
 *    A step whose own spread change is more than TILT_STEP_SPREAD of its vertical step tilts nothing (a pinch starting inside a tilt does not
 *    tilt while it builds up to the exit), and the zoom it becomes starts from the spread at the exit, so it does not jump either.
 *  - No jump at the start (owner 2026-10-31): the travel while the decision was pending is not applied (it was, in one event); the tilt starts
 *    at the threshold at the fingers' own speed, with one constant gain, as map apps do.
 *  - Anything else (a twist, a wobble, the first few pixels) is pending and does nothing. When ambiguous, zoom wins.
 */
/** The centroid has to travel this far, clearly in parallel with a steady spread, before a tilt is confirmed (nothing is applied before: it is buffered). */
export const TILT_START_PX = 12
/** Spread change that makes a gesture a zoom: this many px or this share of the starting spread, whichever is larger. */
export const ZOOM_MIN_PX = 3
export const ZOOM_FRAC = 0.02
/** A tilt needs the spread to have moved under this share of the centroid travel, plus TILT_TREMOR_PX of tremor (kept at 0.5 px: 1.5 px let the review's drifting pinch, 160 to 164 px over 60 px of travel, tilt). */
export const TILT_SPREAD_PER_TRAVEL = 0.02
export const TILT_TREMOR_PX = 0.5
/** A tilt needs the fingers' displacement difference under this share of the centroid travel (near-parallel, similar size). */
export const TILT_PARALLEL = 0.2
/** A confirmed tilt becomes a zoom only past this share of its own travel in spread change (and at least the zoom threshold), at most TILT_EXIT_MAX_PX. */
export const TILT_EXIT_PER_TRAVEL = 0.25
export const TILT_EXIT_MAX_PX = 28
/** A confirmed tilt's step tilts only while its own spread change is at most this share of its vertical step (else it is a pinch building up). */
export const TILT_STEP_SPREAD = 0.5
/** One finger alone moving this far, the other hardly at all (under a quarter as far), is judged at once (never a tilt): a pinch with one finger. */
export const SINGLE_PX = 12
/** ... and only after this many events in a row from that finger alone (a finger one step ahead of the other is not a pinch). */
export const SINGLE_RUN = 3
/** Spread steps under this (as a log ratio) are carried to the next, not applied: hand tremor. */
export const ZOOM_DEADBAND = 0.002

export type P2 = { x: number; y: number }
export type TwoFingerMode = 'pending' | 'tilt' | 'zoom'

export interface TwoFingerState {
  mode: TwoFingerMode
  /** Mode is 'tilt' (kept for the twist check). */
  tilting: boolean
  started: boolean
  startA: P2
  startB: P2
  /** The spread when the gesture began, px. */
  spread0: number
  /** The spread the last applied zoom step ended at. */
  anchor: number
  /** Where the fingers were at the last judgement (a tilt measures its steps from here). */
  judgedA: P2
  judgedB: P2
  /** The spread when the tilt was confirmed: a spread change from here exits the tilt into a zoom. */
  tiltSpread: number
  /** The tilt's own vertical travel since it was confirmed (px), for its exit threshold. */
  tiltTravel: number
  /** The spread at the last judged tilt step. */
  tiltLastSpread: number
  movedA: boolean
  movedB: boolean
  /** Events in a row from one finger while the other stood still. */
  runA: number
  runB: number
}
export const newTwoFingerState = (): TwoFingerState => ({
  mode: 'pending', tilting: false, started: false, startA: { x: 0, y: 0 }, startB: { x: 0, y: 0 }, spread0: 0, anchor: 0,
  judgedA: { x: 0, y: 0 }, judgedB: { x: 0, y: 0 }, tiltSpread: 0, tiltTravel: 0, tiltLastSpread: 0, movedA: false, movedB: false, runA: 0, runB: 0,
})

export interface TwoFingerStep {
  /** Factor on the distance (1: none). */
  zoom: number
  /** CSS px of vertical tilt to apply (0: none). */
  tilt: number
}

const dist = (a: P2, b: P2): number => Math.hypot(a.x - b.x, a.y - b.y)

/** The spread change (px) that turns a confirmed tilt into a zoom: the zoom threshold, or a share of the tilt's own travel when more, capped. */
export function tiltExitPx(st: TwoFingerState): number {
  const base = Math.max(ZOOM_MIN_PX, ZOOM_FRAC * st.spread0)
  return Math.max(base, Math.min(TILT_EXIT_MAX_PX, TILT_EXIT_PER_TRAVEL * st.tiltTravel))
}

function zoomTo(st: TwoFingerState, spread: number): number {
  if (!(spread > 0) || !(st.anchor > 0)) return 1
  const lr = Math.log(st.anchor / spread)
  if (Math.abs(lr) < ZOOM_DEADBAND) return 1
  st.anchor = spread
  return Math.exp(lr)
}

/**
 * One pointer event: the pair as it was (prevA, prevB) and as it is now (a, b). `st` carries the whole gesture; only the first
 * call reads prevA and prevB (where the gesture began).
 */
export function twoFingerStep(prevA: P2, prevB: P2, a: P2, b: P2, st: TwoFingerState): TwoFingerStep {
  if (!st.started) {
    st.started = true
    st.startA = { ...prevA }; st.startB = { ...prevB }; st.judgedA = { ...prevA }; st.judgedB = { ...prevB }
    st.spread0 = dist(prevA, prevB); st.anchor = st.spread0
  }
  const mA = a.x !== prevA.x || a.y !== prevA.y, mB = b.x !== prevB.x || b.y !== prevB.y
  if (mA) st.movedA = true
  if (mB) st.movedB = true
  st.runA = mA && !mB ? st.runA + 1 : 0
  st.runB = mB && !mA ? st.runB + 1 : 0
  const spread = dist(a, b)
  // A zoom stays a zoom: every event applies its share at once.
  if (st.mode === 'zoom') return { zoom: zoomTo(st, spread), tilt: 0 }

  const paired = st.movedA && st.movedB
  const own = (m: P2, start: P2, other: P2, otherStart: P2): boolean => dist(m, start) >= SINGLE_PX && dist(other, otherStart) < 0.25 * dist(m, start)
  const single = !paired && ((st.runA >= SINGLE_RUN && own(a, st.startA, b, st.startB)) || (st.runB >= SINGLE_RUN && own(b, st.startB, a, st.startA)))
  // Inside a tilt the one-finger run is measured from the last judged positions (both fingers have travelled from where the gesture began).
  const singleInTilt = st.mode === 'tilt' && !paired && ((st.runA >= SINGLE_RUN && own(a, st.judgedA, b, st.judgedB)) || (st.runB >= SINGLE_RUN && own(b, st.judgedB, a, st.judgedA)))
  if (!paired && !single && !singleInTilt) return { zoom: 1, tilt: 0 }
  // A tilt that turns into a clear pinch (the spread moved past tiltExitPx from where the tilt was confirmed) is a zoom from here on. Checked at
  // paired moments and on a one-finger run (`single`): a pinch with one finger (the thumb held still) sends no events from the other. Not on any
  // lone event: with the fingers stacked vertically one finger's half of a parallel step changes the spread by the whole step.
  if (st.mode === 'tilt' && Math.abs(spread - st.tiltSpread) > tiltExitPx(st)) {
    // The zoom starts from here: what the spread moved to get past the exit is not applied in one step.
    st.mode = 'zoom'; st.tilting = false; st.anchor = spread
    return { zoom: 1, tilt: 0 }
  }
  if (paired) st.movedA = st.movedB = false

  const ds = spread - st.spread0
  // While pending, a spread change past the zoom threshold is a zoom. A confirmed tilt has its own, travel-aware exit below: this check used to
  // run for it too, from the gesture's starting spread, so 3 or 4 px of drift anywhere in a long vertical drag flipped it into a zoom (owner
  // 2026-10-31: "zappy").
  if (st.mode === 'pending' && Math.abs(ds) > Math.max(ZOOM_MIN_PX, ZOOM_FRAC * st.spread0)) {
    st.mode = 'zoom'; st.tilting = false
    return { zoom: zoomTo(st, spread), tilt: 0 }
  }
  if (!paired) return { zoom: 1, tilt: 0 }

  const dA = { x: a.x - st.startA.x, y: a.y - st.startA.y }, dB = { x: b.x - st.startB.x, y: b.y - st.startB.y }
  const cx = (dA.x + dB.x) / 2, cy = (dA.y + dB.y) / 2
  const travel = Math.hypot(cx, cy)
  if (st.mode === 'tilt') {
    // After confirmation a step is the fingers' step this way or that: a reversal tilts back at once, a pause tilts nothing. A step that is
    // mostly a spread change (a pinch building up inside the tilt) tilts nothing yet: it is held, not dropped (the judged positions stay), so
    // tremor on a slow drag only defers a step to the next event, while a pinch keeps it held until it exits to a zoom.
    const step = ((a.y - st.judgedA.y) + (b.y - st.judgedB.y)) / 2
    const dSpread = Math.abs(spread - st.tiltLastSpread)
    if (dSpread > TILT_STEP_SPREAD * Math.abs(step) + 1) return { zoom: 1, tilt: 0 }
    st.judgedA = { ...a }; st.judgedB = { ...b }; st.tiltLastSpread = spread
    st.tiltTravel += Math.abs(step)
    return { zoom: 1, tilt: step }
  }
  const parallel = Math.hypot(dA.x - dB.x, dA.y - dB.y) <= TILT_PARALLEL * travel
  const vertical = Math.abs(cy) >= 0.8 * travel
  const sameWay = dA.y * dB.y > 0
  if (travel >= TILT_START_PX && parallel && vertical && sameWay && Math.abs(ds) <= TILT_SPREAD_PER_TRAVEL * travel + TILT_TREMOR_PX) {
    st.mode = 'tilt'; st.tilting = true; st.tiltSpread = spread; st.tiltLastSpread = spread; st.tiltTravel = 0
    st.judgedA = { ...a }; st.judgedB = { ...b }
    // The travel while the classification was pending is not applied (in one event it was a jump at the start): the tilt starts here.
    return { zoom: 1, tilt: 0 }
  }
  return { zoom: 1, tilt: 0 }
}
