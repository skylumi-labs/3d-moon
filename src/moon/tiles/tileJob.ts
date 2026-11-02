import { gunzipIfNeeded } from './codec'
import { decodeTileHeights, prepareColour, type DecodedHeights } from './tileDecode'
import { C_SIZE } from './grid'
import { setDecodeFlags, type DecodeFlags } from './decodeFlags'
import { greyMipsFromPixels } from './greyMips'
import { toHalfArray } from './half'

/**
 * One tile's whole CPU decode, off the main thread (tileWorker.ts runs this; scripts/tile-worker.test.mts runs it in Node with a fake image decoder).
 * Before this the page gunzipped, decoded, smoothed, summarised and mip-chained every tile on its own thread: 10 to 40 ms a tile, and a view
 * first drawn brings many a second (rig L4: p95 31 to 65 ms in the fly and fan routes, p50 under 8).
 */
export interface TileJob {
  id: number
  hb: ArrayBuffer
  /** The colour WebP, or null for a deeper tile (heights only). */
  cb: ArrayBuffer | null
  level: number
  ty: number
  deeper: boolean
  stepM: number
  /** The page's decode switches; a Worker applies them before decoding (it cannot read the page's URL). Absent: the thread's own. */
  flags?: DecodeFlags
}
/** `heights` is the uploaded copy: half-float bits (Uint16Array) when the job's flags ask for them (`?half=0` off), else Float32Array. */
export interface TileResult extends Omit<DecodedHeights, 'heights'> { id: number; heights: Float32Array | Uint16Array; color: Uint8Array[] }
export interface TileDeps {
  /** A colour tile's pixels, C_SIZE x C_SIZE RGBA, from its WebP bytes (the worker uses createImageBitmap + OffscreenCanvas, the page's own path). */
  pixels(cb: ArrayBuffer): Promise<Uint8ClampedArray>
}

export async function runTileJob(job: TileJob, deps: TileDeps): Promise<TileResult> {
  // Module-global: jobs interleaved in one worker share whichever flags were set last. Fine while the flags are per page; a per-job flag must be threaded through the decode instead.
  if (job.flags) setDecodeFlags(job.flags)
  const raw = await gunzipIfNeeded(job.hb)
  const h = decodeTileHeights(raw, job.level, job.ty, job.deeper, job.stepM, job.cb === null)
  // Half bits halve the bytes the Worker hands back and spare the driver the float conversion; the array is R16F either way, so the stored values are the same.
  const heights = job.flags?.half ? toHalfArray(h.heights) : h.heights
  if (job.cb === null) return { id: job.id, ...h, heights, color: [] }
  const px = await deps.pixels(job.cb)
  return { id: job.id, ...h, heights, color: prepareColour(px, job.level, C_SIZE) }
}

/** Every distinct ArrayBuffer a result holds, for the transfer list (the mip chain's first level is a view of the pixel buffer). */
export function transferList(r: TileResult): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>([r.heights.buffer as ArrayBuffer, r.relief.buffer as ArrayBuffer])
  for (const m of r.color) out.add(m.buffer as ArrayBuffer)
  return [...out]
}

/**
 * A TC or WAC detail tile (greyscale WebP, R channel) decoded to its uploaded mip chain: the work TcStreamer and DetailStreamer did on the page
 * (createImageBitmap, canvas read-back, no-data to mid, mips) moved to the Worker (R51). `kind` tells the worker which job it holds.
 */
export interface GreyJob { id: number; kind: 'grey'; cb: ArrayBuffer; mid: number }
export interface GreyResult { id: number; mips: Uint8Array[] }
export async function runGreyJob(job: GreyJob, deps: TileDeps): Promise<GreyResult> {
  return { id: job.id, mips: greyMipsFromPixels(await deps.pixels(job.cb), job.mid) }
}
export const isGreyJob = (j: TileJob | GreyJob): j is GreyJob => (j as GreyJob).kind === 'grey'
export function greyTransferList(r: GreyResult): ArrayBuffer[] { return [...new Set(r.mips.map((m) => m.buffer as ArrayBuffer))] }
