/** A shared view reopens as seen: the rig that opens a link draws the camera the sharing rig drew (position, view axes, lens). */
import assert from 'node:assert/strict'
import { CameraRig } from '../src/camera/rig.ts'
import { FLY_FOV_DEG } from '../src/camera/pose.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { shareParams, readShare } from '../src/ui/shareView.ts'
import type { Vector3 } from 'three'

const e = ephemerisAt(new Date('2026-10-06T12:00:00Z'))
const earthLook = () => (cam: { pos: Vector3 }) => e.earthKm.clone().divideScalar(1737.4).sub(cam.pos)
const close = (a: Vector3, b: Vector3, tol: number, msg: string): void => assert.ok(a.distanceTo(b) <= tol, `${msg}: ${a.toArray()} vs ${b.toArray()}`)

function reopen(a: CameraRig): CameraRig {
  const params = shareParams({
    autoOff: false, live: false, time: e.date, layoutAim: false, pose: a.pose as never, fovDeg: a.fovDeg, defaultFovDeg: FLY_FOV_DEG, pitchFelt: true,
    look: a.earthLook > 0 ? { kind: 'earth', w: a.earthLook } : null, free: a.freeOrientation(), pin: null, ground: null, viewpoint: null,
  })
  const q = new URLSearchParams(params)
  const share = readShare((k) => q.get(k))
  const b = new CameraRig()
  b.setPose({ ...share.pose })
  if (share.fovDeg !== null) b.fovDeg = share.fovDeg
  if (share.look) b.setLookBlend(share.look.w, earthLook() as never)
  else if (share.free) b.setFreeOrientation(share.free)
  return b
}

// Earthrise: over the far side at 4 radii, lens 20, turned to the Earth. Moon-centred would show the Moon, not the Earth.
{
  const a = new CameraRig()
  a.setPose({ lon: 170, lat: 38, dist: 4, roll: 0, pitch: 0 })
  a.fovDeg = 20
  a.setLookBlend(1, earthLook() as never)
  const b = reopen(a)
  const ca = a.camera(e, 1.6, 0), cb = b.camera(e, 1.6, 0)
  close(ca.pos, cb.pos, 1e-4, 'pos'); close(ca.back, cb.back, 1e-6, 'back'); close(ca.up, cb.up, 1e-6, 'up')
  assert.equal(ca.tanHalf, cb.tanHalf)
  // And it really looks at the Earth, not at the Moon.
  const toEarth = e.earthKm.clone().divideScalar(1737.4).sub(cb.pos).normalize()
  assert.ok(toEarth.dot(cb.back.clone().negate()) > 0.9999, 'the view points at the Earth')
  const toMoon = cb.pos.clone().negate().normalize()
  assert.ok(toMoon.dot(cb.back.clone().negate()) < 0.99, 'and not at the Moon')
}
// A free orientation left by a grab in mid-flight.
{
  const a = new CameraRig()
  a.setPose({ lon: 40, lat: -10, dist: 2.2, roll: 0, pitch: 0 })
  a.setLookBlend(0.6, earthLook() as never)
  a.settle(e, 1.6, 0)
  assert.ok(a.freeOrientation(), 'a settled grab holds a free orientation')
  const b = reopen(a)
  const ca = a.camera(e, 1.6, 0), cb = b.camera(e, 1.6, 0)
  close(ca.pos, cb.pos, 1e-4, 'pos'); close(ca.back, cb.back, 1e-4, 'back'); close(ca.up, cb.up, 1e-4, 'up')
}
// A plain pose, as before.
{
  const a = new CameraRig()
  a.setPose({ lon: -20.08, lat: 9.62, dist: 5.5, roll: 30, pitch: 0 })
  const b = reopen(a)
  close(a.camera(e, 1.6, 0).back, b.camera(e, 1.6, 0).back, 1e-6, 'back')
  assert.equal(a.earthLook, 0)
}
console.log('share-rig: ok')
