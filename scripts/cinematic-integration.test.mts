import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { ArrivalDwell } from '../src/journey/dwell.ts'
import { JourneyLifecycle } from '../src/journey/lifecycle.ts'
import { journeyClockStart, stallShift } from '../src/journey/join.ts'
import { JOIN_FIX_MS, JOIN_GAP_REPORT, applyJoinFix, joinGap } from '../src/journey/joinFix.ts'

const source = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.ES2022, true)
const declaration = ast.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === 'stepCinematic')
assert.ok(declaration, 'production cinematic step exists')
const body = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const execute = new Function('ctx', 'now', `let { cinematicFlight, journey, sampleFlight, ephem, rig, rigLook, flightAim, sunGaze, TILE_BASE, cancelFlightPrefetch, journeyClockStart, stallShift, targets, scrub, joinFixFor, applyJoinFix, JOIN_FIX_MS, JOIN_GAP_REPORT, joinGap, joinGaps, canvasAspect } = ctx; let joinHandOverAt = ctx.joinHandOverAt ?? null; ${body}; const moved = stepCinematic(now); return {moved, cinematicFlight, rigLook};`)

function fixture(startU = 0) {
  const journey = new JourneyLifecycle()
  const generation = journey.begin('cinema', 'Cinema', 'moon', 0)
  journey.sample(generation, 'approach', 1)
  const frames: Array<{ u: number; pose: unknown }> = []
  const ctx = {
    cinematicFlight: { definition: { seconds: 10 }, startU, t0: -1, generation, prefetchAt: -Infinity },
    journey,
    sampleFlight: (_def: unknown, u: number) => {
      const shot = { pose: { lon: u }, fovDeg: 50, look: 0 as const }
      frames.push({ u, pose: shot.pose })
      return shot
    },
    ephem: {}, rigLook: 0, TILE_BASE: '',
    cancelFlightPrefetch: () => {},
    targets: { releaseScratch: () => {} },
    // A gap-free hand-over (no join offset): journey/joinFix.ts and scripts/flight-join-fix.test.mts test the offset itself.
    journeyClockStart, stallShift, joinFixFor: () => null, applyJoinFix, JOIN_FIX_MS, JOIN_GAP_REPORT, joinGap, joinGaps: [] as unknown[], joinHandOverAt: null as number | null,
    scrub: { held: false },
    rig: { pose: { lon: 0, lat: 0, dist: 1, roll: 0 }, setPose: () => {}, fovDeg: 30, setLookBlend: () => {}, camera: () => ({}), settleCalls: 0, settle: () => { ctx.rig.settleCalls++ }, lastInputAt: 0 },
    flightAim: () => ({}),
    sunGaze: () => false,
    canvasAspect: () => 1,
  }
  return { ctx, journey, frames, generation }
}

{
  // Return resumes a flight the visitor left: its clock starts as if it had run for startU already.
  const { ctx } = fixture(0.4)
  execute(ctx, 1000)
  assert.equal(ctx.cinematicFlight.t0, 1000 - 0.4 * 10 * 1000, 'a resumed flight starts at its left-off progress')
}

{
  const { ctx, journey, frames, generation } = fixture()
  execute(ctx, 1000)
  assert.equal(ctx.cinematicFlight.t0, 1000, 'route clock starts on its first frame after approach')
  assert.equal(journey.state?.status, 'travelling')
  assert.equal(journey.state?.arrivalAt, null)
  const dwell = new ArrivalDwell(14000)
  assert.equal(dwell.step(10999, journey.state?.status === 'arrived'), false, 'the tour hold cannot begin while the route is still travelling')
  // Frames every 100 ms (the stall guard, journey/join.ts stallShift, would hold the clock over a single 10 s gap).
  for (let t = 1100; t < 10999; t += 100) execute(ctx, t)
  execute(ctx, 10999)
  assert.equal(journey.state?.status, 'travelling')
  assert.equal(journey.state?.arrivalAt, null)
  execute(ctx, 11000)
  assert.equal(journey.state?.status, 'arrived')
  assert.equal(journey.state?.arrivalAt, 11000, 'production route marks arrival at its endpoint')
  assert.equal(frames.at(-1)?.u, 1)
  assert.equal(dwell.step(11000, true), false)
  assert.equal(dwell.consumeStart(), true, 'arrival starts the dwell clock')
  assert.equal(dwell.step(24999, true), false)
  assert.equal(dwell.step(25000, true), true, 'the full dwell follows arrival')
  assert.equal(journey.current(generation), true)
}

{
  const { ctx, journey } = fixture()
  ctx.cinematicFlight.t0 = 1000
  ctx.cinematicFlight.lastNow = 10900
  const result = execute(ctx, 11000)
  assert.equal(result.cinematicFlight, null, 'the cinematic is cleared at its endpoint')
  assert.equal(result.rigLook, 0, 'the final Earth look is released')
  assert.equal(journey.state?.status, 'arrived')
  assert.equal(ctx.rig.settleCalls, 1, 'the final tracked view is released to free camera controls')
}

{
  const { ctx, journey, frames } = fixture()
  journey.cancel()
  const result = execute(ctx, 1000)
  assert.equal(result.moved, false, 'a cancelled generation cannot keep moving the camera')
  assert.equal(result.cinematicFlight, null, 'the stale cinematic continuation is cleared')
  assert.equal(frames.length, 0, 'a cancelled route does not sample another frame')
}

{
  // A slow frame (over the stall guard's 250 ms) holds the clock over it while the flight plays, but not under a held slider:
  // the slider has just put the clock where the finger is.
  const { ctx } = fixture()
  execute(ctx, 1000)
  execute(ctx, 1100)
  execute(ctx, 2100)
  assert.equal(ctx.cinematicFlight.t0, 2000, 'playing: the 1 s stall does not run the clock')
  ctx.scrub.held = true
  ctx.cinematicFlight.t0 = 8100 - 0.5 * 10 * 1000 // what the hold puts there for u = 0.5 at this frame (6 s after the last one)
  execute(ctx, 8100)
  assert.equal(ctx.cinematicFlight.t0, 8100 - 5000, 'held: no stall shift, the frame is drawn at the finger')
  assert.equal(ctx.cinematicFlight.lastNow, 8100)
}

assert.match(source, /cinematicFlight \|\| tween \|\| descent \|\| rig\.gliding\(\)/, 'cinematic route owns the camera')
assert.match(source, /else if \(!cinematicFlight && !orbitJourney/, 'generic frame arrival waits for the cinematic route')
assert.match(source, /rig\.settle\(ephem, endAspect, now, rig\.camera\(ephem, endAspect, now\)\)/, 'cinematic completion preserves its final view while releasing body tracking')
console.log('cinematic-integration.test.mts: route cancellation and arrival-relative dwell pass')
