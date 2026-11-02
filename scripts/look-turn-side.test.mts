// A look turn of about 180 degrees toward a moving target (the Earth from a camera between the Moon and the Earth: tapping Earthrise while another
// flight runs) flipped its direction of turn on the frame the turn passed 180 degrees: three's slerp re-picks the shorter arc on every call, and the
// view stepped 40-45 degrees in one frame 1.5-2.6 s into the approach (rig 2026-10-29, tap-jump.mjs flight-earthrise, look from-target 179.65 -> 179.57).
// A first fix pinned a sign at the turn's start; the target is rebuilt from a matrix every frame and can come back as -q, which made a 174 degree
// step (review, 2026-10-29). The turn now keeps the side of the previous frame's target. Both cases are checked on the real CameraRig.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { Quaternion, Vector3 } from 'three'
import { CameraRig, continuousTarget, slerpAsGiven } from '../src/camera/rig.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { MOON_R_KM } from '../src/glsl/common.ts'

const deg = (a: Vector3, b: Vector3): number => Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 180 / Math.PI
const qdeg = (a: Quaternion, b: Quaternion): number => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 180 / Math.PI

{
  // Pure: a target moving across the antipode (176 -> 184 degrees from the start) while the turn runs, also handed in as -q on alternate frames.
  const Y = new Vector3(0, 1, 0), from = new Quaternion()
  const target = (i: number): Quaternion => { const q = new Quaternion().setFromAxisAngle(Y, (176 + i * 0.1) * Math.PI / 180); return i % 2 ? new Quaternion(-q.x, -q.y, -q.z, -q.w) : q }
  let ref: Quaternion | null = null, prevShown: Quaternion | null = null, worst = 0, oldWorst = 0, prevOld: Quaternion | null = null
  for (let i = 0; i <= 80; i++) {
    const k = 0.4 + i * 0.001
    ref = continuousTarget(target(i), ref, from)
    const shown = slerpAsGiven(from, ref, k)
    const old = new Quaternion().slerpQuaternions(from, target(i), k)
    if (prevShown) worst = Math.max(worst, qdeg(prevShown, shown))
    if (prevOld) oldWorst = Math.max(oldWorst, qdeg(prevOld, old))
    prevShown = shown; prevOld = old
  }
  assert.ok(oldWorst > 30, `the shorter-arc slerp flips (worst ${oldWorst.toFixed(1)} deg): the bug this guards`)
  assert.ok(worst < 0.5, `the turn keeps its side across the antipode and a -q target: worst ${worst.toFixed(3)} deg`)
  const t = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 1.1)
  for (const w of [0, 0.3, 0.77, 1]) assert.ok(qdeg(slerpAsGiven(from, continuousTarget(t, null, from), w), new Quaternion().slerpQuaternions(from, t, w)) < 1e-6, `same as three away from the antipode (${w})`)
}

/** Runs a CameraRig look turn toward the Earth while the camera's longitude moves, and returns the largest frame-to-frame view step (deg). */
function rigTurn(lon0: number, lon1: number, aspect: number, lat = -44, dist = 2.3): number {
  const e = ephemerisAt(new Date('1968-12-24T16:39:39Z'))
  const rig = new CameraRig()
  rig.mode = 'fly'
  rig.pose = { lon: lon0, lat, dist, roll: 0, pitch: 0 }
  const earth = (cam: { pos: Vector3 }): Vector3 => e.earthKm.clone().divideScalar(MOON_R_KM).sub(cam.pos)
  const t0 = 1000, ms = 3000, n = 180
  rig.lookToward(earth, true, t0, e, aspect, ms)
  let prev: Vector3 | null = null, worst = 0
  for (let i = 0; i <= n; i++) {
    const now = t0 + (ms * i) / n
    rig.pose = { ...rig.pose, lon: lon0 + ((lon1 - lon0) * i) / n, roll: 0 }
    const back = rig.camera(e, aspect, now).back.clone()
    if (prev) worst = Math.max(worst, deg(prev, back))
    prev = back
  }
  return worst
}
for (const aspect of [1280 / 800, 412 / 915]) {
  // The review's case: an Earth look while longitude moves 290 -> 302 degrees.
  const w1 = rigTurn(290, 302, aspect)
  assert.ok(w1 < 3, `Earth look, lon 290 -> 302, aspect ${aspect.toFixed(2)}: worst step ${w1.toFixed(2)} deg`)
  // A sweep of starts: no turn steps more than a few degrees per 1/60 of the turn anywhere.
  for (let lon = -180; lon < 180; lon += 15) {
    const w = rigTurn(lon, lon + 12, aspect)
    assert.ok(w < 6, `Earth look from lon ${lon}: worst step ${w.toFixed(2)} deg`)
  }
}

const rig = fs.readFileSync(new URL('../src/camera/rig.ts', import.meta.url), 'utf8')
assert.doesNotMatch(rig, /slerpQuaternions\(this\.lookFrom/, 'no per-frame shorter-arc slerp of the look turn')
console.log('look-turn-side: ok')
