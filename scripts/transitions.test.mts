import assert from 'node:assert/strict'
import { stepClock, STALL_MS } from '../src/descent/clock'
import { blendFloorDistance, floorBlendDuration, floorBoundEndDistance, sampleEffectiveFloorState, sampleFloorBlend, sampleFloorCorrection, smoothstep, tweenAt, tweenProgress } from '../src/camera/tween'
import { CameraRig } from '../src/camera/rig.ts'
import { angularDistance, wrapLon } from '../src/camera/pose.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { planFly } from '../src/journey/path.ts'
import { finestHeightTexelKm } from '../src/net/prefetch'
import { MOON_R_KM } from '../src/glsl/common.ts'
import { Vector3 } from 'three'
import fs from 'node:fs'
import ts from 'typescript'

// P2-10: the descent clock follows wall time at 5 fps (no 100 ms cap on a slow device), but still caps a stall.
{
  const c = { t0: 0, ms: 10_000 } as { t0: number; ms: number; last?: number; scale?: number }
  let now = 0, u = 0
  for (let i = 0; i < 25; i++) { now += 200; u = stepClock(c, now, true) }
  assert.ok(Math.abs(u - 0.5) < 1e-9, `5 s at 5 fps is half of 10 s, got ${u}`)
  const d = { t0: 0, ms: 10_000, last: 0 } as { t0: number; ms: number; last?: number; scale?: number }
  const u2 = stepClock(d, 3000, true)
  assert.ok(u2 < 0.05 && STALL_MS < 3000, `a 3 s stall advances by at most the step cap, got ${u2}`)
}

// P1-1: a move that waits for a date crossfade holds its first pose.
{
  const pose = (lon: number) => ({ pose: { lon, lat: 0, dist: 3, roll: 0, pitch: 0 }, fovDeg: 30, aimShift: 0, aimShiftX: 0, look: 0 })
  const plan = { ms: 1000, at: (u: number) => pose(u * 100) } as never
  const a = tweenAt({ t0: 300, plan }, 0), b = tweenAt({ t0: 300, plan }, 300)
  assert.equal(a.pose.lon, b.pose.lon)
  assert.equal(a.pose.lon, 0)
}
// A fly-to after a grabbed script eases a retained free orientation toward its planned subject over the camera move.
{
  const e = ephemerisAt(new Date('2026-10-01T00:00:00Z')), aspect = 1.6
  const main = fs.readFileSync(process.env.MAIN_SOURCE ?? new URL('../src/main.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('main.ts', main, ts.ScriptTarget.ES2022, true)
  const getFunction = (name: string): string => {
    const declaration = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name)
    assert.ok(declaration, `production ${name} exists`)
    return ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  }
  const create = new Function('ctx', `let { tween, rigLook, rig, ephem, canvasAspect, dateHoldMs, planFly, tweenAt, layoutAimOn, resolveLook, currentEnd, cancelPendingWheelZoom, cancelButtonGlides = () => {}, moonSurfaceTurn = { stopInertia: () => {} }, cancelFlightPrefetch, closeUpDist, TILE_BASE, prefetchFlight, buildFlightPrefetchTargets, blendFloorDistance, floorBlendDuration, floorBoundEndDistance, sampleFloorBlend, sampleFloorCorrection, sampleEffectiveFloorState, DIST_LAG_MS, smoothstep, tweenProgress, angularDistance, FLIGHT_FEEL, wrapLon, homeAimMinimal, handOffRate, tweenRate, shownClock } = ctx; ${getFunction('flyTo')} ${getFunction('applyTweenSubject')} ${getFunction('stepTween')} return { flyTo, stepTween, tween: () => tween, rigLook: () => rigLook };`)
  const runFlight = (look: 0 | 1, startWithSunLook = false, startLook: 0 | 1 = 0) => {
    let wheelCancelled = 0
    const rig = new CameraRig(); rig.setPose({ lon: -62.28473, lat: 60.20232, dist: 1.062757, pitch: 58.01, roll: 0 })
    rig.setFreeOrientation([0, Math.sin(.22), 0, Math.cos(.22)])
    const start = startWithSunLook ? 1500 : 1000
    if (startWithSunLook) rig.lookToward((cam) => e.sunKm.clone().divideScalar(MOON_R_KM).sub(cam.pos), true, 500, e, aspect, 2000)
    const before = rig.camera(e, aspect, start)
    const ctx = {
      tween: null, rigLook: 0, rig, ephem: e, canvasAspect: () => aspect, dateHoldMs: () => 500, planFly, tweenAt,
      closeUpDist: () => 1, TILE_BASE: '', prefetchFlight: async () => {}, buildFlightPrefetchTargets: () => [], cancelFlightPrefetch: () => {}, blendFloorDistance, floorBlendDuration, floorBoundEndDistance, sampleFloorBlend, sampleFloorCorrection, sampleEffectiveFloorState, DIST_LAG_MS: 400, smoothstep, tweenProgress, angularDistance,
      layoutAimOn: false, FLIGHT_FEEL: true, wrapLon, homeAimMinimal: false, handOffRate: null, tweenRate: () => ({ lon: 0, lat: 0, dist: 0 }), shownClock: (t: number) => t, resolveLook: (target: string) => target === 'earth' ? (cam: { pos: Vector3 }) => e.earthKm.clone().divideScalar(MOON_R_KM).sub(cam.pos) : null,
      currentEnd: () => ({ pose: { ...rig.pose }, fovDeg: rig.fovDeg, aimShift: rig.aimShift, aimShiftX: rig.aimShiftX, look: startLook }),
      cancelPendingWheelZoom: () => { wheelCancelled++ },
    }
    const app = create(ctx) as { flyTo: (end: unknown, now: number, ms: number) => void; stepTween: (now: number) => boolean; tween: () => { t0: number; plan: { ms: number } } | null }
    const center = new CameraRig(); center.setPose({ lon: -10, lat: 15, dist: 3, pitch: 0, roll: 0 })
    app.flyTo({ pose: center.pose, fovDeg: 30, aimShift: 0, aimShiftX: 0, look }, start, 2000)
    assert.equal(wheelCancelled, 1, 'a scripted flight invalidates any queued wheel tail')
    const tw = app.tween()!
    app.stepTween(start); const held = rig.camera(e, aspect, start)
    app.stepTween(tw.t0); const first = rig.camera(e, aspect, tw.t0)
    app.stepTween(tw.t0 + tw.plan.ms / 2); const middle = rig.camera(e, aspect, tw.t0 + tw.plan.ms / 2)
    app.stepTween(tw.t0 + tw.plan.ms); const end = rig.camera(e, aspect, tw.t0 + tw.plan.ms)
    assert.ok(held.back.distanceTo(before.back) < 1e-12, 'move starts continuously from the current direction')
    assert.ok(first.back.distanceTo(before.back) < 1e-12, 'date hold preserves the current direction')
    assert.ok(middle.back.distanceTo(first.back) > 1e-4, 'the direction moves during the flight')
    if (look === 0) {
      const target = new CameraRig(); target.setPose({ ...rig.pose })
      assert.ok(end.back.distanceTo(target.camera(e, aspect, tw.t0 + tw.plan.ms).back) < 1e-10, 'Moon-bound flight ends centred')
    } else {
      const forward = end.back.clone().negate(), earthDirection = e.earthKm.clone().divideScalar(MOON_R_KM).sub(end.pos).normalize()
      assert.ok(forward.angleTo(earthDirection) < 1e-8, 'Earth-bound flight ends looking at Earth')
    }
  }
  runFlight(0)
  runFlight(1)
  runFlight(0, true)
  runFlight(1, true)
  runFlight(0, false, 1)

  // A same-location zoom stays on the planner's sampled descent all the way
  // through the endpoint; proximity to the target must not select its floor.
  {
    const rig = new CameraRig(); rig.floorAt = () => 1; rig.groundAt = () => 0; rig.setPose({ lon: 0, lat: 0, dist: 3, pitch: 0, roll: 0 })
    const ctx = {
      tween: null, rigLook: 0, rig, ephem: e, canvasAspect: () => aspect, dateHoldMs: () => 0, planFly, tweenAt,
      closeUpDist: () => 1.2, TILE_BASE: '', prefetchFlight: async () => {}, buildFlightPrefetchTargets: () => [], cancelFlightPrefetch: () => {}, blendFloorDistance, floorBlendDuration, floorBoundEndDistance, sampleFloorBlend, sampleFloorCorrection, sampleEffectiveFloorState, DIST_LAG_MS: 400, smoothstep, tweenProgress, angularDistance,
      layoutAimOn: false, FLIGHT_FEEL: true, wrapLon, homeAimMinimal: false, handOffRate: null, tweenRate: () => ({ lon: 0, lat: 0, dist: 0 }), shownClock: (t: number) => t, resolveLook: () => null,
      currentEnd: () => ({ pose: { ...rig.pose }, fovDeg: rig.fovDeg, aimShift: rig.aimShift, aimShiftX: rig.aimShiftX, look: 0 }),
      cancelPendingWheelZoom: () => {},
    }
    const app = create(ctx) as { flyTo: (end: unknown, now: number, ms: number) => void; stepTween: (now: number) => boolean; tween: () => { t0: number; plan: { ms: number } } | null }
    app.flyTo({ pose: { lon: 0, lat: 0, dist: 1.2, pitch: 0, roll: 0 }, fovDeg: 30 }, 1000, 4000)
    const tw = app.tween()!, samples: number[] = []
    for (let i = 0; i <= 240; i++) {
      app.stepTween(tw.t0 + i * tw.plan.ms / 240)
      samples.push(rig.pose.dist)
    }
    assert.ok(samples[0] > 2.99, `zoom begins at the source distance, got ${samples[0]}`)
    assert.ok(Math.abs(samples.at(-1)! - 1.2) < 1e-8, `zoom ends at its floor-bound destination, got ${samples.at(-1)}`)
    assert.ok(samples.every((d, i) => i === 0 || d <= samples[i - 1] + 1e-10), 'same-location zoom distance is monotone')
    const steps = samples.slice(1).map((d, i) => Math.abs(d - samples[i]))
    const average = (samples[0] - samples.at(-1)!) / (samples.length - 1)
    assert.ok(Math.max(...steps) <= 3 * average, `zoom has no distance step above 3x average (max ${Math.max(...steps)}, average ${average})`)
  }
  // R13 production probes: floor changes use the same effective value for the sampled path and setPose clamp.
  {
    const maxJump = 1e-3
    const isContinuous = (values: number[]): boolean => values.slice(1).every((value, i) => Math.abs(value - values[i]!) <= maxJump)
    assert.equal(isContinuous([1.200002, 1.299960, 1.200060]), false, 'the logged 1.200002 -> 1.299960 -> 1.200060 sequence violates the frame bound')
    assert.equal(isContinuous([1.532456, 1.632456]), false, 'the logged 1.532456 -> 1.632456 replacement violates the frame bound')
    for (const [from, to, label] of [[1.200002, 1.299960, 'logged rise clamp'], [1.299960, 1.200060, 'logged arrival snap'], [1.532456, 1.632456, 'logged replacement']] as const) {
      assert.ok(Math.abs(to - from) > maxJump, `${label} (${from} -> ${to}) is a regression input rejected by the continuity bound`)
    }
    let floor = 1.2
    const rig = new CameraRig(); rig.floorAt = () => floor; rig.groundAt = () => 0; rig.setPose({ lon: 0, lat: 0, dist: 3, pitch: 0, roll: 0 })
    const ctx = {
      tween: null, rigLook: 0, rig, ephem: e, canvasAspect: () => aspect, dateHoldMs: () => 0, planFly, tweenAt,
      closeUpDist: () => floor, TILE_BASE: '', prefetchFlight: async () => {}, buildFlightPrefetchTargets: () => [], cancelFlightPrefetch: () => {}, blendFloorDistance, floorBlendDuration, floorBoundEndDistance, sampleFloorBlend, sampleFloorCorrection, sampleEffectiveFloorState, DIST_LAG_MS: 400, smoothstep, tweenProgress, angularDistance,
      layoutAimOn: false, FLIGHT_FEEL: true, wrapLon, homeAimMinimal: false, handOffRate: null, tweenRate: () => ({ lon: 0, lat: 0, dist: 0 }), shownClock: (t: number) => t, resolveLook: () => null,
      currentEnd: () => ({ pose: { ...rig.pose }, fovDeg: rig.fovDeg, aimShift: rig.aimShift, aimShiftX: rig.aimShiftX, look: 0 }),
      cancelPendingWheelZoom: () => {},
    }
    const app = create(ctx) as { flyTo: (end: unknown, now: number, ms: number) => void; stepTween: (now: number) => boolean; tween: () => { t0: number; plan: { ms: number } } | null }
    app.flyTo({ pose: { lon: 0, lat: 0, dist: 1.2, pitch: 0, roll: 0 }, fovDeg: 30 }, 1000, 4000)
    app.stepTween(4968)
    const beforeRise = rig.pose.dist
    floor = 1.3
    app.stepTween(4984)
    const riseStart = rig.pose.dist
    app.stepTween(5000)
    const afterArrival = rig.pose.dist
    assert.ok(Math.abs(riseStart - beforeRise) < 1e-3, `logged late floor rise starts continuously (${beforeRise} -> ${riseStart})`)
    assert.ok(Math.abs(afterArrival - riseStart) < 1e-3, `logged late floor rise remains continuous at arrival (${riseStart} -> ${afterArrival})`)
    assert.ok(rig.pose.dist >= 1.2, 'the displayed late-rise pose stays above its effective floor')

    // R14 A: a newly planned flight begins under the floor that was actually in force at its source.
    {
      const rig = new CameraRig(); rig.floorAt = (lon: number) => lon < 10 ? 1.01 : 1.2; rig.groundAt = () => 0
      rig.setPose({ lon: 0, lat: 0, dist: 1.02, pitch: 0, roll: 0 }, 1.01)
      const nowFloor = 1.2
      const startCtx = {
        ...ctx, rig, tween: null, closeUpDist: (lon: number) => lon < 10 ? 1.01 : nowFloor,
        currentEnd: () => ({ pose: { ...rig.pose }, fovDeg: rig.fovDeg, aimShift: rig.aimShift, aimShiftX: rig.aimShiftX, look: 0 }),
      }
      const startApp = create(startCtx) as { flyTo: (end: unknown, now: number, ms: number) => void; stepTween: (now: number) => boolean; tween: () => { t0: number; plan: { ms: number; at: (u: number) => { pose: { dist: number } } } } | null }
      startApp.flyTo({ pose: { lon: 40, lat: 0, dist: 2, pitch: 0, roll: 0 }, fovDeg: 30 }, 1000, 4000)
      const firstTween = startApp.tween()!
      startApp.stepTween(firstTween.t0)
      assert.ok(Math.abs(rig.pose.dist - 1.02) < 1e-9, `new flight starts at displayed distance under source floor (got ${rig.pose.dist})`)
      let prior = rig.pose.dist
      for (let time = firstTween.t0 + 16; time <= firstTween.t0 + 1600; time += 16) {
        startApp.stepTween(time)
        assert.ok(Math.abs(rig.pose.dist - prior) < 0.05, 'source-to-destination floor transition remains continuous')
        prior = rig.pose.dist
      }
    }

    // R15: the blended floor constrains the path without adding its source-to-destination delta to an endpoint
    // that the planner already clamped to the destination floor.
    {
      const rig = new CameraRig(); rig.floorAt = (lon: number) => lon < 10 ? 1.01 : 1.2; rig.groundAt = () => 0
      rig.setPose({ lon: 0, lat: 0, dist: 1.02, pitch: 0, roll: 0 }, 1.01)
      const startCtx = {
        ...ctx, rig, tween: null, closeUpDist: (lon: number) => lon < 10 ? 1.01 : 1.2,
        currentEnd: () => ({ pose: { ...rig.pose }, fovDeg: rig.fovDeg, aimShift: rig.aimShift, aimShiftX: rig.aimShiftX, look: 0 }),
      }
      const app = create(startCtx) as { flyTo: (end: unknown, now: number, ms: number) => void; stepTween: (now: number) => boolean; tween: () => { t0: number; plan: { ms: number } } | null }
      app.flyTo({ pose: { lon: 40, lat: 0, dist: 1.2, pitch: 0, roll: 0 }, fovDeg: 30 }, 1000, 4000)
      const tw = app.tween()!
      app.stepTween(tw.t0 + tw.plan.ms)
      assert.ok(Math.abs(rig.pose.dist - 1.2) < 1e-8, `source floor 1.01 to destination floor 1.20 ends at 1.20 (got ${rig.pose.dist})`)
    }

    // Replacing a flight during a rising floor blend must carry the displayed frame forward and arrive on 1.30.
    {
      let floor = 1.2
      const rig = new CameraRig(); rig.floorAt = (lon: number) => lon < 10 ? 1.2 : floor; rig.groundAt = () => 0
      rig.setPose({ lon: 0, lat: 0, dist: 1.21, pitch: 0, roll: 0 })
      const replaceCtx = {
        ...ctx, rig, tween: null, closeUpDist: (lon: number) => lon < 10 ? 1.2 : floor,
        currentEnd: () => ({ pose: { ...rig.pose }, fovDeg: rig.fovDeg, aimShift: rig.aimShift, aimShiftX: rig.aimShiftX, look: 0 }),
      }
      const app = create(replaceCtx) as { flyTo: (end: unknown, now: number, ms: number) => void; stepTween: (now: number) => boolean; tween: () => { t0: number; plan: { ms: number } } | null }
      app.flyTo({ pose: { lon: 0, lat: 0, dist: 1.2, pitch: 0, roll: 0 }, fovDeg: 30 }, 10_000, 4000)
      app.stepTween(10_000)
      floor = 1.3
      app.stepTween(10_016)
      app.flyTo({ pose: { lon: 40, lat: 0, dist: 1.2, pitch: 0, roll: 0 }, fovDeg: 30 }, 10_016, 4000)
      const tw = app.tween()!
      app.stepTween(tw.t0 + tw.plan.ms)
      assert.ok(Math.abs(rig.pose.dist - 1.3) < 1e-8, `replacement during the rise ends at 1.30 (got ${rig.pose.dist})`)
    }

    floor = 1.2
    const replacementRig = new CameraRig(); replacementRig.floorAt = () => floor; replacementRig.groundAt = () => 0; replacementRig.setPose({ lon: 0, lat: 0, dist: 3, pitch: 0, roll: 0 })
    const replacementCtx = { ...ctx, rig: replacementRig, tween: null, currentEnd: () => ({ pose: { ...replacementRig.pose }, fovDeg: replacementRig.fovDeg, aimShift: replacementRig.aimShift, aimShiftX: replacementRig.aimShiftX, look: 0 }) }
    const replacementApp = create(replacementCtx) as { flyTo: (end: unknown, now: number, ms: number) => void; stepTween: (now: number) => boolean }
    replacementApp.flyTo({ pose: { lon: 0, lat: 0, dist: 1.2, pitch: 0, roll: 0 }, fovDeg: 30 }, 6000, 4000)
    replacementApp.stepTween(8000)
    floor = 1.1
    replacementApp.stepTween(8016)
    replacementApp.stepTween(9000)
    const displayedBeforeReplacement = replacementRig.pose.dist
    replacementApp.flyTo({ pose: { lon: 20, lat: 0, dist: 2, pitch: 0, roll: 0 }, fovDeg: 30 }, 9000, 2000)
    assert.ok(Math.abs(replacementRig.pose.dist - displayedBeforeReplacement) <= 1e-9, `replacement starts at displayed corrected pose (${displayedBeforeReplacement} -> ${replacementRig.pose.dist})`)
    replacementApp.stepTween(9000)
    assert.ok(Math.abs(replacementRig.pose.dist - displayedBeforeReplacement) <= 1e-9, `replacement's first frame matches the prior display (${displayedBeforeReplacement} -> ${replacementRig.pose.dist})`)

    // A5: a move started while the tiles load plans against the expected finest floor (1.06), ends at the moment's own distance (1.3, not D_MIN
    // or the base floor), moves on its first frame, and the real floor arriving mid-move (TC, 1.02) causes no step.
    {
      let loadingFloor = 1.06
      const rig = new CameraRig(); rig.floorAt = () => loadingFloor; rig.groundAt = () => 0; rig.setPose({ lon: 0, lat: 0, dist: 6, pitch: 0, roll: 0 })
      const loadingCtx = { ...ctx, rig, tween: null, dateHoldMs: () => 0, closeUpDist: () => loadingFloor, currentEnd: () => ({ pose: { ...rig.pose }, fovDeg: rig.fovDeg, aimShift: rig.aimShift, aimShiftX: rig.aimShiftX, look: 0 }) }
      const app = create(loadingCtx) as { flyTo: (end: unknown, now: number, ms: number) => void; stepTween: (now: number) => boolean; tween: () => { t0: number; floorDist: number; plan: { ms: number; to: { pose: { dist: number } } } } | null }
      app.flyTo({ pose: { lon: 40, lat: 10, dist: 1.3, pitch: 0, roll: 0 }, fovDeg: 30 }, 20_000, 5000)
      const tw = app.tween()!
      assert.ok(Math.abs(tw.plan.to.pose.dist - 1.3) < 1e-9, `the planned end is the moment's distance (${tw.plan.to.pose.dist})`)
      assert.ok(Math.abs(tw.floorDist - 1.06) < 1e-9, 'planned against the expected floor')
      assert.equal(tw.t0, 20_000, 'no hold before the move')
      app.stepTween(tw.t0)
      const start = { ...rig.pose }
      app.stepTween(tw.t0 + 100)
      assert.ok(angularDistance(start.lon, start.lat, rig.pose.lon, rig.pose.lat) > 0 || rig.pose.dist !== start.dist, 'the first frames move')
      let prior = rig.pose.dist, priorStep = 0
      for (let t = tw.t0 + 116; t <= tw.t0 + tw.plan.ms + 400; t += 16) {
        if (t >= tw.t0 + 1500) loadingFloor = 1.02
        app.stepTween(t)
        const step = rig.pose.dist - prior
        // The plan's own speed changes smoothly; a floor step would be a jump in the per-frame change.
        assert.ok(Math.abs(step - priorStep) < 0.01 || t < tw.t0 + 132, `no step when the real floor arrives (${priorStep} -> ${step} at ${t - tw.t0} ms)`)
        prior = rig.pose.dist; priorStep = step
      }
      assert.ok(Math.abs(rig.pose.dist - 1.3) < 1e-6, `it ends at the moment's distance within plan.ms + 400 ms (${rig.pose.dist})`)
    }

    // A5: after a failed tile load the low floor stays while the camera is below D_MIN (no lift, no move, even mid-drag or mid-flight), and D_MIN returns once it is above.
    {
      const rig = new CameraRig(); rig.groundAt = () => 0; rig.setFloor(1.06)
      rig.setPose({ lon: 0, lat: 0, dist: 1.1, pitch: 0, roll: 0 })
      const st = { auditFloor: null as number | null, tilesState: 'failed', rig, D_MIN: 3.578, floorRestorePending: false }
      const restore = new Function('ctx', `let { auditFloor, tilesState, rig, D_MIN } = ctx; let floorRestorePending = false; ${getFunction('restoreFloorAfterFailure')} return { run: restoreFloorAfterFailure, pending: () => floorRestorePending };`)(st) as { run: () => void; pending: () => boolean }
      const before = { ...rig.pose }
      for (let i = 0; i < 200; i++) restore.run()
      assert.deepEqual(rig.pose, before, 'the camera is not moved or lifted while below D_MIN')
      assert.equal(rig.dMin, 1.06, 'the low floor stays')
      assert.ok(restore.pending(), 'and the restore waits')
      rig.setPose({ dist: 4 })
      restore.run()
      assert.equal(rig.dMin, 3.578, 'D_MIN returns once the camera is above it')
      assert.ok(!restore.pending())
    }
    {
      const man = { height: { texelKm: 0.4738 }, deeper: [{ level: -1, texelKm: 0.2369 }, { level: -3, texelKm: 0.0592 }, { level: -2, texelKm: 0.1185 }] }
      assert.equal(finestHeightTexelKm(man as never), 0.0592, 'the finest height texel is the deepest level')
      assert.equal(finestHeightTexelKm({ height: { texelKm: 0.4738 } } as never), 0.4738, 'and the built one without deeper levels')
    }

    // R14 B: replacing a flight while its floor is rising carries the displayed effective floor forward.
    floor = 1.2
    const risingRig = new CameraRig(); risingRig.floorAt = () => floor; risingRig.groundAt = () => 0; risingRig.setPose({ lon: 0, lat: 0, dist: 3, pitch: 0, roll: 0 })
    const risingCtx = { ...ctx, rig: risingRig, tween: null, currentEnd: () => ({ pose: { ...risingRig.pose }, fovDeg: risingRig.fovDeg, aimShift: risingRig.aimShift, aimShiftX: risingRig.aimShiftX, look: 0 }) }
    const risingApp = create(risingCtx) as { flyTo: (end: unknown, now: number, ms: number) => void; stepTween: (now: number) => boolean }
    risingApp.flyTo({ pose: { lon: 0, lat: 0, dist: 1.2, pitch: 0, roll: 0 }, fovDeg: 30 }, 10_000, 4000)
    risingApp.stepTween(10_000)
    floor = 1.3
    risingApp.stepTween(10_016)
    risingApp.stepTween(10_032)
    const beforeRiseReplacement = risingRig.pose.dist
    risingApp.flyTo({ pose: { lon: 20, lat: 0, dist: 2, pitch: 0, roll: 0 }, fovDeg: 30 }, 10_032, 4000)
    risingApp.stepTween(10_032)
    assert.ok(Math.abs(risingRig.pose.dist - beforeRiseReplacement) <= 1e-9, `floor-rise replacement starts at displayed effective floor (${beforeRiseReplacement} -> ${risingRig.pose.dist})`)

    // R14 C: a 1.30 floor rise blends at the specified rate while the 4 s path continues.
    floor = 1.21
    const slowRig = new CameraRig(); slowRig.floorAt = () => floor; slowRig.groundAt = () => 0; slowRig.setPose({ lon: 0, lat: 0, dist: 1.21, pitch: 0, roll: 0 })
    const slowCtx = { ...ctx, rig: slowRig, tween: null, currentEnd: () => ({ pose: { ...slowRig.pose }, fovDeg: slowRig.fovDeg, aimShift: slowRig.aimShift, aimShiftX: slowRig.aimShiftX, look: 0 }) }
    const slowApp = create(slowCtx) as { flyTo: (end: unknown, now: number, ms: number) => void; stepTween: (now: number) => boolean }
    slowApp.flyTo({ pose: { lon: 0, lat: 0, dist: 1.2, pitch: 0, roll: 0 }, fovDeg: 30 }, 20_000, 4000)
    slowApp.stepTween(20_000)
    for (let time = 20_016; time <= 22_000; time += 16) slowApp.stepTween(time)
    floor = 1.3
    slowApp.stepTween(22_000)
    const slowTween = (slowApp as unknown as { tween: () => { t0: number; plan: { ms: number; at: (u: number) => { pose: { dist: number } } } } }).tween()
    let priorSlow = slowRig.pose.dist
    for (let time = 22_016; time <= 23_680; time += 16) {
      slowApp.stepTween(time)
      const pathStep = Math.abs(slowTween.plan.at((time - slowTween.t0) / slowTween.plan.ms).pose.dist - slowTween.plan.at((time - 16 - slowTween.t0) / slowTween.plan.ms).pose.dist)
      assert.ok(Math.abs(slowRig.pose.dist - priorSlow) <= pathStep + 1e-3 + 1e-9, `mid-flight floor rise adds at most 1e-3 per 16 ms (step ${Math.abs(slowRig.pose.dist - priorSlow)}, path ${pathStep})`)
      priorSlow = slowRig.pose.dist
    }
    assert.ok(slowRig.pose.dist >= 1.3, 'the displayed distance remains above the completed floor rise')
  }
}
console.log('transitions.test: ok')
