// Chroma deblocking of the level-0 colour tiles (src/moon/tiles/deblock.ts): block steps vanish, plain data and real edges stay.
import assert from 'node:assert/strict'
import { BLOCK, FEATURE, deblockChroma } from '../src/moon/tiles/deblock.ts'

const SIZE = 96
let seed = 7
const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
function make(blockAmp: number, edgeAt = -1, edgeAmp = 0): Uint8ClampedArray {
  const px = new Uint8ClampedArray(SIZE * SIZE * 4)
  const bv = new Map<string, number>()
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const k = `${Math.floor(x / BLOCK)},${Math.floor(y / BLOCK)}`
    if (!bv.has(k)) bv.set(k, (rnd() - 0.5) * 2 * blockAmp)
    const luma = 128 + 20 * Math.sin(x / 5) * Math.cos(y / 7)
    const tint = bv.get(k)! + (edgeAt >= 0 && x >= edgeAt ? edgeAmp : 0)
    const i = 4 * (y * SIZE + x)
    px[i] = luma + tint; px[i + 1] = luma; px[i + 2] = luma - tint; px[i + 3] = 255
  }
  return px
}
// Mean absolute R-B step across the 16 pixel seams, away from the seams' own neighbours.
function seamStep(px: Uint8ClampedArray, edgeCol = -1): number {
  let s = 0, n = 0
  for (let x = BLOCK; x < SIZE; x += BLOCK) {
    if (x === edgeCol) continue
    for (let y = 0; y < SIZE; y++) {
      const a = 4 * (y * SIZE + x), b = a - 4
      s += Math.abs(px[a] - px[a + 2] - (px[b] - px[b + 2])); n++
    }
  }
  return s / n
}
const blocky = make(1.2)
const before = seamStep(blocky)
const out = Uint8ClampedArray.from(blocky)
deblockChroma(out, SIZE)
const after = seamStep(out)
assert.ok(before > 1.5, `test image is blocky (${before.toFixed(2)})`)
assert.ok(after < 0.5 * before, `steps shrink: ${before.toFixed(2)} -> ${after.toFixed(2)}`)
// Luma is kept: the mean of the three channels moves by less than a level.
let dl = 0
for (let i = 0; i < SIZE * SIZE; i++) dl = Math.max(dl, Math.abs((out[4 * i] + out[4 * i + 1] + out[4 * i + 2]) / 3 - (blocky[4 * i] + blocky[4 * i + 1] + blocky[4 * i + 2]) / 3))
assert.ok(dl < 1.5, `luma moved by ${dl.toFixed(2)}`)
// A real edge (a 40 level colour step on a seam) is left alone.
const edged = make(0, 48, 40)
const e0 = seamStep(edged)
const e1 = Uint8ClampedArray.from(edged)
deblockChroma(e1, SIZE)
let moved = 0
for (let y = 0; y < SIZE; y++) for (let x = 44; x < 52; x++) moved = Math.max(moved, Math.abs(e1[4 * (y * SIZE + x)] - edged[4 * (y * SIZE + x)]))
assert.ok(FEATURE < 40 && moved < 1.5, `a real edge moved by ${moved.toFixed(2)} (seam step ${e0.toFixed(1)})`)
// A flat image does not change.
const flat = new Uint8ClampedArray(SIZE * SIZE * 4).fill(120)
const f1 = Uint8ClampedArray.from(flat)
deblockChroma(f1, SIZE)
for (let i = 0; i < flat.length; i++) assert.ok(Math.abs(f1[i] - flat[i]) <= 1)
console.log('deblock ok')
