/** The terminator's geometry (src/labels/terminator.ts) against the rig's own pose basis. tsx scripts/terminator.test.mts */
import assert from 'node:assert/strict'
import { lonLatOf, terminatorCircle, terminatorPoint, terminatorView, unitOf, type V3 } from '../src/labels/terminator.ts'
import { poseBasis } from '../src/camera/pose.ts'
import { ephemerisAt } from '../src/ephemeris.ts'

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sun = unitOf(40, 1.2)
for (const p of terminatorCircle(sun, 36)) assert.ok(Math.abs(dot(p, sun)) < 1e-9, 'every circle point is on the day-night line')
const view = unitOf(-10, 20)
const tp = terminatorPoint(sun, view)
assert.ok(Math.abs(dot(tp, sun)) < 1e-9, 'the nearest point is on the line')
for (const p of terminatorCircle(sun, 360)) assert.ok(dot(p, view) <= dot(tp, view) + 1e-9, 'and no point of the line is nearer the view')
assert.ok(Math.abs(dot(terminatorPoint(sun, sun), sun)) < 1e-9, 'looking straight at the Sun still gives a point on the line')

// The view: over the sunlit side, the frame's forward (up) pointing across the line toward the night.
const e = ephemerisAt(new Date('2026-10-20T19:00:00Z'))
const pose = terminatorView(sun, tp, 1.09)
const cam = unitOf(pose.lon, pose.lat)
assert.ok(dot(cam, sun) > 0, 'the camera is over the lit side')
assert.ok(dot(cam, sun) < 0.2, 'and close to the line')
const b = poseBasis(e, { ...pose, pitch: 0 })
// poseBasis is in world vectors: bring the frame's up back into the Moon frame.
const up: V3 = [b.up.dot(e.moonX), b.up.dot(e.moonY), b.up.dot(e.moonZ)]
assert.ok(dot(up, sun) < -0.9, `the top of the frame points away from the Sun, across the line (${dot(up, sun)})`)
const ll = lonLatOf(tp)
assert.ok(Number.isFinite(ll.lon) && Number.isFinite(ll.lat))
console.log('terminator.test ok')
