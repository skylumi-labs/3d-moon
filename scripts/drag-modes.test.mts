/**
 * One drag rule (owner 2026-10-31, phone walkthrough: "dragging the sky flies around the Moon; dragging the Moon rotates the Moon"; no Orbit / Turn
 * switch). Dragging the Moon turns its body frame under the fixed camera and lamp; dragging sky still flies the camera around it.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Quaternion, Vector3 } from 'three'
import { attachControls } from '../src/camera/controls.ts'
import { CameraRig } from '../src/camera/rig.ts'
import { homePose } from '../src/camera/pose.ts'
import { skyDragGain, spinRadiansPerPixel } from '../src/camera/grab.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { MoonSurfaceTurn, turnEphemeris } from '../src/camera/moonTurn.ts'

const W = 412, H = 915, aspect = W / H
const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))
const turnRight = new Vector3(1, 0, 0), turnUp = new Vector3(0, 1, 0), turnNorth = new Vector3(0, 0, 1)
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.match(mainSource, /turnMoon: \(cameraTurn, now\) => \{\s*const cam = rig\.camera\(ephem, canvasAspect\(\), now\)[\s\S]*?moonSurfaceTurn\.drag\(cameraTurn, now, cam\.right, cam\.up, clockEphemerisAt\(time\)\.moonZ\)/, 'the tested gesture supplies the camera basis and date north to the constrained MoonSurfaceTurn path')
assert.match(mainSource, /rig\.keepWorldPosition\(ephem, camera, now\)/, 'the shipped path preserves the world camera without settling')
assert.ok(mainSource.includes('hand turn is a visitor-local view gesture; share URLs always describe the Moon\'s real ephemeris geometry'), 'share URLs retain real Moon geometry')
class Canvas extends EventTarget {
  clientWidth = W; clientHeight = H
  getBoundingClientRect() { return { left: 0, top: 0, width: W, height: H } }
  setPointerCapture() {}
  hasPointerCapture() { return false }
  releasePointerCapture() {}
}
Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true })
const noop = (): void => {}

function setup(skyMatch: boolean | undefined, pose = homePose(e)) {
  const canvas = new Canvas()
  const rig = new CameraRig()
  const turn = new MoonSurfaceTurn()
  let viewE = e
  rig.auto = false
  rig.setPose({ ...pose })
  attachControls(canvas as unknown as HTMLCanvasElement, rig, {
    moved: noop, context: () => ({ e: viewE, aspect }), home: noop, escape: noop, now: noop, notes: noop, share: noop, timeStep: noop, flyTo: noop,
    turnMoon: (rotation: import('../src/camera/grab.ts').Rotation, now: number) => {
      const cam = rig.camera(viewE, aspect, now)
      turn.drag(rotation, now, cam.right, cam.up, e.moonZ)
      viewE = turnEphemeris(e, turn.orientation)
      rig.keepWorldPosition(viewE, cam, now)
    },
    stopMoonTurn: (now, phase) => { if (phase !== 'release') turn.stopInertia(); else turn.release(now) },
    ...(skyMatch === undefined ? {} : { skyDragMatch: () => skyMatch }),
  })
  let id = 0
  /** A one-finger drag from (x, y) by (dx, dy) in `n` steps; returns the angle (rad) the camera turned about the Moon's centre. */
  const drag = (x: number, y: number, dx: number, dy: number, n = 10): number => {
    const p = (type: string, px: number, py: number): boolean => canvas.dispatchEvent(Object.assign(new Event(type), { pointerId: id, clientX: px, clientY: py, buttons: type === 'pointerup' ? 0 : 1, pointerType: 'touch' }))
    id++
    const t0 = performance.now()
    const before = rig.camera(viewE, aspect, t0).pos.clone().normalize()
    p('pointerdown', x, y)
    for (let i = 1; i <= n; i++) p('pointermove', x + dx * i / n, y + dy * i / n)
    const after = rig.camera(viewE, aspect, performance.now()).pos.clone().normalize()
    p('pointercancel', x + dx, y + dy)
    rig.stopInertia()
    return before.angleTo(after)
  }
  return { rig, drag, turn, canvas, get viewE() { return viewE } }
}

// A new press and a cancelled gesture stop the existing Moon coast; an idle release also uses the 80 ms cutoff.
{
  const turn = new MoonSurfaceTurn()
  const rotation = { axis: new Vector3(0, 1, 0), angle: 0.08 }
  turn.drag(rotation, 0, turnRight, turnUp, turnNorth)
  assert.equal(turn.drag({ axis: rotation.axis, angle: 0 }, 10, turnRight, turnUp, turnNorth), false)
  turn.drag(rotation, 16, turnRight, turnUp, turnNorth)
  const before = turn.orientation.clone()
  turn.stopInertia() // pointerdown / pointercancel hook
  assert.equal(turn.step(0.05), false, 'pointerdown or pointercancel stops the coast')
  assert.ok(turn.orientation.angleTo(before) < 1e-12, 'stopping momentum preserves the body turn')
  turn.drag(rotation, 100, turnRight, turnUp, turnNorth)
  turn.drag(rotation, 116, turnRight, turnUp, turnNorth)
  turn.release(197)
  assert.equal(turn.step(0.05), false, 'an idle release over 80 ms stops the coast')
}

// Where the disc and the sky are at Home on a phone in portrait (the frame spots the rig itself reports).
const probe = new CameraRig(); probe.setPose(homePose(e))
const ndc = (x: number, y: number): { nx: number; ny: number } => ({ nx: x / W * 2 - 1, ny: 1 - y / H * 2 })
let centre: { x: number; y: number } | null = null
for (let r = 0; r < 200 && !centre; r += 4) for (const [x, y] of [[W / 2, H / 2 - r], [W / 2, H / 2 + r]]) {
  const c = ndc(x, y)
  if (probe.pickMoon(c.nx, c.ny, e, aspect, 0)) { centre = { x, y }; break }
}
assert.ok(centre, 'the Moon is in the middle of the phone frame at Home')
// The disc's visible centre: the middle of its vertical extent through the frame's middle column.
let top = centre!.y, bottom = centre!.y
while (top > 0 && probe.pickMoon(ndc(W / 2, top - 1).nx, ndc(W / 2, top - 1).ny, e, aspect, 0)) top--
while (bottom < H && probe.pickMoon(ndc(W / 2, bottom + 1).nx, ndc(W / 2, bottom + 1).ny, e, aspect, 0)) bottom++
const discY = (top + bottom) / 2
const sky = { x: W / 2, y: Math.max(8, top - 60) }
assert.equal(probe.pickMoon(ndc(sky.x, sky.y).nx, ndc(sky.x, sky.y).ny, e, aspect, 0), null, 'the spot above the disc is sky')

// The actual controls wiring stops a recent fling on pointerdown and on pointercancel.
{
  for (const ending of ['pointerdown', 'pointercancel'] as const) {
    const moon = setup(undefined)
    moon.canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerId: 40, clientX: W / 2, clientY: discY, buttons: 1, pointerType: 'touch' }))
    if (ending === 'pointercancel') {
      const at = performance.now()
      moon.turn.drag({ axis: new Vector3(0, 1, 0), angle: 0.08 }, at - 16, turnRight, turnUp, turnNorth)
      moon.turn.drag({ axis: new Vector3(0, 1, 0), angle: 0.08 }, at, turnRight, turnUp, turnNorth)
      moon.canvas.dispatchEvent(Object.assign(new Event('pointercancel'), { pointerId: 40, clientX: W / 2, clientY: discY, buttons: 0, pointerType: 'touch' }))
    } else {
      moon.turn.drag({ axis: new Vector3(0, 1, 0), angle: 0.08 }, 100, turnRight, turnUp, turnNorth)
      moon.turn.drag({ axis: new Vector3(0, 1, 0), angle: 0.08 }, 116, turnRight, turnUp, turnNorth)
      moon.canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerId: 41, clientX: W / 2, clientY: discY, buttons: 1, pointerType: 'touch' }))
    }
    assert.equal(moon.turn.step(0.05), false, `${ending} stops recent Moon momentum`)
  }
}

// Ground mode freezes the rig: looking around there must not invoke the Moon turn path.
{
  const ground = setup(undefined)
  ground.rig.frozen = true
  const before = ground.turn.orientation.clone()
  ground.drag(W / 2, discY, 30, 0)
  assert.ok(ground.turn.orientation.angleTo(before) < 1e-12, 'a frozen/ground drag does not turn the Moon')
}

// The shipped Moon-turn route preserves rig state instead of creating a free orientation.
{
  const moon = setup(undefined)
  moon.rig.auto = true
  moon.rig.fovDeg = 41
  moon.rig.aimShift = 0.08
  moon.rig.aimShiftX = -0.03
  moon.rig.setLookBlend(0.6, e.earthDir)
  moon.drag(W / 2, discY, 30, 0)
  const state = moon.rig.debugState()
  assert.equal(state.settledOffset, null, 'a Moon turn does not create a settled offset')
  assert.equal(moon.rig.hasScriptState(), true, 'the pre-existing Earth look remains the only script state')
  assert.equal(moon.rig.auto, true, 'a Moon turn does not disable auto orbit')
  assert.equal(moon.rig.fovDeg, 41, 'a Moon turn keeps the lens')
  assert.equal(moon.rig.aimShift, 0.08, 'a Moon turn keeps vertical aim')
  assert.equal(moon.rig.aimShiftX, -0.03, 'a Moon turn keeps horizontal aim')
  assert.equal(state.lookTarget, 'body', 'a Moon turn keeps the Earth look target')
  assert.equal(state.lookBlendW, 0.6, 'a Moon turn keeps the Earth blend')
}

// 1. A short Moon drag turns the surface by about the camera angle of an equal sky drag (default: skyDragMatch on).
for (const [dx, dy] of [[30, 0], [0, 30], [-21, 21]] as const) {
  const moon = setup(undefined)
  moon.drag(W / 2, discY, dx, dy)
  const a = moon.turn.orientation.angleTo(new Quaternion())
  const b = setup(undefined).drag(sky.x, sky.y, dx, dy)
  assert.ok(a > 0 && b > 0, 'Moon drag turns the surface and sky drag turns the camera')
  const ratio = b / a
  assert.ok(ratio > 0.85 && ratio < 1.18, `sky drag (${(b * 180 / Math.PI).toFixed(2)} deg) matches the grab of the disc's centre (${(a * 180 / Math.PI).toFixed(2)} deg) for (${dx}, ${dy}): ratio ${ratio.toFixed(3)}`)
  // ?skydrag=damped keeps the older sky rate: about 1 / sqrt(1 + altitude) of the grab at Home (2.6 radii up: 0.53).
  const old = setup(false).drag(sky.x, sky.y, dx, dy)
  assert.ok(old / a < 0.7, `damped sky drag is the old, slower rate (${(old / a).toFixed(3)})`)
}

// 2. The gain is 1 at the ground (close in nothing changes: the fly-over is today's) and sqrt(1 + altitude) above it.
assert.equal(skyDragGain(0), 1)
assert.equal(skyDragGain(-0.01), 1, 'a camera under its floor counts as on the ground')
assert.ok(Math.abs(skyDragGain(2.6) - Math.sqrt(3.6)) < 1e-12)
const alt = 2.6, fov = 30, short = 412
assert.ok(Math.abs(spinRadiansPerPixel(alt, fov, short) * skyDragGain(alt) - alt * fov / short * Math.PI / 180) < 1e-12, 'sky rate x gain = altitude x the pixel angle (the grab at the centre)')
// Close to the surface (0.02 radii up) the sky drag rate changes by 1 % at most.
assert.ok(skyDragGain(0.02) < 1.01)

// 3. A Moon drag rotates body axes while the camera and world-space lamp remain fixed; sky drag keeps the camera-orbit behavior.
{
  const s = setup(undefined)
  const camBefore = s.rig.camera(s.viewE, aspect, performance.now())
  const xBefore = s.viewE.moonX.clone()
  const sunBefore = s.viewE.sunDir.clone(), earthBefore = s.viewE.earthDir.clone()
  s.drag(W / 2, discY, 120, 40, 30)
  const camAfter = s.rig.camera(s.viewE, aspect, performance.now())
  assert.ok(camBefore.pos.distanceTo(camAfter.pos) < 1e-8, 'Moon drag leaves the camera fixed in world space')
  assert.ok(camBefore.back.distanceTo(camAfter.back) < 1e-8, 'Moon drag leaves the view direction fixed')
  assert.ok(xBefore.angleTo(s.viewE.moonX) > 0.01, 'Moon drag turns the body frame')
  assert.ok(s.viewE.sunDir.equals(sunBefore) && s.viewE.earthDir.equals(earthBefore), 'Sun and Earth stay at their clock positions')
  const skyDrag = setup(undefined)
  const skyBefore = skyDrag.rig.camera(e, aspect, performance.now()).pos.clone()
  skyDrag.drag(sky.x, sky.y, -160, 90, 30)
  assert.ok(skyBefore.distanceTo(skyDrag.rig.camera(e, aspect, performance.now()).pos) > 0.01, 'sky drag still moves the camera')
  for (const k of ['dragMode', 'turnHook', 'spinHook']) assert.equal(k in (s.rig as unknown as Record<string, unknown>), false, `no drag mode hook on the rig`)
}

// 4. The wiring: no switch, no T key, no held lighting anywhere.
const read = (p: string): string => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const main = read('main.ts'), controls = read('camera/controls.ts'), tc = read('ui/touchControls.ts'), bar = read('ui/bar.ts'), share = read('ui/shareView.ts')
assert.doesNotMatch(main, /sunHold|SunHold|turnTime|spinSun|setDragMode|dragMode|orbitSpin|lightingHeld/, 'main.ts has no drag mode or held Sun')
assert.match(main, /skyDragMatch: \(\) => SKY_DRAG_MATCH/, 'main hands the sky-rate switch to the controls')
assert.match(main, /const SKY_DRAG_MATCH = params\.get\('skydrag'\) !== 'damped'/)
assert.doesNotMatch(controls, /toggleMode|case 't'/, 'the T key no longer switches modes')
assert.doesNotMatch(tc, /modeSwitch|dragMode/, 'the pad has no mode switch')
assert.doesNotMatch(bar, /bar-held|LIGHTING_HELD/, 'the time sheet has no "Lighting held" tag')
assert.doesNotMatch(share, /sunhold/, 'a link no longer writes or reads a held Sun')
// A fly view's link always names its roll (#369's fix, kept: a levelled view reopened turned by Home's roll).
assert.match(share, /out\.push\(\['roll', f\(s\.pose\.roll \|\| 0, 2\)\]\)/)
console.log('drag-modes ok')

// A drag that starts on the disc stays a Moon turn however far it travels, past the limb and across the sky; the camera never orbits
// (the old hand-off to the sky drag rolled the view: a tilted terminator, the dark side turned down).
{
  const canvas = new Canvas()
  const rig = new CameraRig()
  rig.auto = false
  rig.setPose({ ...homePose(e) })
  let travelled = 0, calls = 0
  attachControls(canvas as unknown as HTMLCanvasElement, rig, {
    moved: noop, context: () => ({ e, aspect }), home: noop, escape: noop, now: noop, notes: noop, share: noop, timeStep: noop, flyTo: noop,
    turnMoonBy: (dx, dy) => { travelled += Math.hypot(dx, dy); calls++ },
  })
  const p = (type: string, px: number, py: number): boolean => canvas.dispatchEvent(Object.assign(new Event(type), { pointerId: 90, clientX: px, clientY: py, buttons: type === 'pointerup' ? 0 : 1, pointerType: 'touch' }))
  const before = rig.camera(e, aspect, performance.now())
  p('pointerdown', W / 2, discY)
  for (let i = 1; i <= 40; i++) p('pointermove', W / 2 + 9 * i, discY - 14 * i)
  p('pointerup', W / 2 + 360, discY - 560)
  const after = rig.camera(e, aspect, performance.now())
  assert.ok(calls >= 38 && travelled > 500, `every move of the drag turned the Moon (${calls} calls, ${travelled.toFixed(0)} px)`)
  assert.ok(before.pos.angleTo(after.pos) < 1e-9 && before.up.angleTo(after.up) < 1e-9, 'the camera neither orbits nor rolls during a long Moon drag')
}

// Review: turn, change the date (settle: a free orientation), turn again. keepWorldPosition must keep the rendered camera exactly,
// with the settled offset rebuilt, not a roll written on top of it (that rolled the view about 12 degrees per drag event).
{
  const rig = new CameraRig()
  rig.auto = false
  rig.setPose({ ...homePose(e) })
  const t0 = performance.now()
  rig.settle(e, aspect, t0)
  const turn = new MoonSurfaceTurn()
  let viewE = e
  for (let i = 1; i <= 40; i++) {
    const before = rig.camera(viewE, aspect, t0 + i)
    turn.dragBy(0.01, 0.006, t0 + i * 16, before.right, e.moonZ)
    viewE = turnEphemeris(e, turn.orientation)
    rig.keepWorldPosition(viewE, before, t0 + i)
    const after = rig.camera(viewE, aspect, t0 + i)
    assert.ok(after.pos.distanceTo(before.pos) < 1e-9 && after.up.angleTo(before.up) < 1e-6 && after.back.angleTo(before.back) < 1e-6,
      `step ${i}: the settled camera neither moves nor rolls under a turn (up ${after.up.angleTo(before.up)})`)
  }
}
