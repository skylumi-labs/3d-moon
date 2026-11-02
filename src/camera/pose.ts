import { Matrix4, Quaternion, Vector3 } from 'three'
import { MOON_R_KM } from '../glsl/common'
import type { Ephemeris, LonLat } from '../ephemeris'

/**
 * Camera geometry, in the world frame and Moon radii.
 *
 * A fly pose (moon-v1's) is the point under the camera in selenographic
 * longitude (east positive) and latitude, the distance from the Moon's
 * centre, and a roll about the line of sight (0: lunar north up). It is
 * fixed to the Moon's body, so the Sun and the Earth stay where they are for
 * the moment and every side shows its real phase.
 */

const DEG = Math.PI / 180

export interface Pose {
  lon: number
  lat: number
  /** Moon radii from the centre. */
  dist: number
  roll: number
  /**
   * Tilt from straight down toward the horizon, deg (0, the default: the
   * Moon's centre in the middle of the frame). Only felt near the ground: see
   * reliefShare, which fades it out above 2.4 radii so every ordinary view
   * keeps looking at the centre.
   */
  pitch?: number
}

/** What every pass needs from the camera for one frame. */
export interface ViewCamera {
  /** Camera position, world frame, Moon radii. */
  pos: Vector3
  /** Orthonormal view basis in the world frame; the view looks along -back. */
  right: Vector3
  up: Vector3
  back: Vector3
  /** Tangent of the vertical half-field. */
  tanHalf: number
}

/** The fly field spans 30 deg across the frame's short side. */
export const FLY_FOV_DEG = 30
/** Level-0 height texel at the equator, km (4096 px around the Moon). */
const TEXEL_KM = 2 * Math.PI * MOON_R_KM / 4096
/**
 * Closest approach, Moon radii from the centre (3.58). There a 4k texel
 * under the camera is 1/880 of the frame's short side, the scale of the
 * telescope view's 0.35 deg limit, and the smooth limb (no relief on the
 * silhouette) misses mountains of +-5 km by under 1/600 of the frame.
 * Closer, both show; the tiles of milestone 2 lift this.
 */
export const D_MIN = 1 + 880 * TEXEL_KM / (MOON_R_KM * FLY_FOV_DEG * DEG)
/** The farthest the Moon can be dragged back to, Moon radii (the navigator's range is HOME_DIST at the start, 12 at most: past 8 the Moon is a dot). */
export const D_MAX = 12
/** The opening view's distance from the Moon's centre, Moon radii. */
export const HOME_DIST = 6
/** The opening view: the Moon fills this share of the frame's short side. */
export const EARTH_VIEW_FILL = 0.85

/**
 * The floor with the milestone-2 tiles (DESIGN-M2.md section 7): the closest
 * distance at which the finest data (a height texel of `texelKm`) still spans
 * one canvas pixel or more, for a field of `fovDeg` across the short side of a
 * canvas `shortPx` device pixels wide. Closer, the picture would only be
 * magnified. The canvas size is capped so a huge screen still gets close
 * (magnified past the data there, and the caption says so). With LOLA's
 * 0.474 km: 1.45 at 880 px, 1.55 at 1080 px, 1.62 at 1170 px.
 */
export const FLOOR_MAX_PX = 1200
export function floorDist(texelKm: number, shortPx: number, fovDeg = FLY_FOV_DEG): number {
  const px = Math.max(1, Math.min(shortPx, FLOOR_MAX_PX))
  return 1 + texelKm * px / (MOON_R_KM * 2 * Math.tan(fovDeg * DEG / 2))
}

/** The largest tilt toward the horizon, deg. */
export const PITCH_MAX = 65
/** Over a site that follows its terrain (mountains to look at) the tilt may go nearly to the horizon, deg. */
export const SITE_PITCH_MAX = 82

/**
 * How much of the relief the camera and the shader honour, by distance from
 * the centre (Moon radii): all of it below 1.8, none from 2.4 up, smooth
 * between. It scales the pitch and the ground hit's terrain (MoonPass), so
 * zooming out returns to the centred, sphere-hit view exactly.
 */
export function reliefShare(dist: number): number {
  const t = Math.max(0, Math.min(1, (2.4 - dist) / 0.6))
  return t * t * (3 - 2 * t)
}

/** Clamp to [dMin, D_MAX]; dMin is D_MIN until tiles lower it (rig.setFloor). */
export const clampDist = (d: number, dMin: number = D_MIN): number => Math.max(dMin, Math.min(D_MAX, d))

/**
 * One wheel notch or pinch step, `factor` on the distance. Above 3 radii it
 * scales the distance from the centre as always; below 2 it scales the
 * altitude (dist - 1), so the last stretch to the ground takes as many notches
 * as any other doubling of the height; between, the two laws blend.
 */
export function zoomDist(dist: number, factor: number, ground = 0): number {
  const t = Math.max(0, Math.min(1, (3 - dist) / 1))
  const k = t * t * (3 - 2 * t)
  // `ground` (radii from the 1 radius sphere, negative in a basin) makes the altitude law count from the ground.
  return (1 - k) * dist * factor + k * (1 + ground + (dist - 1 - ground) * factor)
}

/**
 * A place with a local high-resolution patch (src/moon/patch). Its own floor is the
 * closest the patch's finest texel allows, above the patch's ground, and it opens
 * like a funnel: a camera may go as low as `altR + SITE_CONE * s` above the ground
 * at an angular distance s (radians) from the site, so a dive has to come in over
 * the site. Where the cone is above the global floor (beyond about 0.2 radii of arc, 350 km) the
 * global floor rules; the cone is steep (2, about 63 degrees from straight down), so the
 * low floor is only open over the site's own neighbourhood, never far from the data.
 */
export interface SiteFloor {
  lon: number
  lat: number
  /** The ground at the site, radii from the 1 radius sphere. */
  groundR: number
  /** Altitude above the ground at one texel per pixel, radii. */
  altR: number
  /**
   * Altitude above the ground the finest picture UNDER (lon, lat) supports, radii (coverage.ts coverageAlt): it follows the coverage boxes,
   * so past the edge of a fine level the floor rises as a cone from that edge instead of staying at the site's one-texel altitude.
   * Absent: the flat cone from the site point.
   */
  alt?: (lon: number, lat: number) => number
  /** Where the terrain model is followed instead of one flat height (a site among mountains): see SiteTerrain. */
  terrain?: SiteTerrain
}
/**
 * The terrain model coarsened to a grid of square cells (metres east and north of the site; `mean` is the
 * ground the altitude reads from, `max` the highest ground within a cell and its eight neighbours, which the
 * floor keeps the camera above), heights in radii from the 1 radius sphere. Row 0 is the northern edge.
 */
export interface SiteTerrain {
  eastM: number
  northM: number
  cellM: number
  /** The cell's north-south size when it differs from `cellM` (the east-west size): 8 m texels are 7.99 m wide and 8 m tall, so 16 of them make cells 127.84 by 128 m. */
  cellNorthM?: number
  w: number
  h: number
  mean: Float32Array
  max: Float32Array
}
/** Distance in metres over which the terrain grid gives way to the flat site ground at the edge of the model. */
export const TERRAIN_EDGE_M = 3000
export const SITE_CONE = 2
/** The floor is flat within this arc of the site (radians, about 3 km: the patch's finest level is 2 km across), so an oblique view over it can back off a little. */
export const SITE_FLAT = 0.0017
/** Angular distance, radians, between two selenographic points. */
export function angularDistance(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const a1 = lat1 * DEG, a2 = lat2 * DEG
  const h = Math.sin((a2 - a1) / 2) ** 2 + Math.cos(a1) * Math.cos(a2) * Math.sin(((lon2 - lon1) * DEG) / 2) ** 2
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}
/** The flat site ground under (lon, lat), radii from the sphere: all of it within 0.03 rad of the site, none from 0.06 (about 100 km). */
function flatGround(site: SiteFloor, lon: number, lat: number): number {
  const s = angularDistance(lon, lat, site.lon, site.lat)
  const t = Math.max(0, Math.min(1, (0.06 - s) / 0.03))
  return site.groundR * t * t * (3 - 2 * t)
}
/** A terrain grid's value under (lon, lat) and how far inside the grid that point is (1: further in than TERRAIN_EDGE_M, 0: on or outside its edge). */
function terrainSample(site: SiteFloor, grid: 'mean' | 'max', lon: number, lat: number): { v: number; inside: number; dEdgeM: number } {
  const t = site.terrain as SiteTerrain
  const R = MOON_R_KM * 1000
  const e = wrapLon(lon - site.lon) * DEG * Math.cos(site.lat * DEG) * R
  const n = (lat - site.lat) * DEG * R
  const fx = (e - t.eastM) / t.cellM - 0.5
  const cn = t.cellNorthM ?? t.cellM
  const fy = (t.northM - n) / cn - 0.5
  const dEdge = Math.min(e - t.eastM, t.eastM + t.w * t.cellM - e, t.northM - n, n - (t.northM - t.h * cn))
  const inside = Math.max(0, Math.min(1, dEdge / TERRAIN_EDGE_M))
  if (dEdge <= 0) return { v: 0, inside: 0, dEdgeM: dEdge }
  const x0 = Math.max(0, Math.min(t.w - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(t.h - 1, Math.floor(fy)))
  const x1 = Math.min(t.w - 1, x0 + 1), y1 = Math.min(t.h - 1, y0 + 1)
  const ax = Math.max(0, Math.min(1, fx - x0)), ay = Math.max(0, Math.min(1, fy - y0))
  const a = t[grid]
  const v = (a[y0 * t.w + x0] * (1 - ax) + a[y0 * t.w + x1] * ax) * (1 - ay) + (a[y1 * t.w + x0] * (1 - ax) + a[y1 * t.w + x1] * ax) * ay
  return { v, inside: inside * inside * (3 - 2 * inside), dEdgeM: dEdge }
}
/**
 * The patch's ground under (lon, lat), radii from the sphere. Flat (the site's height) unless the site follows its
 * terrain, which it does inside its model, easing into the flat ground over TERRAIN_EDGE_M at the model's edge.
 */
export function siteGround(site: SiteFloor, lon: number, lat: number): number {
  const flat = flatGround(site, lon, lat)
  if (!site.terrain) return flat
  const { v, inside } = terrainSample(site, 'mean', lon, lat)
  return flat + (v - flat) * inside
}
/** The highest ground the floor must clear under (lon, lat): siteGround, but from the terrain's cell maxima. */
export function siteFloorGround(site: SiteFloor, lon: number, lat: number): number {
  const flat = flatGround(site, lon, lat)
  if (!site.terrain) return flat
  // No easing at the model's edge: the floor is the terrain's own highest ground wherever there is any.
  const { v, dEdgeM } = terrainSample(site, 'max', lon, lat)
  return dEdgeM > 0 ? Math.max(v, flat) : flat
}
/** The closest distance from the centre over (lon, lat) with the site's funnel, or Infinity far from it. */
export function siteFloorDist(site: SiteFloor, lon: number, lat: number): number {
  const s = angularDistance(lon, lat, site.lon, site.lat)
  if (site.terrain) {
    // A site that follows its terrain is safe to fly low anywhere inside its model (the floor is the terrain's own
    // maxima plus one texel per pixel); the cone opens only from the model's edge outward.
    const outsideRad = Math.max(0, -terrainSample(site, 'max', lon, lat).dEdgeM) / (MOON_R_KM * 1000)
    return 1 + siteFloorGround(site, lon, lat) + (site.alt ? site.alt(lon, lat) : site.altR + SITE_CONE * outsideRad)
  }
  return 1 + siteFloorGround(site, lon, lat) + (site.alt ? site.alt(lon, lat) : site.altR + SITE_CONE * Math.max(0, s - SITE_FLAT))
}
/** Altitude of the camera above the site's ground at 1 texel per pixel: texelM over a canvas of shortPx (capped) at fovDeg, radii. */
export function siteAltR(texelM: number, shortPx: number, fovDeg = FLY_FOV_DEG): number {
  const px = Math.max(1, Math.min(shortPx, FLOOR_MAX_PX))
  return texelM * px / (1000 * MOON_R_KM * 2 * Math.tan(fovDeg * DEG / 2))
}
export const wrapLon = (lon: number): number => ((lon % 360) + 540) % 360 - 180

/** Vertical half-field (tangent) of the fly camera for a width/height aspect. */
export function flyTanHalf(aspect: number, fovDeg = FLY_FOV_DEG): number {
  const t = Math.tan(fovDeg * DEG / 2)
  return aspect >= 1 ? t : t / aspect
}

/** The Moon's apparent radius over the vertical half-field, for the dolly zoom. */
export function sizeRatio(dist: number, tanHalf: number): number {
  return Math.tan(Math.asin(Math.min(1, 1 / dist))) / tanHalf
}

/** Look-at-the-Moon basis for a pose (moon-v1's poseBasis, in world vectors). */
export function poseBasis(e: Ephemeris, pose: Pose): { right: Vector3; up: Vector3; back: Vector3 } {
  const cy = Math.cos(pose.lon * DEG), sy = Math.sin(pose.lon * DEG)
  const cp = Math.cos(pose.lat * DEG), sp = Math.sin(pose.lat * DEG)
  const back = new Vector3()
    .addScaledVector(e.moonX, cp * cy)
    .addScaledVector(e.moonY, cp * sy)
    .addScaledVector(e.moonZ, sp)
    .normalize()
  let upN = e.moonZ.clone().addScaledVector(back, -e.moonZ.dot(back))
  if (upN.length() < 1e-6) upN = e.moonX.clone().addScaledVector(back, -e.moonX.dot(back))
  upN.normalize()
  const r = (pose.roll || 0) * DEG
  const up = upN.clone().multiplyScalar(Math.cos(r)).addScaledVector(new Vector3().crossVectors(back, upN), Math.sin(r)).normalize()
  const right = new Vector3().crossVectors(up, back)
  return { right, up, back }
}

/** The pose whose camera sits on the Moon-Earth line (the sub-Earth point). */
export function subEarthPose(e: Ephemeris, dist: number): Pose {
  return { lon: e.subEarth.lon, lat: e.subEarth.lat, dist, roll: 0 }
}

/**
 * The opening view: from the Earth's centre, looking at the Moon's centre,
 * celestial (J2000) north up, the Moon filling EARTH_VIEW_FILL of the
 * frame's short side. There is no observer, so no horizon to be level with;
 * celestial north up shows the real tilt of the Moon's axis for the moment.
 */
export interface EarthFrame {
  /** Where the Moon's centre sits in the frame, NDC (x right, y up; 0, 0 is the middle). */
  nx: number
  ny: number
  /** The Moon's diameter as a share of the frame's short side (EARTH_VIEW_FILL when unset). */
  fill: number
}

export function earthViewCamera(e: Ephemeris, aspect: number, frame?: EarthFrame): ViewCamera {
  const pos = e.earthKm.clone().divideScalar(MOON_R_KM)
  const dist = pos.length()
  const back = pos.clone().divideScalar(dist)
  const north = new Vector3(0, 0, 1)
  let up = north.addScaledVector(back, -back.z)
  if (up.length() < 1e-6) up = new Vector3(1, 0, 0).addScaledVector(back, -back.x)
  up.normalize()
  const right = new Vector3().crossVectors(up, back)
  const tanShort = Math.tan(Math.asin(1 / dist)) / (frame ? frame.fill : EARTH_VIEW_FILL)
  const tanHalf = aspect >= 1 ? tanShort : tanShort / aspect
  if (!frame || (frame.nx === 0 && frame.ny === 0)) return { pos, right, up, back, tanHalf }
  // Turn the camera so the Moon's centre lands at (nx, ny): about the up axis for x, then about the new right axis for y.
  const a = Math.atan(frame.nx * tanHalf * aspect)
  const r1 = right.clone().applyAxisAngle(up, a)
  const b1 = back.clone().applyAxisAngle(up, a)
  const c = Math.atan(frame.ny * tanHalf)
  const up2 = up.clone().applyAxisAngle(r1, -c)
  const b2 = b1.clone().applyAxisAngle(r1, -c)
  return { pos, right: r1, up: up2, back: b2, tanHalf }
}

export function quatFromBasis(right: Vector3, up: Vector3, back: Vector3): Quaternion {
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, back))
}

export function basisFromQuat(q: Quaternion): { right: Vector3; up: Vector3; back: Vector3 } {
  return {
    right: new Vector3(1, 0, 0).applyQuaternion(q),
    up: new Vector3(0, 1, 0).applyQuaternion(q),
    back: new Vector3(0, 0, 1).applyQuaternion(q),
  }
}

/** Selenographic longitude and latitude of the point under a camera. */
export function underCamera(e: Ephemeris, pos: Vector3): { lon: number; lat: number } {
  const d = pos.clone().normalize()
  return {
    lon: Math.atan2(d.dot(e.moonY), d.dot(e.moonX)) / DEG,
    lat: Math.asin(Math.max(-1, Math.min(1, d.dot(e.moonZ)))) / DEG,
  }
}

/**
 * The fly pose whose rig camera is `cam` (the inverse of CameraRig's camera for a fly pose with a look-at-the-Moon
 * base): the point under the camera, its distance, the roll of the base frame and the tilt toward the horizon. The
 * rig scales the stored pitch by reliefShare(dist), which is 1 below 1.8 radii, so this is exact there. Used to
 * hand the ground camera back to the orbital rig without a jump.
 */
export function poseFromView(e: Ephemeris, cam: ViewCamera): Pose {
  const dist = cam.pos.length()
  const u = underCamera(e, cam.pos)
  const back = cam.pos.clone().divideScalar(dist)
  const upN = e.moonZ.clone().addScaledVector(back, -e.moonZ.dot(back)).normalize()
  const rightN = new Vector3().crossVectors(upN, back)
  const roll = Math.atan2(cam.right.dot(upN), cam.right.dot(rightN)) / DEG
  const b = poseBasis(e, { lon: u.lon, lat: u.lat, dist, roll })
  const pitch = Math.atan2(-cam.back.dot(b.up), cam.back.dot(b.back)) / DEG
  return { lon: u.lon, lat: u.lat, dist, roll, pitch }
}

/**
 * Move a point toward another along their great circle until it is at most
 * `maxSepDeg` away. Antipodal points use the great circle through lunar north.
 */
export function litSideViewPoint(subEarth: LonLat, subSolar: LonLat, maxSepDeg: number): LonLat {
  const toVector = ({ lon, lat }: LonLat): Vector3 => {
    const phi = lat * DEG, lambda = lon * DEG
    return new Vector3(Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi))
  }
  const earth = toVector(subEarth)
  const solar = toVector(subSolar)
  const dot = Math.max(-1, Math.min(1, earth.dot(solar)))
  const separation = Math.acos(dot)
  const limit = Math.max(0, Math.min(Math.PI, maxSepDeg * DEG))
  if (separation <= limit) return subEarth

  // The projected solar direction is the tangent toward the Sun. At the
  // antipode it vanishes, so choose the northward meridian as the great circle.
  const tangent = solar.clone().addScaledVector(earth, -dot)
  if (tangent.lengthSq() < 1e-20) {
    const north = new Vector3(0, 0, 1)
    tangent.copy(north).addScaledVector(earth, -north.dot(earth))
    if (tangent.lengthSq() < 1e-20) {
      const reference = new Vector3(1, 0, 0)
      tangent.copy(reference).addScaledVector(earth, -reference.dot(earth))
    }
  }
  tangent.normalize()
  const step = separation - limit
  const point = earth.multiplyScalar(Math.cos(step)).addScaledVector(tangent, Math.sin(step)).normalize()
  return {
    lon: wrapLon(Math.atan2(point.y, point.x) / DEG),
    lat: Math.asin(Math.max(-1, Math.min(1, point.z))) / DEG,
  }
}

/**
 * Home, the navigator's opening view: the Moon as a person on Earth sees it now. The camera sits exactly on the
 * Moon-to-Earth line (geocentric: the sub-Earth point, so the phase, the libration and the terminator are the real
 * sky's, a thin crescent or a new Moon stays as dark as it is), celestial (J2000) north up as in earthViewCamera, the
 * 30 deg lens, HOME_DIST radii (main.ts refits the distance to the free frame). It is an ordinary orbit pose
 * (roll tilts lunar north off vertical by the real angle): direct manipulation starts on the first frame.
 */
export function homePose(e: Ephemeris): Pose {
  const lat = Math.max(-89, Math.min(89, e.subEarth.lat))
  const base: Pose = { lon: e.subEarth.lon, lat, dist: HOME_DIST, roll: 0, pitch: 0 }
  const { up, back } = poseBasis(e, base)
  const north = new Vector3(0, 0, 1).addScaledVector(back, -back.z)
  if (north.lengthSq() < 1e-12) return base
  north.normalize()
  return { ...base, roll: Math.atan2(north.dot(new Vector3().crossVectors(back, up)), north.dot(up)) / DEG }
}

/** The world direction (unit) of the ray through a point of the frame, NDC (x right, y up), for a camera and the frame's width over height. */
export function viewRayDir(cam: ViewCamera, nx: number, ny: number, aspect: number): Vector3 {
  return cam.back.clone().multiplyScalar(-1)
    .addScaledVector(cam.right, nx * cam.tanHalf * aspect)
    .addScaledVector(cam.up, ny * cam.tanHalf)
    .normalize()
}

/** Where a ray from `pos` along unit `dir` first meets the sphere of radius `r` about the origin (Moon radii), or null when it misses. */
export function raySphere(pos: Vector3, dir: Vector3, r = 1): Vector3 | null {
  const b = pos.dot(dir)
  const c = pos.dot(pos) - r * r
  const disc = b * b - c
  if (disc < 0) return null
  const t = -b - Math.sqrt(disc)
  if (t < 0) return null
  return pos.clone().addScaledVector(dir, t)
}

/** The point of the Moon's sphere under a point of the frame, in the world frame (unit vector), or null over the sky. */
export function pickSphere(cam: ViewCamera, nx: number, ny: number, aspect: number): Vector3 | null {
  return raySphere(cam.pos, viewRayDir(cam, nx, ny, aspect))?.normalize() ?? null
}

/** Selenographic longitude and latitude of a world direction. */
export function lonLatOfDir(e: Ephemeris, d: Vector3): { lon: number; lat: number } {
  return {
    lon: Math.atan2(d.dot(e.moonY), d.dot(e.moonX)) / DEG,
    lat: Math.asin(Math.max(-1, Math.min(1, d.dot(e.moonZ)))) / DEG,
  }
}
