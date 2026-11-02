/**
 * Continuous approach-to-descent hand-off: the whole production loop at 60 fps, from the orbital rig's camera through the
 * hand-over blend and the orbit-to-ground regime change to the settle, never shows a cut. Frame to frame the camera moves by no more
 * than a smooth path allows, and the two seams (the end of the blend, the regime flip) are no larger than their neighbours.
 * Geometry only: no pixels were rendered. npx tsx scripts/descent-handoff.test.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { Vector3 } from 'three'
import { DescentPath, HANDOVER_T, type TrackDoc } from '../src/descent/DescentPath.ts'
import { DescentFlight, HANDOVER_MS, HANDOFF_T, siteRadius } from '../src/descent/flight.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { frameAxes, makeSiteFrame, viewFromGround } from '../src/ground/frame.ts'
import type { ViewCamera } from '../src/camera/pose.ts'

const path = DescentPath.fromDoc(JSON.parse(fs.readFileSync(new URL('../data/apollo17/descent-track.json', import.meta.url), 'utf8')) as TrackDoc)
const frameDef = makeSiteFrame(30.77168, 20.19091, -2626), rs = siteRadius(-2626)
const DEG = 180 / Math.PI
const axesAt = (t: number) => frameAxes(ephemerisAt(new Date(path.utcMsAt(t))), frameDef)

function run(groundZ: ((e: number, n: number) => number | null) | null) {
  const f = new DescentFlight(path)
  const rigCam: ViewCamera = viewFromGround(axesAt(HANDOVER_T), { pos: new Vector3(0, -800000, 400000), headingDeg: 20, pitchDeg: -30, rollDeg: 0, tanHalf: 0.27 })
  f.begin(rigCam, 0)
  const dt = 1 / 60
  let nowMs = 0, prev: ViewCamera | null = null, prevRegime = f.regime
  const steps: { pos: number; ang: number; fov: number; t: number; blend: boolean; flip: boolean }[] = []
  for (let i = 0; i < 60 * 1200 && !f.ended; i++) {
    nowMs += dt * 1000
    f.advance(dt)
    const fr = f.evaluate({ axes: axesAt(f.t), rs, groundZ, nowMs })
    if (prev) steps.push({
      pos: fr.cam.pos.distanceTo(prev.pos) * 1737400, ang: Math.acos(Math.min(1, fr.cam.back.dot(prev.back))) * DEG, fov: Math.abs(Math.log(fr.cam.tanHalf / prev.tanHalf)),
      t: f.t, blend: fr.blending, flip: fr.regime !== prevRegime,
    })
    prev = fr.cam; prevRegime = fr.regime
  }
  assert.ok(f.ended, 'the loop reaches the hand-off to the free camera')
  return steps
}

const steps = run(() => 0)
const blendEnd = steps.findIndex((s) => !s.blend)
assert.ok(blendEnd > 0.9 * HANDOVER_MS / 16.7, `the blend runs its ${HANDOVER_MS} ms (ended at frame ${blendEnd})`)
const worst = (xs: number[]) => xs.reduce((m, x) => Math.max(m, x), 0)
const around = (i: number, key: 'pos' | 'ang' | 'fov') => worst(steps.slice(Math.max(0, i - 6), i).map((s) => s[key]).concat(steps.slice(i + 1, i + 7).map((s) => s[key])))
// The seam between the blend and the flight: the step across it is no larger than the steps beside it (plus the smoothstep's own slope).
assert.ok(steps[blendEnd].pos <= 1.5 * around(blendEnd, 'pos') + 1, `blend-end position step ${steps[blendEnd].pos.toFixed(2)} m vs neighbours ${around(blendEnd, 'pos').toFixed(2)} m`)
assert.ok(steps[blendEnd].ang <= 1.5 * around(blendEnd, 'ang') + 0.05, `blend-end turn ${steps[blendEnd].ang.toFixed(3)} deg`)
// The regime flip (orbit -> ground) changes only who owns the camera, never where it is.
const flips = steps.map((s, i) => (s.flip ? i : -1)).filter((i) => i >= 0)
assert.equal(flips.length, 1, 'the regime changes once on the way down')
const fi = flips[0]
assert.ok(steps[fi].pos <= 1.5 * around(fi, 'pos') + 1 && steps[fi].ang <= 1.5 * around(fi, 'ang') + 0.05 && steps[fi].fov <= 1.5 * around(fi, 'fov') + 1e-4, `regime flip is not a cut: ${JSON.stringify(steps[fi])}`)
// Over the whole loop no frame turns or zooms like a cut.
// Over the whole loop no frame is a cut: each step is within a factor of its neighbours (a swing past the module at the 16x fast-forward
// is fast but smooth; the old `coastK > 0` branch cut 83 degrees in the one frame at t = -20, against 3.6 degrees the frame before).
const cuts = steps.map((s, i) => ({ s, i })).filter(({ s, i }) => s.ang > 2 * around(i, 'ang') + 0.5 || s.pos > 2 * around(i, 'pos') + 5)
assert.deepEqual(cuts.map(({ s }) => `${s.t.toFixed(2)}: ${s.ang.toFixed(1)} deg ${s.pos.toFixed(0)} m`), [], 'no frame of the approach-to-descent loop is a cut')
assert.ok(worst(steps.map((s) => s.ang)) < 10, `largest turn in one frame ${worst(steps.map((s) => s.ang)).toFixed(3)} deg`)
assert.ok(worst(steps.map((s) => s.fov)) < 0.05, `largest field change in one frame ${worst(steps.map((s) => s.fov)).toFixed(4)}`)
assert.ok(steps[steps.length - 1].t >= HANDOFF_T - 1)

console.log(`descent-handoff.test.mts: ${steps.length} frames, blend end ${steps[blendEnd].pos.toFixed(1)} m, flip ${steps[fi].pos.toFixed(1)} m, max turn ${worst(steps.map((s) => s.ang)).toFixed(3)} deg: ok (pixels unrun)`)
