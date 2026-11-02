/** lunation died with `RangeError: Invalid string length` in JSON.stringify (run.mts save): ~1,440 frames each carrying a 7 MB base64 metadata string. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { slimFrame, writeStats, readStats } from '../audit/stats.mts'
import type { Frame } from '../audit/lib.mts'

const huge = 'A'.repeat(2_000_000)
const frame = (n: number): Frame => ({ n, t: n * 0.2, mean: 50, p99: 100, black: 0, white: 0, diff: 1, diffWorld: 1, gray: new Uint8Array(240 * 150), file: `/x/y/f${n}.jpg`, dom: { pressed: '' } as unknown as Frame['dom'], st: null, patch: false, cuts: 0, expo: null,
  visibility: { frameId: n, width: 4, height: 4, metadata: new Uint8Array(64), gray: new Uint8Array(16), metadataBase64: huge, calibration: null, ground: false, skewMs: 0, excludes: [], offscreen: false, limbApplicable: false, expectedNight: false, bundleSha256: 'x', baselineEarthshineSha256: null, baselineVerified: false } as unknown as Frame['visibility'], journey: null })

const s = JSON.stringify(slimFrame(frame(3)))
assert.ok(s.length < 4000, 'slimFrame kept the bulky evidence: ' + s.length)
assert.ok(!s.includes('metadataBase64') && !s.includes('AAAAAAAA'))
assert.equal(JSON.parse(s).file, 'f3.jpg')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moon-stats-'))
const file = path.join(dir, 'stats.ndjson')
// 1,500 frames with 2 MB of base64 each would be 3 GB as one JSON string; streamed it is a few hundred KB and the process stays small.
const rss0 = process.memoryUsage().rss
let written = 0
const frames = { *[Symbol.iterator]() { for (let i = 0; i < 1500; i++) yield frame(i) } }
await writeStats(file, { marks: [{ t: 1, name: 'click:x' }], cadence: { fps: 1, maxGapS: 2, count: 1500 } }, frames as Iterable<Frame>, (bytes) => { written = Math.max(written, bytes) })
assert.ok(written < 65536, 'a single write was ' + written + ' bytes')
assert.ok(fs.statSync(file).size < 3_000_000)
assert.ok(process.memoryUsage().rss - rss0 < 400 * 1024 * 1024, 'memory grew with the frame count')
const back = readStats(file)
assert.equal(back.frames.length, 1500)
assert.equal(back.marks[0].name, 'click:x')
assert.equal(back.frames[1499].n, 1499)
// The legacy single-document stats.json still reads (regate over an old run).
const legacy = path.join(dir, 'old', 'stats.json'); fs.mkdirSync(path.dirname(legacy))
fs.writeFileSync(legacy, JSON.stringify({ marks: [], cadence: {}, frames: [{ n: 0 }] }))
assert.equal(readStats(legacy).frames.length, 1)
fs.rmSync(dir, { recursive: true, force: true })
console.log('audit-stats.test.mts: ok')
