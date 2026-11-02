import { type Pose, wrapLon } from '../camera/pose'
import type { PatchDemand } from '../moon/patch/demand'

/**
 * Apollo 17's arrival (feedback 2026-10-15, "sudden view changes"): the pin is ONE continuous journey from the current pose down to the eye-level ground
 * pose. The orbital descent (the Apollo 11 machinery: apex, gated clock, floor) hands over to ground mode at ARRIVAL_HANDOVER_U, still moving, and the
 * ground camera starts its glide with the descent's last velocity and eases out to the eye pose. Pure: main.ts supplies the poses and the times.
 */
export const ARRIVAL_HANDOVER_U = 0.93
/** The glide to the eye pose: never shorter than this (and the old 1.3 s glide when the descent hands over at rest), never longer than the max. */
export const ARRIVAL_GLIDE_MIN_MS = 1300
export const ARRIVAL_GLIDE_MAX_MS = 6000
/** Below this speed (m/s) the hand-over counts as at rest. */
export const ARRIVAL_REST_SPEED = 1
/** After the descent reaches its end without the module's model or the coarse photograph resident, the hand-over goes ahead anyway after this long. */
export const ARRIVAL_WAIT_MS = 6000
/** A landing descent that starts below the funnel, within this distance (m) of the eye pose, skips the descent: ground mode takes over at once and glides (no climb, no stop). */
export const ARRIVAL_DIRECT_M = 6000
/** The rate (deg/s) and velocity (m/s, east-north-up) the camera had when the descent handed over. */
export interface ArrivalCarry { v: Vec3; pitchRate: number }

const DEG = Math.PI / 180
export type Vec3 = [number, number, number]

/** An orbital pose in the site's east-north-up frame (metres): a tangent-plane approximation, exact enough for a rate over one frame and for tests. */
export function enuOfPose(p: Pose, site: { lon: number; lat: number }, groundM: number, moonRadiusM: number): Vec3 {
  const r = p.dist * moonRadiusM
  return [wrapLon(p.lon - site.lon) * DEG * Math.cos(site.lat * DEG) * r, (p.lat - site.lat) * DEG * r, (p.dist - 1) * moonRadiusM - groundM]
}

/** The camera's velocity (m/s, east-north-up) between two frames' poses. Zero for a zero-length frame. */
export function poseVelocityENU(a: Pose, b: Pose, dtMs: number, site: { lon: number; lat: number }, groundM: number, moonRadiusM: number): Vec3 {
  if (!(dtMs > 0)) return [0, 0, 0]
  const pa = enuOfPose(a, site, groundM, moonRadiusM), pb = enuOfPose(b, site, groundM, moonRadiusM)
  const s = 1000 / dtMs
  return [(pb[0] - pa[0]) * s, (pb[1] - pa[1]) * s, (pb[2] - pa[2]) * s]
}

/**
 * The glide's length. At rest it is the quick 1.3 s glide. Moving, it is long enough that the glide's own speed profile stays monotone from the entry
 * speed down to rest (a cubic Hermite with entry speed v0 and zero exit speed falls monotonically while v0 * T / distance <= 3; this keeps it under 2.5).
 */
export function arrivalGlideMs(distanceM: number, speed: number): number {
  // At rest: the quick glide for a short way, longer for a long one (a start 2 km up takes about 4 s, not 1.3 s).
  if (speed < ARRIVAL_REST_SPEED || distanceM < 1e-6) return Math.min(ARRIVAL_GLIDE_MAX_MS, ARRIVAL_GLIDE_MIN_MS + 60 * Math.sqrt(Math.max(0, distanceM - 100)))
  const free = 1500 * distanceM / speed
  const lo = Math.min(ARRIVAL_GLIDE_MIN_MS, 2500 * distanceM / speed)
  return Math.max(lo, Math.min(ARRIVAL_GLIDE_MAX_MS, free))
}

/** Position at glide progress s (0 to 1) of a cubic Hermite from p0 to p1 over `ms`, leaving at velocity v0 (m/s) and arriving at rest. */
export function hermitePos(p0: Vec3, p1: Vec3, v0: Vec3, ms: number, s: number): Vec3 {
  const t = Math.max(0, Math.min(1, s)), t2 = t * t, t3 = t2 * t
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2
  const T = ms / 1000
  return [0, 1, 2].map((i) => h00 * p0[i] + h10 * T * v0[i] + h01 * p1[i]) as Vec3
}

/** One axis of the same curve (an angle, degrees; the rate in deg/s). */
export function hermite1(a0: number, a1: number, rate0: number, ms: number, s: number): number {
  return hermitePos([a0, 0, 0], [a1, 0, 0], [rate0, 0, 0], ms, s)[0]
}

/** The carried angular rate, held to the Hermite's monotone region (|rate| * T <= 2.5 * |distance|), so a fast tilt cannot overshoot the end pitch. */
export function clampAngleRate(rate: number, distance: number, ms: number): number {
  const lim = 2500 * Math.abs(distance) / Math.max(1, ms)
  return Math.max(-lim, Math.min(lim, rate))
}

/** Whether a landing descent skips the climb and the descent: the camera is already below the funnel and within ARRIVAL_DIRECT_M of the site (ENU, metres; the eye pose is 20 m from its origin). */
export function directArrival(enu: Vec3, distRadii: number, funnelDist: number): boolean {
  return distRadii < funnelDist && Math.hypot(enu[0], enu[1], enu[2]) <= ARRIVAL_DIRECT_M
}

/**
 * The arrival hold (`?a17arrive=hold`, owner complaint 7, 2026-10-23: "fly first to the spot where the lander is and then zoom in"). Recorded at 2:15-2:25
 * of the owner's session: the drop started on the coarse photograph alone (readyCoarse, one bound level) and the fine levels, the module and the patch
 * shadow blocks arrived during and after it, so the arrival was a blurry grey ground with black blobs. Now the fly-to ends at a HELD oblique overview of the
 * valley with the site in the middle (ARRIVAL_HOLD_DIST, ARRIVAL_HOLD_PITCH_DEG), and the drop (beat 2, the path unchanged) starts only when `landingReady`.
 * Pure: main.ts supplies the counts, the clock and the camera.
 */
/** The overview's distance from the Moon's centre (radii; about 69 km up: the global tiles are sharp there, no patch level is needed) and its tilt from straight down. */
export const ARRIVAL_HOLD_DIST = 1.04
export const ARRIVAL_HOLD_PITCH_DEG = 55
/** The longest the overview is held for the shadow cache and the ground programs; the levels and the module hold it longer (see landingReady). A cold link needs about this. */
export const ARRIVAL_HOLD_MAX_MS = 12000

/**
 * The levels the eye view needs resident, from the site's DECLARED level count (the manifest's, less any whose fetch failed; never the resident count, which the
 * hold is there to grow): every one but the finest (the 25 cm tier is a refinement the ground glide can take), never fewer than one.
 */
export function holdLevelsWanted(declared: number, failed = 0): number {
  return Math.max(1, declared - failed - 1)
}

/**
 * The patch demand of a scripted arrival: the descent's, and the hold's. At the overview (69 km) the free, camera-derived demand wants the coarse bridge alone
 * (demand.ts caps the sub-4 m levels at 10 km and 4 m per pixel), so a hold fed the free demand would wait for levels it never asked for, and a repeat visit
 * would evict the fine levels it had. Every level, retained until the arrival ends (`hold`).
 */
export const ARRIVAL_PATCH_DEMAND: PatchDemand = { altitudeKm: 0, metresPerPixel: 0.01, zoomedIn: true, hold: true }
export function arrivalPatchDemand(scripted: boolean, free: PatchDemand): PatchDemand {
  return scripted ? ARRIVAL_PATCH_DEMAND : free
}

/**
 * Whether the drop may start. The levels the eye view reads and the module's model are the picture: without them the drop lands in a blur, so they hold it
 * however long they take (a stall shows its chip, landingHoldStalled). The patch shadow blocks still to build (`unmet`) and the ground programs' warm-up are
 * speed, not sharpness: they hold the drop only up to ARRIVAL_HOLD_MAX_MS.
 */
export function landingReady(levelsResident: number, levelsWanted: number, unmet: number, lmReady: boolean, waitedMs: number, groundWarm = true): boolean {
  if (!lmReady || levelsResident < levelsWanted) return false
  if (waitedMs >= ARRIVAL_HOLD_MAX_MS) return true
  return unmet <= 0 && groundWarm
}

/** The hold has run past its cap and the picture is still not there: the overview stays, with a status chip and a retry, never a drop into a blur. */
export function landingHoldStalled(levelsResident: number, levelsWanted: number, lmReady: boolean, waitedMs: number): boolean {
  return waitedMs >= ARRIVAL_HOLD_MAX_MS && (!lmReady || levelsResident < levelsWanted)
}

/**
 * The held overview: `dist` from the centre, tilted `tiltDeg` from straight down (the radial), backed off the site along the reverse of the end heading by the
 * arc that puts the site in the middle of the frame, the frame's top toward the heading. On the sphere a ground point at radius rho sits `tilt` from the nadir
 * of a camera at `dist` when rho sin(arc + tilt) = dist sin(tilt) (the flat-ground range, alt tan(tilt), is 0.4 deg short this high up). `relief` is the rig's
 * pitch scale at that distance (reliefShare: 1 below 1.8 radii), so the tilt drawn is the tilt asked for.
 */
export function arrivalHoldPose(site: { lon: number; lat: number }, headingDeg: number, groundR: number, relief: (dist: number) => number, dist = ARRIVAL_HOLD_DIST, tiltDeg = ARRIVAL_HOLD_PITCH_DEG): Pose {
  const rho = 1 + groundR
  const tilt = tiltDeg * DEG
  const r = Math.max(0, Math.asin(Math.min(1, dist * Math.sin(tilt) / rho)) - tilt)
  const h = headingDeg * DEG
  const lat = site.lat - r / DEG * Math.cos(h)
  const lon = wrapLon(site.lon - r / DEG * Math.sin(h) / Math.max(0.05, Math.cos(lat * DEG)))
  return { lon, lat, dist, roll: -headingDeg, pitch: tiltDeg / Math.max(0.05, relief(dist)) }
}
