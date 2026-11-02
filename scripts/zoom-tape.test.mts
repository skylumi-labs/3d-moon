/**
 * The zoom tape's mapping and fade (SkyLumi's magnification tape, ported).
 *   tsx scripts/zoom-tape.test.mts
 */
import assert from 'node:assert/strict'
import { TAPE_DECADES, TAPE_IDLE_MS, TAPE_MAX_OPACITY, ZoomFade, arcPlacement, arcPoint, floorMarkerPosition, formatReadingM, formatTickM, heightAboveSurfaceM, tapeLayoutChanged, tapeLog, tapePosition, tapeTicks, tapeLimitPulse, tapeWakeAllowed, tickLabelCollidesWithReading, TAPE_GESTURE_TAIL_MS } from '../src/ui/zoomScale.ts'

// Height: above the sphere, above the site's ground, or the camera's own height in ground mode.
assert.equal(heightAboveSurfaceM({ distKm: 1737.4 + 500, groundKm: 0 }), 500_000)
assert.ok(Math.abs(heightAboveSurfaceM({ distKm: 1737.4 + 500, groundKm: 0.5 })! - 499_500) < 1e-6)
assert.equal(heightAboveSurfaceM({ distKm: 1737.4 + 500, groundKm: 0, aglM: 12 }), 12)
assert.equal(heightAboveSurfaceM({ distKm: Number.NaN, groundKm: 0 }), null)
assert.equal(heightAboveSurfaceM({ distKm: Number.NaN, groundKm: 0, aglM: Number.NaN }), null)

// Log mapping: floored at 0.1 m, null stays null (no invented reading).
assert.equal(tapeLog(1000), 3)
assert.equal(tapeLog(-5), -1)
assert.equal(tapeLog(null), null)
assert.equal(tapeLog(Number.NaN), null)

// The reading sits at the bar; a decade up is 1/TAPE_DECADES higher on the arc; higher heights sit toward the top.
assert.equal(tapePosition(1000, 3), 0.5)
assert.ok(Math.abs(tapePosition(10_000, 3) - (0.5 + 1 / TAPE_DECADES)) < 1e-12)
assert.ok(tapePosition(100, 3) < 0.5)
assert.equal(floorMarkerPosition(1000, 3), 0.5)
assert.ok(Math.abs(floorMarkerPosition(5_000, 3)! - (0.5 + Math.log10(5) / TAPE_DECADES)) < 1e-12)
assert.equal(floorMarkerPosition(1, 5), null, 'a floor outside the visible window is hidden')
assert.equal(floorMarkerPosition(null, 3), null)
assert.equal(floorMarkerPosition(Number.NaN, 3), null)
assert.equal(tapeLayoutChanged(3, 3, 500, 1000), true, 'a floor-only change redraws the marker')
assert.equal(tapeLayoutChanged(3, 3, 1000, 1000), false, 'unchanged reading and floor do not redraw')

// Ticks: 1..9 per decade, majors at 1-2-5 carry a label, real units.
const ticks = tapeTicks()
assert.equal(ticks[0].m, 1)
assert.equal(ticks[ticks.length - 1].m, 3e7)
assert.deepEqual(ticks.filter((t) => t.major && t.m < 10).map((t) => t.label), ['1 m', '2 m', '5 m'])
assert.ok(ticks.every((t) => (t.label !== undefined) === t.major))
assert.equal(ticks.find((t) => t.m === 1000)!.label, '1 km')
assert.equal(ticks.find((t) => t.m === 1e7)!.label, '10,000 km')
assert.equal(formatTickM(500), '500 m')

// Readings.
assert.equal(formatReadingM(3.04), '3.0 m')
assert.equal(formatReadingM(120.4), '120 m')
assert.equal(formatReadingM(999.4), '999 m')
assert.equal(formatReadingM(1500), '1.5 km')
assert.equal(formatReadingM(4_200_000), '4,200 km')

// Placement: compact at about a third of the viewport, centred, clear of the edge, with device-specific bounds.
const phone = arcPlacement(390, 844), desk = arcPlacement(1440, 900)
// A tall phone and a desktop window hit the caps (200 / 260 px): the tape stays an instrument, never a frame edge.
assert.equal(phone.height, 200)
assert.equal(desk.height, 260)
assert.ok(phone.height / 844 <= 0.3 && desk.height / 900 <= 0.3)
assert.equal(arcPlacement(1440, 4000).height, 260)
assert.equal(TAPE_MAX_OPACITY, 0.88)
assert.ok(Math.abs(phone.top + phone.height / 2 - 422) < 1e-9)
assert.ok(arcPoint(0.5, phone.x, phone.top, phone.height).x > 0 && phone.x < 100)
const landscapePhone = arcPlacement(500, 390)
assert.ok(Math.abs(landscapePhone.height - 390 * 0.3) < 1e-9)
assert.ok(landscapePhone.top >= 0)
assert.equal(arcPlacement(390, 240).height, 112, 'short phone view uses its px minimum')
assert.equal(arcPlacement(390, 1200).height, 200, 'tall phone view uses its px maximum')
assert.equal(arcPlacement(900, 300).height, 140, 'short desktop view uses its px minimum')
assert.equal(arcPlacement(900, 2000).height, 260, 'tall desktop view uses its px maximum')

// Fade: seeded by the first reading (hidden), shows on a change, hides after the idle delay, restarts on each change.
const f = new ZoomFade()
assert.equal(f.observe(3, 0), false, 'the first reading only seeds')
assert.equal(f.visibleAt(10), false)
assert.equal(f.observe(3 + 1e-6, 100), false, 'below the epsilon is not a zoom')
assert.equal(f.observe(3.1, 1000), true)
assert.equal(f.visibleAt(1000), true)
assert.equal(f.visibleAt(1000 + TAPE_IDLE_MS - 1), true)
assert.equal(f.visibleAt(1000 + TAPE_IDLE_MS), false)
assert.equal(f.observe(3.1, 2000), false, 'a held reading does not keep it up')
assert.equal(f.observe(3.5, 2000 + 800), true)
assert.equal(f.visibleAt(2000 + 800 + TAPE_IDLE_MS - 1), true, 'a new change restarts the delay')
assert.equal(f.remainingMs(2800 + 400), TAPE_IDLE_MS - 400)
assert.equal(f.remainingMs(9999), 0)
f.wake(10_000)
assert.equal(f.visibleAt(10_000), true, 'a limit hit can wake the tape without a height change')
assert.equal(f.observe(null, 0), false)
assert.equal(f.observe(Number.NaN, 0), false)
// Only the visitor's own zoom wakes it: a flight, Home or a time change moves the height without waking, and the reading still follows.
{
  const g = new ZoomFade()
  g.observe(3, 0, false)
  assert.equal(g.observe(3.5, 100, false), false, 'a height change without a zoom gesture does not wake')
  assert.equal(g.visibleAt(150), false)
  assert.equal(g.observe(3.5 + 1e-6, 200, true), false, 'the reading was followed: a gesture does not wake on the earlier flight change')
  assert.equal(g.observe(3.8, 300, true), true, 'a gesture does')
  assert.equal(g.visibleAt(400), true)
  g.sleep()
  assert.equal(g.visibleAt(400), false, 'a flight beginning puts it away')
  assert.equal(tapeWakeAllowed(1000, 0, false), true)
  assert.equal(tapeWakeAllowed(TAPE_GESTURE_TAIL_MS, 0, false), true, 'about 1.5 s after the last zoom input it still counts')
  assert.equal(tapeWakeAllowed(TAPE_GESTURE_TAIL_MS + 1, 0, false), false)
  assert.equal(tapeWakeAllowed(100, 0, true), false, 'never while the camera is scripted')
  assert.equal(tapeWakeAllowed(100, Number.NEGATIVE_INFINITY, false), false, 'no zoom input yet')
  assert.equal(tapeWakeAllowed(9000, 1000, false, 500), true, 'a zoom input since the last check counts even when a slow frame came 8 s later')
  assert.equal(tapeWakeAllowed(9000, 1000, false, 2000), false, 'but not one that was already seen and is older than the tail')
  assert.equal(tapeWakeAllowed(9000, 1000, true, 500), false, 'and never while scripted')
}
// The reading label stands just above the bar: a tick label there is hidden, the ones well away are kept.
{
  const h = 306
  assert.equal(tickLabelCollidesWithReading(0.5, h), true, 'on the bar')
  assert.equal(tickLabelCollidesWithReading(0.5 + 11 / h, h), true, 'right under the reading label')
  assert.equal(tickLabelCollidesWithReading(0.5 + 40 / h, h), false, 'a label 40 px above the bar is clear')
  assert.equal(tickLabelCollidesWithReading(0.5 - 40 / h, h), false, 'and 40 px below')
  assert.equal(tickLabelCollidesWithReading(0.5 + 20 / h, h), true, 'within one label height of the reading label')
  assert.equal(tickLabelCollidesWithReading(0.5 - 6 / h, h), true, 'F10: a label 6 px under the bar prints into the reading box (5,302 km over 5,000 km)')
  assert.equal(tickLabelCollidesWithReading(0.5 - 19 / h, h), true, 'and 19 px under')
  assert.equal(tickLabelCollidesWithReading(0.5 - 21 / h, h), true, '21 px under is still in the enlarged clearance')
  assert.equal(tickLabelCollidesWithReading(0.5 - 25 / h, h), false, '25 px under is clear')
}
{
  assert.deepEqual(tapeLimitPulse(1, 0, false), { pulse: true, seen: 1 })
  assert.deepEqual(tapeLimitPulse(1, 1, false), { pulse: false, seen: 1 })
  assert.deepEqual(tapeLimitPulse(3, 1, true), { pulse: false, seen: 3 }, 'a clamp during a flight is swallowed')
  assert.deepEqual(tapeLimitPulse(3, 3, false), { pulse: false, seen: 3 }, 'and does not pulse after the flight')
}
console.log('zoom-tape.test: ok')
