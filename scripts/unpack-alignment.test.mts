/* eslint-disable @typescript-eslint/no-explicit-any -- a recording fake of the WebGL context */
/**
 * an odd-width R8 patch texture must upload at UNPACK_ALIGNMENT 1 even after the tile streamer has uploaded.
 * Uses three's real WebGLState (its pixelStorei cache is the mechanism) on a recording fake context.
 *   node --import tsx scripts/unpack-alignment.test.mts
 */
import assert from 'node:assert/strict'
import { WebGLState } from '../node_modules/three/src/renderers/webgl/WebGLState.js'
import { withTightUnpack } from '../src/moon/tiles/unpack.ts'

function fakeGl() {
  const real: Record<number, number> = {}
  const consts: Record<string, number> = {}
  let next = 1
  const gl: any = new Proxy({}, {
    get(_t, k: string) {
      if (k === 'pixelStorei') return (n: number, v: number) => { real[n] = Number(v) }
      if (k === 'getParameter') return () => 'WebGL 2.0'
      if (k === 'getExtension') return () => null
      if (/^[A-Z0-9_]+$/.test(k)) return (consts[k] ??= next++)
      return () => undefined
    },
  })
  return { gl, real }
}

/** What WebGLTextures.uploadTexture does for a DataTexture: set its alignment through the state, then upload. */
function threeUpload(state: any, gl: any, real: Record<number, number>, alignment: number, width: number, bytes: number): void {
  state.pixelStorei(gl.UNPACK_ALIGNMENT, alignment)
  const rowBytes = Math.ceil(width / real[gl.UNPACK_ALIGNMENT]) * real[gl.UNPACK_ALIGNMENT]
  assert.ok(bytes >= rowBytes * 7, `texSubImage2D: ArrayBufferView not big enough (width ${width}, alignment ${real[gl.UNPACK_ALIGNMENT]})`)
}

{
  const { gl, real } = fakeGl()
  const state: any = new WebGLState(gl, { has: () => false, get: () => null } as any)
  // A single-channel patch texture (alignment 1), then a streamed tile, then another odd-width R8 texture.
  threeUpload(state, gl, real, 1, 2563, 2563 * 7)
  withTightUnpack(state, gl, () => assert.equal(real[gl.UNPACK_ALIGNMENT], 1))
  assert.equal(real[gl.UNPACK_ALIGNMENT], 4, 'the streamer restores three\'s default through the state')
  for (const w of [2563, 3643, 443]) threeUpload(state, gl, real, 1, w, w * 7)
}
console.log('unpack-alignment ok')
