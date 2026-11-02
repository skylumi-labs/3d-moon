import * as THREE from 'three'
import { trackGpu } from '../quality/track'

/**
 * Program cache keys depend on the render target that is bound when three builds them: with none bound, `outputColorSpace` is the renderer's
 * (sRGB); with any render target it is the working space (WebGLPrograms.getParameters). Every pass of this viewer draws into a half-float target,
 * so a `compileAsync` issued with the canvas bound links programs the draw never uses (a different `linearToOutputTexel` prefix is a different
 * source), and the first real draw compiles and links the right one on the main thread. Binding a target while the compile is issued fixes the key.
 * ShadowCache already did this by hand; this is the same step for the passes that did not.
 */
let keyTarget: THREE.WebGLRenderTarget | null = null

/** The minimal target that gives the draw-time program key: 1 x 1 half float, no depth (the key does not read size, type or attachments). */
function targetForKey(): THREE.WebGLRenderTarget {
  if (keyTarget) return keyTarget
  keyTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, generateMipmaps: false })
  trackGpu('targets', 'compile-key', 8, keyTarget)
  return keyTarget
}

interface CompileHost {
  getRenderTarget(): THREE.WebGLRenderTarget | null
  setRenderTarget(t: THREE.WebGLRenderTarget | null, face?: number, mip?: number): void
  compileAsync(scene: THREE.Object3D, camera: THREE.Camera): Promise<unknown>
}

/**
 * `renderer.compileAsync(scene, camera)` for materials that are drawn into a render target. three reads the bound target synchronously while it
 * queues the programs, so the target is bound only for that call and the previous one is restored at once (also when the call throws).
 */
export function compileForTarget(renderer: THREE.WebGLRenderer | CompileHost, scene: THREE.Object3D, camera: THREE.Camera, target: THREE.WebGLRenderTarget = targetForKey()): Promise<unknown> {
  const r = renderer as CompileHost
  // A host without render-target state (a test double) compiles as before.
  if (typeof r.getRenderTarget !== 'function' || typeof r.setRenderTarget !== 'function') return r.compileAsync(scene, camera)
  const prev = r.getRenderTarget()
  try {
    r.setRenderTarget(target)
    return r.compileAsync(scene, camera)
  } finally {
    r.setRenderTarget(prev)
  }
}
