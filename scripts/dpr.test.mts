// Distance-aware canvas pixel ratio (REVIEW-phone-perf S4).
import assert from 'node:assert/strict'
import { CLOSE_DPR_FROM, CLOSE_DPR_TO, dprFor, dprOverrideFromSearch, mayChooseRestRatio, MOTION_DPR_FROM_PX, motionDprCapFromSearch, motionDprFor, RestDprGovernor, restGovernorOn, restRatioAfterFold, REST_FACTOR_MIN, REST_SLOW_MS } from '../src/quality/dpr.ts'
import { CLASS_TABLE, shellProfile } from '../src/quality/startupClass.ts'

const ph = CLASS_TABLE['phone-android']
assert.equal(ph.dprCap, 1.5)
assert.equal(ph.closeDprCap, 1.25)
assert.equal(CLASS_TABLE.desktop.closeDprCap, undefined, 'desktop has no distance rule')
// iOS takes the same close-range rule as phone-android.
assert.equal(CLASS_TABLE.ios.closeDprCap, undefined, 'iOS website: no close cap (main)')
const iosApp = shellProfile('ios', CLASS_TABLE.ios, true)
assert.equal(iosApp.closeDprCap, ph.closeDprCap, 'iOS app close cap matches phone-android')
assert.equal(dprFor({ native: 3, cap: iosApp.dprCap, closeCap: iosApp.closeDprCap, dist: 0 }), 1.25, 'iOS app close in: 1.25')
assert.equal(dprFor({ native: 3, cap: iosApp.dprCap, closeCap: iosApp.closeDprCap, dist: 10 }), 1.5, 'iOS app far: 1.5')
assert.equal(dprFor({ native: 3, cap: CLASS_TABLE.ios.dprCap, closeCap: CLASS_TABLE.ios.closeDprCap, dist: 0 }), 1.5, 'iOS website close in: 1.5 (main)')
const pixel = { native: 3, cap: ph.dprCap, closeCap: ph.closeDprCap }
assert.equal(dprFor({ ...pixel, dist: 10 }), 1.5, 'far: the class cap')
assert.equal(dprFor({ ...pixel, dist: CLOSE_DPR_TO }), 1.5)
assert.equal(dprFor({ ...pixel, dist: CLOSE_DPR_FROM }), 1.25, 'at 1.8 radii: the close cap')
assert.equal(dprFor({ ...pixel, dist: 1.0 }), 1.25)
assert.equal(dprFor({ ...pixel, dist: 0 }), 1.25)
// Smooth: monotone in distance, in range, never a jump bigger than one step per 0.1 radii.
let prev = dprFor({ ...pixel, dist: 1.0 })
for (let d = 1.0; d <= 3; d += 0.01) {
  const v = dprFor({ ...pixel, dist: d })
  assert.ok(v >= prev - 1e-9 && v >= 1.25 && v <= 1.5, `monotone at ${d}`)
  prev = v
}
const mid = dprFor({ ...pixel, dist: (CLOSE_DPR_FROM + CLOSE_DPR_TO) / 2 })
assert.ok(mid > 1.25 && mid < 1.5, `blends between (${mid})`)
// A device below the cap keeps its own ratio; the close cap never raises it.
assert.equal(dprFor({ native: 1, cap: 1.5, closeCap: 1.25, dist: 10 }), 1)
assert.equal(dprFor({ native: 1, cap: 1.5, closeCap: 1.25, dist: 1 }), 1)
assert.equal(dprFor({ native: 1.25, cap: 1.5, closeCap: 1.25, dist: 10 }), 1.25)
// Classes without a close cap ignore distance.
assert.equal(dprFor({ native: 3, cap: 2, dist: 1 }), 2)
assert.equal(dprFor({ native: Number.NaN, cap: 2, dist: 1 }), 1)
// ?dpr= wins over everything, verbatim.
assert.equal(dprFor({ ...pixel, dist: 1, override: 2 }), 2)
assert.equal(dprOverrideFromSearch('?class=phone-android&dpr=2'), 2)
assert.equal(dprOverrideFromSearch('?dpr=1.25'), 1.25)
for (const bad of ['', '?dpr=', '?dpr=abc', '?dpr=0', '?dpr=-1', '?dpr=9']) assert.equal(dprOverrideFromSearch(bad), undefined, bad)
console.log('dpr: ok')


// rest governor: two slow rest frames in a row lower the ratio one step; a fast frame resets the count
{
  const g = new RestDprGovernor(true)
  assert.equal(g.fold(REST_SLOW_MS + 1), false, 'one slow frame is not enough')
  assert.equal(g.fold(REST_SLOW_MS - 1), false)
  assert.equal(g.fold(REST_SLOW_MS + 1), false, 'the count restarted')
  assert.equal(g.fold(REST_SLOW_MS + 1), true)
  assert.ok(Math.abs(g.factor - 0.85) < 1e-9)
}

// rest governor: ignores bad costs, is capped, and never goes under the motion ratio
{
  const g = new RestDprGovernor(true)
  for (const bad of [NaN, -5, 0, Infinity]) assert.equal(g.fold(bad), false)
  for (let i = 0; i < 100; i++) g.fold(500)
  assert.ok(g.factor >= REST_FACTOR_MIN && g.factor < 0.6)
  assert.equal(g.apply(2, 1.25), 1.25, 'floor at the motion ratio')
  assert.equal(g.apply(1.25, 1.25), 1.25, 'rest equal to motion: nothing to lower')
  assert.equal(g.apply(3, 1), 1.5, 'half of 3, quantised')
}

// rest governor: disabled changes nothing (the website)
{
  const g = new RestDprGovernor(false)
  for (let i = 0; i < 10; i++) assert.equal(g.fold(500), false)
  assert.equal(g.apply(2, 1), 2)
  assert.equal(g.factor, 1)
}

// R56 (W3-M3): who gets the governor. Web phones and the native shell yes; web desktop, tablet and software no; ?restgov overrides.
{
  assert.equal(restGovernorOn('phone-android', false, ''), true)
  assert.equal(restGovernorOn('ios', false, ''), true)
  for (const c of ['desktop', 'tablet', 'ipad', 'software']) assert.equal(restGovernorOn(c, false, ''), false, `web ${c}`)
  for (const c of ['phone-android', 'ios', 'tablet', 'ipad']) assert.equal(restGovernorOn(c, true, ''), true, `native ${c}`)
  assert.equal(restGovernorOn('desktop', true, ''), false, 'desktop never')
  assert.equal(restGovernorOn('phone-android', false, '?restgov=0'), false, 'switch reverts the default')
  assert.equal(restGovernorOn('phone-android', true, '?restgov=0'), false)
  assert.equal(restGovernorOn('tablet', false, '?restgov=1'), true, 'switch turns it on for an A/B')
  assert.equal(restGovernorOn('desktop', false, '?restgov=1'), false)
}

// R56: the ratio is never chosen again during a gesture; a fold in a gesture waits, between gestures it forces a new choice.
{
  assert.equal(mayChooseRestRatio(true, 1.5), false, 'mid-gesture: ratio fixed')
  assert.equal(mayChooseRestRatio(false, 1.5), true)
  assert.equal(mayChooseRestRatio(true, 0), true, 'nothing chosen yet')
  assert.equal(restRatioAfterFold(true, false, 2), 0, 'step at rest: choose again')
  assert.equal(restRatioAfterFold(true, true, 2), 2, 'step during a gesture: keep the ratio')
  assert.equal(restRatioAfterFold(false, false, 2), 2)
  // Whole path: a phone at rest 2 / motion 1.25 steps down on two slow frames, only once the gesture is over.
  const g = new RestDprGovernor(restGovernorOn('phone-android', false, ''))
  let rest = 2
  g.fold(150)
  rest = restRatioAfterFold(g.fold(150), true, rest)
  assert.equal(rest, 2, 'gesture running: unchanged')
  assert.ok(Math.abs(g.apply(rest, 1.25) - 1.7) < 1e-9, 'factor already lowered: 2 x 0.85, quantised')
  assert.equal(g.apply(1.25, 1.25), 1.25, 'never under motion')
  // hysteresis: a fast frame resets the slow count, so alternating slow/fast never steps
  const h = new RestDprGovernor(true)
  for (let i = 0; i < 20; i++) { assert.equal(h.fold(REST_SLOW_MS + 50), false); h.fold(REST_SLOW_MS - 50) }
  assert.equal(h.factor, 1)
  // it never raises within the session
  const l = new RestDprGovernor(true); l.fold(300); l.fold(300)
  const low = l.factor
  for (let i = 0; i < 50; i++) l.fold(10)
  assert.equal(l.factor, low, 'fast frames do not raise the factor')
}
console.log('rest governor web: ok')

// Rest to motion (WP-A, 2026-10-23), `?mdpr=1.5`: a motion-only ratio cap for canvases over 3 Mpx; the rest ratio (the canvas) is untouched.
{
  const owner = 1580 * 935 // the owner's window, CSS px: 4.58 Mpx at DPR 2
  assert.equal(motionDprFor(2, undefined, owner), 2, 'no cap: today')
  assert.equal(motionDprFor(2, 1.5, owner), 1.5, 'over 3 Mpx: motion frames at 1.5')
  assert.ok(1440 * 900 * 4 > MOTION_DPR_FROM_PX && 800 * 600 * 4 < MOTION_DPR_FROM_PX)
  assert.equal(motionDprFor(2, 1.5, 1440 * 900), 1.5, 'the rig size at DPR 2 (5.18 Mpx) is over the line too')
  assert.equal(motionDprFor(2, 1.5, 1023 * 781), 1.5, 'the M5 pane at DPR 2 (3.2 Mpx) is just over the line')
  assert.equal(motionDprFor(2, 1.5, 800 * 600), 2, 'a 1.9 Mpx canvas is under the line: untouched')
  assert.equal(motionDprFor(1.5, 1.5, owner), 1.5, 'cap at the ratio: no change')
  assert.equal(motionDprFor(1, 1.5, owner), 1, 'never raises')
  assert.equal(motionDprFor(2, 1.52, owner), 1.5, 'quantised to the DPR step')
  assert.equal(motionDprFor(2, 1.5, owner, 10e6), 2, 'a class with a higher line')
  assert.equal(motionDprCapFromSearch(''), undefined); assert.equal(motionDprCapFromSearch('?mdpr=1.5'), 1.5); assert.equal(motionDprCapFromSearch('?mdpr=0'), undefined); assert.equal(motionDprCapFromSearch('?mdpr=9'), undefined)
  assert.equal(CLASS_TABLE.desktop.motionDprCap, undefined, 'no class has the cap by default: the switch alone sets it')
  for (const c of Object.values(CLASS_TABLE)) assert.equal(c.motionDprCap, undefined)
  console.log('motion dpr cap: ok')
}
