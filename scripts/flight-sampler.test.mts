/** ?sampler=1 recorder: the pure parts, the file shape wp14-summary.mjs reads, and the zero-cost-when-absent guard. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { quantile, estimateDisplayHz, rateMix, rafIntervals, dragOffset, journeyLive, sampleFileName, buildSampleFile, type SampleData, type SampleRow } from '../src/perf/flightSampler.ts'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// stats
assert.equal(quantile([], 0.5), null)
assert.equal(quantile([3, 1, 2], 0.5), 2)
assert.equal(quantile([1, 2, 3, 4], 0.99), 4)

// displayHz: 120 Hz ticks, 60 Hz ticks, a stall ignored, too few -> N/A (null), odd rate kept as measured
const ticks = (dt: number, n: number): number[] => Array.from({ length: n }, () => dt)
assert.equal(estimateDisplayHz(ticks(1000 / 120, 100)), 120)
assert.equal(estimateDisplayHz([...ticks(16.7, 100), 200, 300]), 60)
assert.equal(estimateDisplayHz(ticks(8.3, 5)), null)
assert.equal(estimateDisplayHz(ticks(1000 / 110, 100)), 110)

// drag path: starts at 0, peaks at the quarter period, returns at the period
assert.ok(Math.abs(dragOffset(0)) < 1e-9)
assert.ok(Math.abs(dragOffset(375) - 120) < 1e-9)
assert.ok(Math.abs(dragOffset(1500)) < 1e-9)

assert.equal(journeyLive('travelling'), true)
assert.equal(journeyLive('arrived'), false)
assert.equal(journeyLive(undefined), false)
assert.match(sampleFileName('tycho rim/1', 'flights', new Date('2026-10-15T10:20:30.123Z')), /^moon-sample-m5-tycho-rim-1-flights-2026-10-15T10-20-30-123Z\.json$/)

// file shape: 120 Hz, a 3 s drag, then the same data as a flight
const s: SampleRow[] = Array.from({ length: 360 }, (_, i) => [1000 + (1000 / 120) * i, 1000.5 + (1000 / 120) * i, Math.floor(i / 2), i % 2 === 0 ? [i, 0, 1] : null])
const moves: SampleData['moves'] = Array.from({ length: 180 }, (_, k) => [1100 + 16 * k, 1100.5 + 16 * k])
const data: SampleData = { s, moves, polls: [{ t: 1200, fr: 10, scale: 1, holds: 0, pcad: 60, tier: 1, hz: 120 }, { t: 1400, fr: 20, scale: 0.8, holds: 1, pcad: 60, tier: 1, hz: 120 }], lt: [[1500, 55]] }
const base = { data, started: null, ended: null, wallMs: 3000, viewport: [1512, 945, 2] as [number, number, number], gpu: { renderer: 'Apple M5', vendor: 'Apple' }, ua: 'Chrome test', replayDrag: true, reportedHz: null }
const dragFile = buildSampleFile({ ...base, moment: 'none' })
assert.equal(dragFile.mode, 'drag')
assert.equal(dragFile.displayHz, 120)
assert.equal(dragFile.arm, 'm5')
assert.deepEqual(Object.keys(dragFile.data).sort(), ['lt', 'moves', 'polls', 's'])
assert.ok(!('trials' in dragFile), 'the data is stored once')
assert.equal(dragFile.rateMix['120'], 1)
assert.equal(rateMix([8.3, 8.4, 16.7, 100, 30.1])['stall'], 0.2)
assert.equal(dragFile.gpu.renderer, 'Apple M5')
assert.equal(JSON.parse(JSON.stringify(dragFile)).data.s.length, 360)
const flightFile = buildSampleFile({ ...base, moment: 'tycho-rim', data: { ...data, moves: [] }, started: 1200, ended: 1900 })
assert.equal(flightFile.mode, 'flights')
assert.equal(flightFile.started, 1200)
// too few ticks: fall back to the app's own estimate, else N/A
assert.equal(buildSampleFile({ ...base, data: { ...data, s: s.slice(0, 5) }, moment: 'none', reportedHz: 119.6 }).displayHz, 120)
assert.equal(buildSampleFile({ ...base, data: { ...data, s: s.slice(0, 5) }, moment: 'none' }).displayHz, null)
assert.equal(rafIntervals(s).length, 359)

// the summary script reads the saved files (drag, flights) and uses the file's displayHz
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sampler-'))
try {
  fs.writeFileSync(path.join(dir, 'moon-sample-m5-none-drag-x.json'), JSON.stringify(dragFile))
  fs.writeFileSync(path.join(dir, 'moon-sample-m5-tycho-rim-flights-x.json'), JSON.stringify(flightFile))
  const run = (...a: string[]) => spawnSync(process.execPath, [path.join(root, 'scripts', 'wp14-summary.mjs'), ...a], { encoding: 'utf8' })
  const single = run(path.join(dir, 'moon-sample-m5-none-drag-x.json'))
  assert.equal(single.status, 0, single.stderr)
  assert.match(single.stdout, /\| m5:replay \| 1 \|/)
  const both = run(dir)
  assert.equal(both.status, 0, both.stderr)
  assert.match(both.stdout, /m5 \| tycho-rim/)
  assert.match(both.stdout, /\| arm \| trials \|/)
  // a healthy paced drag: 120 Hz display, the app draws every second vsync (tier 1, 60 Hz). pres/zeroSlots are against the paced cadence; the raw rAF-slot figures keep the 50 %.
  const cell = (out: string, col: string): number => {
    const lines = out.split('\n').filter((l) => l.startsWith('|'))
    const head = lines[0]!.split('|').map((x) => x.trim()); const row = lines[2]!.split('|').map((x) => x.trim())
    return parseFloat(row[head.indexOf(col)]!)
  }
  assert.equal(cell(single.stdout, 'hz'), 120)
  assert.equal(cell(single.stdout, 'pcad'), 60)
  assert.equal(cell(single.stdout, 'tier'), 1)
  assert.ok(cell(single.stdout, 'pres') > 95, 'paced presented % is ~100: ' + cell(single.stdout, 'pres'))
  assert.ok(Math.abs(cell(single.stdout, 'presRaw') - 50) < 3, 'raw rAF-slot presented % stays ~50')
  assert.ok(cell(single.stdout, 'zeroSlots') < 5 && Math.abs(cell(single.stdout, 'zeroRaw') - 50) < 3)
  assert.equal(cell(single.stdout, 's2'), 0)
  // forcing --hz 60 changes the slot rate
  const hz60 = run(path.join(dir, 'moon-sample-m5-none-drag-x.json'), 'drag', '--hz', '60')
  assert.equal(hz60.status, 0, hz60.stderr)
  assert.equal(cell(hz60.stdout, 'hz'), 60)
  // an old-shape file (trials, no ua, no pacing fields) is still read as 60 Hz unpaced
  const rig = JSON.parse(JSON.stringify({ ...dragFile, ua: undefined, displayHz: undefined, arm: 'main', replayDrag: false })) as Record<string, unknown>
  rig.trials = [{ data: { ...data, polls: [] } }]; delete rig.data
  fs.writeFileSync(path.join(dir, 'main-r0.json'), JSON.stringify(rig))
  const rigOut = run(path.join(dir, 'main-r0.json'), 'drag')
  assert.equal(rigOut.status, 0, rigOut.stderr)
  assert.match(rigOut.stdout, /\| main \| 1 \|/)
  assert.equal(run().status, 2)
} finally { fs.rmSync(dir, { recursive: true, force: true }) }

// zero cost when ?sampler is absent: main.ts reaches the module only by a dynamic import behind the switch, and the module has no top-level side effects
const main = fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8')
assert.ok(!/from\s+['"]\.\/perf\/flightSampler['"]/.test(main), 'main.ts must not statically import the sampler')
assert.ok(/if \(DEV_TOOLS && params\.get\('sampler'\) === '1'\) void import\('\.\/perf\/flightSampler'\)/.test(main), 'the sampler import must sit behind ?sampler=1 and the developer-tools constant (absent from a native build)')
assert.equal(main.split('\n').filter((l) => /import\('\.\/perf\/flightSampler'\)/.test(l)).length, 1, 'one import site')
const src = fs.readFileSync(path.join(root, 'src', 'perf', 'flightSampler.ts'), 'utf8')
const topLevel = src.split('\n').filter((l) => /^\S/.test(l) && !/^(export|import|const|interface|type|function|\}|\/\*|\*|\s*\*)/.test(l))
assert.deepEqual(topLevel, [], 'no top-level statements besides declarations')
for (const l of src.split('\n').filter((l) => /^(const|let|var) /.test(l))) assert.ok(!/(new |addEventListener|setInterval|requestAnimationFrame|fetch\()/.test(l), 'top-level const must not allocate or listen: ' + l)
assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|new Image/.test(src), 'the sampler must not use the network')
assert.ok(/URL\.createObjectURL/.test(src) && /function save\(\)/.test(src), 'the file is saved through a Blob download')
const saveRefs = src.split('\n').filter((l) => /\bsave\b/.test(l) && !/saved |saveBtn\.disabled|^\s*\/?\*|\/\//.test(l))
assert.deepEqual(saveRefs.map((l) => l.trim()), ["const saveBtn = mk('Save', save)", 'function save(): void {'], 'save is wired to the Save button only, never called')

console.log('flight-sampler: ok')
