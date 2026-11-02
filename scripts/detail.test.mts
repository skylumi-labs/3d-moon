// WAC detail-ratio wiring: decode maths, fade weights, pole cutoff, manifest reading, ?detail switch, shader variant (WAC-DETAIL-WIRING.md).
import { setFades } from '../src/moon/tiles/fades.ts'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  DETAIL_FADE_MS, DETAIL_PAGE_H, DETAIL_PAGE_W, detailLog2, detailLog2Mixed, detailRatio, detailRow, detailStrength, detailTexelKm, detailWeight,
  neutraliseNoData, poleWeight, slopeWeight,
} from '../src/moon/tiles/detail.ts'
import { colorMipsGrey } from '../src/moon/tiles/detailMips.ts'
import { DetailStreamer, cutDetailWanted, detailSourceVisible, readableDetail } from '../src/moon/tiles/DetailStreamer.ts'
import { MASK_E, MASK_W, featherWeight, neighbourMask } from '../src/moon/tiles/feather.ts'
import { detailPath } from '../src/moon/tiles/grid.ts'
import { levelNx } from '../src/moon/tiles/grid.ts'
import { computeWanted } from '../src/moon/tiles/wanted.ts'
import { moonFragment } from '../src/moon/moonShader.ts'

const near = (a: number, b: number, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`)

// ratio = 2^((byte-128)/40): 128 is 1.0, +-40 is an octave, the product's p1/p99 (0.65, 1.32) are inside the byte range.
near(detailRatio(128), 1)
near(detailRatio(168), 2)
near(detailRatio(88), 0.5)
near(detailRatio(255), 2 ** (127 / 40))
near(detailRatio(1), 2 ** (-127 / 40))
assert.equal(detailLog2(0), 0, 'no data is neutral')
assert.equal(detailLog2(300), 0)
const bytes = new Uint8Array([0, 128, 200, 0])
neutraliseNoData(bytes)
assert.deepEqual([...bytes], [128, 128, 200, 128])
// Mips of the bytes: geometric mean of the ratios; a neutral tile stays neutral at every level.
const flat = new Uint8Array(382 * 382).fill(128)
const mips = colorMipsGrey(flat, 382)
assert.equal(mips.length, 9)
assert.ok(mips.every((m) => m.every((v) => v === 128)))
const two = colorMipsGrey(new Uint8Array([100, 156, 100, 156]), 2)
assert.equal(two[1][0], 128)

// Footprint ramp: full at one texel, gone at two, per level texel (0.2 km at -1, 0.1 km at -2).
near(detailTexelKm(-1), detailTexelKm(0) / 2); near(detailTexelKm(-2), detailTexelKm(0) / 4)
near(detailWeight(-2, 0.05, 1, 1, 0), 1)
near(detailWeight(-2, detailTexelKm(-2), 1, 1, 0), 1)
near(detailWeight(-2, detailTexelKm(-2) * 2, 1, 1, 0), 0)
near(detailWeight(-2, detailTexelKm(-2) * 1.5, 1, 1, 0), 0.5)
// Smooth: monotone non-increasing in the footprint, no step anywhere (this is what removes the pop in a zoom).
let prev = 2, maxStep = 0
for (let i = 0; i <= 400; i++) { const w = detailWeight(-1, 0.5 * i / 400, 1, 1, 0); assert.ok(w <= prev + 1e-12); maxStep = Math.max(maxStep, prev === 2 ? 0 : prev - w); prev = w }
assert.ok(maxStep < 0.02, `ramp step ${maxStep}`)
// Fade-in scales the weight linearly from 0, an absent tile (fade 0) weighs nothing, the view gate multiplies.
near(detailWeight(-2, 0.05, 0, 1, 0), 0); near(detailWeight(-2, 0.05, 0.25, 1, 0), 0.25); near(detailWeight(-2, 0.05, 1, 0.5, 0), 0.5)
assert.equal(DETAIL_FADE_MS, 250)
// Two levels mix coarse to fine: a -2 tile still arriving (weight 0.3) moves the result only 30% of the way from the -1 value.
near(detailLog2Mixed([{ log2: 0.5, w: 1 }, { log2: -0.5, w: 0 }]), 0.5)
near(detailLog2Mixed([{ log2: 0.5, w: 1 }, { log2: -0.5, w: 0.3 }]), 0.5 - 0.3)
near(detailLog2Mixed([{ log2: 0.5, w: 0 }, { log2: -0.5, w: 0 }]), 0, 1e-12)
near(detailLog2Mixed([{ log2: 0.5, w: 1 }], 0.5), 0.25)

// Pole cutoff: full to 76 deg, none from 80, symmetric, smooth between.
near(poleWeight(0), 1); near(poleWeight(76), 1); near(poleWeight(-76), 1); near(poleWeight(80), 0); near(poleWeight(-85), 0); near(poleWeight(90), 0)
near(poleWeight(78), 0.5)
assert.ok(poleWeight(77) > poleWeight(79))
near(detailWeight(-2, 0.05, 1, 1, 81), 0)
near(detailWeight(-2, 0.05, 1, 1, 81, true), 1, 1e-12)
near(detailWeight(-2, 0.05, 0.5, 1, 81, true), 0.5, 1e-12)

// Slope gate: full on gentle ground, gone on steep ground, smooth between (WAC's own relief shading lives on slopes).
near(slopeWeight(0), 1); near(slopeWeight(2), 1); near(slopeWeight(4), 0.5); near(slopeWeight(6), 0); near(slopeWeight(30), 0)
assert.ok(slopeWeight(3) > slopeWeight(5))

// Strength switch.
assert.equal(detailStrength(''), 1); assert.equal(detailStrength('?detail=0'), 0); assert.equal(detailStrength('?auto=0&detail=1'), 1)
assert.equal(detailStrength('?detail=0.5'), 0.5); assert.equal(detailStrength('?detail=9'), 2); assert.equal(detailStrength('?detail=x'), 1)

// Manifest: only the declared product (webp-u8-ratio, mid 128, 40/octave) is readable; anything else is ignored rather than guessed at.
const ok = { path: 'd', format: 'webp-u8-ratio' as const, mid: 128, perOctave: 40, presentRle: [[0, 144 * 72]] as Array<[number, number]> }
const e = { level: -1, tileDeg: 2.5, ppd: 128, texelKm: 0.2369 }
assert.equal(readableDetail([{ ...e, detail: ok }, { ...e, level: -2, detail: { ...ok, mid: 100 } }, { ...e, level: -3, detail: ok }]).size, 1)
assert.equal(readableDetail([{ ...e, detail: { ...ok, format: 'png' as never } }]).size, 0)
assert.equal(readableDetail(undefined).size, 0)
const polarBlock = {
  version: 'polar-wac-detail-v1' as const, path: 'd-polar/v1', format: 'webp-u8-ratio' as const,
  mid: 128, perOctave: 40, transitionDeg: [76, 80] as [number, number], blend: 'log2-global-polar-v1' as const,
  levels: [{ level: -1 as const, nx: 144, ny: 72, presentRle: [[10, 2]] as Array<[number, number]> }],
}
const polarReadable = readableDetail([{ ...e, detail: ok }], polarBlock)
assert.equal(polarReadable.get(-1)?.path, 'd')
assert.deepEqual(polarReadable.get(-1)?.polar, { path: 'd-polar/v1', present: undefined, presentRle: [[10, 2]] })
assert.equal(readableDetail([{ ...e, detail: ok }]).get(-1)?.polar, undefined, 'legacy manifests have no polar route flag')
assert.equal(readableDetail([{ ...e, detail: ok }], { ...polarBlock, blend: 'unknown' as never }).get(-1)?.polar, undefined)
assert.equal(readableDetail([{ ...e, detail: ok }], { ...polarBlock, path: 9, transitionDeg: null, levels: null } as never).get(-1)?.polar, undefined,
  'malformed optional polar metadata is ignored without breaking global detail')
assert.equal(detailSourceVisible(-1, 0, true, false), false, 'legacy global detail remains culled at the pole')
assert.equal(detailSourceVisible(-1, 0, false, true), true, 'declared polar detail remains requestable above the old cutoff')
assert.equal(detailSourceVisible(-1, 36, true, false), true)
assert.equal(detailPath(-2, 224, 84), 'd/-2/224_84.webp')
assert.equal(detailRow(-1), 0); assert.equal(detailRow(-2), 72); assert.equal(DETAIL_PAGE_W, 288); assert.equal(DETAIL_PAGE_H, 216)

// Detail page entries use the resident-neighbour contract: an absent neighbour
// feathers only that edge, wraps at longitude, and arrival removes the mask.
{
  const resident = new Set<string>()
  for (let y = 9; y <= 11; y++) for (let x = 9; x <= 11; x++) resident.add(`${x},${y}`)
  resident.delete('11,10')
  const present = (tx: number, ty: number): boolean => resident.has(`${tx},${ty}`)
  assert.equal(neighbourMask(-1, 10, 10, present), MASK_E, 'missing east detail neighbour masks east edge')
  resident.add('11,10')
  assert.equal(neighbourMask(-1, 10, 10, present), 0, 'arriving neighbour removes detail edge mask')
  assert.equal(neighbourMask(-1, 0, 10, (tx, ty) => tx === 143 || tx === 0 || tx === 1 || ty !== 10), 0, 'detail longitude wraps')
  assert.equal(featherWeight(1, 0.5, MASK_E, 24, 380), 0, 'detail feather reaches zero at missing edge')
  assert.equal(featherWeight(1 - 24 / 380, 0.5, MASK_E, 24, 380), 1, 'detail feather ends within one tile border')
}

// North-89 daylight regression: the exact capture pose produces 878 raw detail
// wants, but the 96-slot detail cache must retain both -1 fallback and -2 fine
// coverage within its 94-tile post-reserve budget.
{
  const d = Math.PI / 180, lon = 2.5 * d, lat = 89 * d
  const dir = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat))
  const pos = dir.clone().multiplyScalar(1.1416081828182763)
  const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize()
  const view = {
    pos, right, up: new THREE.Vector3().crossVectors(right, dir).normalize(), back: dir,
    tanHalf: Math.tan(15 * d), aspect: 1280 / 800, tanPerPx: 2 * Math.tan(15 * d) / 800,
    moonX: new THREE.Vector3(1, 0, 0), moonY: new THREE.Vector3(0, 1, 0), moonZ: new THREE.Vector3(0, 0, 1),
  }
  const present = (level: number, index: number): boolean => {
    if (level >= 0) return false
    const ty = Math.floor(index / levelNx(level))
    return level === -1 ? ty < 6 || ty >= 66 : ty < 12 || ty >= 132
  }
  const wanted = computeWanted(view, { deepest: -2, isPresent: present, keyOf: (level, tx, ty) => ty * levelNx(level) + tx })
  assert.equal(wanted.size, 878, 'north89 raw detail wants remain reproducible')
  cutDetailWanted(wanted, 96)
  assert.equal(wanted.size, 94, 'detail cut retains capacity minus arrival reserve')
  const retained = [...wanted.values()].reduce((n, w) => { n[w.level] = (n[w.level] ?? 0) + 1; return n }, {} as Record<number, number>)
  assert.equal(retained[-1], 71, 'coarser -1 fallback remains resident')
  assert.equal(retained[-2], 23, 'bounded quarter of finest -2 remains resident')
  const fits = new Map([[1, { key: 1, level: -1, keep: 0, priority: 0, tx: 0, ty: 0 }], [2, { key: 2, level: -2, keep: 0, priority: 0, tx: 0, ty: 0 }]])
  cutDetailWanted(fits, 96)
  assert.equal(fits.size, 2, 'normal detail wants are unchanged when under capacity')
}

// Exercise the real DetailStreamer page lifecycle with a small stub GL: masks
// are symmetric after both neighbours finish fading, preserve the polar source
// flag, and return on eviction (including the longitude seam).
{
  const glTarget: Record<string, unknown> = {
    createTexture: () => ({}), getExtension: () => null, getParameter: () => 1024,
    texStorage3D() {}, texParameteri() {}, texSubImage3D() {}, deleteTexture() {},
  }
  const gl = new Proxy(glTarget, { get: (t, k) => (k in t ? t[k as string] : typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) ? k.length : () => undefined) }) as unknown as WebGL2RenderingContext
  const renderer = { getContext: () => gl, state: { bindTexture() {}, unbindTexture() {}, pixelStorei() {} } } as unknown as THREE.WebGLRenderer
  setFades('?fadebatch=0') // fades that start at the upload (R57's batching is covered in stream-look.test.mts)
  const stream = new DetailStreamer(renderer, '/t/', new Map(), 2)
  const di = stream as unknown as {
    pageData: Float32Array
    upload: (j: { key: number; level: number; tx: number; ty: number; lastWanted: number; polarBlended: boolean }, mips: Uint8Array[], wanted: Map<number, unknown>, now: number) => void
    evict: (s: { layer: number; key: number; level: number; tx: number; ty: number }) => void
  }
  const keyAt = (tx: number, ty: number, level = -1) => (detailRow(level) + ty) * DETAIL_PAGE_W + tx
  // The focus pull indicator's detail signal: 0 with nothing wanted or nothing in flight; else the share of wanted tiles not resident and not backed off.
  {
    const ms = stream as unknown as { wantedMemo: Map<number, { key: number }> | null; jobs: Map<number, unknown>; bySlotKey: Map<number, unknown> }
    assert.equal(stream.missingShare(0), 0, 'nothing wanted')
    ms.wantedMemo = new Map([[1, { key: 1 }], [2, { key: 2 }], [3, { key: 3 }], [4, { key: 4 }]])
    assert.equal(stream.missingShare(0), 0, 'nothing in flight: nothing is loading')
    ms.jobs.set(1, {}); ms.bySlotKey.set(2, {}); ms.bySlotKey.set(3, {})
    assert.equal(stream.missingShare(0), 0.5, 'two of four wanted are not resident')
    ms.jobs.clear(); ms.bySlotKey.clear(); ms.wantedMemo = null
  }
  const mips = [new Uint8Array(382 * 382), new Uint8Array(191 * 191)]
  const put = (tx: number, ty: number, now: number, polarBlended = false) => {
    const key = keyAt(tx, ty)
    di.upload({ key, level: -1, tx, ty, lastWanted: now, polarBlended }, mips, new Map(), now)
    return key
  }
  put(10, 10, 0, true); const eastKey = put(11, 10, 1)
  const view = { pos: new THREE.Vector3(0, 0, 1.2), right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), back: new THREE.Vector3(0, 0, -1), tanHalf: 0.3, aspect: 1, tanPerPx: 0.001, moonX: new THREE.Vector3(1, 0, 0), moonY: new THREE.Vector3(0, 1, 0), moonZ: new THREE.Vector3(0, 0, 1) }
  stream.update(view, 251)
  const page = di.pageData
  assert.equal(page[4 * keyAt(10, 10) + 2], 1, 'upload preserves polar source flag')
  assert.equal(page[4 * keyAt(10, 10) + 3] & MASK_E, 0, 'faded east neighbour clears centre east mask')
  assert.equal(page[4 * keyAt(11, 10) + 3] & MASK_W, 0, 'faded west neighbour clears east west mask')
  const eastSlot = [...(stream as unknown as { bySlotKey: Map<number, { layer: number; key: number; level: number; tx: number; ty: number }> }).bySlotKey.values()].find((s) => s.key === eastKey)
  assert.ok(eastSlot)
  di.evict(eastSlot as { layer: number; key: number; level: number; tx: number; ty: number })
  assert.ok((page[4 * keyAt(10, 10) + 3] & MASK_E) !== 0, 'eviction restores centre east mask')

  const seam = new DetailStreamer(renderer, '/t/', new Map(), 2)
  const si = seam as unknown as typeof di
  const left = keyAt(143, 10), right = keyAt(0, 10)
  si.upload({ key: left, level: -1, tx: 143, ty: 10, lastWanted: 0, polarBlended: false }, mips, new Map(), 0)
  si.upload({ key: right, level: -1, tx: 0, ty: 10, lastWanted: 0, polarBlended: false }, mips, new Map(), 0)
  seam.update(view, 251)
  const seamPage = si.pageData
  assert.equal(seamPage[4 * left + 3] & MASK_E, 0, 'detail mask wraps at east dateline')
  assert.equal(seamPage[4 * right + 3] & MASK_W, 0, 'detail mask wraps at west dateline')
}

// Shader: the detail variant samples both levels, applies the pole cutoff and multiplies albedo; without the flag the text carries none of it
// (the depth-0 fixture and every other variant stay byte for byte).
const off = moonFragment(180, 4096, '', true, null, false, -2, false)
const on = moonFragment(180, 4096, '', true, null, false, -2, true)
assert.ok(!off.includes('uTileD') && !off.includes('uDetailK'))
assert.ok(on.includes('detailLevel(uv, -1,') && on.includes('detailLevel(uv, -2,') && on.includes('poleK(dLat)') && on.includes('albedo *= exp2(dLog * uDetailK)'))
assert.ok(on.includes('smoothstep(76.0, 80.0, abs(latDeg))') && on.includes('smoothstep(2.0, 6.0, slopeDeg)') && on.includes('slopeK(atan(length(vec2(sx, sy)))'))
assert.ok(on.includes('a = absent-neighbour mask') && on.includes('detailFeather(g - c, int(e.w + 0.5))'), 'detail tiles feather toward nonresident neighbours')
assert.ok(on.includes(`const float DF_W = ${(24 / 380).toFixed(6)};`), 'detail feather width is bounded to the colour tile')
assert.ok(on.indexOf('albedo *= exp2(dLog') > on.indexOf('vec3 albedo = An * chroma;'), 'applied to the level-0 albedo')
console.log('detail: ok')

// Invisible WAC tiles at the poles must not consume network/CPU/cache while
// their terrain tiles remain useful. Keep the cutoff-adjacent border and all
// equatorial tiles for seamless interpolation.
{
  const { detailTileVisible } = await import('../src/moon/tiles/detail.ts')
  const { levelNy } = await import('../src/moon/tiles/grid.ts')
  for (const level of [-1, -2]) {
    const ny = levelNy(level)
    assert.equal(detailTileVisible(level, 0), false)
    assert.equal(detailTileVisible(level, ny - 1), false)
    assert.equal(detailTileVisible(level, ny / 2), true)
    const edge = level === -1 ? 4 : 8
    assert.equal(detailTileVisible(level, edge - 2), false)
    assert.equal(detailTileVisible(level, edge - 1), true)
    assert.equal(detailTileVisible(level, ny - edge), true)
    assert.equal(detailTileVisible(level, ny - edge + 1), false)
    assert.equal(detailTileVisible(level, edge + 1), true)
  }
}
