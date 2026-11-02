import assert from 'node:assert/strict'
import { parseUtcFields, timeButtonLabel } from '../src/ui/timeFields.ts'

assert.equal(parseUtcFields('2026-10-20', '09:36')?.toISOString(), '2026-10-20T09:36:00.000Z')
assert.equal(parseUtcFields(' 2026-10-20 ', '9:05')?.toISOString(), '2026-10-20T09:05:00.000Z', 'a one-digit hour is fine')
assert.equal(parseUtcFields('2026-10-20', '23:59')?.toISOString(), '2026-10-20T23:59:00.000Z')
for (const [d, t] of [['2026-02-30', '10:00'], ['2026-13-01', '10:00'], ['2026-10-20', '24:00'], ['2026-10-20', '10:60'], ['20-10-2026', '10:00'], ['', ''], ['2026-10-20', '10']] as const) {
  assert.equal(parseUtcFields(d, t), null, `${d} ${t} is not a moment`)
}
assert.equal(parseUtcFields('0050-01-01', '00:00')?.toISOString(), '0050-01-01T00:00:00.000Z', 'years 0001-0099 are accepted as typed')
assert.equal(parseUtcFields('0001-01-01', '00:00')?.getUTCFullYear(), 1)
assert.equal(parseUtcFields('0000-01-01', '00:00'), null, 'there is no year 0 here')
assert.equal(parseUtcFields('0004-02-29', '12:00')?.getUTCDate(), 29, 'year 4 is a leap year')
assert.equal(parseUtcFields('0100-02-29', '12:00'), null, 'year 100 is not a leap year in the proleptic Gregorian calendar')
assert.equal(timeButtonLabel(true, new Date('2026-10-14T18:00:00Z')), 'Time')
assert.equal(timeButtonLabel(false, new Date('2026-10-14T18:00:00Z')), '14 Oct')
console.log('time-fields: ok')
