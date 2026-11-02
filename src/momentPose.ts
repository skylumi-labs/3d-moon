import { Vector3 } from 'three'
import { EARTH_R_KM, MOON_R_KM } from './glsl/common'
import { bodyLonLat, type Ephemeris } from './ephemeris'
import { poseBasis, subEarthPose, wrapLon, type Pose } from './camera/pose'
import type { Moment } from './moments'

/** The Earth view as a pose: far enough out that the perspective is the Earth's to within a few degrees, with a lens that fills the frame (the dolly zoom is gone). */
export const EARTH_VIEW_DIST = 12
export const EARTH_VIEW_FOV_DEG = 11
const DEG = Math.PI / 180
/**
 * The solar-eclipse flight's frame at this moment: `a` is the Moon-to-Sun direction (the subsolar point) and `n` the unit vector WEST of it along the
 * lunar equator (a x moonZ), so the camera at cos(phi) a + sin(phi) n stands over the longitudes where the Sun is about to rise (the morning
 * terminator, where the Sun rises as the Moon turns, is at phi = 90).
 */
export function eclipseAxes(e: Ephemeris): { a: Vector3; n: Vector3 } {
  const a = e.sunDir.clone().normalize()
  let n = new Vector3().crossVectors(a, e.moonZ)
  if (n.lengthSq() < 1e-8) n = e.moonY.clone().negate()
  return { a, n: n.normalize() }
}
/** The pose a moment's camera names, for the ephemeris of its time. */
export function momentPose(cam: Exclude<Moment['camera'], { at: 'site' } | { at: 'siteView' } | { at: 'descent' }>, e: Ephemeris): Pose {
  switch (cam.at) {
    case 'earth': return subEarthPose(e, EARTH_VIEW_DIST)
    case 'fly': return { lon: cam.lon, lat: cam.lat, dist: cam.dist, roll: 0, pitch: cam.pitch ?? 0 }
    case 'subEarth': return subEarthPose(e, cam.dist)
    case 'antiEarth': return { lon: wrapLon(e.subEarth.lon + 180), lat: -e.subEarth.lat, dist: cam.dist, roll: 0, pitch: 0 }
    case 'earthrise': {
      // Place the camera on a great circle from the anti-Earth point. Solve the
      // finite-distance geometry so the Earth centre starts at the requested
      // height above the apparent lunar limb, including the Earth's angular size.
      const earth = e.earthDir.clone().normalize()
      const north = e.moonZ.clone().addScaledVector(earth, -e.moonZ.dot(earth)).normalize()
      const east = new Vector3().crossVectors(north, earth).normalize()
      const bearing = (cam.bearingDeg ?? 90) * DEG
      const tangent = north.multiplyScalar(Math.cos(bearing)).addScaledVector(east, Math.sin(bearing)).normalize()
      const earthDist = e.earthKm.length() / MOON_R_KM
      const earthAngularRadius = Math.asin(EARTH_R_KM / e.earthKm.length())
      const target = Math.asin(1 / cam.dist) + (cam.aboveLimbEarthR ?? 1.3) * earthAngularRadius
      const lookAngle = (theta: number): number => {
        const radial = earth.clone().multiplyScalar(-Math.cos(theta)).addScaledVector(tangent, Math.sin(theta)).normalize()
        const toEarth = e.earthDir.clone().multiplyScalar(earthDist).addScaledVector(radial, -cam.dist)
        return Math.acos(Math.max(-1, Math.min(1, radial.clone().negate().dot(toEarth.normalize()))))
      }
      let lo = 0, hi = Math.PI
      for (let i = 0; i < 52; i++) {
        const mid = (lo + hi) / 2
        if (lookAngle(mid) < target) lo = mid
        else hi = mid
      }
      const theta = (lo + hi) / 2
      const radial = earth.clone().multiplyScalar(-Math.cos(theta)).addScaledVector(tangent, Math.sin(theta)).normalize()
      const ll = bodyLonLat(radial, e.moonX, e.moonY, e.moonZ)
      const pose: Pose = { lon: wrapLon(ll.lon), lat: ll.lat, dist: cam.dist, roll: 0, pitch: 0 }
      // Roll the horizon level with the Earth above it in frame.
      const base = poseBasis(e, pose)
      const toEarth = e.earthKm.clone().divideScalar(MOON_R_KM).sub(base.back.clone().multiplyScalar(cam.dist))
      const desiredUp = toEarth.addScaledVector(base.back, -toEarth.dot(base.back)).normalize()
      const rolled = new Vector3().crossVectors(base.back, base.up).normalize()
      pose.roll = Math.atan2(desiredUp.dot(rolled), desiredUp.dot(base.up)) / DEG
      return pose
    }
    case 'solarHorizon': {
      // Walk east along a great circle from the ephemeris' subsolar point. The resulting Sun direction is
      // exact for this date; whether the disc is visible is determined by the camera's apparent lunar limb.
      const lat1 = e.subSolar.lat * Math.PI / 180
      const lon1 = e.subSolar.lon * Math.PI / 180
      const delta = cam.sunAngleDeg * Math.PI / 180
      const bearing = Math.PI / 2
      const lat2 = Math.asin(Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(bearing))
      const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(delta) * Math.cos(lat1), Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2))
      // At the eastern terminator the Sun is west, so roll the local north-up frame to pitch toward it.
      return { lon: wrapLon(lon2 * 180 / Math.PI), lat: lat2 * 180 / Math.PI, dist: cam.dist, roll: 90, pitch: 35 }
    }
    case 'sunArc': {
      // arcDeg from the subsolar point toward the morning terminator: the first sample of the solar-eclipse flight.
      const { a, n } = eclipseAxes(e)
      const phi = cam.arcDeg * DEG
      const ll = bodyLonLat(a.clone().multiplyScalar(Math.cos(phi)).addScaledVector(n, Math.sin(phi)).normalize(), e.moonX, e.moonY, e.moonZ)
      return { lon: wrapLon(ll.lon), lat: ll.lat, dist: cam.dist, roll: 0, pitch: 0 }
    }
    case 'subSun': return { lon: e.subSolar.lon, lat: e.subSolar.lat, dist: cam.dist, roll: 0, pitch: 0 }
  }
}
