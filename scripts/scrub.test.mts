import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { SCRUB_GAP_MS, ScrubGate, coalescePerFrame } from '../src/scrub'
import { ephemerisAt, isWaxing } from '../src/ephemeris'
import { MoonPhase } from 'astronomy-engine'
import { searchFrame, setSearchReuseMs } from '../src/post/exposure'
import type { ViewCamera } from '../src/camera/pose'

// 1. Many input events in one frame make ONE apply, with the latest value; flush applies a pending value at once.
{
  const frames: Array<() => void> = []
  const seen: number[] = []
  const c = coalescePerFrame<number>((v) => seen.push(v), (cb) => frames.push(cb))
  for (let i = 0; i < 50; i++) c.push(i)
  assert.equal(frames.length, 1, 'one frame callback however many events')
  assert.deepEqual(seen, [], 'nothing applied before the frame')
  frames.shift()!()
  assert.deepEqual(seen, [49], 'the latest value, once')
  c.push(7); c.flush()
  assert.deepEqual(seen, [49, 7], 'flush applies now')
  frames.shift()!()
  assert.deepEqual(seen, [49, 7], 'the queued frame finds nothing left')
  assert.equal(c.pending, false)
}

// 2. The gate: an isolated change is a jump; changes closer than the gap are one scrub.
{
  const g = new ScrubGate()
  assert.equal(g.note(1000), false, 'first change is a jump')
  assert.equal(g.note(1000 + SCRUB_GAP_MS - 1), true)
  assert.equal(g.note(1000 + 2 * SCRUB_GAP_MS), false, 'after a pause it is a jump again')
  assert.equal(g.active(1000 + 2 * SCRUB_GAP_MS + 10), true)
  assert.equal(g.active(1000 + 4 * SCRUB_GAP_MS), false)
}

// 3. isWaxing agrees with astronomy-engine's MoonPhase over a lunation, away from the new and full Moon (a degree of slack there).
{
  let checked = 0
  const t0 = Date.parse('2026-01-01T00:00:00Z')
  for (let i = 0; i < 400; i++) {
    const d = new Date(t0 + i * 3.7 * 3600e3)
    const ph = MoonPhase(d)
    if (Math.min(ph, 360 - ph, Math.abs(ph - 180)) < 1) continue
    assert.equal(isWaxing(ephemerisAt(d)), ph < 180, `waxing at ${d.toISOString()} (phase ${ph.toFixed(2)})`)
    checked++
  }
  assert.ok(checked > 350)
}

// 4. The exposure search is reused for a scrub's frames (same camera, new Sun) within the window, and exact once it closes.
{
  const cam: ViewCamera = { pos: new Vector3(0, 0, 4), right: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0), back: new Vector3(0, 0, 1), tanHalf: 0.1 }
  let clock = 0
  const e1 = ephemerisAt(new Date('2026-10-18T12:00:00Z')), e2 = ephemerisAt(new Date('2026-10-18T12:20:00Z')), e3 = ephemerisAt(new Date('2026-10-18T18:00:00Z'))
  setSearchReuseMs(100, () => clock)
  const a = searchFrame(cam, 1.6, e1, null, 180)
  clock = 50
  assert.strictEqual(searchFrame(cam, 1.6, e2, null, 180), a, 'inside the window the previous search answers for the next time step')
  clock = 160
  const b = searchFrame(cam, 1.6, e3, null, 180)
  assert.notStrictEqual(b, a, 'past the window the search runs again')
  setSearchReuseMs(0)
  const exact = searchFrame(cam, 1.6, e2, null, 180)
  assert.notStrictEqual(exact, a, 'with the window closed the search is exact for the date asked')
}
console.log('scrub ok')
