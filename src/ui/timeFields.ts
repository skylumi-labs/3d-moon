/** The plain message under the Time fields when they do not make a moment. */
export const TIME_FIELDS_HELP = 'Use a date like 2026-10-20 (years 0001 to 9999) and a time like 09:36 (24 hours, UTC).'

/** A moment typed as UTC `YYYY-MM-DD` and `HH:MM`; null when either is not a real date and time. Years 0001-0099 are real years (JS `Date.UTC` would read them as 19xx). */
export function parseUtcFields(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!d || !t) return null
  const [y, mo, da, h, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])]
  if (y < 1) return null
  const out = new Date(0)
  out.setUTCFullYear(y, mo - 1, da)
  out.setUTCHours(h, mi, 0, 0)
  if (h > 23 || mi > 59 || out.getUTCFullYear() !== y || out.getUTCMonth() !== mo - 1 || out.getUTCDate() !== da) return null
  return out
}

const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
/** The Time button's label: "Time" while the clock is live, the set date ("14 Oct") once it is not, so the visitor can see the clock is no longer live. */
export function timeButtonLabel(live: boolean, at: Date): string {
  return live ? 'Time' : SHORT.format(at)
}
