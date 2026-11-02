import assert from 'node:assert/strict'
import test from 'node:test'
import { FrameGate, frameCapFps } from '../src/quality/frameCap.ts'

test('class to cap', () => {
  for (const c of ['ios', 'ipad', 'phone-android', 'tablet'] as const) assert.equal(frameCapFps(c, ''), 60, c)
  for (const c of ['desktop', 'software'] as const) assert.equal(frameCapFps(c, ''), 0, c)
})

test('?fps override', () => {
  assert.equal(frameCapFps('ios', '?fps=0'), 0)
  assert.equal(frameCapFps('tablet', '?fps=30'), 30)
  assert.equal(frameCapFps('desktop', '?fps=60'), 60)
  assert.equal(frameCapFps('phone-android', '?fps=abc'), 60)
  assert.equal(frameCapFps('phone-android', '?fps=5'), 60)
  assert.equal(frameCapFps('desktop', '?fps=1000'), 0)
  assert.equal(frameCapFps('desktop', '?fps='), 0)
})

const run = (hz: number, fps: number, ms: number, jitter = 0): number[] => {
  const g = new FrameGate(fps), out: number[] = []
  let seed = 1
  for (let i = 0; i * (1000 / hz) < ms; i++) {
    seed = (seed * 16807) % 2147483647
    const t = i * (1000 / hz) + ((seed / 2147483647) - 0.5) * 2 * jitter
    if (g.shouldRun(t)) out.push(t)
  }
  return out
}

test('120 Hz panel is halved with no drift over 10 s', () => {
  const r = run(120, 60, 10000)
  assert.ok(Math.abs(r.length - 600) <= 1, String(r.length))
  for (let i = 1; i < r.length; i++) assert.ok(Math.abs(r[i] - r[i - 1] - 1000 / 60) < 0.5)
})

test('60 Hz panel with jitter is never skipped', () => {
  const r = run(60, 60, 10000, 2)
  assert.equal(r.length, 600)
})

test('no cap admits everything', () => {
  assert.equal(run(120, 0, 1000).length, 120)
})

test('a stall re-anchors instead of bursting', () => {
  const g = new FrameGate(60)
  assert.ok(g.shouldRun(0))
  assert.ok(g.shouldRun(500)) // after a long stall
  assert.ok(!g.shouldRun(508.3)) // next 120 Hz tick is early
  assert.ok(g.shouldRun(516.7))
})

test('90 Hz panel stays at or under the cap', () => {
  const r = run(90, 60, 10000)
  assert.ok(r.length <= 601 && r.length >= 440, String(r.length))
})

test('an urgent tick (press, touch, key) runs at once and restarts the grid', () => {
  const g = new FrameGate(60)
  assert.ok(g.shouldRun(0))
  assert.ok(!g.shouldRun(4), 'an ordinary early tick is held')
  assert.ok(g.shouldRun(4, true), 'a gesture first frame is not held to the next grid point')
  assert.ok(!g.shouldRun(8.3), 'the grid restarted from the urgent frame: 120 Hz half tick skipped')
  assert.ok(g.shouldRun(20.7), 'a period after the urgent frame')
})

test('an urgent tick on an uncapped gate is a plain run', () => {
  assert.ok(new FrameGate(0).shouldRun(5, true))
})

test('composes with a slower cadence: a fade frame every 100 ms is never held by the 60 fps cap', () => {
  const g = new FrameGate(60)
  const ran: number[] = []
  for (let t = 0; t <= 1000; t += 100) if (g.shouldRun(t)) ran.push(t)
  assert.equal(ran.length, 11)
})
