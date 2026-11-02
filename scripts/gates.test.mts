/** The audit's G1 classifier on synthetic mean series: cuts pass, ramps pass, pumping fails. tsx scripts/gates.test.mts */
import assert from 'node:assert/strict'
import { g1, g2, g2b } from '../audit/gates.mts'
import type { Frame } from '../audit/lib.mts'

const DT = 0.125
function series(means: number[], over: (i: number) => Partial<Frame> = () => ({})): Frame[] {
  return means.map((mean, i) => ({ n: i, t: +(i * DT).toFixed(3), mean, p99: 200, black: 0, white: 0, diff: 1, diffWorld: 1, gray: new Uint8Array(240 * 150).fill(Math.round(mean)), file: '', dom: { pressed: '', hudLines: 0, cardVisible: false, sliderVisible: false, sliderP: 0 }, st: null, patch: false, cuts: 0, expo: null, ...over(i) } as unknown as Frame))
}
const flat = (n: number, v: number) => new Array(n).fill(v)

// A single step at a declared event followed by 2 s of stability: a cut, passes.
{
  const m = [...flat(12, 60), ...flat(24, 120)]
  assert.equal(g1('cut', series(m), [{ t: 1.4, name: 'click:x' }]).pass, true)
}
// The same step with no event anywhere near it: unexplained, fails.
assert.equal(g1('unexplained', series([...flat(12, 60), ...flat(24, 120)]), []).pass, false)
// A step at an event that does not hold (keeps moving 5% a frame): fails.
{
  const m = [...flat(12, 60), 120, 126, 132, 139, 146, 153, 160, 168, 176, 185]
  assert.equal(g1('no-hold', series(m), [{ t: 1.4, name: 'click:x' }]).pass, false)
}
// A slow monotone ramp (1 stop over 2 s = 0.5 stops/s) is a ramp, passes, with no event at all.
{
  const m = Array.from({ length: 40 }, (_, i) => 50 * Math.pow(2, Math.min(i, 16) / 16))
  assert.equal(g1('ramp', series(m), []).pass, true)
}
// Pumping a -> b -> a fails even inside an event window: the glitch of wave 1's time scenario (65 -> 78 -> 65).
{
  const m = [...flat(12, 65), 78, 65, ...flat(20, 65)]
  assert.equal(g1('pump', series(m), [{ t: 1.4, name: 'click:x' }]).pass, false)
  assert.equal(g1('pump2', series([...flat(12, 40), 120, 40, ...flat(10, 40)]), []).pass, false)
}
// A dark frame's noise (mean 3 -> 6) is under the 20 grey floor.
assert.equal(g1('dark', series([...flat(10, 3), ...flat(10, 6), ...flat(10, 3)]), []).pass, true)

// G2 / G2b: a grey wash without a clipped top is a flat wash (G2b), not a white-out (G2); a bright frame with a clipped top is a white-out.
{
  const wash = series(flat(4, 168), () => ({ p99: 210 }))
  assert.equal(g2('w', wash).pass, true)
  assert.equal(g2b('w', wash).pass, false)
  assert.equal(g2('w', series(flat(4, 168), () => ({ p99: 240 }))).pass, false)
  const picture = series(flat(4, 168), () => ({ p99: 210 })).map((f) => { for (let i = 0; i < f.gray.length; i++) f.gray[i] = i % 2 ? 250 : 90; return f })
  assert.equal(g2b('p', picture).pass, true)
}
// With the controller's white reported: a mean step over a still white is content (passes); the same step with the white moving fails.
{
  const m = [...flat(12, 120), ...flat(3, 55), ...flat(20, 60)]
  const still = series(m, () => ({ expo: { raw: 1, white: 1 } }))
  assert.equal(g1('content-unproven', still, []).pass, false, 'constant white cannot excuse a display jump')
  const moving = series(m, (i) => ({ expo: { raw: 1, white: i >= 12 ? 0.6 : 1 } }))
  assert.equal(g1('exposure', moving, []).pass, false)
  // The white pumping up and back inside a second with the frame mean nearly still still fails.
  const pump = series(flat(30, 80), (i) => ({ expo: { raw: 1, white: i === 10 || i === 11 ? 1.6 : 1 } }))
  assert.equal(g1('white-pump', pump, []).pass, false)
}
// A fly-in: the Moon fills the frame, the mean rises 30% a frame (>1.5 stops/s) for 8 frames while the white stands still. Content, passes.
{
  const m = [...flat(12, 40), ...Array.from({ length: 8 }, (_, i) => 40 * Math.pow(1.3, i + 1)), ...flat(20, 40 * Math.pow(1.3, 8))]
  assert.equal(g1('content-ramp', series(m, (i) => ({ expo: { raw: 1, white: 1 - 0.002 * i } })), []).pass, true)
  // The same ramp with the white swinging 0.5 stop a frame (4 stops/s) alongside is the controller, and fails.
  assert.equal(g1('fast-exposure', series(m, (i) => ({ expo: { raw: 1, white: i >= 12 && i < 20 ? Math.pow(2, -(i - 11) * 0.5) : 1 } })), []).pass, false)
  // A cut that settles over two frames under a still white (28 -> 33 -> 38) is content; a single jump is not.
  assert.equal(g1('settle', series([...flat(12, 20), 28, 33.5, 37.8, ...flat(20, 39.4)], () => ({ expo: { raw: 1, white: 1 } })), [{ t: 1.4, name: 'click:x' }]).pass, true)
  // Without a reported white it stays judged on pixels: fails.
  assert.equal(g1('no-expo', series(m), []).pass, false)
}
console.log('gates.test.mts: ok')
