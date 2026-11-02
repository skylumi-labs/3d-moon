/**
 * Two-finger vertical drag tilts the view smoothly (owner 2026-10-31, phone walkthrough: the tilt was "zappy"); pinch stays zoom.
 * Synthetic touch tracks, one finger per event as a touch screen delivers them, through the pure classifier (camera/gesture.ts) and through the
 * real pointer handlers and rig (camera/controls.ts, camera/rig.ts).
 */
import assert from 'node:assert/strict'
import { TILT_EXIT_MAX_PX, TILT_START_PX, newTwoFingerState, tiltExitPx, twoFingerStep } from '../src/camera/gesture.ts'
import { attachControls } from '../src/camera/controls.ts'
import { CameraRig } from '../src/camera/rig.ts'
import { ephemerisAt } from '../src/ephemeris.ts'

type P = { x: number; y: number }
/** Replays frames of [A, B] (A reports, then B); returns the per-event tilt and zoom and the final mode. */
function replay(frames: Array<[P, P]>) {
  const st = newTwoFingerState()
  let pa = frames[0]![0], pb = frames[0]![1]
  const tilts: number[] = [], zooms: number[] = []
  for (let i = 1; i < frames.length; i++) {
    const [a, b] = frames[i]!
    for (const [na, nb] of [[a, pb], [a, b]] as const) { const r = twoFingerStep(pa, pb, na, nb, st); tilts.push(r.tilt); zooms.push(r.zoom); pa = na; pb = nb }
  }
  return { st, tilts, zooms, tilt: tilts.reduce((s, v) => s + v, 0), zoom: zooms.reduce((s, v) => s * v, 1) }
}
let seed = 7
const rnd = (): number => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296

// 1. A long vertical two-finger drag whose spread wanders as a real hand's does (up to +-6 px over 300 px of travel, plus tremor) stays a tilt
//    from start to end: it tilts by the whole travel and never zooms. (Before: a 3 to 4 px spread change after the confirmation turned it into a
//    zoom halfway, the rest of the drag did nothing, a small zoom happened instead.)
for (let trial = 0; trial < 40; trial++) {
  const dir = trial % 2 ? 1 : -1, n = 60 + Math.floor(rnd() * 60), travel = 300 * dir, wander = (rnd() * 2 - 1) * 6, sx = 140 + rnd() * 80
  const frames: Array<[P, P]> = []
  for (let i = 0; i <= n; i++) {
    const u = i / n
    // The wander grows with the travel (a hand opens or closes a little as it moves), so the early tilt is clean, as it is on the glass.
    const drift = wander * u * u + (rnd() - 0.5) * 0.6
    const y = 500 + travel * u
    frames.push([{ x: 200 - sx / 2 - drift / 2 + (rnd() - 0.5) * 0.8, y: y + (rnd() - 0.5) * 0.8 }, { x: 200 + sx / 2 + drift / 2, y: y + (rnd() - 0.5) * 0.8 }])
  }
  const r = replay(frames)
  assert.equal(r.st.mode, 'tilt', `trial ${trial}: still a tilt at the end (spread wander ${wander.toFixed(1)} px)`)
  assert.equal(r.zoom, 1, `trial ${trial}: no zoom`)
  // The whole travel less what passed while the decision was pending (TILT_START_PX and a frame or two).
  assert.ok(Math.sign(r.tilt) === Math.sign(travel) && Math.abs(r.tilt - travel) < 32, `trial ${trial}: tilted by the travel past the start (a hand's tremor can hold the decision a few frames past TILT_START_PX) (${r.tilt.toFixed(1)} of ${travel})`)
  // No jump: no event tilts more than one frame's finger step (plus tremor).
  const stepPx = Math.abs(travel) / n + 1
  for (const [k, t] of r.tilts.entries()) assert.ok(Math.abs(t) <= stepPx, `trial ${trial} event ${k}: ${t.toFixed(2)} px (finger step ${stepPx.toFixed(2)})`)
}

// 1b. Front-loaded noise (the finger pads flatten at touch-down: +-1.5 px of spread jitter in the first 20 px) still confirms a tilt soon.
for (let trial = 0; trial < 30; trial++) {
  const frames: Array<[P, P]> = []
  for (let i = 0; i <= 80; i++) {
    const y = 300 + 3 * i, j = i * 3 < 20 ? (rnd() * 2 - 1) * 1.5 : (rnd() - 0.5) * 0.4
    frames.push([{ x: 120 - j / 2, y }, { x: 300 + j / 2, y: y + (rnd() - 0.5) * 0.6 }])
  }
  const r = replay(frames)
  assert.equal(r.st.mode, 'tilt', `noisy start ${trial}: a tilt`)
  assert.ok(r.tilt > 240 - 40, `noisy start ${trial}: confirmed within 40 px (${r.tilt.toFixed(1)} of 240)`)
}

// 2. The start: nothing until TILT_START_PX of common travel; then the tilt runs at the fingers' own speed from the first step (no catch-up, no jump).
{
  const frames: Array<[P, P]> = []
  for (let i = 0; i <= 40; i++) frames.push([{ x: 120, y: 400 + 2 * i }, { x: 300, y: 400 + 2 * i }])
  const r = replay(frames)
  const steps = r.tilts.filter((t) => t !== 0)
  for (const t of steps) assert.ok(Math.abs(t - 2) < 1e-9, `every tilt step is the fingers' 2 px (${t})`)
  assert.ok(Math.abs(r.tilt - (80 - TILT_START_PX)) < 1e-9, `the travel past the start arrives (${r.tilt})`)
}

// 3. A deliberate pinch after a tilt still becomes a zoom; the exit threshold grows with the tilt's travel and is capped.
{
  const st = newTwoFingerState()
  st.spread0 = 160
  assert.equal(tiltExitPx(st), 3.2, 'a fresh tilt exits at the zoom threshold')
  st.tiltTravel = 60
  assert.equal(tiltExitPx(st), 15)
  st.tiltTravel = 1000
  assert.equal(tiltExitPx(st), TILT_EXIT_MAX_PX, 'capped: a long tilt still yields to a real pinch')
  const frames: Array<[P, P]> = []
  for (let i = 0; i <= 50; i++) frames.push([{ x: 120, y: 300 + 4 * i }, { x: 280, y: 300 + 4 * i }])
  for (let i = 1; i <= 30; i++) frames.push([{ x: 120 - 3 * i, y: 500 }, { x: 280 + 3 * i, y: 500 }])
  const r = replay(frames)
  assert.equal(r.st.mode, 'zoom', 'spreading the fingers after a tilt zooms')
  assert.ok(r.zoom < 0.6, `by the spread change (${r.zoom.toFixed(3)})`)
  const worst = Math.max(...r.zooms.map((z) => Math.abs(Math.log(z))))
  assert.ok(worst < 0.03, `no zoom jump at the switch (largest step ${worst.toFixed(4)} as a log ratio; one finger step is ~0.017)`)
}
// 3b. A pinch along a vertical axis inside a tilt (fingers stacked, mostly the bottom one moving) does not tilt while it builds up to the exit.
{
  const frames: Array<[P, P]> = []
  for (let i = 0; i <= 40; i++) frames.push([{ x: 200, y: 200 + 3 * i }, { x: 205, y: 360 + 3 * i }])
  const st = newTwoFingerState()
  let pa = frames[0]![0], pb = frames[0]![1], during = 0
  const go = (na: P, nb: P, count: boolean): void => { const t = twoFingerStep(pa, pb, na, nb, st).tilt; if (count) during += t; pa = na; pb = nb }
  for (let i = 1; i < frames.length; i++) { go(frames[i]![0], pb, false); go(frames[i]![0], frames[i]![1], false) }
  assert.equal(st.mode, 'tilt')
  for (let i = 1; i <= 30; i++) { go({ x: 200, y: 320 + 0.15 * i }, pb, true); go(pa, { x: 205, y: 480 + 2.1 * i }, true) }
  assert.ok(Math.abs(during) <= 1, `the pinch tilts at most 1 px (${during.toFixed(2)})`)
  assert.equal(st.mode, 'zoom', 'and becomes a zoom')
}

// 3c. A one-finger pinch inside a tilt (the thumb held still, sending no events) still becomes a zoom (review of 2026-10-31).
{
  const st = newTwoFingerState()
  let pa = { x: 120, y: 300 }, pb = { x: 300, y: 300 }
  for (let i = 1; i <= 14; i++) { const na = { x: 120, y: 300 + 3 * i }; twoFingerStep(pa, pb, na, pb, st); pa = na; const nb = { x: 300, y: 300 + 3 * i }; twoFingerStep(pa, pb, pa, nb, st); pb = nb }
  assert.equal(st.mode, 'tilt')
  let zoom = 1
  for (let i = 1; i <= 40; i++) { const na = { x: 120 - 2 * i, y: pa.y }; zoom *= twoFingerStep(pa, pb, na, pb, st).zoom; pa = na }
  assert.equal(st.mode, 'zoom', 'the one-finger pinch exits the tilt')
  assert.ok(zoom < 0.85, `and zooms (${zoom.toFixed(3)})`)
}
// 3d. A slow drag with tremor delivers its travel (a step held for its spread change is deferred, not dropped).
{
  const frames: Array<[P, P]> = []
  for (let i = 0; i <= 200; i++) { const y = 300 + i, n1 = (rnd() - 0.5) * 1, n2 = (rnd() - 0.5) * 1; frames.push([{ x: 120 + n1, y: y + n2 * 0.3 }, { x: 300 - n2, y: y - n1 * 0.3 }]) }
  const r = replay(frames)
  assert.equal(r.st.mode, 'tilt')
  assert.ok(r.tilt > 200 - 40, `a 1 px/frame drag with +-0.5 px tremor tilts ${r.tilt.toFixed(1)} of 200 px`)
}

// 4. Through the real handlers and rig: the pitch follows the fingers smoothly; lifting one finger and moving the other does not orbit the camera.
{
  class Canvas extends EventTarget {
    clientWidth = 412; clientHeight = 915
    getBoundingClientRect() { return { left: 0, top: 0, width: 412, height: 915 } }
    setPointerCapture() {}
    hasPointerCapture() { return false }
    releasePointerCapture() {}
  }
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true })
  const canvas = new Canvas()
  const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
  const rig = new CameraRig(); rig.auto = false
  rig.setPose({ lon: -20, lat: 10, dist: 1.6, roll: 0, pitch: 0 })
  const noop = (): void => {}
  attachControls(canvas as unknown as HTMLCanvasElement, rig, { moved: noop, context: () => ({ e, aspect: 412 / 915 }), home: noop, escape: noop, now: noop, notes: noop, share: noop, timeStep: noop, flyTo: noop })
  const p = (type: string, id: number, x: number, y: number): boolean => canvas.dispatchEvent(Object.assign(new Event(type), { pointerId: id, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1, pointerType: 'touch' }))
  p('pointerdown', 1, 140, 300); p('pointerdown', 2, 280, 300)
  const pitches: number[] = []
  for (let i = 1; i <= 50; i++) { p('pointermove', 1, 140, 300 + 4 * i); p('pointermove', 2, 280, 300 + 4 * i); pitches.push(rig.pose.pitch ?? 0) }
  assert.ok(pitches.at(-1)! > 5, `two fingers down tilt the view toward the horizon (the rig's long-standing direction) (${pitches.at(-1)!.toFixed(2)} deg)`)
  const steps = pitches.slice(1).map((v, i) => v - pitches[i]!)
  const fingerDeg = 4 * rig.fovDeg / 412
  for (const [k, s] of steps.entries()) assert.ok(s >= -1e-9 && s <= fingerDeg + 1e-9 || pitches[k + 1] === rig.tiltLimit(), `pitch step ${s.toFixed(3)} deg within the fingers' ${fingerDeg.toFixed(3)}`)
  const pose = { ...rig.pose }
  // Finger 1 lifts first; finger 2 goes on moving (diagonally, as it does when a hand comes off the glass).
  p('pointerup', 1, 140, 500)
  for (let i = 1; i <= 15; i++) p('pointermove', 2, 280 + 3 * i, 500 + 2 * i)
  assert.deepEqual(rig.pose, pose, 'the finger left after a tilt does not orbit the camera')
  p('pointerup', 2, 325, 530)
  // A fresh one-finger drag afterwards moves the camera as always.
  p('pointerdown', 3, 200, 450)
  for (let i = 1; i <= 10; i++) p('pointermove', 3, 200 + 5 * i, 450)
  p('pointerup', 3, 250, 450)
  assert.notDeepEqual({ lon: rig.pose.lon, lat: rig.pose.lat }, { lon: pose.lon, lat: pose.lat }, 'a new drag orbits again')
  // After a pinch (not a tilt) the remaining finger still drags, as before.
  rig.stopInertia()
  p('pointerdown', 4, 150, 500); p('pointerdown', 5, 260, 500)
  for (let i = 1; i <= 12; i++) { p('pointermove', 4, 150 - 4 * i, 500); p('pointermove', 5, 260 + 4 * i, 500) }
  p('pointerup', 4, 102, 500)
  const afterPinch = { ...rig.pose }
  for (let i = 1; i <= 10; i++) p('pointermove', 5, 308 - 5 * i, 500 + 3 * i)
  assert.notDeepEqual(rig.pose, afterPinch, 'after a pinch the remaining finger drags as before')
  p('pointerup', 5, 258, 530)
}
console.log('two-finger-tilt ok')
