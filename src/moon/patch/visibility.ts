import { Matrix4, Vector3 } from 'three'
import { MOON_R_KM } from '../../glsl/common'
import type { PatchLevel } from './PatchLayer'

/** A conservative angular radius around the site's centre enclosing every patch rectangle. */
export function patchFootprintRadius(levels: readonly PatchLevel[]): number {
  let farthestM = 0
  for (const level of levels) {
    const x = level.axisEastPerTexelM ?? [level.texelEastM, 0]
    const y = level.axisSouthPerTexelM ?? [0, -level.texelNorthM]
    for (const col of [0, level.w]) for (const row of [0, level.h]) {
      const east = level.eastM + x[0] * col + y[0] * row
      const north = level.northM + x[1] * col + y[1] * row
      farthestM = Math.max(farthestM, Math.hypot(east, north))
    }
  }
  // The patch grids are local east/north approximations. A small margin
  // covers their projection error and the outer edge fade interpolation.
  return Math.min(Math.PI, (farthestM + 50) * 1.02 / (MOON_R_KM * 1000))
}

/** True when a spherical cap can intersect the camera's perspective frustum. */
export function sphericalCapInFrustum(
  cameraPosition: Vector3,
  inverseViewProjection: Matrix4,
  capCenter: Vector3,
  angularRadius: number,
): boolean {
  if (![...cameraPosition.toArray(), ...capCenter.toArray(), angularRadius].every(Number.isFinite)) return true
  const gamma = Math.max(0, Math.min(Math.PI, angularRadius))
  const boundCenter = gamma >= Math.PI / 2 ? new Vector3() : capCenter.clone().multiplyScalar(Math.cos(gamma))
  // Relief and the patch terrain's radial surface can shift the projected
  // footprint slightly beyond the unit-sphere cap. Keep the switch safely
  // conservative near a tangent/horizon ray.
  const boundRadius = Math.min(1.02, (gamma >= Math.PI / 2 ? 1 : Math.sin(gamma)) + 0.01)
  const centerRay = (x: number, y: number): Vector3 => new Vector3(x, y, 1).applyMatrix4(inverseViewProjection).sub(cameraPosition).normalize()
  const forward = centerRay(0, 0)
  const halfAngle = Math.max(...[
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ].map(([x, y]) => forward.angleTo(centerRay(x, y))))
  const toBound = boundCenter.sub(cameraPosition)
  const distance = toBound.length()
  if (distance <= boundRadius) return true
  const apparentRadius = Math.asin(Math.min(1, boundRadius / distance))
  const centerAngle = forward.angleTo(toBound.multiplyScalar(1 / distance))
  return centerAngle <= halfAngle + apparentRadius + 1e-5
}
