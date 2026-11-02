import assert from 'node:assert/strict'
import { EXPOSURE_MOVING_MS, exposureReusable, exposureWindowMs } from '../src/post/motionGrid.ts'
import { FLIGHT_EXP_REUSE_MS, exposureViewMoveSmall, flightExposureWindowMs, parseFlightExposureMode, useCoarseFlightExposure } from '../src/post/flightExposure.ts'

assert.equal(parseFlightExposureMode(null), 'full', 'the default is today\'s full search')
assert.equal(parseFlightExposureMode('coarse'), 'coarse')
assert.equal(parseFlightExposureMode('nonsense'), 'full')

const on = { mode: 'coarse', flightLike: true, gestureOn: true, captureSession: false, cutFrames: 0, ownsExposure: false, groundMode: false, coarseGainOn: true } as const
assert.equal(useCoarseFlightExposure(on), true, 'a moving scripted flight in coarse mode uses the coarse search')
assert.equal(useCoarseFlightExposure({ ...on, mode: 'full' }), false, 'full mode never does')
assert.equal(useCoarseFlightExposure({ ...on, gestureOn: false }), false, 'a rest frame never does (the rest value is always the full search)')
assert.equal(useCoarseFlightExposure({ ...on, flightLike: false }), false, 'only scripted flights')
assert.equal(useCoarseFlightExposure({ ...on, captureSession: true }), false, 'a capture is exposed in full')
assert.equal(useCoarseFlightExposure({ ...on, cutFrames: 1 }), false, 'an exposure cut frame is exposed in full')
assert.equal(useCoarseFlightExposure({ ...on, ownsExposure: true }), false, 'the ridge keeps its own exposure')
assert.equal(useCoarseFlightExposure({ ...on, groundMode: true }), false, 'ground mode keeps its own exposure')
assert.equal(useCoarseFlightExposure({ ...on, coarseGainOn: false }), false, 'without the gain correction the coarse search is not used')

const view = (angle: number, alt = 1, tanHalf = 0.4) => ({ back: { x: Math.sin(angle), y: 0, z: Math.cos(angle) }, tanHalf, alt })
const base = view(0)
assert.equal(exposureViewMoveSmall(null, base), false, 'nothing to reuse')
assert.equal(exposureViewMoveSmall(base, view(0.05 * 0.4)), true, 'a turn under 0.15 of the half-field is a small move')
assert.equal(exposureViewMoveSmall(base, view(0.2 * 0.4)), false, 'a larger turn searches again')
assert.equal(exposureViewMoveSmall(base, view(0, 1.04)), true, 'under 5 % altitude change')
assert.equal(exposureViewMoveSmall(base, view(0, 1.06)), false, 'over 5 % altitude change')
assert.equal(exposureViewMoveSmall(base, view(0, 1, 0.41)), false, 'a zoom is not a small move')

assert.equal(flightExposureWindowMs(66, false, true), 66, 'full mode keeps the existing window')
assert.equal(flightExposureWindowMs(66, true, false), 66, 'a coarse flight that moved searches on the existing window')
assert.equal(flightExposureWindowMs(66, true, true), FLIGHT_EXP_REUSE_MS, 'a coarse flight that barely moved reuses for 250 ms')
assert.equal(flightExposureWindowMs(400, true, true), 400, 'never shorter than the existing window')

const frozen = { gestureOn: true, hasSearch: true, cutFrames: 0, ownsExposure: false, searchAt: 1000 }
assert.equal(exposureReusable({ ...frozen, now: 1200, windowMs: flightExposureWindowMs(exposureWindowMs(10, true), true, true) }), true, 'reused at 200 ms')
assert.equal(exposureReusable({ ...frozen, now: 1250, windowMs: flightExposureWindowMs(exposureWindowMs(10, true), true, true) }), false, 'searched again at 250 ms')
assert.equal(exposureReusable({ ...frozen, now: 1200, windowMs: flightExposureWindowMs(exposureWindowMs(10, true), true, false) }), false, 'a moving camera searches on the 66 ms window')
assert.equal(exposureReusable({ ...frozen, gestureOn: false, now: 1010, windowMs: FLIGHT_EXP_REUSE_MS }), false, 'never at rest')
assert.equal(EXPOSURE_MOVING_MS, 66)
console.log('flight-exposure.test.mts: ok')
