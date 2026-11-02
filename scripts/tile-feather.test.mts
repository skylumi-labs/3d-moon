// Where a block of finer tiles ends (review P1-8) and the per-tile height offset (P1-6): on synthetic data, with the CPU twin of
// the shader's tileFeather (the GLSL text is checked to carry the same constants and the same bit order).
import assert from 'node:assert/strict'
import { MASK_E, MASK_N, MASK_NE, MASK_W, TILE_FEATHER_TEXELS, featherWeight, neighbourMask } from '../src/moon/tiles/feather.ts'
import { H_PX } from '../src/moon/tiles/grid.ts'
import { tileDecls } from '../src/moon/moonShader.ts'

// ---- the mask
{
  const set = new Set(['5,5', '4,5', '6,5', '5,4', '5,6', '4,4', '6,4', '4,6', '6,6'])
  const has = (tx: number, ty: number): boolean => set.has(`${tx},${ty}`)
  assert.equal(neighbourMask(-3, 5, 5, has), 0, 'surrounded: no feather')
  set.delete('6,5')
  assert.equal(neighbourMask(-3, 5, 5, has), MASK_E | 0, 'east neighbour absent: east bit only (the corners beside it are covered by it)')
  set.add('6,5'); set.delete('6,4')
  assert.equal(neighbourMask(-3, 5, 5, has), MASK_NE, 'only the north-east diagonal absent: the corner bit')
  set.add('6,4'); set.delete('4,5'); set.delete('5,4')
  assert.equal(neighbourMask(-3, 5, 5, has), MASK_W | MASK_N)
  // Longitude wraps, the poles do not end a block.
  assert.equal(neighbourMask(-3, 575, 100, (tx) => tx === 574 || tx === 575 || tx === 0), 0, 'column 575 sees column 0 across longitude 180')
  assert.equal(neighbourMask(-3, 10, 0, (_tx, ty) => ty <= 1), 0, 'no row above the first: counts as present')
  assert.equal(neighbourMask(-3, 10, 287, (_tx, ty) => ty >= 286), 0, 'no row below the last: counts as present')
}
// ---- the weight
assert.equal(TILE_FEATHER_TEXELS, 24)
assert.equal(featherWeight(0.5, 0.5, 0), 1)
assert.equal(featherWeight(1, 0.5, MASK_E), 0, 'zero at an absent edge')
assert.equal(featherWeight(1 - 24 / H_PX, 0.5, MASK_E), 1, 'one 24 texels in')
assert.equal(featherWeight(0, 0.5, MASK_E), 1, 'the far edge, whose neighbour exists, is untouched')
let prev = 0
for (let i = 0; i <= 100; i++) { const w = featherWeight(1 - (i / 100) * (24 / H_PX), 0.5, MASK_E); assert.ok(w >= prev - 1e-12, 'monotone'); prev = w }
// GLSL carries the same constants and bit order.
const d = tileDecls(-3)
assert.ok(d.includes(`const float TF_W = ${(24 / H_PX).toFixed(6)};`))
for (const [bit, expr] of [[1, 'f.x)'], [2, '1.0 - f.x)'], [4, 'f.y)'], [8, '1.0 - f.y)'], [16, 'max(f.x, f.y))'], [32, 'max(1.0 - f.x, f.y))'], [64, 'max(f.x, 1.0 - f.y))'], [128, 'max(1.0 - f.x, 1.0 - f.y))']] as const)
  assert.ok(d.includes(`if ((m & ${bit}) != 0) w *= smoothstep(0.0, TF_W, ${expr};`), `bit ${bit}`)

// ---- a coverage edge, low Sun. Fine data (59 m) ends at x = 0; beyond it only the 8x box-filtered field (474 m) exists. The ground is a
// plain with craters of 100 to 500 m, and the Sun is 1.5 degrees up in the east, so the row's horizon decides lit or shadow.
const TEXEL = 59.2
let seed = 11
const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const craters = Array.from({ length: 1500 }, () => ({ x: -6000 + rnd() * 22000, y: rnd() * 7000, r: 50 + rnd() * 250, d: 8 + rnd() * 40 }))
// Craters bucketed by 400 m cell (a crater reaches 1.2 r <= 360 m), so a height reads the 3 x 3 cells around it, not all 1500: the same
// sum over the same craters (in list order), only without the ones too far away to add anything.
const CELL = 400
const buckets = new Map<number, number[]>()
const cellKey = (i: number, j: number): number => (i + 1000) * 10000 + (j + 1000)
craters.forEach((c, k) => {
  const key = cellKey(Math.floor(c.x / CELL), Math.floor(c.y / CELL))
  const b = buckets.get(key); if (b) b.push(k); else buckets.set(key, [k])
})
const fineAt = (x: number, y: number): number => {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), near: number[] = []
  for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) { const b = buckets.get(cellKey(i, j)); if (b) near.push(...b) }
  near.sort((a, b) => a - b)
  let h = 0
  for (const k of near) { const c = craters[k]; const u = Math.hypot(x - c.x, y - c.y) / c.r; if (u < 1.2) h += u < 1 ? -c.d * (1 - u * u) : 0.3 * c.d * Math.exp(-((u - 1) ** 2) * 20) }
  return h
}
// The bucketing drops no crater that reaches a point: against the plain loop over all 1500, on points across the whole crater field.
{
  const plain = (x: number, y: number): number => {
    let h = 0
    for (const c of craters) { const u = Math.hypot(x - c.x, y - c.y) / c.r; if (u < 1.2) h += u < 1 ? -c.d * (1 - u * u) : 0.3 * c.d * Math.exp(-((u - 1) ** 2) * 20) }
    return h
  }
  for (let k = 0; k < 4000; k++) { const x = -6500 + ((k * 7919) % 4000) * 5.75, y = -500 + ((k * 104729) % 4000) * 2; assert.equal(fineAt(x, y), plain(x, y), `bucketed height at ${x}, ${y}`) }
}
const coarseAt = (x: number, y: number): number => {
  // the box mean over 8 texels (474 m)
  let s = 0
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) s += fineAt(x + (i - 1.5) * 118, y + (j - 1.5) * 118)
  return s / 16
}
// Both blends read the same points: the fine and the coarse height of each, computed once.
const both = new Map<string, [number, number]>()
const fineCoarse = (x: number, y: number): [number, number] => {
  const key = `${x},${y}`
  let v = both.get(key)
  if (!v) { v = [fineAt(x, y), coarseAt(x, y)]; both.set(key, v) }
  return v
}
function horizonDeg(x0: number, y: number, blend: (x: number) => number): number {
  const h = (x: number): number => { const a = blend(x), [f, c] = fineCoarse(x, y); return a * f + (1 - a) * c }
  const h0 = h(x0)
  let best = -90
  for (let k = 1; k <= 40; k++) { const dx = k * 250; const x = x0 + dx; best = Math.max(best, Math.atan2(h(x) - h0, dx) * 180 / Math.PI) }
  for (let k = 1; k <= 30; k++) { const dx = 59 * (k / 6) * 1 + k * 0; const x = x0 + dx * 4; best = Math.max(best, Math.atan2(h(x) - h0, x - x0) * 180 / Math.PI) }
  return best
}
const edgeStep = (blend: (x: number) => number): number => {
  // Rows crossing the edge at x = 0; the mean horizon of the origins within 300 m east of the edge against those within 300 m west of it.
  const rows = Array.from({ length: 120 }, (_, j) => 100 + j * 53)
  const at = (x0: number): number => rows.reduce((s, y) => s + horizonDeg(x0, y, blend), 0) / rows.length
  const side = (x1: number, x2: number): number => { const v: number[] = []; for (let x = x1; x < x2; x += 59.2) v.push(at(x)); return v.reduce((a, b) => a + b, 0) / v.length }
  return Math.abs(side(0, 300) - side(-300, 0))
}
const hard = edgeStep((x) => (x < 0 ? 1 : 0))
// A tile ends where its block does: the weight falls from 1 to 0 over the last 24 texels, as the shader's feather does on a tile whose east neighbour is absent.
const soft = edgeStep((x) => (x >= 0 ? 0 : featherWeight(1 + x / (320 * TEXEL), 0.5, MASK_E)))
console.log(`row-mean horizon, jump across the edge (300 m either side): hard edge ${hard.toFixed(3)} deg, feathered ${soft.toFixed(3)} deg`)
assert.ok(hard > 0.02, 'the instrument sees the false line at a hard edge')
assert.ok(soft < hard / 3, 'the feather removes it')
console.log('tile-feather ok')
