import { fetchRetry, type LoadProgress, type RetryOpts } from '../../net/load'
import type { PatchAssetIntegrity } from './manifest'

/** No global byte cache: one streamed, bounded asset at a time; resident textures own the bytes. */
const INFLATE_PIECE = 32768
/** Resolves on a later task, so a frame can draw in between. */
const nextTask = (): Promise<void> => new Promise((resolve) => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); resolve() }; c.port2.postMessage(0) })

/** Fetch q16 heights in the existing inflate worker, falling back to yielding chunks on the page thread. */
export async function fetchPatchQ16(url: string, w: number, h: number, stepM: number, progress: LoadProgress,
  net: RetryOpts, integrity?: PatchAssetIntegrity): Promise<Float32Array> {
  const count = w * h
  const raw = await fetchPatchAsset(url, count * 2, progress, net, integrity, { w, h, stepM })
  if (raw.byteLength === count * 4) return new Float32Array(raw.buffer, raw.byteOffset, count)
  const integers = await decodeHeightPlanesYielding(raw, w, h)
  const heights = new Float32Array(count)
  for (let start = 0; start < count; start += 32768) {
    const end = Math.min(count, start + 32768)
    for (let i = start; i < end; i++) heights[i] = integers[i] * stepM
    if (end < count) await nextTask()
  }
  return heights
}

export async function fetchPatchAsset(url: string, expectedBytes: number, progress: LoadProgress,
  net: RetryOpts, integrity?: PatchAssetIntegrity, q16?: { w: number; h: number; stepM: number }): Promise<Uint8Array> {
  const signal = net.init?.signal
  signal?.throwIfAborted()
  const res = await fetchRetry(url, net)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  if (!res.body) throw new Error(`${url}: empty body`)
  progress.expect(url)
  // The wire length when the server sent the file as stored (no transfer compression): the card's bar then moves with the bytes (a 22 MB height band
  // showed "Loading the photograph" with no bar for half a minute on a phone link, owner walkthrough 2026-10-31). Both read paths count wire bytes.
  progress.restart(url, wireLength(res))
  // Off the main thread where the browser allows a stream to move to a worker (inflating 16 MB on the page's own thread held frames for seconds).
  if (typeof Worker !== 'undefined' && typeof res.body.pipeTo === 'function') {
    try { return await inflateInWorker(res.body, url, expectedBytes, progress, signal ?? undefined, integrity, q16) }
    catch (e) { if (!(e instanceof WorkerUnavailable)) throw e }
    // A worker that cannot take the stream: the body is gone, so fetch again on the in-page path below.
    return fetchPatchAssetInPage(url, expectedBytes, progress, net, integrity)
  }
  return readInPage(res, url, expectedBytes, progress, signal ?? undefined, integrity)
}

/** The response's length on the wire, or null when unknown or when the browser inflates a transfer encoding (then the body is not the counted bytes). */
export function wireLength(res: Pick<Response, 'headers'>): number | null {
  const len = Number(res.headers.get('content-length'))
  return len > 0 && !res.headers.get('content-encoding') ? len : null
}

class WorkerUnavailable extends Error {}

function inflateInWorker(body: ReadableStream<Uint8Array>, url: string, expectedBytes: number, progress: LoadProgress, signal: AbortSignal | undefined, integrity?: PatchAssetIntegrity, q16?: { w: number; h: number; stepM: number }): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try { worker = new Worker(new URL('./inflateWorker.ts', import.meta.url), { type: 'module' }) }
    catch { reject(new WorkerUnavailable()); return }
    const done = (): void => { signal?.removeEventListener('abort', onAbort); worker.terminate() }
    const onAbort = (): void => { done(); reject(signal?.reason ?? new DOMException('aborted', 'AbortError')) }
    signal?.addEventListener('abort', onAbort, { once: true })
    worker.onmessage = (ev: MessageEvent<{ type: string; bytes?: number; buffer?: ArrayBuffer; message?: string }>) => {
      const m = ev.data
      if (m.type === 'wire') progress.add(url, m.bytes ?? 0)
      else if (m.type === 'done') { done(); progress.finish(url); resolve(new Uint8Array(m.buffer as ArrayBuffer)) }
      else if (m.type === 'error') { done(); reject(new Error(m.message)) }
    }
    worker.onerror = (e) => { done(); reject(e.message ? new Error(e.message) : new WorkerUnavailable()) }
    try { worker.postMessage({ body, url, expectedBytes, sha256: integrity?.sha256, q16 }, [body as unknown as Transferable]) }
    catch { done(); reject(new WorkerUnavailable()) }
  })
}

async function decodeHeightPlanesYielding(bytes: Uint8Array, w: number, h: number): Promise<Int32Array> {
  const n = w * h
  if (bytes.length < 2 * n) throw new Error(`height raster is ${bytes.length} bytes, expected ${2 * n}`)
  const q = new Int32Array(n)
  for (let start = 0; start < n; start += 32768) {
    const end = Math.min(n, start + 32768)
    for (let i = start; i < end; i++) {
      const x = i % w, y = Math.floor(i / w), z = (bytes[i] << 8) | bytes[n + i], d = (z >>> 1) ^ -(z & 1)
      q[i] = d + (x ? q[i - 1] : 0) + (y ? q[i - w] : 0) - (x && y ? q[i - w - 1] : 0)
    }
    if (end < n) await nextTask()
  }
  return q
}

async function fetchPatchAssetInPage(url: string, expectedBytes: number, progress: LoadProgress, net: RetryOpts, integrity?: PatchAssetIntegrity): Promise<Uint8Array> {
  const res = await fetchRetry(url, net)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  if (!res.body) throw new Error(`${url}: empty body`)
  progress.restart(url, wireLength(res))
  return readInPage(res, url, expectedBytes, progress, net.init?.signal ?? undefined, integrity)
}

async function readInPage(res: Response, url: string, expectedBytes: number, progress: LoadProgress, signal: AbortSignal | undefined, integrity?: PatchAssetIntegrity): Promise<Uint8Array> {
  if (!res.body) throw new Error(`${url}: empty body`)
  const raw = res.body.getReader()
  const first = await raw.read()
  if (first.done) throw new Error(`${url}: empty raster`)
  // Fetch transparently decompresses Content-Encoding; gzip files served as octet-stream do not.
  // Peek two bytes even if a network chunk splits the gzip magic.
  let head = first.value
  while (head.length < 2) {
    const next = await raw.read()
    if (next.done) break
    const joined = new Uint8Array(head.length + next.value.length)
    joined.set(head); joined.set(next.value, head.length); head = joined
  }
  let wireBytes = 0
  const wireLimit = expectedBytes + Math.ceil(expectedBytes / 100) + 65536
  let initial = true
  const input = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        signal?.throwIfAborted()
        const part = initial ? { done: false, value: head } : await raw.read()
        initial = false
        if (part.done) { controller.close(); return }
        wireBytes += part.value!.byteLength
        if (wireBytes > wireLimit) throw new Error(`${url}: compressed transfer exceeds budget`)
        progress.add(url, part.value!.byteLength)
        // Small pieces: the browser inflates one piece per read on this thread, and a 64 KB network chunk of a smooth raster inflates to megabytes (300 to 700 ms in one task, audit 5).
        const v = part.value!
        for (let o = 0; o < v.length; o += INFLATE_PIECE) controller.enqueue(v.subarray(o, Math.min(v.length, o + INFLATE_PIECE)))
      } catch (e) { controller.error(e); await raw.cancel(e).catch(() => undefined) }
    },
    cancel(reason) { return raw.cancel(reason) },
  })
  const gzip = new DecompressionStream('gzip')
  const decoded = head[0] === 0x1f && head[1] === 0x8b
    ? input.pipeThrough({ writable: gzip.writable as WritableStream<Uint8Array>, readable: gzip.readable }) : input
  const reader = decoded.getReader()
  const output = new Uint8Array(expectedBytes)
  let n = 0
  const onAbort = () => { void reader.cancel(signal?.reason).catch(() => undefined) }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    // The browser inflates on this thread, chunk by chunk, and a buffered body would be inflated back to back (audit 5: 1.3 to 2 s
    // frame gaps at the end of each large raster). Hand the thread back whenever 12 ms have gone by.
    let sliceStart = performance.now()
    for (;;) {
      signal?.throwIfAborted()
      if (performance.now() - sliceStart > 12) { await nextTask(); sliceStart = performance.now() }
      const chunk = await reader.read()
      if (chunk.done) break
      if (n + chunk.value.length > expectedBytes) throw new Error(`${url}: inflated raster exceeds declared size`)
      output.set(chunk.value, n)
      n += chunk.value.length
    }
    signal?.throwIfAborted()
    if (n !== expectedBytes) throw new Error(`${url}: raster size ${n}, expected ${expectedBytes}`)
    if (integrity) {
      const digest = await crypto.subtle.digest('SHA-256', output)
      const actual = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('')
      if (actual !== integrity.sha256) throw new Error(`${url}: checksum mismatch`)
    }
    progress.finish(url)
    return output
  } catch (e) { await reader.cancel(e).catch(() => undefined); throw e }
  finally { signal?.removeEventListener('abort', onAbort) }
}
