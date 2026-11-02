import { type Pose, angularDistance } from '../camera/pose'
import { bowOf, bowedTravel } from '../journey/path'

/**
 * The camera path of a landing journey ("Zoom to Apollo 17", "Beside the LM" ...): a powered descent that ends a short way
 * off the landing site, low, looking at it at a shallow angle. Pure: main.ts supplies the terrain and the funnel floor.
 *
 * What is MEASURED (data/apollo17/descent-track.json, built from the Mission Report and the crew's calls; the pitch-over time
 * is a verified event, the track's positions around it are modelled):
 *   - P64 approach phase / pitch-over at 562 s: about 2.4 km above the site, 3.8 km out (E 3793 m at 560 s, alt 2399 m), a
 *     line of sight 32 degrees below the horizontal.
 *   - Final approach: at 600 s the module is 835 m up and 828 m out (45 degrees), at 650 s 88 m up and 13 m out.
 * What is a CHOICE (nothing in the Apollo data fixes it for a camera):
 *   - The camera stands where the module was at pitch-over (PITCH_OVER_ALT_M, PITCH_OVER_ANGLE_DEG), turns over to look at the
 *     site in PITCH_OVER_SPAN of the journey, then closes slowly, eased out to a stop. It never goes through the site's
 *     last 650 s of the track: the camera floor (one texel per pixel, about 1 km up) stops it first.
 *   - The end altitude is the site funnel's own floor, the end sight angle is the site table's `end.pitchDeg` (tilt from straight down).
 *   - Where in the journey the pitch-over happens (PITCH_OVER_U) and how long the turn takes.
 */
export const PITCH_OVER_ALT_M = 2400
export const PITCH_OVER_ANGLE_DEG = 32
/** Journey progress at which the camera reaches the pitch-over point, and the share of the journey the turn to the site takes. */
export const PITCH_OVER_U = 0.62
export const PITCH_OVER_SPAN = 0.36
/**
 * The smoothed path (default; `?descent=legacy` restores the earlier one). Rig, 2026-10-18 (266d6582): the last 30 % of the Apollo 17 pin turned the
 * view at up to 66 deg/s and Apollo 11's ground track changed turn direction 2 to 4 times. Offline the earlier path turns at 26 (Apollo 11) and 32 deg/s
 * (Apollo 17) at 60 fps, and its track bows one way, pauses at the end of the slide and runs back the other way (an S). Changes, the arrival pose untouched:
 *   - the turn from straight down to the line of sight at the site starts at SMOOTH_PITCH_START_U and takes the rest of the journey (it began at
 *     PITCH_OVER_U and took PITCH_OVER_SPAN): the peak falls to about 18 deg/s;
 *   - the range to the site starts shrinking at SMOOTH_RANGE_START_U (the end of the slide) instead of waiting for PITCH_OVER_U, so the track does not stop and reverse;
 *   - the bow takes the side that turns into the final run along the end heading (bowOf's `arrive`), so the ground track turns one way.
 */
export const SMOOTH_PITCH_START_U = 0.35
export const SMOOTH_RANGE_START_U = 0.5
export const SMOOTH_PITCH_SPAN = 1 - SMOOTH_PITCH_START_U
/** Until the detailed terrain is resident the journey waits here, before the low part. */
export const LOW_PART_U = PITCH_OVER_U

const DEG = Math.PI / 180
/** The share of an apex drop over which the camera's own pitch and roll blend into the path's. */
const ATTITUDE_BLEND_U = 0.3
export const smootherstep = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * t * (t * (t * 6 - 15) + 10) }
const smooth = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t) }

export interface LandingEnd { headingDeg: number; pitchDeg: number }
export interface LandingInput {
  site: { lon: number; lat: number }
  end: LandingEnd
  /** The end altitude above the site's ground, radii (the site funnel's floor at the end). */
  alt1: number
  from: Pose
  /** Altitude above the ground at the start, radii. */
  alt0: number
  /** The share of the journey the slide over the site takes. */
  slide: number
  groundAt: (lon: number, lat: number) => number
  /** The closest distance from the Moon's centre the camera may have over (lon, lat), radii. */
  floorAt: (lon: number, lat: number) => number
  /** The camera's relief share at a distance (reliefShare in pose.ts). */
  relief: (dist: number) => number
  moonRadiusM: number
  /**
   * A drop from a high apex (the Apollo 11 pin, WP8): altitude above the ground, radii, of the highest point of the path. A start below it climbs
   * to it over the first `climbU` of the journey (the one move out of a low flight), a start above it descends from where it is.
   * Set, there is no rise on a trip from another place (the 0.3 * dRem term) and the altitude never rises after the apex.
   */
  apex?: number
  /** The share of the journey the climb to the apex takes (0 when the start is already at or above it). */
  climbU?: number
  /** The path before the descent smoothing (`?descent=legacy`): the short pitch-over, the range shrinking from PITCH_OVER_U, the bow's default side. */
  legacy?: boolean
}

/** Altitude on a log scale through (0, a0), (uPo, aPo), (1, a1): a monotone cubic with no slope at either end and the chords' mean at the middle knot. */
function logAlt(u: number, a0: number, aPo: number, a1: number): number {
  const l0 = Math.log(a0), lp = Math.log(aPo), l1 = Math.log(a1)
  const d0 = (lp - l0) / PITCH_OVER_U, d1 = (l1 - lp) / (1 - PITCH_OVER_U)
  const mp = d0 * d1 <= 0 ? 0 : 2 * d0 * d1 / (d0 + d1)
  const hermite = (x: number, y0: number, y1: number, m0: number, m1: number, h: number): number => {
    const s = x / h, s2 = s * s, s3 = s2 * s
    return (2 * s3 - 3 * s2 + 1) * y0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * y1 + (s3 - s2) * h * m1
  }
  const x = Math.max(0, Math.min(1, u))
  return Math.exp(x <= PITCH_OVER_U ? hermite(x, l0, lp, 0, mp, PITCH_OVER_U) : hermite(x - PITCH_OVER_U, lp, l1, mp, 0, 1 - PITCH_OVER_U))
}

/** The pose at journey progress u (0 to 1): the descent, the pitch-over, the slow final approach. */
export function landingPose(u: number, p: LandingInput): Pose {
  const { lon, lat } = p.site
  const R = p.moonRadiusM
  const apex = p.apex
  const c = apex !== undefined && p.alt0 < apex ? Math.max(0, Math.min(0.6, p.climbU ?? 0)) : 0
  // With a climb the descent proper runs on the rest of the journey: every curve below takes uu, the slide takes the whole.
  const uu = c > 0 ? Math.max(0, (u - c) / (1 - c)) : u
  // The travel over to the site flies the fly-to's curve (journey/path.ts): one bow toward the top of the starting frame along the great
  // circle, banked into the turn, never a straight sideways slide.
  const kl = smooth(Math.min(1, u / p.slide))
  const legacy = p.legacy === true
  // The camera's last move is along the end heading (the range shrinks toward the site): the bow takes the side that turns into that run, as a
  // fly-to that hands over to a flight does (bowOf's `arrive`), so the ground track turns one way instead of bowing one way and being bent back.
  const hRun = p.end.headingDeg * DEG
  const arrive = legacy ? undefined : { lon: Math.sin(hRun) / Math.max(0.05, Math.cos(lat * DEG)), lat: Math.cos(hRun) }
  const track = bowedTravel(p.from, lon, lat, kl, bowOf(p.from, lon, lat, arrive))
  const l = track.lon, b = track.lat
  const alt1 = p.alt1
  // The pitch-over point: where the module was at the measured altitude, never lower than the end allows for.
  const aPo0 = Math.max(PITCH_OVER_ALT_M / R, 2 * alt1)
  // ...and never below what the coverage allows at the station itself: the measured station can lie outside the finest picture's box, where the floor is
  // the coarser level's one-texel-per-pixel altitude (4.5 km at Apollo 11). A path that wanted 2.4 km there was clamped flat from above for seconds (the
  // plateau, diagnosis F3); it now eases INTO the floor altitude and descends from there.
  let aPo = aPo0
  if (apex !== undefined) {
    const hS = p.end.headingDeg * DEG
    const rS = aPo0 / Math.tan(PITCH_OVER_ANGLE_DEG * DEG)
    const latS = lat - rS / DEG * Math.cos(hS)
    const lonS = lon - rS / DEG * Math.sin(hS) / Math.max(0.05, Math.cos(latS * DEG))
    aPo = Math.max(aPo0, p.floorAt(lonS, latS) - 1 - p.groundAt(lonS, latS))
  }
  const aStart = apex !== undefined ? (c > 0 ? apex : p.alt0) : Math.max(p.alt0, aPo * 1.5)
  // A trip from another site keeps an altitude of a third of the distance left (rising first, coming down as it closes).
  const dRem = angularDistance(l, b, lon, lat)
  let alt: number
  if (apex !== undefined) {
    // Climb (if any) on a log scale with no slope at either end, then the descent: nothing rises after the apex, nothing hovers.
    alt = u < c ? Math.exp(Math.log(p.alt0) + (Math.log(aStart) - Math.log(p.alt0)) * smootherstep(u / c)) : logAlt(uu, aStart, aPo, alt1)
  } else alt = Math.max(logAlt(u, aStart, aPo, alt1), 0.3 * dRem * smooth(u / 0.15))
  // The camera's ground range from the site: the measured pitch-over range, then the eased close to the end range.
  const rEnd = alt1 * Math.tan(p.end.pitchDeg * DEG)
  const rPo = aPo / Math.tan(PITCH_OVER_ANGLE_DEG * DEG)
  const rU = legacy ? PITCH_OVER_U : SMOOTH_RANGE_START_U
  const r = (rPo + (rEnd - rPo) * smootherstep((uu - rU) / (1 - rU))) * kl
  const hEnd = p.end.headingDeg * DEG
  const lat2 = b - r / DEG * Math.cos(hEnd)
  const lon2 = l - r / DEG * Math.sin(hEnd) / Math.max(0.05, Math.cos(lat2 * DEG))
  // The turn to look at the site (the pitch-over): from straight down to the line of sight at the site.
  const toSite = Math.atan2(r, Math.max(alt, 1e-12)) / DEG
  const pitch = toSite * (legacy ? smootherstep((uu - PITCH_OVER_U) / PITCH_OVER_SPAN) : smootherstep((uu - SMOOTH_PITCH_START_U) / SMOOTH_PITCH_SPAN))
  const h = p.end.headingDeg * DEG * smootherstep((uu - 0.5) / 0.3)
  const ground = p.groundAt(l, b)
  const dist = Math.max(1 + ground + alt, p.floorAt(lon2, lat2))
  // A drop from a camera that is tilted or rolled blends from that attitude over the first part of the journey (no snap on the first frame).
  const k = apex !== undefined ? smootherstep(u / ATTITUDE_BLEND_U) : 1
  return { lon: lon2, lat: lat2, dist, roll: p.from.roll + (-h / DEG - p.from.roll) * k + track.bankDeg, pitch: (p.from.pitch ?? 0) + (pitch - (p.from.pitch ?? 0)) * k }
}
