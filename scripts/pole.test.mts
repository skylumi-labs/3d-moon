import assert from 'node:assert/strict'
import { crossPole } from '../src/camera/pole.ts'
import { CameraRig } from '../src/camera/rig.ts'
import { ephemerisAt } from '../src/ephemeris.ts'

assert.deepEqual(crossPole(25, 88, 4, 5, 12), { lon: -151, lat: 87, roll: -168 })
assert.deepEqual(crossPole(-40, -88, 0, -5, 0), { lon: 140, lat: -87, roll: -180 })
assert.deepEqual(crossPole(0, 0, 5, 10, 0), { lon: 5, lat: 10, roll: 0 })

const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
const angleDeg = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
  Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))) * 180 / Math.PI
const middle = new CameraRig()
middle.setPose({ lon: 12, lat: 45, dist: 4, roll: 0 })
let middleUp = middle.camera(e, 0.5, 1000).up
for (let i = 0; i < 40; i++) {
  middle.spin(5, 0, 800, e, 0.5, 1016 + i * 16)
  const nextUp = middle.camera(e, 0.5, 1016 + i * 16).up
  assert.ok(angleDeg(middleUp, nextUp) < 0.5, `small mid-latitude spins keep camera-up continuous: ${angleDeg(middleUp, nextUp)}`)
  middleUp = nextUp
}

// Cross the pole in screen-space drags at several starting latitudes and
// rolls. A swipe's camera-up direction must turn by the swipe angle each step,
// including through the pole's longitude/latitude basis seam.
for (const lat of [84, 88, 89]) for (const roll of [-121, 0, 37]) {
  const r = new CameraRig()
  r.setPose({ lon: 12, lat, dist: 4, roll })
  let previous = r.camera(e, 0.5, 1000)
  const step = (dx: number, dy: number, i: number): void => {
    r.spin(dx, dy, 800, e, 0.5, 1016 + i * 16)
    const next = r.camera(e, 0.5, 1016 + i * 16)
    const upTurn = angleDeg(previous.up, next.up)
    assert.ok(upTurn < 1.1, `lat ${lat}, roll ${roll}, step ${i}: camera-up jumped ${upTurn} deg`)
    previous = next
  }
  // Preserve the reported two-step drag as the opening sample.
  step(0, 16, 0)
  step(5, 5, 1)
  let peakLat = r.pose.lat
  let passedPole = false
  // Select a fixed screen drag direction that crosses the pole from this
  // starting roll, then keep it fixed for the whole path.
  let direction: readonly [number, number] = [0, 16]
  let bestPeak = -Infinity
  for (let deg = 0; deg < 360; deg += 30) {
    const candidate = [Math.sin(deg * Math.PI / 180) * 16, Math.cos(deg * Math.PI / 180) * 16] as const
    const probe = new CameraRig()
    probe.setPose({ ...r.pose })
    let candidatePeak = probe.pose.lat
    for (let i = 0; i < 120; i++) {
      probe.spin(candidate[0], candidate[1], 800, e, 0.5, 3000 + i * 16)
      candidatePeak = Math.max(candidatePeak, probe.pose.lat)
    }
    if (candidatePeak > bestPeak) { bestPeak = candidatePeak; direction = candidate }
  }
  for (let i = 2; i < 122 && !passedPole; i++) {
    step(direction[0], direction[1], i)
    if (r.pose.lat > peakLat) peakLat = r.pose.lat
    else if (peakLat > lat + 0.2 && r.pose.lat < peakLat - 0.2) passedPole = true
  }
  assert.ok(passedPole, `lat ${lat}, roll ${roll}: drag crossed and passed the pole`)
}
console.log('pole.test: ok')
