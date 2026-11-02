import { Quaternion, Vector3 } from 'three'
import { basisFromQuat, quatFromBasis, poseFromView, type ViewCamera } from '../camera/pose'
import { flightPrefetchTargets } from '../net/flightPrefetch'
import type { PrefetchTarget } from '../net/prefetch'

/**
 * The opening flight (owner, 2026-10-14; nine prototypes came before it): the camera's way
 * in to Home once the splash lifts. A pure function of progress u (0..1), the Home camera of this frame and the Sun's
 * direction; at u = 1 it returns the Home camera exactly, so the hand-off to the rig is not a cut, and a grab part-way settles
 * the rig on the camera shown (main.ts). Lengths are Moon radii in the world frame, as everywhere else (camera/pose.ts).
 */

export interface OpeningScene {
  /** Unit vector, Moon to Sun. */
  sunDir: Vector3
  /** 'legacy': the pre-2026-10-14 placement (pass at sunAng - 70 clamped to 45..110, spot offset one way), for rig A/B (?introplace=legacy). */
  placement?: 'sunrise' | 'legacy'
}

export interface Opening {
  ms: number
  /** What has to be on screen before it starts (it flies low, so the surface tiles). */
  needs: { tiles?: boolean }
  camera(u: number, home: ViewCamera, s: OpeningScene): ViewCamera
}

const DEG = Math.PI / 180
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))
/** C2 ease in and out (zero speed and acceleration at both ends). */
export const ease = (x: number): number => { const t = clamp01(x); return t * t * t * (t * (6 * t - 15) + 10) }
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const logLerp = (a: number, b: number, t: number): number => Math.exp(lerp(Math.log(a), Math.log(b), t))
/** Progress of u through the window [a, b], 0..1. */
const win = (u: number, a: number, b: number): number => clamp01((u - a) / (b - a))

/** Any unit vector perpendicular to v. */
function perpendicular(v: Vector3): Vector3 {
  const a = Math.abs(v.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)
  return a.cross(v).normalize()
}

/** The unit axis of the turn from a toward b (a x b), or any perpendicular when they are (anti)parallel. */
function turnAxis(a: Vector3, b: Vector3): Vector3 {
  const c = new Vector3().crossVectors(a, b)
  return c.lengthSq() > 1e-10 ? c.normalize() : perpendicular(a)
}

/** Great-circle interpolation between two unit vectors. */
export function slerpDir(a: Vector3, b: Vector3, t: number): Vector3 {
  const angle = Math.acos(Math.max(-1, Math.min(1, a.dot(b))))
  if (angle < 1e-6) return a.clone()
  return a.clone().applyAxisAngle(turnAxis(a, b), angle * t).normalize()
}

/** A camera at `pos` looking along `look`, with `upHint` as near to up as the look allows. */
export function lookCamera(pos: Vector3, look: Vector3, upHint: Vector3, tanHalf: number): ViewCamera {
  const back = look.clone().normalize().negate()
  let right = new Vector3().crossVectors(upHint, back)
  if (right.lengthSq() < 1e-10) right = perpendicular(back)
  right.normalize()
  const up = new Vector3().crossVectors(back, right).normalize()
  return { pos: pos.clone(), right, up, back, tanHalf }
}

/** The camera turned by `angle` about its own line of sight (positive: counter-clockwise on screen). */
function rolled(cam: ViewCamera, angle: number): ViewCamera {
  const axis = cam.back
  return { ...cam, right: cam.right.clone().applyAxisAngle(axis, angle), up: cam.up.clone().applyAxisAngle(axis, angle) }
}

/**
 * Between two cameras: the position along the great circle about the Moon's centre with the distance eased in log (so it
 * never cuts through the Moon and a long pull covers each doubling in the same time), the orientation slerped, the lens
 * eased in log. t = 0 is a, t = 1 is b exactly.
 */
export function mixCamera(a: ViewCamera, b: ViewCamera, t: number): ViewCamera {
  if (t <= 0) return a
  if (t >= 1) return b
  const da = a.pos.length(), db = b.pos.length()
  const pos = slerpDir(a.pos.clone().normalize(), b.pos.clone().normalize(), t).multiplyScalar(logLerp(da, db, t))
  const q = new Quaternion().slerpQuaternions(quatFromBasis(a.right, a.up, a.back), quatFromBasis(b.right, b.up, b.back), t)
  const { right, up, back } = basisFromQuat(q)
  return { pos, right, up, back, tanHalf: logLerp(a.tanHalf, b.tanHalf, t) }
}

/** The opening's own camera handed over to Home over the last part of the move [from, 1]. */
function landHome(own: ViewCamera, home: ViewCamera, u: number, from: number): ViewCamera {
  return mixCamera(own, home, ease(win(u, from, 1)))
}

function homeFrame(home: ViewCamera): { dir: Vector3; dist: number } {
  return { dir: home.pos.clone().normalize(), dist: home.pos.length() }
}

/** A point of a clamped uniform cubic B-spline (C2 everywhere) through `pts`, at t in [0, pts.length - 3]. */
export function bspline(pts: readonly Vector3[], t: number): Vector3 {
  const n = pts.length - 1
  const segs = n - 2
  const knot = (i: number): number => Math.min(segs, Math.max(0, i - 3))
  const x = Math.min(segs, Math.max(0, t))
  // The knot span: the segment x lies in (the last one includes its end).
  const k = Math.min(segs - 1, Math.floor(x)) + 3
  const d = [0, 1, 2, 3].map((j) => pts[j + k - 3].clone())
  for (let r = 1; r <= 3; r++) {
    for (let j = 3; j >= r; j--) {
      const i = j + k - 3
      const den = knot(i + 4 - r) - knot(i)
      const a = den > 0 ? (x - knot(i)) / den : 0
      d[j] = d[j - 1].clone().multiplyScalar(1 - a).add(d[j].clone().multiplyScalar(a))
    }
  }
  return d[3]
}

/** The pace along the path: a quarter of the mean speed at the first frame (under the splash's fade), up to 1.4x at the pass, at rest on Home. */
const pace = (x: number): number => { const c = clamp01(x); return 0.25 * c + 0.75 * c * c * (3 - 2 * c) }

/** The flight's path and its screen-speed table: rebuilt only when Home's position or the Sun moves (not on every call). */
interface FlybyPath { key: string; P: number; ctrl: Vector3[]; ts: Float64Array; sig: Float64Array; n: Vector3; spot: Vector3 }
let cached: FlybyPath | null = null

function flybyPath(home: ViewCamera, s: OpeningScene): FlybyPath {
  const key = [home.pos.x, home.pos.y, home.pos.z, home.up.x, home.up.y, home.up.z, s.sunDir.x, s.sunDir.y, s.sunDir.z, s.placement ?? ''].join(',')
  if (cached && cached.key === key) return cached
  const { dir: dh, dist: rh } = homeFrame(home)
  // The plane of the flight: Home's direction and the way toward the Sun from it, 20 deg off so the arc climbs across the frame.
  let q = s.sunDir.clone().addScaledVector(dh, -s.sunDir.dot(dh))
  q = q.lengthSq() > 1e-8 ? q.normalize() : home.right.clone()
  q.applyAxisAngle(dh, 20 * DEG)
  // Its normal, on Home's up side: the camera's up the whole way, so the view never rolls over.
  let n = new Vector3().crossVectors(dh, q).normalize()
  if (n.dot(home.up) < 0) n = n.negate()
  // The pass: where the Sun stands about 20 deg up (grazing light shows relief), kept 45 to 110 deg round from Home. Toward the Sun
  // side of the spot when that fits (P = sunAng - 70); else, near full Moon, past it (P = sunAng + 70); in between (sunAng 40..115)
  // neither fits, so the end of the window with the larger Sun-to-spot angle (the lower Sun). 'legacy' keeps the first rule only.
  const sunAng = Math.atan2(s.sunDir.dot(q), s.sunDir.dot(dh)) / DEG
  const legacyP = Math.min(110, Math.max(45, sunAng - 70))
  let P = legacyP
  if (s.placement !== 'legacy' && sunAng - 70 < 45) {
    P = sunAng + 70 <= 110 ? sunAng + 70 : (Math.abs(sunAng - 45) >= Math.abs(sunAng - 110) ? 45 : 110)
  }
  const at = (phiDeg: number, r: number): Vector3 => {
    const ph = phiDeg * DEG
    return dh.clone().multiplyScalar(Math.cos(ph)).addScaledVector(q, Math.sin(ph)).multiplyScalar(r)
  }
  // Control points (angle round the Moon from Home, distance): one direction only, curving in to the pass and out to Home.
  const ctrl = [at(P + 38, 16), at(P + 34, 9.5), at(P + 24, 3.6), at(P + 8, 1.25), at(P - 10, 1.21), at(P - 30, 2.1), at((P - 30) * 0.4, 3.8), at(0, rh)]
  // Screen speed: arc length over height above a reference just under the ground, tabulated so it can be walked evenly.
  const N = 480, T = ctrl.length - 3
  const ts = new Float64Array(N + 1), sig = new Float64Array(N + 1)
  let prev = bspline(ctrl, 0), acc = 0
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * T
    const p = bspline(ctrl, t)
    if (i > 0) acc += p.distanceTo(prev) / Math.max(0.2, (p.length() + prev.length()) / 2 - 0.8)
    ts[i] = t; sig[i] = acc; prev = p
  }
  // The spot: on the ground beside the pass, a little toward the normal, so the camera passes it rather than over it.
  // Offset toward the side with the lower Sun (legacy: always +n).
  const side = (sg: number): Vector3 => at(P, 1).normalize().addScaledVector(n, 0.32 * sg).normalize()
  const spot = s.placement === 'legacy' || side(1).dot(s.sunDir) <= side(-1).dot(s.sunDir) ? side(1) : side(-1)
  cached = { key, P, ctrl, ts, sig, n, spot }
  return cached
}

/** The ground spot the flyby aims at (unit vector), for tests and review tools. */
export function flybySpot(home: ViewCamera, s: OpeningScene): Vector3 { return flybyPath(home, s).spot.clone() }

/** Where the flight is at progress x: the eased pace mapped through the screen-speed table onto the spline. */
function flybyPos(f: FlybyPath, x: number): Vector3 {
  const N = f.sig.length - 1
  const want = pace(x) * f.sig[N]
  let lo = 0, hi = N
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (f.sig[mid] < want) lo = mid; else hi = mid }
  const k = f.sig[hi] > f.sig[lo] ? (want - f.sig[lo]) / (f.sig[hi] - f.sig[lo]) : 0
  return bspline(f.ctrl, f.ts[lo] + (f.ts[hi] - f.ts[lo]) * k)
}

/**
 * The flyby (owner, 2026-10-14: fly toward the Moon already heading roughly for the spot of a near-surface flyby; past it, pan
 * round to keep it in view; a smooth sweeping arc curving in like an orbital approach, subtle banking as it turns, a smooth
 * spline with eased motion). One C2 cubic B-spline in a plane through the Moon's centre: from 16 radii, aimed near the spot and
 * curving in, the pass about 450 km over the sunlit ground (~820 km until 2026-10-14; ledger "Low flights raised 1.5x" retry), placed where the Sun stands low over the spot, then curving out to Home. Walked at an eased pace in screen speed
 * (distance over height), so the far approach and the low pass move at the same visual rate; the frame-to-frame speed change
 * stays under about 8 % at 60 fps. The camera keeps the spot in its sights the whole way, panning round as it passes, then
 * settles on the Moon's centre; one up throughout, and a subtle bank (up to 12 deg) that follows the curve's turn.
 */
export const FLYBY: Opening = {
  ms: 9000,
  needs: { tiles: true },
  camera(u, home, s) {
    const f = flybyPath(home, s)
    const pos = flybyPos(f, u)
    const toCentre = ease(win(u, 0.6, 0.95))
    const look = f.spot.clone().multiplyScalar(1 - toCentre).sub(pos).normalize()
    // The bank: the turn of the path about the plane's normal, averaged over about a second, eased out before Home.
    const heading = (x: number): Vector3 => flybyPos(f, Math.min(1, x + 0.01)).sub(flybyPos(f, Math.max(0, x - 0.01))).normalize()
    let turn = 0
    for (let i = -2; i <= 2; i++) {
      const x = clamp01(u + i * 0.02)
      turn += new Vector3().crossVectors(heading(Math.max(0, x - 0.03)), heading(Math.min(1, x + 0.03))).dot(f.n) / 5
    }
    const bank = 12 * DEG * Math.tanh(4 * turn) * (1 - ease(win(u, 0.7, 0.95)))
    const tanHalf = logLerp(home.tanHalf * 0.8, Math.tan(22 * DEG), ease(win(u, 0.25, 0.5)) * (1 - ease(win(u, 0.58, 0.92))))
    const own = rolled(lookCamera(pos, look, f.n, tanHalf), bank)
    // The spline already ends on Home's position; the long hand-over only turns the view onto Home's exactly.
    return landHome(own, home, u, 0.7)
  },
}

/**
 * The tiles the opening's pass needs, first need first, for the splash to wait on: path centres only (no gazetteer-feature flood),
 * nothing deeper than level -1 (the pass wants height level -1 at most), and only the flight up to progress `upTo` (the rest streams
 * during the flight at the flight rate). Bounded on purpose: scripts/intro-flyby.test.mts pins its size.
 */
export function openingPrefetchTargets(home: ViewCamera, s: OpeningScene, ephem: Parameters<typeof poseFromView>[0], aspect: number, upTo = 0.65): PrefetchTarget[] {
  return flightPrefetchTargets((u) => {
    const c = FLYBY.camera(u * upTo, home, s)
    return { pose: poseFromView(ephem, c), fovDeg: 2 * Math.atan(c.tanHalf) * 180 / Math.PI }
  }, FLYBY.ms * upTo, { aspect, leadMs: 2000, features: false, minLevel: -1 })
}
