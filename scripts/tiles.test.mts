/**
 * Tile codec, grid and (when MOON_TILES_DIR points at a built set) the built tiles:
 *   npm test
 */
import { reportSkip } from './test-skip.mts'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { decodeHeightPlanes, encodeHeightPlanes, exactInHalf } from '../src/moon/tiles/codec.ts'
import {
  BORDER, H_PX, H_SIZE, H_STEP_M, PAGE_H, PAGE_W, heightPath, levelNx, levelNy, pageRowOffset, tileIndex, tileOf, type TileManifest,
} from '../src/moon/tiles/grid.ts'
import { type Want, boundGrid, cutWanted, keepScore } from '../src/moon/tiles/wanted.ts'

// 1. The codec is lossless on real-looking data: a ridge, craters and noise, with sharp steps.
{
  const q = new Int32Array(H_SIZE * H_SIZE)
  let s = 12345
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let y = 0; y < H_SIZE; y++) for (let x = 0; x < H_SIZE; x++) {
    const r = Math.hypot(x - 100, y - 200)
    q[y * H_SIZE + x] = Math.round(-600 + 40 * Math.sin(x / 17) + (r < 60 ? -300 * (1 - r / 60) : 0) + (x > 250 ? 700 : 0) + rnd() * 6)
  }
  const back = decodeHeightPlanes(new Uint8Array(zlib.gunzipSync(zlib.gzipSync(Buffer.from(encodeHeightPlanes(q))))))
  assert.deepEqual(Array.from(back), Array.from(q))
  // An out-of-range residual is refused, not wrapped.
  const bad = new Int32Array(H_SIZE * H_SIZE)
  bad[5] = 70000
  assert.throws(() => encodeHeightPlanes(bad))
}

// 2. Every stored height is exact in half float (R16F): multiples of H_STEP_M over the Moon's whole range.
{
  assert.equal(H_STEP_M, 8)
  for (let m = -10240; m <= 11000; m += H_STEP_M) assert.ok(exactInHalf(m), `${m} m is not exact in half float`)
  // The check is real: a 1 m step is not exact above 2,048 m.
  assert.ok(!exactInHalf(9001))
}

// 3. Grid arithmetic.
{
  assert.equal(levelNx(0) * levelNy(0), 2592)
  assert.equal(levelNx(1) * levelNy(1), 648)
  assert.equal(levelNx(2) * levelNy(2), 162)
  assert.equal(PAGE_W, 72)
  assert.equal(PAGE_H, 36 + 18 + 9)
  assert.equal(pageRowOffset(1), 36)
  assert.equal(pageRowOffset(2), 54)
  assert.deepEqual(tileOf(0, -180, 90), { tx: 0, ty: 0 })
  assert.deepEqual(tileOf(0, 179.999, -89.999), { tx: 71, ty: 35 })
  assert.deepEqual(tileOf(0, 180, 0), { tx: 0, ty: 18 })
  assert.deepEqual(tileOf(0, -20.08, 9.62), { tx: 31, ty: 16 })
  assert.deepEqual(tileOf(2, -20.08, 9.62), { tx: 7, ty: 4 })
  assert.equal(tileIndex(0, 71, 35), 2591)
}

// 4. Built tiles, when a set is at hand.
const dir = process.env.MOON_TILES_DIR
if (dir && fs.existsSync(path.join(dir, 'manifest.json'))) {
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as TileManifest
  const load = (l: number, tx: number, ty: number) => decodeHeightPlanes(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(dir, heightPath(l, tx, ty))))))
  assert.equal(man.height.px, H_PX)
  for (let l = 0; l < man.levels; l++) assert.equal(man.present[l].length, levelNx(l) * levelNy(l))
  // The tile under Copernicus: its interior range is what the manifest says.
  const { tx, ty } = tileOf(0, -20.08, 9.62)
  const q = load(0, tx, ty)
  let lo = Infinity, hi = -Infinity
  for (let y = BORDER; y < H_SIZE - BORDER; y++) for (let x = BORDER; x < H_SIZE - BORDER; x++) { lo = Math.min(lo, q[y * H_SIZE + x]); hi = Math.max(hi, q[y * H_SIZE + x]) }
  assert.equal(lo, man.minQ[0][tileIndex(0, tx, ty)])
  assert.equal(hi, man.maxQ[0][tileIndex(0, tx, ty)])
  // Copernicus's floor is below its rim by about 3.7 km: relief of several km in the tile.
  assert.ok((hi - lo) * H_STEP_M > 2500, `relief ${(hi - lo) * H_STEP_M} m`)
  // Neighbours agree across the seam: tile A's border column is tile B's first interior column, and vice versa.
  const b = load(0, tx + 1, ty)
  for (let y = 0; y < H_SIZE; y++) {
    assert.equal(q[y * H_SIZE + (H_SIZE - 1)], b[y * H_SIZE + BORDER])
    assert.equal(b[y * H_SIZE + 0], q[y * H_SIZE + (H_SIZE - 1 - BORDER)])
  }
  // Across longitude 180 the last column wraps to the first.
  const w0 = load(0, 71, 12), w1 = load(0, 0, 12)
  for (let y = 0; y < H_SIZE; y++) assert.equal(w0[y * H_SIZE + (H_SIZE - 1)], w1[y * H_SIZE + BORDER])
  // Heights are the LOLA range (-9,115 to +10,757 m by the SVS formula), quantised.
  for (let l = 0; l < man.levels; l++) for (const v of man.minQ[l]) assert.ok(v * H_STEP_M >= -9200 && v * H_STEP_M <= 10800)
  console.log(`built tiles at ${dir}: ok`)
} else reportSkip('tiles.test', 'data', 'MOON_TILES_DIR not set: built-tile checks skipped')
// 3. The cut when more tiles are wanted than the cache holds: near-frame level-0 tiles outrank far coarse fallbacks.
{
  const mk = (n: number, level: number, centre: number, off: number): Want[] => Array.from({ length: n }, (_, i) => ({ key: off + i, level, tx: i, ty: 0, priority: 0, keep: keepScore(centre + i * 0.01, level) }))
  const out = new Map<number, Want>()
  // 20 level-0 tiles near the middle, 14 level-1 and 10 level-2 fallbacks nearer the middle than the frame edge: 44 wanted, 24 layers.
  for (const w of [...mk(20, 0, 0.2, 0), ...mk(14, 1, 0.3, 100), ...mk(10, 2, 0.2, 200)]) out.set(w.key, w)
  cutWanted(out, 24)
  assert.equal(out.size, 22, 'two layers stay free')
  const byLevel = [0, 0, 0]
  for (const w of out.values()) byLevel[w.level]++
  assert.equal(byLevel[0], 20, `every near-frame level-0 tile is kept (${byLevel})`)
  // Within the cache: nothing is cut.
  const small = new Map<number, Want>(mk(10, 0, 0.2, 0).map((w) => [w.key, w]))
  cutWanted(small, 48)
  assert.equal(small.size, 10)
}

// 4. The terrain shell's bounds (boundGrid) enclose every level-0 tile inside each 20 deg cell; the level-2 manifest ranges do not
// (box-filtered copies have smoothed extremes), which is why they are not used.
if (dir) {
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as TileManifest
  const grid = boundGrid(man)
  let outsideBound = 0, outsideL2 = 0
  for (let ty = 0; ty < levelNy(0); ty++) for (let tx = 0; tx < levelNx(0); tx++) {
    const i0 = tileIndex(0, tx, ty), i2 = tileIndex(2, tx >> 2, ty >> 2)
    if (man.present[0][i0] !== '1') continue
    const o = 2 * (ty >> 2) * 18 + 2 * (tx >> 2)
    if (man.maxQ[0][i0] * H_STEP_M > grid[o] || man.minQ[0][i0] * H_STEP_M < grid[o + 1]) outsideBound++
    if (man.maxQ[0][i0] > man.maxQ[2][i2] || man.minQ[0][i0] < man.minQ[2][i2]) outsideL2++
  }
  assert.equal(outsideBound, 0, `${outsideBound} level-0 tiles outside their cell's bound`)
  assert.ok(outsideL2 > 0, 'the discriminating case: level 2 alone would cut summits')
  console.log(`terrain bounds: ${outsideL2} of 2,592 level-0 tiles lie outside their level-2 manifest range; 0 outside the derived bound`)
}
console.log('tiles.test: ok')

// Deeper levels (grid.ts, TILE-CONTRACT.md 1b): the ladder continues below level 0 with exact counts, and the three built levels are untouched.
{
  const g = await import('../src/moon/tiles/grid.ts')
  assert.equal(g.levelDeg(-1), 2.5); assert.equal(g.levelNx(-3), 576); assert.equal(g.levelNy(-3), 288)
  assert.equal(g.heightPpd(0), 64); assert.equal(g.heightPpd(-3), 512)
  assert.ok(Math.abs(g.heightTexelKm(-3) - 0.0592) < 5e-4, '512 ppd is the 59 m of SLDEM2015')
  assert.equal(g.levelForTexelKm(0.0593), -3); assert.equal(g.levelForTexelKm(0.4738), 0); assert.equal(g.levelForTexelKm(5), 0); assert.equal(g.levelForTexelKm(1e-6), g.DEEPEST_LEVEL)
  // A point maps to a tile whose box contains it, at every depth, across the seam at longitude 180.
  for (const [lon, lat] of [[23.473, 0.674], [-179.99, 10], [179.99, -89.9], [0, 90]] as const) for (const l of [0, -1, -3]) {
    const { tx, ty } = g.tileOf(l, lon, lat), d = g.levelDeg(l)
    assert.ok(tx >= 0 && tx < g.levelNx(l) && ty >= 0 && ty < g.levelNy(l))
    const west = -180 + tx * d, north = 90 - ty * d
    assert.ok(((lon + 180) % 360 + 360) % 360 - 180 >= west - 1e-9 && ((lon + 180) % 360 + 360) % 360 - 180 <= west + d + 1e-9 && lat <= north + 1e-9 && lat >= north - d - 1e-9, `tile contains ${lon},${lat} at ${l}`)
  }
  // Page rows: the deeper levels stack below the built ones without overlapping, and a level's table is as wide as its grid.
  assert.equal(g.deeperRowOffset(-1), g.PAGE_H); assert.equal(g.deeperRowOffset(-2), g.PAGE_H + 72); assert.equal(g.deeperRowOffset(-3), g.PAGE_H + 72 + 144)
  assert.equal(g.pageWidth(0), g.PAGE_W); assert.equal(g.pageWidth(-3), 576)
  assert.equal(g.levelTiles(-3), 576 * 288)
}
