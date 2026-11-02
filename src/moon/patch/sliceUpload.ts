import * as THREE from 'three'

/**
 * Uploads a DataTexture's raster to the GPU in slices (audit 6). three uploads a DataTexture whole, on its first draw: one
 * `texSubImage2D` of up to a few hundred MB on the render thread, which is what held the descent at 0.15x for about 4 s while the
 * large levels arrived. Here the storage is allocated first (three skips the data while `source.dataReady` is false) and the rows go in
 * `sliceBytes` at a time, handing the page back after about `budgetMs` of work. The texture is then complete when this resolves, so a
 * level is never bound half filled.
 */
const SLICE_BYTES = 1 << 20
const yieldToMain = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

export interface SliceTrace { w: number; h: number; bytes: number; slices: number; maxSliceMs: number; totalMs: number }
export const sliceTrace: SliceTrace[] = []
Object.assign(globalThis, { __sliceTrace: sliceTrace })

export async function uploadSliced(renderer: THREE.WebGLRenderer, t: THREE.DataTexture, data: ArrayBufferView, budgetMs = 3): Promise<boolean> {
  const gl = renderer.getContext() as WebGL2RenderingContext
  const channels = t.format === THREE.RGFormat ? 2 : t.format === THREE.RedFormat ? 1 : 0
  const glFormat = channels === 2 ? gl.RG : gl.RED
  const [glType, bpc] = t.type === THREE.FloatType ? [gl.FLOAT, 4] : t.type === THREE.HalfFloatType ? [gl.HALF_FLOAT, 2] : t.type === THREE.UnsignedByteType ? [gl.UNSIGNED_BYTE, 1] : [0, 0]
  const { width: w, height: h } = t.image
  if (!channels || !glType || data.byteLength !== w * h * channels * bpc) { t.needsUpdate = true; return false }
  const t0 = performance.now()
  // Allocate the storage only: three skips the pixel data while the source says it is not ready, and `onUpdate` runs once.
  t.source.dataReady = false
  t.needsUpdate = true
  renderer.initTexture(t)
  const glTex = (renderer.properties.get(t) as { __webglTexture?: WebGLTexture }).__webglTexture
  if (!glTex) { t.source.dataReady = true; t.needsUpdate = true; return false }
  const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const rowBytes = w * channels * bpc
  const rows = Math.max(1, Math.floor(SLICE_BYTES / rowBytes))
  let slices = 0, maxSliceMs = 0, sliceStart = performance.now()
  for (let y = 0; y < h; y += rows) {
    const n = Math.min(rows, h - y)
    const s0 = performance.now()
    renderer.state.bindTexture(gl.TEXTURE_2D, glTex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    const bytes = view.subarray(y * rowBytes, (y + n) * rowBytes)
    // A typed array of the texture's own type: the GL call reads it as that type.
    const typed = t.type === THREE.FloatType ? new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
      : t.type === THREE.HalfFloatType ? new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2) : bytes
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y, w, n, glFormat, glType, typed)
    slices++
    maxSliceMs = Math.max(maxSliceMs, performance.now() - s0)
    if (performance.now() - sliceStart > budgetMs) { await yieldToMain(); sliceStart = performance.now() }
  }
  if (t.generateMipmaps) { renderer.state.bindTexture(gl.TEXTURE_2D, glTex); gl.generateMipmap(gl.TEXTURE_2D) }
  renderer.state.unbindTexture()
  t.source.dataReady = true
  sliceTrace.push({ w, h, bytes: data.byteLength, slices, maxSliceMs: +maxSliceMs.toFixed(1), totalMs: +(performance.now() - t0).toFixed(1) })
  return true
}
