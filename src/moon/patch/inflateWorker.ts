/**
 * Reads a patch asset's body off the main thread: counts the wire bytes, inflates a gzip stream, assembles the raster and checks
 * its digest, then hands the bytes back. The browser inflates on whichever thread reads the stream, and on the page's own thread
 * a 16 MB raster held every frame for 0.3 to 2 s (audit 5). Same checks as the in-page path in assets.ts.
 */
import { decodeHeightPlanes } from '../tiles/codec'

interface Job { body: ReadableStream<Uint8Array>; url: string; expectedBytes: number; sha256?: string; q16?: { w: number; h: number; stepM: number } }

// The page's tsconfig has the DOM lib, not the worker one: the two members used here are declared by hand.
const ctx = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((ev: MessageEvent<Job>) => void) | null }

ctx.onmessage = async (ev: MessageEvent<Job>) => {
  const { body, url, expectedBytes, sha256, q16 } = ev.data
  try {
    const raw = body.getReader()
    const first = await raw.read()
    if (first.done) throw new Error(`${url}: empty raster`)
    let head = first.value
    while (head.length < 2) {
      const next = await raw.read()
      if (next.done) break
      const joined = new Uint8Array(head.length + next.value.length)
      joined.set(head); joined.set(next.value, head.length); head = joined
    }
    let wire = 0, reported = 0
    const wireLimit = expectedBytes + Math.ceil(expectedBytes / 100) + 65536
    let initial = true
    const input = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const part = initial ? { done: false, value: head } : await raw.read()
          initial = false
          if (part.done) { controller.close(); return }
          wire += part.value!.byteLength
          if (wire > wireLimit) throw new Error(`${url}: compressed transfer exceeds budget`)
          if (wire - reported > 262144) { ctx.postMessage({ type: 'wire', bytes: wire - reported }); reported = wire }
          controller.enqueue(part.value!)
        } catch (e) { controller.error(e); await raw.cancel(e).catch(() => undefined) }
      },
      cancel(reason) { return raw.cancel(reason) },
    })
    const gz = head[0] === 0x1f && head[1] === 0x8b
    const decoded = gz ? input.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>) : input
    const reader = decoded.getReader()
    const output = new Uint8Array(expectedBytes)
    let n = 0
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (n + chunk.value.length > expectedBytes) throw new Error(`${url}: inflated raster exceeds declared size`)
      output.set(chunk.value, n)
      n += chunk.value.length
    }
    if (n !== expectedBytes) throw new Error(`${url}: raster size ${n}, expected ${expectedBytes}`)
    if (sha256) {
      const digest = await crypto.subtle.digest('SHA-256', output)
      const actual = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('')
      if (actual !== sha256) throw new Error(`${url}: checksum mismatch`)
    }
    ctx.postMessage({ type: 'wire', bytes: wire - reported })
    if (q16) {
      const integers = decodeHeightPlanes(output, q16.w, q16.h)
      const heights = new Float32Array(integers.length)
      for (let i = 0; i < integers.length; i++) heights[i] = integers[i] * q16.stepM
      ctx.postMessage({ type: 'done', buffer: heights.buffer }, [heights.buffer])
    } else ctx.postMessage({ type: 'done', buffer: output.buffer }, [output.buffer])
  } catch (e) {
    ctx.postMessage({ type: 'error', message: (e as Error).message })
  }
}
