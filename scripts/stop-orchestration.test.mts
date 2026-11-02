import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { keepPatchLoad, onCancel } from '../src/journey/cancel.ts'
import { cancelJourneyAndContinuation } from '../src/journey/cancel.ts'
import { sampleEffectiveFloorState, sampleFloorBlend, smoothstep, tweenAt, tweenProgress } from '../src/camera/tween.ts'
import { ArrivalDwell } from '../src/journey/dwell.ts'
import { DescentFlight, HANDOVER_MS } from '../src/descent/flight.ts'
import { DescentPath, type TrackDoc } from '../src/descent/DescentPath.ts'
import { CameraRig } from '../src/camera/rig.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { frameAxes, makeSiteFrame } from '../src/ground/frame.ts'
const source = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.ES2022, true)
const declaration = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'stopMoments')
assert.ok(declaration)
const body = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const execute = new Function('ctx', `let { FLIGHT_FEEL, handOffRate, tweenRate, shownClock, drawnRate, playSeq, patchRefinementPaused, ridge, flight, flightHeldByStop, patchState, patchLoadGeneration, patchController, PATCH_BASE, patchLoading, patchSiteId, patchProgress, patch, groundMode, journey, orbitJourney, cinematicFlight, rigLook, approachFor, rig, ephem, canvasAspect, performance, last, scrub, pendingLanding, descent, tween, markMoved, markDirty, onCancel, keepPatchLoad, viewpointJourneyRunning, pinJourneyRunning, resumable, cause, pinShown, cancelPendingWheelZoom, cancelFlightPrefetch, tweenAt, tweenProgress, smoothstep, sampleFloorBlend, sampleEffectiveFloorState, cancelJourneyAndContinuation, clearPendingPanorama, resolveLook, pendingPanorama, resetScrubEnding, endArrivalHold } = ctx; ${body}; stopMoments(cause); return {resumable,rigLook,playSeq,patchRefinementPaused,ridge,flight,flightHeldByStop,patchState,patchLoadGeneration,patchSiteId,descent,tween,orbitJourney,cinematicFlight,handOffRate};`)
let cancelled = 0, aborted = 0, refinements = 0, glides = 0, settlements = 0, wheelCancelled = 0, redraws = 0, holdEnded = 0
const ctx = { FLIGHT_FEEL: true, handOffRate: null, tweenRate: () => ({ lon: 0, lat: 0, dist: 0 }), shownClock: (t: number) => t, drawnRate: () => null, keepPatchLoad, viewpointJourneyRunning: () => false, playSeq: 2, patchRefinementPaused: false, ridge: { playing: true, u: .5 }, flight: { playing: true }, flightHeldByStop: false,
 patchState: 'loading', patchLoadGeneration: 3, patchController: { abort: () => aborted++ }, PATCH_BASE: 'fixture', patchLoading: Promise.resolve(), patchSiteId: 'a17', patchProgress: {},
 patch: { cancelRefinement: () => refinements++ }, groundMode: { active: false, cam: { cancelGlide: () => glides++ } }, journey: { cancel: () => cancelled++ }, cancelFlightPrefetch: () => {},
 cinematicFlight: null,
 orbitJourney: {}, rigLook: 1, approachFor: 'test', rig: { settle: () => settlements++, hasActiveScriptState: () => false, freeOrientation: () => null, setPose: () => {}, stopInertia: () => {}, setLookBlend: () => {} }, ephem: {}, canvasAspect: () => 1.6, performance: { now: () => 100 }, last: { cam: {} }, scrub: { attach: () => {} }, pendingLanding: {}, descent: {}, tween: { t0: 0, plan: { ms: 2000, to: { pose: { lon: 1, lat: 1, dist: 1.1, roll: 0, pitch: 0 } }, at: () => ({ pose: { lon: 1, lat: 1, dist: 2, roll: 0, pitch: 0 }, fovDeg: 30, aimShift: 0, aimShiftX: 0, look: 0 }) }, floorBlend: null, floorDist: 1.1, endBaseDist: 1.1 }, markMoved: () => {}, markDirty: () => redraws++, onCancel, pinJourneyRunning: () => false, resumable: null as unknown, cause: undefined as unknown, pinShown: null as unknown, cancelPendingWheelZoom: () => wheelCancelled++, tweenAt, tweenProgress, smoothstep, sampleFloorBlend, sampleEffectiveFloorState, cancelJourneyAndContinuation, clearPendingPanorama: () => {}, resolveLook: () => ({}), pendingPanorama: null, resetScrubEnding: () => {}, endArrivalHold: () => holdEnded++ }
const result = execute(ctx)
assert.equal(result.ridge.playing, false); assert.equal(result.flight.playing, false); assert.equal(result.flightHeldByStop, true)
assert.equal(result.patchRefinementPaused, true); assert.equal(result.patchSiteId, null)
assert.equal(aborted, 1); assert.equal(glides, 1); assert.equal(cancelled, 1)
assert.equal(wheelCancelled, 1, 'ordinary Stop cancels an eased wheel tail')
assert.equal(holdEnded, 1, 'Stop ends an arrival hold with the journey')
assert.equal(redraws, 1, 'Stop requests a fresh render after settling the pose')
assert.equal(result.descent, null); assert.equal(result.tween, null); assert.equal(result.orbitJourney, null)
execute({ ...ctx, ridge: null, flight: null, patchState: 'ready' })
assert.equal(refinements, 1); assert.equal(settlements, 1)
const cinema = execute({ ...ctx, ridge: null, flight: null, groundMode: { active: true, cam: { cancelGlide: () => glides++ } }, patchState: 'ready', cinematicFlight: { definition: { seconds: 25 }, t0: 100, generation: 7 } })
assert.equal(cinema.cinematicFlight, null, 'Stop cancels the active cinematic route')
assert.equal(cancelled, 3, 'cinematic Stop invalidates its journey generation')
execute({ ...ctx, ridge: null, flight: null, patchState: 'ready' }); assert.equal(settlements, 2, 'repeated Stop stays an explicit settled-pose operation')
// Free orbiting is not a script: with no look offset, no held dolly zoom and no running move, pressing the Moon must not settle the camera
// (settle turned the Earth view into a 2 deg telephoto on every press: the owner's "the Moon moves further away when I drag").
execute({ ...ctx, ridge: null, flight: null, patchState: 'ready', orbitJourney: null, descent: null, tween: null })
assert.equal(settlements, 2, 'an idle press settles nothing')
execute({ ...ctx, ridge: null, flight: null, patchState: 'ready', orbitJourney: null, descent: null, tween: null, rig: { settle: () => settlements++, hasActiveScriptState: () => true, freeOrientation: () => [0, 0, 0, 1] } })
assert.equal(settlements, 3, 'an active script look still settles')
execute({ ...ctx, ridge: null, flight: null, patchState: 'ready', orbitJourney: null, descent: null, tween: null, rig: { settle: () => settlements++, hasActiveScriptState: () => false, freeOrientation: () => [0, 0, 0, 1] } })
assert.equal(settlements, 3, 'a settled free orientation is preserved during a wheel grab')
// v2: an orbit, a flight or a coasting spin stopped for a new move hands over the speed the picture had (drawnRate), not rest; ?flightfeel=0 hands over nothing.
{
  const R = { rate: { lon: 14.4, lat: 0, dist: 0, roll: 0, pitch: 0, fov: 0 }, at: 990 }
  const orbiting = { ...ctx, ridge: null, flight: null, patchState: 'ready', descent: null, tween: null, drawnRate: () => R }
  assert.deepEqual(execute(orbiting).handOffRate, R, 'a stopped orbit hands its drawn speed to the move planned in this event')
  assert.deepEqual(execute({ ...orbiting, orbitJourney: null, cinematicFlight: { definition: { seconds: 25 }, t0: 100, generation: 7 } }).handOffRate, R, 'a stopped cinematic flight too')
  // Home stops twice in one event (stopMoments, then takeCurrentScriptCamera): the second must not overwrite the first one's rate (the analytic rate of a fly-to).
  const analytic = { rate: { lon: 3, lat: 0, dist: 0, roll: 0, pitch: 0, fov: 0 }, at: 980 }
  assert.deepEqual(execute({ ...orbiting, handOffRate: analytic }).handOffRate, analytic, 'a second stop in the same event keeps the first hand-off')
  assert.equal(execute({ ...orbiting, FLIGHT_FEEL: false }).handOffRate, null, '?flightfeel=0 hands nothing over')
  assert.equal(execute({ ...orbiting, drawnRate: () => null }).handOffRate, null, 'a picture at rest hands nothing over')
}
// A pin's journey: a date change leaves it running; a grab stops it and remembers its end for a tap; another stop just stops it.
{
  const pin = { ...ctx, pinJourneyRunning: () => true, tween: { t0: 0, plan: { at: () => ({ pose: { lon: 1, lat: 1, dist: 2, roll: 0, pitch: 0 }, fovDeg: 30, aimShift: 0, aimShiftX: 0, look: 0 }), to: { pose: { lon: 1, lat: 1 }, ms: 2000 }, ms: 2000 }, floorBlend: null, floorDist: 1.1, endBaseDist: 1.1 }, ridge: null, flight: null }
  const beforeClock = wheelCancelled
  const kept = execute({ ...pin, cause: 'clock' })
  assert.ok(kept.tween, 'a date change does not stop a pin journey'); assert.equal(kept.playSeq, 2)
  assert.equal(wheelCancelled, beforeClock + 1, 'a date change cancels queued wheel zoom even when the pin journey continues')
  const shown = { moving: true, at: 0 }
  const beforeGrab = wheelCancelled
  const grabbed = execute({ ...pin, cause: 'grab', pinShown: shown })
  assert.equal(wheelCancelled, beforeGrab, 'grab keeps the user-driven wheel tail intact')
  assert.equal(shown.moving, false, 'the caption waits for a tap to resume')
  assert.equal(grabbed.tween, null); assert.equal((grabbed.resumable as { ms: number }).ms, 2000, 'a grab keeps the end for a tap to resume')
  assert.equal(execute({ ...pin, cause: undefined }).resumable, null)
}
assert.match(source, /!f \|\| !gm \|\| flightHeldByStop/)
assert.match(source, /ridge\.playing && ridge\.u >= 1/)
assert.match(source, /function flyTo\([\s\S]*?moonSurfaceTurn\.stopInertia\(\)/, 'any planned fly-to stops Moon coast')
assert.match(source, /net: \{ init: \{ signal: controller.signal(, priority: 'high')? \}( as RequestInit)? \}/)
assert.equal((source.match(/net: \{ init: \{ signal: controller.signal(, priority: 'high')? \}( as RequestInit)? \}/g) ?? []).length, 2, 'both fine/coarse production requests own the same generation AbortSignal')
const dwell = new ArrivalDwell(14000)
assert.equal(dwell.step(100000, false), false)
assert.equal(dwell.step(120000, true), false)
assert.equal(dwell.step(133999, true), false)
assert.equal(dwell.step(134000, true), true, 'full14s hold starts after late arrival')
assert.doesNotMatch(source, /mountFlightUi\(/, 'the archived powered-descent panel has no visitor entry point')
const path = DescentPath.fromDoc(JSON.parse(fs.readFileSync(new URL('../data/apollo17/descent-track.json', import.meta.url), 'utf8')) as TrackDoc)
const e = ephemerisAt(new Date('2026-10-01T00:00:00Z')), cam = new CameraRig().camera(e, 1.6, 0)
const axes = frameAxes(e, makeSiteFrame(30.765, 20.191, -2626))
for (const heldT of [-800, 100, 700]) {
 const flight = new DescentFlight(path); flight.seek(heldT); flight.playing = false
 flight.resume(cam, 1000)
 assert.equal(flight.t, heldT, 'production Resume preserves the original simulation clock')
 assert.equal(flight.playing, true, 'Resume does not toggle itself back off')
 const env = { axes, rs: 1734774, groundZ: null, nowMs: 1000 }
 const first = flight.evaluate(env).cam
 assert.equal(first.pos.distanceTo(cam.pos), 0); assert.ok(Math.abs(first.tanHalf - cam.tanHalf) < 1e-14)
 flight.advance(1); assert.equal(flight.t, heldT, 're-entry blend holds, rather than rewinds, the clock')
 flight.evaluate({ ...env, nowMs: 1000 + HANDOVER_MS + 1 }); flight.advance(1)
 assert.ok(flight.t > heldT, 'original flight proceeds after the continuity handoff')
}
console.log('stop-orchestration.test.mts: extracted production Stop, flight/ridge/glide/loading/refinement cancellation, repeated settlement and arrival-relative dwell: ok (browser input unrun)')

// #185: a wheel notch or tap (cause 'grab') on a free camera leaves a loading patch alone; a grab that stops a running script still cancels it.
{
  const before = aborted
  const free = execute({ ...ctx, cause: 'grab', ridge: null, flight: null, orbitJourney: null, descent: null, tween: null, approachFor: null, patchState: 'loading', patchLoadGeneration: 3, patchSiteId: 'a17', patchRefinementPaused: false })
  assert.equal(free.patchLoadGeneration, 3, 'grab on a free camera keeps the patch load generation')
  assert.equal(free.patchState, 'loading'); assert.equal(free.patchSiteId, 'a17'); assert.equal(aborted, before)
  const scripted = execute({ ...ctx, cause: 'grab', viewpointJourneyRunning: () => true, ridge: null, flight: null, patchState: 'loading', patchLoadGeneration: 3 })
  assert.equal(scripted.patchLoadGeneration, 4, 'grab that stops a running journey still cancels its patch load')
  assert.equal(aborted, before + 1)
}
