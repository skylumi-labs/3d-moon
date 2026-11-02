import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import type { Ephemeris, LonLat } from '../ephemeris'
import { FEEL_MAX_STEP_MS } from './feel'

/**
 * The sky carried along a pick's flight (owner report 2026-10-29: "whenever I tap on a location, the moon jumps to some other place and only
 * then starts journeying"). A place has its own date, and the pick used to set it on the first frame: the camera is held in the Moon's body
 * frame (camera/pose.ts poseBasis), so the surface did not move, but the Sun turned up to 108 degrees over the Moon in one frame (the lit face
 * and every shadow changed at once), the Earth jumped and the stars turned by the Moon's rotation between the two dates. The camera then flew
 * on from that changed picture.
 *
 * Instead the shown ephemeris goes from the one on screen to the place's over the approach: the Moon's orientation in the sky is slerped (the
 * stars turn smoothly), and the Sun and the Earth move on great circles in the Moon's body frame (the light sweeps over the surface). The
 * clock, the caption and the end pose use the place's date at once; only the picture is carried. Dates do not interpolate celestial physics:
 * the blend is a transition, not a sky at an intermediate date, and it ends exactly on the place's ephemeris.
 */

/** Unit vector `w` of the way from `a` to `b` along their great circle (both unit). Opposite vectors turn about any perpendicular. */
export function slerpDir(a: Vector3, b: Vector3, w: number): Vector3 {
  const dot = Math.max(-1, Math.min(1, a.dot(b)))
  const omega = Math.acos(dot)
  if (omega < 1e-9) return b.clone()
  let axis = new Vector3().crossVectors(a, b)
  if (axis.lengthSq() < 1e-18) {
    axis = new Vector3().crossVectors(a, Math.abs(a.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0))
  }
  axis.normalize()
  return a.clone().applyAxisAngle(axis, omega * w).normalize()
}

function quatOf(m: Matrix3): Quaternion {
  return new Quaternion().setFromRotationMatrix(new Matrix4().setFromMatrix3(m))
}
function mat3Of(q: Quaternion): Matrix3 {
  return new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(q))
}
/** A world vector in the Moon's body axes. */
function toBody(e: Pick<Ephemeris, 'moonX' | 'moonY' | 'moonZ'>, v: Vector3): Vector3 {
  return new Vector3(v.dot(e.moonX), v.dot(e.moonY), v.dot(e.moonZ))
}
function bodyLonLatOf(b: Vector3): LonLat {
  return { lon: Math.atan2(b.y, b.x) * 180 / Math.PI, lat: Math.asin(Math.max(-1, Math.min(1, b.z))) * 180 / Math.PI }
}
const lerp = (a: number, b: number, w: number): number => a + (b - a) * w

/**
 * Closest the carried Sun and Earth may come to lining up (seen from the Moon), deg, unless the carry's own ends are that close. The Earth's
 * shadow (with its air) reaches about 1.3 deg from the Sun line at the Moon, and the Moon's own radius shifts that by 0.26 deg across the
 * disc: 2 deg keeps every visible point out of the penumbra. The Moon's shadow on the Earth (Earth opposite the Sun) is kept as far.
 */
export const ECLIPSE_FREE_SEP_DEG = 2

/**
 * The Sun and the Earth are carried on their own great circles, so between two dates either side of a full (or new) Moon their directions
 * can pass much closer than the real sky ever put them: rig 2026-10-31, Home from Copernicus at 2026-10-20T19:00Z to 2026-10-30T12:00Z passed
 * 0.38 deg apart at weight 0.53 (the real closest that month was 4.56 deg, no eclipse), and two frames of the Home flight drew a total lunar
 * eclipse (the whole near side copper, then blue-grey, and the exposure's eclipse key). The Earth (the slow one in the Moon's frame; the Sun's
 * great circle, the light sweeping the surface, stays exact) is moved across their relative motion, on the side it already passes, by
 * (floor - |c|) k(t): c is the miss across the motion, t the distance along it, and k a smooth bump, 1 at closest approach and 0 from
 * ECLIPSE_SIDESTEP_SPAN floors away, so the Earth eases round the line instead of being pushed along it (no kink, no swing). With
 * k = (1 - (t / 3 floor)^2)^2 the separation stays at least the floor (t^2 + floor^2 k^2 >= floor^2 for |t| < floor).
 * The floor is min(ECLIPSE_FREE_SEP_DEG, the separation lerped between the ends), so a carry to or from a real eclipse still reaches it.
 */
const ECLIPSE_SIDESTEP_SPAN = 3
function keepEclipseFree(sunBody: Vector3, earthBody: Vector3, a: Ephemeris, b: Ephemeris, w: number): Vector3 {
  const sunA = toBody(a, a.sunDir), sunB = toBody(b, b.sunDir), earthA = toBody(a, a.earthDir), earthB = toBody(b, b.earthDir)
  const sepA = sunA.angleTo(earthA), sepB = sunB.angleTo(earthB)
  const free = ECLIPSE_FREE_SEP_DEG * Math.PI / 180
  let e = earthBody
  for (const anti of [false, true]) {
    const floor = Math.min(free, anti ? lerp(Math.PI - sepA, Math.PI - sepB, w) : lerp(sepA, sepB, w))
    const s = anti ? sunBody.clone().negate() : sunBody
    const r = e.clone().sub(s)
    const span = ECLIPSE_SIDESTEP_SPAN * floor
    if (!(floor > 0) || r.length() >= span + floor) continue
    // The Earth's motion relative to the Sun (or anti-Sun) line over the blend, in the plane tangent at s.
    const rel = (x: number): Vector3 => {
      const sx = slerpDir(sunA, sunB, x)
      return slerpDir(earthA, earthB, x).sub(anti ? sx.negate() : sx)
    }
    const x2 = Math.min(1, w + 1e-3), x1 = Math.max(0, x2 - 2e-3)
    const m = rel(x2).sub(rel(x1))
    m.addScaledVector(s, -m.dot(s))
    if (m.lengthSq() < 1e-24) m.crossVectors(s, Math.abs(s.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0))
    m.normalize()
    const v = new Vector3().crossVectors(s, m).normalize()
    const t = r.dot(m), c = r.dot(v)
    if (Math.abs(t) >= span || Math.abs(c) >= floor) continue
    const k = (1 - (t / span) ** 2) ** 2
    e = e.clone().addScaledVector(v, (c < 0 ? -1 : 1) * (floor - Math.abs(c)) * k).normalize()
  }
  return e
}

/**
 * The ephemeris shown at blend weight `w` (0: `a`, 1: `b`, returned as is at the ends). Pure. `date` is `b`'s: the blend is a picture
 * transition toward the place's date, not a date of its own.
 */
export function blendEphemeris(a: Ephemeris, b: Ephemeris, w: number, sunOffset?: Vector3): Ephemeris {
  if (w <= 0) return a
  if (w >= 1) return b
  const qMoon = quatOf(a.moonToWorld).slerp(quatOf(b.moonToWorld), w)
  const moonToWorld = mat3Of(qMoon)
  const moonX = new Vector3(1, 0, 0).applyQuaternion(qMoon)
  const moonY = new Vector3(0, 1, 0).applyQuaternion(qMoon)
  const moonZ = new Vector3(0, 0, 1).applyQuaternion(qMoon)
  const earthToWorld = mat3Of(quatOf(a.earthToWorld).slerp(quatOf(b.earthToWorld), w))
  const sunBody = slerpDir(toBody(a, a.sunDir), toBody(b, b.sunDir), w)
  // A start velocity for the light (body frame, the carry's sunRate): the great circle plus a small offset that vanishes with its slope at both ends.
  if (sunOffset) sunBody.add(sunOffset).normalize()
  const earthBody = keepEclipseFree(sunBody, slerpDir(toBody(a, a.earthDir), toBody(b, b.earthDir), w), a, b, w)
  const sunDir = sunBody.clone().applyMatrix3(moonToWorld).normalize()
  const earthDir = earthBody.clone().applyMatrix3(moonToWorld).normalize()
  const sunKm = sunDir.clone().multiplyScalar(lerp(a.sunKm.length(), b.sunKm.length(), w))
  const earthKm = earthDir.clone().multiplyScalar(lerp(a.earthKm.length(), b.earthKm.length(), w))
  const phaseDeg = sunDir.angleTo(earthDir) * 180 / Math.PI
  return {
    date: new Date(b.date.getTime()),
    sunKm, earthKm, moonToWorld, earthToWorld, sunDir, earthDir, moonX, moonY, moonZ,
    phaseDeg,
    illuminatedFraction: (1 + Math.cos(phaseDeg * Math.PI / 180)) / 2,
    earthPhaseDeg: lerp(a.earthPhaseDeg, b.earthPhaseDeg, w),
    subSolar: bodyLonLatOf(sunBody),
    subEarth: bodyLonLatOf(earthBody),
    earthshine: lerp(a.earthshine, b.earthshine, w),
  }
}

/**
 * Whether two ephemerides draw the same sky: the same date AND the same Sun (the early return in main.ts carryDate). Since the drag modes
 * went (2026-10-31) the Sun is always the clock's, so the date decides; the Sun check stays as a guard for any future lighting offset.
 */
export function samePicture(a: Ephemeris, b: Ephemeris): boolean {
  return a === b || (a.date.getTime() === b.date.getTime() && Math.acos(Math.max(-1, Math.min(1, a.sunDir.dot(b.sunDir)))) < 1e-9)
}

/** The carry's weight at `now`: smoothstep over [t0, t0 + ms], so the light starts and ends at rest like the camera does. */
export function carryWeight(now: number, t0: number, ms: number): number {
  if (!(ms > 0)) return 1
  const u = Math.max(0, Math.min(1, (now - t0) / ms))
  return u * u * (3 - 2 * u)
}

/** Shortest and longest carry, ms: a pick with no move still blends, and a long descent does not keep the sky moving for its whole length. */
export const CARRY_MIN_MS = 600
export const CARRY_MAX_MS = 8000

/**
 * One running carry. The page owns `shown` (the ephemeris it draws); the carry only knows what it last handed out, so any other code that sets
 * the date (a scrub, the Time sheet, the ground flight, Home) is seen as a reassignment and ends the carry where that code put it.
 */
/**
 * Without a fly-to to ride on (a descent, a site view), the carry runs on its own clock, and one step advances it at most twice the normal frame
 * time (at least one 30 Hz frame, CARRY_STEP_MAX_MS; at most CARRY_STEP_CEIL_MS). The normal frame time is an average over frames that are not
 * stalls: a step over CARRY_STEP_CEIL_MS is a stall and never feeds the average, so repeated stalls cannot raise the cap (review 2026-10-29: four
 * 5 s gaps had grown the Sun's steps to 2, 8, 15, 20 deg), while a phone that steadily draws 100 ms frames is learnt and keeps its pace.
 */
export const CARRY_STEP_MAX_MS = 1000 / 30
export const CARRY_STEP_CEIL_MS = 250

export class EphemCarry {
  private last: Ephemeris | null = null
  private prev: number | null = null
  private elapsed = 0
  /** Average frame time of the non-stall frames seen, ms. */
  private frameMs = 1000 / 60
  /** The weight the last step showed, and the weight and clock the own clock resumes from when the move it rode on is gone (a cancel). */
  private lastW = 0
  private resumeW: number | null = null
  private driven = false
  /**
   * Driven: the weight the current driver started from, and its last progress. A new driver (a re-pick of the place being approached starts a
   * new fly-to at progress 0; the tiles' re-plan does the same) resumes from the weight on screen instead of from 0 (review 2026-10-29: a
   * re-pick at 1.2 s of a 3 s approach turned the Sun 37.9 deg in one frame, then replayed the sweep).
   */
  private driveR = 0
  private lastProgress = -1
  /**
   * `sunStart`: the Sun's velocity in the Moon's body frame when the carry starts (`rate`: tangent, rad/s) and the length of the move it rides on (`ms`:
   * the fly-to's whole plan, not the remaining time of a late hand-off), for a carry that drops a hold which was turning the Sun with a spinning camera: the
   * light then leaves at that speed instead of at rest, and settles exactly on the target (offset v0 * T * x * (1 - x)^3, slope v0 at 0, value and slope 0 at 1).
   * x is the move's progress while the carry rides on it; after a re-pick's new move or a cancelled move it goes on by the wall clock from where it was, so the
   * offset never jumps.
   */
  constructor(readonly from: Ephemeris, public target: Ephemeris, readonly t0: number, readonly ms: number, private sunStart?: { rate: Vector3; ms: number }) {}
  /** The offset's own parameter and the clock it was last advanced at (it outlives the driver that gave it x). */
  private sx = 0
  private sxAt = -1
  private sxFree = false
  /**
   * The ephemeris to show at `now` and whether the carry is over (then it is the target itself), or null when other code set the date
   * since the last step (the caller keeps what that code set). `shown` is the page's current ephemeris: the target (just set by the pick, or
   * by a live tick that moved it through `retarget`) or what this carry handed out last.
   *
   * `progress` (0 to 1): the move the carry rides on, when there is one (the fly-to's own progress, journey/path.ts timing). The light then
   * follows the camera on ONE clock: the carry is complete exactly when the fly-to ends and hands over to a flight or orbit that samples the
   * place's ephemeris, whatever stalls happened (review 2026-10-29: a 1 s stall had left the blend unfinished at the hand-over, a 289 km jump).
   */
  step(now: number, shown: Ephemeris, progress?: number): { e: Ephemeris; done: boolean } | null {
    if (shown !== this.target && shown !== this.last) return null
    let w: number, x = 1
    if (progress !== undefined) {
      const u = Math.max(0, Math.min(1, progress))
      // A driver that starts (from the own clock, or a new one: its progress went back) takes over from the weight on screen.
      if (u < this.lastProgress) this.sxFree = true
      if (!this.driven || u < this.lastProgress) this.driveR = this.lastW
      this.lastProgress = u
      x = u
      w = this.driveR + (1 - this.driveR) * u * u * (3 - 2 * u)
      this.resumeW = null
      this.driven = true
    } else {
      // Riding on a move until now: the own clock takes the rest from the weight on screen, over the rest of the length.
      if (this.driven) { this.driven = false; this.resumeW = this.lastW; this.prev = now; this.elapsed = 0; this.sxFree = true }
      if (this.prev === null) this.prev = Math.max(this.t0, Math.min(now, this.t0 + CARRY_STEP_MAX_MS))
      const dt = Math.max(0, now - this.prev)
      const stall = dt > CARRY_STEP_CEIL_MS
      const cap = Math.min(CARRY_STEP_CEIL_MS, Math.max(CARRY_STEP_MAX_MS, 2 * this.frameMs))
      this.elapsed += Math.min(cap, dt)
      if (!stall) this.frameMs += 0.5 * (dt - this.frameMs)
      this.prev = Math.max(this.prev, now)
      const r = this.resumeW ?? 0
      w = r + (1 - r) * carryWeight(this.t0 + this.elapsed, this.t0, this.ms * (1 - r))
      x = this.ms > 0 ? Math.min(1, this.elapsed / this.ms) : 1
    }
    this.lastW = w
    if (w >= 1) { this.last = this.target; return { e: this.target, done: true } }
    let offset: Vector3 | undefined
    if (this.sunStart) {
      // Riding on the move: its progress. Free (a new driver, a cancelled move): from the last x by the wall clock, a frame counting at most the camera's
      // FEEL_MAX_STEP_MS (journey/feel.ts), so a hitch moves the light no further than the camera.
      const sx = this.sxFree ? Math.min(1, this.sx + (this.sxAt >= 0 ? Math.max(0, Math.min(FEEL_MAX_STEP_MS, now - this.sxAt)) : 0) / this.sunStart.ms) : x
      this.sx = sx; this.sxAt = now
      if (sx < 1) offset = this.sunStart.rate.clone().multiplyScalar(this.sunStart.ms / 1000 * sx * (1 - sx) ** 3)
    }
    this.last = blendEphemeris(this.from, this.target, w, offset)
    return { e: this.last, done: false }
  }
  /** A live clock moved the place's date on (the "now" moments): the carry ends on the new ephemeris instead. */
  retarget(e: Ephemeris): void { this.target = e }
  /** The carry rides on a new move from the next step (a re-pick's fly-to): it continues from the weight on screen, whatever that move's progress. */
  newDriver(): void { this.lastProgress = Infinity }
}
