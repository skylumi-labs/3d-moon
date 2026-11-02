// R57 streaming look: fade-out of a parked tile, batched fade starts, the fade-only flag, the honest resolution line, the coarse patch prefetch.
// Real TileStreamer on a stub GL (as tile-cache.test.mts). The ray-pass share is in wanted-dedupe.test.mts.
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { TileStreamer } from '../src/moon/tiles/TileStreamer.ts'
import { setFocusPull } from '../src/moon/tiles/focusPull.ts'
import { H_SIZE, tileOf } from '../src/moon/tiles/grid.ts'
import { levelRow } from '../src/moon/tiles/levels.ts'
import { PARK_MS } from '../src/moon/tiles/capacity.ts'
import { BATCH_MS, FADE_CADENCE_MS, fadeCadenceMs, fadeInFrom, fadeInLevel, fadeOutLevel, fadesOf, fadeStartAt, setFades } from '../src/moon/tiles/fades.ts'
import type { StreamView } from '../src/moon/tiles/wanted.ts'
import { TcStreamer } from '../src/moon/tiles/TcStreamer.ts'
import { TC_PAGE_W, tcRow } from '../src/moon/tiles/tcDetail.ts'
import { levelNx } from '../src/moon/tiles/grid.ts'
import { wantedMemoKey } from '../src/moon/tiles/wanted.ts'
import { resolutionLine } from '../src/hud.ts'
import { COARSE_PREFETCH_MAX_RAW_BYTES, coarseLevelUrls, patchPrefetchOn, prefetchPatchCoarse, resetCoarsePrefetch } from '../src/moon/patch/coarsePrefetch.ts'

// ---------------------------------------------------------------- the pure arithmetic
assert.deepEqual(fadesOf(''), { out: true, batchMs: BATCH_MS, cadence: 'class' })
assert.deepEqual(fadesOf('?fadeout=0'), { out: false, batchMs: BATCH_MS, cadence: 'class' })
assert.deepEqual(fadesOf('?fadebatch=0'), { out: true, batchMs: 0, cadence: 'off' })
assert.equal(fadesOf('?fadebatch=1').cadence, 'on')
assert.equal(fadeCadenceMs('desktop', fadesOf('')), 0, 'desktop: every frame')
for (const c of ['ios', 'ipad', 'phone-android', 'tablet'] as const) assert.equal(fadeCadenceMs(c, fadesOf('')), FADE_CADENCE_MS, c)
assert.equal(fadeCadenceMs('phone-android', fadesOf('?fadebatch=0')), 0, 'switch off: every frame on a phone')
assert.equal(fadeCadenceMs('desktop', fadesOf('?fadebatch=1')), FADE_CADENCE_MS, '=1 forces it on desktop for a rig A/B')
// Rest to motion (WP-A, 2026-10-23), `?fadebatch=cost`: the cadence follows the measured full frame too (over two vsyncs), on any class; without the switch the cost is not looked at.
assert.equal(fadesOf('?fadebatch=cost').cadence, 'cost')
assert.equal(fadeCadenceMs('desktop', fadesOf('?fadebatch=cost'), 117, 1000 / 120), FADE_CADENCE_MS, "the owner's 117 ms frame at 120 Hz: thinned")
assert.equal(fadeCadenceMs('desktop', fadesOf('?fadebatch=cost'), 30, 1000 / 60), 0, 'a 30 ms frame at 60 Hz fits two vsyncs: every frame')
assert.equal(fadeCadenceMs('desktop', fadesOf('?fadebatch=cost'), 0, 1000 / 60), 0, 'nothing measured yet: every frame')
assert.equal(fadeCadenceMs('desktop', fadesOf(''), 117, 1000 / 120), 0, 'without the switch the desktop draws every fade frame, whatever the cost')
assert.equal(fadeCadenceMs('phone-android', fadesOf('?fadebatch=cost'), 0, 1000 / 60), FADE_CADENCE_MS, 'the class set keeps the cadence under =cost')
assert.equal(fadeCadenceMs('desktop', fadesOf('?fadebatch=0'), 117, 1000 / 120), 0, '=0 still turns it off')
assert.equal(fadeStartAt(1000, 80), 1040); assert.equal(fadeStartAt(1040, 80), 1040); assert.equal(fadeStartAt(1001, 80), 1040); assert.equal(fadeStartAt(77, 0), 77)
assert.equal(fadeInLevel(100, 160, 250), 0, 'a start in the future reads 0')
assert.equal(fadeInLevel(285, 160, 250), 0.5); assert.equal(fadeInLevel(999, 160, 250), 1)
// The fade-out curve: from where it stands, linear on the arrival's slope, 0 at FADE_MS, monotone, never negative.
assert.equal(fadeOutLevel(1, 500, 500, 250), 1); assert.equal(fadeOutLevel(1, 500, 625, 250), 0.5); assert.equal(fadeOutLevel(1, 500, 750, 250), 0); assert.equal(fadeOutLevel(1, 500, 5000, 250), 0)
assert.equal(fadeOutLevel(0.4, 500, 625, 250), 0.2, 'from a partial level')
let prev = 2
for (let t = 500; t <= 760; t += 10) { const g = fadeOutLevel(0.8, 500, t, 250); assert.ok(g <= prev); prev = g }
// A reversal meets itself: climbing back starts at the level the fall had reached.
{ const g = fadeOutLevel(1, 0, 100, 250); assert.ok(Math.abs(fadeInLevel(300, fadeInFrom(g, 300, 250), 250) - g) < 1e-12) }

// ---------------------------------------------------------------- a TileStreamer on a stub GL
const glTarget: Record<string, unknown> = { createTexture: () => ({}), getExtension: () => null, getParameter: () => 1024, texSubImage3D: () => undefined }
const gl = new Proxy(glTarget, { get: (t, k) => (k in t ? t[k as string] : typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) ? k.length : () => undefined) }) as unknown as WebGL2RenderingContext
const renderer = { getContext: () => gl, state: { bindTexture() {}, unbindTexture() {}, pixelStorei() {} } } as unknown as THREE.WebGLRenderer
const TX0 = tileOf(-3, 23.47, 0.67).tx, TY0 = tileOf(-3, 23.47, 0.67).ty
const man = {
  version: 1, tileDeg: 5, levels: 3,
  height: { px: 320, border: 1, stepM: 8, ppd: 64, texelKm: 0.4738 }, color: { px: 380, border: 1, ppd: 76, texelKm: 0.399 },
  present: ['0'.repeat(2592), '0'.repeat(648), '0'.repeat(162)], minQ: [[], [], []], maxQ: [[], [], []], source: 'test',
  deeper: [{ level: -3, tileDeg: 0.625, ppd: 512, texelKm: 0.0592, stepM: 1, present: '1'.repeat(576 * 288) }],
}
type Internals = { wanted: (v: StreamView, now: number) => Map<number, unknown>; upload: (p: unknown, w: Map<number, unknown>, now: number) => void; slots: Array<{ key: number; readyAt: number; parked: boolean; leaving: boolean } | null> }
const Ctor = TileStreamer as unknown as new (r: THREE.WebGLRenderer, base: string, m: unknown, colourCap: number, heightCap: number, tc: null, heightWant: number) => TileStreamer
const mk = () => {
  const t = new Ctor(renderer, '/t/', man, 2, 8, null, 4)
  const i = t as unknown as Internals
  const key = (tx: number) => (levelRow(-3) + TY0) * t.pageW + tx
  const pay = (tx: number) => ({ job: { key: key(tx), level: -3, tx, ty: TY0, lastWanted: 0 }, heights: new Float32Array(H_SIZE * H_SIZE), mid: 4321, relief: new Float32Array(1), color: [] })
  const want = (...txs: number[]) => new Map<number, unknown>(txs.map((tx) => [key(tx), { key: key(tx), level: -3, tx, ty: TY0, priority: 0, keep: 0 }]))
  return { t, i, key, pay, want, page: t.page.image.data as Float32Array }
}
const d = Math.PI / 180
const nadir = new THREE.Vector3(-1, 0, 0)
const view: StreamView = { pos: new THREE.Vector3(1.2, 0, 0), right: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, 1), back: nadir.clone().negate(), tanHalf: Math.tan(15 * d), aspect: 1, tanPerPx: 0.001, moonX: new THREE.Vector3(1, 0, 0), moonY: new THREE.Vector3(0, 1, 0), moonZ: new THREE.Vector3(0, 0, 1) }
const A = TX0, B = TX0 + 1

// These fade timings are the 250 ms opacity fade's: the focus pull (on by default since 2026-10-31) replaces it with its 350 ms ramp, which
// focus-pull.test.mts covers (arrival, release of a leaving tile, capture). Pinned off here so the opacity path keeps its coverage.
setFocusPull('?focuspull=0')
// Fade-out on (the default): a parked tile falls to 0 over FADE_MS, then the entry is cleared; the layer stays resident.
setFades('?fadebatch=0')
{
  const { t, i, key, pay, want, page } = mk()
  let cur = want(A, B)
  i.wanted = () => cur
  for (const tx of [A, B]) i.upload(pay(tx), cur, 0)
  t.update(view, 300)
  assert.equal(page[4 * key(B) + 1], 1)
  cur = want(A)
  {
    t.update(view, 300 + PARK_MS + 1)
    const T = 300 + PARK_MS + 1
    assert.equal(t.stats.parked, 1)
    assert.ok(page[4 * key(B)] > 0 && page[4 * key(B) + 1] === 1, 'just parked: still paged at full weight, no step')
    assert.equal(t.fadeOnlyBusy, true, 'only a fade keeps frames coming')
    t.update(view, T + 125)
    assert.ok(Math.abs(page[4 * key(B) + 1] - 0.5) < 1e-6, 'half way down')
    // wanted again mid fade: climbs back from there, no jump to 0, no upload
    cur = want(A, B)
    const up0 = t.stats.uploads
    t.update(view, T + 125)
    assert.ok(Math.abs(page[4 * key(B) + 1] - 0.5) < 1e-6, 're-wanted: continues from the level it had')
    t.update(view, T + 125 + 125)
    assert.ok(Math.abs(page[4 * key(B) + 1] - 1) < 1e-6 || page[4 * key(B) + 1] > 0.99, 'and reaches full weight on the arrival slope')
    assert.equal(t.stats.uploads, up0); assert.equal(t.stats.unparked, 1)
    // leave again and run to the end
    cur = want(A)
    t.update(view, T + 1000 + PARK_MS)
    const T2 = T + 1000 + PARK_MS
    t.update(view, T2 + 251)
    assert.equal(page[4 * key(B)], 0, 'fade finished: entry cleared'); assert.equal(t.resident, 2, 'still resident')
    assert.equal(t.fadeOnlyBusy, false)
  }
}
// Fade-out off: the old step.
setFades('?fadeout=0&fadebatch=0')
{
  const { t, i, key, pay, want, page } = mk()
  let cur = want(A, B)
  i.wanted = () => cur
  for (const tx of [A, B]) i.upload(pay(tx), cur, 0)
  t.update(view, 300); cur = want(A)
  t.update(view, 300 + PARK_MS + 1)
  assert.equal(page[4 * key(B)], 0, '?fadeout=0: unpaged at once')
}
// Batched fade starts: tiles uploaded within one 80 ms window start together, on the grid line.
setFades('')
{
  const { t, i, key, pay, want, page } = mk()
  const cur = want(A, B)
  i.wanted = () => cur
  i.upload(pay(A), cur, 1010); i.upload(pay(B), cur, 1075)
  const r = i.slots.filter(Boolean).map((s) => s!.readyAt)
  assert.deepEqual(r, [1040, 1120].map((x, k) => (k === 0 ? 1040 : 1120)))
  assert.equal(fadeStartAt(1010, BATCH_MS), 1040); assert.equal(fadeStartAt(1075, BATCH_MS), 1120)
  t.update(view, 1030)
  assert.equal(page[4 * key(A) + 1], 0, 'not before its grid line')
  t.update(view, 1040 + 125)
  assert.ok(Math.abs(page[4 * key(A) + 1] - 0.5) < 1e-6)
  setFades('?fadebatch=0')
  const m2 = mk(); const c2 = m2.want(A); m2.i.wanted = () => c2
  m2.i.upload(m2.pay(A), c2, 1010)
  assert.equal(m2.i.slots.find(Boolean)!.readyAt, 1010, '?fadebatch=0: the fade starts at the upload')
}
// A frame-stepped capture keeps the upload frame.
setFades('')
{
  const { t, i, pay, want } = mk(); const cur = want(A); i.wanted = () => cur
  t.update({ ...view, flightReuse: false }, 1000)
  i.upload(pay(A), cur, 1010)
  assert.equal(i.slots.find(Boolean)!.readyAt, 1010)
}
setFades('')

// The TC streamer parks the same way: the byte fade falls to 0, the WAC detail shows through only then.
for (const out of [true, false]) {
  setFades(out ? '?fadebatch=0' : '?fadeout=0&fadebatch=0')
  const tcMan = { version: 1, format: 'webp-u8-ratio', mid: 128, perOctave: 1, levels: [-3, -4, -5].map((l) => ({ level: l, nx: levelNx(l), ny: levelNx(l) / 2, presentRle: [[0, levelNx(l) * (levelNx(l) / 2)]] })) }
  const TcCtor = TcStreamer as unknown as new (r: THREE.WebGLRenderer, base: string, m: unknown, cap: number, wantCap: number, park: boolean) => TcStreamer
  const tc = new TcCtor(renderer, '/tc/', tcMan, 192, 94, true)
  type TI = { wantedKey: string; wantedMemo: Map<number, unknown> | null; wantedAt: number; upload: (j: unknown, m: Uint8Array[], w: Map<number, unknown>, now: number) => void }
  const ti = tc as unknown as TI
  const tkey = (tx: number) => (tcRow(-3) + 40) * TC_PAGE_W + tx
  const tw = (...txs: number[]) => new Map<number, unknown>(txs.map((tx) => [tkey(tx), { key: tkey(tx), level: -3, tx, ty: 40, priority: 0, keep: 0 }]))
  const tv = { ...view, tanPerPx: 0.001 }
  const seed = (m: Map<number, unknown>, now: number) => { ti.wantedKey = wantedMemoKey(tv); ti.wantedMemo = m; ti.wantedAt = now }
  let cur = tw(1, 2)
  for (const tx of [1, 2]) ti.upload({ key: tkey(tx), level: -3, tx, ty: 40 }, [new Uint8Array(1)], cur, 0)
  seed(cur, 0); tc.update(tv, 300)
  const b = tc.pageData
  assert.equal(b[4 * tkey(2) + 1], 255)
  cur = tw(1); seed(cur, 1400); tc.update(tv, 1400)
  if (out) {
    assert.ok(b[4 * tkey(2)] > 0 && b[4 * tkey(2) + 1] === 255, 'TC just parked: still at full weight')
    assert.equal(tc.fadeOnlyBusy, true)
    seed(cur, 1525); tc.update(tv, 1525)
    assert.ok(Math.abs(b[4 * tkey(2) + 1] - 127.5) <= 1, 'half way down')
    cur = tw(1, 2); seed(cur, 1525); tc.update(tv, 1525)
    assert.ok(Math.abs(b[4 * tkey(2) + 1] - 127.5) <= 1, 're-wanted: continues from there')
    cur = tw(1); seed(cur, 3000); tc.update(tv, 3000); seed(cur, 4400); tc.update(tv, 4400); seed(cur, 4700); tc.update(tv, 4700)
    assert.equal(b[4 * tkey(2)], 0, 'after the fade the entry is cleared')
  } else assert.equal(b[4 * tkey(2)], 0, '?fadeout=0: unpaged at once')
}
setFades('')

// ---------------------------------------------------------------- the resolution line (TM-17): 474 m, 59 m, TC
{
  const r = (pxKm: number, heightKm: number, tcKm?: number | null) => resolutionLine({ pxKm, heightKm, colourKm: 0.399, tcKm })
  assert.equal(r(0.6, 0.474), null, 'a pixel far coarser than the data: no line')
  assert.match(r(0.474, 0.474)!, /^Data resolution reached: heights on a 474 m grid, colour on a 399 m grid$/)
  assert.match(r(0.3, 0.474)!, /^Magnified past the data \(heights on a 474 m grid/)
  // Under a deeper block the 59 m grid is what is drawn: a 300 m pixel shows no line, a 59 m pixel reaches the data.
  assert.equal(r(0.3, 0.059), null, 'finer data drawn than the pixel resolves: nothing to say')
  assert.match(r(0.059, 0.059)!, /^Data resolution reached: heights on a 59 m grid/)
  assert.match(r(0.02, 0.059)!, /^Magnified past the data \(heights on a 59 m grid/)
  // With a Terrain Camera tile drawn the finest source sets the verdict, and the line names it.
  assert.match(r(0.059, 0.474, null)!, /^Magnified past the data \(heights on a 474 m grid/, 'no deeper tile drawn: a 59 m pixel is magnified past the 474 m data')
  assert.match(r(0.0125, 0.059, 0.0125)!, /^Data resolution reached: heights on a 59 m grid, colour on a 399 m grid, Terrain Camera detail on a 12\.5 m grid$/)
  assert.match(r(0.005, 0.059, 0.0125)!, /^Magnified past the data/)
  assert.equal(r(0.1, 0.059, 0.0125), null)
  assert.equal(resolutionLine(null), null)
}

// ---------------------------------------------------------------- the coarse patch prefetch (TM-11)
{
  assert.equal(patchPrefetchOn(''), true); assert.equal(patchPrefetchOn('?patchpre=0'), false)
  const manifest = { levels: [{ name: 'L0', w: 1000, h: 1000, heights: 'L0h.bin.gz', heightFormat: 'f16x2', detail: 'L0d.bin.gz' }, { name: 'L1', w: 8000, h: 8000, heights: 'L1h.bin.gz', detail: 'L1d.bin.gz' }] }
  assert.deepEqual(coarseLevelUrls(manifest as never, '/p/a17/'), ['/p/a17/L0h.bin.gz', '/p/a17/L0d.bin.gz'], 'the first level only')
  assert.deepEqual(coarseLevelUrls({ levels: [{ name: 'big', w: 20000, h: 20000, heights: 'x' }] } as never, '/p/'), [], 'too large to prefetch')
  assert.ok(COARSE_PREFETCH_MAX_RAW_BYTES > 0)
  resetCoarsePrefetch()
  const asked: Array<[string, unknown]> = []
  let bodies = 0
  const fetchImpl = async (u: string, init?: { priority?: string }) => {
    asked.push([u, init?.priority])
    return { ok: true, json: async () => manifest, arrayBuffer: async () => { bodies++; return new ArrayBuffer(1) } }
  }
  const got = await prefetchPatchCoarse('/p/a17/', { fetchImpl })
  assert.deepEqual(got, ['/p/a17/L0h.bin.gz', '/p/a17/L0d.bin.gz'])
  assert.ok(asked.every(([, p]) => p === 'low'), 'low priority')
  assert.equal(bodies, 2, 'bodies read to the end so the HTTP cache keeps them')
  assert.equal((await prefetchPatchCoarse('/p/a17/', { fetchImpl })).length, 0, 'once per site')
  assert.equal(asked.length, 3)
  resetCoarsePrefetch()
  assert.deepEqual(await prefetchPatchCoarse('/q/', { fetchImpl: async () => { throw new Error('offline') } }), [], 'never rejects')
}
console.log('stream-look: ok')
