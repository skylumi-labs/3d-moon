/**
 * Review of #367 (moon-camera-feel), three defects in the flight-feel hand-off, each pinned against the production source of src/main.ts:
 *  1. handOffRate is accepted by event, not by time: a frame loop tick ends the event that stopped the move, so a later fly-to (a tap's pointerup,
 *     a tile arrival) starts from rest instead of leaping at the carried speed from a camera that stood still.
 *  2. A live-tween retarget samples the pose, the floor and the speed at the SHOWN camera's clock (where the carried move's clock starts), not at
 *     `now`: sampling at `now` counted the event-to-draw gap twice (a one-frame speed spike up to 2x).
 *  3. Home captures the sky on screen as `last?.ephem ?? ephem`, like a pick (`ephem` can be one undrawn carry step ahead).
 * Round 3 (owner: "the smoothest way possible"): 4. a live-tween retarget starts from the pose the move SHOWS at the shown clock (the production path always has a
 * floorBlend, which the first version of defect 2 never reached); 1b. the time window on the hand-off is gone; 5. an afterLoad re-plan hands the dropped
 * approach's speed on; 6. an orbit, a flight or a coasting spin hands over its drawn speed and a spin's inertia stops.
 * tsx scripts/camera-feel-review.test.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { CameraRig } from '../src/camera/rig.ts'
import { angularDistance, wrapLon } from '../src/camera/pose.ts'
import { blendFloorDistance, floorBlendDuration, floorBoundEndDistance, sampleEffectiveFloorState, sampleFloorBlend, sampleFloorCorrection, smoothstep, tweenAt, tweenProgress } from '../src/camera/tween'
import { ephemerisAt } from '../src/ephemeris.ts'
import { CARRY_MAX_EXCURSION, planFly } from '../src/journey/path.ts'
import { EphemCarry } from '../src/journey/ephemCarry.ts'
import { Quaternion, Vector3 } from 'three'
/** The z component of the Sun's body-frame direction (the spin axis below is the body z), as main.ts bodySun. */

const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('main.ts', main, ts.ScriptTarget.ES2022, true)
const getFunction = (name: string): string => {
  const declaration = ast.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === name)
  assert.ok(declaration, `production ${name} exists`)
  return ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}

const e = ephemerisAt(new Date('2026-10-20T19:00:00Z')), aspect = 1.6
const RATE = { lon: 12, lat: -3, dist: 0.5, roll: 0, pitch: 0, fov: 0 }
const calls: Array<[unknown, { pose: { lon: number; lat: number; dist: number } }, unknown, { startRate?: { lon: number; lat: number; dist: number } }]> = []
let shown = (t: number): number => t
let closeUp = 1
let perfNow = 1000
const build = () => {
  const rig = new CameraRig(); rig.setPose({ lon: 5, lat: 5, dist: 10, pitch: 0, roll: 0 })
  const ctx: Record<string, unknown> = {
    tween: null, rigLook: 0, rig, ephem: e, canvasAspect: () => aspect, dateHoldMs: () => 0, planFly: (...a: Parameters<typeof planFly>) => { calls.push(a as never); return planFly(...a) }, tweenAt,
    closeUpDist: () => closeUp, TILE_BASE: '', prefetchFlight: async () => {}, buildFlightPrefetchTargets: () => [], cancelFlightPrefetch: () => {}, blendFloorDistance, floorBlendDuration, floorBoundEndDistance,
    sampleFloorBlend, sampleFloorCorrection, sampleEffectiveFloorState, DIST_LAG_MS: 400, smoothstep, tweenProgress, FLIGHT_FEEL: true, wrapLon, homeAimMinimal: false, handOffRate: null,
    shownClock: (t: number) => shown(t), performance: { now: () => perfNow }, DRAWN_REST: 1e-3, DRAWN_MAX: { surface: 60, dist: 40, roll: 360, pitch: 180, fov: 100 }, DRAWN_COS_FLOOR: 0.02, drawnPrev: null, drawnCur: null, layoutAimOn: false, resolveLook: () => null, joinHandOverAt: null,
    currentEnd: () => ({ pose: { ...rig.pose }, fovDeg: rig.fovDeg, aimShift: rig.aimShift, aimShiftX: rig.aimShiftX, look: 0 }),
    cancelPendingWheelZoom: () => {},
    // frameLoopBody's first gate: a tick the frame gate skips returns right after the hand-off rate is dropped.
    FRAME_GATE: { periodMs: 16, shouldRun: () => false }, captureSession: null, captureIsInitializing: () => false, gateUrgent: false, requestAnimationFrame: () => 0, frameLoop: () => {},
  }
  const create = new Function('ctx', `let { tween, rigLook, rig, ephem, canvasAspect, dateHoldMs, planFly, tweenAt, layoutAimOn, resolveLook, currentEnd, cancelPendingWheelZoom, cancelButtonGlides = () => {}, moonSurfaceTurn = { stopInertia: () => {} }, cancelFlightPrefetch, closeUpDist, TILE_BASE, prefetchFlight, buildFlightPrefetchTargets, blendFloorDistance, floorBlendDuration, floorBoundEndDistance, sampleFloorBlend, sampleFloorCorrection, sampleEffectiveFloorState, DIST_LAG_MS, smoothstep, tweenProgress, FLIGHT_FEEL, wrapLon, homeAimMinimal, handOffRate, shownClock, joinHandOverAt, performance, DRAWN_REST, DRAWN_MAX, DRAWN_COS_FLOOR, drawnPrev, drawnCur, FRAME_GATE, captureSession, captureIsInitializing, gateUrgent, requestAnimationFrame, frameLoop } = ctx; ${getFunction('tweenRate')} ${getFunction('flyTo')} ${getFunction('frameLoopBody')} ${getFunction('stepTween')} ${getFunction('applyTweenSubject')} ${getFunction('rememberTweenRate')} ${getFunction('recordDrawnPose')} ${getFunction('drawnRate')} return { flyTo, frameLoopBody, tweenRate, stepTween, rememberTweenRate, recordDrawnPose, drawnRate, setTween: (t) => { tween = t }, tween: () => tween, setHandOff: (h) => { handOffRate = h }, handOff: () => handOffRate };`)
  return { rig, app: create(ctx) as {
    flyTo: (end: unknown, now: number, ms?: number) => void; frameLoopBody: (now: number) => void; tweenRate: (tw: unknown, now: number) => { lon: number; lat: number; dist: number }
    stepTween: (now: number) => boolean; rememberTweenRate: () => void; recordDrawnPose: (at: number) => void; drawnRate: (now: number) => { rate: { lon: number; lat: number }; at: number } | null
    setTween: (t: unknown) => void; tween: () => { t0: number; floorBlend?: { from: number } } | null; setHandOff: (h: unknown) => void; handOff: () => unknown
  } }
}
const resolveEarth = (x: typeof e): Vector3 => x.earthDir.clone()
const P = (lon: number, lat: number, dist: number) => ({ lon, lat, dist, roll: 0, pitch: 0 })
const endAt = (pose: ReturnType<typeof P>) => ({ pose, fovDeg: 30, aimShift: 0, aimShiftX: 0, look: 0 as const })
const TARGET = endAt(P(-20, 10, 1.2))

// 1. A hand-off rate lives for one event: the frame loop ends it.
{
  const { app } = build()
  // The pointerdown stops the move at the drawn clock 920 (rate stored), a frame is drawn (camera still), the pointerup flies 80 ms after the event.
  app.setHandOff({ rate: RATE, at: 920 })
  app.frameLoopBody(1000)
  assert.equal(app.handOff(), null, 'a frame loop tick drops the hand-off rate')
  calls.length = 0
  app.flyTo(TARGET, 1000)
  assert.equal(calls.at(-1)![3].startRate, undefined, 'a fly-to in a later event starts from rest, not at the carried speed')
  assert.equal(app.tween()!.t0, 1000, 'and its clock starts at the event, not at the stale shown clock')
  // The intended hand-off: a pick during a flight stops the move and flies in the SAME event (no frame between).
  app.setTween(null)
  app.setHandOff({ rate: RATE, at: 984 })
  app.flyTo(TARGET, 1000)
  assert.deepEqual(calls.at(-1)![3].startRate, RATE, 'a fly-to in the same event carries the stopped move\'s speed')
  assert.equal(app.tween()!.t0, 984, 'and starts on the shown clock')
}

// 2. A retarget of a live tween samples pose, floor and speed at the shown camera's clock (the carried clock's start), not at `now`.
{
  const first = build()
  const plan = planFly(e, endAt(P(0, 0, 6)), TARGET, { aspect, feel: true })
  const mk = (floorBlend?: { from: number; to: number; t0: number }) => ({ t0: 0, plan, recoverLook: false, floorDist: 1, endBaseDist: 1.2, endWasFloorBound: false, floorBlend, lastShownDist: 6, prefetchAt: -Infinity })
  shown = (t) => t - 16
  const NOW = 1000, AT = NOW - 16
  // (a) pose and speed
  const prior = mk()
  first.app.setTween(prior); calls.length = 0
  first.app.flyTo(endAt(P(30, -20, 1.3)), NOW)
  const from = calls.at(-1)![1].pose, want = tweenAt(prior as never, AT).pose, atNow = tweenAt(prior as never, NOW).pose
  assert.ok(Math.abs(atNow.lon - want.lon) > 1e-3 || Math.abs(atNow.dist - want.dist) > 1e-6, 'the test can tell the two clocks apart')
  assert.ok(Math.abs(from.lon - want.lon) < 1e-9 && Math.abs(from.lat - want.lat) < 1e-9 && Math.abs(from.dist - want.dist) < 1e-9, `the new move starts at the shown camera (${from.lon} vs ${want.lon}, not ${atNow.lon})`)
  const wantRate = first.app.tweenRate(prior, AT), gotRate = calls.at(-1)![3].startRate!
  assert.ok(Math.abs(gotRate.lon - wantRate.lon) < 1e-9 && Math.abs(gotRate.dist - wantRate.dist) < 1e-9, 'the carried speed is the shown camera\'s')
  assert.equal(first.app.tween()!.t0, AT, 'and the clock starts there: one time for pose, speed and clock')
  // (b) the inherited floor
  const second = build()
  const fb = { from: 3, to: 1.1, t0: 0 }
  second.app.setTween(mk(fb)); calls.length = 0
  second.app.flyTo(endAt(P(30, -20, 1.3)), NOW)
  const wantFloor = Math.min(10, sampleFloorBlend(fb, AT)), nowFloor = Math.min(10, sampleFloorBlend(fb, NOW))
  assert.ok(Math.abs(wantFloor - nowFloor) > 1e-5, 'the floor test can tell the two clocks apart')
  assert.ok(Math.abs(second.app.tween()!.floorBlend!.from - wantFloor) < 1e-12, `the inherited floor is sampled at the shown clock (${second.app.tween()!.floorBlend!.from} vs ${wantFloor}, not ${nowFloor})`)
  shown = (t) => t
}


// 1b. No time window: a same-event hand-off is consumed however old the shown clock it was sampled at is (stop sampled a 99 ms old frame, the pick's own work took 20+ ms).
{
  const { app } = build()
  app.setHandOff({ rate: RATE, at: 800 })
  calls.length = 0
  app.flyTo(TARGET, 1000)
  assert.deepEqual(calls.at(-1)![3].startRate, RATE, 'a hand-off whose clock is 200 ms behind the event is still carried')
  assert.equal(app.tween()!.t0, 800)
}

// 4. The production path: every tween has a floorBlend. The move is taken over at the pose it SHOWS at the shown clock (floor included), not at rig.pose,
// which is where the last step (drawn or not) left it.
{
  const NOW = 1000, AT = NOW - 16
  for (const floor of [1, 8]) {
    closeUp = floor; shown = (t) => t - 16
    const { rig, app } = build()
    // flyTo makes the tween the way production does (so it carries a floorBlend); a step that ran AHEAD of the drawn frame leaves rig.pose at NOW.
    rig.setPose({ lon: 0, lat: 0, dist: 6, pitch: 0, roll: 0 })
    app.flyTo(endAt(P(-20, 10, 1.2)), 0, 3000)
    const prior = app.tween() as unknown as { floorBlend?: unknown; floorDist: number; endWasFloorBound: boolean; endBaseDist: number }
    assert.ok(prior.floorBlend, 'a production tween always carries a floorBlend')
    app.stepTween(NOW)
    const aheadDist = rig.pose.dist, aheadLon = rig.pose.lon
    const sample = tweenAt(prior as never, AT)
    const eff = sampleEffectiveFloorState(sample.pose.dist, prior.floorDist, prior.floorBlend as never, AT, prior.endWasFloorBound, prior.endBaseDist).dist
    assert.ok(Math.abs(rig.pose.lon - sample.pose.lon) > 1e-4, 'the rig stands one step ahead of the shown picture')
    calls.length = 0
    app.flyTo(endAt(P(30, -20, 1.3)), NOW)
    const from = calls.at(-1)![1].pose
    assert.ok(Math.abs(from.lon - sample.pose.lon) < 1e-9 && Math.abs(from.lat - sample.pose.lat) < 1e-9, `starts at the shown lon (${from.lon} vs ${sample.pose.lon}, rig ${aheadLon})`)
    assert.ok(Math.abs(from.dist - eff) < 1e-9, `with the floor in the distance (${from.dist} vs ${eff}, rig ${aheadDist})`)
    // Value-preserving when the step ran on the shown clock: same pose as rig.pose.
    const again = build()
    again.rig.setPose({ lon: 0, lat: 0, dist: 6, pitch: 0, roll: 0 })
    again.app.flyTo(endAt(P(-20, 10, 1.2)), 0, 3000)
    again.app.stepTween(AT)
    const atRig = { ...again.rig.pose }
    calls.length = 0
    again.app.flyTo(endAt(P(30, -20, 1.3)), NOW)
    const f2 = calls.at(-1)![1].pose
    assert.ok(Math.abs(f2.lon - atRig.lon) < 1e-9 && Math.abs(f2.lat - atRig.lat) < 1e-9 && Math.abs(f2.dist - atRig.dist) < 1e-9, `a step on the shown clock gives the same pose (${f2.dist} vs ${atRig.dist})`)
  }
  closeUp = 1; shown = (t) => t
}

// 5. An afterLoad re-plan drops the running approach and plans anew in the same event: the dropped approach's speed goes on.
{
  const { rig, app } = build()
  rig.setPose({ lon: 0, lat: 0, dist: 6, pitch: 0, roll: 0 })
  shown = (t) => t - 16; perfNow = 1000
  app.flyTo(endAt(P(-20, 10, 1.2)), 0, 3000)
  const prior = app.tween()!
  const wantRate = app.tweenRate(prior, 984)
  app.stepTween(1000) // a step that ran ahead of the drawn frame: rig.pose is one step beyond the picture
  const aheadLon = rig.pose.lon, drawnLon = tweenAt(prior as never, 984).pose.lon
  assert.ok(Math.abs(aheadLon - drawnLon) > 1e-4, 'the rig stands ahead of the shown picture')
  app.rememberTweenRate(); app.setTween(null); calls.length = 0
  app.flyTo(endAt(P(-21, 10, 1.2)), 1000)
  assert.ok(Math.abs(calls.at(-1)![1].pose.lon - drawnLon) < 1e-9, `the re-plan starts at the pose the approach showed (${calls.at(-1)![1].pose.lon} vs ${drawnLon}, rig ${aheadLon})`)
  const got = calls.at(-1)![3].startRate!
  assert.ok(got && Math.abs(got.lon - wantRate.lon) < 1e-9 && Math.abs(got.dist - wantRate.dist) < 1e-9, 'the re-plan starts at the speed the dropped approach had')
  assert.equal(app.tween()!.t0, 984, 'on the shown clock')
  shown = (t) => t
  // The two production re-plans (approachSite, playMoment) call it before they drop the tween.
  for (const fn of ['approachSite', 'playMoment']) {
    const i = main.indexOf(`function ${fn}(`), body = main.slice(i, main.indexOf('\n}\n', i))
    const a = body.indexOf('rememberTweenRate()'), b = body.indexOf('  tween = null')
    assert.ok(a > 0 && b > a, `${fn} remembers the approach's speed before it drops the tween`)
  }
}

// 6. A coasting spin (or an orbit, a flight) handed over: the speed of the last two drawn frames is the hand-off, and the spin's inertia stops.
{
  const { rig, app } = build()
  perfNow = 1016
  rig.setPose({ lon: 10, lat: 0, dist: 3, pitch: 0, roll: 0 }); app.recordDrawnPose(1000)
  rig.setPose({ lon: 10.24, lat: 0, dist: 3, pitch: 0, roll: 0 }); app.recordDrawnPose(1016)
  const r = app.drawnRate(1020)
  assert.ok(r && Math.abs(r.rate.lon - 15) < 1e-3 && r.at === 1016, `14.4 deg/s style rate from two drawn frames (${r?.rate.lon})`)
  assert.equal(app.drawnRate(1200), null, 'not from frames older than 100 ms')
  app.recordDrawnPose(1032)
  assert.equal(app.drawnRate(1040), null, 'a picture at rest hands nothing over')
  // flyTo stops the rig's inertia (the spin's velocity would otherwise ride on every pose of the move).
  let stopped = 0
  const real = rig.stopInertia.bind(rig); rig.stopInertia = () => { stopped++; real() }
  app.setTween(null); app.flyTo(TARGET, 1040)
  assert.equal(stopped, 1, 'a fly-to ends the coasting spin')
  // The drawn frames are recorded where the shown clock is set, in the production render.
  assert.match(main, /lastCamAt = cameraNow\n\s+if \(FLIGHT_FEEL\) recordDrawnPose\(cameraNow\)\n/, 'render records the drawn pose with the shown clock')
}


// 7. A drawn rate is the speed on screen, from camera POSITIONS (continuous across a pole) and a wrapped roll: coasts at any latitude give the true rate, a relabel never whips.
{
  const { rig, app } = build()
  let t = 2000
  const two = (a: { lon: number; lat: number; roll?: number }, b: { lon: number; lat: number; roll?: number }) => {
    t += 1000
    rig.pose = { dist: 3, pitch: 0, roll: 0, ...a }; app.recordDrawnPose(t)
    rig.pose = { dist: 3, pitch: 0, roll: 0, ...b }; app.recordDrawnPose(t + 16)
    return app.drawnRate(t + 20) as { rate: { lon: number; lat: number; roll: number } } | null
  }
  const wrapped = two({ lon: 10, lat: 0, roll: 179.9 }, { lon: 10.2, lat: 0, roll: -179.9 })
  assert.ok(wrapped && Math.abs(wrapped.rate.roll - 12.5) < 1e-6, `a roll through +-180 reads as 0.2 deg in a frame (${wrapped?.rate.roll})`)
  // A 30 deg/s coast due east at latitudes 0, 75, 89: the surface speed is 30 and the north rate 0; the longitude rate is that over cos(lat).
  for (const lat of [0, 75, 89]) {
    const step = 30 * 0.016 / Math.cos(lat * Math.PI / 180)
    const r = two({ lon: 10, lat }, { lon: 10 + step, lat })
    assert.ok(r, `a 30 deg/s coast at lat ${lat} is handed over`)
    const east = r.rate.lon * Math.max(0.02, Math.cos(lat * Math.PI / 180)), surface = Math.hypot(east, r.rate.lat)
    assert.ok(Math.abs(surface - 30) < 1.5, `lat ${lat}: surface rate ${surface.toFixed(2)} deg/s (${east.toFixed(2)} east, ${r.rate.lat.toFixed(2)} north)`)
    if (lat < 80) assert.ok(Math.abs(r.rate.lat) < 1.2, `due east at lat ${lat} has no north rate (${r.rate.lat})`)
  }
  // Straight over the pole: the longitude changes by 180 deg in the frame (a relabel) but the camera moved 0.2 deg: a 12.5 deg/s rate, bounded, no roll whip.
  const over = two({ lon: 10, lat: 89.9 }, { lon: 190, lat: 89.9 })
  assert.ok(over && Math.hypot(over.rate.lon * Math.cos(89.9 * Math.PI / 180), over.rate.lat) < 13.5 && Math.abs(over.rate.lon) <= 12.6 / 0.02 + 1 && over.rate.roll === 0, `a pass over the pole is its true 12.5 deg/s, bounded (lon ${over?.rate.lon})`)
  assert.equal(two({ lon: 10, lat: 0 }, { lon: 11.2, lat: 0 }), null, 'a surface speed of 75 deg/s is beyond the rig: nothing')
  assert.ok(two({ lon: 10, lat: 0 }, { lon: 10.5, lat: 0 }), 'and 31 deg/s is a coast: handed over')
}

// 8. planFly bounds the carried-velocity correction whatever start rate it is given (an absurd one: roll through +-180 unwrapped, a pole relabel).
{
  const from = endAt({ lon: 10, lat: 20, dist: 3, roll: 179.9, pitch: 0 }), to = endAt({ lon: -40, lat: -10, dist: 1.5, roll: 0, pitch: 0 })
  const walk = (startRate?: { lon: number; lat: number; dist: number; roll: number; pitch: number; fov: number }) => {
    const plan = planFly(e, from, to, { aspect, feel: true, startRate })
    const n = Math.round(plan.ms / 16)
    let prev = plan.at(0), surface = 0, rollStep = 0, rollExc = 0
    for (let i = 1; i <= n; i++) {
      const q = plan.at(i / n)
      surface = Math.max(surface, Math.hypot(wrapLon(q.pose.lon - prev.pose.lon) * Math.cos(prev.pose.lat * Math.PI / 180), q.pose.lat - prev.pose.lat))
      rollStep = Math.max(rollStep, Math.abs(q.pose.roll - prev.pose.roll)); rollExc = Math.max(rollExc, Math.abs(q.pose.roll - from.pose.roll)); prev = q
    }
    return { surface, rollStep, rollExc }
  }
  const rest = walk()
  const roll = walk({ lon: 15, lat: 0, dist: 0, roll: -359.8 / 0.016, pitch: 0, fov: 0 })
  const pole = walk({ lon: 179 / 0.016, lat: 0, dist: 0, roll: 0, pitch: 0, fov: 0 })
  assert.ok(roll.rollExc <= rest.rollExc + CARRY_MAX_EXCURSION.roll + 1, `a rolled-through rate adds at most ${CARRY_MAX_EXCURSION.roll} deg of roll (${roll.rollExc} vs ${rest.rollExc})`)
  assert.ok(roll.rollStep < 15, `no roll step of many degrees in a frame (${roll.rollStep})`)
  assert.ok(pole.surface < 3 * rest.surface, `a relabel rate does not fling the camera (${pole.surface} deg/frame vs ${rest.surface} at rest)`)
}

// 8b. The carry correction's longitude bound is surface travel: a 30 deg/s coast (the rig's own cap) is carried at its speed at high latitudes too.
{
  const speedAt = (lat: number): number => {
    const D = Math.PI / 180, r = 30 / Math.cos(lat * D)
    const plan = planFly(e, endAt({ lon: 10, lat, dist: 3, roll: 0, pitch: 0 }), endAt({ lon: -20, lat: 0, dist: 1.5, roll: 0, pitch: 0 }), { aspect, feel: true, startRate: { lon: r, lat: 0, dist: 0, roll: 0, pitch: 0, fov: 0 } })
    const u = 0.002, a = plan.at(0).pose, b = plan.at(u).pose
    return angularDistance(a.lon, a.lat, b.lon, b.lat) * 180 / Math.PI / (u * plan.ms / 1000)
  }
  for (const lat of [0, 45, 70, 75, 80, 85]) assert.ok(Math.abs(speedAt(lat) - 30) < 0.05 * 30 + 1, `the start speed at lat ${lat} is the incoming 30 deg/s (${speedAt(lat).toFixed(1)})`)
}

// 9. A hand-off from the drawn frames starts at the pose of the DRAWN frame (the rig may stand one undrawn step ahead), on the clock of that frame.
{
  const { rig, app } = build()
  rig.setPose({ lon: 10.5, lat: 0, dist: 3, pitch: 0, roll: 0 })
  app.setHandOff({ rate: RATE, at: 984, pose: { lon: 10, lat: 0, dist: 3, pitch: 0, roll: 0 }, fov: 30 })
  calls.length = 0
  app.flyTo(TARGET, 1000)
  assert.ok(Math.abs(calls.at(-1)![1].pose.lon - 10) < 1e-9, `the move starts at the drawn pose (${calls.at(-1)![1].pose.lon}), not the stepped rig`)
  assert.equal(app.tween()!.t0, 984)
}

// 10. EphemCarry's start velocity (sunStart): a carry handed the Sun's body-frame speed leaves at that speed, not at rest. Main no longer passes one
// (the orbit spin's held Sun went with the drag modes on 2026-10-31); the option stays a tested part of the carry.
{
  const clock = ephemerisAt(new Date('2026-10-20T19:00:00Z')), target = ephemerisAt(new Date('2026-10-29T12:00:00Z'))
  const body = (x: { sunDir: Vector3; moonX: Vector3; moonY: Vector3; moonZ: Vector3 }): Vector3 => new Vector3(x.sunDir.dot(x.moonX), x.sunDir.dot(x.moonY), x.sunDir.dot(x.moonZ))
  const ang = (a: Vector3, b: Vector3): number => Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 180 / Math.PI
  // A Sun turning in the Moon's body frame at OMEGA deg/s about `axis` (what a spinning hold did): its last two frames give the speed and direction.
  const axis = new Vector3(0.3, 0.8, 0.5).normalize(), OMEGA = 30, DT = 16
  const turned = (k: number): typeof clock => {
    const b = body(clock).applyQuaternion(new Quaternion().setFromAxisAngle(axis, k * OMEGA * DT / 1000 * Math.PI / 180))
    const sunDir = new Vector3().addScaledVector(clock.moonX, b.x).addScaledVector(clock.moonY, b.y).addScaledVector(clock.moonZ, b.z).normalize()
    return { ...clock, sunDir }
  }
  const prev = body(turned(29)), cur = body(turned(30))
  const preRate = ang(prev, cur) / (DT / 1000)
  assert.ok(preRate > 8, `the Sun moves in the body frame (${preRate.toFixed(1)} deg/s)`)
  const before = turned(30), PRESS = 30 * DT + 4
  const w = axis.clone().multiplyScalar(OMEGA * Math.PI / 180)
  type Opts = { ms?: number; u0?: number; replanAt?: number; grabAt?: number }
  const run = (sunRate?: Vector3, o: Opts = {}) => {
    const carry = new EphemCarry(before, target, PRESS, o.ms ?? 2500, sunRate && { rate: sunRate, ms: 2500 })
    const rates: number[] = []; let last = body(before), cos = 1, done = false
    for (let j = 1; j <= 200; j++) {
      // A fly-to's progress; a re-plan restarts it at 0 (newDriver), a grab ends the move (no progress: the carry's own clock).
      const u = (o.u0 ?? 0) + (j * DT) / 2500
      if (o.replanAt === j) carry.newDriver()
      const progress = o.grabAt !== undefined && j >= o.grabAt ? undefined : o.replanAt !== undefined && j >= o.replanAt ? (j - o.replanAt) * DT / 2500 : u
      const st = carry.step(PRESS + j * DT, j === 1 ? target : (carry as unknown as { last: typeof target }).last ?? target, progress)!
      const b = body(st.e); rates.push(ang(last, b) / (DT / 1000))
      if (j === 1) cos = b.clone().sub(last).normalize().dot(cur.clone().sub(prev).normalize())
      last = b
      if (st.done) { done = true; break }
    }
    return { rates, cos, done, end: ang(last, body(target)), tail: rates.at(-2) ?? 0 }
  }
  const withRate = run(w.clone().cross(body(before)))
  assert.ok(Math.abs(withRate.rates[0] - preRate) < 0.12 * preRate, `frame 1 of the carry moves the Sun at its speed (${withRate.rates[0].toFixed(1)} vs ${preRate.toFixed(1)} deg/s)`)
  assert.ok(withRate.cos > 0.9, `in its direction (cos ${withRate.cos.toFixed(3)})`)
  for (let j = 1; j < 12; j++) assert.ok(Math.abs(withRate.rates[j] - withRate.rates[j - 1]) < 0.2 * preRate, `no speed step at frame ${j + 1} (${withRate.rates[j - 1].toFixed(1)} -> ${withRate.rates[j].toFixed(1)})`)
  assert.ok(withRate.done && withRate.end < 1e-6, 'and it ends on the target')
  assert.ok(withRate.tail < 0.1 * preRate, `at rest (${withRate.tail.toFixed(2)} deg/s)`)
  // A late hand-off (the move's clock started 10 ms before the carry, the carry has the remaining time): the Sun's start speed is exact, the offset's time base is the whole move.
  const late = run(w.clone().cross(body(before)), { ms: 2490, u0: 0.004 })
  const lateFirst = late.rates[0] * DT / (DT + 10) // the first step spans the 10 ms the move had already run, plus one frame
  assert.ok(Math.abs(lateFirst - preRate) < 0.15 * preRate, `a late hand-off keeps the Sun's start speed (${lateFirst.toFixed(1)} vs ${preRate.toFixed(1)} deg/s)`)
  const shortMove = (() => { // the same on a short move whose remaining time is much less than its length
    const carry = new EphemCarry(before, target, PRESS, 1000, { rate: w.clone().cross(body(before)), ms: 2500 })
    const st = carry.step(PRESS + DT, target, 0.004 + DT / 2500)!
    return ang(body(before), body(st.e)) / ((DT + 10) / 1000)
  })()
  assert.ok(Math.abs(shortMove - preRate) < 0.15 * preRate, `and with 1000 ms left of 2500 (${shortMove.toFixed(1)} vs ${preRate.toFixed(1)} deg/s)`)
  // A re-plan (a new driver restarts the progress) or a grab (the move is gone, the own clock takes over) does not step the Sun: the offset goes on by the wall clock.
  // (A re-plan or a grab already steps the great-circle part of the blend, which restarts its own slope: that is the same with or without the spin offset, so the
  // bound is that same run without it; dropping the offset in one frame would add its whole value on top.)
  const maxStep = (rates: number[]): number => Math.max(...rates.slice(0, 60).map((v, k) => (k ? Math.abs(v - rates[k - 1]) : 0)))
  for (const o of [{ replanAt: 20 }, { grabAt: 20 }, { replanAt: 20, grabAt: 40 }] as Opts[]) {
    const withOffset = maxStep(run(w.clone().cross(body(before)), o).rates), baseline = maxStep(run(undefined, o).rates)
    assert.ok(withOffset < baseline + 0.1 * preRate, `no extra Sun speed step across ${JSON.stringify(o)} (${withOffset.toFixed(2)} deg/s vs ${baseline.toFixed(2)} without the offset)`)
  }
  const without = run()
  assert.ok(without.rates[0] < 0.2 * preRate, `without the rate the light starts at rest (${without.rates[0].toFixed(1)} deg/s): the step this fixes`)
  // Main hands no start velocity any more: no drag turns the Sun, so a carry always leaves from a Sun at rest in the body frame.
  assert.match(main, /new EphemCarry\(before, ephem, now, carryMs\)/, 'carryDate passes no Sun rate')
  assert.doesNotMatch(main, /sunSpin|SunHold|carrySpinSun/, 'the spin recorder and its carry are gone')
}

// 11. The layout aim leaves rest at zero speed (a pick from Home moves the disc's aim toward the cards' free rect; the exponential left at its fastest).
{
  const run = (feel: boolean): { steps: number[]; end: number } => {
    const rig = { aimShiftX: 0, aimShift: 0, lastZoomInputAt: 0 }
    const ctx: Record<string, unknown> = { homeZoomInputSeen: 0, homeFollowStep: () => { throw new Error('no Home follow here') }, STILL: false, ridge: null, groundMode: null, flight: null, layoutMeasuredAt: 1e12, LAYOUT_MEASURE_MS: 1000, layoutAimOn: true, descent: null, homeAimMinimal: false, tween: null, rig,
      frameTarget: { nx: 0.1, ny: -0.08 }, homeAimTarget: { nx: 0, ny: 0 }, FLIGHT_FEEL: feel, AIM_OMEGA: 7, aimVelX: { v: 0 }, aimVelY: { v: 0 }, aimWritten: { x: NaN, y: NaN }, homeFrame: false, homeDistApplied: 0,
      subjectFrame: () => null, safeRect: () => null, measureOccluders: () => null, minimalAim: () => null, homeDiscRadiusPx: () => 0, homeDistFor: () => 0 }
    const fn = new Function('ctx', `let { STILL, ridge, groundMode, flight, layoutMeasuredAt, LAYOUT_MEASURE_MS, layoutAimOn, descent, homeAimMinimal, tween, rig, frameTarget, homeAimTarget, FLIGHT_FEEL, AIM_OMEGA, aimVelX, aimVelY, aimWritten, homeFrame, homeDistApplied, subjectFrame, safeRect, measureOccluders, minimalAim, homeDiscRadiusPx, homeDistFor, homeZoomInputSeen, homeFollowStep } = ctx; ${getFunction('stepLayout')} return stepLayout;`)(ctx) as (now: number, dt: number) => boolean
    const steps: number[] = []; let prev = 0
    for (let i = 1; i <= 120; i++) { fn(1e12, 0.016); steps.push(Math.abs(rig.aimShiftX - prev)); prev = rig.aimShiftX }
    return { steps, end: rig.aimShiftX }
  }
  const spring = run(true), expo = run(false)
  assert.ok(Math.abs(spring.end - 0.1) < 1e-3 && Math.abs(expo.end - 0.1) < 1e-3, 'both settle on the target')
  assert.ok(spring.steps[0] < 0.12 * expo.steps[0] && spring.steps[0] < 0.3 * Math.max(...spring.steps), `the spring's first frame is nearly at rest (${spring.steps[0].toExponential(2)} vs the exponential's ${expo.steps[0].toExponential(2)})`)
  assert.ok(expo.steps[0] > 0.9 * Math.max(...expo.steps), 'the exponential starts at its fastest (the step this removes)')
  for (let i = 1; i < 60; i++) assert.ok(Math.abs(spring.steps[i] - spring.steps[i - 1]) < 0.35 * Math.max(...spring.steps), `no speed step at frame ${i + 1}`)
}

// 3. Home captures the picture on screen like a pick does.
{
  const body = main.slice(main.indexOf('function goHome('), main.indexOf('\n}\n', main.indexOf('function goHome(')))
  assert.match(body, /const shownBefore = last\?\.ephem \?\? ephem\n/, 'Home captures the last drawn ephemeris')
  assert.doesNotMatch(body, /const shownBefore = ephem\n/, 'not the (possibly undrawn) current one')
  assert.ok(body.indexOf('const shownBefore') < body.indexOf('ephem = clockSet(d'), 'and before the sky is set to now')
  const pickBody = (name: string) => main.slice(main.indexOf(`function ${name}(`), main.indexOf('\n}\n', main.indexOf(`function ${name}(`)))
  assert.match(pickBody('playMoment'), /const shownBefore = last\?\.ephem \?\? ephem\n/, 'the picks use the same capture')
}
// 12. Round 3d, the feel-clock backstop: a drawn frame advances the running fly-to by at most FEEL_MAX_STEP_MS (a pick's own planning and a burst of
// tile work made the frame after a pick 160-270 ms on the rig: the carried speed then leapt by the whole frame). The move's clock start and its floor
// blend slip by the excess, before anything reads the clock this frame (the date carry rides on its progress); a held start is not slipped.
{
  const feelSrc = await import('../src/journey/feel.ts')
  const mk = (t0: number, stepAt: number) => ({ t0, stepAt, plan: { ms: 2000 }, floorBlend: { from: 1, to: 1, t0 } })
  let tw: ReturnType<typeof mk>
  const fn = new Function('ctx', `let { FLIGHT_FEEL, feelClockSlip } = ctx; let tween = null; ${getFunction('feelBackstop')} return { feelBackstop, set: (t) => { tween = t } };`)({ FLIGHT_FEEL: true, feelClockSlip: feelSrc.feelClockSlip }) as { feelBackstop: (now: number) => void; set: (t: unknown) => void }
  // Ordinary frames: nothing moves.
  tw = mk(1000, 1000); fn.set(tw)
  for (const now of [1016, 1050, 1150]) fn.feelBackstop(now)
  assert.equal(tw.t0, 1000, 'frames up to FEEL_MAX_STEP_MS long do not slip the clock')
  // The pick's frame: 260 ms after the shown clock the move starts from; the camera advances 100 ms of the move, not 260.
  tw = mk(1000, 1000); fn.set(tw)
  fn.feelBackstop(1260)
  assert.equal(1260 - tw.t0, feelSrc.FEEL_MAX_STEP_MS, 'a 260 ms frame advances the move by FEEL_MAX_STEP_MS')
  assert.equal(tw.floorBlend.t0, tw.t0, 'the floor blend slips with it')
  fn.feelBackstop(1290)
  assert.equal(1290 - tw.t0, feelSrc.FEEL_MAX_STEP_MS + 30, 'the next frame runs on at full speed from there')
  // A held start (a date crossfade, t0 in the future): only the move's own time counts.
  tw = mk(1300, 1000); fn.set(tw)
  fn.feelBackstop(1350)
  assert.equal(tw.t0, 1300, 'a frame inside the hold, or 50 ms past its end, does not slip')
  fn.feelBackstop(1600)
  assert.equal(tw.t0, 1300 + 150, 'the move\'s time past the last frame (250 ms) is capped at 100')
  // Off with the feel: the old clock.
  const off = new Function('ctx', `let { FLIGHT_FEEL, feelClockSlip } = ctx; let tween = null; ${getFunction('feelBackstop')} return { feelBackstop, set: (t) => { tween = t } };`)({ FLIGHT_FEEL: false, feelClockSlip: feelSrc.feelClockSlip }) as { feelBackstop: (now: number) => void; set: (t: unknown) => void }
  tw = mk(1000, 1000); off.set(tw); off.feelBackstop(1500)
  assert.equal(tw.t0, 1000, '?flightfeel=0 keeps the wall clock')
  // Called by the frame loop before the date carry reads the move's progress.
  const body = main.slice(main.indexOf('function frameLoopBody('), main.indexOf('\n}\n', main.indexOf('function frameLoopBody(')))
  assert.ok(body.includes('feelBackstop(now)') && body.includes('stepDateCarry(now)') && body.indexOf('feelBackstop(now)') < body.indexOf('stepDateCarry(now)'), 'frameLoopBody slips the clock before the carry steps')
  // One prefetch build per pick with the feel on: flyTo leaves it to the first stepTween (prefetchAt -Infinity).
  const fly = main.slice(main.indexOf('function flyTo('), main.indexOf('\n}\n', main.indexOf('function flyTo(')))
  assert.match(fly, /if \(TILE_BASE && !FLIGHT_FEEL\) void prefetchFlight\(buildFlightPrefetchTargets/, 'flyTo builds the prefetch list only with the feel off')
  assert.match(fly, /prefetchAt: -Infinity/, 'and the first stepTween builds it')
}
// 13. Round 3d review (reviewers A and B of eb8ae97).
{
  const { feelClockSlip: feelSrcSlip } = await import('../src/journey/feel.ts')
  // B1: an event in a hitch (the last drawn frame 250 ms old) samples the running move at the drawn clock, not at `now` (the whole gap ahead of the picture).
  const sc = new Function('ctx', `let { FLIGHT_FEEL, lastCamAt } = ctx; ${getFunction('shownClock')} return shownClock;`)
  assert.equal((sc({ FLIGHT_FEEL: true, lastCamAt: 1000 }) as (n: number) => number)(1250), 1000, 'a 250 ms old drawn frame is still the clock a carried move starts from')
  assert.equal((sc({ FLIGHT_FEEL: true, lastCamAt: 1000 }) as (n: number) => number)(1016), 1000, 'and a recent one')
  assert.equal((sc({ FLIGHT_FEEL: false, lastCamAt: 1000 }) as (n: number) => number)(1016), 1016, '?flightfeel=0: the event time')
  // A2/B2 (and D1, C3 of 46db6f1): the look a move recovers runs on the move's clock. flyTo starts it at t0 (the drawn frame's time for a carried start), and the
  // backstop slips it by the move's own slip whenever it was running (or held) at the move's last step, however long the gap: they end together.
  const rig = new CameraRig(); rig.setPose({ lon: 5, lat: 5, dist: 1.5, pitch: 30, roll: 0 })
  const t0 = 1000, ms = 2000
  rig.lookAtMoon(true, t0, e, aspect, ms, 0)
  let moveT0 = t0, stepAt = t0
  for (const now of [1016, 1032, 61032, 61048, 61400]) {
    const slip = feelSrcSlip(stepAt, moveT0, now)
    moveT0 += slip
    rig.shiftLookClock(slip, stepAt)
    stepAt = now
    assert.ok(Math.abs(rig.lookRemainingS(now) * 1000 - Math.max(0, moveT0 + ms - now)) < 1e-6, `the look ends with the move (frame at ${now}: ${rig.lookRemainingS(now) * 1000} vs ${moveT0 + ms - now} ms)`)
  }
  const done = new CameraRig(); done.lookAtMoon(true, 0, e, aspect, 500, 0); const r0 = done.lookRemainingS(5000); done.shiftLookClock(150, 4000)
  assert.equal(done.lookRemainingS(5000), r0, 'a turn that had finished at the last step is left alone')
  const fb = main.slice(main.indexOf('function feelBackstop('), main.indexOf('\n}\n', main.indexOf('function feelBackstop(')))
  assert.match(fb, /if \(tween\.recoverLook\) rig\.shiftLookClock\(slip, stepAt\)/, 'feelBackstop slips the recovered look with the move, judged at its last step')
  const flyB = main.slice(main.indexOf('function flyTo('), main.indexOf('\n}\n', main.indexOf('function flyTo(')))
  assert.match(flyB, /const lookAt = FLIGHT_FEEL \? Math\.min\(t0, now\) : now\n {4}const holdMs = t0 - lookAt/, 'flyTo starts the look on the move\'s clock')
  // C2: Stop (and every pick or Home, which stop first) starts from the distance stepTween drew, not the old blend formula.
  const stopB = main.slice(main.indexOf('function stopMoments('), main.indexOf('\n}\n', main.indexOf('function stopMoments(')))
  assert.match(stopB, /const dist = FLIGHT_FEEL \? sampleEffectiveFloorState\(shown\.pose\.dist, tween\.floorDist, tween\.floorBlend, now, tween\.endWasFloorBound, tween\.endBaseDist\)\.dist/, 'stopMoments samples the drawn distance')
  // A1: a carried start over a pole (a spin coast leaves |lat| up to 90) starts exactly at the start pose and does not get pulled to 89.5 on frame 1.
  for (const rate of [{ lon: 0, lat: 3, dist: 0, roll: 0, pitch: 0, fov: 0 }, { lon: 200, lat: 0, dist: 0, roll: 0, pitch: 0, fov: 0 }]) {
    const from = { pose: { lon: 30, lat: 89.8, dist: 1.5, roll: 0, pitch: 0 }, fovDeg: 30, aimShift: 0, aimShiftX: 0, look: 0 as const }
    const plan = planFly(e, from, endAt(P(10, 60, 1.2)), { aspect, feel: true, startRate: rate })
    const a0 = plan.at(0).pose.lat, a1 = plan.at(1e-6).pose.lat, a2 = plan.at(16 / plan.ms).pose.lat
    assert.ok(Math.abs(a0 - 89.8) < 1e-9 && Math.abs(a1 - a0) < 1e-3 && Math.abs(a2 - a0) < 0.25, `a start at lat 89.8 continues from it (${a0}, ${a1}, ${a2})`)
  }
  // A4: Home's minimal aim ends with Home's framing: a label, search result, terminator, route or moment frames its subject in the cards' free rect.
  for (const name of ['flyToPoint', 'flyToTerminator', 'startRouteFlight']) {
    const b = main.slice(main.indexOf(`function ${name}(`), main.indexOf('\n}\n', main.indexOf(`function ${name}(`)))
    assert.match(b, /\/\/ v2: Home's minimal aim[^\n]*\n {2,4}homeAimMinimal = false\n/, `${name} clears homeAimMinimal`)
  }
  // D3: the label and terminator fly-tos clear it with the move (after the tiles load), so Home's disc stays centred while they load or if they fail.
  for (const name of ['flyToPoint', 'flyToTerminator']) {
    const b = main.slice(main.indexOf(`function ${name}(`), main.indexOf('\n}\n', main.indexOf(`function ${name}(`)))
    assert.ok(b.indexOf('homeAimMinimal = false') > b.indexOf('ensureTiles().then('), `${name} clears it inside the tile load's then`)
  }
  // D2: the ridge (Skip returns to the Home pose) keeps Home's aim.
  const ridgeB = main.slice(main.indexOf('function openRidge('), main.indexOf('\n}\n', main.indexOf('function openRidge(')))
  assert.doesNotMatch(ridgeB, /homeAimMinimal = false/, 'openRidge leaves Home\'s aim alone')
  // A3 (retired 2026-10-31 with the drag modes): no drag turns the Sun, so a fly-to has no spin speed to carry; carrySpinSun is gone.
  assert.doesNotMatch(main, /function carrySpinSun\(/)
}
// 14. Final review (reviewer F of 6d74a80): a look turn re-planned while it runs starts from the view on screen (the old turn measured at its own length),
// and a free carry's Sun offset advances no more per frame than the camera's backstop.
{
  const rig = new CameraRig(); rig.setPose({ lon: 5, lat: 5, dist: 1.4, pitch: 35, roll: 20 })
  rig.lookToward(resolveEarth(e), true, 0, e, aspect, 600, 0)
  rig.lookAtMoon(true, 1000, e, aspect, 2000, 0)
  const before = rig.camera(e, aspect, 1520).back.clone()
  rig.lookAtMoon(true, 1520, e, aspect, 3000, 0)
  const after = rig.camera(e, aspect, 1520).back
  assert.ok(before.angleTo(after) < 1e-6, `a re-planned turn starts on the view shown (${(before.angleTo(after) * 180 / Math.PI).toFixed(3)} deg)`)
  // Free carry: a 250 ms gap moves the offset parameter by FEEL_MAX_STEP_MS of the move, not 250 ms.
  const { FEEL_MAX_STEP_MS } = await import('../src/journey/feel.ts')
  const rate = new Vector3(0, 0, 0.35)
  const c = new EphemCarry(e, e, 0, 2000, { rate, ms: 2000 })
  c.step(0, e, 0); c.step(16, e, 0.008)
  c.newDriver()
  let shown = c.step(32, e, 0)!.e
  const sunAt = (x: typeof e) => new Vector3(x.sunDir.dot(x.moonX), x.sunDir.dot(x.moonY), x.sunDir.dot(x.moonZ))
  const s0 = sunAt(shown)
  shown = c.step(48, shown, 0.0001)!.e
  const s1 = sunAt(shown), d16 = s0.angleTo(s1)
  shown = c.step(298, shown, 0.0002)!.e
  const d250 = s1.angleTo(sunAt(shown))
  assert.ok(d250 < (FEEL_MAX_STEP_MS / 16) * d16 * 1.3, `a 250 ms frame moves the free Sun offset about FEEL_MAX_STEP_MS worth (${(d250 / d16).toFixed(2)} x a 16 ms frame)`)
}
console.log('camera-feel-review: ok')
