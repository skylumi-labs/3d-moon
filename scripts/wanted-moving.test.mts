// A gesture recomputes the wanted set rarely (reuseWanted) and from every other ray (StreamView.moving): the moving set must stay inside the
// full set and keep most of it, and the throttle must hand control back the moment the gesture ends.
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { computeWanted, reuseWanted, wantedMemoKey, wantedMemoValid, MOVING_WANTED_MS, FLIGHT_WANTED_MS, flightWantedScale, FLIGHT_WANTED_DEFAULT, wantResidency, type StreamView } from '../src/moon/tiles/wanted.ts'
import { MOON_R_KM, pageWidth } from '../src/moon/tiles/grid.ts'
import { COARSEST_LEVEL, levelRow } from '../src/moon/tiles/levels.ts'

function viewOver(dist: number, lon: number, lat: number, pitchDeg: number, spin: number): StreamView {
  const d = Math.PI / 180, w = 1280, h = 800
  const dir = new THREE.Vector3(Math.cos(lat * d) * Math.cos(lon * d), Math.cos(lat * d) * Math.sin(lon * d), Math.sin(lat * d))
  const nadir = dir.clone().negate()
  const right = new THREE.Vector3().crossVectors(nadir, new THREE.Vector3(0, 0, 1)).normalize()
  const up = new THREE.Vector3().crossVectors(right, nadir).normalize()
  const q = new THREE.Quaternion().setFromAxisAngle(right, pitchDeg * d)
  const fwd = nadir.clone().applyQuaternion(q)
  const tanH = Math.tan(15 * d)
  const v: StreamView = { pos: dir.clone().multiplyScalar(dist), right, up: up.applyQuaternion(q), back: fwd.clone().negate(), tanHalf: tanH, aspect: w / h, tanPerPx: 2 * tanH / h, moonX: new THREE.Vector3(1, 0, 0), moonY: new THREE.Vector3(0, 1, 0), moonZ: new THREE.Vector3(0, 0, 1) }
  const roll = new THREE.Quaternion().setFromAxisAngle(fwd, spin * d)
  v.right.applyQuaternion(roll); v.up.applyQuaternion(roll)
  return v
}

const pw = pageWidth(-4)
const ctx = { deepest: -2, isPresent: () => true, keyOf: (l: number, tx: number, ty: number) => (levelRow(l) + ty) * pw + tx }
for (const [dist, pitch] of [[60, 0], [60, 60], [400, 30], [20, 75]]) {
  const v = viewOver(1 + dist / MOON_R_KM, 12, 34, pitch, 20)
  const full = computeWanted(v, ctx)
  const mv = computeWanted({ ...v, moving: true }, ctx)
  for (const k of mv.keys()) assert.ok(full.has(k), `moving tile ${k} is in the full set (dist ${dist}, pitch ${pitch})`)
  assert.ok(mv.size >= 0.6 * full.size, `moving set keeps most tiles: ${mv.size} of ${full.size} (dist ${dist}, pitch ${pitch})`)
  const coarse = (m: Map<number, { level: number }>): number => [...m.values()].filter((w) => w.level === COARSEST_LEVEL).length
  assert.ok(coarse(mv) >= Math.ceil(coarse(full) / 2), 'most coarsest-level tiles (the resident fallback) survive the stride')
}
const base = { pos: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), back: new THREE.Vector3(), tanHalf: 1, aspect: 1, tanPerPx: 1, moonX: new THREE.Vector3(), moonY: new THREE.Vector3(), moonZ: new THREE.Vector3() }
assert.equal(reuseWanted({ ...base, moving: true }, 1000, 1000 + MOVING_WANTED_MS - 1), true, 'a young memo is reused while moving')
assert.equal(reuseWanted({ ...base, moving: true }, 1000, 1000 + MOVING_WANTED_MS), false, 'an old memo is recomputed')
assert.equal(reuseWanted({ ...base, moving: false }, 1000, 1001), false, 'at rest the set is always recomputed')
assert.equal(reuseWanted({ ...base, moving: true, flight: true }, 1000, 1001), false, 'flight demand bypasses the gesture throttle')
assert.equal(reuseWanted({ ...base }, 1000, 1001), false, 'moving unset means rest')
// F1: the strided memo of a gesture's last frames must not answer the first rest frame at the same pose (the streamers' memo path).
{
  const v = viewOver(1 + 60 / MOON_R_KM, 12, 34, 30, 20)
  const mv = { ...v, moving: true }
  const kMoving = wantedMemoKey(mv), kRest = wantedMemoKey(v)
  assert.notEqual(kMoving, kRest, 'moving is part of the memo identity')
  assert.equal(wantedMemoValid(kMoving, kRest, v, 1000, 1001), false, 'rest at the same pose recomputes (full set)')
  assert.equal(wantedMemoValid(kRest, kRest, v, 1000, 1001), true, 'rest reuses a rest memo')
  assert.equal(wantedMemoValid(kMoving, kMoving, mv, 1000, 1001), true, 'moving reuses its own memo')
  assert.equal(wantedMemoValid(kRest, kMoving, mv, 1000, 1001), true, 'a young memo still serves a moving frame')
  const fv = { ...mv, flight: true }
  assert.equal(wantedMemoValid(kMoving, kMoving, fv, 1000, 1001), false, 'a scripted flight recomputes every camera sample')
  assert.equal(wantedMemoValid(kMoving, wantedMemoKey(fv), fv, 1000, 1001, true, FLIGHT_WANTED_MS.tiles, mv, 1000), false, 'a flight cannot reuse a gesture memo')
  const fullFlight = computeWanted(fv, ctx)
  assert.equal(fullFlight.size, computeWanted(v, ctx).size, 'flight demand samples the full view, not the gesture stride')
  assert.notEqual(wantedMemoKey(v, '|3'), wantedMemoKey(v, '|4'), 'extra part of the key')
}
// R11: a flight reuses a young wanted set (staggered per-streamer windows) but never in a frame-stepped capture and never when old.
{
  const v = viewOver(1 + 60 / MOON_R_KM, 12, 34, 30, 20)
  const fv = { ...v, moving: true, flight: true }
  const k = wantedMemoKey(fv)
  assert.equal(wantedMemoValid(k, k, fv, 940, 1000 + FLIGHT_WANTED_MS.tiles - 1, true, FLIGHT_WANTED_MS.tiles, fv, 1000), true, 'TC/detail gesture staggering does not consume the flight window')
  for (const [name, window] of Object.entries({ tc: FLIGHT_WANTED_MS.tc, detail: FLIGHT_WANTED_MS.detail })) {
    assert.equal(wantedMemoValid(k, k, fv, 1000 - (name === 'tc' ? 60 : 30), 1000 + window - 1, true, window, fv, 1000), true, `${name} effective window starts at the real compute time`)
    assert.equal(wantedMemoValid(k, k, fv, 1000 - (name === 'tc' ? 60 : 30), 1000 + window, true, window, fv, 1000), false, `${name} recomputes when its effective window expires`)
  }
  assert.equal(wantedMemoValid(k, k, fv, 1000, 1000 + FLIGHT_WANTED_MS.tiles - 1, true, FLIGHT_WANTED_MS.tiles, fv, 1000), true, 'a continuous flight reuses a memo younger than its window')
  assert.equal(wantedMemoValid(k, k, fv, 1000, 1000 + FLIGHT_WANTED_MS.tiles, true, FLIGHT_WANTED_MS.tiles, fv, 1000), false, 'an old memo is recomputed in a flight')
  assert.equal(wantedMemoValid(k, k, { ...fv, flightReuse: false }, 1000, 1001, true, FLIGHT_WANTED_MS.tiles, fv, 1000), false, 'a capture frame always recomputes')
  assert.equal(wantedMemoValid(k, k, fv, 1000, 999, true, FLIGHT_WANTED_MS.tiles, fv, 1000), false, 'a clock that went back recomputes')
  const smallStep = { ...fv, pos: fv.pos.clone().multiplyScalar(1.0001) }
  assert.equal(wantedMemoValid(k, wantedMemoKey(smallStep), smallStep, 1000, 1001, true, FLIGHT_WANTED_MS.tiles, fv, 1000), true, 'small continuous motion reuses')
  const teleport = { ...fv, back: new THREE.Vector3(1, 0, 0) }
  assert.equal(wantedMemoValid(k, wantedMemoKey(teleport), teleport, 1000, 1001, true, FLIGHT_WANTED_MS.tiles, fv, 1000), false, 'a cut or teleport recomputes')
  const altitudeJump = { ...fv, pos: fv.pos.clone().multiplyScalar(1.1) }
  assert.equal(wantedMemoValid(k, wantedMemoKey(altitudeJump), altitudeJump, 1000, 1001, true, FLIGHT_WANTED_MS.tiles, fv, 1000), false, 'a large altitude change recomputes')
  const rotatedAxes = { ...fv, moonX: fv.moonX.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 360), moonY: fv.moonY.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 360), moonZ: fv.moonZ.clone() }
  assert.equal(wantedMemoValid(k, wantedMemoKey(rotatedAxes), rotatedAxes, 1000, 1001, true, FLIGHT_WANTED_MS.tiles, fv, 1000), false, 'a changed lunar frame recomputes')
  const lensChange = { ...fv, tanHalf: fv.tanHalf * 1.02 }
  assert.equal(wantedMemoValid(k, wantedMemoKey(lensChange), lensChange, 1000, 1001, true, FLIGHT_WANTED_MS.tiles, fv, 1000), false, 'a changed lens recomputes')
  const aspectChange = { ...fv, aspect: fv.aspect * 1.02 }
  assert.equal(wantedMemoValid(k, wantedMemoKey(aspectChange), aspectChange, 1000, 1001, true, FLIGHT_WANTED_MS.tiles, fv, 1000), false, 'a changed aspect recomputes')
  const flightChange = { ...fv, flightId: 2 }
  const identifiedFlight = { ...fv, flightId: 1 }
  assert.equal(wantedMemoValid(wantedMemoKey(identifiedFlight), wantedMemoKey(flightChange), flightChange, 1000, 1001, true, FLIGHT_WANTED_MS.tiles, identifiedFlight, 1000), false, 'a replacement flight recomputes')
  assert.equal(wantedMemoValid(wantedMemoKey(identifiedFlight), wantedMemoKey(identifiedFlight), identifiedFlight, 1000, 1001, true, FLIGHT_WANTED_MS.tiles, identifiedFlight, 1000), true, 'the same flight reuses')
  assert.ok(new Set(Object.values(FLIGHT_WANTED_MS)).size === 3, 'the three streamers recompute on different frames')
}
// J1: ?flightwant scales the flight windows (switch range 1..8; anything else is 1); wantResidency counts resident and stale tiles of an exact want.
{
  assert.equal(FLIGHT_WANTED_DEFAULT, 4, 'default is x4')
  assert.equal(flightWantedScale(''), FLIGHT_WANTED_DEFAULT, 'unset')
  assert.equal(flightWantedScale('?flightwant=1'), 1)
  assert.equal(flightWantedScale('?flightwant=2'), 2)
  assert.equal(flightWantedScale('flightwant=8'), 8)
  assert.equal(flightWantedScale('?flightwant=9'), FLIGHT_WANTED_DEFAULT, 'above range')
  assert.equal(flightWantedScale('?flightwant=0.5'), FLIGHT_WANTED_DEFAULT, 'below range')
  assert.equal(flightWantedScale('?flightwant=x'), FLIGHT_WANTED_DEFAULT, 'not a number')
  const mk = (key: number) => ({ key } as never)
  const exact = new Map([[1, mk(1)], [2, mk(2)], [3, mk(3)]])
  const memo = new Map([[1, mk(1)], [3, mk(3)]])
  assert.deepEqual(wantResidency(exact, memo, (k) => k !== 2), { wanted: 3, resident: 2, stale: 1 })
  assert.deepEqual(wantResidency(exact, null, () => true), { wanted: 3, resident: 3, stale: 0 })
}
console.log('wanted-moving ok')
