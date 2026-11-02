import data from './routes.json'
import { angularDistance, wrapLon } from '../camera/pose'
import { MOON_R_KM } from '../glsl/common'

/**
 * Apollo paths drawn on the Moon and flown along (scripts/build-routes.mts writes routes.json from the repository's own data; every
 * coordinate there is a source's, converted, never drawn by hand). A route is one or more polylines of [lon, lat] degrees.
 */
export interface Route {
  id: string
  name: string
  mission: string
  kind: 'descent' | 'traverse'
  /** True when the shape is a model's (the Apollo 17 descent's downrange), not a measured track. Shown in the caption. */
  estimated: boolean
  /** Altitude above the ground at each point of the first segment, metres (descents). */
  altM?: number[]
  segments: number[][][]
  source: string
  /** The real time of the event, when the source gives one (the sun and the Earth are drawn for it); otherwise the view keeps the sky of the photograph. */
  utc?: string
}
export const ROUTES: Route[] = (data as { routes: Route[] }).routes

/** Paths that exist for a mission, and what is not held (never approximated). */
export const MISSING: string[] = [
  'Apollo 11 powered descent and ascent ground tracks', 'Apollo 12, 14, 15 and 16 descent and ascent ground tracks', 'Apollo 17 ascent ground track',
  'Apollo 15 and 16 rover traverses', 'Apollo 11, 12 and 14 walking traverses',
]

const DEG = Math.PI / 180

/** The whole route as one point list in order (segments joined). */
export const flatten = (r: Route): number[][] => r.segments.flat()

/** Cumulative great-circle length along a point list, km (index 0 is 0). */
export function cumulativeKm(pts: number[][]): number[] {
  const out = [0]
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + angularDistance(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) * MOON_R_KM)
  return out
}

/**
 * Gaps in a point list that are jumps between separate legs (a rover's stations, 2.4 and 4.9 km apart, joined only by the file order), not
 * driven road: longer than 0.5 km and 20 times the median spacing. Cumulative-length intervals [from, to].
 */
const hopCache = new WeakMap<number[], Array<[number, number]>>()
export function hopsOf(cum: number[]): Array<[number, number]> {
  const known = hopCache.get(cum)
  if (known) return known
  const gaps = cum.slice(1).map((c, i) => c - cum[i]).sort((x, y) => x - y)
  const med = gaps[gaps.length >> 1] ?? 0
  const limit = Math.max(0.5, 20 * med)
  const out: Array<[number, number]> = []
  for (let i = 1; i < cum.length; i++) if (cum[i] - cum[i - 1] > limit) out.push([cum[i - 1], cum[i]])
  hopCache.set(cum, out)
  return out
}

/**
 * The point at fraction u of the way along (by length) and the travel bearing there in degrees clockwise from north, smoothed over
 * +-`window` of the length but never across a hop between legs (the window is cut at the leg's ends, and on a hop itself the bearing is the hop's own).
 */
export function pointAlong(pts: number[][], cum: number[], u: number, window = 0.03): { lon: number; lat: number; bearing: number } {
  const total = cum[cum.length - 1]
  const at = (f: number): [number, number] => {
    const s = Math.max(0, Math.min(1, f)) * total
    let i = 1
    while (i < cum.length - 1 && cum[i] < s) i++
    const seg = cum[i] - cum[i - 1]
    const k = seg > 0 ? (s - cum[i - 1]) / seg : 0
    const a = pts[i - 1], b = pts[i]
    return [wrapLon(a[0] + wrapLon(b[0] - a[0]) * k), a[1] + (b[1] - a[1]) * k]
  }
  const [lon, lat] = at(u)
  const s = Math.max(0, Math.min(1, u)) * total
  const hops = hopsOf(cum)
  // The span the bearing may look across: the leg this point is on, or the hop itself.
  let lo = 0, hi = total
  const onHop = hops.find((h) => s >= h[0] && s <= h[1])
  if (onHop) { lo = onHop[0]; hi = onHop[1] } else {
    for (const h of hops) { if (h[1] <= s) lo = Math.max(lo, h[1]); if (h[0] >= s) hi = Math.min(hi, h[0]) }
  }
  const f0 = Math.max(lo, s - window * total) / total, f1 = Math.min(hi, s + window * total) / total
  const [l0, b0] = at(f0), [l1, b1] = at(f1)
  const dE = wrapLon(l1 - l0) * Math.cos(lat * DEG), dN = b1 - b0
  const bearing = dE === 0 && dN === 0 ? 0 : ((Math.atan2(dE, dN) / DEG) + 360) % 360
  return { lon, lat, bearing }
}

/** Quintic ease in and out. */
export const ease = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * t * (t * (t * 6 - 15) + 10) }

/**
 * The camera of a fly-along at progress u (0..1 of the show; a pure function of u, so the frame rate cannot change the path):
 * the camera rises to see the whole route, then follows the point at a low height with the direction of travel up the screen,
 * and sinks to `endDist` over the last stretch. `floorAt` is the zoom floor over a position (rig.floorAt), so the path never goes lower
 * than the data allows there.
 */
export interface RouteView { overviewDist: number; followDist: number; endDist: number; floorAt(lon: number, lat: number): number; /** The show's length in seconds (the roll's rate limit is per second); 14 when absent. */ seconds?: number }

/** Natural frequency (rad/s) of the roll's critically damped follower: a 180 degree turn peaks at 180 * w / e = 79 degrees per second, under the 90 the review asked for. */
export const ROLL_OMEGA = 1.2
const ROLL_STEPS = 4000
const rollCache = new WeakMap<number[], { seconds: number; track: Float64Array }>()
/** Destination of a great-circle step of `km` from (lon, lat) on `bearingDeg` (clockwise from north). */
export function offsetBy(lon: number, lat: number, bearingDeg: number, km: number): { lon: number; lat: number } {
  const d = km / MOON_R_KM, th = bearingDeg * DEG, la = lat * DEG
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(th))
  const lo2 = lon * DEG + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2))
  return { lon: wrapLon(lo2 / DEG), lat: la2 / DEG }
}
/**
 * The roll over the show: the nadir view's up is north, rolled by minus the bearing so the travel runs up the screen, then followed by a
 * critically damped filter (smooth, and a turn of any size, such as the turnaround between two legs, takes about a second and a half at
 * under 90 degrees a second instead of flipping in a frame). Computed once per route and show length, sampled by progress.
 */
function rollTrack(pts: number[][], cum: number[], seconds: number): Float64Array {
  const known = rollCache.get(cum)
  if (known && known.seconds === seconds) return known.track
  const track = new Float64Array(ROLL_STEPS + 1)
  const dt = seconds / ROLL_STEPS
  let x = 0, v = 0
  for (let i = 0; i <= ROLL_STEPS; i++) {
    const u = i / ROLL_STEPS
    const b = pointAlong(pts, cum, ease((u - 0.12) / 0.76)).bearing
    let target = -(b > 180 ? b - 360 : b) * ease(u / 0.12)
    target += 360 * Math.round((x - target) / 360)
    track[i] = x
    const acc = ROLL_OMEGA * ROLL_OMEGA * (target - x) - 2 * ROLL_OMEGA * v
    v += acc * dt; x += v * dt
  }
  rollCache.set(cum, { seconds, track })
  return track
}
export function routeShot(pts: number[][], cum: number[], u: number, v: RouteView): { lon: number; lat: number; dist: number; roll: number; pitch: number; /** The point being followed (in the middle of the frame once the view is tipped). */ aim: { lon: number; lat: number } } {
  const x = Math.max(0, Math.min(1, u))
  // 0..0.12 the overview settles into the follow; 0.12..0.88 the follow moves along the route; 0.88..1 the camera drops to the end.
  const travel = ease((x - 0.12) / 0.76)
  const p = pointAlong(pts, cum, travel)
  const rise = ease(x / 0.12), fall = ease((x - 0.88) / 0.12)
  const logD = (a: number, b: number, k: number): number => Math.exp(Math.log(a - 1) * (1 - k) + Math.log(b - 1) * k) + 1
  let dist = logD(logD(v.overviewDist, v.followDist, rise), v.endDist, fall)
  const floorP = v.floorAt(p.lon, p.lat)
  dist = smoothMaxAlt(dist, floorP)
  const tr = rollTrack(pts, cum, v.seconds ?? 14), f = x * ROLL_STEPS, i0 = Math.min(ROLL_STEPS - 1, Math.floor(f))
  const roll = tr[i0] + (tr[i0 + 1] - tr[i0]) * (f - i0)
  // The follow is tipped like a chase camera (owner 2026-10-07): the overview stays a map; the tilt eases in with the rise to FOLLOW_PITCH and ends at END_PITCH.
  // The tilt arrives with the descent to the follow height (cubed: while the camera is still hundreds of km up, a tilt would swing it far sideways).
  const pitch = FOLLOW_PITCH * rise * rise * rise * (1 - fall) + END_PITCH * fall
  // A tipped view looks at the ground ahead of the camera, so the camera stands BEHIND the followed point by height * tan(pitch), on the line
  // the screen's up points along (minus the roll), which keeps the point in the middle of the frame at any lag of the roll.
  const heightKm = Math.max(0, dist - floorP) * MOON_R_KM
  const cam = pitch > 0 ? offsetBy(p.lon, p.lat, -roll + 180, heightKm * Math.tan(pitch * DEG)) : { lon: p.lon, lat: p.lat }
  if (pitch > 0) dist = smoothMaxAlt(dist, v.floorAt(cam.lon, cam.lat))
  return { lon: cam.lon, lat: cam.lat, dist, roll, pitch, aim: { lon: p.lon, lat: p.lat } }
}

/** Tilt at the end of a fly-along, degrees from straight down. */
export const END_PITCH = 50
/** The vertical half-angle of the narrowest-fov phone view the show must fit (412 x 915 at the 30 degree short-side lens is 30.8; 9:21 is 32). The horizon sits at 84 degrees from straight down at this height, so FOLLOW_PITCH + this stays under 84. */
export const PHONE_V_HALF_DEG = 32
/** Tilt while following the route (degrees from straight down): an oblique view along the drive, the direction of travel up the screen. */
export const FOLLOW_PITCH = 50

/** Overview distance that frames a route of `lengthKm` in a field of `fovDeg`, Moon radii (the route spans about 70 % of the frame). */
export function overviewDistFor(lengthKm: number, fovDeg: number): number {
  return 1 + (lengthKm / 0.7) / (2 * Math.tan(fovDeg * DEG / 2) * MOON_R_KM)
}

/**
 * The larger of two heights above the ground (radii minus one), blended in log space so the follow height meets a rising or falling floor
 * without a corner (a plain max changes the vertical speed at once where the funnel cone and the follow height cross). Never below
 * the larger, so the floor still holds.
 */
export function smoothMaxAlt(a: number, b: number, sharpness = 8): number {
  const la = Math.log(Math.max(a - 1, 1e-9)), lb = Math.log(Math.max(b - 1, 1e-9))
  const m = Math.max(la, lb)
  return 1 + Math.exp(m + Math.log(Math.exp(sharpness * (la - m)) + Math.exp(sharpness * (lb - m))) / sharpness)
}

/** Which other camera owners are running, as the fly-along sees them each frame. */
export interface RouteOwners { ridge: boolean; descent: boolean; flight: boolean; ground: boolean; orbitJourney: boolean; approach: boolean; tween: unknown; ownTween: unknown; phase: 'approach' | 'along' }
/**
 * 'cancel' when anything else holds the camera (the show ends: it must not fight the other move, nor resume under it when that ends),
 * 'wait' while the show's own approach tween runs, 'go' otherwise. A tween that is not the show's own belongs to Home, a pin or a label.
 */
export function routeOwnerCheck(o: RouteOwners): 'go' | 'wait' | 'cancel' {
  if (o.ridge || o.descent || o.flight || o.ground || o.orbitJourney || o.approach) return 'cancel'
  if (o.tween) return o.phase === 'approach' && o.tween === o.ownTween ? 'wait' : 'cancel'
  return 'go'
}
