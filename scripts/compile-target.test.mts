import assert from 'node:assert/strict'
import * as THREE from 'three'
import { compileForTarget } from '../src/net/compileTarget.ts'

// compileForTarget binds a render target while three queues the programs (the bound target is part of the program key), then restores the previous one.
function fakeRenderer(opts: { throwOnCompile?: boolean } = {}) {
  const log: string[] = []
  let bound: unknown = 'canvas'
  const r = {
    getRenderTarget: () => (bound === 'canvas' ? null : (bound as THREE.WebGLRenderTarget)),
    setRenderTarget: (t: unknown) => { bound = t ?? 'canvas'; log.push(t ? 'bind' : 'unbind') },
    compileAsync: () => { log.push(bound === 'canvas' ? 'compile-on-canvas' : 'compile-on-target'); if (opts.throwOnCompile) throw new Error('boom'); return Promise.resolve('done') },
  }
  return { r, log, bound: () => bound }
}
const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera()
const fake = { isRT: true } as unknown as THREE.WebGLRenderTarget

{
  const f = fakeRenderer()
  const out = await compileForTarget(f.r as never, scene, cam, fake)
  assert.equal(out, 'done')
  assert.deepEqual(f.log, ['bind', 'compile-on-target', 'unbind'])
  assert.equal(f.bound(), 'canvas')
}
{
  // A previously bound target is restored, not cleared.
  const f = fakeRenderer()
  const prev = { prev: true } as unknown as THREE.WebGLRenderTarget
  f.r.setRenderTarget(prev); f.log.length = 0
  await compileForTarget(f.r as never, scene, cam, fake)
  assert.equal(f.bound(), prev)
}
{
  const f = fakeRenderer({ throwOnCompile: true })
  assert.throws(() => compileForTarget(f.r as never, scene, cam, fake), /boom/)
  assert.equal(f.bound(), 'canvas', 'restored when compileAsync throws')
}
console.log('compile-target ok')
