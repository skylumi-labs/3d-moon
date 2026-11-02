/**
 * Ground mode (G1): the site-local metre frame, the hand-over from the orbital rig, depth compositing, the lunar module's placement.
 *   npm test
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { PerspectiveCamera, Vector3 } from 'three'
import { CameraRig } from '../src/camera/rig.ts'
import { poseFromView, type Pose } from '../src/camera/pose.ts'
import { GroundCamera, EYE_HEIGHT_M, MIN_AGL_FLY } from '../src/ground/GroundCamera.ts'
import { depth01, meshInFront } from '../src/ground/depth.ts'
import { PAD_CONTACT_M, PAD_DISC_OFF_Z, attitudeQuat, fitPlacement, needsRefit, padHasContact, padInFrame } from '../src/ground/lmPlacement.ts'
import { LM_SHADE_GLSL, LM_SHADOW_BIAS_M, LM_SHADOW_TEXEL_M } from '../src/ground/lmShadow.ts'
import { LM_REPORTED_PITCH_DEG, LM_REPORTED_ROLL_DEG } from '../src/ground/site17.ts'
import { EARTH_WHITE_IF, SUN_WHITE_IF, whiteTargetIF } from '../src/post/exposure.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { anglesOfBasis, enuOfWorld, frameAxes, groundBasis, groundFromView, makeSiteFrame, viewFromGround, worldOfEnu } from '../src/ground/frame.ts'

const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)
const eph = ephemerisAt(new Date('2011-01-23T06:00:00Z'))
const frame = makeSiteFrame(30.77168, 20.19091, -2626)
const axes = frameAxes(eph, frame)

// 1. The frame: float64 round trip at 1 mm over 20 km, and the origin is the origin.
{
  const p = worldOfEnu(axes, new Vector3(0, 0, 0))
  near(p.length(), 1 - 2626 / 1737400, 1e-15, 'origin radius')
  for (const v of [new Vector3(3, -4, 1.7), new Vector3(20000, -15000, -115), new Vector3(-5, 7, 400)]) {
    const back = enuOfWorld(axes, worldOfEnu(axes, v))
    assert.ok(back.distanceTo(v) < 1e-6, `round trip ${v.toArray()} -> ${back.toArray()}`)
  }
  // The curvature: a point on the sphere 3 km east of the origin is 2.6 m below the tangent plane.
  const th = 3000 / 1737400
  const q = axes.east.clone().multiplyScalar(Math.sin(th) * axes.r0).addScaledVector(axes.up, Math.cos(th) * axes.r0)
  near(enuOfWorld(axes, q).z, -3000 * 3000 / (2 * 1737400 - 2 * 2626), 0.02, 'curvature drop at 3 km')
}

// 2. Orientation: the basis is orthonormal and right-handed, and angles survive a round trip (also looking down).
for (const [h, p, r] of [[0, 0, 0], [200, -33, 4], [-90, 60, -10], [35, -89.9999, 0], [10, 90, 0], [123, -14, 0]]) {
  const b = groundBasis({ headingDeg: h, pitchDeg: p, rollDeg: r })
  near(b.right.length(), 1, 1e-12, 'unit'); near(b.right.dot(b.up), 0, 1e-12, 'orthogonal')
  near(new Vector3().crossVectors(b.right, b.up).dot(b.back), 1, 1e-12, 'right handed')
  const a = anglesOfBasis(b.right, b.up, b.back)
  const b2 = groundBasis(a)
  for (const k of ['right', 'up', 'back'] as const) assert.ok(b[k].distanceTo(b2[k]) < 1e-9, `basis ${k} for (${h}, ${p}, ${r}) -> ${JSON.stringify(a)}`)
}
{
  // Heading 90 looks east; pitch -90 looks straight down with the top of the frame toward the heading.
  const b = groundBasis({ headingDeg: 90, pitchDeg: 0, rollDeg: 0 })
  assert.ok(b.back.distanceTo(new Vector3(-1, 0, 0)) < 1e-12)
  const d = groundBasis({ headingDeg: 0, pitchDeg: -90, rollDeg: 0 })
  assert.ok(d.up.distanceTo(new Vector3(0, 1, 0)) < 1e-12 && d.back.distanceTo(new Vector3(0, 0, 1)) < 1e-12)
}

// 3. World camera to ground view and back: the same camera (position, all three axes, field) to float64 noise.
{
  const g = { pos: new Vector3(12.5, -30.25, 40.5), headingDeg: 200, pitchDeg: -33, rollDeg: 4, tanHalf: 0.3 }
  const v = viewFromGround(axes, g)
  const g2 = groundFromView(axes, v)
  assert.ok(g2.pos.distanceTo(g.pos) < 1e-6)
  near(((g2.headingDeg - 200 + 540) % 360) - 180, 0, 1e-8, 'heading'); near(g2.pitchDeg, -33, 1e-8, 'pitch'); near(g2.rollDeg, 4, 1e-8, 'roll'); near(g2.tanHalf, 0.3, 0, 'field')
  const v2 = viewFromGround(axes, g2)
  assert.ok(v.pos.distanceTo(v2.pos) < 1e-12 && v.right.distanceTo(v2.right) < 1e-12 && v.up.distanceTo(v2.up) < 1e-12 && v.back.distanceTo(v2.back) < 1e-12)
}


// 4. Hand-over from the orbital rig: the pose the rig would hold for a camera is recovered exactly, and a run of frames
// that switches from the rig to the ground camera at any frame has no step in position, orientation or field.
{
  const rig = new CameraRig()
  rig.setFloor(0.99)
  rig.mode = 'fly'
  const cams = []
  // A descent: the altitude falls on a log scale over 2.5 km to 500 m while the view tilts from straight down to 58 deg and the lens narrows from 30 to 25 deg.
  const groundR = -2626 / 1737400
  for (let i = 0; i <= 120; i++) {
    const u = i / 120
    const alt = Math.exp(Math.log(2500) + (Math.log(500) - Math.log(2500)) * u) / 1737400
    const pose: Pose = { lon: 30.7717 + 0.002 * (1 - u), lat: 20.1909 - 0.001 * (1 - u), dist: 1 + groundR + alt, roll: -40 * u, pitch: 58 * u * u }
    rig.setPose(pose)
    rig.fovDeg = 30 - 5 * u
    const cam = rig.camera(eph, 16 / 9, 0)
    const back = poseFromView(eph, cam)
    near(back.lon, pose.lon, 1e-9, 'lon'); near(back.lat, pose.lat, 1e-9, 'lat'); near(back.dist, pose.dist, 1e-12, 'dist')
    near(back.roll, pose.roll, 1e-6, 'roll'); near(back.pitch ?? 0, pose.pitch ?? 0, 1e-6, 'pitch')
    cams.push(cam)
  }
  const step = (a: typeof cams[0], b: typeof cams[0]) => ({
    pos: a.pos.distanceTo(b.pos) * 1737400, ori: Math.max(a.right.distanceTo(b.right), a.up.distanceTo(b.up), a.back.distanceTo(b.back)), fov: Math.abs(Math.log(a.tanHalf / b.tanHalf)),
  })
  const worst = { pos: 0, ori: 0, fov: 0 }
  for (let i = 1; i < cams.length; i++) { const s = step(cams[i - 1], cams[i]); worst.pos = Math.max(worst.pos, s.pos); worst.ori = Math.max(worst.ori, s.ori); worst.fov = Math.max(worst.fov, s.fov) }
  for (let sw = 1; sw < cams.length; sw++) {
    // Frames before sw from the rig, from sw on through the ground camera.
    const seq = cams.map((c, i) => (i < sw ? c : viewFromGround(axes, groundFromView(axes, c))))
    for (let i = 1; i < seq.length; i++) {
      const s = step(seq[i - 1], seq[i]), r = step(cams[i - 1], cams[i])
      assert.ok(s.pos <= r.pos + 1e-4, `switch at ${sw}: position step ${s.pos} m vs the rig's ${r.pos} m`)
      assert.ok(s.ori <= r.ori + 1e-6, `switch at ${sw}: orientation step ${s.ori} vs ${r.ori}`)
      assert.ok(s.fov <= r.fov + 1e-12, `switch at ${sw}: field step ${s.fov} vs ${r.fov}`)
    }
  }
  console.log(`hand-over: worst rig step per frame ${worst.pos.toFixed(2)} m, ${worst.ori.toExponential(2)} orientation, ${worst.fov.toExponential(2)} field; switching at any of 120 frames adds none`)
}

// 5. The ground camera: never under the ground when flying, at eye height when walking, and a glide reaches its end pose.
{
  const ground = (e: number, n: number): number => 0.5 * Math.sin(e / 7) + 0.002 * n
  const cam = new GroundCamera({ pos: new Vector3(0, 0, 3), headingDeg: 0, pitchDeg: 0, rollDeg: 0, tanHalf: 0.3 }, ground)
  for (let i = 0; i < 200; i++) { cam.move(0.5, 0, -0.4); assert.ok(cam.agl() >= MIN_AGL_FLY - 1e-9, `fly agl ${cam.agl()}`) }
  cam.setMode('walk')
  for (let i = 0; i < 200; i++) { cam.move(0.3, 0.1, 0); near(cam.agl(), EYE_HEIGHT_M, 1e-6, 'walk eye height') }
  const to = { pos: new Vector3(-20, 20, 12), headingDeg: 135, pitchDeg: -14, rollDeg: 0, tanHalf: 0.4 }
  let done = false, atEnd = 1e9
  cam.glideTo(to, 0, 1000, () => { done = true; atEnd = cam.view.pos.distanceTo(to.pos) })
  const total = cam.view.pos.distanceTo(to.pos)
  let prev = cam.view.pos.clone(), maxStep = 0
  for (let t = 0; t <= 1100; t += 16) { cam.step(t, 0.016); maxStep = Math.max(maxStep, cam.view.pos.distanceTo(prev)); prev = cam.view.pos.clone() }
  assert.ok(done && atEnd < 1e-9 && Math.abs(cam.view.tanHalf - 0.4) < 1e-12, 'glide ends at the pose')
  assert.ok(maxStep < 1.6 * total / 62.5, `glide step ${maxStep} of ${total} m (smoothstep peaks at 1.5x the mean)`)
  const start = { ...cam.view, pos: cam.view.pos.clone() }
  const far = { ...to, pos: to.pos.clone().add(new Vector3(0, 40, 0)) }
  cam.glideTo(far, 2000)
  const horizontal = Math.hypot(far.pos.x - start.pos.x, far.pos.y - start.pos.y)
  const expectedMs = Math.max(1500, Math.min(6000, 1500 + 60 * Math.sqrt(horizontal)))
  cam.step(2000 + expectedMs / 2, expectedMs / 2000)
  assert.ok(cam.view.pos.z > start.pos.z + (far.pos.z - start.pos.z) / 2, 'long glides rise over the middle')
  cam.step(2000 + expectedMs, expectedMs / 1000)
  assert.ok(!cam.gliding, 'distance-scaled glide completes at its calculated duration')
}

// 5b. A glide that carries the descent's motion (Apollo 17's arrival), through GroundCamera.step: the first frame moves by v0 * dt from the hand-over pose
// (not from a stale one), no arc bump, the pitch leaves at the carried rate, and the glide ends at rest on the pose and fires `done` once.
{
  const flat = (): number => 0
  const cam = new GroundCamera({ pos: new Vector3(300, -200, 900), headingDeg: 20, pitchDeg: -32, rollDeg: 0, tanHalf: 0.3 }, flat)
  const to = { pos: new Vector3(-14, -14, 1.7), headingDeg: 45, pitchDeg: -3, rollDeg: 0, tanHalf: 0.3 }
  const v0 = new Vector3(-90, 60, -150), rate = 8   // m/s and deg/s
  const T = 5000
  let done = 0
  cam.glideTo(to, 1000, T, () => { done++ }, undefined, v0, rate)
  const p0 = cam.view.pos.clone(), pitch0 = cam.view.pitchDeg
  const dt = 1 / 60
  cam.step(1000 + dt * 1000, dt)
  const first = cam.view.pos.clone().sub(p0)
  assert.ok(first.distanceTo(v0.clone().multiplyScalar(dt)) < 0.03 * v0.length() * dt + 1e-3, `first frame moves by v0 * dt (${first.toArray().map((x) => x.toFixed(3))})`)
  const rate1 = (cam.view.pitchDeg - pitch0) / dt
  assert.ok(Math.abs(rate1 - rate) < 0.05 * rate, `pitch rate continues at ${rate} deg/s (got ${rate1.toFixed(2)})`)
  // Speeds and pitch rate stay continuous and never jump up during the glide.
  let pv = cam.view.pos.clone(), pPitch = cam.view.pitchDeg, lastSpeed = first.length() / dt, lastRate = rate1
  for (let t = 1000 + 2 * dt * 1000; t <= 1000 + T + 20; t += dt * 1000) {
    cam.step(t, dt)
    const sp = cam.view.pos.distanceTo(pv) / dt, pr = (cam.view.pitchDeg - pPitch) / dt
    assert.ok(Math.abs(sp - lastSpeed) < 0.2 * v0.length(), `speed step ${lastSpeed.toFixed(1)} to ${sp.toFixed(1)}`)
    assert.ok(Math.abs(pr - lastRate) < 1.5, `pitch rate step ${lastRate.toFixed(2)} to ${pr.toFixed(2)}`)
    pv = cam.view.pos.clone(); pPitch = cam.view.pitchDeg; lastSpeed = sp; lastRate = pr
  }
  assert.equal(done, 1, 'done fires once')
  assert.ok(cam.view.pos.distanceTo(to.pos) < 1e-9 && Math.abs(cam.view.pitchDeg - to.pitchDeg) < 1e-9, 'ends on the eye pose')
  assert.ok(lastSpeed < 1 && Math.abs(lastRate) < 0.5, 'ends at rest')
}

// 6. Depth compositing: the depth the ground pass writes is what a perspective mesh camera stores, so a mesh and the ground can be compared.
{
  const cam = new PerspectiveCamera(50, 16 / 9, 0.2, 60000)
  for (const z of [0.3, 1.7, 5, 30, 400, 20000]) {
    const p = new Vector3(0.1 * z, -0.05 * z, -z).applyMatrix4(cam.projectionMatrix)
    near(p.z * 0.5 + 0.5, depth01(z, 0.2, 60000), 1e-9, `depth at ${z} m`)
  }
  assert.ok(depth01(0.2, 0.2, 60000) === 0 && depth01(60000, 0.2, 60000) === 1, 'planes')
  // Terrain in front of a leg on a slope, and the module in front of the terrain behind it.
  assert.ok(!meshInFront(depth01(30, 0.2, 60000), depth01(29.5, 0.2, 60000)), 'a rise 0.5 m nearer hides the mesh')
  assert.ok(meshInFront(depth01(29.5, 0.2, 60000), depth01(30, 0.2, 60000)), 'the module hides ground behind it')
  // The shader writes the same expression (a mirror the CPU test cannot compile, so its text is compared).
  const shader = fs.readFileSync(new URL('../src/ground/groundShader.ts', import.meta.url), 'utf8')
  assert.ok(shader.includes('uGFar / (uGFar - uGNear) * (1.0 - uGNear / zv)'), 'shader depth expression')
  assert.ok(shader.includes('g.hit ? clamp('), 'sky writes no depth (stays at the cleared 1.0)')
}

// 7. The lunar module on the ground: the attitude is the plane under the pads, no pad is under the ground, the lowest touches.
{
  const pads = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => new Vector3(2.76 * x, 0.1, 2.76 * z))
  const plane = (e: number, n: number): number => 1.2 + 0.05 * e - 0.03 * n
  for (const heading of [270, 0, 123]) {
    const p = fitPlacement(pads, heading, plane)
    // A plane is met by all four pads at once.
    for (const c of p.clearanceM) near(c, 0, 0.02, `plane clearance at heading ${heading}`)
    const slope = Math.hypot(0.05, 0.03)
    near(Math.hypot(Math.tan(p.pitchDeg * Math.PI / 180), Math.tan(p.rollDeg * Math.PI / 180)), slope, 0.004, 'tilt is the slope')
  }
  // Rough ground: bumps under the pads. No pad under the ground, the lowest touching, none floating more than the relief.
  const rough = (e: number, n: number): number => plane(e, n) + 0.25 * Math.sin(e * 0.9) * Math.cos(n * 1.3) + 0.08 * Math.sin(3 * e + n)
  for (const heading of [270, 45, 200]) {
    const p = fitPlacement(pads, heading, rough)
    const pts = pads.map((pad) => padInFrame(pad, p))
    pts.forEach((q, i) => near(q.z - rough(q.x, q.y), p.clearanceM[i], 1e-9, 'reported clearance is the real one'))
    assert.ok(Math.min(...p.clearanceM) > -1e-9, `a pad under the ground: ${p.clearanceM}`)
    near(Math.min(...p.clearanceM), 0, 1e-9, 'the lowest pad touches')
    assert.ok(Math.max(...p.clearanceM) < 0.5, `a pad floats ${Math.max(...p.clearanceM)} m`)
  }
  // Facing: the front (+z) points at the bearing.
  const q = attitudeQuat({ headingDeg: 270, pitchDeg: 0, rollDeg: 0 })
  const f = new Vector3(0, 0, 1).applyQuaternion(q)
  assert.ok(Math.abs(f.x + 1) < 1e-12 && Math.abs(f.z) < 1e-12, 'front faces west (three -x)')
  const qn = new Vector3(0, 0, 1).applyQuaternion(attitudeQuat({ headingDeg: 270, pitchDeg: 5, rollDeg: 0 }))
  assert.ok(qn.y > 0.08, 'nose up lifts the front')
}

// 7. G1b: the module's shadow path (the GPU half runs in the browser: `__moon.ground.shadeCheck` compares the shadow map with a CPU ray cast).
{
  // The bias is two map texels along the Sun ray (6 cm), not 0.0008 of the 199 m range (16 cm): a pad 10 cm up must cast.
  near(LM_SHADOW_BIAS_M, 2 * LM_SHADOW_TEXEL_M, 1e-12, 'bias is two texels')
  assert.ok(LM_SHADOW_BIAS_M < 0.08, `bias ${LM_SHADOW_BIAS_M} m would swallow a footpad's shadow`)
  const m = /const float LM_BIAS = ([0-9.]+);/.exec(LM_SHADE_GLSL)
  assert.ok(m, 'bias constant in the shader')
  near(Number(m[1]) * 199, LM_SHADOW_BIAS_M, 1e-4, 'shader bias in metres')
  // The penumbra is the Sun's angular radius times the blocker distance, not a constant.
  assert.ok(/SUN_RAD \* \(sumD \/ nb\)/.test(LM_SHADE_GLSL), 'penumbra scales with the blocker distance')
  assert.ok(!/ts \* 1\.2/.test(LM_SHADE_GLSL), 'no fixed-width PCF kernel')
}
// The reported attitude is the crew's (ALSJ 114:10:14).
assert.equal(LM_REPORTED_PITCH_DEG, 5); assert.equal(LM_REPORTED_ROLL_DEG, 2)
{
  const src = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const gs = fs.readFileSync(new URL('../src/ground/groundShader.ts', import.meta.url), 'utf8')
  const gp = fs.readFileSync(new URL('../src/ground/GroundPass.ts', import.meta.url), 'utf8')
  const gm = fs.readFileSync(new URL('../src/ground/GroundMode.ts', import.meta.url), 'utf8')
  const enter = src.slice(src.indexOf('function enterGround'), src.indexOf('function leaveGround'))
  assert.ok(/last\?\.cam \?\?/.test(enter), 'the hand-over uses the camera of the frame drawn (last.cam), not a fresh rig sample')
  assert.ok(/lmShadeAt\(vec3\(en, z\)/.test(gs) && /lmShade: this\.probeBuf/.test(gp), 'probe returns lmShade')
  const render = gm.slice(gm.indexOf('  render(e: Ephemeris'))
  assert.ok(/shadowKey/.test(render) && !/lm\.renderShadow\(this\.renderer\)\s*\n\s*const u/.test(render), 'shadow maps redraw on change, not every frame')
  assert.ok(/shadowMap\.autoUpdate = false/.test(gm), 'three shadow map autoUpdate off')
  const feed = gm.slice(gm.indexOf('private feedPads'), gm.indexOf('lmShadeCpu'))
  assert.ok(!/render/.test(feed) && /placeLm\(\): void[\s\S]*this\.feedPads\(\)/.test(gm), 'pad heights are read at placement')
  // The module is re-sat when finer heights arrive under it (feedback 2026-10-14: stuck in the ground), and the descent flight is left alone.
  assert.ok(/needsRefit\(this\.refitRev, this\.patch\.revision/.test(gm) && /this\.refitLm\(now\)/.test(gm), 'a height revision change triggers a re-fit from update()')
  assert.ok(/this\.flightAt = performance\.now\(\)/.test(gm), 'the re-fit waits while the flight drives the pose')
  assert.ok(/this\.probeCache\.clear\(\)/.test(gm.slice(gm.indexOf('private refitLm'))), 'the probe cache is dropped before the re-fit reads heights')
  assert.ok(/enterGround/.test(src) && !/refitLm/.test(src), 'main.ts is untouched by the re-fit')
  assert.ok(/await import\('\.\/LunarModule'\)/.test(gm) && !/^import .*LunarModule'/m.test(gm.replace(/import type[^\n]*\n/g, '')), 'the mesh code is a lazy chunk')
}
// 8. G1c. Behaviour first (these call the real functions); the last block is source text and says so.
{
  // The Sun (or Earth) in the frame does not set the white point on the ground: a 50 I/F white maps the 0.017 I/F floor to black.
  assert.equal(whiteTargetIF(true, SUN_WHITE_IF), 0)
  assert.equal(whiteTargetIF(true, EARTH_WHITE_IF), 0)
  assert.equal(whiteTargetIF(false, SUN_WHITE_IF), SUN_WHITE_IF, 'orbit keeps its exposure for the Sun')
  // A contact disc only for a pad that touches; a floating pad's disc is moved out of range (its smoothstep is 0 everywhere).
  assert.ok(padHasContact(0) && padHasContact(PAD_CONTACT_M - 1e-6) && !padHasContact(PAD_CONTACT_M) && !padHasContact(0.49))
  assert.ok(PAD_DISC_OFF_Z < -1000)
  // On a plane the fitted attitude leaves every pad touching (so every disc stays on), where the reported 5/2 deg on 0.7/1.2 deg ground floats pads.
  const pads = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => new Vector3(2.76 * x, 0.1, 2.76 * z))
  const ground = (e: number, n: number): number => 0.012 * e - 0.02 * n
  const fit = fitPlacement(pads, 270, ground)
  assert.ok(fit.clearanceM.every(padHasContact), `fit leaves every pad in contact: ${fit.clearanceM}`)
  const rep = fitPlacement(pads, 270, ground, { attitude: { pitchDeg: LM_REPORTED_PITCH_DEG, rollDeg: LM_REPORTED_ROLL_DEG } })
  assert.ok(rep.clearanceM.some((c) => !padHasContact(c)), 'the reported attitude floats a pad on this ground')
}
{
  // Source text, not behaviour (the GPU and the module's class need a browser): the defaults and the guard.
  const gm = fs.readFileSync(new URL('../src/ground/GroundMode.ts', import.meta.url), 'utf8')
  assert.ok(/lmTilt: 'reported' \| 'fit' = 'fit'/.test(gm), 'the module is drawn at the terrain fit by default')
  assert.ok(/padHasContact\(lm\.placement\.clearanceM\[i\]\)/.test(gm), 'discs follow the per-pad clearance')
  assert.ok(/dm > 0\.0 && dm < sp\.z - lmBias/.test(LM_SHADE_GLSL), 'an unwritten shadow texel cannot occlude')
  const src = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.ok(/whiteTargetIF\(!!gm, earthWhiteIF/.test(src), 'render gates the Sun/Earth white point on ground mode')
  assert.ok(/if \(DEBUG && gm\?\.lm\) selfCheckShade\(gm\)/.test(src), 'the debug self-check runs after the module is placed')
}
{
  // The committed mask record (the tier itself is not in the repository): the fill's texture spread matches the ring's within 20 % at texel scale, and is not flat at metre scale.
  const rec = JSON.parse(fs.readFileSync(new URL('../data/apollo17/lm1-mask.json', import.meta.url), 'utf8'))
  const m = rec.measured
  assert.ok(Math.abs(m.fillHfSdBytes / m.ringHfSdBytes - 1) <= 0.2, `fill texel spread ${m.fillHfSdBytes} vs ring ${m.ringHfSdBytes}`)
  assert.ok(m.fillMetreSdBytes / m.ringMetreSdBytes >= 0.6, `fill metre-scale spread ${m.fillMetreSdBytes} vs ring ${m.ringMetreSdBytes}`)
  const step = fs.readFileSync(new URL('./build-haase-tier.mts', import.meta.url), 'utf8')
  assert.ok(/mask-tier-lm\.mts/.test(step), 'the tier build runs the mask step (source text)')
}
{
  // Re-fit decision: a new height revision or an invalid first placement, never during a flight.
  assert.equal(needsRefit(3, 3, 0.4, 5000), false, 'nothing changed')
  assert.equal(needsRefit(3, 4, 0.4, 5000), true, 'a finer tier arrived')
  assert.equal(needsRefit(3, 3, -1e6, 5000), true, 'the first placement was made before the ground answered')
  assert.equal(needsRefit(3, 4, 0.4, 200), false, 'a descent flight drives the pose')
}
console.log('ground.test: ok')
