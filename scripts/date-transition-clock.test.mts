import assert from 'node:assert/strict'
import { RefinementClock, canDrawFinalOnly } from '../src/journey/dateTransition.ts'

const close = (actual: number, expected: number, message: string): void => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, got ${actual}`)

{
  const clock = new RefinementClock()
  clock.start(100, 600)
  close(clock.step(1100), (1000 / 30) / 600, 'a slow first frame advances by at most one 30Hz step')
  close(clock.step(1116), (1000 / 30 + 16) / 600, 'ordinary frame time advances after the slow first frame')
  assert.ok(clock.step(1116 + 600) < 1, 'a single later stall is also bounded')
}

{
  const clock = new RefinementClock()
  clock.start(0, 600)
  for (let i = 1; i <= 12; i++) clock.step(i * 16)
  assert.ok(clock.step(208) > 0.3, 'the first fade has progressed before interruption')
  clock.start(10_000, 300)
  close(clock.step(10_000), 0, 'restart clears interrupted progress')
  close(clock.step(10_050), (1000 / 30) / 300, 'restarted fade uses its new duration and caps a slow frame')
  let progress = 0
  for (let i = 2; i <= 10; i++) progress = clock.step(10_000 + i * 50)
  assert.equal(progress, 1, 'restarted fade completes over presented frames')
}

{
  assert.equal(canDrawFinalOnly(false, true, false, false, true), true, 'clean scene can advance its fade')
  assert.equal(canDrawFinalOnly(true, true, false, false, true), false, 'dirty camera must render a matching scene first')
  assert.equal(canDrawFinalOnly(true, true, true, false, true), false, 'frame-pacer hold cannot composite stale scene')
  assert.equal(canDrawFinalOnly(true, true, false, true, true), false, 'cadence hold cannot composite stale scene')
  assert.equal(canDrawFinalOnly(false, true, true, false, true), false, 'a held fade waits for the next draw opportunity')
  assert.equal(canDrawFinalOnly(false, true, false, false, false), false, 'no cached scene means no final-only draw')
}

console.log('date-transition-clock: bounded refinement, restart, and clean-scene-only compositing ok')

{
  const { dateChangeCrossfades } = await import('../src/journey/dateTransition.ts')
  assert.equal(dateChangeCrossfades(0, true), false, 'a moment start that moves the camera at once is cut, not ghosted')
  assert.equal(dateChangeCrossfades(0, false), true, 'a scrub or Time-sheet change keeps its blend')
  assert.equal(dateChangeCrossfades(300, true), true, 'a held journey fade (still camera) still runs')
  assert.equal(dateChangeCrossfades(0, true, true), true, '?datefade=1 restores the blend')
}
