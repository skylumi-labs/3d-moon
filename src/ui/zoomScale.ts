/**
 * The zoom tape's maths and its fade, ported from SkyLumi's magnification tape (MagnificationArc / binocularGeometry).
 * Pure: no DOM, so scripts/zoom-tape.test.mts runs it under node.
 *
 * SkyLumi's tape reads magnification; the Moon has no field-of-view zoom (the fly field is fixed), so zooming here is
 * the camera's height above the surface, and that is what the tape reads: a logarithmic scale in metres, the
 * highest height at the top, with a fixed reading bar across the middle.
 */

/** Decades of the scale that fit the arc's length (SkyLumi's TAPE_DECADES). */
export const TAPE_DECADES = 1.6
/** Lowest and highest tick, metres: 1 m (a walker's eye height in ground mode) to 30,000 km (past the farthest orbit view, about 19,000 km up). */
export const TAPE_MIN_M = 1
export const TAPE_MAX_M = 3e7
/** The most opaque it gets (SkyLumi: "the entire thing half transparent"), and how long after the last zoom it fades out. */
export const TAPE_MAX_OPACITY = 0.88
export const TAPE_IDLE_MS = 1100
/** SkyLumi's fade curves: quick in, slow out. */
export const FADE_IN = 'opacity 180ms cubic-bezier(.2,.7,.2,1)'
export const FADE_OUT = 'opacity 900ms cubic-bezier(.4,0,.2,1)'
/** A change of log10 height smaller than this is not a zoom (SkyLumi: 1e-5). */
export const ZOOM_EPS_LOG = 1e-5

/** The tape follows the visitor's own zoom (wheel, pinch, the + and - keys and buttons) and this long after the last one; never a flight, a viewpoint move, Home or a time change. */
export const TAPE_GESTURE_TAIL_MS = 1500
export function tapeWakeAllowed(nowMs: number, lastZoomInputMs: number, scriptedCamera: boolean, prevCheckMs = Number.POSITIVE_INFINITY): boolean {
  if (scriptedCamera) return false
  // A zoom input since the previous frame's check counts however long that frame took (a slow frame must not outlast the window).
  return lastZoomInputMs > prevCheckMs || nowMs - lastZoomInputMs <= TAPE_GESTURE_TAIL_MS
}

/**
 * The limit-hit pulse follows the same rule as the wake: a clamp at a zoom limit pulses the tape only while the camera is not scripted.
 * The seen count always catches up, so a hit that landed during a flight cannot pulse the tape after it.
 */
export function tapeLimitPulse(limitHits: number, seenHits: number, scriptedCamera: boolean): { pulse: boolean; seen: number } {
  return { pulse: limitHits !== seenHits && !scriptedCamera, seen: limitHits }
}

/** Height of a tick label and of the reading label, px (zoomTape.ts font sizes 12 and 18), and the reading label's centre above the bar. */
const TICK_LABEL_PX = 12
const READING_LABEL_PX = 18
const READING_CENTRE_ABOVE_BAR_PX = 16
/** Tick labels closer than this to the bar (either side) are hidden. */
const TICK_CLEAR_AROUND_BAR_PX = 24
/**
 * True when a tick label at tape position `u` (0 bottom .. 1 top, 0.5 = the bar) would print over the reading label, which stands just above the bar,
 * on a tape `heightPx` tall. Such a tick label is hidden (its tick stays).
 */
export function tickLabelCollidesWithReading(u: number, heightPx: number): boolean {
  const dy = (0.5 - u) * heightPx // px below the bar
  if (Math.abs(dy + READING_CENTRE_ABOVE_BAR_PX) < (TICK_LABEL_PX + READING_LABEL_PX) / 2 + 2) return true
  // A label just under the bar still prints into the reading's box (glyph ascent, line height), so the bar's own neighbourhood is clear too.
  return Math.abs(dy) < TICK_CLEAR_AROUND_BAR_PX
}

const MOON_MEAN_R_KM = 1737.4

/** Camera height above the surface, metres, from what the viewer already knows. Null when there is no honest height. */
export function heightAboveSurfaceM(i: { distKm: number; groundKm: number; aglM?: number | null; flightAltM?: number | null }): number | null {
  if (i.flightAltM != null && Number.isFinite(i.flightAltM)) return i.flightAltM
  if (i.aglM != null && Number.isFinite(i.aglM)) return i.aglM
  if (!Number.isFinite(i.distKm)) return null
  // Above the 1737.4 km sphere, or above the site's ground where a patch gives it.
  return (i.distKm - MOON_MEAN_R_KM - i.groundKm) * 1000
}

/** log10 of a height, floored at 0.1 m so a landed camera stays on the scale. Null for a missing height. */
export function tapeLog(heightM: number | null): number | null {
  if (heightM === null || !Number.isFinite(heightM)) return null
  return Math.log10(Math.max(0.1, heightM))
}

/** Where height `m` sits on the arc (0 bottom .. 1 top, 0.5 = the bar) while the reading is `readingLog`. Unclamped: off the ends is hidden. */
export function tapePosition(m: number, readingLog: number): number {
  return 0.5 + (Math.log10(m) - readingLog) / TAPE_DECADES
}

/** Floor marker position, hidden when the local floor is unknown or outside the visible tape window. */
export function floorMarkerPosition(floorM: number | null, readingLog: number): number | null {
  if (floorM === null || !Number.isFinite(floorM) || floorM <= 0 || !Number.isFinite(readingLog)) return null
  const u = tapePosition(floorM, readingLog)
  return u >= 0 && u <= 1 ? u : null
}

/** Whether new readings require the tape geometry (including a floor-only marker move) to be redrawn. */
export function tapeLayoutChanged(log: number, laidLog: number, floorM: number | null | undefined, lastFloor: number | null): boolean {
  return log !== laidLog || (floorM ?? null) !== lastFloor
}

const num = (v: number): string => v.toLocaleString('en-GB')

/** `1 m`, `500 m`, `1 km`, `10,000 km`: the label of a tick. */
export function formatTickM(m: number): string {
  return m < 1000 ? `${num(m)} m` : `${num(m / 1000)} km`
}

/** The reading: one decimal below 10 of a unit, whole numbers above; metres below a kilometre, kilometres from there. */
export function formatReadingM(m: number): string {
  if (m < 1000) {
    if (m < 10) return `${Math.max(0, m).toFixed(1)} m`
    return `${Math.round(m)} m`
  }
  const km = m / 1000
  return km < 10 ? `${km.toFixed(1)} km` : `${num(Math.round(km))} km`
}

export interface TapeTick { m: number; major: boolean; label?: string }

/** Ticks at 1..9 of each decade within the range, majors (longer, labelled) at 1-2-5, as SkyLumi's. */
export function tapeTicks(min = TAPE_MIN_M, max = TAPE_MAX_M): TapeTick[] {
  const ticks: TapeTick[] = []
  for (let d = Math.floor(Math.log10(min)); d <= Math.ceil(Math.log10(max)); d++) {
    for (let k = 1; k <= 9; k++) {
      const m = Number((k * 10 ** d).toPrecision(3))
      if (m < min - 1e-9 || m > max + 1e-9) continue
      const major = k === 1 || k === 2 || k === 5
      ticks.push({ m, major, label: major ? formatTickM(m) : undefined })
    }
  }
  return ticks
}

const ARC_ARROW_PX = 20
const ARC_BULGE_PER_HEIGHT = (1 - Math.cos((35 * Math.PI) / 180)) / (2 * Math.sin((35 * Math.PI) / 180))
const ARC_HEIGHT_FRACTION = 0.3

/** Where the arc sits: the left edge, vertically centred (SkyLumi's hudArcPlacement). Safe-area insets are the wrapper's. */
export function arcPlacement(width: number, height: number): { x: number; top: number; height: number } {
  const phone = width < 560
  const h = Math.min(phone ? 200 : 260, Math.max(phone ? 112 : 140, height * ARC_HEIGHT_FRACTION))
  return { x: (phone ? 8 : 20) + ARC_ARROW_PX + h * ARC_BULGE_PER_HEIGHT, top: height / 2 - h / 2, height: h }
}

/** A point on the arc for `t` (0 bottom .. 1 top); the arc bulges left; (nx, ny) is the unit normal pointing right. */
export function arcPoint(t: number, x: number, top: number, height: number): { x: number; y: number; nx: number; ny: number } {
  const span = (70 * Math.PI) / 180
  const radius = height / (2 * Math.sin(span / 2))
  const centerX = x + radius * Math.cos(span / 2)
  const centerY = top + height / 2
  const phi = Math.PI + span / 2 - t * span
  const px = centerX + radius * Math.cos(phi)
  const py = centerY - radius * Math.sin(phi)
  return { x: px, y: py, nx: (centerX - px) / radius, ny: (centerY - py) / radius }
}

/**
 * The fade state machine. The tape is hidden until the zoom moves; it shows the moment the reading changes and hides
 * `idleMs` after the last change. The first reading only seeds it (the tape does not announce itself on load).
 */
export class ZoomFade {
  private last = Number.NaN
  private wakeAt = Number.NEGATIVE_INFINITY
  constructor(readonly idleMs = TAPE_IDLE_MS, readonly eps = ZOOM_EPS_LOG) {}
  /** Feed the current reading (log10 m) at `nowMs`; true when it counted as a zoom. */
  observe(log: number | null, nowMs: number, canWake = true): boolean {
    if (log === null || !Number.isFinite(log)) return false
    if (Number.isNaN(this.last)) { this.last = log; return false }
    if (Math.abs(log - this.last) <= this.eps) return false
    // The reading always follows the camera; only a visitor's zoom gesture (canWake) wakes the tape.
    this.last = log
    if (!canWake) return false
    this.wakeAt = nowMs
    return true
  }
  /** Hides it at once (a flight or a viewpoint move began). */
  sleep(): void { this.wakeAt = Number.NEGATIVE_INFINITY }
  visibleAt(nowMs: number): boolean { return nowMs - this.wakeAt < this.idleMs }
  /** Show briefly after a limit hit even when height itself did not change. */
  wake(nowMs: number): void { this.wakeAt = nowMs }
  /** Milliseconds until it hides, 0 when hidden already. */
  remainingMs(nowMs: number): number { return Math.max(0, this.idleMs - (nowMs - this.wakeAt)) }
}
