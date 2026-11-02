import { Vector3 } from 'three'
import { joinLead } from '../journey/join'
import { bodyLonLat, type Ephemeris } from '../ephemeris'
import { MOON_R_KM } from '../glsl/common'
import { eclipseAxes, momentPose } from '../momentPose'
export { eclipseAxes }
import { angularDistance, poseBasis, wrapLon, type Pose } from '../camera/pose'
import type { LookTarget } from '../camera/rig'
import type { Moment } from '../moments'

export interface CinematicFlight {
  id: string
  seconds: number
  needsTiles?: boolean
  needsPatch?: string
  /** 'eclipse': the solar-eclipse flight, whose route is computed from the ephemeris of its moment (ECLIPSE_* below), not from waypoints. */
  kind: 'track' | 'earthrise' | 'eclipse'
  /** A point the camera always faces (lon, lat); pitch and heading come from the geometry. */
  focus?: { lon: number; lat: number }
  /** Without a focus: turn the camera this many degrees off the direction of travel (negative to the left/west of a northward track), keeping the roll level. */
  headingOffsetDeg?: number
  /** Blend the lunar camera toward the Earth for a closing Earthrise shot. */
  earthriseLook?: boolean | number
  waypoints?: ReadonlyArray<{ lon: number; lat: number; dist: number; pitch: number; fovDeg: number; roll?: number }>
}

export interface CinematicFlightSample {
  pose: Pose
  fovDeg: number
  /** Blend from the Moon-centred view (0) toward the aim body (1): the Earth, or, when `lookSun` says so, the Sun. */
  look: number
  /** Which body `look` blends toward: 0 the Earth (the default), 1 the Sun, between them along the mix of the two directions. */
  lookSun?: number
}

const FLIGHTS: Readonly<Record<string, CinematicFlight>> = {
  'copernicus-flyover': {
    id: 'copernicus-flyover', seconds: 30, kind: 'track', needsTiles: true, focus: { lon: -20.08, lat: 9.62 },
    waypoints: [
      { lon: -20.08, lat: 4.62, dist: 1.3, pitch: 40, fovDeg: 50 },
      { lon: -24.001, lat: 7.037, dist: 1.2671, pitch: 40, fovDeg: 50 },
      { lon: -24.109, lat: 11.266, dist: 1.2343, pitch: 40, fovDeg: 50 },
      { lon: -20.862, lat: 13.494, dist: 1.2016, pitch: 40, fovDeg: 50 },
      { lon: -17.498, lat: 12.166, dist: 1.1688, pitch: 40, fovDeg: 50 },
      { lon: -16.847, lat: 8.986, dist: 1.1359, pitch: 40, fovDeg: 50 },
      { lon: -18.954, lat: 6.941, dist: 1.1031, pitch: 40, fovDeg: 50 },
      { lon: -21.517, lat: 7.5, dist: 1.0703, pitch: 40, fovDeg: 50 },
      // The narrower, slightly higher final frame holds the Sun's full disc
      // clear of portrait and landscape captures as the crater fills view.
      { lon: -22.311, lat: 9.62, dist: 1.0375, pitch: 45, fovDeg: 35 },
    ],
  },
  'taurus-littrow-pass': {
    id: 'taurus-littrow-pass', seconds: 30, kind: 'track', needsTiles: true, needsPatch: 'a17',
    waypoints: [
      { lon: 30.05, lat: 20.28, dist: 1.004, pitch: 69, fovDeg: 50 },
      { lon: 30.30, lat: 20.25, dist: 1.004, pitch: 72, fovDeg: 50 },
      { lon: 30.55, lat: 20.20, dist: 1.005, pitch: 70, fovDeg: 50 },
      { lon: 30.75, lat: 20.15, dist: 1.006, pitch: 68, fovDeg: 50 },
    ],
  },
  'apollo8-earthrise': { id: 'apollo8-earthrise', seconds: 19, kind: 'earthrise', needsTiles: true },
  // The total solar eclipse of 2 Aug 2027 from the Moon: the Sun at the far-side limb, the Moon, then the Earth with the Moon's shadow. See sampleEclipse.
  'solar-eclipse': { id: 'solar-eclipse', seconds: 25, kind: 'eclipse', needsTiles: true },
  'terminator-run': {
    // Runs ALONG the morning terminator (owner, R2 1:18-1:47: "nothing happens ... no shadows"; rig 2026-10-15: a route that flew away from the
    // line lost the band by u .6). Owner 2026-10-20 (6:55-7:08): "not low enough ... fly along the terminator way longer, just straight on it,
    // longer and faster": the track is now 50 deg of latitude (-25 to +25) at lon -35, lower (dist 1.03; the floor clamp lifts it where the
    // imagery needs it) and 30 s (owner 2026-10-22: every flight at most 30 s; was 36). The date puts the Sun 3 deg up over the darkest waypoint (viewDates.ts), so the sunrise line is ~3 deg of longitude
    // west of this meridian and the Sun stays 2.5-6 deg up along the whole track. No fixed focus (the old one turned the camera away from the line
    // on a long track): the heading follows travel, turned 35 deg toward the line (west), so the band stays in frame and the Sun is behind the camera.
    id: 'terminator-run', seconds: 30, kind: 'track', needsTiles: true, headingOffsetDeg: -35,
    waypoints: [
      { lon: -35, lat: -25, dist: 1.03, pitch: 62, fovDeg: 42 },
      { lon: -35, lat: -12.5, dist: 1.03, pitch: 62, fovDeg: 42 },
      { lon: -35, lat: 0, dist: 1.03, pitch: 62, fovDeg: 42 },
      { lon: -35, lat: 12.5, dist: 1.03, pitch: 62, fovDeg: 42 },
      { lon: -35, lat: 25, dist: 1.03, pitch: 62, fovDeg: 42 },
    ],
  },
  'earthrise-low': {
    id: 'earthrise-low', seconds: 30, kind: 'track', needsTiles: true, earthriseLook: 0.55,
    waypoints: [
      { lon: 88, lat: -8, dist: 1.0825, pitch: 58, fovDeg: 28 },
      { lon: 91, lat: -6, dist: 1.075, pitch: 60, fovDeg: 28 },
      { lon: 94, lat: -3, dist: 1.0675, pitch: 62, fovDeg: 30 },
      { lon: 97, lat: 0, dist: 1.0675, pitch: 63, fovDeg: 32 },
      { lon: 100, lat: 3, dist: 1.075, pitch: 62, fovDeg: 34 },
    ],
  },
  // One lap with one high swell (to 1.12) in the first half and one low pass (1.054, ~94 km; clears the TC-off floor at 1200 px) in the second; start and end stay at 1.0975 to match the moment pose.
  'plato-rim': {
    id: 'plato-rim', seconds: 30, kind: 'track', needsTiles: true, focus: { lon: -9.3, lat: 51.6 },
    waypoints: [
      { lon: -15.3, lat: 51.6, dist: 1.0975, pitch: 55, fovDeg: 42 },
      { lon: -13.5, lat: 54.4, dist: 1.11, pitch: 58, fovDeg: 42 },
      { lon: -9.3, lat: 55.6, dist: 1.12, pitch: 60, fovDeg: 42 },
      { lon: -5.1, lat: 54.4, dist: 1.11, pitch: 58, fovDeg: 42 },
      { lon: -3.3, lat: 51.6, dist: 1.095, pitch: 55, fovDeg: 42 },
      { lon: -5.1, lat: 48.8, dist: 1.068, pitch: 58, fovDeg: 42 },
      { lon: -9.3, lat: 47.6, dist: 1.054, pitch: 60, fovDeg: 42 },
      { lon: -13.5, lat: 48.8, dist: 1.068, pitch: 58, fovDeg: 42 },
      { lon: -15.3, lat: 51.6, dist: 1.0975, pitch: 55, fovDeg: 42 },
    ],
  },
  // Closer (owner, R1 8:32-8:55): fov 42 -> 36 magnifies the crater by 1.19x; the distances are main's (1.075-1.0975, the gentle up and down). A deeper 1.0675 dip was tried and removed: rig 2026-10-15 showed more >= 50 ms gaps (48 vs 38 median) for no extra closeness.
  'tycho-rim': {
    id: 'tycho-rim', seconds: 30, kind: 'track', needsTiles: true, focus: { lon: -11.2153, lat: -43.2958 },
    waypoints: [
      { lon: -15.5, lat: -43.3, dist: 1.0975, pitch: 55, fovDeg: 36 },
      { lon: -13.4, lat: -40.4, dist: 1.0825, pitch: 58, fovDeg: 36 },
      { lon: -9.3, lat: -39.2, dist: 1.075, pitch: 60, fovDeg: 36 },
      { lon: -7.2, lat: -43.3, dist: 1.0825, pitch: 58, fovDeg: 36 },
      { lon: -9.3, lat: -47.4, dist: 1.075, pitch: 60, fovDeg: 36 },
      { lon: -13.4, lat: -46.2, dist: 1.0825, pitch: 58, fovDeg: 36 },
      { lon: -15.5, lat: -43.3, dist: 1.0975, pitch: 55, fovDeg: 36 },
    ],
  },
  'rille-run': {
    id: 'rille-run', seconds: 30, kind: 'track', needsTiles: true,
    waypoints: [
      { lon: 3.1, lat: 26.9, dist: 1.0675, pitch: 58, fovDeg: 36 },
      { lon: 3.35, lat: 26.4, dist: 1.06, pitch: 60, fovDeg: 36 },
      { lon: 3.63, lat: 25.8, dist: 1.0525, pitch: 62, fovDeg: 36 },
      { lon: 3.95, lat: 25.15, dist: 1.06, pitch: 60, fovDeg: 36 },
      { lon: 4.25, lat: 24.5, dist: 1.0675, pitch: 58, fovDeg: 36 },
    ],
  },
  'pole-limb-sweep': {
    id: 'pole-limb-sweep', seconds: 30, kind: 'track', needsTiles: true,
    waypoints: [
      { lon: 0, lat: 85, dist: 1.4, pitch: 30, fovDeg: 48 },
      { lon: 18, lat: 68, dist: 1.55, pitch: 35, fovDeg: 48 },
      { lon: 38, lat: 48, dist: 1.8, pitch: 40, fovDeg: 48 },
      { lon: 58, lat: 27, dist: 2.05, pitch: 42, fovDeg: 48 },
      { lon: 80, lat: 0, dist: 2.2, pitch: 40, fovDeg: 48 },
    ],
  },
  'bank-turn-a': {
    id: 'bank-turn-a', seconds: 30, kind: 'track', needsTiles: true,
    waypoints: [
      { lon: -18, lat: 24, dist: 1.1125, pitch: 48, fovDeg: 38, roll: 0 },
      { lon: -12, lat: 28, dist: 1.09, pitch: 52, fovDeg: 38, roll: -10 },
      { lon: -7, lat: 23, dist: 1.075, pitch: 55, fovDeg: 38, roll: 11 },
      { lon: -1, lat: 29, dist: 1.09, pitch: 55, fovDeg: 38, roll: -12 },
      { lon: 5, lat: 25, dist: 1.1125, pitch: 60, fovDeg: 38, roll: 0 },
    ],
  },
  'bank-turn-b': {
    id: 'bank-turn-b', seconds: 30, kind: 'track', needsTiles: true,
    waypoints: [
      { lon: -24, lat: 18, dist: 1.1275, pitch: 45, fovDeg: 42, roll: 0 },
      { lon: -17, lat: 25, dist: 1.0975, pitch: 50, fovDeg: 42, roll: -13 },
      { lon: -10, lat: 17, dist: 1.075, pitch: 55, fovDeg: 42, roll: 13 },
      { lon: -3, lat: 26, dist: 1.09, pitch: 58, fovDeg: 42, roll: -9 },
      { lon: 4, lat: 20, dist: 1.12, pitch: 62, fovDeg: 42, roll: 0 },
    ],
  },
  'sunrise-arc-a': {
    id: 'sunrise-arc-a', seconds: 30, kind: 'track', needsTiles: true,
    waypoints: [
      { lon: -35, lat: 7, dist: 1.0825, pitch: 53, fovDeg: 20 },
      { lon: -33, lat: 9, dist: 1.075, pitch: 55, fovDeg: 20 },
      { lon: -31, lat: 11, dist: 1.0675, pitch: 57, fovDeg: 20 },
      { lon: -29, lat: 13, dist: 1.0675, pitch: 59, fovDeg: 20 },
      { lon: -26.5, lat: 15, dist: 1.075, pitch: 61, fovDeg: 20 },
    ],
  },
  'sunrise-arc-b': {
    id: 'sunrise-arc-b', seconds: 30, kind: 'track', needsTiles: true,
    waypoints: [
      { lon: -40, lat: -6, dist: 1.0975, pitch: 47, fovDeg: 20 },
      { lon: -36, lat: -3, dist: 1.0825, pitch: 50, fovDeg: 20 },
      { lon: -32, lat: 0, dist: 1.075, pitch: 53, fovDeg: 20 },
      { lon: -29, lat: 3, dist: 1.0675, pitch: 56, fovDeg: 20 },
      { lon: -26.5, lat: 6, dist: 1.075, pitch: 59, fovDeg: 20 },
    ],
  },
  'limb-glide-a': {
    id: 'limb-glide-a', seconds: 30, kind: 'track', needsTiles: true, earthriseLook: 0.7,
    waypoints: [
      { lon: 70, lat: 16, dist: 1.195, pitch: 24, fovDeg: 36, roll: 0 },
      { lon: 76, lat: 12, dist: 1.18, pitch: 24, fovDeg: 36, roll: 5 },
      { lon: 82, lat: 7, dist: 1.165, pitch: 25, fovDeg: 36, roll: 10 },
      { lon: 88, lat: 1, dist: 1.18, pitch: 25, fovDeg: 36, roll: 15 },
      { lon: 94, lat: -5, dist: 1.21, pitch: 26, fovDeg: 36, roll: 20 },
    ],
  },
  'limb-glide-b': {
    id: 'limb-glide-b', seconds: 30, kind: 'track', needsTiles: true, earthriseLook: 0.7,
    waypoints: [
      { lon: 67, lat: -19, dist: 1.255, pitch: 20, fovDeg: 40, roll: 0 },
      { lon: 74, lat: -14, dist: 1.225, pitch: 22, fovDeg: 40, roll: 5 },
      { lon: 81, lat: -8, dist: 1.195, pitch: 24, fovDeg: 40, roll: 10 },
      { lon: 88, lat: -1, dist: 1.21, pitch: 25, fovDeg: 40, roll: 15 },
      { lon: 95, lat: 6, dist: 1.24, pitch: 26, fovDeg: 40, roll: 20 },
    ],
  },
}

/** Where the Earthrise flight starts, Earth radii of the Earth's centre above the limb: below -1 the disc is out of sight (moments.ts earthrise starts here too). */
export const EARTHRISE_START_ABOVE = -1.2

export function getCinematicFlight(id: string | undefined): CinematicFlight | undefined {
  return id ? FLIGHTS[id] : undefined
}

/** Resolve the route attached to a tour moment. */
export function getFlight(moment: Moment): CinematicFlight | undefined {
  return getCinematicFlight(moment.cinematicFlight)
}

/** The deceleration a flight stops on, in mean speeds per flight duration (flightEase's k''(1) = -FLIGHT_END_BRAKE). */
export const FLIGHT_END_BRAKE = 1.5
/**
 * A flight's progress: the quintic's start (zero speed and acceleration, so the join's lead-in is unchanged) and a braking stop. The plain quintic
 * stops on speed ~ (time left)^2, a long creep whose last half second the rig reads as one fast frame and a crawl (R7 2026-10-21: 3.3x the median of
 * the moving frames, with no hitch in the series: the steps fell smoothly from 1.6 m to 0.02 m). The u^6 (1-u)^2 term gives the stop a finite
 * deceleration (speed ~ time left) and is negligible in the first half (0.3 % of progress at u = 0.5). Monotone for brake <= 20.
 */
export function flightEase(u: number): number {
  const t = Math.max(0, Math.min(1, u)), s = 1 - t
  return t * t * t * (t * (t * 6 - 15) + 10) - FLIGHT_END_BRAKE / 2 * t ** 6 * s * s
}

/**
 * The solar-eclipse flight's own progress curve: [u, t] knots, joined by a monotone cubic with zero speed at both ends. The quintic flightEase
 * leaves the first 13 s of a 40 s flight on the dark ground (t < 0.2); this one has the gaze turned toward the Sun by about 3 s (t 0.15 at u 0.075)
 * and spends the time it saves on the climb and the long pull-back to the Earth. Still one continuous move: no segment, no stop between the ends.
 */
export const ECLIPSE_EASE_KNOTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.075, 0.15], [0.11, 0.2], [0.2, 0.32], [0.32, 0.48], [0.42, 0.6], [0.65, 0.8], [0.72, 0.86], [0.85, 0.93], [1, 1],
]
export function eclipseEase(u: number): number {
  const k = ECLIPSE_EASE_KNOTS, n = k.length
  const x = Math.max(0, Math.min(1, u))
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) d.push((k[i + 1][1] - k[i][1]) / (k[i + 1][0] - k[i][0]))
  const m: number[] = new Array(n).fill(0)
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) { // Fritsch-Carlson limit keeps every segment monotone
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue }
    const a = m[i] / d[i], b = m[i + 1] / d[i], r = Math.hypot(a, b)
    if (r > 3) { m[i] = 3 * a / r * d[i]; m[i + 1] = 3 * b / r * d[i] }
  }
  let i = 0
  while (i < n - 2 && x > k[i + 1][0]) i++
  const h = k[i + 1][0] - k[i][0], s = (x - k[i][0]) / h, s2 = s * s, s3 = s2 * s
  return (2 * s3 - 3 * s2 + 1) * k[i][1] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * k[i + 1][1] + (s3 - s2) * h * m[i + 1]
}

/** Selenographic longitude on the morning terminator, derived from the fixed-time subsolar point. */
export function sunriseLongitude(ephem: Ephemeris, lat = 0): number {
  const terminatorDelta = Math.acos(Math.max(-1, Math.min(1, -Math.tan(lat * DEG) * Math.tan(ephem.subSolar.lat * DEG))))
  return wrapLon(ephem.subSolar.lon - terminatorDelta / DEG)
}

/** Deterministic timestamp for capture frame `i`, in milliseconds from flight start. */
export function captureFrameTimeMs(i: number, fps: number): number {
  if (!Number.isInteger(i) || i < 0 || !Number.isFinite(fps) || fps <= 0) throw new RangeError('Invalid capture frame or fps')
  return i * 1000 / fps
}

/** Small pure clock used by the manual capture API; end makes later samples invalid. */
export class CaptureClock {
  private fps = 0
  active = false
  begin(fps: number): void {
    if (!Number.isFinite(fps) || fps <= 0) throw new RangeError('Invalid capture fps')
    this.fps = fps
    this.active = true
  }
  frameTimeMs(i: number): number {
    if (!this.active) throw new Error('Capture clock has ended')
    return captureFrameTimeMs(i, this.fps)
  }
  end(): void { this.active = false }
}

const DEG = Math.PI / 180
const HORIZON_MARGIN_DEG = 8
function direction(lon: number, lat: number): Vector3 {
  const b = lat * DEG, l = lon * DEG
  return new Vector3(Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b))
}

function catmullVector(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number): Vector3 {
  const t2 = t * t, t3 = t2 * t
  return p1.clone().multiplyScalar(2)
    .addScaledVector(p2.clone().sub(p0), t)
    .addScaledVector(p0.clone().multiplyScalar(2).addScaledVector(p1, -5).addScaledVector(p2, 4).sub(p3), t2)
    .addScaledVector(p0.clone().multiplyScalar(-1).addScaledVector(p1, 3).addScaledVector(p2, -3).add(p3), t3)
    .multiplyScalar(0.5).normalize()
}

function catmullScalar(values: readonly number[], i: number, t: number): number {
  const p0 = values[Math.max(0, i - 1)], p1 = values[i], p2 = values[i + 1], p3 = values[Math.min(values.length - 1, i + 2)]
  const t2 = t * t, t3 = t2 * t
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

function trackPoint(points: NonNullable<CinematicFlight['waypoints']>, u: number): Vector3 {
  const scaled = Math.max(0, Math.min(1, u)) * (points.length - 1)
  const i = Math.min(points.length - 2, Math.floor(scaled)), k = scaled - i
  return catmullVector(
    direction(points[Math.max(0, i - 1)].lon, points[Math.max(0, i - 1)].lat),
    direction(points[i].lon, points[i].lat),
    direction(points[i + 1].lon, points[i + 1].lat),
    direction(points[Math.min(points.length - 1, i + 2)].lon, points[Math.min(points.length - 1, i + 2)].lat),
    k,
  )
}

function lonLat(v: Vector3): { lon: number; lat: number } {
  return { lon: wrapLon(Math.atan2(v.y, v.x) / DEG), lat: Math.asin(Math.max(-1, Math.min(1, v.z))) / DEG }
}

function bearing(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const a = aLat * DEG, b = bLat * DEG, dl = wrapLon(bLon - aLon) * DEG
  return Math.atan2(Math.sin(dl) * Math.cos(b), Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(dl)) / DEG
}

function safeRollForTravel(headingDeg: number): number {
  // Pose roll zero points its tilt toward north; negative roll turns that tilt
  // toward east. Keep the value wrapped so equivalent headings stay nearby.
  return wrapLon(-headingDeg)
}

/**
 * Without authored rolls, a flight that turns toward the Earth also turns the camera's up toward it (the bearing of the sub-Earth point), in step
 * with the look, so the Earth ends above the horizon instead of beside a limb standing on end (#302). `look` over the flight's final look is the share.
 */
function earthUpRoll(travelRoll: number, lon: number, lat: number, ephem: Ephemeris, look: number, earthriseLook: boolean | number | undefined): number {
  const max = typeof earthriseLook === 'number' ? Math.max(0, Math.min(1, earthriseLook)) : earthriseLook ? 1 : 0
  if (max <= 0 || look <= 0) return travelRoll
  const toEarth = safeRollForTravel(bearing(lon, lat, ephem.subEarth.lon, ephem.subEarth.lat))
  return wrapLon(travelRoll + wrapLon(toEarth - travelRoll) * Math.min(1, look / max))
}

/**
 * Sample a registered cinematic route. `floorAt` and `groundAt` are supplied
 * by the active rig so the same authored path remains safe with whichever
 * imagery and site terrain are actually loaded.
 */
export function sampleCinematicFlight(
  flight: CinematicFlight,
  u: number,
  ephem: Ephemeris,
  floorAt: (lon: number, lat: number) => number,
  groundAt: (lon: number, lat: number) => number,
  /** Mean speeds the flight starts at after a fly-to (journey/join.ts); 0 starts from rest. The route is the same. */
  lead = 0,
): CinematicFlightSample {
  const t = (flight.kind === 'eclipse' ? eclipseEase(u) : flightEase(u)) + joinLead(u, lead, flight.seconds)
  if (flight.kind === 'earthrise') {
    // Starts with the Earth centre EARTHRISE_START_ABOVE Earth radii below the limb (the whole disc hidden: owner 2026-10-20 "should start when the
    // Earth is below the horizon"), then rises to 2.5.
    const above = EARTHRISE_START_ABOVE + (2.5 - EARTHRISE_START_ABOVE) * t
    let dist = 1.065
    let pose = momentPose({ at: 'earthrise', dist, aboveLimbEarthR: above, bearingDeg: 90 }, ephem)
    // Raising distance changes the apparent limb angle and the camera's
    // location. Re-solve at that distance until both local floors are clear.
    for (let i = 0; i < 4; i++) {
      const safeDist = Math.max(dist, floorAt(pose.lon, pose.lat), 1 + groundAt(pose.lon, pose.lat) + 0.00004)
      if (safeDist <= dist + 1e-8) break
      dist = safeDist
      pose = momentPose({ at: 'earthrise', dist, aboveLimbEarthR: above, bearingDeg: 90 }, ephem)
    }
    return { pose, fovDeg: 10.5, look: 1 }
  }

  if (flight.kind === 'eclipse') return sampleEclipse(t, ephem, floorAt, groundAt)

  const points = flight.waypoints
  if (!points || points.length < 2) throw new Error(`Cinematic flight ${flight.id} has no route points`)
  const scaled = t * (points.length - 1)
  const segment = Math.min(points.length - 2, Math.floor(scaled))
  const k = scaled - segment
  const ll = lonLat(trackPoint(points, t))
  const lon = ll.lon, lat = ll.lat
  const eps = 1e-5
  const before = lonLat(trackPoint(points, Math.max(0, t - eps)))
  const after = lonLat(trackPoint(points, Math.min(1, t + eps)))
  const heading = flight.focus ? bearing(lon, lat, flight.focus.lon, flight.focus.lat) : bearing(before.lon, before.lat, after.lon, after.lat) + (flight.headingOffsetDeg ?? 0)
  const nominalDist = catmullScalar(points.map((p) => p.dist), segment, k)
  const dist = Math.max(nominalDist, floorAt(lon, lat), 1 + groundAt(lon, lat) + 0.00004)
  // The authored tilt is for the close pass. If the active image floor lifts
  // the camera, the visible lunar horizon moves down; keep the centre ray on
  // the ground side of that horizon so the flight cannot turn into sky-only.
  const visibleHorizonPitch = Math.max(0, Math.asin(Math.min(1, 1 / dist)) / DEG - HORIZON_MARGIN_DEG)
  let authoredPitch = catmullScalar(points.map((p) => p.pitch), segment, k)
  if (flight.focus) {
    // Face the focus: the angle from straight down to the focus, from the camera's height and its angular distance.
    const theta = angularDistance(lon, lat, flight.focus.lon, flight.focus.lat)
    authoredPitch = Math.atan2(Math.sin(theta), dist - Math.cos(theta)) / DEG
  }
  // The authored tilt is relative to the Moon-centred look; the rig applies it after the look blend, so a flight turning toward the Earth
  // would keep tilting up from the Earth and end on empty sky (#302). Fade the tilt out as the look moves to the Earth.
  const look = typeof flight.earthriseLook === 'number' ? t * Math.max(0, Math.min(1, flight.earthriseLook)) : flight.earthriseLook ? t : 0
  const pitch = Math.min(authoredPitch, visibleHorizonPitch) * (1 - look)
  const pose: Pose = {
    lon, lat, dist,
    roll: points.some((p) => p.roll !== undefined)
      ? catmullScalar(points.map((p) => p.roll ?? 0), segment, k)
      : earthUpRoll(safeRollForTravel(heading), lon, lat, ephem, look, flight.earthriseLook),
    pitch,
  }
  return { pose, fovDeg: catmullScalar(points.map((p) => p.fovDeg), segment, k), look }
}

/** Where the solar-eclipse flight ends: degrees from the subsolar point (sunward of the Moon) and the lens, deg of the short side. */
export const ECLIPSE_END_PHI_DEG = 6.5
export const ECLIPSE_END_FOV_DEG = 2.8
/** The last frame's extra roll, deg: it lifts the Moon off the horizontal beside the Earth so its limb is in a portrait frame as well as a landscape one. */
export const ECLIPSE_END_ROLL_DEG = -60

/**
 * The solar-eclipse flight, one continuous camera. At a solar eclipse the Moon lies between the Sun and the Earth, so the Sun is overhead on
 * the far (lit) side and the Earth overhead on the near side, which is in night. The camera starts on the near side's eastern edge (about 66 E at
 * this eclipse), 24 deg past the morning terminator, low over the earthlit night ground with the Sun a few degrees above the horizon ahead,
 * about to rise. It looks at the Sun, turns back to the Moon while it climbs, and sweeps sunward round the Moon (the Moon going from half to full lit) to
 * 12 radii a few degrees off the Sun-Moon line, where the Earth is full and sunlit and the Moon's shadow is on it, with the Moon's lit limb at the
 * frame's edge beside it. Nothing is ever far from the frame: the look stays on the Moon until the last swing of a few degrees to the Earth.
 *
 * Everything is built from the ephemeris of the moment: `a` is the Moon-to-Sun direction (the subsolar point), `n` the direction west of it
 * along the lunar equator (eclipseAxes); the camera is at `dist` radii along cos(phi) a + sin(phi) n. Roll keeps the screen's up toward the Sun along
 * the surface for the Sun beat, so the horizon is level whenever the camera looks toward the Sun, and turns to lunar north up for the Moon and the
 * Earth, which puts the Moon beside the Earth on the horizontal at the end. The look is a blend (rig.setLookBlend): weight `w` from the Moon's centre
 * toward the aim body, the Sun while `s` = 1 and the Earth at 0. The camera path (the phi/dist/fov rows) is authored, not computed.
 */
/** Rows of [t, phi (deg from the subsolar point), dist (radii), fov (deg)]; t is the eased progress. */
export const ECLIPSE_MOTION: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.00, 114, 1.12, 46],
  [0.20, 111, 1.12, 46],
  [0.34, 107, 1.16, 46],
  [0.48, 100, 1.9, 44],
  [0.60, 95, 3.4, 40],
  [0.80, 40, 8, 20],
  [0.86, 12, 10.5, 14],
  [0.93, 7.4, 11.9, 7],
  // 12 radii is the pose's farthest distance (D_MAX). At phi 6.5 deg the Moon's limb is about 1.4 deg from the Earth's centre (the Earth is 0.95 deg in radius), clear of
  // its disc; fov 2.8 (the umbra needs it: solar-eclipse-geometry.test) gives the Earth about two thirds of the short half-field. The end roll (ECLIPSE_END_ROLL_DEG) puts the Moon up and to the side, about 60 deg off the
  // horizontal, so its limb cuts the top of a landscape frame and the upper part of a portrait one (about 8 % and 20 % of the frame). The lens is still wide when
  // the look starts its last few degrees, so the Moon's disc covers the frame until the Earth is in it.
  [1.00, ECLIPSE_END_PHI_DEG, 12, ECLIPSE_END_FOV_DEG],
]
/** [t, w]: the weight of the aim body in the look; smoothstep between rows. */
export const ECLIPSE_LOOK_W: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.02, 0], [0.20, 1], [0.32, 1], [0.48, 0], [0.70, 0], [0.92, 1],
]
/** [t, s]: 1 aims at the Sun, 0 at the Earth; it changes while w is 0, so the switch is not seen. */
export const ECLIPSE_AIM_SUN: ReadonlyArray<readonly [number, number]> = [[0, 1], [0.52, 1], [0.56, 0]]
/** Progress u (not eased t) after which the Sun can no longer be in the frame: bounds the exposure's look-ahead for the Sun's arrival. */
export const ECLIPSE_SUN_BEAT_U = 0.32
/** The roll's blend from "up toward the Sun" to "up toward lunar north", by t. */
const ECLIPSE_ROLL_KEYS: ReadonlyArray<readonly [number, number]> = [[0.5, 0], [0.9, 1]]

function smoothKeys(keys: ReadonlyArray<readonly [number, number]>, t: number): number {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, y0] = keys[i], [t1, y1] = keys[i + 1]
    if (t <= t1) { const k = (t - t0) / (t1 - t0); return y0 + (y1 - y0) * k * k * (3 - 2 * k) }
  }
  return keys[keys.length - 1][1]
}

/** Cubic Hermite through column `col` of the rows (slopes by central differences on the uneven times; `f` maps the value first, e.g. log). */
function hermiteColumn(rows: typeof ECLIPSE_MOTION, col: 1 | 2 | 3, t: number, f: (v: number) => number = (v) => v): number {
  const n = rows.length
  const x = Math.max(rows[0][0], Math.min(rows[n - 1][0], t))
  let i = 0
  while (i < n - 2 && x > rows[i + 1][0]) i++
  const slope = (j: number): number => {
    const a = Math.max(0, j - 1), b = Math.min(n - 1, j + 1)
    return (f(rows[b][col]) - f(rows[a][col])) / (rows[b][0] - rows[a][0])
  }
  const t0 = rows[i][0], t1 = rows[i + 1][0], h = t1 - t0, s = (x - t0) / h
  const y0 = f(rows[i][col]), y1 = f(rows[i + 1][col])
  const s2 = s * s, s3 = s2 * s
  return (2 * s3 - 3 * s2 + 1) * y0 + (s3 - 2 * s2 + s) * h * slope(i) + (-2 * s3 + 3 * s2) * y1 + (s3 - s2) * h * slope(i + 1)
}

function sampleEclipse(
  t: number, ephem: Ephemeris,
  floorAt: (lon: number, lat: number) => number,
  groundAt: (lon: number, lat: number) => number,
): CinematicFlightSample {
  const { a, n } = eclipseAxes(ephem)
  const phi = hermiteColumn(ECLIPSE_MOTION, 1, t) * DEG
  const nominal = Math.min(12, Math.exp(hermiteColumn(ECLIPSE_MOTION, 2, t, Math.log)))
  const fovDeg = hermiteColumn(ECLIPSE_MOTION, 3, t)
  const dir = a.clone().multiplyScalar(Math.cos(phi)).addScaledVector(n, Math.sin(phi)).normalize()
  const ll = bodyLonLat(dir, ephem.moonX, ephem.moonY, ephem.moonZ)
  const lon = wrapLon(ll.lon), lat = ll.lat
  const dist = Math.max(nominal, floorAt(lon, lat), 1 + groundAt(lon, lat) + 0.00004)
  const pose: Pose = { lon, lat, dist, roll: 0, pitch: 0 }
  // Roll: the screen's up along the surface toward the Sun for the Sun beat, turning to lunar north (the Earth's pole side) for the rest. The two
  // directions are perpendicular on the sunward arc (one in the Sun-camera plane, one along the pole), so the blend never degenerates.
  const base = poseBasis(ephem, pose)
  const toSun = a.clone().addScaledVector(base.back, -a.dot(base.back))
  const north = ephem.moonZ.clone().addScaledVector(base.back, -ephem.moonZ.dot(base.back))
  if (toSun.lengthSq() > 1e-10 && north.lengthSq() > 1e-10) {
    const k = smoothKeys(ECLIPSE_ROLL_KEYS, t)
    const up = toSun.normalize().multiplyScalar(1 - k).addScaledVector(north.normalize(), k)
    if (up.lengthSq() > 1e-10) {
      const rolled = new Vector3().crossVectors(base.back, base.up)
      pose.roll = wrapLon(Math.atan2(up.dot(rolled), up.dot(base.up)) / DEG + ECLIPSE_END_ROLL_DEG * k)
    }
  }
  return { pose, fovDeg, look: smoothKeys(ECLIPSE_LOOK_W, t), lookSun: smoothKeys(ECLIPSE_AIM_SUN, t) }
}

/**
 * The aim body of a flight's look blend: the Earth, or for the eclipse flight the Sun/Earth mix `sun` names (1 the Sun). Directions are from the camera.
 * Pass it to `rig.setLookBlend(sample.look, flightAim(sample, ephem))`.
 */
export function flightAim(sample: Pick<CinematicFlightSample, 'lookSun'>, ephem: Ephemeris): LookTarget {
  const s = Math.max(0, Math.min(1, sample.lookSun ?? 0))
  return (cam) => {
    const earth = ephem.earthKm.clone().divideScalar(MOON_R_KM).sub(cam.pos).normalize()
    if (s <= 0) return earth
    const sun = ephem.sunKm.clone().divideScalar(MOON_R_KM).sub(cam.pos).normalize()
    if (s >= 1) return sun
    return earth.multiplyScalar(1 - s).addScaledVector(sun, s).normalize()
  }
}

/**
 * Whether the eclipse flight's gaze is on the Sun, for the exposure (sunInFrame's `sunLook`): true for the whole Sun-aimed lift and lowering, so the
 * flag never switches while the Sun is on screen (it is harmless while the Sun is out of the frame).
 */
export function sunGaze(sample: Pick<CinematicFlightSample, 'look' | 'lookSun'>): boolean {
  return (sample.lookSun ?? 0) > 0.5 && sample.look > 0
}

/**
 * Where "Return" may restart the eclipse flight: its gaze is aimed at the Sun (not the Earth, which is all a fly-to approach can look at) or part-way to
 * the Earth for most of it, so a progress `u` left there restarts at the latest earlier progress whose gaze is on the Moon's centre (the start, for the Sun beat).
 */
export function eclipseResumeU(u: number): number {
  const t = eclipseEase(Math.max(0, Math.min(1, u)))
  let tBack = 0
  for (let i = 0; i < ECLIPSE_LOOK_W.length - 1; i++) {
    const [t0, w0] = ECLIPSE_LOOK_W[i], [t1, w1] = ECLIPSE_LOOK_W[i + 1]
    if (w0 !== 0 || w1 !== 0) continue
    if (t >= t0 && t <= t1) { tBack = t; break }
    if (t1 < t) tBack = t1
  }
  if (tBack === t) return u
  let lo = 0, hi = 1
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (eclipseEase(mid) < tBack) lo = mid; else hi = mid }
  return lo // the side whose ease is below tBack, so the gaze weight is exactly 0
}

/** Short integration name used by the moment playback loop. */
export const sampleFlight = sampleCinematicFlight

/** Angular length of a route segment, useful to the arrival fly-to planner. */
export function cinematicSegmentDegrees(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  return angularDistance(a.lon, a.lat, b.lon, b.lat) / DEG
}
