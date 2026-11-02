import assert from 'node:assert/strict'
import { attachControls, DRAG_START_PX } from '../src/camera/controls.ts'
import { CameraRig } from '../src/camera/rig.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { FenceGrid, PRESS_YIELD_MS, fullMotionSafe, measuredStart, motionActive, pressYieldActive, refinePlan, setFixedShare } from '../src/post/motionGrid.ts'
import { readFileSync } from 'node:fs'
import { EYE_HEIGHT_M, WALK_SPEED_FAST } from '../src/ground/GroundCamera.ts'
import { GroundMode } from '../src/ground/GroundMode.ts'
import { R_M, viewFromGround } from '../src/ground/frame.ts'
import type { GroundSample } from '../src/ground/GroundPass.ts'
import { Vector3 } from 'three'

// Exercise the actual pointer handlers: no movement notifications or pose changes
// for a press or hand jitter, while a real drag and pinch still operate.
class Canvas extends EventTarget {
  clientWidth = 800; clientHeight = 600
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 } }
  setPointerCapture() {}
}
const canvas = new Canvas()
Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true })
const rig = new CameraRig()
rig.auto = false
rig.setPose({ lon: -53.17, lat: 9.5, dist: 1.1635, pitch: 0.37, roll: 0 })
let moved = 0, flew = 0
const noop = () => {}
attachControls(canvas as unknown as HTMLCanvasElement, rig, {
  moved: () => moved++, context: () => ({e: ephemerisAt(new Date('2026-10-08T03:07:16Z')), aspect: 4 / 3}),
  home: noop, escape: noop, now: noop, notes: noop, share: noop, timeStep: noop, flyTo: () => flew++,
})
const pointer = (type: string, x: number, y: number, id = 1) => canvas.dispatchEvent(Object.assign(new Event(type), { pointerId: id, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }))
const pose = { ...rig.pose }
pointer('pointerdown', 400, 300)
assert.equal(rig.dragging, true, 'press still stops inertia and auto orbit')
assert.equal(moved, 0)
assert.equal(motionActive(false, rig.dragging, false, Infinity), false, 'stationary held press keeps full quality')
pointer('pointermove', 400 + DRAG_START_PX - 1, 300)
assert.equal(moved, 0, 'hand jitter does not trigger motion quality')
assert.deepEqual(rig.pose, pose)
pointer('pointerup', 400, 300)
assert.equal(rig.dragging, false)
// The next tap preserves double-tap navigation.
pointer('pointerdown', 400, 300); pointer('pointerup', 400, 300)
assert.equal(flew, 1)
pointer('pointerdown', 400, 300)
pointer('pointermove', 410, 300)
assert.equal(moved, 1, 'first deliberate movement starts immediately')
assert.notDeepEqual(rig.pose, pose)
assert.equal(motionActive(false, true, true, 100), true, 'a held established drag does not repeatedly refine')
pointer('pointercancel', 410, 300)
assert.equal(rig.dragging, false)
assert.equal(motionActive(false, false, true, 101), false, 'release refines after the short idle hold')
assert.equal(motionActive(false, false, true, 65), true, 'brief gaps between wheel or inertia events do not flash full detail')
assert.equal(motionActive(true, false, false, Infinity), true, 'scripted camera movement still renders motion frames')
pointer('pointerdown', 400, 300)
canvas.dispatchEvent(Object.assign(new Event('lostpointercapture'), { pointerId: 1 }))
assert.equal(rig.dragging, false, 'lost pointer capture releases the camera')
// A second finger arriving or reporting unchanged coordinates is not a pinch.
pointer('pointerdown', 300, 300); pointer('pointerdown', 500, 300, 2)
const beforePinch = moved
pointer('pointermove', 300, 300); pointer('pointermove', 500, 300, 2)
assert.equal(moved, beforePinch)
pointer('pointermove', 280, 300); pointer('pointermove', 520, 300, 2)
assert.ok(moved > beforePinch, 'actual pinch still moves')
pointer('pointerup', 280, 300); pointer('pointerup', 520, 300, 2)

// A wheel event takes ownership of the camera and must clear any drag coast first.
{
  const wheelCanvas = new Canvas()
  const wheelRig = new CameraRig()
  wheelRig.setFloor(1)
  wheelRig.setPose({ lon: -53.17, lat: 9.5, dist: 4, pitch: 0, roll: 0 })
  const eph = ephemerisAt(new Date('2026-10-08T03:07:16Z'))
  const cancelWheelZoom = attachControls(wheelCanvas as unknown as HTMLCanvasElement, wheelRig, {
    moved: noop, context: () => ({ e: eph, aspect: 4 / 3 }),
    home: noop, escape: noop, now: noop, notes: noop, share: noop, timeStep: noop, flyTo: noop,
  })
  const start = performance.now()
  for (let i = 0; i < 10; i++) wheelRig.orbit(20, 0, 800, start + i * 16)
  wheelRig.release(start + 10 * 16)
  const event = Object.assign(new Event('wheel', { cancelable: true }), {
    deltaY: -40, deltaMode: 0, ctrlKey: false, clientX: 400, clientY: 300,
  })
  const beforeWheel = { ...wheelRig.pose }
  const rafDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
  const cancelDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')
  let nextFrame = 1
  const frames = new Map<number, FrameRequestCallback>()
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (cb: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, cb); return id } })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: (id: number) => { frames.delete(id) } })
  try {
    wheelCanvas.dispatchEvent(event)
    wheelCanvas.dispatchEvent(event)
    const afterWheel = { ...wheelRig.pose }
    assert.deepEqual(afterWheel, beforeWheel, 'wheel input queues a smooth zoom instead of stepping immediately')
    let frameTime = start
    for (let i = 0; frames.size && i < 120; i++) {
      const [id, cb] = frames.entries().next().value as [number, FrameRequestCallback]
      frames.delete(id)
      frameTime += 16
      cb(frameTime)
    }
    assert.equal(frames.size, 0, 'wheel easing settles without leaving a scheduled frame')
    assert.ok(wheelRig.pose.dist < afterWheel.dist - 0.1, 'consecutive wheel events accumulate into one eased zoom')
    wheelRig.step(performance.now() + 1000, 0.016)
    assert.ok(wheelRig.pose.dist < 4, 'wheel zoom does not inherit a prior drag velocity')
    const beforeCancel = { ...wheelRig.pose }
    wheelCanvas.dispatchEvent(event)
    cancelWheelZoom()
    assert.equal(frames.size, 0, 'an external camera action can cancel the pending wheel tail')
    assert.deepEqual(wheelRig.pose, beforeCancel, 'cancelling a pending tail does not move the camera')
  } finally {
    if (rafDescriptor) Object.defineProperty(globalThis, 'requestAnimationFrame', rafDescriptor)
    else delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame
    if (cancelDescriptor) Object.defineProperty(globalThis, 'cancelAnimationFrame', cancelDescriptor)
    else delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame
  }
}

setFixedShare(0.85)
const sample = { ms: 9.5, scale: 0.35, at: 1000 }
assert.equal(measuredStart(sample, 1100, 16.67, 0.35), 0.7, 'fixed GPU work survives gesture boundaries; start at the finest fitting grid')
assert.equal(measuredStart(sample, 12000, 16.67, 0.35), 0.35, 'expired evidence cannot force high quality')
assert.equal(measuredStart(null, 1100, 16.67, 0.35), 0.35, 'unknown device keeps a conservative start')
assert.equal(fullMotionSafe(sample, 1100, 16.67), false, 'cheap reduced shader does not prove full shader affordability')
assert.equal(fullMotionSafe({ms: 10, scale: 1, at: 1000}, 1100, 16.67), true)
assert.equal(fullMotionSafe({ms: 25, scale: 1, at: 1000}, 1100, 16.67), false)
assert.equal(measuredStart({ms: 10, scale: 1, at: 1000}, 1100, 16.67, 0.35, 1), 1, 'measured capable GPU keeps full detail')
assert.equal(refinePlan(0, 0.35, false, false, true).scale, 1, 'affordable full frame skips intermediate blur')
assert.equal(refinePlan(0, 0.35, false, false, false).scale, 0.7, 'unknown or slow full frame retains staged refinement')
setFixedShare(0)
// Rest to motion (WP-A, 2026-10-23): a stationary press is not a motion frame (rest frames, with their uploads and builds, go on until the pointer moves), which is
// exactly the window `?pressyield=1` covers: from the press, for PRESS_YIELD_MS, whether or not the camera has moved yet.
{
  const pressAt = 5000
  assert.equal(motionActive(false, true, false, 1e9), false, 'a press that has not moved: rest frames')
  for (const t of [pressAt, pressAt + 50, pressAt + PRESS_YIELD_MS - 1]) assert.equal(pressYieldActive(true, t, pressAt), true, `yield at +${t - pressAt} ms`)
  assert.equal(pressYieldActive(true, pressAt + PRESS_YIELD_MS, pressAt), false)
  assert.equal(motionActive(true, true, true, 10), true, 'the move that follows is a motion frame, as before')
}
const phone = new FenceGrid()
phone.start(0.35)
for (let i = 0; i < 14; i++) phone.observe(0.35, 16)
assert.ok(phone.start(0.35) > 0.35, 'a short measured calm gesture can sharpen the next phone gesture')

// The async height path (`?gprobe=async`): the real GroundMode.groundZ / pollProbes over a stubbed ground pass whose fence reads land one frame late, in
// the production order (the read lands, `pollProbes`, then `cam.step`). A fast walk at 60 Hz (8 cm a frame) on a 1-in-4 slope never waits for the GPU
// after the first ask and the eye, checked against the ANALYTIC terrain, stays within step x slope (2 cm) of eye height; a hitch that moves the camera
// farther than the reach in one frame waits for the GPU once rather than set the eye from a height 25 cm away; mid-glide, the camera's own point is served
// from any distance (nothing sets its height then) while a destination's point is probed exactly; a read in flight across a cache clear is dropped.
{
  const slope = 0.25
  const ground = (e: number): number => slope * e
  const eph = ephemerisAt(new Date('2011-01-23T06:00:00Z'))
  const renderer = { shadowMap: {}, capabilities: { getMaxAnisotropy: () => 16 }, getRenderTarget: () => null, setRenderTarget: noop, render: noop, readRenderTargetPixels: noop, getContext: () => ({}) }
  const patch = { manifest: { site: { lon: 30.77168, lat: 20.19091, groundM: -2626 } }, siteMax: null, revision: 0 }
  Object.defineProperty(globalThis, 'location', { value: { search: '?gprobe=async' }, configurable: true })
  const gm = new GroundMode(renderer as never, { uniforms: {}, patchLayout: null } as never, 10, 1024, patch as never)
  delete (globalThis as { location?: unknown }).location
  assert.equal(gm.asyncProbe, true); assert.equal(gm.budget, null); assert.equal(gm.refitBatch, false)
  // The stubbed pass: the sync probe answers at once; the fence read answers on the next frame's poll.
  const h0 = gm.frame.h0M
  const sampleAt = (e: number, n: number): GroundSample => ({ h: ground(e) + h0 + (e * e + n * n) / (2 * (R_M + h0)), lit: 1, slopeE: 0, slopeN: 0, lmShade: 1 })
  let inFlight: { pts: Array<readonly [number, number]>; ready: boolean } | null = null
  let syncProbes = 0, redraws = 0
  gm.onChange = () => redraws++
  Object.assign(gm.pass, {
    probe: (_r: unknown, pts: Array<readonly [number, number]>) => { syncProbes++; return pts.map((p) => sampleAt(p[0], p[1])) },
    probeBegin: (_r: unknown, pts: Array<readonly [number, number]>) => { if (inFlight) return false; inFlight = { pts: [...pts], ready: false }; return true },
    probePoll: () => { if (!inFlight?.ready) return undefined; const s = inFlight.pts.map((p) => sampleAt(p[0], p[1])); inFlight = null; return s },
  })
  let now = 0
  // The frame's order is main.ts's (pinned below against the source): the landed reads are collected, then the camera steps.
  const frame = (dt = 1 / 60): void => { now += dt * 1000; if (inFlight) inFlight.ready = true; gm.pollProbes(now); gm.cam.step(now, dt) }
  {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    const poll = main.indexOf('if (groundMode?.active) groundMode.pollProbes(now)')
    const step = main.indexOf('groundStepNoted(now, dt)')
    const stepDef = main.indexOf('function groundStepNoted')
    assert.ok(poll > 0 && step > poll, 'main.ts polls the probes on every active-ground frame before it steps the ground camera (independent of the dirty/render/pacing gates)')
    assert.ok(main.indexOf('groundMode!.cam.step(now, dt)', stepDef) > stepDef, 'groundStepNoted is the ground camera step')
    assert.ok(main.lastIndexOf('stepFlight(now, dt)', step) > poll, 'the poll precedes the whole mover chain')
  }
  const eyeError = (): number => Math.abs(gm.cam.view.pos.z - ground(gm.cam.view.pos.x) - EYE_HEIGHT_M)
  gm.cam.view = { pos: new Vector3(0, 0, 0), headingDeg: 90, pitchDeg: 0, rollDeg: 0, tanHalf: 0.3 }
  gm.cam.setMode('walk')
  assert.equal(syncProbes, 1, 'the first ask has nothing to serve from and waits for the GPU')
  Object.assign(gm.cam.keys, { fwd: 1, fast: true })
  let worst = 0
  for (let i = 0; i < 120; i++) { frame(); worst = Math.max(worst, eyeError()) }
  assert.equal(syncProbes, 1, 'a fast walk never waits for the GPU again')
  assert.ok(worst <= slope * WALK_SPEED_FAST / 60 + 1e-6, `eye within one step x slope of eye height against the analytic terrain: ${worst.toFixed(4)} m`)
  assert.ok(gm.cam.view.pos.x > 9.9, 'walked 10 m')
  assert.ok(redraws > 0, 'a height landing under the camera asks for a frame')
  frame(0.05)
  assert.equal(syncProbes, 2, 'a 25 cm hitch is outside the reach: one synchronous probe')
  assert.ok(eyeError() < 1e-6, 'the eye exactly on the ground after it')
  Object.assign(gm.cam.keys, { fwd: 0, fast: false })
  // Mid-glide: 30 m east over 1 s. Halfway, the camera's own point (HUD) is served from the cache 15 m back; a destination 30 m out (what goViewpoint's
  // landing view asks) is probed exactly.
  const from = gm.cam.view.pos.clone()
  gm.cam.glideTo({ ...gm.cam.view, pos: new Vector3(from.x + 30, 0, from.z) }, now, 1000)
  for (let i = 0; i < 30; i++) frame()
  assert.ok(gm.cam.gliding && gm.cam.view.pos.x > from.x + 10 && gm.cam.view.pos.x < from.x + 20, `mid-glide at ${gm.cam.view.pos.x - from.x} m`)
  const before = syncProbes
  const own = gm.groundZ(gm.cam.view.pos.x, gm.cam.view.pos.y)
  assert.equal(syncProbes, before, "the camera's own point is served while gliding")
  assert.ok(Math.abs(own - ground(gm.cam.view.pos.x)) > 1, 'from a height metres back (nothing sets the camera from it)')
  const dest = gm.groundZ(from.x + 30, 0)
  assert.equal(syncProbes, before + 1, 'a destination 30 m out waits for the GPU (exact)')
  assert.ok(Math.abs(dest - ground(from.x + 30)) < 1e-6)
  for (let i = 0; i < 40; i++) frame()
  assert.equal(gm.cam.gliding, false)
  // A read in flight when the cache is cleared (enter, a refit) is answered by the old terrain: it must not enter the cache.
  frame()
  const p = gm.cam.view.pos.clone()
  gm.groundZ(p.x + 0.1, p.y)   // served from the cache, the point asked through the fence
  assert.ok(inFlight && !inFlight.ready, 'a read in flight')
  gm.enter(eph, viewFromGround(gm.axesAt(eph), gm.cam.view))
  const beforeDrop = syncProbes
  inFlight!.ready = true; gm.pollProbes(now)   // the stale read lands and is dropped (no camera step in between)
  assert.equal(inFlight, null, 'the read was collected')
  gm.groundZ(p.x + 0.1, p.y)
  assert.equal(syncProbes, beforeDrop + 1, 'the dropped answer is not in the cache: the ask waits for the GPU')
  // The pair is kept together at both clears.
  const src = readFileSync(new URL('../src/ground/GroundMode.ts', import.meta.url), 'utf8')
  assert.equal(src.match(/this\.probeCache\.clear\(\)\n\s*this\.probeQueue\.drop\(\)/g)?.length, 2, 'enter and refitLm clear the cache and drop the read in flight together')
}
console.log('interaction-quality: stationary clicks, jitter, drag, pinch, measured sharpness, quick recovery and the async height reach pass')
