import * as THREE from 'three'

/** Ray/sphere discriminant used by the final Sun compositor's lunar limb test. */
export function sphereRayDiscriminant(origin: THREE.Vector3, direction: THREE.Vector3, radius = 1): number {
  const b = origin.dot(direction)
  return b * b - origin.lengthSq() + radius * radius
}

/** Whether a forward ray from outside the body intersects its near hemisphere. */
export function rayHitsSphere(origin: THREE.Vector3, direction: THREE.Vector3, radius = 1): boolean {
  return origin.dot(direction) < 0 && sphereRayDiscriminant(origin, direction, radius) >= 0
}
