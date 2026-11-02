import { Vector3 } from 'three'
import { MOON_R_KM, EARTH_R_KM } from '../glsl/common'
import type { Ephemeris } from '../ephemeris'
import { angularDistance, flyTanHalf, poseBasis, wrapLon, D_MAX, type Pose } from '../camera/pose'
import { FEEL_CARRY_K, FEEL_CARRY_K_MAX, FEEL_V0_MAX, FEEL_V0_MIN, feelDurationMs, feelEase, feelPath } from './feel'
/** The largest excursion the carried-velocity correction may add to any pose component (deg; log units for the altitude and the lens). */
export const CARRY_MAX_EXCURSION = { angle: 30, roll: 45, pitch: 30, logDist: 3, logFov: 1 }
/** The most the carry's share of the path shrinks so a fast reversal turns inside CARRY_MAX_EXCURSION at its speed. */
export const CARRY_MAX_SHRINK = 6
/** Where the shrink has faded back to none: a rate that needs this much is not a camera's (a relabel the caller did not catch) and is clipped as before. */
export const CARRY_SHRINK_FADE = 30
/**
 * The factor the carry's share is divided by, for a carry that needs `need` times the excursion bound over its usual share: `need` itself up to
 * CARRY_MAX_SHRINK (the speed is kept, the turn lands on the bound), then fading linearly back to 1 at CARRY_SHRINK_FADE (the bound clips the rest).
 * Continuous in `need`, so a slightly faster start never loses most of its speed at once.
 */
export function carryShrink(need: number): number {
  if (!(need > 1)) return 1
  if (need <= CARRY_MAX_SHRINK) return need
  if (need >= CARRY_SHRINK_FADE) return 1
  return CARRY_MAX_SHRINK - (CARRY_MAX_SHRINK - 1) * (need - CARRY_MAX_SHRINK) / (CARRY_SHRINK_FADE - CARRY_MAX_SHRINK)
}

/**
 * The fly-to planner (MOON-UX-REDESIGN.md, section 4.4): one planner for every scripted move of the visitor path (a pin, Home,
 * a double-tap), so they all share one duration law, one easing and one safety check.
 *
 * - Duration: flyDurationMs, from the zoom-and-pan path length, kept within 2.6 to 9 s.
 * - Path: altitude and travel follow one zoom-and-pan curve (zoomPanPath), with a bow to one side and a bank into the turn
 *   (planFly), on one gliding time law (flyEase) that runs position, lens and look together so nothing arrives before anything else.
 * - Look: the camera looks at the Moon's centre (look 0) or at the Earth (look 1). A change of subject blends the DIRECTION
 *   looked along over the middle 40 % of the move; the orientation is solved from that direction every frame, never a slerp
 *   between two look-at orientations.
 * - No empty frame: the path is sampled at SAMPLES + 1 points before the first frame; where neither the Moon nor the Earth
 *   covers MIN_COVER of the frame, the lens is widened at that sample (never along the whole path).
 */

const DEG = Math.PI / 180
export const SAMPLES = 24
/** The subject (the Moon or the Earth) covers at least this share of the frame at every sample. */
export const MIN_COVER = 0.02
/** A straight line between the ends that passes nearer than this (Moon radii) to the centre gets the arc. */
export const ARC_CLEARANCE = 1.1
/** The widest lens a plan may ask for, deg. */
const MAX_FOV = 120
/** The share of the move a change of subject takes. */
const LOOK_SPAN = 0.4
const EARTH_R_MOON_R = EARTH_R_KM / MOON_R_KM
export const FLY_MIN_MS = 2600
export const FLY_MAX_MS = 6000

/** Quintic ease in and out. */
export const ease = (x: number): number => {
  const t = Math.max(0, Math.min(1, x))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/** One end of a move: where the camera is, its lens, its aim shifts, and what it looks at (0 the Moon's centre, 1 the Earth). */
export interface FlyEnd {
  pose: Pose
  fovDeg: number
  aimShift: number
  aimShiftX: number
  look: 0 | 1
  /**
   * The ground under this end, in Moon radii relative to the sphere (a site below the datum is negative, Apollo 17 about -0.0015).
   * Altitude and duration count from it. Unset: the sphere, or the end's own distance when that is inside the sphere.
   */
  ground?: number
}

/** Everything the camera has at one instant of a move. */
export interface FlyState {
  pose: Pose
  fovDeg: number
  aimShift: number
  aimShiftX: number
  /** How far the look has turned from the Moon's centre to the Earth, 0 to 1 (a blend of directions). */
  look: number
}

export interface FlyPlan {
  from: FlyEnd
  to: FlyEnd
  ms: number
  /** The slope of the time ease at the end (0: it ends at rest; see PlanOptions.endRate). */
  endSlope: number
  /** Added to the log distance at the midpoint (0 without the arc). */
  arc: number
  /** The lens widening at each of SAMPLES + 1 knots (factors of 1 or more). */
  widen: number[]
  /** The smallest subject coverage over the knots, after widening. */
  minCover: number
  /** The smallest distance from the Moon's centre along the path (Moon radii). */
  minRadius: number
  /** Greatest distance from the Moon's centre reached by the planned path. */
  apexDist: number
  /** v2: the start speed of the clock (progress per unit time, 1 = the mean); 0 from rest. */
  startSpeed: number
  at(u: number): FlyState
}

const posOf = (e: Ephemeris, p: Pose): Vector3 => poseBasis(e, { ...p, roll: 0 }).back.multiplyScalar(p.dist)
/** The camera's position (Moon radii, world frame) for a pose. */
export const cameraPosition = posOf

/** The pose's direction as a unit vector in the Moon-fixed frame (x prime meridian, z north). */
function dirOf(lon: number, lat: number): Vector3 {
  const cl = Math.cos(lat * DEG)
  return new Vector3(cl * Math.cos(lon * DEG), cl * Math.sin(lon * DEG), Math.sin(lat * DEG))
}

function slerpDir(a: Vector3, b: Vector3, k: number): Vector3 {
  const dot = Math.max(-1, Math.min(1, a.dot(b)))
  const ang = Math.acos(dot)
  if (ang < 1e-9) return a.clone()
  let axisFix: Vector3 | null = null
  if (Math.PI - ang < 1e-6) {
    // Antipodal: go over the pole (any perpendicular will do, this one keeps it deterministic).
    axisFix = Math.abs(a.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0)
    const mid = new Vector3().crossVectors(a, axisFix).normalize()
    return k < 0.5 ? a.clone().multiplyScalar(Math.cos(Math.PI * k)).addScaledVector(mid, Math.sin(Math.PI * k)) : mid.clone().multiplyScalar(Math.cos(Math.PI * (k - 0.5))).addScaledVector(b, Math.sin(Math.PI * (k - 0.5)))
  }
  const s = Math.sin(ang)
  return a.clone().multiplyScalar(Math.sin((1 - k) * ang) / s).addScaledVector(b, Math.sin(k * ang) / s)
}

/** Share of a frame (half-extents tx by ty in tangent units) covered by a disc of tangent radius tr centred at (cx, cy). */
export function discCover(cx: number, cy: number, tr: number, tx: number, ty: number): number {
  const N = 24
  let hit = 0
  for (let j = 0; j < N; j++) {
    const y = ((j + 0.5) / N * 2 - 1) * ty
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N * 2 - 1) * tx
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= tr * tr) hit++
    }
  }
  return hit / (N * N)
}

/**
 * The share of the frame the Moon and the Earth together cover for a camera at `pos` (Moon radii, world frame) looking along
 * `forward` with an upright-ish frame (`up`), vertical half-field `tanHalf`, width over height `aspect`. Zero when the camera is inside the Moon.
 */
export function subjectCover(e: Ephemeris, pos: Vector3, forward: Vector3, up: Vector3, tanHalf: number, aspect: number): number {
  const r = pos.length()
  if (r <= 1) return 0
  const right = new Vector3().crossVectors(forward, up).normalize()
  const upN = new Vector3().crossVectors(right, forward).normalize()
  // Tangent-plane frame: tanHalf is the vertical half-field (the camera's), the horizontal one is aspect times it.
  const tx = tanHalf * aspect, ty = tanHalf
  const cover = (centre: Vector3, radius: number): number => {
    const d = centre.clone().sub(pos), dist = d.length()
    const z = d.dot(forward)
    if (z <= 0 || dist <= radius) return z <= 0 ? 0 : 1
    const tr = Math.tan(Math.asin(Math.min(1, radius / dist)))
    return discCover(d.dot(right) / z, d.dot(upN) / z, tr / (z / dist) * 1, tx, ty)
  }
  const moon = cover(new Vector3(), 1)
  const earth = cover(e.earthKm.clone().divideScalar(MOON_R_KM), EARTH_R_MOON_R)
  return Math.min(1, moon + earth)
}

/** The camera's look direction (unit, world) at a blend of Moon (0) and Earth (1). */
function lookDir(e: Ephemeris, pos: Vector3, w: number): Vector3 {
  const m = pos.clone().negate().normalize()
  if (w <= 0) return m
  const earth = e.earthKm.clone().divideScalar(MOON_R_KM).sub(pos).normalize()
  if (w >= 1) return earth
  const mix = m.multiplyScalar(1 - w).addScaledVector(earth, w)
  return mix.lengthSq() < 1e-12 ? earth : mix.normalize()
}

/** Floor of an altitude (Moon radii) in the planner's log law. */
const ALT_MIN = 1e-6
/** The ground under an end: the given one, else the sphere (or the end's own distance when that sits inside it). */
const groundOf = (dist: number, ground?: number): number => ground ?? Math.min(0, dist - 1 - 1e-9)
/** Height above the ground, Moon radii, never below ALT_MIN. */
const altitudeOf = (dist: number, ground?: number): number => Math.max(ALT_MIN, dist - 1 - groundOf(dist, ground))

/**
 * How long a move takes, ms: 2 s plus up to 6 s for the zoom-and-pan path length (zoomPanPath's S, which already weighs a climb,
 * a descent and the travel by how much the picture changes; 1.2 s per unit at first), 1.5 s per 180 deg of travel, 0.5 s per 90 deg of look turn, kept within FLY_MIN_MS to
 * FLY_MAX_MS (a move of under a degree that barely changes the zoom may take 1.5 s). `lookTurnDeg` is 0 when the subject does not change.
 */
export function flyDurationMs(from: Pose, to: Pose, lookTurnDeg = 0, groundFrom?: number, groundTo?: number): number {
  const theta = angularDistance(from.lon, from.lat, to.lon, to.lat)
  const S = zoomPanPath(theta, altitudeOf(from.dist, groundFrom), altitudeOf(to.dist, groundTo)).S
  const turn = 500 * lookTurnDeg / 90
  // A move of about a degree that barely changes the zoom (a nudge, a re-centre) is quicker: 1.5 s plus the same per-unit law.
  if (theta < 0.02 && S < 0.6) return Math.min(FLY_MAX_MS, 1500 + 6000 * (1 - Math.exp(-S / 5)) + turn)
  // The turn of the globe gets its own share (1.5 s per 180 deg): from high up a long rotation is cheap in path length but is
  // still the whole Moon sliding by.
  // The path length counts 1.2 s a unit at first and less for very long zooms (6 s at most): a dive from eye level through
  // nine powers of e of altitude may go faster per power than a short hop, or a departure from the ground would take the full 9 s.
  return Math.max(FLY_MIN_MS, Math.min(FLY_MAX_MS, 2000 + 6000 * (1 - Math.exp(-S / 5)) + 1500 * theta / Math.PI + turn))
}

/** The straight-line (chord) path between two ends' camera positions, `n + 1` points: what a planner without the arc would fly. */
export function chordPositions(e: Ephemeris, a: Pose, b: Pose, n = SAMPLES): Vector3[] {
  const pa = posOf(e, a), pb = posOf(e, b)
  const out: Vector3[] = []
  for (let i = 0; i <= n; i++) out.push(pa.clone().lerp(pb, i / n))
  return out
}

/** The smallest distance from the Moon's centre along a chord between two poses, Moon radii. */
export function chordMinRadius(e: Ephemeris, a: Pose, b: Pose): number {
  const pa = posOf(e, a), pb = posOf(e, b)
  const d = pb.clone().sub(pa)
  const L2 = d.lengthSq()
  if (L2 < 1e-12) return pa.length()
  const t = Math.max(0, Math.min(1, -pa.dot(d) / L2))
  return pa.clone().addScaledVector(d, t).length()
}

/** The smallest subject coverage along a list of camera positions, each looking at the Moon's centre with a given lens. */
export function minCoverAlong(e: Ephemeris, positions: Vector3[], fovDeg: number, aspect: number): number {
  let min = 1
  for (const pos of positions) {
    const fwd = pos.lengthSq() > 0 ? pos.clone().negate().normalize() : new Vector3(0, 0, -1)
    const up = e.moonZ.clone().addScaledVector(fwd, -e.moonZ.dot(fwd))
    if (up.lengthSq() < 1e-9) up.copy(e.moonX)
    min = Math.min(min, subjectCover(e, pos, fwd, up.normalize(), flyTanHalf(aspect, fovDeg), aspect))
  }
  return min
}

export interface PlanOptions {
  /** Width over height of the canvas (default 1.6). */
  aspect?: number
  /** Fix the duration, ms (default: the law above). */
  ms?: number
  /** End moving at this pose rate (per second) instead of at rest, in speed and direction, for a hand-over to a flight (journey/join.ts). */
  endRate?: { lon: number; lat: number; dist: number }
  /**
   * Flight feel v2 (journey/feel.ts): the flatter path walked by its perceptual length, the shorter duration law and the quick-start,
   * gentle-arrival clock. False (`?flightfeel=0`) plans exactly as before.
   */
  feel?: boolean
  /**
   * v2 only: the rates (per second) the camera already has (a move taken over mid-flight): pose, and optionally roll, pitch and lens (deg/s).
   * The new move starts with exactly that velocity, direction included, and turns smoothly onto its own path over the first FEEL_CARRY_K of it
   * (a reversal slows through a turn; it never stops first).
   */
  startRate?: { lon: number; lat: number; dist: number; roll?: number; pitch?: number; fov?: number }
}

/** The time ease of a move that ends at slope `c` (quintic Hermite: k'(0)=0, k'(1)=c, zero curvature at both ends). c = 0 is `ease`. */
export const easeEnd = (x: number, c: number): number => {
  const t = Math.max(0, Math.min(1, x))
  return ease(t) + c * t * t * t * (-4 + t * (7 - 3 * t))
}
/** The largest end slope the ease keeps monotone with margin. */
export const END_SLOPE_MAX = 1.5
/**
 * A move that hands over to a flight (PlanOptions.endRate) reaches the flight's speed this long before its end and glides at it (journey/join.ts).
 * Without it the move decelerated all the way into the join, so its last half second was still 2 to 4 times the flight's starting speed and the
 * flight read as a stop (rig R3 2026-10-21: surface 0.19, Earthrise 0.07 of the speed on arrival). Added to the move's own duration.
 */
export const JOIN_GLIDE_MS = 900
/**
 * The time ease of a move that ends with a glide: `easeEnd` over the first 1 - g of the time, scaled so that it reaches slope `c` there, then
 * straight on at slope `c` for the last share `g` (continuous in value, slope and curvature). g = 0 is `easeEnd`.
 */
export const easeGlide = (x: number, c: number, g: number): number => {
  if (g <= 0 || c <= 0) return easeEnd(x, c)
  const t = Math.max(0, Math.min(1, x)), a = 1 - g, k = 1 - c * g
  return t <= a ? k * easeEnd(t / a, c * a / k) : k + c * (t - a)
}
/** The largest end slope a glide of share `g` keeps monotone with margin (the eased part's own slope, c a / (1 - c g), stays within END_SLOPE_MAX). */
export const glideSlopeMax = (g: number): number => END_SLOPE_MAX / (1 - g + END_SLOPE_MAX * g)

/** The zoom-and-pan curvature: how much a move climbs to see both ends (van Wijk and Nuij use 1.41; lower climbs less, higher more). */
export const RHO = 1.25

/**
 * The optimal zoom-and-pan path of van Wijk and Nuij ("Smooth and efficient zooming and panning", 2003): the one long climb and
 * descent that keeps the ground moving at a constant speed relative to the frame. `u1` is the ground travel (radians of arc), `w0`
 * and `w1` the altitudes of the two ends (radii). Returns the path length S in the same perceptual units and, for s in [0, S], the
 * altitude w(s) and the travel u(s). A pure zoom (no travel) is the exponential law.
 */
export function zoomPanPath(u1: number, w0: number, w1: number): { S: number; sPeak: number; w(s: number): number; u(s: number): number } {
  if (u1 < 1e-9) {
    const k = Math.log(w1 / w0)
    const S = Math.abs(k) / RHO
    return { S, sPeak: -1, w: (s) => w0 * Math.exp(S > 0 ? Math.sign(k) * RHO * s : 0), u: () => 0 }
  }
  const r2 = RHO * RHO, r4 = r2 * r2
  const b0 = (w1 * w1 - w0 * w0 + r4 * u1 * u1) / (2 * w0 * r2 * u1)
  const b1 = (w1 * w1 - w0 * w0 - r4 * u1 * u1) / (2 * w1 * r2 * u1)
  // ln(-b + sqrt(b^2 + 1)) is -asinh(b): the stable form for the huge b of a camera near the ground.
  const r0 = -Math.asinh(b0), r1 = -Math.asinh(b1)
  const S = (r1 - r0) / RHO
  const c0 = Math.cosh(r0), sh0 = Math.sinh(r0)
  return {
    // The altitude peaks where RHO s + r0 = 0 (outside [0, S] when one end is already the highest point).
    S, sPeak: -r0 / RHO,
    w: (s) => w0 * c0 / Math.cosh(RHO * s + r0),
    u: (s) => w0 / r2 * (c0 * Math.tanh(RHO * s + r0) - sh0),
  }
}

/** The share of a move spent accelerating (and the same decelerating); the rest cruises at a steady speed. */
export const FLY_ACCEL = 0.3
/**
 * The time law of a move: a smooth start, a long steady cruise and a smooth arrival (velocity rises on a half cosine over
 * FLY_ACCEL of the move, holds, and falls the same way). Peak speed is 1 / (1 - FLY_ACCEL) of the mean, against 1.88 for the
 * quintic: a craft that gathers speed and glides, not one that lunges at the middle.
 */
export function flyEase(x: number): number {
  const t = Math.max(0, Math.min(1, x)), a = FLY_ACCEL, v = 1 / (1 - a)
  const ramp = (q: number): number => v * (q / 2 - a / (2 * Math.PI) * Math.sin(Math.PI * q / a))
  if (t <= a) return ramp(t)
  if (t >= 1 - a) return 1 - ramp(1 - t)
  return ramp(a) + v * (t - a)
}

/** The share of the travel that follows the clock rather than the zoom-and-pan curve (the turn-in on the approach). */
export const TURN_IN = 0.25

/** The bow: the path swings sideways off the great circle by this share of the travel at its middle (at most BOW_MAX_DEG). */
export const BOW_SHARE = 0.13
export const BOW_MAX_DEG = 8
/** The bank into the turn at the middle of a move, deg per deg of bow (at most BANK_MAX_DEG). */
export const BANK_PER_BOW = 1.25
export const BANK_MAX_DEG = 9

/** The camera's screen-up direction for a pose, as a unit vector in the Moon-fixed frame (x prime meridian, z north). */
function upOf(pose: Pose): Vector3 {
  const back = dirOf(pose.lon, pose.lat)
  let upN = new Vector3(0, 0, 1).addScaledVector(back, -back.z)
  if (upN.lengthSq() < 1e-12) upN = new Vector3(1, 0, 0).addScaledVector(back, -back.x)
  upN.normalize()
  const r = (pose.roll || 0) * DEG
  return upN.multiplyScalar(Math.cos(r)).addScaledVector(new Vector3().crossVectors(back, upN), Math.sin(r)).normalize()
}

/** The bow of a move over the ground and the bank into it, from the start pose to (lon, lat): see planFly and bowedTravel. */
export interface Bow { bowRad: number; normal: Vector3; side: number; bankDeg: number }
export function bowOf(from: Pose, toLon: number, toLat: number, arrive?: { lon: number; lat: number }): Bow {
  const d0 = dirOf(from.lon, from.lat), d1 = dirOf(toLon, toLat)
  const theta = angularDistance(from.lon, from.lat, toLon, toLat)
  // The bow's side: the half of the great circle's normal that points to the top of the starting frame.
  const cross = new Vector3().crossVectors(d0, d1)
  const bowable = cross.lengthSq() > 1e-12 && theta > 0.5 * DEG
  const normal = bowable ? cross.normalize() : new Vector3()
  const facing = normal.dot(upOf(from))
  let side = facing >= 0 ? 1 : -1
  // A move that hands over to a flight (PlanOptions.endRate) bows to the side it comes back from in the flight's own direction, so the
  // arrival turns into the flight instead of bowing one way and being bent back the other (an S at the join).
  if (bowable && arrive && Math.hypot(arrive.lon, arrive.lat) > 1e-9) {
    const ahead = dirOf(toLon + arrive.lon * 1e-3, toLat + arrive.lat * 1e-3).sub(d1)
    const across = ahead.dot(normal) / Math.max(1e-12, ahead.length())
    if (Math.abs(across) > 0.1) side = across > 0 ? -1 : 1
  }
  const fade = Math.max(0, Math.min(1, (theta / DEG - 2) / 8))
  const bowRad = bowable ? Math.min(BOW_SHARE * theta, BOW_MAX_DEG * DEG) * fade * (0.55 + 0.45 * Math.abs(facing)) : 0
  // Lean into the turn: the curve turns left when the bow lies to the right of the direction of travel (seen from above).
  let bankDeg = 0
  if (bowRad > 0) {
    const tangent = d1.clone().addScaledVector(d0, -d0.dot(d1)).normalize()
    const rightOfTravel = new Vector3().crossVectors(tangent, d0)
    const turnsLeft = normal.dot(rightOfTravel) * side > 0
    // A positive roll tilts the frame's up to the left: banked into a left turn.
    bankDeg = (turnsLeft ? 1 : -1) * Math.min(BANK_MAX_DEG, BANK_PER_BOW * bowRad / DEG)
  }
  return { bowRad, normal, side, bankDeg }
}
function bowedDir(d0: Vector3, d1: Vector3, p: number, bowRad: number, normal: Vector3, side: number): Vector3 {
  const dir = slerpDir(d0, d1, p)
  const bend = bowRad * Math.sin(Math.PI * p)
  return bend !== 0 ? dir.multiplyScalar(Math.cos(bend)).addScaledVector(normal, side * Math.sin(bend)).normalize() : dir
}
/**
 * The ground track of a move at travel share p (0 to 1) from `from` to (lon, lat): the great circle bowed by `bow`, and the bank
 * (deg of roll) at that point. Used by the site descents (descent/landing.ts) so they fly the same curve as a fly-to.
 */
export function bowedTravel(from: Pose, toLon: number, toLat: number, p: number, bow: Bow): { lon: number; lat: number; bankDeg: number } {
  if (p <= 0) return { lon: from.lon, lat: from.lat, bankDeg: 0 }
  if (p >= 1) return { lon: toLon, lat: toLat, bankDeg: 0 }
  const dir = bowedDir(dirOf(from.lon, from.lat), dirOf(toLon, toLat), p, bow.bowRad, bow.normal, bow.side)
  const lon = Math.atan2(dir.y, dir.x) / DEG
  return { lon: from.lon + wrapLon(lon - from.lon), lat: Math.asin(Math.max(-1, Math.min(1, dir.z))) / DEG, bankDeg: bow.bankDeg * Math.sin(Math.PI * p) }
}

/**
 * Plans a move from one end to another. Pure: depends only on the two ends, the ephemeris of the destination and the aspect.
 *
 * The shape (2026-10-17, owner: "one long bow ... like a spacecraft leaning into it ... no wiggly, no back and forth"):
 * - Altitude and travel follow one zoom-and-pan path (zoomPanPath): the camera rises while it starts across, sees both ends
 *   from the top of the arc, and settles onto the destination, at a constant speed relative to what is in the frame. The old
 *   law dipped, climbed back and dived again (home to Copernicus: 4.3, 3.4, 4.3, 1.2 radii) and crammed the travel into the middle.
 * - The path bows to one side of the great circle (BOW_SHARE of the travel at its middle, zero at both ends), always toward the
 *   top of the starting frame: a destination on the left is reached by a long left-hand curve that sets off a little ahead and
 *   turns into the target, never a sideways slide or an S.
 * - A quarter of the travel (TURN_IN) follows the clock, so the descent still curves in toward the target, never a hover and a drop.
 * - The camera banks into that curve (roll, peaking mid-move, zero at both ends) and the move runs on flyEase (glide, not lunge).
 */
export function planFly(e: Ephemeris, from: FlyEnd, to: FlyEnd, opts: PlanOptions = {}): FlyPlan {
  const aspect = opts.aspect ?? 1.6
  const f = { ...from, pose: { ...from.pose } }
  const t = { ...to, pose: { ...to.pose, lat: Math.max(-89, Math.min(89, to.pose.lat)) } }
  t.pose.lon = f.pose.lon + wrapLon(t.pose.lon - f.pose.lon)
  t.pose.dist = Math.min(D_MAX, t.pose.dist)
  const d0 = dirOf(f.pose.lon, f.pose.lat), d1 = dirOf(t.pose.lon, t.pose.lat)
  // Altitude is measured above the ground under each end (a site below the datum is not "at the floor"), and the ground
  // blends between the two ends along the move.
  const g0 = groundOf(f.pose.dist, f.ground), g1 = groundOf(t.pose.dist, t.ground)
  const dMin = 1 + Math.min(g0, g1)
  const a0 = altitudeOf(f.pose.dist, f.ground), a1 = altitudeOf(t.pose.dist, t.ground)
  const theta = angularDistance(f.pose.lon, f.pose.lat, t.pose.lon, t.pose.lat)
  const zp = zoomPanPath(theta, a0, a1)
  const altCap = D_MAX - dMin
  // The top of the arc: the zoom-and-pan peak when it lies inside the move, else the higher end.
  const apexAlt = Math.min(altCap, zp.sPeak > 0 && zp.sPeak < zp.S ? zp.w(zp.sPeak) : Math.max(a0, a1))
  const apexDist = 1 + Math.max(g0, g1) + apexAlt
  // Legacy diagnostic: how far the path climbs above the log-linear blend of the two ends at its middle.
  const arc = theta >= 0.02 ? Math.max(0, Math.log(apexAlt) - (Math.log(a0) + Math.log(a1)) / 2) : 0
  const lookTurn = f.look === t.look ? 0 : (() => {
    const p = posOf(e, t.pose)
    return Math.acos(Math.max(-1, Math.min(1, lookDir(e, p, 0).dot(lookDir(e, p, 1))))) / DEG
  })()
  const feel = opts.feel ? feelPath(theta, a0, a1, apexAlt) : null
  const ms = opts.ms ?? (feel ? feelDurationMs(feel.S, lookTurn) : flyDurationMs(f.pose, t.pose, lookTurn, g0, g1)) + (opts.endRate ? JOIN_GLIDE_MS : 0)
  const glide = opts.endRate ? Math.min(0.25, JOIN_GLIDE_MS / ms) : 0
  const { bowRad, normal, side, bankDeg } = bowOf(f.pose, t.pose.lon, t.pose.lat, opts.endRate)
  const progressOf = (s: number): number => {
    if (theta >= 1e-9) return Math.max(0, Math.min(1, zp.u(s) / theta))
    const span = Math.log(a1 / a0)
    return Math.abs(span) < 1e-12 ? s / Math.max(zp.S, 1e-12) : Math.max(0, Math.min(1, Math.log(zp.w(s) / a0) / span))
  }
  const baseRaw = (k: number, ws: number): Omit<FlyState, 'look'> & { look: number } => {
    const s = zp.S * k
    // A quarter of the travel follows the clock instead of the zoom-and-pan curve, so the camera keeps curving in as it comes
    // down and turns into the destination on the approach, instead of crossing high up and then dropping straight onto it.
    // v2 (feel): the flat path's own travel share and altitude at perceptual progress k.
    const fk = feel ? feel.at(k) : null
    const p = fk ? fk.p : zp.S > 0 ? (1 - TURN_IN) * progressOf(s) + TURN_IN * k : k
    const dir = bowedDir(d0, d1, p, bowRad, normal, side)
    const alt = fk ? Math.min(altCap, fk.alt) : zp.S > 0 ? Math.min(altCap, zp.w(s)) : a0
    const dist = 1 + g0 + (g1 - g0) * p + alt
    const fromPitch = f.pose.pitch ?? 0, toPitch = t.pose.pitch ?? 0
    return {
      pose: {
        lon: Math.atan2(dir.y, dir.x) / DEG, lat: Math.asin(Math.max(-1, Math.min(1, dir.z))) / DEG,
        dist,
        roll: f.pose.roll + (t.pose.roll - f.pose.roll) * k + bankDeg * Math.sin(Math.PI * p),
        pitch: fromPitch + (toPitch - fromPitch) * k,
      },
      fovDeg: Math.exp(Math.log(f.fovDeg) + (Math.log(t.fovDeg) - Math.log(f.fovDeg)) * k),
      aimShift: f.aimShift + (t.aimShift - f.aimShift) * k,
      aimShiftX: f.aimShiftX + (t.aimShiftX - f.aimShiftX) * k,
      look: f.look === t.look ? f.look : f.look + (t.look - f.look) * ease((k - ws) / LOOK_SPAN),
    }
  }
  // A hand-over bends the last 30 % of the path so the pose rate at the end is the flight's own start rate (direction as well as speed).
  // The correction lives in `base`, so the safety sampling below sees the path that is flown.
  let endSlope = 0
  let corr: { lon: number; lat: number; dist: number } | null = null
  if (opts.endRate) {
    const r = opts.endRate, dk = 1e-3
    const pEnd = { ...t.pose }, pAhead = { ...t.pose, lon: t.pose.lon + r.lon * 1e-3, lat: t.pose.lat + r.lat * 1e-3, dist: t.pose.dist + r.dist * 1e-3 }
    const speed = posOf(e, pAhead).distanceTo(posOf(e, pEnd)) / 1e-3
    const b1 = baseRaw(1, 0).pose, b0 = baseRaw(1 - dk, 0).pose
    const perK = posOf(e, b1).distanceTo(posOf(e, b0)) / dk
    if (speed > 0 && perK > 1e-9) {
      endSlope = Math.min(glideSlopeMax(glide), speed * (ms / 1000) / perK)
      if (endSlope > 1e-6) {
        // Wanted pose rate per unit k at the end, minus the path's own.
        const sc = ms / 1000 / endSlope
        corr = {
          lon: r.lon * sc - wrapLon(b1.lon - b0.lon) / dk,
          lat: r.lat * sc - (b1.lat - b0.lat) / dk,
          dist: r.dist * sc - (b1.dist - b0.dist) / dk,
        }
      }
    }
  }
  // v2 carry: the clock starts at speed v0 (the incoming speed over the path's own, so the magnitude matches) and a correction that fades
  // out over the first FEEL_CARRY_K of the path (h(0) = 0, h'(0) = 1, h, h' and h'' zero at its end) supplies the rest of the incoming
  // velocity: its direction, the lens rate, roll and pitch rates. At u = 0 the pose rate is then exactly the incoming one.
  let v0 = 0
  let carryK = FEEL_CARRY_K
  let carry: { lon: number; lat: number; dist: number; roll: number; pitch: number; lfov: number } | null = null
  if (feel && opts.startRate) {
    const r = opts.startRate, dk = 1e-4, msS = ms / 1000
    const q0 = baseRaw(0, 0), q1 = baseRaw(dk, 0)
    const altOf = (dist: number): number => Math.max(1e-6, dist - 1 - Math.min(g0, g1))
    const d0 = {
      lon: wrapLon(q1.pose.lon - q0.pose.lon) / dk, lat: (q1.pose.lat - q0.pose.lat) / dk, dist: Math.log(altOf(q1.pose.dist) / altOf(q0.pose.dist)) / dk,
      roll: (q1.pose.roll - q0.pose.roll) / dk, pitch: ((q1.pose.pitch ?? 0) - (q0.pose.pitch ?? 0)) / dk, lfov: Math.log(q1.fovDeg / q0.fovDeg) / dk,
    }
    const p0 = posOf(e, f.pose)
    const vInV = posOf(e, { ...f.pose, lon: f.pose.lon + r.lon * 1e-3, lat: f.pose.lat + r.lat * 1e-3, dist: f.pose.dist + r.dist * 1e-3 }).sub(p0).divideScalar(1e-3)
    const vPathV = posOf(e, q1.pose).sub(posOf(e, q0.pose)).divideScalar(dk)
    const vIn = vInV.length(), vPath = vPathV.length()
    // The harder the turn (up to a reversal), the longer the share of the path it is spread over.
    const cos = vIn > 1e-9 && vPath > 1e-12 ? vInV.dot(vPathV) / (vIn * vPath) : 1
    carryK = Math.min(FEEL_CARRY_K_MAX, FEEL_CARRY_K * (1 + (1 - cos)))
    // The distance is carried in the log of the altitude: a carried descent then eases toward the ground and can never reach it (no clamp,
    // which would put a kink in the velocity).
    const rIn = { lon: r.lon, lat: r.lat, dist: r.dist / altOf(f.pose.dist), roll: r.roll ?? 0, pitch: r.pitch ?? 0, lfov: (r.fov ?? 0) / f.fovDeg }
    const moving = vIn > 1e-6 || Math.abs(rIn.lfov) > 1e-4 || Math.abs(rIn.roll) > 1e-3 || Math.abs(rIn.pitch) > 1e-3
    if (moving) {
      // The clock carries the part of the speed that already points along the new path; the rest (sideways, or backwards in a reversal) is the
      // correction's, which a slower clock spreads over more time, so a reversal decelerates and turns instead of whipping round.
      v0 = Math.max(FEEL_V0_MIN, Math.min(FEEL_V0_MAX, vPath > 1e-12 ? Math.max(0, cos) * vIn * msS / vPath : 0))
      const c = (key: keyof typeof rIn): number => rIn[key] * msS / v0 - d0[key]
      // Defence in depth: whatever rate comes in, the correction's largest excursion (at its peak, x = 1/4) stays inside a bound, so an absurd start rate
      // (a relabel the caller did not catch) can never turn the path through many full turns or fling it across the Moon.
      // Longitude is bounded as SURFACE travel: a degree of longitude is cos(lat) of a degree on the ground, so a coast near a pole needs a large longitude correction.
      const lonBound = CARRY_MAX_EXCURSION.angle / Math.max(0.1, Math.cos(f.pose.lat * Math.PI / 180))
      // A fast near-reversal (a re-pick back the way it came) needs more travel excursion than the bound over the usual share: clipping it stepped the speed
      // (up to 81 %). The turn is then taken over a shorter share of the path, so the camera brakes harder and turns within the bound with its speed intact.
      // A longer move would not help: the reversal's clock starts at FEEL_V0_MIN, so a longer move only lengthens the correction's time and grows the
      // excursion. Only the travel (longitude, latitude, altitude) sets the shrink: a roll, pitch or lens rate is clipped as before and never sharpens the
      // turn. See carryShrink for how far it goes.
      const need = Math.max(Math.abs(c('lon')) / lonBound, Math.abs(c('lat')) / CARRY_MAX_EXCURSION.angle, Math.abs(c('dist')) / CARRY_MAX_EXCURSION.logDist) * carryK * 0.10546875
      carryK /= carryShrink(need)
      const peak = carryK * 0.10546875, lim = (v: number, excursion: number): number => Math.max(-excursion / peak, Math.min(excursion / peak, v))
      carry = { lon: lim(c('lon'), lonBound), lat: lim(c('lat'), CARRY_MAX_EXCURSION.angle), dist: lim(c('dist'), CARRY_MAX_EXCURSION.logDist), roll: lim(c('roll'), CARRY_MAX_EXCURSION.roll), pitch: lim(c('pitch'), CARRY_MAX_EXCURSION.pitch), lfov: lim(c('lfov'), CARRY_MAX_EXCURSION.logFov) }
    }
  }
  const base = (k: number, ws: number): Omit<FlyState, 'look'> & { look: number } => {
    let s = baseRaw(k, ws)
    if (carry && k < carryK) {
      const x = k / carryK, h = carryK * x * (1 - x) ** 3
      const ps = s.pose
      // The correction stays off the pole, but never pulls a path that is already closer to it (a coast over the pole, |lat| up to 90) back: frame 1 is the start pose.
      const latCap = Math.min(90, Math.max(89.5, Math.abs(ps.lat)))
      s = { ...s, fovDeg: s.fovDeg * Math.exp(carry.lfov * h), pose: {
        lon: ps.lon + carry.lon * h, lat: Math.max(-latCap, Math.min(latCap, ps.lat + carry.lat * h)),
        dist: ps.dist + (ps.dist - 1 - Math.min(g0, g1)) * (Math.exp(carry.dist * h) - 1),
        roll: ps.roll + carry.roll * h, pitch: Math.max(0, (ps.pitch ?? 0) + carry.pitch * h),
      } }
    }
    if (!corr || k <= 0.7) return s
    const x = (k - 0.7) / 0.3, h = 0.3 * x * x * (x - 1)
    return { ...s, pose: { ...s.pose, lon: s.pose.lon + corr.lon * h, lat: s.pose.lat + corr.lat * h, dist: Math.max(1e-6, s.pose.dist + corr.dist * h) } }
  }
  // The safety sampling: widen the lens at a knot where neither body covers MIN_COVER. A look that changes subject turns over the
  // middle 40 % of the move; if that cannot keep a body in frame (the Moon and the Earth 90 deg apart from a far camera), the
  // window slides later, toward the end, where the camera has come round and the two are close together.
  const sample = (ws: number): { widen: number[]; cover: number[]; minRadius: number } => {
    const widenAt: number[] = [], cover: number[] = []
    let minRadius = Infinity
    for (let i = 0; i <= SAMPLES; i++) {
      const k = i / SAMPLES, s = base(k, ws)
      const pos = posOf(e, s.pose)
      minRadius = Math.min(minRadius, pos.length())
      const fwd = lookDir(e, pos, s.look)
      const up = e.moonZ.clone().addScaledVector(fwd, -e.moonZ.dot(fwd))
      if (up.lengthSq() < 1e-9) up.copy(e.moonX)
      up.normalize()
      let w = 1, c = subjectCover(e, pos, fwd, up, flyTanHalf(aspect, s.fovDeg), aspect)
      while (c < MIN_COVER && w < 8) {
        w *= 1.15
        c = subjectCover(e, pos, fwd, up, flyTanHalf(aspect, Math.min(MAX_FOV, s.fovDeg * w)), aspect)
      }
      widenAt.push(w)
      cover.push(c)
    }
    // A knot's neighbours share its widening, so the lens never narrows again between two knots that both need it.
    const widen = widenAt.map((w, i) => Math.max(w, widenAt[i - 1] ?? 1, widenAt[i + 1] ?? 1))
    // Both ends are the lenses the caller asked for, exactly.
    widen[0] = 1
    widen[SAMPLES] = 1
    return { widen, cover, minRadius }
  }
  let ws = 0.3
  let best = sample(ws)
  if (f.look !== t.look) {
    for (const cand of [0.4, 0.5, 0.6]) {
      if (Math.min(...best.cover) >= MIN_COVER) break
      const trial = sample(cand)
      if (Math.min(...trial.cover) > Math.min(...best.cover)) { best = trial; ws = cand }
    }
  }
  const { widen, cover, minRadius } = best
  const widenFor = (u: number): number => {
    const x = Math.max(0, Math.min(1, u)) * SAMPLES
    const i = Math.min(SAMPLES - 1, Math.floor(x)), fr = x - i
    return Math.exp(Math.log(widen[i]) + (Math.log(widen[i + 1]) - Math.log(widen[i])) * fr)
  }
  const exact = (end: FlyEnd): FlyState => ({ pose: { ...end.pose }, fovDeg: end.fovDeg, aimShift: end.aimShift, aimShiftX: end.aimShiftX, look: end.look })
  return {
    from: f, to: t, ms, endSlope, arc, widen, minCover: Math.min(...cover), minRadius,
    apexDist: feel ? 1 + Math.max(g0, g1) + Math.min(altCap, feel.apexAlt) : apexDist, startSpeed: v0,
    at(u: number): FlyState {
      if (u <= 0) return exact(f)
      if (u >= 1) return exact(t)
      // v2 ends a hand-over at the flight's slope through its own deceleration ramp (acceleration zero there), and starts at the carried speed.
      const k = feel ? feelEase(u, v0, endSlope) : endSlope > 0 ? easeGlide(u, endSlope, glide) : flyEase(u)
      const s = base(k, ws)
      // The widening is a function of the path position k, so it follows the picture, not the clock.
      return { ...s, fovDeg: Math.min(MAX_FOV, s.fovDeg * widenFor(k)) }
    },
  }
}
