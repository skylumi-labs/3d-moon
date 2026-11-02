import assert from 'node:assert/strict'
import { type FlightScaleSample, FlightScaleController, FlightScaleLadder, parseFlightScaleMode, FLIGHT_SCALE_WINDOW, flightFrameCostMs } from '../src/quality/flightScale.ts'

const scale = new FlightScaleController(0.7)
for (let i = 0; i < FLIGHT_SCALE_WINDOW - 1; i++) assert.equal(scale.update(16, 0.35), 0.7)
assert.equal(scale.update(16, 0.35), 1, 'a full calm window restores full render scale')

for (let i = 0; i < 6; i++) scale.update(32, 0.35)
assert.equal(scale.current, 0.7, 'over-budget flight frames step the scale down')
for (let i = 0; i < 6; i++) scale.update(32, 0.35)
assert.equal(scale.current, 0.5, 'each rung is evaluated from its own recent frames')
for (let i = 0; i < 6; i++) scale.update(32, 0.35)
assert.equal(scale.current, 0.35, 'the configured device floor is reached')
for (let i = 0; i < 60; i++) scale.update(32, 0.35)
assert.equal(scale.current, 0.35, 'the configured device floor is never crossed')

const warm = new FlightScaleController(0.5)
for (let i = 0; i < 59; i++) warm.update(12, 0.35)
assert.equal(warm.current, 0.5, 'fewer than 60 samples do not raise quality')
warm.update(12, 0.35)
assert.equal(warm.current, 0.7, 'quality climbs one ladder step at a time')

const held = new FlightScaleController(0.7)
for (let i = 0; i < FLIGHT_SCALE_WINDOW; i++) held.update(flightFrameCostMs(40, 8), 0.35)
assert.equal(held.current, 0.35, 'held presentation intervals keep the scale from climbing on cheap rAF/GPU samples')
assert.equal(flightFrameCostMs(16, 31), 31, 'the measured GPU cost wins when it exceeds the presented-frame interval')
// ?flightscale=hyst (FlightScaleLadder): GPU-time judging, 3-of-8, dwell, step cap, emergency.
function GPU(gpu: number, wall = 16): FlightScaleSample { return { wallMs: wall, gpuMs: gpu, fenceMs: null, hasGpuSource: true } }
{
  const old = new FlightScaleLadder(0.7, parseFlightScaleMode(null))
  assert.equal(old.mode, 'old', 'the default is the old controller')
  for (let i = 0; i < 6; i++) old.update(GPU(8, 40), 0.35, i * 16)
  assert.equal(old.current, 0.5, 'old mode still reads the wall interval (a JS spike steps down)')
  assert.equal(old.steps, 1)
}
assert.equal(parseFlightScaleMode('hyst'), 'hyst')
{
  const l = new FlightScaleLadder(0.7, 'hyst')
  const clock = { t: 0 }
  const tick = (ms: number): number => (clock.t += ms)
  for (let i = 0; i < 40; i++) l.update(GPU(8, i % 4 === 0 ? 60 : 16), 0.35, tick(16))
  assert.equal(l.current, 0.7, 'JS spikes in the rAF interval with a cheap GPU never step down')
  assert.equal(l.steps, 0)
  l.update(GPU(40), 0.35, tick(16)); l.update(GPU(8), 0.35, tick(16)); l.update(GPU(40), 0.35, tick(16))
  for (let i = 0; i < 3; i++) l.update(GPU(8), 0.35, tick(16))
  assert.equal(l.current, 0.7, 'two over-budget frames in eight do not step')
  l.update(GPU(40), 0.35, tick(16))
  assert.equal(l.current, 0.5, 'three over-budget frames in the last eight step down one rung')
  assert.equal(l.steps, 1)
  for (let i = 0; i < 8; i++) l.update(GPU(40), 0.35, tick(16))
  assert.equal(l.current, 0.5, 'a second step waits for the 1.5 s dwell')
  tick(1500)
  l.update(GPU(40), 0.35, clock.t)
  assert.equal(l.current, 0.5, 'the window was cleared by the first step: one frame is not enough')
  for (let i = 0; i < 3; i++) l.update(GPU(40), 0.35, tick(16))
  assert.equal(l.current, 0.35, 'after the dwell three more over-budget frames step again')
}
{
  const l = new FlightScaleLadder(0.35, 'hyst')
  const clock = { t: 0 }
  const tick = (ms: number): number => (clock.t += ms)
  for (let i = 0; i < FLIGHT_SCALE_WINDOW - 1; i++) l.update(GPU(8), 0.35, tick(16))
  assert.equal(l.current, 0.35, 'fewer than 60 calm samples do not raise quality')
  l.update(GPU(8), 0.35, tick(16))
  assert.equal(l.current, 0.5, 'a calm window raises quality one rung (dwell is satisfied at the start of a flight)')
  for (let i = 0; i < FLIGHT_SCALE_WINDOW; i++) l.update(GPU(8), 0.35, tick(16))
  assert.equal(l.current, 0.5, 'calm frames inside the dwell do not count and do not climb again (60 frames at 16 ms is under 1.5 s)')
  tick(1500)
  for (let i = 0; i < FLIGHT_SCALE_WINDOW - 1; i++) l.update(GPU(8), 0.35, tick(16))
  assert.equal(l.current, 0.5, 'the window after the dwell must be full')
  l.update(GPU(8), 0.35, tick(16))
  assert.equal(l.current, 0.7, 'once the dwell has passed a full calm window climbs')
}
{
  // Sustained wall miss: the GPU is cheap but presentation is slow for many frames (pacing, compositor): that does count.
  const l = new FlightScaleLadder(0.7, 'hyst')
  const clock = { t: 0 }
  const tick = (ms: number): number => (clock.t += ms)
  for (let i = 0; i < 12; i++) l.update(GPU(6, 45), 0.35, tick(45))
  assert.equal(l.current, 0.5, 'a wall interval far above the GPU cost for several frames in a row steps down')
}
{
  // No GPU source at all: the wall interval is all there is, still with 3-of-8 and a dwell.
  const l = new FlightScaleLadder(0.7, 'hyst')
  const clock = { t: 0 }
  const tick = (ms: number): number => (clock.t += ms)
  const wall = (ms: number): FlightScaleSample => { return { wallMs: ms, gpuMs: null, fenceMs: null, hasGpuSource: false } }
  l.update(wall(40), 0.35, tick(40)); assert.equal(l.current, 0.7, 'one slow frame does not step')
  l.update(wall(40), 0.35, tick(40)); l.update(wall(40), 0.35, tick(40))
  assert.equal(l.current, 0.5)
}
{
  // Step cap: 6 per flight, then it holds; reset starts a new flight.
  const l = new FlightScaleLadder(1, 'hyst')
  const clock = { t: 0 }
  const tick = (ms: number): number => (clock.t += ms)
  for (let n = 0; n < 40; n++) {
    tick(2000); for (let i = 0; i < 3; i++) l.update(GPU(40), 0.35, tick(16))
    tick(2000); for (let i = 0; i < 60; i++) l.update(GPU(8), 0.35, tick(16))
  }
  assert.ok(l.steps <= 6, `at most 6 scale changes per flight, got ${l.steps}`)
  const capped = l.current
  tick(5000)
  for (let i = 0; i < 20; i++) l.update(GPU(40), 0.35, tick(16))
  assert.equal(l.current, capped, 'at the cap the scale holds')
  l.reset()
  assert.equal(l.steps, 0, 'a new flight resets the count')
  assert.ok(l.totalSteps >= 6, 'the page total survives the reset')
}
{
  // Emergency: a GPU source at more than twice the budget steps down on 6 frames, ignoring the dwell.
  const l = new FlightScaleLadder(0.7, 'hyst')
  const clock = { t: 0 }
  const tick = (ms: number): number => (clock.t += ms)
  for (let i = 0; i < 3; i++) l.update(GPU(40), 0.35, tick(16))
  assert.equal(l.current, 0.5)
  for (let i = 0; i < 6; i++) l.update(GPU(80), 0.35, tick(16))
  assert.equal(l.current, 0.35, 'a phone-class GPU reading steps down again inside the dwell')
}
function STALE(): FlightScaleSample { return { wallMs: 16, gpuMs: null, fenceMs: null, hasGpuSource: true } }
{
  // Frames without a fresh GPU reading are no evidence: one slow reading must not fill the 3-of-8 ring.
  const l = new FlightScaleLadder(0.7, 'hyst')
  const clock = { t: 0 }
  const tick = (ms: number): number => (clock.t += ms)
  l.update(GPU(40), 0.35, tick(16))
  for (let i = 0; i < 7; i++) l.update(STALE(), 0.35, tick(16))
  assert.equal(l.current, 0.7, 'one slow reading followed by frames without a reading does not step')
}
{
  // The emergency counts fresh readings only: gaps between them do not reset it.
  const l = new FlightScaleLadder(0.7, 'hyst')
  const clock = { t: 0 }
  const tick = (ms: number): number => (clock.t += ms)
  for (let i = 0; i < 3; i++) l.update(GPU(40), 0.35, tick(16))
  assert.equal(l.current, 0.5)
  for (let i = 0; i < 6; i++) { l.update(GPU(80), 0.35, tick(16)); l.update(STALE(), 0.35, tick(16)) }
  assert.equal(l.current, 0.35, 'six fresh readings over 2x budget step down even with gaps between them')
}
{
  const l = new FlightScaleLadder(0.7, 'hyst')
  for (let i = 0; i < 20; i++) l.update(GPU(80), 0.7, i * 16)
  assert.equal(l.current, 0.7, 'the device floor is never crossed')
}
console.log('flight scale: ok')
