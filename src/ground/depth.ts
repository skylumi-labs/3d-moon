/**
 * The depth the ground pass writes for a hit, as the mesh camera (perspective, planes `near` and `far`) would store it.
 * `zView` is the distance along the view axis (not along the ray). 0 at `near`, 1 at `far`. groundShader.ts writes the same
 * expression (scripts/ground.test.mts checks the two against each other and against three's projection).
 */
export function depth01(zView: number, near: number, far: number): number {
  const z = Math.max(zView, near)
  return Math.max(0, Math.min(1, far / (far - near) * (1 - near / z)))
}

/** The mesh shows where its depth is nearer than the ground's (both from depth01), with the margin a depth buffer's step needs. */
export function meshInFront(meshDepth: number, groundDepth: number): boolean {
  return meshDepth <= groundDepth
}
