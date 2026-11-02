import assert from 'node:assert/strict'
import { DisplayRate } from '../src/post/gpuTimer.ts'

function run(gaps: number[]): number {
  const d = new DisplayRate()
  let t = 1000
  d.sample(t)
  for (const g of gaps) { t += g; d.sample(t) }
  return d.hz
}
const fill = (n: number, g: number): number[] => Array.from({ length: n }, () => g)

assert.equal(run(fill(40, 16.7)), 60, 'a clean 60 Hz rest')
assert.equal(run(fill(40, 33.3)), 30, 'a real 30 Hz display still reads 30')
assert.equal(run(fill(40, 8.3)), 120)
// The regression: more than half the rest frames were slow (a loaded page), interleaved with vsync-paced ones.
const mixed: number[] = []
for (let i = 0; i < 40; i++) mixed.push(i % 5 < 3 ? 33.4 : 16.7)
assert.equal(run(mixed), 60, 'slow rest frames do not turn a 60 Hz display into 30 Hz')
// Gaps outside (4, 40) ms are not cadence.
assert.equal(run([...fill(5, 200), ...fill(30, 16.7)]), 60)
console.log('display-rate ok')
