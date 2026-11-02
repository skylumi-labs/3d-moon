import assert from 'node:assert/strict'
import { EARTH_R_KM, MOON_R_KM } from '../src/glsl/common.ts'
import { SUN_R_KM } from '../src/lighting/solar.ts'
import { moonDiscInFrame, moonSubjectInFrame, sunInFrame, type SunFrameCamera, type VectorLike } from '../src/post/sunInFrame.ts'
import { stepGlareScale } from '../src/post/glareScale.ts'
import type { Exposure } from '../src/post/exposure.ts'
import { ExposureController } from '../src/post/exposureControl.ts'

const rad = (deg: number) => deg * Math.PI / 180
const camera: SunFrameCamera = {
  right: { x: Math.cos(rad(30)), y: 0, z: -Math.sin(rad(30)) },
  up: { x: 0, y: 1, z: 0 },
  back: { x: Math.sin(rad(30)), y: 0, z: Math.cos(rad(30)) },
  pos: { x: 0, y: 0, z: 2 },
  tanHalf: 0.5,
}
const earthPosition = { x: 0, y: 1e6, z: 0 }
const atSeparation = (separationDeg: number) => {
  const a = rad(separationDeg)
  const sunDirection = { x: -Math.sin(a), y: 0, z: -Math.cos(a) }
  const sunPosition = { x: camera.pos.x + sunDirection.x * 10000, y: camera.pos.y, z: camera.pos.z + sunDirection.z * 10000 }
  const input = { camera, aspect: 1, sunPosition, earthPosition, sunWhite: 50, wasOn: false, moonSubject: moonSubjectInFrame(camera, 1, false) }
  return { ...input, sunPosition }
}

// Original implementation retained here to show the precise edge failure.
function legacy(input: ReturnType<typeof atSeparation>, on: boolean): number {
  const sub = (a: VectorLike, b: VectorLike): VectorLike => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
  const dot = (a: VectorLike, b: VectorLike) => a.x * b.x + a.y * b.y + a.z * b.z
  const len = (a: VectorLike) => Math.hypot(a.x, a.y, a.z)
  const rel = sub(input.sunPosition, input.camera.pos)
  const dir = { x: rel.x / len(rel), y: rel.y / len(rel), z: rel.z / len(rel) }
  const back = dot(dir, input.camera.back)
  if (back >= 0) return 0
  const theta = Math.asin(SUN_R_KM / (len(rel) * MOON_R_KM))
  const x = dot(dir, input.camera.right) / -back, y = dot(dir, input.camera.up) / -back
  const margin = on ? 0.12 * input.camera.tanHalf : 0
  if (input.moonSubject) return 0
  if (Math.abs(x) > input.camera.tanHalf * input.aspect + theta + margin || Math.abs(y) > input.camera.tanHalf + theta + margin) return 0
  const hidden = (centre: VectorLike, radius: number): boolean => {
    const c = { x: centre.x / len(centre), y: centre.y / len(centre), z: centre.z / len(centre) }
    const cross = { x: dir.y * c.z - dir.z * c.y, y: dir.z * c.x - dir.x * c.z, z: dir.x * c.y - dir.y * c.x }
    return Math.atan2(len(cross), dot(dir, c)) < radius - theta + (on ? 0.6 * theta : 0)
  }
  const er = sub(input.earthPosition, input.camera.pos), ed = len(er)
  if (ed * MOON_R_KM > 1.5 * EARTH_R_KM && hidden(er, Math.asin(EARTH_R_KM / (ed * MOON_R_KM)))) return 0
  const moon = { x: -input.camera.pos.x, y: -input.camera.pos.y, z: -input.camera.pos.z }
  if (hidden(moon, Math.asin(Math.min(1, 1 / len(input.camera.pos))))) return 0
  return input.sunWhite
}

assert.equal(moonSubjectInFrame(camera, 1, false), false, 'camera framing keeps the Moon center outside the subject area')
for (const [distance, wasSubject, expected] of [
  [1.499, false, false], [1.499, true, true],
  [1.501, false, true], [1.501, true, true],
  [1.45, false, false], [1.45, true, true],
  [1.39, false, false], [1.39, true, false],
] as const) {
  const atDistance: SunFrameCamera = {
    right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, back: { x: 0, y: 0, z: 1 },
    pos: { x: 0, y: 0, z: distance }, tanHalf: camera.tanHalf,
  }
  assert.equal(moonSubjectInFrame(atDistance, 1, wasSubject), expected, `Moon subject at camera distance ${distance}, wasSubject=${wasSubject}`)
}
const moonDiscCameraAt = (distance: number): SunFrameCamera => ({
  right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, back: { x: 0, y: 0, z: 1 },
  pos: { x: 0, y: 0, z: distance }, tanHalf: 0.5,
})
assert.equal(moonDiscInFrame(moonDiscCameraAt(1), 1, false), false, 'Moon disc does not enter at or inside its surface radius')
assert.equal(moonDiscInFrame(moonDiscCameraAt(1), 1, true), true, 'Moon disc remains in frame at the enter threshold while held')
assert.equal(moonDiscInFrame(moonDiscCameraAt(0.94), 1, true), false, 'Moon disc releases below its hysteresis radius')
const angledMoonCamera: SunFrameCamera = {
  right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, back: { x: 0, y: 0, z: 1 },
  pos: { x: 2 * Math.sin(rad(50)), y: 0, z: 2 * Math.cos(rad(50)) }, tanHalf: 0.5,
}
assert.equal(moonDiscInFrame(angledMoonCamera, 1, false), true, 'a 30 degree Moon disc overlaps a 26.6 degree field at 50 degrees off axis')

assert.equal(stepGlareScale(null, 0.2, 0.01), 0.2, 'unset glare starts at its target')
assert.equal(stepGlareScale(0, 1, 0.1), 0.4, 'glare moves no faster than 4 units per second')
assert.equal(stepGlareScale(0.9, 1, 1), 1, 'glare does not overshoot its target')
assert.equal(stepGlareScale(0.1, 0, 1), 0, 'glare does not overshoot while falling')
assert.equal(stepGlareScale(0.1, 0.9, 0, true), 0.9, 'declared jumps take effect immediately')
assert.equal(stepGlareScale(0.1, 0.9, 0), 0.1, 'without elapsed time the glare does not step')
const theta = Math.asin(SUN_R_KM / (10000 * MOON_R_KM))
const firstOffThresholdDeg = (Math.asin(1 / camera.pos.z) - theta) * 180 / Math.PI
assert.ok(firstOffThresholdDeg > 27 && firstOffThresholdDeg < 29)

function sweep(decision: (sep: number, on: boolean) => boolean): number[] {
  const transitions: number[] = []
  let on = false, prev = false
  for (let i = 0; i <= 60; i++) {
    const sep = 24 + i * 0.2
    on = decision(sep, on)
    if (on !== prev) transitions.push(sep)
    prev = on
  }
  for (let i = 60; i >= 0; i--) {
    const sep = 24 + i * 0.2
    on = decision(sep, on)
    if (on !== prev) transitions.push(sep)
    prev = on
  }
  return transitions
}
const fixedTransitions = sweep((sep, wasOn) => sunInFrame({ ...atSeparation(sep), wasOn }).on)
assert.ok(fixedTransitions.length <= 2, `fixed hysteresis should change at most once in each direction: ${fixedTransitions}`)
const legacyTransitions = sweep((sep, wasOn) => legacy(atSeparation(sep), wasOn) > 0)
assert.ok(legacyTransitions.length > 2, `legacy slack should reproduce the edge flip-flop: ${legacyTransitions}`)

let seed = 0x12345678
const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 0x100000000 }
let on = false, toggles = 0, previous = false
for (let i = 0; i < 100; i++) {
  const sep = firstOffThresholdDeg + (random() * 0.1 - 0.05)
  on = sunInFrame({ ...atSeparation(sep), wasOn: on }).on
  if (on !== previous) toggles++
  previous = on
}
assert.ok(toggles <= 1, `grazing jitter must settle after no more than one toggle: ${toggles}`)

const exposure = (white: number): Exposure => ({
  white, preExpose: 1, esLevel: white * 1e-3, esLevelView: white * 1e-3, longMax: 0.05, hdr: 1, starLift: 0, whiteFloored: false, frameBrightest: white,
  search: { best: white, bestA: white, esMax: 0.5, hits: 10, samples: 100, sunlitFraction: 0.3, eclipseLevel: 0 },
})

// The Moon's full disc owns exposure as soon as its limb touches the frame.
// Sweep the camera across the limb and back while keeping the Sun centered.
const limbCamera = (angleDeg: number): SunFrameCamera => {
  const a = rad(angleDeg)
  return {
    right: { x: Math.cos(a), y: 0, z: -Math.sin(a) },
    up: { x: 0, y: 1, z: 0 },
    back: { x: Math.sin(a), y: 0, z: Math.cos(a) },
    pos: { x: 0, y: 0, z: 2 },
    tanHalf: 0.5,
  }
}
function limbWhite(camera: SunFrameCamera, wasOn: boolean, wasMoonInFrame: boolean, sunLook = false) {
  const sunPosition = {
    x: camera.pos.x - camera.back.x * 10000,
    y: camera.pos.y - camera.back.y * 10000,
    z: camera.pos.z - camera.back.z * 10000,
  }
  return sunInFrame({ camera, aspect: 1, sunPosition, earthPosition, sunWhite: 50, wasOn, moonSubject: false, wasMoonInFrame, sunLook })
}
let moonWasInFrame = false, sunWasOn = false
const outwardChanges: number[] = []
for (let angle = 44; angle <= 70; angle += 0.2) {
  const result = limbWhite(limbCamera(angle), sunWasOn, moonWasInFrame)
  if ((result.white > 0) !== sunWasOn) outwardChanges.push(angle)
  sunWasOn = result.on; moonWasInFrame = result.moonInFrame
}
assert.ok(outwardChanges.length <= 1, `Moon limb outward sweep changes white at most once: ${outwardChanges}`)
const inwardChanges: number[] = []
for (let angle = 70; angle >= 44; angle -= 0.2) {
  const result = limbWhite(limbCamera(angle), sunWasOn, moonWasInFrame)
  if ((result.white > 0) !== sunWasOn) inwardChanges.push(angle)
  sunWasOn = result.on; moonWasInFrame = result.moonInFrame
}
assert.ok(inwardChanges.length <= 1, `Moon limb inward sweep changes white at most once: ${inwardChanges}`)
const fullyOut = limbWhite(limbCamera(70), false, false)
assert.equal(fullyOut.moonInFrame, false, 'Moon is fully out beyond the release margin')
assert.equal(fullyOut.white, 50, 'Sun remains the exposure subject with the Moon fully out')
const sunLook = limbWhite(limbCamera(44), false, false, true)
assert.equal(sunLook.white, 50, 'Sun-directed scripted looks retain the Sun exposure while the Moon is in frame')

const controller = new ExposureController()
controller.step(exposure(0.012), 0)
controller.step(exposure(50), 100)
controller.step(exposure(0.012), 200)
const beforeThirdFlip = controller.step(exposure(50), 300)
const followedStops = Math.log2(beforeThirdFlip.white / 0.012)
assert.ok(followedStops > 0.05 && followedStops < 0.35, `alternating targets follow the normal bounded rate instead of cutting: ${followedStops.toFixed(3)} stops`)

console.log(`sun-in-frame.test.mts: hysteresis transitions ${fixedTransitions.length}, legacy ${legacyTransitions.length}, jitter ${toggles}: ok`)
