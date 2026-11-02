/**
 * Home is the Moon as the sky shows it now: the camera on the Moon-to-Earth line, celestial north up, the real phase.
 *   npm test
 */
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { HOME_DIST, homePose, poseBasis } from '../src/camera/pose.ts'
import { ephemerisAt } from '../src/ephemeris.ts'

const DEG = Math.PI / 180
// Full, new, first quarter (a thin dark Moon is the hard case: Home must not nudge toward the Sun), and an ordinary date.
const dates = ['2026-10-10T12:00:00Z', '2026-10-26T20:00:00Z', '2026-11-09T12:00:00Z', '2026-10-18T00:00:00Z', '2027-03-03T03:00:00Z']
for (const iso of dates) {
  const e = ephemerisAt(new Date(iso))
  const pose = homePose(e)
  assert.equal(pose.dist, HOME_DIST)
  const { up, back, right } = poseBasis(e, pose)
  const sep = Math.acos(Math.min(1, back.dot(e.earthDir))) / DEG
  assert.ok(sep < 0.01, `${iso}: camera is ${sep} deg off the Moon-Earth line`)
  // North up: the J2000 celestial pole, projected on the image plane, points straight up.
  const pole = new Vector3(0, 0, 1)
  assert.ok(Math.abs(pole.dot(right)) < 1e-9, `${iso}: celestial north leans ${pole.dot(right)} off up`)
  assert.ok(pole.dot(up) > 0.8, `${iso}: celestial north is up`)
  // The Moon's own axis is tilted from vertical by a small real angle (libration plus position angle of the axis), never flipped.
  assert.ok(Math.abs(pose.roll) < 40, `${iso}: roll ${pose.roll}`)
  // The Sun is where the real sky has it: the lit share the view sees equals the illuminated fraction from the Earth.
  const lit = (1 + back.dot(e.sunDir)) / 2
  assert.ok(Math.abs(lit - e.illuminatedFraction) < 1e-6, `${iso}: lit ${lit} vs ${e.illuminatedFraction}`)
}
