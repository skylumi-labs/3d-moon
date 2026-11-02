/**
 * Home during a pick's date carry, and Home after a historical moment (moon-camera-feel, review of #367): the sky continues from the picture on
 * screen. Before: a <60 s check skipped the fade and Home replaced the displayed (intermediate) ephemeris, the running carry cancelled itself and
 * the Sun jumped 135 deg in the body frame; after a historical moment Home froze 300 ms and crossfaded. tsx scripts/home-date-carry.test.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { EphemCarry } from '../src/journey/ephemCarry.ts'
import { ephemerisAt, type Ephemeris } from '../src/ephemeris.ts'

const DEG = 180 / Math.PI
/** The Sun's direction in the Moon's body frame (what the shading sees), deg between two ephemerides. */
const bodySun = (e: Ephemeris) => [e.sunDir.dot(e.moonX), e.sunDir.dot(e.moonY), e.sunDir.dot(e.moonZ)]
const angle = (a: number[], b: number[]) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * DEG

// A pick carries Apollo-17 time to a current date; Home is pressed 500 ms into it (time is already the destination's, the screen is not).
const apollo = ephemerisAt(new Date('1972-12-13T00:00:00Z'))
const current = ephemerisAt(new Date('2026-10-29T12:00:00Z'))
const pick = new EphemCarry(apollo, current, 0, 2000)
let shown: Ephemeris = current
for (let t = 16; t <= 500; t += 16) { const s = pick.step(t, shown); assert.ok(s); shown = s.e }
const onScreen = shown
assert.ok(angle(bodySun(onScreen), bodySun(current)) > 5, 'mid-carry: the screen is still between the two skies')
// Home (journey v2): carryDate(shownBefore = the displayed ephemeris, now's ephemeris) over the Home flight. Its first frame is the picture on screen.
const now = ephemerisAt(new Date('2026-10-29T12:00:20Z'))
const home = new EphemCarry(onScreen, now, 500, 2500)
const first = home.step(516, now)
assert.ok(first)
assert.ok(angle(bodySun(first.e), bodySun(onScreen)) < 0.5, `Home continues from the sky on screen (${angle(bodySun(first.e), bodySun(onScreen)).toFixed(3)} deg)`)
// ... and moves on in small steps all the way (no jump at any frame), ending on now's sky.
let prev = first.e, maxStep = 0, e: Ephemeris = first.e, done = false
for (let t = 532; t < 6000 && !done; t += 16) { const s = home.step(t, e); assert.ok(s); maxStep = Math.max(maxStep, angle(bodySun(s.e), bodySun(prev))); prev = s.e; e = s.e; done = s.done }
assert.ok(done, 'the Home carry finishes')
assert.ok(angle(bodySun(e), bodySun(now)) < 1e-6, 'and ends on now')
assert.ok(maxStep < 3, `largest Sun step per 60 fps frame ${maxStep.toFixed(2)} deg`)
// What the old Home did instead: replace the displayed sky with now's at once.
assert.ok(angle(bodySun(onScreen), bodySun(now)) > 5, `the replaced sky would have jumped ${angle(bodySun(onScreen), bodySun(now)).toFixed(1)} deg`)

// The production Home under v2 carries from the displayed ephemeris and has no crossfade or hold; ?flightfeel=0 keeps the old path.
const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const body = main.slice(main.indexOf('function goHome('), main.indexOf('\n}\n', main.indexOf('function goHome(')))
assert.match(body, /const shownBefore = last\?\.ephem \?\? ephem\n/, 'Home captures the sky on screen (the last drawn ephemeris, as a pick does) before it sets now')
assert.match(body, /if \(!FLIGHT_FEEL\) beginDateChange\(d, FADE_HOLD_MS\)/, 'the crossfade and its hold only with ?flightfeel=0')
assert.ok(body.indexOf('carryDate(shownBefore, false)') > body.indexOf('flyTo({ pose: { ...home'), 'the carry starts after the Home flight is planned (it rides on it)')
console.log('home-date-carry: ok')
