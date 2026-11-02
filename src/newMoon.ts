import { ephemerisAt, isWaxing } from './ephemeris'

/**
 * Home shows the real sky, so around new Moon it is nearly black. The note over Home offers the next evening on which the Moon is a visible crescent.
 * Everything here is pure; the note itself is ui/newMoonNote.ts.
 */

/** Home shows the note when the illuminated fraction at the current time is under this. */
export const NEW_MOON_BELOW = 0.1
/** The evening offered has at least this much of the disc lit: a crescent a person can see. */
export const CRESCENT_MIN = 0.15
/** The evening is taken at this hour UTC (the offer is in UTC, not the visitor's time zone). */
export const EVENING_UTC_HOUR = 18
/** How far ahead to look, days (a lunation is 29.5). */
export const SEARCH_DAYS = 40

export interface MoonSample { fraction: number; waxing: boolean }

/** The Moon at a date, from the ephemeris. */
export function moonSample(d: Date): MoonSample {
  const e = ephemerisAt(d)
  return { fraction: e.illuminatedFraction, waxing: isWaxing(e) }
}

/**
 * The first evening (`hourUtc` UTC) after `from` on which the Moon is waxing, so an evening crescent, with at least `minFraction` of the disc lit.
 * The sampler is a parameter so the search can be tested without the ephemeris. Null when none is found within `days`.
 */
export function nextLitEvening(
  from: Date, minFraction = CRESCENT_MIN, sample: (d: Date) => MoonSample = moonSample, hourUtc = EVENING_UTC_HOUR, days = SEARCH_DAYS,
): Date | null {
  const day0 = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hourUtc)
  for (let k = 0; k <= days; k++) {
    const d = new Date(day0 + k * 86400000)
    if (d.getTime() <= from.getTime()) continue
    const s = sample(d)
    if (s.waxing && s.fraction >= minFraction) return d
  }
  return null
}

/** "13 Oct, 18:00 UTC": what the offer says it chose. */
export function utcEveningLabel(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const hh = String(d.getUTCHours()).padStart(2, '0'), mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}, ${hh}:${mm} UTC`
}
