/** Render rate vs capture rate: a slow screenshot loop must not fabricate a jump, a freeze or a missing response (L4 run 2026-10-02). */
import assert from 'node:assert/strict'
import { g1, g3 } from '../audit/gates.mts'
import { renderCadence, motionTimes, type DenseSeries } from '../audit/render.mts'
import { aggregate } from '../audit/verdict.mts'
import type { Frame } from '../audit/lib.mts'

function frames(ts: number[], means: number[], over: (i: number) => Partial<Frame> = () => ({})): Frame[] {
  return ts.map((t, i) => ({ n: i, t, mean: means[i], p99: 200, black: 0, white: 0, diff: 1, diffWorld: 1, gray: new Uint8Array(240 * 150).fill(Math.round(means[i])), file: '', dom: { pressed: '', hudLines: 0, cardVisible: false, sliderVisible: false, sliderP: 0, progress: null }, st: null, patch: false, cuts: 0, expo: null, ...over(i) } as unknown as Frame))
}
const dense = (t: number[], o: Partial<DenseSeries> = {}): DenseSeries => ({ t, frames: t.map((_, i) => i), white: t.map(() => 1), cam: t.map(() => 0), slider: t.map(() => 0), jkey: t.map(() => 0), cuts: t.map(() => 0), held: [], ...o })
const grid = (a: number, b: number, dt: number): number[] => { const o: number[] = []; for (let t = a; t <= b + 1e-9; t += dt) o.push(+t.toFixed(4)); return o }

// 1. Render cadence comes from the in-page rAF series, and the capture holds are not charged to it.
{
  const t = grid(0, 10, 1 / 60)
  const c = renderCadence(dense(t))
  assert.ok(c.fps > 58 && c.fps < 62, `60 fps page measured ${c.fps}`)
  assert.ok(c.maxGapS < 0.03)
  // The same page held for 0.9 s out of every 1 s by the capture loop: no samples inside a hold. The hold is not the page's frame rate.
  const held: Array<[number, number]> = []
  for (let s = 0; s < 10; s++) held.push([s + 0.1, s + 1.0])
  const sampled = t.filter((x) => !held.some(([a, b]) => x > a && x < b))
  const c2 = renderCadence(dense(sampled, { held }))
  assert.ok(c2.fps > 50, `held windows were charged to the render rate: ${c2.fps}`)
  assert.ok(c2.maxGapS < 0.05, `hold counted as a gap: ${c2.maxGapS}`)
  // A genuinely slow page (one rAF per second, nothing held) is slow.
  const slow = renderCadence(dense(grid(0, 10, 1)))
  assert.ok(slow.fps < 1.1 && slow.maxGapS >= 1)
  assert.equal(renderCadence(dense([])).fps, 0)
}

// 2. G1: a mean step that falls inside a capture gap cannot be judged: not a violation, and not a pass either.
{
  const t = [...grid(0, 4, 0.125), 5.6, 7.2, 8.8, 10.4]
  const m = [...grid(0, 4, 0.125).map(() => 60), 140, 140, 140, 140]
  const r = g1('sparse', frames(t, m), [])
  assert.notEqual(r.pass, false, 'a step across a 1.6 s capture gap was reported as a violation: ' + r.detail)
  assert.equal(r.pass, null)
  assert.match(r.detail, /unobservable/i)
  // The same step between two adjacent 8 fps frames is still caught.
  const dt = grid(0, 5, 0.125)
  const r2 = g1('dense', frames(dt, dt.map((x) => (x < 2.5 ? 60 : 140))), [])
  assert.equal(r2.pass, false)
}
// 3. G1 on the page's own white at render rate: a pump the capture loop would miss is found, a ramp it would misread is not.
{
  const t = grid(0, 6, 1 / 60)
  const capT = grid(0, 6, 1.5), capM = capT.map(() => 80)
  const pump = dense(t, { white: t.map((x) => (x > 3 && x < 3.2 ? 4 : 1)) })
  const r = g1('white-pump', frames(capT, capM, () => ({ expo: { raw: 1, white: 1 } })), [], pump)
  assert.equal(r.pass, false)
  assert.match(r.detail, /white/)
  const ramp = dense(t, { white: t.map((x) => Math.pow(2, x / 6)) })
  assert.notEqual(g1('white-ramp', frames(capT, capM), [], ramp).pass, false)
}
// 4. G3: a click's response is read from render-rate samples. Slow capture frames in the window are not a missing response.
{
  const capT = [0.5, 2.1, 3.7, 5.3], capM = [80, 80, 80, 80]
  const slowCap = frames(capT, capM, (i) => ({ diffWorld: i === 1 ? 9 : 0 }))
  const marks = [{ t: 1.0, name: 'click:x' }]
  // Old behaviour: no frame in [1.0, 2.0], and the next one lands at 2.1 s (> 1.0 + 1.0 but < 1.0 + 2.5) so it passed only by the 2.5 s allowance; with 3.7 as first-after it fails.
  const lateCap = frames([0.5, 3.7, 5.3], [80, 80, 80], () => ({ diffWorld: 0 }))
  assert.equal(g3('old', lateCap, marks, true).pass === false, false, 'a click with no capture frame in its window failed as "no response"')
  // Dense: the camera moved 0.2 s after the click -> responds.
  const t = grid(0, 6, 1 / 30)
  const moved = dense(t, { cam: t.map((x) => (x >= 1.2 ? 1 + (x - 1.2) : 0)) })
  assert.equal(g3('moved', slowCap, marks, true, moved).pass, true)
  // Dense: nothing changes for 3 s after the click, samples present throughout -> a real miss.
  const still = dense(t)
  const miss = g3('still', slowCap, marks, true, still)
  assert.equal(miss.pass, false)
  assert.match(miss.detail, /no motion/)
  // Dense: a journey generation change is a response too (a chip that starts a load shows nothing yet).
  const started = dense(t, { jkey: t.map((x) => (x >= 1.3 ? 8 : 0)) })
  assert.equal(g3('journey', slowCap, marks, true, started).pass, true)
  // Dense samples exist but all fall in held windows around the click: unobservable, never a fabricated failure.
  const holes = dense(t.filter((x) => x < 0.9 || x > 2.4), { held: [[0.9, 2.4]] })
  const u = g3('holes', slowCap, marks, true, holes)
  assert.notEqual(u.pass, false)
}
// 5. motionTimes reports only real changes.
{
  const d = dense([0, 1, 2, 3], { cam: [0, 0, 5, 5], slider: [0, 0, 0, 0], jkey: [0, 0, 0, 1] })
  assert.deepEqual(motionTimes(d), [2, 3])
}
// 6. An unobservable result is not a pass: it fails the exit code.
assert.equal(aggregate([{ gate: 'G1', scenario: 'chips', pass: null, detail: 'unobservable: capture too sparse' }], ['chips'], ['chips']).exitCode, 1)
console.log('audit-cadence.test.mts: ok')
// 7. The audit's own freeze is not the page: a white that steps across a capture hold is not a pump or an over-speed white.
{
  const t = grid(0, 6, 1 / 60).filter((x) => x < 2.5 || x > 3.0)
  const d = dense(t, { white: t.map((x) => (x > 3 ? 4 : 1)), held: [[2.5, 3.0]] })
  assert.notEqual(g1('hold', frames(grid(0, 6, 1.5), grid(0, 6, 1.5).map(() => 80)), [], d).pass, false)
}
// 8. The page's own declared cut, seen at render rate, excuses the white step it declares (it sits between two sparse captured frames).
{
  const t = grid(0, 6, 1 / 60)
  const d = dense(t, { white: t.map((x) => (x > 3 ? 4 : 1)), cuts: t.map((x) => (x > 3 ? 1 : 0)) })
  assert.notEqual(g1('declared-cut', frames(grid(0, 6, 1.5), grid(0, 6, 1.5).map(() => 80)), [], d).pass, false)
  const undeclared = dense(t, { white: t.map((x) => (x > 3 ? 4 : 1)) })
  assert.equal(g1('undeclared', frames(grid(0, 6, 1.5), grid(0, 6, 1.5).map(() => 80)), [], undeclared).pass, false)
}
// 9. A ridge the viewer left paused at 7% is not a "frozen >= 3 s" stall.
{
  const t = [0, 1.6, 3.2, 4.8, 6.4]
  const paused = frames(t, t.map(() => 80), () => ({ diffWorld: 0, dom: { pressed: '', hudLines: 0, cardVisible: false, sliderVisible: true, sliderP: 0.07, progress: null } as never, journey: { generation: 1, id: 'lift-off', status: 'active', arrivalAt: null, ridge: true, playing: false } as never }))
  assert.equal(g3('paused-ridge', paused, [], false).pass, true)
  const loading = paused.map((f) => ({ ...f, journey: { ...f.journey!, ridge: false } }))
  assert.equal(g3('stalled-load', loading, [], false).pass, false)
}
console.log('audit-cadence (hold): ok')
