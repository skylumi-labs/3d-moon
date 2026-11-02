/**
 * The Apollo 17 arrival hold (`?a17arrive=hold`, owner complaint 7, 2026-10-23): the pure gate that lets the drop start (src/descent/arrival.ts
 * landingReady), the stall rule, the held overview's pose (the site in the middle of the frame), and the main.ts wiring: the switch, the gate call,
 * cancellation like a press during the drop, the closed panorama staying on the ground (#10). Offline. npx tsx scripts/arrival-hold.test.mts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Vector3 } from 'three'
import { CameraRig } from '../src/camera/rig.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { poseBasis, reliefShare } from '../src/camera/pose.ts'
import { ARRIVAL_HOLD_DIST, ARRIVAL_HOLD_MAX_MS, ARRIVAL_HOLD_PITCH_DEG, ARRIVAL_PATCH_DEMAND, arrivalHoldPose, arrivalPatchDemand, holdLevelsWanted, landingHoldStalled, landingReady } from '../src/descent/arrival.ts'
import { wantsLevel, type PatchDemand } from '../src/moon/patch/demand.ts'
import { PATCH_SITES } from '../src/moon/patch/sites.ts'

const R_M = 1737400
const a17 = PATCH_SITES.a17
const G = a17.groundM / R_M

// --- The gate. The levels the eye view reads and the module are the picture: without them nothing drops, however long it takes.
assert.equal(holdLevelsWanted(4), 3, 'every level but the finest')
assert.equal(holdLevelsWanted(1), 1, 'never fewer than one')
assert.equal(holdLevelsWanted(0), 1)
assert.equal(holdLevelsWanted(4, 1), 2, 'a level whose fetch failed is not waited for')
assert.equal(holdLevelsWanted(4, 4), 1)

// --- The demand the hold feeds the patch (review 2026-10-23, both reviewers: the hold never asked for the levels it waited for). Run through the real demand
// policy (src/moon/patch/demand.ts wantsLevel) with Apollo 17's level ladder: at the overview the free, camera-derived demand wants the coarse bridge alone;
// the arrival demand wants every level and retains them.
{
  const ladder = [{ texelM: 59 }, { texelM: 4 }, { texelM: 0.6 }, { texelM: 0.25 }]
  const altKm = (ARRIVAL_HOLD_DIST - 1 - G) * R_M / 1000
  const free: PatchDemand = { altitudeKm: altKm, metresPerPixel: altKm * 1000 * Math.tan(15 * Math.PI / 180) / 540, zoomedIn: true, hold: false }
  const freeWants = ladder.map((l) => wantsLevel(l, arrivalPatchDemand(false, free)))
  assert.deepEqual(freeWants, [true, false, false, false], `the free demand at ${altKm.toFixed(0)} km wants the bridge alone (the bug)`)
  const holdWants = ladder.map((l) => wantsLevel(l, arrivalPatchDemand(true, free)))
  assert.deepEqual(holdWants, [true, true, true, true], 'the arrival demand wants every level')
  assert.equal(arrivalPatchDemand(true, free).hold, true, 'and retains them until the arrival ends')
  assert.equal(arrivalPatchDemand(false, free), free, 'a free camera keeps its own demand')
  assert.deepEqual(ARRIVAL_PATCH_DEMAND, { altitudeKm: 0, metresPerPixel: 0.01, zoomedIn: true, hold: true }, 'the descent\'s own demand, unchanged')
  // The target is the declared ladder less the finest, so the gate waits for the 4 m and 0.6 m levels, not for the one level that happens to be resident.
  assert.equal(holdLevelsWanted(ladder.length), 3)
  assert.equal(landingReady(1, holdLevelsWanted(ladder.length), 0, true, 0), false, 'one resident level does not release the drop')
  assert.equal(landingReady(3, holdLevelsWanted(ladder.length), 0, true, 0), true)
}
assert.equal(landingReady(3, 3, 0, true, 0), true, 'everything in: drop at once')
assert.equal(landingReady(2, 3, 0, true, 0), false, 'a level short: wait')
assert.equal(landingReady(3, 3, 0, false, 0), false, 'no module: wait')
assert.equal(landingReady(3, 3, 4, true, 0), false, 'shadow blocks still to build: wait')
assert.equal(landingReady(3, 3, 0, true, 0, false), false, 'ground programs not warmed: wait')
assert.equal(landingReady(3, 3, 4, true, ARRIVAL_HOLD_MAX_MS), true, 'past the cap the shadows no longer hold the drop (speed, not sharpness)')
assert.equal(landingReady(3, 3, 0, true, ARRIVAL_HOLD_MAX_MS, false), true, 'nor does the warm-up')
assert.equal(landingReady(2, 3, 0, true, ARRIVAL_HOLD_MAX_MS * 10), false, 'the levels hold it however long: never a drop into a blur')
assert.equal(landingReady(3, 3, 0, false, ARRIVAL_HOLD_MAX_MS * 10), false, 'so does the module')
assert.equal(ARRIVAL_HOLD_MAX_MS, 12000, 'the cap for a cold link')
// The stall: past the cap without the picture the overview stays and the chip shows; with the picture there is nothing to say.
assert.equal(landingHoldStalled(2, 3, true, ARRIVAL_HOLD_MAX_MS - 1), false, 'not before the cap')
assert.equal(landingHoldStalled(2, 3, true, ARRIVAL_HOLD_MAX_MS), true)
assert.equal(landingHoldStalled(3, 3, false, ARRIVAL_HOLD_MAX_MS), true)
assert.equal(landingHoldStalled(3, 3, true, ARRIVAL_HOLD_MAX_MS * 2), false, 'the picture is in: no stall (the shadows alone never stall it)')
// The gate and the stall agree: a stalled hold is never ready, and a hold past the cap that is not stalled is ready.
for (const res of [0, 1, 2, 3]) for (const lm of [false, true]) for (const unmet of [0, 5]) for (const warm of [false, true]) {
  const t = ARRIVAL_HOLD_MAX_MS + 1
  const ready = landingReady(res, 3, unmet, lm, t, warm), stalled = landingHoldStalled(res, 3, lm, t)
  assert.equal(ready, !stalled, `past the cap: ready xor stalled (levels ${res}, lm ${lm}, unmet ${unmet}, warm ${warm})`)
}

// --- The overview: 1.04 radii (about 69 km up), tilted, the site in the middle of the frame, the frame's top toward the end heading.
{
  const pose = arrivalHoldPose({ lon: a17.lon, lat: a17.lat }, a17.end.headingDeg, G, reliefShare)
  assert.equal(pose.dist, ARRIVAL_HOLD_DIST)
  assert.ok((pose.dist - 1 - G) * R_M > 60000 && (pose.dist - 1 - G) * R_M < 80000, `about 69 km up (${((pose.dist - 1 - G) * R_M / 1000).toFixed(1)} km)`)
  assert.equal(pose.pitch, ARRIVAL_HOLD_PITCH_DEG, 'reliefShare is 1 this low: the tilt drawn is the tilt asked for')
  assert.equal(pose.roll, -a17.end.headingDeg)
  assert.ok(pose.lat < a17.lat, 'backed off south of the site for the end heading north')
  // The rig's camera for the pose looks at the site: the vector from the camera to the site is the line of sight within half a degree.
  const e = ephemerisAt(new Date('2026-10-23T09:00:00Z'))
  const rig = new CameraRig()
  rig.setFloor(1.0001)
  rig.setPose(pose)
  rig.fovDeg = 30
  const cam = rig.camera(e, 1.6, 0)
  const siteDir = poseBasis(e, { lon: a17.lon, lat: a17.lat, dist: 1 }).back.multiplyScalar(1 + G)
  const toSite = siteDir.clone().sub(cam.pos).normalize()
  const look = cam.back.clone().negate()
  const off = Math.acos(Math.min(1, toSite.dot(look))) * 180 / Math.PI
  assert.ok(off < 0.5, `the site is in the middle of the frame (${off.toFixed(3)} deg off the line of sight)`)
  // The tilt from straight down is the one asked for.
  const down = cam.pos.clone().negate().normalize()
  const tilt = Math.acos(Math.min(1, look.dot(down))) * 180 / Math.PI
  assert.ok(Math.abs(tilt - ARRIVAL_HOLD_PITCH_DEG) < 0.5, `tilted ${tilt.toFixed(2)} from straight down`)
  // The overview is well inside the Apollo 11 drop's funnel (1.4) and above the site's own floor (about 1.0007): the drop from it is the existing one, with no climb.
  assert.ok(pose.dist < 1.4 && pose.dist > 1.01)
  // A different heading backs off the other way; the geometry is the same.
  const east = arrivalHoldPose({ lon: a17.lon, lat: a17.lat }, 90, G, reliefShare)
  assert.ok(east.lon < a17.lon && Math.abs(east.lat - a17.lat) < 1e-9, 'heading east: the camera stands west of the site')
  assert.equal(east.roll, -90)
  void Vector3
}

// --- The wiring in main.ts (read, not run): the switch, the gate, the cancellation, the panorama close.
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.match(main, /const A17_ARRIVE_HOLD = new URLSearchParams\(location\.search\)\.get\('a17arrive'\) === 'hold'/, 'the switch defaults to legacy')
assert.match(main, /if \(A17_ARRIVE_HOLD && m\.groundEnd && \(replay \|\| !arrivalDirect\(\)\)\) beginArrivalHold\(m, now, fov1\)/, 'beat 1 only with the switch, and not for a camera already low and close (unless it is the explicit replay)')
assert.match(main, /landingReady\(moon\.boundLevels, wanted, patchShadowCache\?\.stats\.pending \?\? 0, lmOk, waited, groundProgramsWarm\(\)\)/, 'the gate reads the levels, the shadow blocks, the module, the clock and the warm-up')
assert.match(main, /if \(!pendingLanding \|\| descent \|\| \(h\.generation !== undefined && !journey\.current\(h\.generation\)\)/, 'a press (pendingLanding cleared, the journey cancelled) ends the hold like a press during the drop')
assert.match(main, /function stepSiteLanding\(now: number\): boolean \{\n {2}if \(arrivalHold\) return stepArrivalHold\(now\)/, 'the hold runs from the frame loop through stepSiteLanding')
assert.match(main, /caption\.show\('Still loading the sharp detail'/, 'the stall shows a chip, no drop')
assert.ok(!/patch\?\.retryRefinement\(\)\n\s+flyOutOverSite\(\)/.test(main), 'closing a panorama no longer flies out unconditionally')
assert.match(main, /if \(!onApollo17Ground\(\)\) flyOutOverSite\(\)/, 'closing a panorama on the ground stays on the ground (#10)')
assert.match(main, /function leaveGround\(silent = false, after\?: \(\) => void, overSite = false\): void \{[\s\S]{0,400}clearPendingPanorama\(\)/, 'leaving the ground drops a deferred panorama')
assert.match(main, /case 'orbit':\n(\s+\/\/[^\n]*\n)*\s+if \(groundMode\?\.active\) \{ takeCurrentScriptCamera\('other', true\); leaveGround\(false, \(\) => navApi\?\.away\(\), true\) \}/, '‹ at the first step on the ground: the journey cancelled (no deferred eye glide pulls the camera back), then up over the site and stop')
assert.match(main, /case 'panorama':\n[\s\S]{0,400}if \(onApollo17Ground\(\) && !opts\?\.replay\) \{ clearPendingPanorama\(\); navApi\?\.noteSelected\(a\); navApi\?\.closeSheet\(\); panoramaUi\?\.open\(/, 'a panorama from the ground opens where the visitor stands')
assert.match(main, /if \(groundMode\?\.active && !flight && !opts\?\.replay\) \{\n\s+const g = groundMode\n\s+if \(g\.lm\) \{ goViewpoint\('eye'\); break \}\n\s+lmLoadFailed = false\n\s+void g\.loadLm\(/, 'Return on the ground is a glide; a missing module is fetched again, never the flight')
assert.match(main, /if \(h\) \{ if \(opts\?\.replay\) arrivalReplayAt = performance\.now\(\); playPin\(h\) \}/, 'only replay flies again, and it stamps the intent')
assert.match(main, /const replay = now - arrivalReplayAt < ARRIVAL_REPLAY_WINDOW_MS\n\s+arrivalReplayAt = -1e9\n\s+if \(A17_ARRIVE_HOLD && m\.groundEnd && \(replay \|\| !arrivalDirect\(\)\)\) beginArrivalHold/, 'replay bypasses the direct glide into the hold')
assert.match(main, /const rest = !descent\.replay && directArrival\(/, 'and in the legacy path')
// Review: the demand, the warm-up's completion, the hold's life tied to the journey, the module's retry.
assert.match(main, /updateDemand\(arrivalPatchDemand\(!!\(descent \|\| arrivalHold\), \{ altitudeKm, metresPerPixel: altitudeKm \* 1000 \* canvasTanPerPx, zoomedIn: close, hold: false \}\)\)/, 'the hold feeds the arrival demand (every level, retained) while it is set')
assert.match(main, /function holdLevelsTarget\(p: PatchLayer\): number \{\n\s+return holdLevelsWanted\(p\.availableLevels\.length, p\.failedLevelNames\.length\)/, 'the target counts the declared levels less the failed ones, never the resident ones')
assert.match(main, /const wanted = patch \? holdLevelsTarget\(patch\) : 1/)
assert.match(main, /g\.warm\(idleSlot, groundWarmKinds\(metadataWarm\)\)\.then\(\(\) => \{ groundWarmDone = true \}, \(\) => \{ groundWarmDone = true \}\)/, 'the ground warm-up counts when it has finished, not when it starts')
assert.match(main, /function groundProgramsWarm\(\): boolean \{\n\s+return !PRECOMPILE\.has\('ground'\) \|\| groundWarmDone/)
{
  const stop = main.slice(main.indexOf('function stopMoments('), main.indexOf('const now0 = ('))
  assert.match(stop, /pendingLanding = null\n\s+endArrivalHold\(\)/, 'stopMoments ends a hold with the journey (and takes its chip down)')
}
assert.match(main, /function endArrivalHold\(\): void \{\n\s+if \(!arrivalHold\) return\n\s+if \(arrivalHold\.stalled\) caption\.clear\(\)\n\s+arrivalHold = null/)
assert.match(main, /run: \(\) => \{ patch\?\.retryRefinement\(\); holdLoadLm\(h\.generation\);/, 'Try again retries the module too')
assert.match(main, /function holdLoadLm\(generation: number \| undefined\): void \{[\s\S]{0,700}if \(!arrivalHold \|\| arrivalHold\.generation !== generation\) return\n\s+lmLoadFailed = true\n\s+endArrivalHold\(\)\n\s+pendingLanding = null\n\s+if \(generation !== undefined\) journey\.fail\(generation\)/, 'a module that fails to load ends the hold as a failed journey of its own generation')
assert.match(main, /const end = endOverride \?\? m\.end \?\? \(loadedSite\(\) \?\? PATCH_SITES\[m\.needsPatch \?\? 'a17'\]\)\.end/, 'the hold pose honours the debug end override like descentPose')
console.log('arrival-hold.test.mts: gate, stall, overview pose, main.ts wiring: ok')
