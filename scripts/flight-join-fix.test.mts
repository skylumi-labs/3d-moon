// The hand-over into a cinematic flight whose start moved during the approach (journey/joinFix.ts). The rig (2026-10-29) saw the Earthrise flight's
// first frame 17 % away from the fly-to's end (lon 128.14 -> 118.81 deg, 1.148 -> 1.065 radii): the start had been sampled against a higher floor
// when the pick was made, and finer tiles lowered it during the 19 s approach. Here the same flight is sampled under both floors.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getFlight, sampleFlight } from '../src/cinematics/flights.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { JOIN_FIX_MS, JOIN_GAP_REPORT, applyJoinFix, joinFixFor, joinGap } from '../src/journey/joinFix.ts'
import { MOMENTS } from '../src/moments.ts'

const m = MOMENTS.find((x) => x.id === 'earthrise')
assert.ok(m)
const f = getFlight(m)
assert.ok(f)
const e = ephemerisAt(m.time())
const ground = (): number => 0
const atPick = sampleFlight(f, 0, e, () => 1.148, ground, 1)
const sample = (u: number) => sampleFlight(f, u, e, () => 1.0005, ground, 1)
const dist3 = (p: { lon: number; lat: number; dist: number }, q: { lon: number; lat: number; dist: number }): number => {
  const v = (x: typeof p) => { const D = Math.PI / 180; return [x.dist * Math.cos(x.lat * D) * Math.cos(x.lon * D), x.dist * Math.cos(x.lat * D) * Math.sin(x.lon * D), x.dist * Math.sin(x.lat * D)] }
  const a = v(p), b = v(q)
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
const gap = dist3(atPick.pose, sample(0).pose)
assert.ok(gap > 0.05, `the start moves when the floor is lowered (${gap.toFixed(3)} radii): the case this guards`)

// 60 Hz from the fly-to's end (the start sampled at the pick) into the flight sampled under the lowered floor.
const t0 = 1000, secs = f.seconds
const spanU = JOIN_FIX_MS / (secs * 1000)
const fix = joinFixFor(atPick.pose, atPick.fovDeg, sample(0).pose, sample(0).fovDeg, 0, spanU)
assert.ok(fix)
assert.ok(joinGap(fix, sample(0).pose.lat) > JOIN_GAP_REPORT, `the Earthrise gap (${(joinGap(fix, sample(0).pose.lat) * 100).toFixed(1)} %) is over the report threshold: main.ts logs it`)
let prev = atPick.pose, worst = 0, own = 0, done = false
for (let k = 0; k <= 240; k++) {
  const now = t0 + (k * 1000) / 60
  const u = (now - t0) / (secs * 1000)
  const s = sample(u)
  const j = applyJoinFix(fix, s.pose, s.fovDeg, u)
  const step = dist3(prev, j.pose)
  worst = Math.max(worst, step)
  if (k > 0) own = Math.max(own, dist3(sample(u - 1 / 60 / secs).pose, s.pose))
  prev = j.pose
  done = j.done
}
assert.ok(dist3(atPick.pose, applyJoinFix(fix, sample(0).pose, sample(0).fovDeg, 0).pose) < 1e-9, 'the first flight frame is the pose on screen')
{
  // Held by the slider's pause at 0.5 s of the fade (review 2026-10-29: on the wall clock the camera drifted by the rest of the offset standing
  // still): the progress stands still, so does the pose.
  // The fade is a function of the flight's progress alone (no clock argument), and stepCinematic passes `u` (wiring below).
  const uHeld = 0.5 / secs
  const held = applyJoinFix(fix, sample(uHeld).pose, sample(uHeld).fovDeg, uHeld)
  assert.equal(applyJoinFix.length, 4, 'applyJoinFix takes the progress, not a clock')
  assert.ok(!held.done && dist3(held.pose, sample(uHeld).pose) > gap / 4, 'the offset is not spent while the flight stands at 0.5 s')
}
const fixRate = gap * 1.5 / (JOIN_FIX_MS / (1000 / 60))
assert.ok(worst <= own + 1.1 * fixRate, `no frame steps more than the flight's own motion plus the fade's: worst ${worst.toFixed(5)} radii (gap ${gap.toFixed(3)} over ${JOIN_FIX_MS} ms)`)
assert.ok(worst < gap / 20, 'the gap is spread over many frames')
assert.ok(done, 'the offset is spent within the 4 s checked, and the flight is on its own route')
assert.equal(joinFixFor(sample(0).pose, sample(0).fovDeg, sample(0).pose, sample(0).fovDeg, 0, spanU), null, 'no gap, no offset')

const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.match(main, /flight\.joinFix = joinFixFor\(rig\.pose, rig\.fovDeg, shot\.pose, shot\.fovDeg, u, JOIN_FIX_MS \/ \(flight\.definition\.seconds \* 1000\)\)/, 'stepCinematic takes the offset at its first sample, on the flight\'s progress')
assert.match(main, /const j = applyJoinFix\(flight\.joinFix, shot\.pose, shot\.fovDeg, u\)/, 'and fades it on the flight\'s progress')
assert.match(main, /shot\.pose = j\.pose\n\s+shot\.fovDeg = j\.fovDeg\n/, 'the faded pose and lens are the ones flown (B7)')
assert.match(main, /if \(gap > JOIN_GAP_REPORT\) \{ joinGaps\.push\(/, 'a large hand-over gap is recorded, not hidden')
console.log('flight-join-fix: ok')
