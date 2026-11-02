// flight-pad: the pure stick maths (dead zone, curve, knob clamp, spring, tap), the rim angle, the first-open label count and the caption band.
import assert from 'node:assert/strict'
import { FIRST_OPEN_LABELS, PAD_LABELS, STICK_DEAD_ZONE, STICK_FULL_UNITS_PER_S, bandPx, labelsLeft, nextLabelCount, sideControlStep, springSettled, springStep, stickAngleDeg, stickKeyDeflection, stickKnob, stickMotion, stickRates, stickTapDirection } from '../src/ui/touchControlsLogic.ts'

// Dead zone: a resting thumb does nothing.
assert.deepEqual(stickRates(0, 0, 40), { x: 0, y: 0, magnitude: 0 })
assert.equal(stickRates(40 * STICK_DEAD_ZONE * 0.9, 0, 40).magnitude, 0)
// Full push reaches 1 on its axis. Right is +x, up (screen y negative) is +y.
const right = stickRates(40, 0, 40)
assert.ok(Math.abs(right.x - 1) < 1e-9 && Math.abs(right.y) < 1e-12)
const up = stickRates(0, -40, 40)
assert.ok(Math.abs(up.y - 1) < 1e-9 && Math.abs(up.x) < 1e-12)
assert.ok(stickRates(0, 40, 40).y < 0, 'down is negative')
assert.ok(stickRates(-40, 0, 40).x < 0, 'left is negative')
// Beyond the travel it saturates.
assert.ok(stickRates(400, 300, 40).magnitude <= 1 + 1e-9)
// Monotonic, and fine near the centre: a half push is well under half speed.
let prev = 0
for (let d = 0; d <= 40; d += 2) { const m = stickRates(d, 0, 40).magnitude; assert.ok(m >= prev - 1e-12); prev = m }
assert.ok(stickRates(20, 0, 40).magnitude < 0.4)
// Direction is preserved on a diagonal.
const diag = stickRates(20, -20, 40)
assert.ok(Math.abs(diag.x - diag.y) < 1e-9 && diag.x > 0)

// The knob stays inside the travel circle.
const k = stickKnob(300, 400, 50)
assert.ok(Math.abs(Math.hypot(k.x, k.y) - 50) < 1e-9)
assert.deepEqual(stickKnob(10, -5, 50), { x: 10, y: -5 })

// Spring: the knob returns to the centre and settles within about a second.
let p = 40
let v = 0
let t = 0
while (!springSettled(p, v) && t < 3) { const s = springStep(p, v, 1 / 60); p = s.pos; v = s.vel; t += 1 / 60 }
assert.ok(springSettled(p, v), 'the knob settles')
assert.ok(t < 1.2, 'within about a second')
// Nearly frame-rate independent: 30 fps and 120 fps land in the same place after 0.5 s.
const run = (dt: number): number => { let a = 40; let b = 0; for (let i = 0; i < Math.round(0.5 / dt); i++) { const s = springStep(a, b, dt); a = s.pos; b = s.vel } return a }
assert.ok(Math.abs(run(1 / 30) - run(1 / 120)) < 1.5)

// Motion per axis: sign conventions match the rocker halves, and a frame equals value * units * one frame step.
const fwd = stickMotion('move', 1, 0.1, 800, 30)
assert.ok(Math.abs(fwd.movePx - sideControlStep('forward', 800, 30).movePx * STICK_FULL_UNITS_PER_S * 0.1) < 1e-9)
assert.ok(stickMotion('move', -1, 0.05, 800, 30).movePx < 0, 'back flies backward')
// Pushing right yaws the view right: CameraRig.turnHeading positive (the compass heading grows), at every tilt (fly-camera.test.mts).
assert.ok(stickMotion('turn', 1, 0.05, 800, 30).rollDeg > 0, 'right yaws the view right (heading grows)')
assert.ok(stickMotion('turn', -1, 0.05, 800, 30).rollDeg < 0, 'left yaws the view left')
assert.ok(stickMotion('tilt', 1, 0.05, 800, 30).tiltPx > 0, 'up tilts toward the horizon')
assert.equal(stickMotion('tilt', 0, 0.05, 800, 30).tiltPx, 0)
assert.ok(Math.abs(stickMotion('move', 1, 5, 800, 30).movePx - stickMotion('move', 1, 0.1, 800, 30).movePx) < 1e-9, 'a long frame is capped')

// Taps: dominant axis, nothing in the dead centre.
assert.equal(stickTapDirection(1, 1, 40), null)
assert.deepEqual(stickTapDirection(0, -30, 40), { x: 0, y: 1 })
assert.deepEqual(stickTapDirection(0, 30, 40), { x: 0, y: -1 })
assert.deepEqual(stickTapDirection(-30, 5, 40), { x: -1, y: 0 })
assert.deepEqual(stickKeyDeflection(new Set(['ArrowUp', 'ArrowRight'])), { x: 1, y: 1 })
assert.deepEqual(stickKeyDeflection(new Set(['ArrowLeft', 'ArrowRight'])), { x: 0, y: 0 })

// The rim arc points the way the stick is pushed: degrees clockwise from straight up.
assert.equal(stickAngleDeg(0, 0), 0)
assert.equal(stickAngleDeg(0, -10), 0)
assert.equal(stickAngleDeg(10, 0), 90)
assert.equal(stickAngleDeg(0, 10), 180)
assert.equal(stickAngleDeg(-10, 0), -90)

// First three opens name the capsules; the count is stored as text.
assert.equal(labelsLeft(null), true)
assert.equal(labelsLeft('2'), true)
assert.equal(labelsLeft(String(FIRST_OPEN_LABELS)), false)
assert.equal(labelsLeft('junk'), true, 'a damaged count starts over')
assert.equal(nextLabelCount(null), '1')
assert.equal(nextLabelCount('2'), '3')
assert.equal(nextLabelCount('junk'), '1')

// The caption band the pad clears: height plus the 8 px gap, nothing when hidden or not laid out.
assert.equal(bandPx(30, false), 38)
assert.equal(bandPx(30.2, false), 39)
assert.equal(bandPx(30, true), 0)
assert.equal(bandPx(0, false), 0)

// One pad, one set of names: no Turn rocker, no Look / Move sticks, tilt says what it does.
assert.deepEqual(Object.keys(PAD_LABELS).filter((k) => /look|move|stickLook|stickMove/i.test(k)), [])
console.log('flight-pad: ok')
