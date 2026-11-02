// Per-scenario frame statistics, written as NDJSON so a 1,440-frame lunation never builds one giant string
// (it died with `RangeError: Invalid string length` when every frame carried the 7 MB base64 of its native metadata).
import fs from 'node:fs'
import path from 'node:path'
import type { Frame } from './lib.mts'

export interface StatsHeader { marks: Array<{ t: number; name: string }>; cadence: unknown; render?: unknown; capture?: unknown }

/** The JSON-safe, bounded form of a frame: no pixel arrays, no native metadata, file by basename. */
export function slimFrame(f: Frame): Record<string, unknown> {
  const v = f.visibility
  const visibility = v ? { frameId: v.frameId, width: v.width, height: v.height, ground: v.ground, offscreen: v.offscreen, limbApplicable: v.limbApplicable, expectedNight: v.expectedNight, skewMs: v.skewMs, bundleSha256: v.bundleSha256, baselineVerified: v.baselineVerified, metrics: (v as { metrics?: unknown }).metrics, metadataFile: (v as { metadataFile?: string }).metadataFile ? path.basename((v as { metadataFile?: string }).metadataFile!) : undefined, metadataSha256: (v as { metadataSha256?: string }).metadataSha256 } : null
  return { ...f, gray: undefined, file: path.basename(f.file), visibility }
}

/** Writes the header line, then one frame per line, flushing in bounded chunks (`onWrite` reports each chunk's size, for the test). */
export async function writeStats(file: string, header: StatsHeader, frames: Iterable<Frame>, onWrite: (bytes: number) => void = () => undefined): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const out = fs.createWriteStream(file)
  const put = async (chunk: string): Promise<void> => { onWrite(Buffer.byteLength(chunk)); if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r())) }
  await put(JSON.stringify({ header }) + '\n')
  let buf = ''
  for (const f of frames) {
    buf += JSON.stringify({ frame: slimFrame(f) }) + '\n'
    if (buf.length >= 32768) { await put(buf); buf = '' }
  }
  if (buf) await put(buf)
  await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())))
}

/** Reads `stats.ndjson`, or a legacy single-document `stats.json` (older runs, regate). */
export function readStats(file: string): { marks: Array<{ t: number; name: string }>; frames: Frame[]; header: Record<string, unknown> } {
  if (file.endsWith('.json')) { const s = JSON.parse(fs.readFileSync(file, 'utf8')); return { marks: s.marks ?? [], frames: s.frames, header: s } }
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const head = JSON.parse(lines[0]).header as StatsHeader
  return { marks: head.marks, frames: lines.slice(1).map((l) => JSON.parse(l).frame as Frame), header: head as unknown as Record<string, unknown> }
}

/** `stats.ndjson` if present, else `stats.json`, in a scenario directory. */
export function statsFile(dir: string): string | null {
  for (const n of ['stats.ndjson', 'stats.json']) if (fs.existsSync(path.join(dir, n))) return path.join(dir, n)
  return null
}
