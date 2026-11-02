import { EARTH_R_KM } from '../glsl/common'
import { SUN_R_KM } from '../lighting/solar'

/**
 * Which way the Sun is drawn.
 *
 * Display path (glare.direct): the disc is not stored in the HDR scene; the final pass draws it, with its glow, in display space
 * (src/sun/sunLook.ts). HDR path: the disc is stored clamped at SUN_CAP and the glare pyramid plus the analytic veil spread it.
 *
 * Every in-frame Sun takes the display path, except:
 *  - an eclipse view: the Earth's disc covers or nearly covers the Sun (the refracted ring is HDR content and the Earth hides the disc), and
 *  - a foreground view with no coverage source: the ridge view draws terrain over the sky, and the display path hides the disc by the analytic
 *    lunar sphere, the Earth and (in audit frames) the metadata only, so it cannot see the ridge in front of the Sun.
 * Ground mode and a flight's lander are foreground views WITH a coverage source: their scene target has a depth attachment (the ground pass and the module
 * write it, the sky stays at the far plane), which the final pass reads to hide the disc and the core bloom per pixel and to measure the open share
 * (src/sun/sunCoverage.ts). They take the display path.
 * Frames that were already on the display path (the Moon as the subject: glareScale < 1) stay there. `?sun=legacy` is the previous rule only.
 */

interface V3 { x: number; y: number; z: number }

/** The ring pass (EarthPass `uRingOn`) runs when the Sun lies within this many radians of the Earth's centre line. */
export const EARTH_RING_RADIUS = 0.03
/** Beyond the Earth's limb, the Sun counts as nearly covered within this many Sun radii. */
const EARTH_NEAR_SUN_RADII = 2

export interface SunRouteInput {
  /** `?sun=legacy`. */
  legacy: boolean
  /** The scale main.ts asks for: below 1 while the Moon is the subject or a scripted look turns to the Sun (the established display path). */
  glareScale: number
  /** Terrain or the lander draws over the sky in this frame (ground mode, ridge view, a flight's lander). */
  foreground: boolean
  /** The final pass can read a per-pixel coverage of that foreground (the scene target's depth attachment: ground mode, a flight's lander). */
  coverage: boolean
  /** The Earth covers or nearly covers the Sun (earthNearSun). */
  eclipse: boolean
}

/** True: draw the Sun in display space. False: keep the HDR path. */
export function sunUsesDisplayPath(i: SunRouteInput): boolean {
  if (i.glareScale < 1) return true
  if (i.legacy || (i.foreground && !i.coverage) || i.eclipse) return false
  return true
}

const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z
const len = (a: V3): number => Math.hypot(a.x, a.y, a.z)

/**
 * The Earth's disc covers or nearly covers the Sun, or the Sun is inside the ring pass's radius around the Earth: an eclipse view.
 * `sunRel` and `earthRel` are camera-to-body vectors in any common unit (only their direction matters); `earthDistKm` the camera-to-Earth distance
 * and `sunDistKm` the camera-to-Sun distance. Near the Earth (inside 1.5 Earth radii) the Earth is not a disc in the sky, so never an eclipse view.
 */
export function earthNearSun(sunRel: V3, earthRel: V3, earthDistKm: number, sunDistKm: number): boolean {
  if (!(earthDistKm > 1.5 * EARTH_R_KM)) return false
  const cos = dot(sunRel, earthRel) / (len(sunRel) * len(earthRel))
  const sep = Math.acos(Math.max(-1, Math.min(1, cos)))
  const earthR = Math.asin(Math.min(1, EARTH_R_KM / earthDistKm))
  const theta = Math.asin(Math.min(1, SUN_R_KM / sunDistKm))
  return sep < Math.max(EARTH_RING_RADIUS, earthR + EARTH_NEAR_SUN_RADII * theta)
}
