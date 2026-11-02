/** Decodes the height map off the page's thread (see heightDecode.ts): the buffer in (gzip or already inflated), the half-float mip chain back, both transferred. */
import { decodeHeights, inflateIfGzip } from './heightDecode'

const ctx = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((ev: MessageEvent<ArrayBuffer>) => void) | null }

ctx.onmessage = async (ev: MessageEvent<ArrayBuffer>) => {
  try {
    const out = decodeHeights(await inflateIfGzip(ev.data))
    ctx.postMessage({ type: 'done', out }, out.levels.map((l) => l.data.buffer as ArrayBuffer))
  } catch (e) {
    ctx.postMessage({ type: 'error', message: String((e as Error)?.message ?? e) })
  }
}
