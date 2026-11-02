// The splash's loading line (src/intro/splash.ts SmoothLine): an expected-duration model with eased speed; monotone, bounded lead over raw, never stalls, eased finish.
// The module imports a stylesheet, so the test reads the class out of the source instead of importing it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync('src/intro/splash.ts', 'utf8')
assert.match(src, /splash-title">The Moon in 3D<\/h1>/, 'the splash names the Moon in 3D')
assert.match(src, /textContent = 'High-resolution craters, ridges, and lunar oceans in 3D'/, 'the splash has one sentence of subtext')
assert.doesNotMatch(src, /PRODUCT_NAME|Real terrain · Real Sun/, 'the splash does not use the product name or old tagline')
const m = /export class SmoothLine \{[\s\S]*?\n\}\n/.exec(src)
assert.ok(m, 'SmoothLine is exported from splash.ts')
const js = m[0].replace('export class', 'class').replace(/private readonly reduced = false/, 'reduced = false').replace(/private /g, '')
  .replace(/constructor\(reduced = false\) \{\}/, 'constructor(reduced = false) { this.reduced = reduced }').replace(/\bshown = 0\b/, 'shown = 0').replace(/: number|: void/g, '')
const ts = await import('typescript').catch(() => null)
const code = ts ? ts.default.transpileModule(m[0].replace('export class', 'class') + '\nexport { SmoothLine }', { compilerOptions: { target: 99, module: 99, useDefineForClassFields: false } }).outputText : js
const { SmoothLine } = await import('data:text/javascript,' + encodeURIComponent(code)) as { SmoothLine: new (r?: boolean) => { shown: number; setTarget(f: number): void; finish(): void; step(dt: number): number } }

const FRAME = 1 / 60
type Line = InstanceType<typeof SmoothLine>
/** Runs a stepwise raw input (irregular frame times) and returns the per-frame trace. */
function run(l: Line, steps: [number, number][], seconds: number, frame: (i: number) => number = () => FRAME): { t: number; raw: number; v: number }[] {
  const out: { t: number; raw: number; v: number }[] = []
  let t = 0, raw = 0, k = 0
  for (let i = 0; t < seconds; i++) {
    while (k < steps.length && steps[k][0] <= t) { raw = steps[k][1]; l.setTarget(raw); k++ }
    const dt = frame(i)
    t += dt
    out.push({ t, raw, v: l.step(dt) })
  }
  return out
}
const STEPS: [number, number][] = [[0.4, 0], [1.1, 0.2], [2.3, 0.2], [3.7, 0.6], [5.2, 0.6], [6.4, 0.9]]
const jitter = (i: number): number => FRAME * (0.6 + ((i * 7919) % 13) / 13 * 1.1)

// Monotone, within [0, 1], never more than the lead ahead of raw, never a jump, speed changes bounded, never stuck.
for (const frame of [() => FRAME, jitter]) {
  const l = new SmoothLine()
  const tr = run(l, STEPS, 9, frame)
  let prev = 0, prevV = 0, maxDv = 0, maxStep = 0, ahead = 0
  for (let i = 0; i < tr.length; i++) {
    const { t, raw, v } = tr[i]
    assert.ok(v >= prev && v <= 1, `monotone at ${t}`)
    const dt = i ? t - tr[i - 1].t : FRAME
    const vel = (v - prev) / dt
    if (i > 1) maxDv = Math.max(maxDv, Math.abs(vel - prevV) / dt)
    maxStep = Math.max(maxStep, v - prev)
    ahead = Math.max(ahead, v - raw)
    prev = v; prevV = vel
    // After the first second the line is always moving (never stalls) until it nears its ceiling.
    if (t > 1 && t < 8 && v < 0.9) assert.ok(vel > 0.001, `moving at ${t.toFixed(2)} (${vel})`)
  }
  assert.ok(ahead <= 0.15 + 0.02, `never far ahead of raw (${ahead})`)
  assert.ok(maxStep < 0.012, `no jumps (${maxStep})`)
  assert.ok(maxDv < 1.2, `speed changes smoothly (${maxDv} per s^2)`)
  assert.ok(prev < 0.99, 'stays short of the end until finish')
}
// Reaches 1 within the finish window after raw = 1, without a jump, monotone, velocity continuous.
{
  const l = new SmoothLine()
  const tr = run(l, STEPS, 7)
  const before = tr[tr.length - 1].v
  l.finish()
  let prev = before, prevV = (before - tr[tr.length - 2].v) / FRAME, n = 0, maxDv = 0
  while (prev < 1 && n < 60) {
    const v = l.step(FRAME); n++
    assert.ok(v >= prev, 'monotone in the finish')
    const vel = (v - prev) / FRAME
    maxDv = Math.max(maxDv, Math.abs(vel - prevV) / FRAME)
    prev = v; prevV = vel
  }
  assert.equal(l.shown, 1)
  assert.ok(n * FRAME <= 0.45, `finish takes at most 450 ms (${n} frames)`)
  assert.ok(n * FRAME >= 0.3, `finish is an ease, not a snap (${n} frames)`)
  assert.ok(maxDv < 12, `finish speed is continuous (${maxDv})`)
}
// A finish straight from the start, and a huge dt, still end at 1 without going back.
{
  const l = new SmoothLine()
  l.step(0.5); l.finish()
  let prev = l.shown
  for (let i = 0; i < 40; i++) { const v = l.step(i % 5 === 0 ? 0.3 : FRAME); assert.ok(v >= prev); prev = v }
  assert.equal(l.shown, 1)
}
// Raw ahead of the model pulls the line along (it catches up), but still not past 98.5 % before finish.
{
  const l = new SmoothLine()
  const tr = run(l, [[0, 1]], 12)
  assert.ok(tr[tr.length - 1].v > 0.9 && tr[tr.length - 1].v <= 0.985, `catches up (${tr[tr.length - 1].v})`)
}
// Reduced motion: linear, still monotone.
{
  const l = new SmoothLine(true)
  l.setTarget(1)
  const a = l.step(0.1), b = l.step(0.1)
  assert.ok(Math.abs((b - a) - a) < 1e-9, 'constant speed')
}

// LineAnimator: the compositor glides between model updates.
const am = /export class LineAnimator \{[\s\S]*?\n\}\n/.exec(src)
assert.ok(am, 'LineAnimator is exported from splash.ts')
const both = ts!.default.transpileModule(m[0].replace('export class', 'class') + am[0].replace('export class', 'class') + '\nexport { SmoothLine, LineAnimator }', { compilerOptions: { target: 99, module: 99, useDefineForClassFields: false } }).outputText
const { LineAnimator } = await import('data:text/javascript,' + encodeURIComponent(both)) as { LineAnimator: new (l: Line, b: unknown, g: unknown, now: () => number, drawn: () => number) => { frame(dt: number): void; finish(): void } }
interface Rec { from: number; to: number; duration: number; easing: string; at: number }
{
  let clock = 0
  const recs: Rec[] = [], glows: Rec[] = []
  const fake = (out: Rec[]) => ({ animate(kf: { transform: string }[], o: { duration: number; easing: string }) {
    const n = (x: string): number => Number(/\((-?[\d.]+(?:e-?\d+)?)/.exec(x)![1])
    out.push({ from: n(kf[0].transform), to: n(kf[1].transform), duration: o.duration, easing: o.easing, at: clock })
    return { cancel() { /* fake */ } }
  } })
  const line = new SmoothLine()
  // The drawn value follows the last glide, but at half speed during the stall (3.0 to 3.3 s), so it lags the target.
  let drawnV = 0, drawnAt = 0
  const drawn = (): number => {
    const r = recs[recs.length - 1]
    if (!r) return 0
    const stall = r.at >= 2900 && r.at < 3300
    const u = Math.min(1, (clock - r.at) / r.duration * (stall ? 0.5 : 1))
    drawnV = r.from + (r.to - r.from) * u; drawnAt = clock
    return drawnV
  }
  const a = new LineAnimator(line, fake(recs), fake(glows), () => clock, drawn)
  let maxAhead = 0
  let lagged = 0
  const frame = (ms: number): void => {
    clock += ms
    const n0 = recs.length, d = drawn(), lastTo = recs.length ? recs[recs.length - 1].to : 0
    a.frame(ms / 1000)
    if (recs.length > n0) {
      const r = recs[recs.length - 1]
      assert.ok(Math.abs(r.from - d) < 1e-9, `a glide starts at the drawn value (${r.from} vs ${d})`)
      assert.ok((r.to - r.from) / 0.4 <= 0.6 + 1e-9, `glide speed capped (${(r.to - r.from) / 0.4})`)
      if (d < lastTo - 0.02) lagged++
    }
  }
  for (let i = 0; i < 700; i++) {
    const sec = clock / 1000
    line.setTarget(sec < 1 ? 0 : sec < 2.5 ? 0.2 : sec < 4 ? 0.6 : 0.9)
    // A 300 ms main-thread stall at 3 s: no updates for 300 ms.
    frame(i === 180 ? 300 : 16.7)
  }
  assert.ok(lagged > 0, 'the stall left the drawn value behind the last target')
  assert.ok(recs.length > 20 && recs.length === glows.length, 'a glide every ~200 ms for bar and glow')
  let prevTo = 0, prevFrom = 0
  for (const r of recs) {
    assert.ok(r.to >= r.from - 1e-9 && r.from >= prevFrom - 1e-9 && r.from <= prevTo + 1e-9, `starts where the last glide had got to ${JSON.stringify([r, prevFrom, prevTo])}`)
    prevFrom = r.from
    assert.ok(r.to >= prevTo - 1e-9, `targets monotone (${r.to} < ${prevTo})`)
    prevTo = r.to
    assert.equal(r.easing, 'linear'); assert.equal(r.duration, 400)
    assert.ok(r.to <= 0.985 + 1e-9)
    maxAhead = Math.max(maxAhead, r.to)
  }
  // Lead: a target is at most the lead (plus what 400 ms of speed adds) ahead of the raw at its start.
  for (const r of recs) {
    const sec = r.at / 1000
    const rawAt = sec < 1 ? 0 : sec < 2.5 ? 0.2 : sec < 4 ? 0.6 : 0.9
    assert.ok(r.to <= rawAt + 0.15 + 0.06, `target within the lead of raw (${r.to} vs ${rawAt} at ${sec})`)
  }
  // Across the stall the last animation still ends ahead of where it began.
  const stalled = recs.filter((r) => r.at >= 2900 && r.at <= 3400)
  assert.ok(stalled.length > 0 && stalled.every((r) => r.to >= r.from), 'ends ahead across a stall')
  const lastBefore = recs.filter((r) => r.at < 3000).pop()!
  assert.ok(recs.some((r) => r.at > 2900 && r.at < 3400) && clock > 3300, 'the stall is in the run')
  assert.ok(lastBefore.to > lastBefore.from, 'the glide running into the stall has somewhere to go')
  a.finish()
  const f = recs[recs.length - 1]
  assert.equal(f.to, 1); assert.ok(f.from <= 1 && f.from >= prevFrom)
  void drawnAt; assert.equal(f.duration, 400); assert.ok(f.easing.startsWith('cubic-bezier'))
  const n = recs.length
  frame(16.7); frame(300)
  assert.equal(recs.length, n, 'no glides after the finish')
}
console.log('splash-line.test: ok')
