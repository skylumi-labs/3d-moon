import { C_SIZE } from './grid'
import { greyMipsFromPixels } from './greyMips'
import { greyPool, WorkerUnavailable } from './tilePool'
import { add as perfAdd } from '../../perf/perf'

/** A grey detail tile's WebP bytes to its mip chain, on the page's thread (the path before R51, and the fallback). */
export async function decodeGreyOnPage(buf: ArrayBuffer, mid: number, what: string): Promise<Uint8Array[]> {
  const bmp = await createImageBitmap(new Blob([buf], { type: 'image/webp' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(C_SIZE, C_SIZE) : Object.assign(document.createElement('canvas'), { width: C_SIZE, height: C_SIZE })
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null
    if (!ctx) throw new Error(`${what} tile canvas unavailable`)
    ctx.drawImage(bmp, 0, 0)
    return greyMipsFromPixels(ctx.getImageData(0, 0, C_SIZE, C_SIZE).data, mid)
  } finally {
    bmp.close()
  }
}

/**
 * The TC / WAC detail decode: in the shared Worker (`?greyworker=0` or no Worker: on the page). The worker gets a copy of the bytes, so a pool that
 * turns itself off with the tile in it still leaves the page the original to decode.
 */
export async function decodeGrey(buf: ArrayBuffer, mid: number, what: string): Promise<Uint8Array[]> {
  const pool = greyPool()
  if (pool) {
    const t0 = performance.now()
    try {
      const mips = await pool.runGrey(buf.slice(0), mid)
      perfAdd('tile.grey.roundtrip', performance.now() - t0)
      return mips
    } catch (e) {
      if (!(e instanceof WorkerUnavailable)) throw e
    }
  }
  return decodeGreyOnPage(buf, mid, what)
}
