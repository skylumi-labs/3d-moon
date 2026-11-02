import { runTileJob, runGreyJob, isGreyJob, transferList, greyTransferList, type TileJob, type GreyJob } from './tileJob'
import { C_SIZE } from './grid'

/** The decode Worker (see tileJob.ts). The page's tsconfig has the DOM lib, not the worker one: the two members used are declared by hand. */
const ctx = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((ev: MessageEvent<TileJob | GreyJob>) => void) | null }

async function pixels(cb: ArrayBuffer): Promise<Uint8ClampedArray> {
  const bmp = await createImageBitmap(new Blob([cb], { type: 'image/webp' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  try {
    const canvas = new OffscreenCanvas(C_SIZE, C_SIZE)
    const c = canvas.getContext('2d', { willReadFrequently: true })
    if (!c) throw new Error('tile canvas unavailable')
    c.drawImage(bmp, 0, 0)
    return c.getImageData(0, 0, C_SIZE, C_SIZE).data
  } finally { bmp.close() }
}

ctx.onmessage = async (ev: MessageEvent<TileJob | GreyJob>) => {
  const job = ev.data
  try {
    if (isGreyJob(job)) {
      const g = await runGreyJob(job, { pixels })
      ctx.postMessage({ type: 'done', result: g }, greyTransferList(g))
      return
    }
    const r = await runTileJob(job, { pixels })
    ctx.postMessage({ type: 'done', result: r }, transferList(r))
  } catch (e) {
    ctx.postMessage({ type: 'error', id: job.id, message: (e as Error).message })
  }
}
