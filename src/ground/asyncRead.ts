/**
 * A float readback that never makes the page wait for the GPU.
 *
 * `renderer.readRenderTargetPixels` is synchronous twice over: `readPixels` returns only when every command queued before it has executed, and three's
 * `textureTypeReadable` asks `getParameter(IMPLEMENTATION_COLOR_READ_TYPE)` first, a second round trip to the GPU process. In ground mode a five-per-second
 * range probe cost 727 ms of readPixels and 276 ms of getParameter in a 2.2 s drag (CPU profile on the GPU rig), a 20 to 37 ms stall each time.
 * This reads into a PIXEL_PACK_BUFFER, puts a fence behind it and is polled once a frame (`clientWaitSync` with a zero timeout never blocks).
 */
export interface ReadGl {
  PIXEL_PACK_BUFFER: number; STREAM_READ: number; RGBA: number; FLOAT: number
  SYNC_GPU_COMMANDS_COMPLETE: number; ALREADY_SIGNALED: number; CONDITION_SATISFIED: number
  createBuffer(): unknown; deleteBuffer(b: unknown): void; bindBuffer(target: number, b: unknown): void
  bufferData(target: number, size: number, usage: number): void
  readPixels(x: number, y: number, w: number, h: number, format: number, type: number, offset: number): void
  fenceSync(cond: number, flags: number): unknown; deleteSync(s: unknown): void; flush(): void
  clientWaitSync(s: unknown, flags: number, timeout: number): number
  getBufferSubData(target: number, srcOffset: number, dst: Float32Array): void
}

export class AsyncTexelRead {
  private buf: unknown = null
  private sync: unknown = null
  get pending(): boolean { return this.sync !== null }

  /** Reads `w` x `h` RGBA float texels at (`x`, `y`) (the origin by default) of the framebuffer that is bound for reading. False when a read is already in flight. */
  begin(gl: ReadGl, w: number, h: number, x = 0, y = 0): boolean {
    if (this.sync !== null) return false
    const buf = gl.createBuffer()
    if (!buf) return false
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf)
    gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 16, gl.STREAM_READ)
    gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    this.buf = buf
    this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    gl.flush()
    return true
  }

  /** Fills `out` and returns true once the GPU has finished the read; false (at once, without waiting) while it has not, or when nothing is in flight. */
  poll(gl: ReadGl, out: Float32Array): boolean {
    if (this.sync === null) return false
    const st = gl.clientWaitSync(this.sync, 0, 0)
    if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) return false
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buf)
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    this.release(gl)
    return true
  }

  /** Drops an unfinished read (the view changed, the context was lost). */
  release(gl: ReadGl | null): void {
    if (gl && this.sync !== null) gl.deleteSync(this.sync)
    if (gl && this.buf !== null) gl.deleteBuffer(this.buf)
    this.sync = null; this.buf = null
  }
}
