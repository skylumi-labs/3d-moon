import assert from 'node:assert/strict'
import { Quaternion, Vector3 } from 'three'
import { ephemerisAt } from '../src/ephemeris.ts'
import { MOON_TURN_PITCH_MAX, MoonSurfaceTurn, turnEphemeris } from '../src/camera/moonTurn.ts'

const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3)
const t = turnEphemeris(e, turn)

assert.ok(t.moonX.distanceTo(e.moonX.clone().applyQuaternion(turn)) < 1e-12, 'body X axis follows the turn')
assert.ok(t.moonY.distanceTo(e.moonY.clone().applyQuaternion(turn)) < 1e-12, 'body Y axis follows the turn')
assert.ok(t.moonZ.distanceTo(e.moonZ.clone().applyQuaternion(turn)) < 1e-12, 'body Z axis follows the turn')
assert.ok(t.sunKm.equals(e.sunKm) && t.earthKm.equals(e.earthKm), 'world Sun and Earth geometry stays fixed')
assert.ok(t.sunDir.equals(e.sunDir) && t.earthDir.equals(e.earthDir), 'world light and Earth directions stay fixed')
assert.notEqual(t.subSolar.lon, e.subSolar.lon, 'the fixed Sun moves across the rotated body frame')
assert.ok(Math.abs(t.moonToWorld.determinant() - 1) < 1e-12, 'turned body frame remains a proper rotation')

const motion = new MoonSurfaceTurn()
const axis = new Vector3(1, 0, 0)
const right = new Vector3(1, 0, 0), up = new Vector3(0, 1, 0), north = new Vector3(0, 0, 1)
assert.equal(motion.drag({ axis, angle: 0.08 }, 10, right, up, north), true)
const beforeCoast = motion.orientation.clone()
assert.equal(motion.step(0.05), false, 'one isolated drag sample has no release velocity')
assert.ok(motion.orientation.equals(beforeCoast))
motion.drag({ axis, angle: 0.06 }, 30, right, up, north)
const beforeRelease = motion.orientation.clone()
assert.equal(motion.step(0.05), true, 'consecutive drag samples retain release momentum')
assert.ok(motion.orientation.angleTo(beforeRelease) > 0, 'release momentum advances the Moon orientation')
motion.reset()
assert.ok(motion.orientation.equals(new Quaternion()), 'reset returns to real date geometry')
assert.equal(motion.step(0.05), false, 'reset clears release momentum')

// Arbitrary grab axes are projected onto yaw and pitch only. Thousands of reversals and a release coast never accumulate roll.
{
  const turn = new MoonSurfaceTurn()
  let seed = 0x41c6ce57
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000 }
  for (let i = 0; i < 1200; i++) {
    const v = new Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize()
    turn.drag({ axis: v, angle: random() * 0.12 }, i * 16, right, up, north)
    assert.ok(Math.abs(turn.pitch) <= MOON_TURN_PITCH_MAX + 1e-12, 'pitch stays inside the limb-safe clamp')
    const n = north.clone().applyQuaternion(turn.orientation)
    assert.ok(Math.abs(n.dot(right)) < 1e-12, 'the projected north axis has zero screen roll after every drag')
  }
  for (let i = 0; i < 120; i++) {
    turn.step(0.05)
    assert.ok(Math.abs(turn.pitch) <= MOON_TURN_PITCH_MAX + 1e-12, 'coast stays inside the pitch clamp')
    const n = north.clone().applyQuaternion(turn.orientation)
    assert.ok(Math.abs(n.dot(right)) < 1e-12, 'the coast cannot add screen roll')
  }
}

// Finger-driven turns (sideways spin about the date's north, vertical tilt). With a north axis that starts tilted and leaning, no drag
// sequence changes its sideways screen component (no roll), and the tilt range bounds the north axis's own tilt toward or away from the viewer.
{
  const turn = new MoonSurfaceTurn()
  const n0 = new Vector3(Math.sin(0.21), Math.cos(0.21) * Math.cos(0.4), Math.cos(0.21) * Math.sin(0.4)).normalize()
  const back = new Vector3(0, 0, 1)
  const tilt0 = Math.atan2(n0.dot(back), n0.dot(up))
  const range: [number, number] = [-MOON_TURN_PITCH_MAX - tilt0, MOON_TURN_PITCH_MAX - tilt0]
  let seed = 7
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000 }
  for (let i = 0; i < 2000; i++) {
    turn.dragBy((random() * 2 - 1) * 0.2, (random() * 2 - 1) * 0.2, i * 16, right, n0, range)
    const n = n0.clone().applyQuaternion(turn.orientation)
    assert.ok(Math.abs(n.dot(right) - n0.dot(right)) < 1e-9, 'the north axis keeps its sideways screen component: no roll')
    const tilt = Math.atan2(n.dot(back), n.dot(up))
    assert.ok(Math.abs(tilt) <= MOON_TURN_PITCH_MAX + 1e-9, `the north axis tilts at most the clamp toward or away from the viewer (${tilt})`)
  }
  for (let i = 0; i < 60; i++) turn.step(0.05)
  const n = n0.clone().applyQuaternion(turn.orientation)
  assert.ok(Math.abs(n.dot(right) - n0.dot(right)) < 1e-9 && Math.abs(Math.atan2(n.dot(back), n.dot(up))) <= MOON_TURN_PITCH_MAX + 1e-9, 'the coast keeps both')
}

// Review: a new gesture in a different camera basis starts from the turn already shown; a 1 px drag moves the body by about 1 px, never a snap.
{
  const turn = new MoonSurfaceTurn()
  const n0 = new Vector3(0, 0, 1)
  for (let i = 0; i < 30; i++) turn.dragBy(0.02, 0.02, i * 16, right, n0)
  turn.rebase()
  const shown = turn.orientation.clone()
  const right2 = new Vector3(0, 1, 0)   // the camera turned 90 degrees between the drags
  turn.dragBy(1e-4, 1e-4, 1000, right2, turn.baseNorth(n0))
  assert.ok(turn.orientation.angleTo(shown) < 3e-4, `a tiny drag after a camera move moves the body by a tiny angle (${turn.orientation.angleTo(shown)})`)
  turn.reset()
  assert.ok(turn.base.equals(new Quaternion()) && turn.orientation.equals(new Quaternion()), 'reset clears the base too')
}
// The rate in main.ts: the ground under the camera follows the finger at every height (not the disc size, which ran 26x ahead at 5 km).
{
  const src = (await import('node:fs')).readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(src, /const radPerPx = Math\.max\(1e-7, cam\.pos\.length\(\) - 1\) \* cam\.tanHalf \/ Math\.max\(1, canvas\.clientHeight \/ 2\)/)
  assert.match(src, /stopMoonTurn: \(now, phase\) => \{ if \(phase === 'down'\) moonSurfaceTurn\.rebase\(\)/)
}

// Review: a view whose north already tilts 80 degrees (polar) gets a range that excludes 0; a drag may bring north back, never tilt it further.
{
  const turn = new MoonSurfaceTurn()
  const range: [number, number] = [-MOON_TURN_PITCH_MAX - 80 * Math.PI / 180, MOON_TURN_PITCH_MAX - 80 * Math.PI / 180]
  turn.dragBy(0, 0.3, 0, right, north, range)
  assert.equal(turn.pitch, 0, 'no further tilt past the limit')
  turn.dragBy(0, -0.2, 16, right, north, range)
  assert.ok(Math.abs(turn.pitch + 0.2) < 1e-12, 'back toward the range is allowed')
  turn.dragBy(0, 0.5, 32, right, north, range)
  assert.ok(Math.abs(turn.pitch + 0.2) < 1e-12, 'once part of the way back, it cannot tilt out again')
}

console.log('moon-turn ok')
