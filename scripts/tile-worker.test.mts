import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { H_SIZE, C_SIZE, H_STEP_M } from '../src/moon/tiles/grid.ts'
import { encodeHeightPlanes, decodeHeightPlanes, qToMetres } from '../src/moon/tiles/codec.ts'
import { destripeHeights, prepareHeights } from '../src/moon/tiles/smoothDeep.ts'
import { buildRelief } from '../src/moon/tiles/relief.ts'
import { deblockChroma } from '../src/moon/tiles/deblock.ts'
import { colorMips } from '../src/moon/tiles/colorMips.ts'
import { colorMipsGrey } from '../src/moon/tiles/detailMips.ts'
import { neutraliseNoData } from '../src/moon/tiles/detail.ts'
import { runTileJob, runGreyJob, isGreyJob, greyTransferList, transferList, type TileJob, type GreyJob } from '../src/moon/tiles/tileJob.ts'
import { TilePool, WorkerUnavailable, createTilePool, greyPool, MAX_RESTARTS, type WorkerLike } from '../src/moon/tiles/tilePool.ts'
import { decodeFlags, flagsFromSearch, setDecodeFlags } from '../src/moon/tiles/decodeFlags.ts'

// A synthetic tile: a tilted plane with noise and a few scratch columns.
let seed = 7
const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
const q = new Int32Array(H_SIZE * H_SIZE)
for (let y = 0; y < H_SIZE; y++) for (let x = 0; x < H_SIZE; x++) q[y * H_SIZE + x] = Math.round(1000 + x * 3 - y * 2 + (rnd() - 0.5) * 8 + ((x === 40 || x === 41) ? (y & 1 ? 12 : -12) : 0))
const hb = gzipSync(Buffer.from(encodeHeightPlanes(q)))
const hbBuf = (): ArrayBuffer => hb.buffer.slice(hb.byteOffset, hb.byteOffset + hb.byteLength) as ArrayBuffer

// The code that ran inline in TileStreamer.start before the Worker, written out as it was.
function reference(level: number, ty: number, deeper: boolean, stepM: number, colourless: boolean) {
  const qq = decodeHeightPlanes(new Uint8Array(Buffer.from(encodeHeightPlanes(q))))
  const heights = new Float32Array(qq.length)
  for (let i = 0; i < qq.length; i++) heights[i] = deeper ? qq[i] * stepM : qToMetres(qq[i])
  let mid = 0
  if (deeper) {
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < heights.length; i++) { const h = heights[i]; if (h < lo) lo = h; if (h > hi) hi = h }
    mid = Math.round((lo + hi) / 2)
    for (let i = 0; i < heights.length; i++) heights[i] -= mid
  }
  return { mid, prepared: prepareHeights(colourless ? destripeHeights(heights, level) : heights, level, ty), relief: buildRelief(heights, level, ty) }
}
const px = new Uint8ClampedArray(C_SIZE * C_SIZE * 4)
for (let i = 0; i < px.length; i++) px[i] = i % 4 === 3 ? 255 : (i * 7 + (i >> 5)) & 255
const deps = { pixels: async () => new Uint8ClampedArray(px) }
const same = (a: ArrayLike<number>, b: ArrayLike<number>, what: string): void => {
  assert.equal(a.length, b.length, what)
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) assert.fail(`${what}: differs at ${i}: ${a[i]} vs ${b[i]}`)
}

for (const [level, ty, deeper, stepM] of [[-3, 5, true, 0.5], [-1, 3, true, 1], [0, 2, false, H_STEP_M], [1, 4, false, H_STEP_M]] as const) {
  // Heights only (a deeper tile), and colour (a built level).
  const colourless = deeper
  const job: TileJob = { id: 1, hb: hbBuf(), cb: colourless ? null : new ArrayBuffer(8), level, ty, deeper, stepM }
  const r = await runTileJob(job, deps)
  const ref = reference(level, ty, deeper, stepM, colourless)
  assert.equal(r.mid, ref.mid, `mid level ${level}`)
  same(r.heights, ref.prepared, `heights level ${level}`)
  same(r.relief, ref.relief, `relief level ${level}`)
  if (colourless) assert.equal(r.color.length, 0)
  else {
    const p = new Uint8ClampedArray(px)
    if (level === 0) deblockChroma(p, C_SIZE)
    const mips = colorMips(p, C_SIZE)
    assert.equal(r.color.length, mips.length)
    for (let i = 0; i < mips.length; i++) same(r.color[i], mips[i], `colour mip ${i} level ${level}`)
  }
}

// Transfer list: distinct buffers only (mip 0 is a view of the pixel buffer).
{
  const r = await runTileJob({ id: 2, hb: hbBuf(), cb: new ArrayBuffer(8), level: 1, ty: 4, deeper: false, stepM: H_STEP_M }, deps)
  const t = transferList(r)
  assert.equal(new Set(t).size, t.length)
  assert.ok(t.includes(r.heights.buffer as ArrayBuffer) && t.includes(r.relief.buffer as ArrayBuffer) && t.includes(r.color[0].buffer as ArrayBuffer))
}

// The pool, with in-process fake workers that run the same job code.
class FakeWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null
  onerror: WorkerLike['onerror'] = null
  terminated = false
  posted = 0
  failWith: string | null = null
  lastJob: TileJob | null = null
  throwOnPost = false
  postMessage(m: unknown): void {
    if (this.throwOnPost) throw new Error('DataCloneError')
    this.posted++
    const job = m as TileJob | GreyJob
    queueMicrotask(async () => {
      if (isGreyJob(job)) {
        if (this.failWith === 'platform') { this.onerror?.({ message: 'boom' }); return }
        try { this.onmessage?.({ data: { type: 'done', result: await runGreyJob(job, deps) } }) } catch (e) { this.onmessage?.({ data: { type: 'error', id: job.id, message: (e as Error).message } }) }
        return
      }
      this.lastJob = job
      if (this.failWith === 'platform') { this.onerror?.({ message: 'boom' }); return }
      try { const r = await runTileJob(job, deps); this.onmessage?.({ data: { type: 'done', result: r } }) }
      catch (e) { this.onmessage?.({ data: { type: 'error', id: job.id, message: (e as Error).message } }) }
    })
  }
  terminate(): void { this.terminated = true }
}
{
  const workers: FakeWorker[] = []
  const pool = new TilePool(() => { const w = new FakeWorker(); workers.push(w); return w }, 2)
  const mk = (): Omit<TileJob, 'id'> => ({ hb: hbBuf(), cb: null, level: -3, ty: 5, deeper: true, stepM: 0.5 })
  const results = await Promise.all([pool.run(mk()), pool.run(mk()), pool.run(mk()), pool.run(mk())])
  assert.equal(new Set(results.map((r) => r.id)).size, 4, 'each job has its own id')
  assert.deepEqual(workers.map((w) => w.posted), [2, 2], 'jobs spread over the workers')
  same(results[0].heights, results[3].heights, 'same tile, same heights')
  // A bad tile is that tile's error, not the pool's.
  await assert.rejects(pool.run({ ...mk(), hb: new ArrayBuffer(10) }), /height tile is/)
  assert.equal(pool.usable, true)
  // F9a: every job carries the page's decode switches (the Worker cannot read the page's URL).
  assert.deepEqual(workers[0].lastJob?.flags, decodeFlags(), 'the job carries the flags')
  // A postMessage throw is that job's own failure: it does not fail the worker's other jobs or spend the restart.
  workers[0].throwOnPost = true; workers[1].throwOnPost = true
  await assert.rejects(pool.run(mk()), /DataCloneError/)
  assert.equal(pool.restarts, 0, 'a clone error is not a worker crash')
  assert.equal(pool.usable, true)
  workers[0].throwOnPost = false; workers[1].throwOnPost = false
  // F9b: a one-off platform failure fails what that worker held and the worker is replaced; the pool stays on.
  assert.equal(MAX_RESTARTS, 1)
  workers[0].failWith = 'platform'
  const lost = pool.run(mk()) // lands on workers[0] (least busy, first)
  const lostR = await lost.then(() => 'ok', (e: unknown) => e)
  assert.ok(lostR instanceof WorkerUnavailable, 'the job the crashed worker held fails')
  assert.equal(pool.usable, true, 'one crash does not turn the pool off')
  assert.equal(pool.restarts, 1)
  assert.ok(workers[0].terminated, 'the crashed worker is terminated')
  assert.equal(workers.length, 3, 'a replacement was created')
  const again = await Promise.all([pool.run(mk()), pool.run(mk())])
  assert.equal(again.length, 2, 'the pool works after the restart')
  // A second platform failure exhausts the budget: the pool turns off and fails what it held.
  workers[2].failWith = 'platform'; workers[1].failWith = 'platform'
  await assert.rejects(Promise.all([pool.run(mk()), pool.run(mk())]), WorkerUnavailable)
  assert.equal(pool.usable, false)
  assert.ok(workers.every((w) => w.terminated))
  await assert.rejects(pool.run(mk()), WorkerUnavailable, 'a dead pool refuses at once')
}
// R51: the grey (TC / WAC) detail decode in the Worker is byte-identical to the page path it replaced (the code TcStreamer / DetailStreamer ran inline).
{
  const gpx = new Uint8ClampedArray(C_SIZE * C_SIZE * 4)
  for (let i = 0; i < gpx.length; i++) gpx[i] = i % 4 === 0 ? ((i >> 2) % 7 === 0 ? 0 : (i * 5 + (i >> 9)) & 255) : 255 // zeros in R: no-data
  const gdeps = { pixels: async () => new Uint8ClampedArray(gpx) }
  for (const mid of [128, 96, 141]) {
    const grey = new Uint8Array(C_SIZE * C_SIZE)
    for (let i = 0; i < grey.length; i++) grey[i] = gpx[4 * i]
    neutraliseNoData(grey, mid)
    const ref = colorMipsGrey(grey, C_SIZE)
    const r = await runGreyJob({ id: 9, kind: 'grey', cb: new ArrayBuffer(8), mid }, gdeps)
    assert.equal(r.mips.length, ref.length)
    for (let i = 0; i < ref.length; i++) same(r.mips[i], ref[i], `grey mip ${i} mid ${mid}`)
    assert.ok(!r.mips[0].includes(0), 'no-data became mid')
    assert.equal(new Set(greyTransferList(r)).size, greyTransferList(r).length)
  }
  // Through the pool, concurrently with a height job, ids kept apart.
  const pool = new TilePool(() => new FakeWorker(), 1)
  const [g1, g2, t] = await Promise.all([pool.runGrey(new ArrayBuffer(8), 128), pool.runGrey(new ArrayBuffer(8), 100), pool.run({ hb: hbBuf(), cb: null, level: -3, ty: 5, deeper: true, stepM: 0.5 })])
  assert.equal(g1.length, g2.length)
  assert.equal(g1[0][0], 128, 'no-data texel takes this job\'s mid'); assert.equal(g2[0][0], 100, 'and the other job its own')
  assert.ok(t.heights.length > 0)
  pool.dispose()
  await assert.rejects(pool.runGrey(new ArrayBuffer(8), 128), WorkerUnavailable)
  // A bad tile is that tile's error.
  const bad = new TilePool(() => new FakeWorker(), 1)
  const failing = new TilePool(() => { const w = new FakeWorker(); w.failWith = 'platform'; return w }, 1)
  await assert.rejects(failing.runGrey(new ArrayBuffer(8), 128), WorkerUnavailable)
  bad.dispose(); failing.dispose()
}
assert.equal(greyPool('?greyworker=0'), null, '?greyworker=0 keeps the detail decode on the page')
assert.equal(greyPool(''), null, 'no Worker in Node')

// F9a: the decode switches reach the decode through the job, not through the thread's location.
{
  assert.deepEqual(flagsFromSearch('?destripe=0&ewaa=0'), { decontour: true, ewaa: false, polarfilter: true, destripe: false, half: true })
  const saved = decodeFlags()
  const base = { hb: hbBuf(), cb: null, level: -3, ty: 5, deeper: true, stepM: 0.5 }
  const withStripe = await runTileJob({ ...base, id: 7, hb: hbBuf(), flags: { ...saved, destripe: true } }, deps)
  const without = await runTileJob({ ...base, id: 8, hb: hbBuf(), flags: { ...saved, destripe: false } }, deps)
  let differs = false
  for (let i = 0; i < withStripe.heights.length && !differs; i++) differs = withStripe.heights[i] !== without.heights[i]
  assert.ok(differs, 'a job with destripe off decodes differently from one with it on')
  assert.equal(decodeFlags().destripe, false, 'the worker thread now holds the job flags')
  setDecodeFlags(saved)
}
// A flag added to decode is not silently lost: createTilePool no longer refuses on them (they travel), only ?tileworker=0 does.
assert.equal(createTilePool(''), null, 'no Worker in Node: the page decodes itself')
console.log('tile-worker: ok')
