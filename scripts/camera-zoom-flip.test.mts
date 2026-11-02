// Owner's Android reports: pinch zoom-in stuck at the far limit (19,111 km), and the Moon "suddenly flips" under one-finger drags.
import assert from 'node:assert/strict'
import { CameraRig, LEVEL_MAX_DEG } from '../src/camera/rig.ts'
import { D_MAX } from '../src/camera/pose.ts'
import { ephemerisAt } from '../src/ephemeris.ts'

const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
const ang = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
  Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))) * 180 / Math.PI

// 1. Zoom in from exactly D_MAX through the dolly path (layout aim), in portrait.
for (const aspect of [0.5, 430 / 930]) for (const aim of [0.05, 0.189]) for (const lat of [-60, 0, 35]) {
  const r = new CameraRig()
  r.setPose({ lon: 20, lat, dist: 6, roll: 0 })
  r.aimShift = aim
  let t = 1000
  for (let i = 0; i < 60; i++) r.zoomCentre(1.1, e, aspect, t += 16)
  for (let i = 0; i < 40; i++) r.step(t += 16, 0.016)
  assert.ok(r.pose.dist >= D_MAX - 1e-6, `reached the far limit (${r.pose.dist})`)
  const d0 = r.pose.dist
  for (let i = 0; i < 8; i++) r.zoomCentre(0.9, e, aspect, t += 16)
  assert.ok(r.pose.dist < d0 - 0.5, `aspect ${aspect} aim ${aim} lat ${lat}: zoom in from D_MAX moved (${d0} -> ${r.pose.dist})`)
}

// 3. A roll the pole left (beyond LEVEL_MAX_DEG) is not levelled in half a second: no sudden half turn after release.
{
  const r = new CameraRig()
  r.setPose({ lon: 0, lat: 40, dist: 4, roll: 0 })
  let t = 1000
  for (let i = 0; i < 120; i++) r.spin(0, 14, 430, e, 0.5, t += 16)
  r.release(t + 400)
  t += 400
  let prev = r.camera(e, 0.5, t), worst = 0
  for (let i = 0; i < 100; i++) { r.step(t += 16, 0.016); const c = r.camera(e, 0.5, t); worst = Math.max(worst, ang(prev.up, c.up)); prev = c }
  assert.ok(worst < 4 || Math.abs(r.pose.roll) <= LEVEL_MAX_DEG, `post-release up turns ${worst} deg in one frame`)
}
// 4. Big random one-finger steps from near a pole (the one drag rule since 2026-10-31): the view's up turns by no more than the (capped) gesture rotation per step.
{
  let seed = 11
  const rnd = (): number => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  for (const mode of ['orbit'] as const) for (let trial = 0; trial < 60; trial++) {
    const r = new CameraRig()
    r.setPose({ lon: rnd() * 360 - 180, lat: (rnd() < 0.5 ? 1 : -1) * (80 + rnd() * 9.5), dist: 5, roll: 0 })
    let t = 1000, prev = r.camera(e, 430 / 930, t)
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2, px = 10 + rnd() * 40
      r.spin(Math.cos(a) * px, Math.sin(a) * px, 430, e, 430 / 930, t += 16)
      const c = r.camera(e, 430 / 930, t)
      assert.ok(ang(prev.up, c.up) < 8.5, `${mode} trial ${trial} step ${i}: up turned ${ang(prev.up, c.up)}`)
      prev = c
    }
    r.release(t + 400); t += 400
    for (let i = 0; i < 200; i++) {
      r.step(t += 16, 0.016)
      const c = r.camera(e, 430 / 930, t)
      assert.ok(ang(prev.up, c.up) < 8.5, `${mode} trial ${trial} settle ${i}: up turned ${ang(prev.up, c.up)}`)
      prev = c
    }
  }
}
console.log('camera-zoom-flip ok')
