import assert from 'node:assert/strict'
import { CaptureClock, captureFrameTimeMs } from '../src/cinematics/flights.ts'
import { assertCaptureNotCancelled, captureIsInitializing } from '../src/cinematics/captureSession.ts'
import fs from 'node:fs'

assert.equal(captureFrameTimeMs(0, 60), 0)
assert.equal(captureFrameTimeMs(60, 60), 1000)
assert.equal(captureFrameTimeMs(30, 30), 1000)
assert.throws(() => captureFrameTimeMs(-1, 60), RangeError)
const clock = new CaptureClock()
clock.begin(60)
assert.equal(clock.frameTimeMs(3), 50)
clock.end()
assert.equal(clock.active, false)
assert.throws(() => clock.frameTimeMs(4), /ended/)
const initializing = { ready: false, cancelled: false }
assert.equal(captureIsInitializing(initializing), true, 'a reserved but unready session pauses ordinary frame advancement')
assert.throws(() => assertCaptureNotCancelled({ ...initializing, cancelled: true }), /initialization was cancelled/)
assert.doesNotThrow(() => assertCaptureNotCancelled({ ready: true, cancelled: false }))
const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const beginAt = main.indexOf('async begin(opts: CaptureBegin)')
assert.ok(main.indexOf('captureSession = state', beginAt) < main.indexOf('await ensureTiles()', beginAt), 'capture ownership is reserved before resource initialization waits')
assert.ok(/assertCaptureNotCancelled\(state\)\s+if \(state\.tilesRequired/.test(main), 'cancellation is checked after tile initialization')
assert.ok(/if \(captureSession === state\) endCaptureState\(state\)/.test(main), 'initialization failure or cancellation restores session state')
console.log('capture-clock.test ok')
