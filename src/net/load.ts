/**
 * Loading that survives a bad connection and says how far it got.
 *
 * `fetchRetry` retries a request that failed in transit (network error, 5xx, 408, 429) with a growing wait and
 * gives up at once on an answer that will not change (404, 403). `fetchBytes` reads a body in pieces and reports
 * each one to a `LoadProgress`, and starts the whole file again when the stream breaks half way. `LoadProgress`
 * sums several files into one honest figure: the total is only claimed once every file has said how long it is.
 * No module here touches the DOM or three, so scripts/load.test.mts runs them in Node with a fake `fetch`.
 */

/** The waits before retry 1, 2 and 3 (milliseconds): a dropped connection usually needs a moment, a busy edge a little longer. */
export const RETRY_DELAYS_MS = [500, 2000, 6000]

export interface FetchDeps {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}
export interface RetryOpts extends FetchDeps {
  delaysMs?: number[]
  /** Called before each wait: which retry this is (1 to n), why, and how long the wait is. */
  onRetry?: (attempt: number, reason: string, waitMs: number) => void
  init?: RequestInit
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** True when asking again could give another answer. */
export function isTransient(status: number): boolean {
  return status >= 500 || status === 408 || status === 429
}

export class HttpError extends Error {
  constructor(readonly url: string, readonly status: number) {
    super(`${url}: ${status}`)
  }
}

export async function fetchRetry(url: string, o: RetryOpts = {}): Promise<Response> {
  const f = o.fetchImpl ?? fetch
  const sleep = o.sleep ?? realSleep
  const delays = o.delaysMs ?? RETRY_DELAYS_MS
  for (let attempt = 0; ; attempt++) {
    o.init?.signal?.throwIfAborted()
    let failure: string
    try {
      const res = await f(url, o.init)
      if (res.ok) return res
      if (!isTransient(res.status)) throw new HttpError(url, res.status)
      failure = `status ${res.status}`
    } catch (e) {
      if (e instanceof HttpError || o.init?.signal?.aborted) throw e
      failure = (e as Error).message || 'network error'
    }
    if (attempt >= delays.length) throw new Error(`${url}: ${failure} after ${attempt + 1} tries`)
    o.onRetry?.(attempt + 1, failure, delays[attempt])
    await sleep(delays[attempt])
  }
}

/** The pill's loading line: the text, and the share in whole percent once the size is known (no bytes: the owner found byte counts technical). */
export function progressLine(text: string, fraction: number | null): string {
  return fraction === null || !Number.isFinite(fraction) ? text : `${text} ${Math.min(99, Math.max(0, Math.floor(fraction * 100)))} %`
}

export interface ProgressSnapshot {
  /** Bytes received so far (compressed bytes as sent, or inflated bytes when the server inflated them). */
  loaded: number
  /** Sum of the files' lengths, or null while any file's length is not known. */
  total: number | null
  /** loaded / total in 0..1, or null when the total is not known. Never reaches 1 until every file is done. */
  fraction: number | null
  filesDone: number
  files: number
  /** Retries made so far across all files, and whether one is waiting now. */
  retries: number
  waiting: boolean
  done: boolean
}

interface FileState { loaded: number; total: number | null; done: boolean }

export class LoadProgress {
  private files = new Map<string, FileState>()
  private retries = 0
  private waiting = 0
  onChange: ((s: ProgressSnapshot) => void) | null = null
  /** Declares a file before its request starts, so `files` and the "not every length known" rule count it. */
  expect(id: string): void {
    if (!this.files.has(id)) this.files.set(id, { loaded: 0, total: null, done: false })
    this.emit()
  }
  /** A length learned ahead of the body (a HEAD answer): counts only while the file has not reported its own. */
  setTotal(id: string, total: number): void {
    const f = this.files.get(id)
    if (!f || f.done || f.total !== null || !(total > 0)) return
    f.total = total
    this.emit()
  }
  /** A request (or a retry of it) started this file over: its bytes restart from zero. */
  restart(id: string, total: number | null): void {
    this.files.set(id, { loaded: 0, total, done: false })
    this.emit()
  }
  add(id: string, bytes: number): void {
    const f = this.files.get(id)
    if (!f) return
    f.loaded += bytes
    this.emit()
  }
  finish(id: string): void {
    const f = this.files.get(id)
    if (!f) return
    f.done = true
    f.total = f.loaded
    this.emit()
  }
  retrying(wait: boolean): void {
    if (wait) { this.retries++; this.waiting++ } else this.waiting = Math.max(0, this.waiting - 1)
    this.emit()
  }
  snapshot(): ProgressSnapshot {
    let loaded = 0, total = 0, known = true, done = 0
    for (const f of this.files.values()) {
      loaded += f.loaded
      if (f.total === null) known = false
      else total += f.total
      if (f.done) done++
    }
    const n = this.files.size
    const all = n > 0 && done === n
    let fraction: number | null = known && total > 0 ? Math.min(loaded / total, 1) : null
    if (fraction !== null && !all) fraction = Math.min(fraction, 0.99)
    return { loaded, total: known ? total : null, fraction: all ? 1 : fraction, filesDone: done, files: n, retries: this.retries, waiting: this.waiting > 0, done: all }
  }
  private emit(): void { this.onChange?.(this.snapshot()) }
}

/**
 * The lengths of `urls` from HEAD requests, fed to `progress` as they answer, so the total is known while the big files
 * are still queued behind the connection limit. A failed or length-less answer is ignored: the file reports its own length.
 */
export function learnLengths(urls: string[], progress: LoadProgress, o: FetchDeps = {}): void {
  const f = o.fetchImpl ?? fetch
  for (const u of urls) {
    void f(u, { method: 'HEAD' }).then((r) => {
      const n = Number(r.headers.get('content-length'))
      if (r.ok && !r.headers.get('content-encoding') && n > 0) progress.setTotal(u, n)
    }).catch(() => undefined)
  }
}

/** A body that arrived as a gzip stream (1f 8b), inflated; anything else as is. */
export async function inflateIfGzip(a: Uint8Array): Promise<Uint8Array> {
  if (!(a[0] === 0x1f && a[1] === 0x8b)) return a
  const copy = new Uint8Array(a.byteLength)
  copy.set(a)
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * The file's bytes, reported to `progress` as they come. A failed request or a stream cut half way is retried from
 * the start with the same waits as `fetchRetry`; the progress for that file restarts from zero (a range request
 * would save bytes but GCS serves these gzip members whole, and a partial gzip cannot be resumed anyway).
 */
export async function fetchBytes(url: string, progress: LoadProgress | null, o: RetryOpts = {}): Promise<Uint8Array> {
  const delays = o.delaysMs ?? RETRY_DELAYS_MS
  const sleep = o.sleep ?? realSleep
  progress?.expect(url)
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchRetry(url, { ...o, delaysMs: [], onRetry: undefined })
      // A response the server compressed in transit reports the compressed length while the reader yields inflated bytes.
      const len = Number(res.headers.get('content-length'))
      const enc = res.headers.get('content-encoding')
      progress?.restart(url, len > 0 && !enc ? len : null)
      const chunks: Uint8Array[] = []
      let n = 0
      if (res.body) {
        const reader = res.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          n += value.byteLength
          progress?.add(url, value.byteLength)
        }
      } else {
        const b = new Uint8Array(await res.arrayBuffer())
        chunks.push(b)
        n = b.byteLength
        progress?.add(url, n)
      }
      const a = new Uint8Array(n)
      let at = 0
      for (const c of chunks) { a.set(c, at); at += c.byteLength }
      progress?.finish(url)
      return await inflateIfGzip(a)
    } catch (e) {
      if (e instanceof HttpError || attempt >= delays.length) throw e
      progress?.retrying(true)
      o.onRetry?.(attempt + 1, (e as Error).message, delays[attempt])
      await sleep(delays[attempt])
      progress?.retrying(false)
    }
  }
}

/** Bytes already being fetched ahead of need (idle prefetch): a real load takes the promise instead of asking again. */
const prefetched = new Map<string, Promise<Uint8Array>>()
export function prefetchBytes(url: string, o: RetryOpts = {}): void {
  if (prefetched.has(url)) return
  const p = fetchBytes(url, null, { ...o, delaysMs: o.delaysMs ?? [2000] })
  prefetched.set(url, p)
  p.catch(() => prefetched.delete(url))
}
/** `fetchBytes`, but using (and consuming) a prefetch of the same url when there is one. */
export async function fetchBytesCached(url: string, progress: LoadProgress | null, o: RetryOpts = {}): Promise<Uint8Array> {
  const pre = prefetched.get(url)
  if (pre) {
    prefetched.delete(url)
    progress?.expect(url)
    try {
      const a = await pre
      progress?.restart(url, a.byteLength)
      progress?.add(url, a.byteLength)
      progress?.finish(url)
      return a
    } catch { /* the prefetch failed: fall through to a real load */ }
  }
  return fetchBytes(url, progress, o)
}
