import { Quaternion, Vector3 } from 'three'
import type { Ephemeris } from '../ephemeris'
import { EARTH_R_KM, MOON_R_KM } from '../glsl/common'
import { EARTH_VIEW_FILL, type Pose, type ViewCamera, clampDist, earthViewCamera, flyTanHalf, poseBasis, sizeRatio, subEarthPose, basisFromQuat, quatFromBasis } from '../camera/pose'
import type { Observer } from './observer'

/**
 * The lift-off: one continuous camera from the ridge view (an observer on the Earth's surface, the crescent Moon
 * through a telephoto lens, level with the horizon) to the site's ordinary orbit view of the Moon (a "fly" pose
 * over the sub-Earth point, lunar north up), with no cut. Pure functions of the progress u (0 to 1).
 *
 * Two overlapping phases:
 *  - Lift (u to LIFT_END): the camera rises straight up from the observer, 20 m to 120 km on a log scale under a
 *    smoothstep, and the lens widens to 15 degrees, so the ridge sinks, the sky thins to black and the Earth's
 *    limb curves into the frame. Modelled with the real geometry (the horizon's dip, the air's column) but the
 *    ridge and the Earth below are illustrative.
 *  - Fly (from FLY_START): the dolly zoom the site already uses out of the Earth view: the distance from the
 *    Moon and the Moon's size in the frame move on log scales, position, roll and lens land exactly on
 *    `endPose`.
 * The Earth observer geometry is real (place and time to the Moon's direction, its distance about 400,000 km); the
 * time the journey takes is compressed and the page says so.
 */

export const LIFT_START_M_ABOVE = 0.02
/** Height the lift reaches, km above the observer. */
export const LIFT_HEIGHT_KM = 120
export const LIFT_END = 0.32
export const FLY_START = 0.72
/** The lens at the ridge view and at the top of the lift, degrees across the frame's short side. */
export const RIDGE_FOV_DEG = 0.95
export const LIFT_FOV_DEG = 60
/**
 * The look-back is pitched this far from straight down, toward the horizon 90 degrees round from the Sun, degrees. Straight down, at 120 km, a 60 degree lens holds
 * only the ground below (a dusk Earth with no light on it: audit 7 measured a black frame for 9 s); 58 degrees puts the glowing limb and a strip of
 * space in the frame, because the horizon is 79 degrees from straight down at that height. A framing choice.
 */
export const LOOKBACK_TILT_DEG = 58
/** Seconds the whole journey takes at normal speed (real time from the ridge to the Moon is about three days). */
export const JOURNEY_SECONDS = 24
/** Scale height of the air, km: the share of the atmosphere still above a camera at height h is exp(-h / H). */
export const AIR_SCALE_KM = 8.4

const smooth = (x: number): number => {
  const t = Math.max(0, Math.min(1, x))
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k

export interface JourneyCtx {
  e: Ephemeris
  aspect: number
  obs: Observer
}

export interface JourneyFrame {
  cam: ViewCamera
  /** Height above the Earth's sphere, km. */
  altKm: number
  /** Share of the air's column still above the camera (1 on the ground, 0 in space). */
  air: number
  /** How much of the ridge is drawn: 1 on the ground, 0 once the camera is well above it. */
  ridge: number
  /** Height the camera has risen above the observer in the lift, km. */
  liftKm: number
  /** The horizon's dip below the level, deg. */
  dipDeg: number
  /** Camera up direction blend: 0 zenith, 1 lunar north. */
  rollBlend: number
  /** The lens across the short side, deg (for captions). */
  fovDeg: number
  subject: 'earth' | 'moon' | 'turn'
  earthLook: number
  /** A camera that looks at the Moon whatever the journey's own view is doing (the Moon-view basis and lens, before the look-back): what the exposure searches for the Moon with. */
  searchCam: ViewCamera
}

/** The end of the journey: the pose the site's own dolly zoom out of the Earth view lands on (CameraRig.enterFly). */
export function endPose(e: Ephemeris, aspect: number): Pose {
  const earth = earthViewCamera(e, aspect)
  const ratio = sizeRatio(earth.pos.length(), earth.tanHalf)
  const d1 = clampDist(1 / Math.sin(Math.atan(ratio * flyTanHalf(aspect))))
  return subEarthPose(e, d1)
}

/** Height above the observer for lift progress k (0 to 1). */
export function liftHeightKm(k: number): number {
  const a = LIFT_START_M_ABOVE
  return a * (Math.pow(LIFT_HEIGHT_KM / a + 1, Math.max(0, Math.min(1, k))) - 1)
}

/** The horizon's dip for a camera `altKm` above the sphere, deg. */
export function horizonDipDeg(altKm: number): number {
  return Math.acos(EARTH_R_KM / (EARTH_R_KM + Math.max(0, altKm))) * 180 / Math.PI
}

/**
 * The camera to search the frame for exposure with: the journey's own, but never wider than a lens that fills 85% of the short side
 * with the Moon (the site's Earth-view framing), so a Moon a few pixels across in a wide lens is still found and exposed for.
 */
export function moonFramedCamera(cam: ViewCamera): ViewCamera {
  const moon = Math.tan(Math.asin(Math.min(1, 1 / cam.pos.length()))) / EARTH_VIEW_FILL
  return cam.tanHalf <= moon * (1 + 1e-9) ? cam : { ...cam, tanHalf: moon }
}

export function journeyFrame(u: number, ctx: JourneyCtx): JourneyFrame {
  const { e, aspect, obs } = ctx
  const uu = Math.max(0, Math.min(1, u))
  const kA = smooth(uu / LIFT_END)
  const kB = smooth((uu - FLY_START) / (1 - FLY_START))
  const end = endPose(e, aspect)
  const endB = poseBasis(e, end)
  const d1 = end.dist
  const P1 = endB.back.clone().multiplyScalar(d1)
  const P0 = obs.pos
  const dist0 = P0.length()

  // Position: the observer plus the lift, then along the way to the end pose (direction turns, distance on a log scale).
  const liftKm = liftHeightKm(kA)
  const dir = new Vector3().copy(P0).normalize()
  const dirEnd = P1.clone().normalize()
  const ang = dir.angleTo(dirEnd)
  const dirNow = ang < 1e-9 ? dir.clone() : slerp(dir, dirEnd, kB, ang)
  const dist = Math.exp(lerp(Math.log(dist0), Math.log(d1), kB))
  const pos = dirNow.multiplyScalar(dist).addScaledVector(obs.zenith, liftKm / MOON_R_KM * (1 - kB))

  // Lens: the Moon's size in the frame, on a log scale, widening in the lift and then growing to the fly view's.
  const tan0 = flyTanHalf(aspect, RIDGE_FOV_DEG)
  const tanA = flyTanHalf(aspect, LIFT_FOV_DEG)
  const r0 = sizeRatio(dist0, tan0)
  const rA = sizeRatio(dist0, tanA)
  const rEnd = sizeRatio(d1, flyTanHalf(aspect))
  // The Moon's growth is front-loaded (1 - (1 - kB)^5) so it is a real disc soon after the air is gone, not a dot on black.
  const kR = 1 - Math.pow(1 - kB, 5)
  const turn = smooth((uu - 0.40) / 0.32)
  const liftRatio = lerp(Math.log(r0), Math.log(rA), smooth(uu / 0.2))
  const logR = lerp(lerp(liftRatio, Math.log(r0), turn), Math.log(rEnd), kR)
  const D = pos.length()
  let tanHalf = Math.tan(Math.asin(Math.min(1, 1 / D))) / Math.exp(logR)

  // Orientation: look at the Moon's centre, up from the zenith to lunar north.
  const back = pos.clone().normalize()
  const hint = obs.zenith.clone().multiplyScalar(1 - kB).addScaledVector(endB.up.clone().addScaledVector(back, -endB.up.dot(back)).normalize(), kB)
  const upV = hint.addScaledVector(back, -hint.dot(back))
  if (upV.length() < 1e-6) upV.copy(endB.up)
  upV.normalize()
  const right = new Vector3().crossVectors(upV, back)
  const earthCentre = e.earthKm.clone().divideScalar(MOON_R_KM)
  const earthLook = smooth((uu - 0.08) / 0.32) * (1 - smooth((uu - 0.40) / 0.32))
  let viewBack = back, viewUp = upV, viewRight = right
  if (earthLook > 0) {
    const down = pos.clone().sub(earthCentre).normalize()
    const toSun = e.sunKm.clone().sub(e.earthKm).normalize()
    const side = toSun.addScaledVector(down, -toSun.dot(down))
    const tilt = LOOKBACK_TILT_DEG * Math.PI / 180
    // Toward the Sun's side the Sun itself stands over the limb (a dusk Sun is 10 degrees down and the horizon at 120 km is 11), and its glare fills the frame; so look 90 degrees round from it, along the limb.
    const along = new Vector3().crossVectors(down, side).normalize()
    const earthBack = side.length() > 1e-6 ? down.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(along, -Math.sin(tilt)).normalize() : down
    const hintEarth = obs.north.clone().addScaledVector(earthBack, -obs.north.dot(earthBack)).normalize()
    const earthRight = new Vector3().crossVectors(hintEarth, earthBack).normalize()
    const view = basisFromQuat(new Quaternion().slerpQuaternions(quatFromBasis(right, upV, back), quatFromBasis(earthRight, hintEarth, earthBack), earthLook))
    viewBack = view.back; viewUp = view.up; viewRight = view.right
    // During the turn keep a meaningful limb/subject inside the frustum. The wide look-back is a 60-degree lens.
    const earthDistance = pos.distanceTo(earthCentre)
    const earthRadius = Math.asin(Math.min(1, EARTH_R_KM / MOON_R_KM / earthDistance))
    const moonRadius = Math.asin(Math.min(1, 1 / pos.length()))
    const moonAngle = Math.acos(Math.max(-1, Math.min(1, viewBack.dot(back))))
    const earthAngle = Math.acos(Math.max(-1, Math.min(1, viewBack.dot(down))))
    const halfForMoon = moonAngle + moonRadius / EARTH_VIEW_FILL
    const halfForEarthLimb = Math.max(0, earthAngle - earthRadius * 0.7)
    const required = Math.min(halfForMoon, halfForEarthLimb)
    const wide = flyTanHalf(aspect, LIFT_FOV_DEG)
    const lensEnvelope = uu <= 0.4 ? wide * earthLook : Math.exp(lerp(Math.log(wide), Math.log(tan0), smooth((uu - 0.4) / 0.55)))
    tanHalf = Math.max(tanHalf, lensEnvelope, Math.tan(Math.min(1.35, required)))
  }
  if (uu > 0.4 && uu < 0.95) tanHalf = Math.max(tanHalf, Math.exp(lerp(Math.log(flyTanHalf(aspect, LIFT_FOV_DEG)), Math.log(tan0), smooth((uu - 0.4) / 0.55))))
  const cam: ViewCamera = { pos, right: viewRight, up: viewUp, back: viewBack, tanHalf }
  const searchCam: ViewCamera = { pos, right, up: upV, back, tanHalf: Math.tan(Math.asin(Math.min(1, 1 / D))) / Math.exp(logR) }

  const centre = e.earthKm.clone().divideScalar(MOON_R_KM)
  const altKm = pos.clone().sub(centre).length() * MOON_R_KM - EARTH_R_KM
  return {
    cam,
    altKm,
    // The optical depths are for the observer's own height: the column above them is 1 there.
    air: Math.exp(-Math.max(0, altKm - obs.site.heightM / 1000) / AIR_SCALE_KM),
    ridge: 1 - smooth((liftKm - 0.35) / 1.15),
    liftKm,
    dipDeg: horizonDipDeg(altKm),
    rollBlend: kB,
    subject: earthLook > 0.95 ? 'earth' : earthLook > 0 ? 'turn' : 'moon',
    earthLook,
    searchCam,
    fovDeg: 2 * Math.atan(tanHalf * Math.min(1, aspect)) * 180 / Math.PI,
  }
}

function slerp(a: Vector3, b: Vector3, k: number, ang: number): Vector3 {
  const s = Math.sin(ang)
  if (s < 1e-9) return a.clone()
  return a.clone().multiplyScalar(Math.sin((1 - k) * ang) / s).addScaledVector(b, Math.sin(k * ang) / s)
}
