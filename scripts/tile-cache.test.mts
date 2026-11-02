// The tile cache with deeper levels (review P1-4, P1-5, P1-6): capacity from the ladder, heights-only tiles off the colour layers,
// the fallbacks kept under the cut, the page table uploaded by texel, and highland heights exact. Runs a real TileStreamer on a stub GL.
import { smoothDeepHeights } from '../src/moon/tiles/smoothDeep.ts'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import * as THREE from 'three'
import { TileStreamer } from '../src/moon/tiles/TileStreamer.ts'
import { setFocusPull } from '../src/moon/tiles/focusPull.ts'
import { encodeHeightPlanes } from '../src/moon/tiles/codec.ts'
import { H_SIZE, MOON_R_KM, levelNx, pageWidth, tileIndex, tileOf } from '../src/moon/tiles/grid.ts'
import { levelRow } from '../src/moon/tiles/levels.ts'
import { MASK_E, MASK_W } from '../src/moon/tiles/feather.ts'
import { PARK_MS, parkMsOf, parkingOn, heightCapacity, heightFloor, heightWantCap, tcCapacity, tcWantCap, TC_CAPACITY_DEFAULT, TC_WANT_DEFAULT, WANTED_AT_FLOOR } from '../src/moon/tiles/capacity.ts'
import { computeWanted, cutWantedSplit, type StreamView } from '../src/moon/tiles/wanted.ts'
import { floorDist } from '../src/camera/pose.ts'
import { TcStreamer } from '../src/moon/tiles/TcStreamer.ts'
import { TC_PAGE_W, tcRow } from '../src/moon/tiles/tcDetail.ts'
import { wantedMemoKey } from '../src/moon/tiles/wanted.ts'
import { setFades } from '../src/moon/tiles/fades.ts'
// The fade timings below are the 250 ms opacity fade's. The focus pull (on by default since 2026-10-31) replaces it with its 350 ms ramp, which
// focus-pull.test.mts covers on a real TileStreamer; pinned off here so the opacity path keeps its coverage.
setFocusPull('?focuspull=0')
// These cases pin the cache's invariants with the hard park and fades that start at the upload (R57's `?fadeout=0&fadebatch=0`); scripts/stream-look.test.mts covers the defaults.
setFades('?fadeout=0&fadebatch=0')

/** A pinhole view `dist` radii from the centre over (lon, lat), looking at the ground below, pitched by `pitchDeg`; the short side spans 30 degrees. */
export function viewOver(dist: number, lon: number, lat: number, pitchDeg: number, w: number, h: number, dpr: number): StreamView {
  const asp = w / h, short = Math.min(w, h) * dpr
  const tanShortHalf = Math.tan(15 * Math.PI / 180)
  const d = Math.PI / 180
  const dir = new THREE.Vector3(Math.cos(lat * d) * Math.cos(lon * d), Math.cos(lat * d) * Math.sin(lon * d), Math.sin(lat * d))
  const pos = dir.clone().multiplyScalar(dist)
  const nadir = dir.clone().negate()
  const right = new THREE.Vector3().crossVectors(nadir, new THREE.Vector3(0, 0, 1)).normalize()
  const up = new THREE.Vector3().crossVectors(right, nadir).normalize()
  const q = new THREE.Quaternion().setFromAxisAngle(right, pitchDeg * d)
  const fwd = nadir.clone().applyQuaternion(q)
  return { pos, right, up: up.applyQuaternion(q), back: fwd.clone().negate(), tanHalf: asp < 1 ? tanShortHalf / asp : tanShortHalf, aspect: asp, tanPerPx: 2 * tanShortHalf / short, moonX: new THREE.Vector3(1, 0, 0), moonY: new THREE.Vector3(0, 1, 0), moonZ: new THREE.Vector3(0, 0, 1) }
}

// ---------------------------------------------------------------------------------------------- capacity from the ladder (P1-4)
const CAP3 = Math.ceil(WANTED_AT_FLOOR[-3] * 5 / 4) + 2
assert.equal(heightCapacity(48, 0, 256), 48, 'no deeper level: exactly the colour capacity, as before')
assert.equal(heightCapacity(128, 0, 256), 128)
assert.equal(heightCapacity(48, -3, 256), CAP3, 'a phone with a -3 level: the measured want plus a quarter (~29 MB)')
assert.equal(heightCapacity(128, -3, 256), CAP3, 'a desktop: its 128 colour layers plus the grazing share')
assert.equal(heightCapacity(48, -3, 100), 100, 'bounded by the GPU layer limit')
assert.ok(heightCapacity(48, -3, 256) <= 256 && heightCapacity(48, -2, 256) > 48 && heightCapacity(48, -2, 256) < heightCapacity(48, -3, 256))
// a class floor (the desktop's 256) raises the heights layers past the phone-nadir rule, never lowers them, and never adds them without deeper levels
assert.equal(heightCapacity(128, -3, 2048, 256), 256, 'desktop floor: 256 heights-only layers')
assert.equal(heightCapacity(48, -3, 2048, 100), CAP3, 'a floor under the rule changes nothing')
assert.equal(heightCapacity(128, 0, 2048, 256), 128, 'no deeper level: still the colour capacity')
assert.equal(heightCapacity(128, -3, 180, 256), 180, 'the GPU layer limit bounds the floor')
// ?heightcache=N and ?tccache=N: a measurement switch (N >= 8) over the class value; junk falls back to the class
assert.equal(heightFloor('', 256), 256)
assert.equal(heightFloor('', undefined), 0)
assert.equal(heightFloor('?heightcache=142', 256), 142)
assert.equal(heightFloor('?heightcache=4', 256), 256, 'below 8 is ignored')
assert.equal(heightFloor('?heightcache=abc', 256), 256)
assert.equal(heightCapacity(128, -3, 2048, heightFloor('?heightcache=142', 256)), CAP3, 'heightcache=142 reproduces the old desktop')
assert.equal(TC_CAPACITY_DEFAULT, 96)
assert.equal(tcCapacity(2048, '', undefined), 96, 'no class value: the old 96')
assert.equal(tcCapacity(2048, '', 192), 192)
assert.equal(tcCapacity(2048, '?tccache=96', 192), 96, 'tccache=96 reproduces the old cache')
assert.equal(tcCapacity(2048, '?tccache=300', 192), 254, 'the page table stores layer + 1 in a byte')
assert.equal(tcCapacity(64, '?tccache=128', 192), 64, 'bounded by the GPU layer limit')
assert.equal(tcCapacity(2048, '?tccache=2', 192), 192, 'below 8 is ignored')
// the TC want stops at the old 94 whatever the cache (the extra layers are history); never past capacity - 2
// the height want stays at the phone-nadir rule (main's picture); the desktop's extra layers are history
assert.equal(heightWantCap('', CAP3, 256), CAP3, 'desktop 256 layers: want 142, 114 layers of history')
assert.equal(heightWantCap('', CAP3, CAP3), CAP3, 'a phone: want = array, as before')
assert.equal(heightWantCap('?heightwant=256', CAP3, 256), 256, '?heightwant=256: the whole array wanted (the A/B arm)')
assert.equal(heightWantCap('?heightwant=300', CAP3, 256), 256, 'bounded by the array')
assert.equal(heightWantCap('?heightwant=2', CAP3, 256), CAP3, 'below 8 is ignored')
// parking only where there is history to hold: a cache whose want is its whole array (a phone, the 96-layer TC) runs main's path
assert.equal(parkingOn(true, 142, 256), true)
assert.equal(parkingOn(true, 142, 142), false, 'a phone: no history, no parking')
assert.equal(parkingOn(true, 94, 94), false, 'the 96-layer TC: want = capacity - 2')
assert.equal(parkingOn(false, 142, 256), false, '?park=0 keeps the original behaviour')
// ?parkms=N: 0..5000 whole ms, anything else keeps PARK_MS
assert.equal(PARK_MS, 1000)
assert.equal(parkMsOf(''), 1000)
assert.equal(parkMsOf('?parkms=0'), 0)
assert.equal(parkMsOf('?parkms=250'), 250)
assert.equal(parkMsOf('?a=1&parkms=5000'), 5000)
assert.equal(parkMsOf('?parkms=5001'), 1000, 'above 5000 is ignored')
assert.equal(parkMsOf('?parkms=-1'), 1000)
assert.equal(parkMsOf('?parkms=12.5'), 1000)
assert.equal(parkMsOf('?parkms=abc'), 1000)
assert.equal(parkMsOf('?parkms='), 1000)
assert.equal(TC_WANT_DEFAULT, 94)
assert.equal(tcWantCap(96, ''), 94, 'the old cache: the old cut at capacity - 2, unchanged')
assert.equal(tcWantCap(192, ''), 94, 'desktop 192: want 94, 98 layers of history')
assert.equal(tcWantCap(192, '?tcwant=190'), 190, '?tcwant=190: the whole cache wanted (the A/B arm)')
assert.equal(tcWantCap(96, '?tcwant=190'), 94, 'never past the admission reserve')
assert.equal(tcWantCap(64, ''), 62)
assert.equal(tcWantCap(192, '?tcwant=3'), 94, 'below 8 is ignored')

// wanted() over a stub StreamView at the phone's floor, over an all-present ladder: what is wanted before the cut fits the capacity near the
// equator (the review measured 90 tiles against 48 slots), and whatever the cut does, it never takes a coarse fallback.
{
  const pw = pageWidth(-3)
  const ctx = { deepest: -3, isPresent: () => true, keyOf: (l: number, tx: number, ty: number) => (levelRow(l) + ty) * pw + tx }
  const floor = floorDist(0.0592, 390 * 3, 30)
  const cap = heightCapacity(48, -3, 256)
  let worst = 0
  for (const [lon, lat] of [[0, 0], [23, 1], [-120, 25], [80, -28], [170, 10]]) for (const pitch of [0, 25]) for (const km of [130, 200, 300, 400]) {
    const v = viewOver(Math.max(floor, 1 + km / MOON_R_KM), lon, lat, pitch, 390, 844, 3)
    const out = computeWanted(v, ctx)
    worst = Math.max(worst, out.size)
    // At the floor itself (130 km, the deepest a frame can go) the whole want fits; a little higher the frame spans more tiles at -3 and the
    // cut trims the finest (below).
    if (km === 130) assert.ok(out.size <= cap - 2, `phone floor at ${lon},${lat} pitch ${pitch}: ${out.size} wanted before the cut must fit ${cap - 2} slots`)
    const all = [...out.values()].filter((t) => t.level >= 0)
    const built = all.map((t) => t.key)
    cutWantedSplit(out, 48, cap)
    // The grazing footprint rule (effectiveFootprintKm) wants more level-0 tiles in a pitched frame (54 at 400 km on a phone, 46 slots): the
    // built wants fit whole where they can, else the cut trims level-0 tiles by keep score and the coarse levels (1, 2) always survive.
    if (built.length <= 46) assert.ok(built.every((k) => out.has(k)), 'the L0-L2 fallbacks survive the cut')
    else assert.ok(all.filter((t) => t.level === 2).every((t) => out.has(t.key)), 'level 2 survives the cut')
  }
  assert.ok(worst > 90 && worst <= 240, `measured worst ${worst} (the capacity table in config.ts was taken from this sweep)`)
  // Far from the equator the count outgrows any cache: the cut trims the FINEST wants and keeps every built level.
  const v = viewOver(Math.max(floor, 1 + 230 / MOON_R_KM), -170, 60, 25, 390, 844, 3)
  const out = computeWanted(v, ctx)
  assert.ok(out.size > cap - 2, 'a 60 degree latitude overflows the cache')
  const built = [...out.values()].filter((t) => t.level >= 0).map((t) => t.key)
  cutWantedSplit(out, 48, cap)
  assert.ok(out.size <= cap - 2 && built.length > 0 && built.every((k) => out.has(k)), `cut to ${out.size}, all ${built.length} built-level wants kept`)
  // The old cut (one pool, keep score favouring the finest) would have dropped them: show the property is the split's, not an accident.
  const old = computeWanted(v, ctx)
  const ranked = [...old.values()].sort((a, b) => a.keep - b.keep).slice(0, cap - 2)
  assert.ok(built.some((k) => !ranked.some((t) => t.key === k)), 'a single keep-score cut drops built-level wants here')
}

// A saturated 136-layer desktop cache with six colour layers reserved for
// future arrivals must never promise the old 140-tile height budget. Those
// extra four deep wants were decoded and dropped repeatedly at runtime.
{
  const saturated = new Map<number, { key: number; keep: number; level: number }>()
  for (let i = 0; i < 62; i++) saturated.set(i, { key: i, keep: i, level: i % 3 })
  for (let i = 62; i < 140; i++) saturated.set(i, { key: i, keep: i, level: -3 })
  cutWantedSplit(saturated, 136, 142, 6)
  assert.equal(saturated.size, 136, `admission reserve replaces (rather than stacks on) the two-slot slack`)
}

// When the deep pool overflows, coarser deep fallbacks must survive before
// finer -3 tiles so a polar detail region grades into the built map.
{
  const mixed = new Map<number, { key: number; keep: number; level: number }>()
  for (let i = 0; i < 30; i++) mixed.set(i, { key: i, keep: i, level: i % 3 })
  // Match the polar overflow shape: a visible -1 band, broad -2 fallback
  // coverage, and a larger -3 fine set competing for the same deep budget.
  for (let i = 30; i < 64; i++) mixed.set(i, { key: i, keep: 0.7 + (i - 30) * 0.001, level: -1 })
  for (let i = 64; i < 184; i++) mixed.set(i, { key: i, keep: 0.7 + (i - 64) * 0.001, level: -2 })
  for (let i = 184; i < 304; i++) mixed.set(i, { key: i, keep: -0.45 + (i - 184) * 0.001, level: -3 })
  cutWantedSplit(mixed, 136, 142, 6)
  assert.equal(mixed.size, 136)
  const retained = new Map<number, number>()
  for (const w of mixed.values()) retained.set(w.level, (retained.get(w.level) ?? 0) + 1)
  assert.ok((retained.get(-1) ?? 0) > 0 && (retained.get(-2) ?? 0) > 0, 'coarser deep fallbacks survive')
  assert.ok((retained.get(-3) ?? 0) > 0, 'a central finest deep share survives')
  assert.ok((retained.get(-3) ?? 0) < (retained.get(-2) ?? 0), 'fine share remains bounded below fallback coverage')
}

// --------------------------------------------------------------------------- a real TileStreamer on a stub GL (P1-4, P1-5, P1-6)
const uploads: Array<{ layer: number; data: Float32Array }> = []
const glTarget: Record<string, unknown> = {
  createTexture: () => ({}), getExtension: () => null, getParameter: () => 1024,
  texSubImage3D: (_t: unknown, _lv: number, _x: number, _y: number, layer: number, _w: number, _h: number, _d: number, _f: unknown, _ty: unknown, data: Float32Array) => { uploads.push({ layer, data: data.slice() }) },
}
const gl = new Proxy(glTarget, { get: (t, k) => (k in t ? t[k as string] : typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) ? k.length : () => undefined) }) as unknown as WebGL2RenderingContext
const renderer = { getContext: () => gl, state: { bindTexture() {}, unbindTexture() {}, pixelStorei() {} } } as unknown as THREE.WebGLRenderer

const TX0 = tileOf(-3, 23.47, 0.67).tx, TY0 = tileOf(-3, 23.47, 0.67).ty
const block = new Set<number>()
for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) block.add(tileIndex(-3, TX0 + i, TY0 + j))
const presentDeep = Array.from({ length: 576 * 288 }, (_, i) => (block.has(i) ? '1' : '0')).join('')
const man = {
  version: 1, tileDeg: 5, levels: 3,
  height: { px: 320, border: 1, stepM: 8, ppd: 64, texelKm: 0.4738 }, color: { px: 380, border: 1, ppd: 76, texelKm: 0.399 },
  present: ['0'.repeat(2592), '0'.repeat(648), '0'.repeat(162)],
  minQ: [[], [], []], maxQ: [[], [], []], source: 'test',
  deeper: [{ level: -3, tileDeg: 0.625, ppd: 512, texelKm: 0.0592, stepM: 1, present: presentDeep }],
}
// +5 km highland: a 1 degree slope (4 m per 59 m texel... 1 deg = 1.03 m rise per 59 m) across 5000 m, integer metres.
const heightsOf = (tx: number, ty: number): Int32Array => {
  const q = new Int32Array(H_SIZE * H_SIZE)
  for (let y = 0; y < H_SIZE; y++) for (let x = 0; x < H_SIZE; x++) q[y * H_SIZE + x] = Math.round(5000 + ((tx - TX0) * 320 + x) * 1.03 * 0.5 + ((ty - TY0) * 320 + y) * 0.3)
  return q
}
const gz = new Map<string, Buffer>()
globalThis.fetch = (async (url: string) => {
  const m = /h\/-3\/(\d+)_(\d+)\.bin\.gz$/.exec(String(url))
  if (!m) return { ok: false, status: 404 }
  const key = `${m[1]}_${m[2]}`
  if (!gz.has(key)) gz.set(key, zlib.gzipSync(Buffer.from(encodeHeightPlanes(heightsOf(Number(m[1]), Number(m[2]))))))
  const b = gz.get(key) as Buffer
  return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
}) as unknown as typeof fetch

const Ctor = TileStreamer as unknown as new (r: THREE.WebGLRenderer, base: string, m: unknown, colourCap: number, heightCap: number) => TileStreamer
const ts = new Ctor(renderer, '/t/', man, 48, 127)
assert.equal(ts.capacity, 127); assert.equal(ts.colourCapacity, 48)
assert.equal(ts.texelKm, 0.4738, 'the global floor keeps the BUILT texel (P1-2): a deeper block does not move it')
assert.equal(ts.deepestTexelKm, 0.0592)

// Deep feather masks follow residency, not just manifest presence. A manifest-present
// neighbour that was cut from the cache must still feather; arrival removes that edge
// only after the newcomer has fully faded in, and eviction restores it. Dateline pairs
// use the wrapped neighbour as well.
{
  const maskTs = new Ctor(renderer, '/t/', man, 2, 4)
  const mi = maskTs as unknown as {
    slots: Array<{ layer: number; key: number; level: number; tx: number; ty: number; lastWanted: number; readyAt: number; colour: boolean } | null>
    bySlotKey: Map<number, unknown>; setPage: (i: number, r: number, g: number, z: number, w: number) => void
    upload: (p: { job: { key: number; level: number; tx: number; ty: number; lastWanted: number }; heights: Float32Array; mid: number; relief: Float32Array; color: Uint8Array[] }, wanted: Map<number, unknown>, now: number) => void
    wanted: () => Map<number, unknown>; evict: (s: { layer: number; key: number; level: number; tx: number; ty: number }) => void
  }
  const keyAt = (tx: number, ty: number) => (levelRow(-3) + ty) * maskTs.pageW + tx
  const payload = (tx: number, ty: number) => ({
    job: { key: keyAt(tx, ty), level: -3, tx, ty, lastWanted: 0 },
    heights: new Float32Array(H_SIZE * H_SIZE), mid: 0, relief: new Float32Array(1), color: [],
  })
  const emptyWanted = new Map<number, unknown>()
  mi.wanted = () => emptyWanted
  mi.upload(payload(TX0, TY0), emptyWanted, 0)
  const centreMask = (maskTs.page.image.data as Float32Array)[4 * keyAt(TX0, TY0) + 2]
  assert.ok((centreMask & MASK_E) !== 0, 'manifest-present but nonresident east neighbour remains feathered')
  const eastKey = keyAt(TX0 + 1, TY0)
  mi.upload(payload(TX0 + 1, TY0), emptyWanted, 1)
  assert.ok(((maskTs.page.image.data as Float32Array)[4 * keyAt(TX0, TY0) + 2] & MASK_E) !== 0, 'fading arrival keeps the old edge feather')
  maskTs.update(viewOver(1.2, 23.47, 0.67, 0, 390, 844, 3), 1 + 250)
  assert.equal((maskTs.page.image.data as Float32Array)[4 * keyAt(TX0, TY0) + 2] & MASK_E, 0, 'fully visible arrival removes the shared edge feather')
  const east = (mi.slots as Array<{ layer: number; key: number; level: number; tx: number; ty: number } | null>).find((s) => s?.key === eastKey)
  assert.ok(east)
  mi.evict(east as { layer: number; key: number; level: number; tx: number; ty: number })
  assert.ok(((maskTs.page.image.data as Float32Array)[4 * keyAt(TX0, TY0) + 2] & MASK_E) !== 0, 'eviction restores the edge feather')

  // Both neighbours completing in one update must see the same fully visible set,
  // regardless of the slot iteration order used by the fade pass.
  const reverseTs = new Ctor(renderer, '/t/', man, 2, 4)
  const ri = reverseTs as unknown as typeof mi
  const reverseKey = (tx: number, ty: number) => (levelRow(-3) + ty) * reverseTs.pageW + tx
  const reversePayload = (tx: number, ty: number) => ({
    job: { key: reverseKey(tx, ty), level: -3, tx, ty, lastWanted: 0 },
    heights: new Float32Array(H_SIZE * H_SIZE), mid: 0, relief: new Float32Array(1), color: [],
  })
  ri.wanted = () => emptyWanted
  ri.upload(reversePayload(TX0 + 1, TY0), emptyWanted, 0)
  ri.upload(reversePayload(TX0, TY0), emptyWanted, 1)
  reverseTs.update(viewOver(1.2, 23.47, 0.67, 0, 390, 844, 3), 251)
  const reversePage = reverseTs.page.image.data as Float32Array
  assert.equal(reversePage[4 * reverseKey(TX0, TY0) + 2] & MASK_E, 0, 'reverse-order centre mask sees the arrived east neighbour')
  assert.equal(reversePage[4 * reverseKey(TX0 + 1, TY0) + 2] & MASK_W, 0, 'reverse-order east mask sees the arrived west neighbour')

  const edgeMan = { ...man, deeper: [{ ...man.deeper[0], present: '1'.repeat(576 * 288) }] }
  const edgeTs = new Ctor(renderer, '/t/', edgeMan, 2, 4)
  const ei = edgeTs as unknown as typeof mi
  const edgeKey = (tx: number) => (levelRow(-3) + TY0) * edgeTs.pageW + tx
  const edgePut = (layer: number, tx: number) => {
    const key = edgeKey(tx), slot = { layer, key, level: -3, tx, ty: TY0, lastWanted: 0, readyAt: 0, colour: false }
    ei.slots[layer] = slot; ei.bySlotKey.set(key, slot); ei.setPage(key, layer + 1, 1, 0, 0); ei.refreshDeepMasks(-3, tx, TY0)
  }
  edgePut(2, 0); edgePut(3, levelNx(-3) - 1)
  const wrapMask = (edgeTs.page.image.data as Float32Array)[4 * edgeKey(0) + 2]
  assert.equal(wrapMask & MASK_W, 0, 'resident dateline neighbour is treated as present')
}
{
  const v = viewOver(floorDist(0.0592, 1170, 30), 23.47, 0.67, 0, 390, 844, 3)
  let t = 0
  for (let f = 0; f < 400; f++) {
    ts.update(v, t += 16)
    await new Promise((r) => setTimeout(r, 2))
    if (ts.resident >= block.size && !ts.busy() && ts.inflight === 0) break
  }
  for (let f = 0; f < 40; f++) ts.update(v, t += 16)
  assert.ok(ts.resident >= 20, `loaded the block (${ts.resident} resident)`)

  // P1-4: heights-only tiles live past the colour layers; the 48 colour layers stay free for the built levels.
  const layers = (ts as unknown as { slots: Array<{ layer: number } | null> }).slots.map((s, i) => (s ? i : -1)).filter((i) => i >= 0)
  assert.ok(layers.length === ts.resident && layers.every((l) => l >= ts.colourCapacity), `deeper tiles took layers ${Math.min(...layers)}..${Math.max(...layers)}, none below ${ts.colourCapacity}`)
  assert.equal((ts as unknown as { freeC: number[] }).freeC.length, 48, 'no colour layer was consumed')

  // P1-6: the highland tiles reach the GPU exact. Half float has 2 m spacing above 2048 m and 4 m above 4096 m.
  const half = (v: number): number => { if (v === 0) return 0; const e = Math.max(-14, Math.floor(Math.log2(Math.abs(v)))); const s = 2 ** (e - 10); return Math.round(v / s) * s }
  const page = ts.page.image.data as Float32Array
  let checked = 0, naive = 0
  for (const u of uploads) {
    const slot = (ts as unknown as { slots: Array<{ key: number; tx: number; ty: number; level: number } | null> }).slots[u.layer]
    if (!slot) continue
    const i = (levelRow(slot.level) + slot.ty) * ts.pageW + slot.tx
    assert.equal(page[4 * i], u.layer + 1)
    const mid = page[4 * i + 3]
    assert.ok(mid > 4000 && mid < 6000, `the tile's mid height is in the page table (${mid})`)
    const src = heightsOf(slot.tx, slot.ty)
    // Levels of 118 m and finer are stored smoothed (smoothDeep.ts); the rest exact.
    const want = smoothDeepHeights(Float32Array.from(src, (v) => v - mid), slot.level, slot.ty)
    for (let k = 0; k < src.length; k++) {
      assert.ok(Math.abs(half(u.data[k]) - want[k]) <= Math.max(1e-3, Math.abs(want[k]) * 2 ** -10), `stored minus mid is the (smoothed) source, exact to half float: ${half(u.data[k])} vs ${want[k]}`)
      if (half(src[k]) !== src[k]) naive++
    }
    checked++
  }
  assert.ok(checked >= 20 && naive > checked * 1000, `${naive} of ${checked * H_SIZE * H_SIZE} texels would have been off by 2 to 4 m stored directly`)

  // P1-5: only the touched page texels went up. Before: a full 576 x 567 x 16 byte table on every dirty frame.
  const st = ts.stats
  console.log(`page table: ${ts.pageW} x ${ts.pageH}; ${st.pageUploads} dirty frames; full-table uploads would be ${(st.pageFullBytes / 1e6).toFixed(1)} MB (${(st.pageFullBytes / st.pageUploads / 1e6).toFixed(2)} MB/frame); sent ${(st.pageBytes / 1e3).toFixed(1)} kB (${(st.pageBytes / st.pageUploads).toFixed(0)} B/frame)`)
  assert.ok(st.pageUploads > 0 && st.pageBytes * 1000 < st.pageFullBytes, 'a thousandth of the bytes')
  assert.equal(ts.page.updateRanges.length > 0 || ts.page.version >= 0, true)
}

// A deep admission with one shared colour-range token and one dedicated
// height token must consume the dedicated token first; otherwise a later
// colour arrival can collide with the planner's shared-token reservation.
{
  const mixedTs = new Ctor(renderer, '/t/', man, 2, 4)
  const internals = mixedTs as unknown as {
    freeC: number[]; freeH: number[]; slots: Array<{ layer: number; key: number; level: number; tx: number; ty: number; lastWanted: number; readyAt: number; colour: boolean } | null>
    bySlotKey: Map<number, unknown>; takeLayer: (colour: boolean, wanted: Map<number, unknown>) => number | undefined
  }
  internals.freeC = internals.freeC.filter((layer) => layer !== 0)
  internals.freeH = internals.freeH.filter((layer) => ![2, 3].includes(layer))
  const shared = { layer: 0, key: 1, level: -3, tx: TX0, ty: TY0, lastWanted: 1, readyAt: 0, colour: false }
  const dedicated = { layer: 2, key: 2, level: -3, tx: TX0 + 1, ty: TY0, lastWanted: 10, readyAt: 0, colour: false }
  internals.slots[0] = shared; internals.slots[2] = dedicated
  internals.bySlotKey.set(shared.key, shared); internals.bySlotKey.set(dedicated.key, dedicated)
  assert.equal(internals.takeLayer(false, new Map()), 2, 'deep admission prefers the dedicated height token')
}

// --------------------------------------------------------------------------- saturated static admission: no impossible ready drops or retry storm
{
  const saturatedTs = new Ctor(renderer, '/t/', man, 136, 142)
  const saturatedWanted = new Map<number, { key: number; level: number; tx: number; ty: number; priority: number; keep: number }>()
  for (let i = 0; i < 140; i++) {
    const tx = TX0 + (i % 20) - 10, ty = TY0 + Math.floor(i / 20)
    saturatedWanted.set(i + 1, { key: i + 1, level: -3, tx, ty, priority: i, keep: i })
  }
  ;(saturatedTs as unknown as { wanted: () => typeof saturatedWanted }).wanted = () => saturatedWanted
  const staticView = viewOver(1.141608, 0, -89, 0, 1280, 800, 1)
  let now = 0
  for (let frame = 0; frame < 500; frame++) {
    saturatedTs.update(staticView, now)
    now += 16
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  const requested = saturatedTs.stats.requested
  assert.equal(saturatedTs.resident, 136, `saturated static view fills only realizable layers (${saturatedTs.resident})`)
  assert.equal(saturatedTs.stats.loaded, saturatedTs.stats.uploads, `no dropped ready payloads (${saturatedTs.stats.loaded} loaded/${saturatedTs.stats.uploads} uploaded)`)
  for (let frame = 0; frame < 250; frame++) {
    saturatedTs.update(staticView, now)
    now += 16
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  assert.equal(saturatedTs.stats.requested, requested, 'static saturated view does not refetch impossible wants')
  const replacement = { key: 9000, level: -3, tx: TX0 + 30, ty: TY0, priority: 0, keep: 0 }
  saturatedWanted.delete(1)
  saturatedWanted.set(replacement.key, replacement)
  for (let frame = 0; frame < 120; frame++) {
    saturatedTs.update(staticView, now)
    now += 16
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  assert.ok(saturatedTs.stats.requested > requested, 'a newly wanted tile remains admissible after saturation')
}
// --------------------------------------------------------------------------- transient fetch failures are retried inside the job (W2-M4)
{
  const realFetch = globalThis.fetch
  const calls: string[] = []
  let mode: 'once503' | 'always503' | '404' = 'once503'
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push(String(url))
    const n = calls.length
    if (mode === '404') return { ok: false, status: 404 }
    if (mode === 'always503' || n === 1) return { ok: false, status: 503 }
    return realFetch(url, init)
  }) as unknown as typeof fetch
  const run = async (m: typeof mode): Promise<TileStreamer> => {
    mode = m; calls.length = 0
    const r = new Ctor(renderer, '/t/', man, 2, 4)
    r.retryDelaysMs = [0, 0]
    const one = { key: 1, level: -3, tx: TX0, ty: TY0, priority: 0, keep: 0 }
    const wantedOne = new Map([[1, one]])
    ;(r as unknown as { wanted: () => typeof wantedOne }).wanted = () => wantedOne
    const v = viewOver(1.2, 23.47, 0.67, 0, 390, 844, 3)
    for (let f = 0, t = 0; f < 80; f++) { r.update(v, t += 16); await new Promise((res) => setTimeout(res, 2)) }
    return r
  }
  const a = await run('once503')
  assert.equal(a.stats.retried, 1, 'one 503 is asked again once')
  assert.equal(a.stats.failed, 0, 'and the tile does not enter the failure back-off')
  assert.equal(a.stats.loaded, 1, 'the second answer (200) loaded it')
  assert.equal(calls.length, 2)
  const b = await run('always503')
  assert.equal(b.stats.retried, 2, 'a persistent 503 is retried twice')
  assert.equal(calls.length, 3, 'three requests, then the failure book takes over (10 s back-off)')
  assert.equal(b.stats.failed, 1)
  const c = await run('404')
  assert.equal(c.stats.retried, 0, 'a 404 is permanent: never retried')
  assert.equal(calls.length, 1)
  globalThis.fetch = realFetch
}

// cacheSlots refills one array in place (no garbage per frame) and still reports each resident slot.
{
  const t = new Ctor(renderer, '/t/', man, 2, 4)
  const i = t as unknown as { upload: (p: unknown, wanted: Map<number, unknown>, now: number) => void }
  const empty = new Map<number, unknown>()
  ;(t as unknown as { wanted: () => Map<number, unknown> }).wanted = () => empty
  const pay = (tx: number) => ({ job: { key: (levelRow(-3) + TY0) * t.pageW + tx, level: -3, tx, ty: TY0, lastWanted: 0 }, heights: new Float32Array(H_SIZE * H_SIZE), mid: 0, relief: new Float32Array(1), color: [] })
  i.upload(pay(TX0), empty, 0)
  const s1 = t.cacheSlots(), rec = s1[0]
  assert.equal(s1.length, 1)
  i.upload(pay(TX0 + 1), empty, 1)
  const s2 = t.cacheSlots()
  assert.equal(s2, s1, 'same array')
  assert.equal(s2.length, 2); assert.equal(s2[0], rec, 'same record')
  assert.deepEqual(s2.map((x) => [x.level, x.tx, x.ty]), [[-3, TX0, TY0], [-3, TX0 + 1, TY0]])
  // Half-float bits go up as HALF_FLOAT, floats as FLOAT.
  const before = uploads.length
  i.upload({ ...pay(TX0 + 2), heights: new Uint16Array(H_SIZE * H_SIZE) }, empty, 2)
  assert.equal(uploads.length, before + 1)
  assert.ok(uploads[uploads.length - 1].data instanceof Uint16Array, 'the Uint16 payload reaches texSubImage3D untouched')
}

// --------------------------------------------------------------------------- parking: the want caps what is drawn, not only what is fetched (review round 1)
{
  const HCAP = 256, HWANT = 142
  const Ctor7 = TileStreamer as unknown as new (r: THREE.WebGLRenderer, base: string, m: unknown, colourCap: number, heightCap: number, tc: null, heightWant: number) => TileStreamer
  const allMan = { ...man, deeper: [{ ...man.deeper[0], present: '1'.repeat(576 * 288) }] }
  type Internals = {
    wanted: (v: StreamView, now: number) => Map<number, unknown>; wantedMemo: Map<number, unknown> | null
    upload: (p: unknown, wanted: Map<number, unknown>, now: number) => void; slots: Array<{ layer: number; gen: number; parked: boolean; key: number } | null>
  }
  // the want of a 256-layer desktop never exceeds 142, at the Copernicus-style oblique and over the pole; the whole-array arm (heightwant=256) wants more
  const big = new Ctor7(renderer, '/t/', allMan, 128, HCAP, null, HWANT)
  const whole = new Ctor7(renderer, '/t/', allMan, 128, HCAP, null, HCAP)
  assert.equal(big.capacity, HCAP); assert.equal(big.heightWant, HWANT); assert.equal(big.parking, true)
  assert.equal(whole.parking, false, 'want = array: nothing to park')
  let widest = 0, wholeWidest = 0
  for (const v of [viewOver(1.046, -20, 9.7, 56, 1440, 900, 2), viewOver(1.141608, 0, -89, 0, 1280, 800, 1), viewOver(1.02, 23.47, 0.67, 70, 1512, 945, 2)]) {
    const bi = big as unknown as Internals, wi = whole as unknown as Internals
    bi.wantedMemo = null; wi.wantedMemo = null
    widest = Math.max(widest, bi.wanted(v, 0).size)
    wholeWidest = Math.max(wholeWidest, wi.wanted(v, 0).size)
  }
  assert.ok(widest <= HWANT, `wanted ${widest} stays within the want cap ${HWANT}`)
  assert.ok(wholeWidest > widest, `the whole-array arm wants more (${wholeWidest} vs ${widest}): the cap bites`)

  // a slot that leaves the want is unpaged but resident; wanted again it is paged with the arrival fade and no fetch, decode or upload
  const mkPt = (heightCap: number, heightWant: number) => {
    const t = new Ctor7(renderer, '/t/', allMan, 2, heightCap, null, heightWant)
    const i = t as unknown as Internals
    const key = (tx: number) => (levelRow(-3) + TY0) * t.pageW + tx
    const pay = (tx: number) => ({ job: { key: key(tx), level: -3, tx, ty: TY0, lastWanted: 0 }, heights: new Float32Array(H_SIZE * H_SIZE), mid: 4321, relief: new Float32Array(1), color: [] })
    const want = (...txs: number[]) => new Map<number, unknown>(txs.map((tx) => [key(tx), { key: key(tx), level: -3, tx, ty: TY0, priority: 0, keep: 0 }]))
    const slot = (tx: number) => i.slots.find((s) => s && s.key === key(tx)) ?? null
    return { t, i, key, pay, want, slot, page: t.page.image.data as Float32Array }
  }
  const view = viewOver(1.2, 23.47, 0.67, 0, 390, 844, 3)
  const A = TX0, B = TX0 + 1, C = TX0 + 2
  {
    const { t, i, key, pay, want, slot, page } = mkPt(8, 4)
    assert.equal(t.parking, true)
    let cur = want(A, B, C)
    i.wanted = () => cur
    for (const tx of [A, B, C]) i.upload(pay(tx), cur, 0)
    t.update(view, 300)
    assert.ok(page[4 * key(C)] > 0 && page[4 * key(C) + 1] === 1, 'wanted and faded in: paged')
    const layerC = slot(C)!.layer, genC = slot(C)!.gen
    cur = want(A, B)
    t.update(view, 300 + 999)
    assert.ok(page[4 * key(C)] > 0, 'unwanted for under PARK_MS: still paged (a zoom oscillating across a level threshold does not pop a band)')
    assert.equal(t.stats.parked, 0)
    t.update(view, 300 + PARK_MS + 1)
    assert.equal(page[4 * key(C)], 0, 'a slot unwanted for over PARK_MS is unpaged')
    assert.equal(page[4 * key(C) + 1], 0); assert.equal(page[4 * key(C) + 3], 0)
    assert.equal(t.resident, 3, 'but still resident')
    assert.equal(slot(C)!.parked, true); assert.equal(slot(C)!.layer, layerC); assert.equal(slot(C)!.gen, genC, 'gen unchanged: the shadow cache keeps its build')
    const cs = t.cacheSlots()
    const cC = cs.find((x) => x.layer === layerC)
    assert.ok(cC && !cC.full && !cC.shade && cC.gen === genC, 'parked: listed with its gen (the cache keeps the build) but neither full nor shaded, so no build walk or visibleWanted sees it')
    assert.ok(page[4 * key(A)] > 0 && page[4 * key(B)] > 0 && cs.filter((x) => x.full).length === 2, 'the wanted slots stay paged and full')
    assert.equal(t.stats.parked, 1)
    assert.equal(t.relief.size, 2, 'a parked tile leaves the exposure search store')
    // the history pool: a tile that needs a layer evicts the parked slot before anything wanted
    for (let k = 0; k < 3; k++) i.upload(pay(TX0 + 3 + k), cur, 1450 + k)
    assert.equal(t.stats.evicted, 0, 'six deep layers: room for three more')
    i.upload(pay(TX0 + 6), cur, 1460)
    assert.equal(t.stats.evicted, 1); assert.equal(slot(C), null, 'the parked slot was the eviction victim')
    assert.ok(slot(A) && slot(B), 'the wanted slots were not')
  }
  {
    const { t, i, key, pay, want, slot, page } = mkPt(8, 4)
    let cur = want(A, B)
    i.wanted = () => cur
    for (const tx of [A, B]) i.upload(pay(tx), cur, 0)
    t.update(view, 300)
    cur = want(A)
    t.update(view, 1500)
    assert.equal(page[4 * key(B)], 0, 'B parked')
    const up0 = uploads.length, req0 = t.stats.requested, ld0 = t.stats.loaded, su0 = t.stats.uploads
    cur = want(A, B)
    t.update(view, 1600)
    assert.equal(page[4 * key(B)], slot(B)!.layer + 1, 're-wanted: paged again on the same layer')
    assert.equal(page[4 * key(B) + 3], 4321, 'with its mid height')
    assert.equal(page[4 * key(B) + 1], 0, 'faded in from 0, like an arrival')
    t.update(view, 1600 + 125)
    assert.ok(page[4 * key(B) + 1] > 0 && page[4 * key(B) + 1] < 1, 'mid fade')
    t.update(view, 1600 + 250)
    assert.equal(page[4 * key(B) + 1], 1, 'the normal arrival fade completes')
    assert.equal(uploads.length, up0, 'no texSubImage upload'); assert.equal(t.stats.uploads, su0)
    assert.equal(t.stats.requested, req0, 'no fetch'); assert.equal(t.stats.loaded, ld0, 'no decode')
    assert.equal(t.stats.unparked, 1)
    assert.equal(t.relief.size, 2, 'and rejoins it when wanted again')
  }
  {
    // parking reports itself to the shadow cache (its neighbours' builds read the paged heights); eviction of a parked tile reports again
    const { t, i, pay, want, slot } = mkPt(8, 4)
    t.trackChanges = true
    let cur = want(A, B)
    i.wanted = () => cur
    for (const tx of [A, B]) i.upload(pay(tx), cur, 0)
    t.update(view, 300)
    t.takeChanges()
    cur = want(A)
    t.update(view, 300 + PARK_MS + 1)
    assert.deepEqual(t.takeChanges().changes, [{ level: -3, tx: B, ty: TY0 }], 'park notifies the shadow cache')
    ;(t as unknown as { evict: (s: unknown) => void }).evict(slot(B))
    assert.deepEqual(t.takeChanges().changes, [{ level: -3, tx: B, ty: TY0 }], 'evicting the parked tile notifies again')
  }
  {
    // the parking deadline wakes an idle renderer: one cancellable timer at the earliest deadline (fake timers)
    const real = { st: globalThis.setTimeout, ct: globalThis.clearTimeout }
    const timers: Array<{ fn: () => void; ms: number; live: boolean }> = []
    globalThis.setTimeout = ((fn: () => void, ms: number) => { const t = { fn, ms, live: true }; timers.push(t); return t }) as unknown as typeof setTimeout
    globalThis.clearTimeout = ((t: { live: boolean }) => { if (t) t.live = false }) as unknown as typeof clearTimeout
    try {
      const { t, i, pay, want, page, key } = mkPt(8, 4)
      let woke = 0
      t.onChange = () => { woke++ }
      let cur = want(A, B)
      i.wanted = () => cur
      for (const tx of [A, B]) i.upload(pay(tx), cur, 0)
      t.update(view, 300)
      assert.equal(timers.filter((x) => x.live).length, 0, 'nothing unwanted: no timer')
      cur = want(A)
      t.update(view, 400)
      assert.equal(timers.filter((x) => x.live).length, 1); assert.equal(timers[0].ms, 300 + PARK_MS - 400 + 1, 'due at lastWanted + parkMs')
      t.update(view, 500); t.update(view, 600)
      assert.equal(timers.length, 1, 'one timer, not one per frame')
      assert.ok(page[4 * key(B)] > 0, 'still paged before the deadline')
      timers[0].live = false; timers[0].fn()
      assert.equal(woke, 1, 'the wake marks the view dirty')
      t.update(view, 300 + PARK_MS + 1)
      assert.equal(page[4 * key(B)], 0, 'the frame the wake asks for parks it')
      assert.equal(timers.filter((x) => x.live).length, 0, 'nothing left to wait for')
      // context lost with a wake pending: suspend() cancels it, the callback never reaches onChange, and nothing is scheduled again
      const lost = mkPt(8, 4)
      let lostWoke = 0
      lost.t.onChange = () => { lostWoke++ }
      let curL = lost.want(A, B)
      lost.i.wanted = () => curL
      for (const tx of [A, B]) lost.i.upload(lost.pay(tx), curL, 0)
      lost.t.update(view, 300)
      curL = lost.want(A)
      const before = timers.length
      lost.t.update(view, 400)
      assert.equal(timers.length, before + 1, 'a wake is pending')
      const pending = timers[timers.length - 1]
      lost.t.suspend()
      assert.equal(pending.live, false, 'suspend cancelled the pending timer')
      pending.fn() // even a callback already queued does nothing
      assert.equal(lostWoke, 0, 'a cancelled wake never fires onChange')
      lost.t.update(view, 450)
      assert.equal(timers.length, before + 1, 'no new timer after suspend')
      const t2 = mkPt(8, 4)
      t2.t.parkMs = 250
      let cur2 = t2.want(A, B)
      t2.i.wanted = () => cur2
      for (const tx of [A, B]) t2.i.upload(t2.pay(tx), cur2, 0)
      t2.t.update(view, 300)
      cur2 = t2.want(A)
      t2.t.update(view, 300 + 251)
      assert.equal(t2.page[4 * t2.key(B)], 0, '?parkms=250 parks after 250 ms')
      const t3 = mkPt(8, 4)
      t3.t.parkMs = 0
      let cur3 = t3.want(A, B)
      t3.i.wanted = () => cur3
      for (const tx of [A, B]) t3.i.upload(t3.pay(tx), cur3, 0)
      t3.t.update(view, 300)
      cur3 = t3.want(A)
      t3.t.update(view, 301)
      assert.equal(t3.page[4 * t3.key(B)], 0, '?parkms=0 parks at once')
    } finally { globalThis.setTimeout = real.st; globalThis.clearTimeout = real.ct }
  }
  {
    // ?park=0 (parking false): the slot stays paged and drawn after leaving the want (the original behaviour)
    const { t, i, key, pay, want, page } = mkPt(8, 4)
    t.parking = false
    let cur = want(A)
    i.wanted = () => cur
    i.upload(pay(A), cur, 0)
    t.update(view, 300)
    cur = new Map()
    t.update(view, 1500)
    assert.ok(page[4 * key(A)] > 0, '?park=0: history stays paged')
    assert.equal(t.stats.parked, 0)
  }
}

// The TC cache: 192 layers, want 94 (capacity.ts tcWantCap). Same invariants on the TC page table (r = layer + 1 bytes, g = fade 0..255).
{
  const tcMan = { version: 1, format: 'webp-u8-ratio', mid: 128, perOctave: 1, levels: [-3, -4, -5].map((l) => ({ level: l, nx: levelNx(l), ny: levelNx(l) / 2, presentRle: [[0, levelNx(l) * (levelNx(l) / 2)]] })) }
  const TcCtor = TcStreamer as unknown as new (r: THREE.WebGLRenderer, base: string, m: unknown, cap: number, wantCap: number, park: boolean) => TcStreamer
  const mk = (cap: number, wantCap: number, park = true) => new TcCtor(renderer, '/tc/', tcMan, cap, wantCap, park)
  type TcInternals = { wantedKey: string; wantedMemo: Map<number, unknown> | null; wantedAt: number; upload: (j: unknown, mips: Uint8Array[], w: Map<number, unknown>, now: number) => void; bySlotKey: Map<number, { layer: number; parked: boolean }> }
  const tc = mk(192, 94)
  assert.equal(tc.parking, true); assert.equal(tc.wantCap, 94)
  assert.equal(mk(96, 94).parking, false, "the 96-layer TC: want = capacity - 2, no history, main's path")
  assert.equal(mk(192, 94, false).parking, false, '?park=0')
  // wanted() never exceeds the cap, even over an all-present TC manifest at a view that wants far more
  tc.update(viewOver(1.012, -20, 9.7, 56, 1440, 900, 2), 0)
  const tcWant = (tc as unknown as TcInternals).wantedMemo!.size
  assert.ok(tcWant > 0 && tcWant <= 94, `TC wanted ${tcWant} within 94`)

  const ti = tc as unknown as TcInternals
  const view = viewOver(1.2, 23.47, 0.67, 0, 390, 844, 3)
  const tkey = (tx: number) => (tcRow(-3) + 40) * TC_PAGE_W + tx
  const tw = (...txs: number[]) => new Map<number, unknown>(txs.map((tx) => [tkey(tx), { key: tkey(tx), level: -3, tx, ty: 40, priority: 0, keep: 0 }]))
  const seed = (t: TcStreamer, m: Map<number, unknown>, now: number) => { const x = t as unknown as TcInternals; x.wantedKey = wantedMemoKey(view); x.wantedMemo = m; x.wantedAt = now }
  const mips = [new Uint8Array(1)]
  let cur = tw(1, 2, 3)
  for (const tx of [1, 2, 3]) ti.upload({ key: tkey(tx), level: -3, tx, ty: 40 }, mips, cur, 0)
  seed(tc, cur, 0); tc.update(view, 300)
  const bytes = tc.pageData
  assert.ok(bytes[4 * tkey(3)] > 0 && bytes[4 * tkey(3) + 1] === 255, 'wanted and faded in: paged')
  const layer3 = ti.bySlotKey.get(tkey(3))!.layer
  cur = tw(1, 2)
  seed(tc, cur, 1000); tc.update(view, 1000)
  assert.ok(bytes[4 * tkey(3)] > 0, 'TC: unwanted for under PARK_MS: still paged')
  seed(tc, cur, 1500); tc.update(view, 1500)
  assert.equal(bytes[4 * tkey(3)], 0, 'left the want: unpaged (the WAC detail shows again)')
  assert.equal(bytes[4 * tkey(3) + 3], 0)
  assert.equal(tc.resident, 3, 'but resident'); assert.equal(ti.bySlotKey.get(tkey(3))!.parked, true)
  const up0 = uploads.length, req0 = tc.stats.requested, ld0 = tc.stats.loaded
  cur = tw(1, 2, 3)
  seed(tc, cur, 1600); tc.update(view, 1600)
  assert.equal(bytes[4 * tkey(3)], layer3 + 1, 're-wanted: paged again on its layer')
  assert.equal(bytes[4 * tkey(3) + 1], 0, 'from fade 0')
  seed(tc, cur, 1850); tc.update(view, 1850)
  assert.equal(bytes[4 * tkey(3) + 1], 255, 'the arrival fade completes')
  assert.equal(uploads.length, up0, 'no upload'); assert.equal(tc.stats.requested, req0, 'no fetch'); assert.equal(tc.stats.loaded, ld0, 'no decode')
  {
    // the TC parking deadline also wakes an idle renderer (fake timers)
    const real = { st: globalThis.setTimeout, ct: globalThis.clearTimeout }
    const timers: Array<{ fn: () => void; ms: number; live: boolean }> = []
    globalThis.setTimeout = ((fn: () => void, ms: number) => { const t = { fn, ms, live: true }; timers.push(t); return t }) as unknown as typeof setTimeout
    globalThis.clearTimeout = ((t: { live: boolean }) => { if (t) t.live = false }) as unknown as typeof clearTimeout
    try {
      const w = mk(192, 94)
      let woke = 0
      w.onChange = () => { woke++ }
      const wi = w as unknown as TcInternals
      let cw = tw(1, 2)
      for (const tx of [1, 2]) wi.upload({ key: tkey(tx), level: -3, tx, ty: 40 }, mips, cw, 0)
      seed(w, cw, 0); w.update(view, 300)
      cw = tw(1)
      seed(w, cw, 400); w.update(view, 400)
      assert.equal(timers.filter((x) => x.live).length, 1); assert.equal(timers[0].ms, 300 + PARK_MS - 400 + 1)
      timers[0].live = false; timers[0].fn()
      assert.equal(woke, 1)
      seed(w, cw, 1301); w.update(view, 1301)
      assert.equal(w.pageData[4 * tkey(2)], 0, 'parked at the deadline')
      assert.equal(timers.filter((x) => x.live).length, 0)
      assert.equal(w.parkMs, PARK_MS)
      // context lost with a TC wake pending
      const l2 = mk(192, 94)
      let w2 = 0
      l2.onChange = () => { w2++ }
      const li = l2 as unknown as TcInternals
      let cl = tw(1, 2)
      for (const tx of [1, 2]) li.upload({ key: tkey(tx), level: -3, tx, ty: 40 }, mips, cl, 0)
      seed(l2, cl, 0); l2.update(view, 300)
      cl = tw(1)
      const n0 = timers.length
      seed(l2, cl, 400); l2.update(view, 400)
      assert.equal(timers.length, n0 + 1)
      const pend = timers[timers.length - 1]
      l2.suspend()
      assert.equal(pend.live, false); pend.fn()
      assert.equal(w2, 0, 'the TC wake never fires after suspend')
    } finally { globalThis.setTimeout = real.st; globalThis.clearTimeout = real.ct }
  }
  // history is the eviction pool: with the array full, a new tile takes the oldest parked slot
  const small = mk(8, 4)
  const si = small as unknown as TcInternals
  let sw = tw(1, 2, 3, 4, 5, 6, 7, 8)
  for (const tx of [1, 2, 3, 4, 5, 6, 7, 8]) si.upload({ key: tkey(tx), level: -3, tx, ty: 40 }, mips, sw, 10 + tx)
  sw = tw(5, 6, 7, 8); seed(small, sw, 1500); small.update(view, 1500)
  si.upload({ key: tkey(9), level: -3, tx: 9, ty: 40 }, mips, sw, 1520)
  assert.equal(small.resident, 8); assert.ok(!si.bySlotKey.has(tkey(1)), 'the least recently wanted parked slot was evicted first')
}
console.log('tile-cache ok')
process.exit(0)
