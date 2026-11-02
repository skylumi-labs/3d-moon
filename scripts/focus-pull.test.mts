// Focus pull, part A (off by default since 2026-11-01, ?focuspull=1 on): the defocus arithmetic (CPU twin of the shader), the pending marks and the 350 ms ramp on a real TileStreamer on a stub
// GL, and the shader text (switch off = the frozen text; switch on = the focus block with its guards). The pixels themselves are the rig's.
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { TileStreamer } from '../src/moon/tiles/TileStreamer.ts'
import { C_TEXEL_KM, H_SIZE } from '../src/moon/tiles/grid.ts'
import { setFades } from '../src/moon/tiles/fades.ts'
import {
  BLUR_PER_LACK, COARSE_LACK_PX, SIGMA_PER_LACK, FOCUS_PULL_MS, MAX_BLUR_PX, MIN_LACK_PX, PENDING_MARK, RELEASE_FLOOR, blurRadiusPx, markStrength, release, releaseMark, focusPullOf, lackPx, levelWeight, pull, setFocusPull, tileFadeMs,
  type LevelState,
} from '../src/moon/tiles/focusPull.ts'
import { GLOBAL_TEXEL_KM, type StreamView } from '../src/moon/tiles/wanted.ts'
import { moonFragment } from '../src/moon/moonShader.ts'

// ---------------------------------------------------------------- the switch
// On by default (2026-10-31); 0 is the off switch; a ?still=1 film or still keeps it off unless it asks for 1.
assert.equal(focusPullOf(''), false, 'off by default (owner 2026-11-01)'); assert.equal(focusPullOf('?focuspull=1'), true); assert.equal(focusPullOf('?focuspull=0'), false)
assert.equal(focusPullOf('?focuspull=true'), false, 'only 1 turns it on')
assert.equal(focusPullOf('?still=1'), false, 'films and stills keep the pre-focus-pull image'); assert.equal(focusPullOf('?still=1&focuspull=1'), true); assert.equal(focusPullOf('?still=0'), false)
assert.equal(focusPullOf('?moment=surface'), false, 'a moment link is off too'); assert.equal(focusPullOf('?moment=surface&focuspull=1'), true)
setFocusPull('?focuspull=0')
assert.equal(tileFadeMs(250), 250, 'off: the opacity fade')
setFocusPull('?focuspull=1')
assert.equal(tileFadeMs(250), FOCUS_PULL_MS); assert.equal(FOCUS_PULL_MS, 350)
setFocusPull('')
assert.equal(tileFadeMs(250), 250, 'the default is off: the opacity fade')
setFocusPull('?focuspull=0')

// ---------------------------------------------------------------- the pull curve and the blur size
assert.equal(pull(0), 0); assert.equal(pull(1), 1); assert.ok(Math.abs(pull(0.5) - 0.875) < 1e-12)
let prevPull = -1
for (let a = 0; a <= 1.0001; a += 0.05) { const p = pull(a); assert.ok(p >= prevPull); prevPull = p }
assert.equal(pull(2), 1); assert.equal(pull(-1), 0)
assert.equal(blurRadiusPx(0), 0); assert.equal(blurRadiusPx(MIN_LACK_PX), 0, 'at the floor: no blur'); assert.ok(blurRadiusPx(MIN_LACK_PX + 0.01) > 0)
assert.equal(blurRadiusPx(2), BLUR_PER_LACK * 2); assert.equal(blurRadiusPx(1e6), MAX_BLUR_PX)
assert.ok(COARSE_LACK_PX > MIN_LACK_PX)

// ---------------------------------------------------------------- the lack
const fp = 0.35 // km per pixel: level 0 (0.474 km texel) wanted, all three levels ramp to 1
const w = [0, 1, 2].map((l) => levelWeight(l, fp, GLOBAL_TEXEL_KM))
assert.deepEqual(w, [1, 1, 1], 'a 0.35 km pixel: every colour level is fully wanted')
const R = (fade = 1): LevelState => ({ resident: true, pending: false, fade })
const P: LevelState = { resident: false, pending: true, fade: 0 }
const N: LevelState = { resident: false, pending: false, fade: 0 }
// HARD BAR (CPU twin): with every level resident and fully faded in the lack is exactly 0, whatever the footprint.
for (const f of [0.02, 0.1, 0.35, 0.6, 0.9, 1.5, 2.2, 3.5, 5, 9]) {
  const ww = [0, 1, 2].map((l) => levelWeight(l, f, GLOBAL_TEXEL_KM))
  assert.equal(lackPx(f, GLOBAL_TEXEL_KM, [R(), R(), R()], ww), 0, `resident at fp ${f}`)
  assert.equal(lackPx(f, GLOBAL_TEXEL_KM, [N, N, N], ww), 0, `nothing pending at fp ${f}: no defocus (a tile nobody wants, or that does not exist, never blurs)`)
  assert.equal(lackPx(f, GLOBAL_TEXEL_KM, [R(), R(), N], ww), 0, `a missing coarse level that is not wanted`)
}
// Nothing resident, all pending: the 4k map's 2.66 km texel over a 0.35 km pixel against level 0's 0.399 km.
{
  const l = lackPx(fp, GLOBAL_TEXEL_KM, [P, P, P], w)
  assert.ok(Math.abs(l - (GLOBAL_TEXEL_KM - C_TEXEL_KM) / fp) < 1e-9, `lack ${l}`)
  assert.ok(l > 6 && l < 7)
}
// Level 2 landed, 1 and 0 on their way: the lack is level 2's texel against level 0's.
assert.ok(Math.abs(lackPx(fp, GLOBAL_TEXEL_KM, [P, P, R()], w) - (4 * C_TEXEL_KM - C_TEXEL_KM) / fp) < 1e-9)
// Level 0 arriving: the lack falls monotonically from level 1's texel gap to 0 over the ramp, and never goes negative.
{
  let prev = Infinity
  for (let a = 0; a <= 1.0001; a += 0.05) {
    const l = lackPx(fp, GLOBAL_TEXEL_KM, [R(a), R(), R()], w)
    assert.ok(l <= prev + 1e-12 && l >= 0, `a ${a}`)
    prev = l
  }
  assert.ok(Math.abs(lackPx(fp, GLOBAL_TEXEL_KM, [R(0), R(), R()], w) - (2 * C_TEXEL_KM - C_TEXEL_KM) / fp) < 1e-9, 'the instant it lands: all of level 1\'s gap')
  assert.equal(lackPx(fp, GLOBAL_TEXEL_KM, [R(1), R(), R()], w), 0)
}
// A released mark (the tile left the wanted set or backed off): its strength falls on the arrival's curve, and the lack with it, from all of it to none.
{
  assert.equal(release(0), 1); assert.equal(release(FOCUS_PULL_MS), 0); assert.equal(release(10 * FOCUS_PULL_MS), 0)
  for (let a = 0; a <= 1.0001; a += 0.05) assert.ok(Math.abs(release(a * FOCUS_PULL_MS) - (1 - pull(a))) < 1e-12, 'release is the arrival ramp (1 - pull)')
  assert.equal(releaseMark(1), PENDING_MARK); assert.equal(releaseMark(0), RELEASE_FLOOR); assert.equal(markStrength(PENDING_MARK), 1); assert.equal(markStrength(0), 0); assert.equal(markStrength(1.25), 0.25)
  const full = lackPx(fp, GLOBAL_TEXEL_KM, [P, R(), R()], w)
  assert.ok(full > 1)
  assert.equal(lackPx(fp, GLOBAL_TEXEL_KM, [{ ...P, hold: 1 }, R(), R()], w), full, 'hold 1 is a pending mark')
  assert.equal(lackPx(fp, GLOBAL_TEXEL_KM, [{ ...P, hold: 0 }, R(), R()], w), 0, 'hold 0 is no mark')
  let prev = Infinity
  for (let ms = 0; ms <= FOCUS_PULL_MS; ms += 25) {
    const l = lackPx(fp, GLOBAL_TEXEL_KM, [{ ...P, hold: release(ms) }, R(), R()], w)
    assert.ok(l <= prev + 1e-12 && l >= 0, `the released blur only eases (${ms} ms)`)
    if (ms > 0 && ms < FOCUS_PULL_MS) assert.ok(l > 0 && l < full, `still part of it at ${ms} ms`)
    prev = l
  }
}
// The ramp: level 0 is not wanted once the pixel is over two of its texels, so a pending level 0 there asks nothing.
{
  const f = 1.2, ww = [0, 1, 2].map((l) => levelWeight(l, f, GLOBAL_TEXEL_KM))
  assert.equal(ww[0], 0)
  assert.equal(lackPx(f, GLOBAL_TEXEL_KM, [P, R(), R()], ww), 0, 'level 0 weighs nothing at this footprint')
}

// ---------------------------------------------------------------- a TileStreamer on a stub GL: pending marks and the ramp
const glTarget: Record<string, unknown> = { createTexture: () => ({}), getExtension: () => null, getParameter: () => 1024, texSubImage3D: () => undefined }
const gl = new Proxy(glTarget, { get: (t, k) => (k in t ? t[k as string] : typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) ? k.length : () => undefined) }) as unknown as WebGL2RenderingContext
const renderer = { getContext: () => gl, state: { bindTexture() {}, unbindTexture() {}, pixelStorei() {} } } as unknown as THREE.WebGLRenderer
const man = {
  version: 1, tileDeg: 5, levels: 3,
  height: { px: 320, border: 1, stepM: 8, ppd: 64, texelKm: 0.4738 }, color: { px: 380, border: 1, ppd: 76, texelKm: 0.399 },
  present: ['1'.repeat(2592), '1'.repeat(648), '1'.repeat(162)], minQ: [[], [], []], maxQ: [[], [], []], source: 'test',
}
type Internals = { upload: (p: unknown, w: Map<number, unknown>, now: number) => void; admit: () => void; wanted: (v: StreamView, now: number) => Map<number, { key: number; level: number; tx: number; ty: number }> }
const Ctor = TileStreamer as unknown as new (r: THREE.WebGLRenderer, base: string, m: unknown, colourCap: number, heightCap: number, tc: null, heightWant: number) => TileStreamer
const d = Math.PI / 180
const view: StreamView = { pos: new THREE.Vector3(1.2, 0, 0), right: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, 1), back: new THREE.Vector3(1, 0, 0), tanHalf: Math.tan(15 * d), aspect: 1, tanPerPx: 0.001, moonX: new THREE.Vector3(1, 0, 0), moonY: new THREE.Vector3(0, 1, 0), moonZ: new THREE.Vector3(0, 0, 1) }
const mk = () => {
  const t = new Ctor(renderer, '/t/', man, 24, 48, null, 24)
  const i = t as unknown as Internals
  i.admit = () => undefined // no network in a Node test
  return { t, i, page: t.page.image.data as Float32Array }
}
const payOf = (wn: { key: number; level: number; tx: number; ty: number }) => ({ job: { key: wn.key, level: wn.level, tx: wn.tx, ty: wn.ty, lastWanted: 0 }, heights: new Float32Array(H_SIZE * H_SIZE), mid: 0, relief: new Float32Array(1), color: [] })

// Switch off: nothing is marked, the fade is 250 ms, the measure is zero.
setFocusPull('?focuspull=0'); setFades('?fadebatch=0')
{
  const { t, i, page } = mk()
  t.update(view, 1000)
  const wn = [...i.wanted(view, 1000).values()]
  assert.ok(wn.length >= 3 && wn.some((x) => x.level === 0))
  for (const x of wn) assert.notEqual(page[4 * x.key + 1], PENDING_MARK, 'off: no pending marks')
  assert.deepEqual(t.focusMeasure(1000), { coarse: 0, lackPx: 0, lackPer640: 0, detail: 0 })
  const l0 = wn.find((x) => x.level === 0)!
  i.upload(payOf(l0), new Map(), 1000)
  t.update(view, 1000 + 125)
  assert.ok(Math.abs(page[4 * l0.key + 1] - 0.5) < 1e-6, 'off: half way at 125 ms of 250')
}
// Switch on.
setFocusPull('?focuspull=1')
{
  const { t, i, page } = mk()
  t.update(view, 1000)
  const wn = [...i.wanted(view, 1000).values()].filter((x) => x.level >= 0)
  const l0 = wn.filter((x) => x.level === 0), l1 = wn.filter((x) => x.level === 1), l2 = wn.filter((x) => x.level === 2)
  assert.ok(l0.length && l1.length && l2.length, 'a 0.35 km pixel wants all three levels')
  for (const x of wn) assert.deepEqual([page[4 * x.key], page[4 * x.key + 1]], [0, PENDING_MARK], `level ${x.level} tile is marked pending`)
  const m0 = t.focusMeasure(1000)
  assert.ok(m0.coarse > 0.9, `the whole frame is coarse: ${m0.coarse}`)
  assert.ok(m0.lackPx > 6 && m0.lackPx < 7, `lack ${m0.lackPx} px`)
  assert.ok(Math.abs(m0.lackPer640 - SIGMA_PER_LACK * m0.lackPx * 0.64) < 1e-9, 'per 640 px, as a gaussian sigma (the prototype\'s miss)')
  // The coarse levels land; level 0 is still on its way: the lack is level 2's gap to level 0.
  for (const x of [...l2, ...l1]) i.upload(payOf(x), new Map(), 1000)
  t.update(view, 1000 + 10_000)
  for (const x of l0) assert.deepEqual([page[4 * x.key], page[4 * x.key + 1]], [0, PENDING_MARK], 'level 0 still pending')
  for (const x of [...l1, ...l2]) assert.deepEqual([page[4 * x.key + 1]], [1], 'resident and fully faded in')
  const m1 = t.focusMeasure(1000)
  assert.ok(m1.coarse > 0.9 && m1.lackPx < m0.lackPx && m1.lackPx > 0.3, `${m1.lackPx}`)
  // Level 0 lands: its pending mark is replaced by the fade, which is the 350 ms ramp, and the lack runs to 0 with it.
  const T = 20_000
  for (const x of l0) i.upload(payOf(x), new Map(), T)
  t.update(view, T)
  for (const x of l0) assert.equal(page[4 * x.key + 1], 0, 'landed: fade 0, no pending mark')
  const mA = t.focusMeasure(1000)
  t.update(view, T + 175)
  for (const x of l0) assert.ok(Math.abs(page[4 * x.key + 1] - 0.5) < 1e-6, 'half way at 175 ms of 350')
  const mB = t.focusMeasure(1000)
  assert.ok(mB.lackPx < mA.lackPx, 'the defocus is easing')
  t.update(view, T + 350)
  for (const x of l0) assert.equal(page[4 * x.key + 1], 1)
  const mEnd = t.focusMeasure(1000)
  assert.deepEqual(mEnd, { coarse: 0, lackPx: 0, lackPer640: 0, detail: 0 }, 'everything wanted is resident: nothing is coarse (the hard bar, CPU side)')
  // A tile that leaves the wanted set loses its pending mark.
  const a = mk()
  a.t.update(view, 1000)
  const w2 = [...a.i.wanted(view, 1000).values()].filter((x) => x.level === 0)
  const far = { ...view, pos: new THREE.Vector3(30, 0, 0), tanPerPx: 0.01 }
  a.t.update(far, 5000)
  // ... on the arrival's ramp: its strength (green - 1) eases out over FOCUS_PULL_MS (it used to clear on one frame), then the cell is clear.
  for (const x of w2) assert.deepEqual([a.page[4 * x.key], a.page[4 * x.key + 1]], [0, PENDING_MARK], 'let go: full strength on the first frame')
  assert.equal(a.t.update(far, 5000 + FOCUS_PULL_MS / 2), true, 'frames keep coming while it ramps')
  for (const x of w2) assert.ok(Math.abs(markStrength(a.page[4 * x.key + 1]) - release(FOCUS_PULL_MS / 2)) < 1e-6 && markStrength(a.page[4 * x.key + 1]) < 1, 'half way: (1/2)^3 of it')
  a.t.update(far, 5000 + FOCUS_PULL_MS)
  for (const x of w2) assert.deepEqual([a.page[4 * x.key], a.page[4 * x.key + 1]], [0, 0], 'not wanted any more: unmarked at the end of the ramp')
  // Wanted again mid-ramp: the mark is back at once (the tile is on its way again).
  const b = mk()
  b.t.update(view, 1000); b.t.update(far, 2000); b.t.update(far, 2100); b.t.update(view, 2200)
  const w3 = [...b.i.wanted(view, 2200).values()].filter((x) => x.level === 0)
  for (const x of w3) assert.equal(b.page[4 * x.key + 1], PENDING_MARK, 'wanted again: pending at full strength')
  b.t.update(view, 2200 + 2 * FOCUS_PULL_MS)
  for (const x of w3) assert.equal(b.page[4 * x.key + 1], PENDING_MARK, 'and the old release does not clear it')
  // A backoff (the fetch failed): the mark is let go on the same ramp, not dropped.
  const c = mk()
  c.t.update(view, 1000)
  const w4 = [...c.i.wanted(view, 1000).values()].filter((x) => x.level === 0)
  const book = (c.t as unknown as { failed: { fail: (k: number, now: number, permanent: boolean) => void } }).failed
  for (const x of w4) book.fail(x.key, 1000, false)
  c.t.update(view, 1001)
  for (const x of w4) assert.equal(c.page[4 * x.key + 1], PENDING_MARK, 'backed off: full strength on the first frame')
  c.t.update(view, 1001 + FOCUS_PULL_MS / 2)
  for (const x of w4) assert.ok(markStrength(c.page[4 * x.key + 1]) > 0 && markStrength(c.page[4 * x.key + 1]) < 1, 'backed off: easing')
  // A resident colour tile that leaves (parked, its fade runs out): it was blurring towards its own detail as it faded, and that blur ramps out as a
  // released mark at full strength instead of ending on the frame its entry is cleared. Unparked mid-ramp, it is resident again and the ramp is dropped.
  {
    const e = mk()
    e.t.update(view, 1000)
    const z0 = [...e.i.wanted(view, 1000).values()].filter((x) => x.level === 0)
    for (const x of z0) e.i.upload(payOf(x), new Map(), 1000)
    e.t.update(view, 1000 + 10_000)
    for (const x of z0) assert.equal(e.page[4 * x.key + 1], 1, 'resident, fully in')
    e.t.parking = true; e.t.parkMs = 100
    const P0 = 30_000
    e.t.update(far, P0)
    for (const x of z0) assert.ok(e.page[4 * x.key] > 0 && e.page[4 * x.key + 1] === 1, 'parked: still paged, its fade-out starts')
    e.t.update(far, P0 + FOCUS_PULL_MS / 2)
    for (const x of z0) assert.ok(e.page[4 * x.key] > 0 && e.page[4 * x.key + 1] > 0 && e.page[4 * x.key + 1] < 1, 'fading out')
    const L = P0 + FOCUS_PULL_MS
    e.t.update(far, L)
    for (const x of z0) assert.deepEqual([e.page[4 * x.key], e.page[4 * x.key + 1]], [0, PENDING_MARK], 'faded out: a released mark at full strength, not a cleared cell')
    e.t.update(far, L + FOCUS_PULL_MS / 2)
    for (const x of z0) assert.ok(Math.abs(markStrength(e.page[4 * x.key + 1]) - release(FOCUS_PULL_MS / 2)) < 1e-6, 'its blur eases on the arrival curve')
    e.t.update(far, L + FOCUS_PULL_MS)
    for (const x of z0) assert.deepEqual([e.page[4 * x.key], e.page[4 * x.key + 1]], [0, 0], 'cleared at the end of the ramp')
    // Again, unparked mid-ramp: resident at once, and the released mark is gone (it does not come back over the tile).
    e.t.update(view, L + 5000); e.t.update(view, L + 20_000)
    e.t.update(far, L + 40_000); e.t.update(far, L + 40_000 + FOCUS_PULL_MS); e.t.update(far, L + 40_000 + FOCUS_PULL_MS + 50)
    for (const x of z0) assert.equal(e.page[4 * x.key], 0, 'parked and faded out again')
    e.t.update(view, L + 40_000 + FOCUS_PULL_MS + 100)
    for (const x of z0) assert.ok(e.page[4 * x.key] > 0, 'unparked: resident again')
    e.t.update(view, L + 40_000 + 3 * FOCUS_PULL_MS)
    for (const x of z0) assert.ok(e.page[4 * x.key] > 0 && e.page[4 * x.key + 1] === 1, 'and fully in, no mark over it')
  }
  // A capture settles a ramp at once (deterministic frames).
  c.t.completeFadesForCapture(1001 + FOCUS_PULL_MS / 2)
  for (const x of w4) assert.equal(c.page[4 * x.key + 1], 0, 'capture: the released mark takes its end state')
}
setFocusPull('?focuspull=0'); setFades('')

// ---------------------------------------------------------------- the shader text
{
  const gen = (on: boolean, deepest = 0): string => { setFocusPull(on ? '?focuspull=1' : '?focuspull=0'); const s = moonFragment(180, 4096, '', true, null, false, deepest); setFocusPull('?focuspull=0'); return s }
  const off = gen(false), on = gen(true)
  { setFocusPull(''); const def = moonFragment(180, 4096, '', true, null, false, 0); setFocusPull('?focuspull=0'); assert.equal(def, off, 'the default shader has no focus block') }
  assert.ok(!off.includes('lackF'), 'off: no focus block in the shader')
  assert.ok(on.includes('lackF'), 'on: the focus block is compiled in')
  assert.ok(on.includes('if (tGate > 0.0) {\n    float fpF'), 'guarded: the tiles are read only where they were fetched')
  assert.ok(on.includes(`clamp(ts.a - ${RELEASE_FLOOR.toFixed(1)}, 0.0, 1.0)`), 'the pending mark, at its strength (a released mark ramps out)')
  for (const l of [0, 1, 2]) assert.ok(on.includes(`wI${l} = tileWeight(ts, ${l}, fpF, tGate) * ph;`), `level ${l}'s ideal weight is scaled by the mark's strength`)
  assert.ok(on.includes(`min(${MAX_BLUR_PX.toFixed(1)},`) && on.includes(`if (lackF > ${MIN_LACK_PX.toFixed(3)})`), 'the cap and the floor')
  // The plain path stays inside the block (the rest image), and the unblurred colour is what the frozen block computes.
  assert.ok(on.includes('if (wS0 > 0.0) c = mix(c, tileColor(t0, 0, gx, gy), wS0);'))
  assert.ok(gen(true, -3).includes('lackF'), 'the deeper variant carries it too')
  assert.ok(!gen(false, -3).includes('lackF'))
  // The lighting and shadow code is the same text with the switch on or off: everything after the colour block is identical.
  const tail = (s: string): string => s.slice(s.indexOf('// Mapped onto published')).replace(/\s+/g, ' ')
  assert.ok(tail(off).length > 1000)
  assert.equal(tail(on), tail(off), 'everything after the colour block is identical')
}
console.log('focus-pull: ok')
