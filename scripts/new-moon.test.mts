/**
 * The new-Moon note on Home: the pure search for the next evening (UTC) on which the Moon is a visible crescent:
 *   npm test
 */
import assert from 'node:assert/strict'
import { CRESCENT_MIN, NEW_MOON_BELOW, nextLitEvening, moonSample, utcEveningLabel, type MoonSample } from '../src/newMoon.ts'
import { ephemerisAt } from '../src/ephemeris.ts'

// A made-up sky: new Moon at day 0, 6 % lit a day on (waxing), 17 % two days on, and so on; waning before.
const fake = (d: Date): MoonSample => {
  const day = (d.getTime() - Date.UTC(2026, 0, 10)) / 86400000
  return { fraction: Math.max(0, Math.min(1, 0.085 * Math.abs(day))), waxing: day > 0 }
}
{
  const from = new Date(Date.UTC(2026, 0, 10, 6))
  const got = nextLitEvening(from, 0.15, fake)!
  assert.equal(got.toISOString(), '2026-01-12T18:00:00.000Z', 'the first 18:00 UTC with at least 15 % lit and waxing')
  assert.ok(fake(got).fraction >= 0.15)
  // before the new Moon (waning, thin) the answer is still after it
  const before = nextLitEvening(new Date(Date.UTC(2026, 0, 8, 3)), 0.15, fake)!
  assert.ok(before.getTime() > Date.UTC(2026, 0, 10), 'a waning crescent is a morning sky: the offer waits for the waxing one')
  // after 18:00 on a qualifying day the next day's evening is the answer, never the past
  const late = nextLitEvening(new Date(Date.UTC(2026, 0, 12, 19)), 0.15, fake)!
  assert.equal(late.toISOString(), '2026-01-13T18:00:00.000Z')
  assert.ok(late.getTime() > Date.UTC(2026, 0, 12, 19))
  // a stricter threshold goes later; an impossible one gives null
  assert.equal(nextLitEvening(from, 0.5, fake)!.toISOString(), '2026-01-16T18:00:00.000Z')
  assert.equal(nextLitEvening(from, 2, fake), null)
  // exactly at the evening hour it is not "next"
  assert.equal(nextLitEvening(new Date(Date.UTC(2026, 0, 12, 18)), 0.15, fake)!.toISOString(), '2026-01-13T18:00:00.000Z')
}

// The real ephemeris: from the new Moon of 10 Oct 2026 the next evening has a waxing crescent of at least 15 %.
{
  const now = new Date('2026-10-11T09:00:00Z')
  assert.ok(ephemerisAt(now).illuminatedFraction < NEW_MOON_BELOW, 'the Moon is almost dark at the start')
  const got = nextLitEvening(now)!
  assert.ok(got, 'an evening is found')
  assert.equal(got.getUTCHours(), 18)
  const s = moonSample(got)
  assert.ok(s.waxing && s.fraction >= CRESCENT_MIN, `waxing and ${(s.fraction * 100).toFixed(1)} % lit`)
  assert.ok(s.fraction < 0.5, 'still a crescent, not a half Moon')
  // the evening before was too thin
  const prev = moonSample(new Date(got.getTime() - 86400000))
  assert.ok(!(prev.waxing && prev.fraction >= CRESCENT_MIN), 'it is the first such evening')
  assert.ok(got.getTime() - now.getTime() < 6 * 86400000, 'within days')
}

assert.equal(utcEveningLabel(new Date(Date.UTC(2026, 9, 13, 18))), '13 Oct, 18:00 UTC')
console.log('new-moon: ok')
