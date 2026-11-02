/**
 * Raw `gl.pixelStorei` calls desynchronise three's pixel-store cache (`WebGLState.pixelStorei` skips a call whose value it
 * believes is already set). TileStreamer used to set UNPACK_ALIGNMENT 4 straight on the context after a tile upload while three's
 * cache still read 1 from the last single-channel upload; the next odd-width R8 patch texture then skipped its own
 * `pixelStorei(1)` and uploaded at alignment 4 ("texSubImage2D: ArrayBufferView not big enough").
 * Every pixel-store change outside three goes through the renderer's state, so the cache and the context agree.
 */
export interface PixelStoreState { pixelStorei(name: number, value: number): void }
export interface PixelStoreConstants {
  readonly UNPACK_FLIP_Y_WEBGL: number
  readonly UNPACK_PREMULTIPLY_ALPHA_WEBGL: number
  readonly UNPACK_ALIGNMENT: number
}

/** Runs `upload` with tight (1-byte) rows and no flip/premultiply, then restores three's default alignment of 4, all through `state`. */
export function withTightUnpack(state: PixelStoreState, gl: PixelStoreConstants, upload: () => void): void {
  state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
  state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
  state.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  try { upload() } finally { state.pixelStorei(gl.UNPACK_ALIGNMENT, 4) }
}
