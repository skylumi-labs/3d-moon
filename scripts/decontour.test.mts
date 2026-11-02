// decontourHeights: an 8 m staircase becomes a ramp inside its quantisation cells; real steps and relief are left; prepareHeights applies it to built levels only.
import assert from 'node:assert/strict'
import { H_SIZE, H_STEP_M } from '../src/moon/tiles/grid.ts'
import { decontourHeights, prepareHeights } from '../src/moon/tiles/smoothDeep.ts'

const N = H_SIZE
const mk = (f: (x: number, y: number) => number): Float32Array => { const a = new Float32Array(N * N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) a[y * N + x] = f(x, y); return a }
// A gentle east-facing slope of 1.5 m per texel, stored in 8 m steps: a riser every ~5 texels, contours running north-south.
const trueRamp = (x: number): number => 1.5 * x
const stair = mk((x) => Math.round(trueRamp(x) / H_STEP_M) * H_STEP_M)
const out = decontourHeights(stair, H_STEP_M)
// Slope jitter: the mean absolute east-west second difference falls at least 3x (a stair is all risers).
const d2 = (a: Float32Array): number => { let t = 0, c = 0; for (let y = 10; y < N - 10; y += 7) for (let x = 12; x < N - 12; x++) { t += Math.abs(a[y * N + x - 1] + a[y * N + x + 1] - 2 * a[y * N + x]); c++ } return t / c }
assert.ok(d2(out) < d2(stair) / 3, `stair roughness ${d2(stair)} -> ${d2(out)}`)
// Nothing leaves its cell, and the result is closer to the true ramp than the stair was.
let maxMove = 0, errS = 0, errO = 0
for (let y = 10; y < N - 10; y++) for (let x = 12; x < N - 12; x++) { const i = y * N + x; maxMove = Math.max(maxMove, Math.abs(out[i] - stair[i])); errS += Math.abs(stair[i] - trueRamp(x)); errO += Math.abs(out[i] - trueRamp(x)) }
assert.ok(maxMove <= H_STEP_M / 2 + 1e-3, `moved ${maxMove}`)
assert.ok(errO < errS * 0.6, `error vs the true ramp ${errS} -> ${errO}`)
// A real cliff (60 m) stays a cliff: the height just either side is within a cell of the input.
const cliff = mk((x) => (x < 160 ? 0 : 64))
const co = decontourHeights(cliff, H_STEP_M)
assert.ok(Math.abs(co[100 * N + 158] - 0) <= 4 + 1e-3 && Math.abs(co[100 * N + 162] - 64) <= 4 + 1e-3, 'cliff kept')
// Built levels get it, deep levels do not (they have their own smoothing), and a flat tile is unchanged.
assert.notEqual(prepareHeights(stair, 0, 20), stair)
assert.ok(d2(prepareHeights(stair, 0, 20)) < d2(stair) / 3, 'prepareHeights decontours level 0')
const flat = mk(() => 40)
assert.ok(decontourHeights(flat, H_STEP_M).every((v) => v === 40), 'flat unchanged')
console.log('decontour ok')
