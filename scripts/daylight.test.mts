/** The fly-along's daylight clock: finds a lit time with the photograph's Sun, only forward, and eases smoothly: npm test */
import assert from 'node:assert/strict'
import { DARK_EL_DEG, lapseApproachMs, SUN_MATCH_DEG, SYNODIC_MS, daylightTarget, lapseClockMs, photoSun, sunAtSite, sunSeparation } from '../src/routes/daylight.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { PATCH_SITES } from '../src/moon/patch/sites.ts'

const a17 = PATCH_SITES.a17, a11 = PATCH_SITES.a11
// Sun geometry sanity: Apollo 17 landed in the morning (Sun in the east, low) on 1972-12-11 19:54Z; Apollo 11 at 1969-07-20 20:17Z, 10 degrees up in the east.
const land17 = sunAtSite(30.77, 20.19, ephemerisAt(new Date('1972-12-11T19:54:58Z')))
assert.ok(land17.elDeg > 10 && land17.elDeg < 16 && land17.azDeg > 60 && land17.azDeg < 120, `A17 landing sun ${JSON.stringify(land17)}`)
const land11 = sunAtSite(23.4729, 0.6741, ephemerisAt(new Date('1969-07-20T20:17:40Z')))
assert.ok(land11.elDeg > 8 && land11.elDeg < 16 && land11.azDeg > 60 && land11.azDeg < 120, `A11 landing sun ${JSON.stringify(land11)}`)

// A time the site is dark: the target is the earliest forward time with the photograph's Sun, lit, within a month.
for (const site of [a11, a17]) {
  const photo = photoSun(site.lon, site.lat, site.photoTime)
  assert.ok(photo.elDeg > 0, `${site.id} photograph is lit`)
  const from = new Date(Date.UTC(2026, 9, 4, 3, 0, 0))
  const now = sunAtSite(site.lon, site.lat, ephemerisAt(from))
  const r = daylightTarget(site.lon, site.lat, from, photo)
  if (now.elDeg >= DARK_EL_DEG && sunSeparation(now, photo) <= SUN_MATCH_DEG) { assert.equal(r, null); continue }
  assert.ok(r, `${site.id} has a target`)
  assert.ok(r.to.getTime() >= from.getTime() && r.to.getTime() - from.getTime() <= SYNODIC_MS, 'forward and within a month')
  assert.ok(r.sun.elDeg > DARK_EL_DEG, `${site.id} is lit on arrival (${r.sun.elDeg})`)
  assert.ok(r.errDeg < 4, `${site.id} Sun within 4 degrees of the photograph's (${r.errDeg})`)
}
// Already lit by the photograph's Sun: nothing to do.
const p17 = photoSun(a17.lon, a17.lat, a17.photoTime)
assert.equal(daylightTarget(a17.lon, a17.lat, new Date(a17.photoTime), p17), null)

// The lapse is one continuous, monotone, eased clock with zero speed at both ends.
const f = 1e12, t = 1e12 + 20 * 86_400_000
let prev = lapseClockMs(f, t, 0)
assert.equal(prev, f); assert.equal(lapseClockMs(f, t, 1), t)
let maxStep = 0
for (let i = 1; i <= 200; i++) { const c = lapseClockMs(f, t, i / 200); assert.ok(c >= prev); maxStep = Math.max(maxStep, c - prev); prev = c }
assert.ok(lapseClockMs(f, t, 0.005) - f < (t - f) * 0.0001, 'starts at zero speed')
assert.ok(maxStep < (t - f) * 0.015, 'no frame jumps the clock')
console.log('daylight ok')
// main.ts wires the lapse into the approach and states the clock in the caption, and never cross-fades a route.
import fs from 'node:fs'
const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.match(main, /daylightTarget\(site\.lon, site\.lat, time, photoSun\(/)
assert.match(main, /lapseClockMs\(rf\.lapse\.from, rf\.lapse\.to, u\)/)
const route = main.slice(main.indexOf('function startRouteFlight'), main.indexOf('/** Bumped by every camera-owning entry'))
assert.ok(!/beginDateChange|fadeFrame|setClock/.test(route), 'a route never fades')
assert.equal(lapseApproachMs(0.5), 5000); assert.equal(lapseApproachMs(24), 6000); assert.equal(lapseApproachMs(29.5), 7375); assert.equal(lapseApproachMs(400), 12000)
