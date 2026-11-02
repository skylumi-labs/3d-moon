/**
 * Trackball drag: inertia continues the same rotation (no twist while coasting), and on release the roll eases back to lunar-north-up
 * (not near a pole, not under a script, never moving the point under the middle of the frame):
 *   npm test
 */
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { CameraRig, LEVEL_MS } from '../src/camera/rig.ts'
import { pickSphere } from '../src/camera/pose.ts'
import { ephemerisAt } from '../src/ephemeris.ts'

const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
const aspect = 16 / 9
const normRoll = (r: number): number => ((r + 540) % 360) - 180
const deg = (rad: number): number => rad * 180 / Math.PI

/** A fresh rig at (lon 12, lat) 4 radii up, dragged sideways by `steps` pointer events 16 ms apart; returns the rig and the time of the last one. */
function dragged(lat: number, steps = 24, dx = 0.012): { rig: CameraRig; t: number } {
  const rig = new CameraRig()
  rig.setFloor(1.45)
  rig.setPose({ lon: 12, lat, dist: 4, roll: 0 })
  rig.dragging = true
  let t = 1000
  for (let i = 0; i < steps; i++) {
    assert.ok(rig.grab({ nx: dx * i, ny: 0 }, { nx: dx * (i + 1), ny: 0 }, e, aspect, t), 'the grab holds')
    t += 16
  }
  return { rig, t }
}
const runFor = (rig: CameraRig, t: number, ms: number): number => {
  const end = t + ms
  for (; t < end; t += 16) rig.step(t, 0.016)
  return t
}
const centre = (rig: CameraRig, t: number): Vector3 => pickSphere(rig.camera(e, aspect, t), 0, 0, aspect)!

// 1. Release at lat 70 after a sideways drag: the roll the trackball left eases to north-up within 0.5 deg, the centre point stays.
{
  const { rig, t } = dragged(70)
  assert.ok(Math.abs(normRoll(rig.pose.roll)) > 3, `the drag leaves a roll (${rig.pose.roll} deg)`)
  rig.dragging = false
  rig.release(t + 400) // held still: no coasting, the levelling starts at once
  const c0 = centre(rig, t)
  assert.ok(rig.levelling(), 'a levelling is pending')
  let tt = runFor(rig, t + 400, LEVEL_MS / 2)
  assert.ok(Math.abs(normRoll(rig.pose.roll)) > 0.5, 'still easing at half time')
  tt = runFor(rig, tt, LEVEL_MS)
  assert.ok(Math.abs(normRoll(rig.pose.roll)) < 0.5, `north-up within 0.5 deg after ${LEVEL_MS} ms (roll ${rig.pose.roll})`)
  const moved = deg(c0.angleTo(centre(rig, tt)))
  assert.ok(moved < 0.01, `the point under the middle of the frame stays (${moved} deg)`)
  assert.ok(!rig.levelling(), 'done')
  const cam = rig.camera(e, aspect, tt)
  assert.ok(cam.up.dot(e.moonZ) > 0, 'screen-up points to lunar north')
  assert.ok(Math.abs(cam.right.dot(e.moonZ)) < 0.01, 'and not sideways')
}

// 1b. With a layout aim the point under the middle of the frame stays too.
{
  const { rig, t } = dragged(60)
  rig.aimShift = 0.2
  rig.dragging = false
  rig.release(t + 400)
  const c0 = centre(rig, t)
  const tt = runFor(rig, t + 400, LEVEL_MS + 100)
  assert.ok(Math.abs(normRoll(rig.pose.roll)) < 1, `levelled with an aim (roll ${rig.pose.roll})`)
  assert.ok(deg(c0.angleTo(centre(rig, tt))) < 0.05, 'centre point stays with an aim')
}

// 2. Near a pole (within 15 deg) nothing is levelled.
{
  for (const lat of [86, -86]) {
    const { rig, t } = dragged(lat, 12)
    assert.ok(Math.abs(rig.pose.lat) > 75, `the drag ends near the pole (lat ${rig.pose.lat})`)
    const roll = rig.pose.roll
    rig.dragging = false
    rig.release(t + 400)
    runFor(rig, t + 400, 1200)
    assert.equal(rig.pose.roll, roll, `near the pole (lat ${lat}) the roll is left alone`)
  }
}

// 3. Not in ground mode, not under a look; a new touch cancels it; a tap and a twist level nothing (Turn mode, the old exception, went on 2026-10-31).
{
  const ground = dragged(70)
  ground.rig.frozen = true
  ground.rig.dragging = false
  ground.rig.release(ground.t + 400)
  const gr = ground.rig.pose.roll
  runFor(ground.rig, ground.t + 400, 800)
  assert.equal(ground.rig.pose.roll, gr, 'ground mode keeps the roll')

  const look = dragged(70)
  look.rig.dragging = false
  look.rig.release(look.t + 400)
  look.rig.lookToward(new Vector3(0, 1, 0), false, look.t + 401, e, aspect)
  assert.ok(!look.rig.levelling(), 'a look cancels the levelling')

  const touch = dragged(70)
  touch.rig.dragging = false
  touch.rig.release(touch.t + 400)
  const tt = runFor(touch.rig, touch.t + 400, 200)
  const mid = touch.rig.pose.roll
  assert.ok(Math.abs(normRoll(mid)) > 0.5, 'part way')
  touch.rig.takeOver(tt) // pointerdown
  touch.rig.stopInertia()
  touch.rig.dragging = true
  runFor(touch.rig, tt, 400)
  assert.equal(touch.rig.pose.roll, mid, 'a new touch stops the levelling where it is')
  touch.rig.dragging = false
  touch.rig.release(tt + 1000) // a tap that turned nothing
  assert.ok(!touch.rig.levelling(), 'a tap without a turn levels nothing')

  const tilted = dragged(60)
  tilted.rig.setPose({ dist: 1.3, pitch: 40 })
  tilted.rig.dragging = true
  tilted.rig.spin(30, 0, 880, e, aspect, tilted.t + 16)
  tilted.rig.dragging = false
  tilted.rig.release(tilted.t + 400)
  const tr = tilted.rig.pose.roll
  runFor(tilted.rig, tilted.t + 400, 800)
  assert.equal(tilted.rig.pose.roll, tr, 'a view tilted toward the horizon keeps its heading')

  const twist = dragged(70)
  twist.rig.twist(30, e, aspect, twist.t)
  twist.rig.dragging = false
  twist.rig.release(twist.t + 400)
  assert.ok(!twist.rig.levelling(), 'a roll the visitor twisted in is kept')
}

// 4. Coasting continues the trackball rotation: the whole view turns rigidly about one axis, so the picture does not twist.
{
  const { rig, t } = dragged(70, 12, 0.03)
  rig.dragging = false
  rig.release(t + 10) // fast: coasts
  const cam0 = rig.camera(e, aspect, t)
  const back0 = cam0.back.clone(), up0 = cam0.up.clone()
  let tt = t + 10
  for (let i = 0; i < 12; i++) { rig.step(tt, 0.016); tt += 16 }
  const cam1 = rig.camera(e, aspect, tt)
  const turned = deg(back0.angleTo(cam1.back))
  assert.ok(turned > 1, `coasting carries on (${turned} deg)`)
  assert.ok(rig.levelling(), 'the levelling waits for the coasting')
  const axis = new Vector3().crossVectors(back0, cam1.back).normalize()
  const expectUp = up0.clone().applyAxisAngle(axis, back0.angleTo(cam1.back))
  const off = deg(cam1.up.angleTo(expectUp))
  assert.ok(off < 0.05, `no twist while coasting (${off} deg off a rigid turn)`)
  for (let i = 0; i < 500; i++) { rig.step(tt, 0.016); tt += 16 }
  assert.ok(Math.abs(normRoll(rig.pose.roll)) < 0.5, `levelled after the coasting (roll ${rig.pose.roll})`)
  const rest = { ...rig.pose }
  for (let i = 0; i < 30; i++) { rig.step(tt, 0.016); tt += 16 }
  assert.deepEqual(rig.pose, rest, 'and rests')
}
console.log('trackball-level: ok')
