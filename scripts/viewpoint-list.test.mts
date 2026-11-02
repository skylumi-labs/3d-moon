/** The visitor's viewpoint list: its order, sub-view stepping, the return-to-viewpoint state, the queued tap, and the authoring rule for flights. tsx scripts/viewpoint-list.test.mts */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ephemerisAt } from '../src/ephemeris.ts'
import { HOTSPOTS } from '../src/hotspots.ts'
import { MOMENTS } from '../src/moments.ts'
import { ORBIT_SECONDS } from '../src/journey/lifecycle.ts'
import { getCinematicFlight } from '../src/cinematics/flights.ts'
import { angularDistance } from '../src/camera/pose.ts'
import { TYCHO, PLATO, RIMA_HADLEY } from '../src/labels/gazetteer.ts'
import { APOLLO17_PANORAMAS } from '../src/ground/pano/manifest.ts'
import { routeSunRange, sunElevationDeg } from '../src/sunMorning.ts'
import {
  NAV_IDLE, VIEWPOINT_ENTRIES, HIDDEN_ENTRIES, actionKey, availableEntries, clock, describeNav, firstSentence, resumeProgress, locate, navArrive, navAway, navClear, navReturnStep, nextPos, prevMoveFrom, prevPos, prevPosFrom, resolveQueued, stepAt,
  PIN_MOMENT, type NavAction, type NavEntry, type NavPos, type NavState,
} from '../src/viewpointList.ts'

const DEG = Math.PI / 180
const hotspotIdsAll = new Set(HOTSPOTS.map((h) => h.id))
const all = VIEWPOINT_ENTRIES

// --- The list and its order (owner decisions of 2026-10-11).
assert.deepEqual(all.map((e) => e.name), [
  'Fly around the Moon', 'Earthrise', 'Solar eclipse', 'Tycho Crater', 'Copernicus Crater',
  'Long shadows at the terminator', 'Apollo 11 landing zone', 'Apollo 17', 'View from Earth',
], 'the curated list, in order (feedback 2026-10-14: no Far side, no Hadley Rille, craters open their flight; 2026-10-20: no Sunrise, Plato or ridge, View from Earth last)')
assert.equal(new Set(all.map((e) => e.id)).size, all.length, 'unique row ids')
assert.deepEqual(all.map((e) => e.steps.length), [1, 1, 1, 1, 1, 1, 1, 4, 1], 'sub-views per entry')
const entry = (name: string): NavEntry => all.find((e) => e.name === name)!
for (const n of ['Tycho Crater', 'Copernicus Crater']) assert.equal(entry(n).steps.length, 1, `${n} opens its flight directly, with no separate Fly around step`)
assert.deepEqual(entry('Tycho Crater').steps.map((s) => s.action), [{ kind: 'moment', id: 'tycho-rim' }])
assert.deepEqual(entry('Copernicus Crater').steps.map((s) => s.action), [{ kind: 'moment', id: 'surface' }])
assert.ok(!all.some((e) => e.name === 'Plato Crater') && MOMENTS.some((m) => m.id === 'plato-rim'), 'Plato left the list and keeps its flight for captures')
assert.ok(!all.some((e) => e.name === 'Sunrise above the Moon') && MOMENTS.some((m) => m.id === 'first-light'), 'Sunrise above the Moon left the list; ?moment=first-light still works')
assert.deepEqual(HIDDEN_ENTRIES.map((e) => e.id), ['alps-ridge'], 'the Alps ridge is hidden, not deleted, so it can return')
assert.deepEqual(HIDDEN_ENTRIES[0].steps.map((s) => s.action), [{ kind: 'ridge', id: 'alps-ridge' }])
assert.equal(all[all.length - 1].id, 'pin-earth', 'View from Earth is last')
assert.equal(all[0].id, 'fly-around', 'Fly around the Moon opens the list')
assert.match(entry('Fly around the Moon').caption, /25 seconds/, 'the caption tells the real duration')
assert.equal(ORBIT_SECONDS, 25)
assert.deepEqual(entry('Solar eclipse').steps.map((s) => s.action), [{ kind: 'moment', id: 'solar-eclipse' }], 'the solar eclipse plays its flight')
assert.equal(all.findIndex((e) => e.name === 'Solar eclipse'), all.findIndex((e) => e.name === 'Earthrise') + 1, 'the solar eclipse sits right after Earthrise')
assert.deepEqual(entry('Earthrise').steps.map((s) => s.action), [{ kind: 'moment', id: 'earthrise' }], 'Earthrise plays the animated moment')
for (const [pinId, momentId] of Object.entries(PIN_MOMENT)) {
  assert.ok(hotspotIdsAll.has(pinId) && MOMENTS.some((m) => m.id === momentId), `${pinId} routes to ${momentId}`)
  assert.ok(all.some((e) => e.steps.some((s) => s.action.kind === 'moment' && s.action.id === momentId)), `${momentId} is a list step`)
}
assert.deepEqual(entry('Apollo 17').steps.map((s) => s.label), ['Eye level', 'ALSEP panorama', 'Station 4 panorama', 'Station 6 panorama'])
assert.ok(!entry('Apollo 17').steps.some((s) => s.action.kind === 'pin'), 'Beside the module left the list: Eye level and the panoramas only')
assert.deepEqual(locate(all, { kind: 'pin', id: 'pin-apollo17' }), { entry: all.findIndex((e) => e.name === 'Apollo 17'), step: -1 }, 'the Apollo 17 pin on the Moon names its entry with no sub-view')
{
  const hv = navArrive(NAV_IDLE, locate(all, { kind: 'pin', id: 'pin-apollo17' })!)
  assert.equal(describeNav(all, hv).title, 'Apollo 17', 'the hover view is not called Eye level')
  assert.deepEqual(nextPos(all, hv.pos), { entry: all.findIndex((e) => e.name === 'Apollo 17'), step: 0 }, 'Next from it goes to Eye level')
  assert.equal(navReturnStep(all, navAway(hv)), null, 'nothing to return to')
  assert.equal(describeNav(all, navAway(hv)).canReturn, false, 'no Return button when there is no step to return to')
}
assert.deepEqual(entry('Long shadows at the terminator').steps.map((s) => s.action.id), ['terminator-run'], 'the only sunrise step left is Long shadows')
// Rows that left the visitor list stay as moments for the capture API (?flightId= and ?moment=).
for (const id of ['taurus-littrow-pass', 'apollo11', 'apollo17', 'apollo17-25cm', 'land-lm', 'land-lm-eye', 'earthrise-low', 'pole-limb-sweep', 'bank-turn-a', 'bank-turn-b', 'limb-glide-a', 'limb-glide-b', 'now', 'far-side', 'rille-run', 'sunrise-arc-a', 'sunrise-arc-b']) {
  assert.ok(MOMENTS.some((m) => m.id === id), `${id} keeps its code`)
  assert.ok(!all.some((e) => e.steps.some((s) => s.action.kind === 'moment' && s.action.id === id)), `${id} is not in the visitor list`)
}
assert.ok(MOMENTS.some((m) => m.id === 'earthrise'), 'Earthrise keeps its moment')
assert.ok(!all.some((e) => e.id === 'far-side' || e.id === 'rille-run'), 'Far side and Hadley Rille left the list')

// Every action points at something that exists.
const hotspotIds = new Set(HOTSPOTS.map((h) => h.id))
const momentIds = new Set(MOMENTS.map((m) => m.id))
for (const e of all) for (const s of e.steps) {
  const a = s.action
  if (a.kind === 'pin') assert.ok(hotspotIds.has(a.id), `hotspot ${a.id}`)
  else if (a.kind === 'moment') assert.ok(momentIds.has(a.id), `moment ${a.id}`)
  else if (a.kind === 'panorama') assert.ok(APOLLO17_PANORAMAS.some((p) => p.id === a.id), `panorama ${a.id}`)
  else if (a.kind === 'ground') assert.ok(hotspotIds.has('pin-apollo17-eye'), 'eye level has its pin')
}
assert.ok(!HOTSPOTS.some((h) => h.id === 'pin-plato'), 'Plato left the list: no list-only pin for it')
assert.equal(HOTSPOTS.find((h) => h.id === 'pin-apollo17-eye')?.groundEnd, 'eye')
assert.equal(MOMENTS.find((m) => m.id === 'fly-around')?.camera.at, 'sunArc', 'Fly around the Moon starts over the lit side, before the Sun sets behind the limb')

// --- Sub-view stepping: Next goes through the entry's views, then on to the next entry; Back the other way, landing on an entry's first view.
const walk: NavPos[] = []
for (let p = nextPos(all, null), n = 0; p && n < all.length * 6; p = nextPos(all, p), n++) { if (n > 0 && p.entry === 0 && p.step === 0) break; walk.push(p) }
assert.equal(walk.length, all.reduce((n, e) => n + e.steps.length, 0), 'Next visits every step once')
assert.deepEqual(walk[0], { entry: 0, step: 0 })
const a17 = all.findIndex((e) => e.name === 'Apollo 17')
assert.deepEqual(nextPos(all, { entry: a17, step: 0 }), { entry: a17, step: 1 }, 'Eye level to the first panorama')
assert.deepEqual(nextPos(all, { entry: a17, step: 3 }), { entry: a17 + 1, step: 0 }, 'after the last panorama, on to View from Earth')
assert.deepEqual(nextPos(all, { entry: all.length - 1, step: 0 }), { entry: 0, step: 0 }, 'Next after the last entry wraps to the first')
assert.deepEqual(prevPos(all, { entry: a17, step: 2 }), { entry: a17, step: 1 })
assert.deepEqual(prevPos(all, { entry: a17, step: 0 }), { entry: a17 - 1, step: 0 }, 'Back from an entry lands on the first view of the one before')
assert.deepEqual(prevPos(all, { entry: 0, step: 0 }), { entry: all.length - 1, step: 0 }, 'Back from the first entry wraps to the last')
assert.deepEqual(nextPos([all[0]], { entry: 0, step: 0 }), null, 'a list of one entry with one view has nowhere to go')
assert.deepEqual(prevPos([all[0]], { entry: 0, step: 0 }), null)
{
  // Wrapping walks the ring: 9 entries, 12 steps, and Back undoes Next all the way round.
  const steps = all.reduce((n, e) => n + e.steps.length, 0)
  let p: NavPos | null = { entry: 0, step: 0 }
  for (let i = 0; i < steps; i++) p = nextPos(all, p)
  assert.deepEqual(p, { entry: 0, step: 0 }, 'a full lap of Next is back at the start')
  p = { entry: 0, step: 0 }
  for (let i = 0; i < all.length; i++) p = prevPos(all, p)
  assert.deepEqual(p, { entry: 0, step: 0 }, 'one Back per entry is back at the start')
}
assert.equal(prevPos(all, null), null, 'nothing to go back to before the first viewpoint')
const tycho = all.findIndex((e) => e.name === 'Tycho Crater')
assert.deepEqual(nextPos(all, { entry: tycho, step: 0 }), { entry: tycho + 1, step: 0 }, 'Tycho Crater: its flight, then Copernicus Crater')
assert.deepEqual(locate(all, { kind: 'moment', id: 'terminator-run' }), { entry: all.findIndex((e) => e.id === 'sunrise-terminator'), step: 0 })
assert.equal(locate(all, { kind: 'moment', id: 'sunrise-arc-b' }), null, 'the arcs left the list')
assert.equal(locate(all, { kind: 'moment', id: 'bank-turn-a' }), null, 'a dropped moment is not a viewpoint')

// --- The pill's text: the name, the sub-view, its count, the dots.
let st: NavState = navArrive(NAV_IDLE, { entry: a17, step: 0 })
let v = describeNav(all, st)
assert.equal(v.title, 'Apollo 17 · Eye level', 'one counter: the dots tell the sub-view, the second line the entry')
assert.equal(v.count, '8 of 9')
assert.equal(v.dots, 4)
assert.equal(v.dotIndex, 0)
v = describeNav(all, navArrive(NAV_IDLE, { entry: 4, step: 0 }))
assert.equal(v.title, 'Copernicus Crater')
assert.ok(all.every((e) => e.steps.every((s) => !/\d+ of \d+/.test(describeNav(all, navArrive(NAV_IDLE, { entry: all.indexOf(e), step: e.steps.indexOf(s) })).title))), 'no title carries a counter')
v = describeNav(all, navArrive(NAV_IDLE, { entry: all.length - 1, step: 0 }))
assert.equal(v.title, 'View from Earth', 'a one-view entry has no count of views')
assert.equal(v.dots, 0)
v = describeNav(all, NAV_IDLE)
assert.equal(v.title, '', 'before a viewpoint there is no caption (owner review 2026-10-23, #5: "Viewpoints · 9 places and flights" said nothing)')
assert.equal(v.count, '')
assert.equal(v.dots, 0)
assert.equal(v.canReturn, false)
assert.equal(v.canNext, true)
assert.equal(v.canPrev, false)
assert.equal(describeNav(all, navArrive(NAV_IDLE, { entry: all.length - 1, step: 0 })).canNext, true, 'the last entry still has a Next: it wraps')
assert.equal(describeNav(all, navArrive(NAV_IDLE, { entry: 0, step: 0 })).canPrev, true, 'and the first a Back')
assert.equal(clock(48), '0:48')
assert.equal(clock(21.4), '0:21')
assert.equal(clock(70), '1:10')

// --- Away from a viewpoint: the name stays, dimmed, with a way back; the arrows stay live; arriving or clearing resets it.
st = navArrive(NAV_IDLE, { entry: 4, step: 0 })
assert.equal(describeNav(all, st).dimmed, false)
assert.equal(navReturnStep(all, st), null, 'nothing to return to while still there')
assert.equal(navAway(NAV_IDLE), NAV_IDLE, 'before any viewpoint there is nothing to leave')
const away = navAway(st)
v = describeNav(all, away)
assert.equal(v.title, 'Copernicus Crater', 'the last name is kept')
assert.equal(v.dimmed, true)
assert.equal(v.canReturn, true)
assert.equal(v.canNext && v.canPrev, true, 'the arrows stay live')
assert.deepEqual(navReturnStep(all, away), stepAt(all, { entry: 4, step: 0 }), 'Return goes back to the same step, not the entry before')
assert.equal(navAway(away), away, 'a second drag changes nothing')
assert.deepEqual(navArrive(away, { entry: 5, step: 0 }), { pos: { entry: 5, step: 0 }, away: false }, 'arriving anywhere clears it')
assert.deepEqual(navClear(), NAV_IDLE, 'Home clears the viewpoint')

// --- Rows not ready at once: availability trims the list; a queued tap resolves against it (the last tap wins, a missing one drops).
const noTiles = availableEntries(all, (a: NavAction) => a.kind === 'ridge' || a.id === 'pin-earth')
assert.deepEqual(noTiles.map((e) => e.name), ['View from Earth'], 'the hidden ridge is not in the visitor list even when its data is there')
const noTier = availableEntries(all, (a) => !(a.kind === 'ground'))
assert.equal(noTier.find((e) => e.name === 'Apollo 17')?.steps.length, 3, 'without the 25 cm tier Apollo 17 has no Eye level')
assert.deepEqual(resolveQueued({ kind: 'moment', id: 'tycho-rim' }, all), { entry: tycho, step: 0 })
assert.equal(resolveQueued({ kind: 'moment', id: 'tycho-rim' }, noTiles), null, 'a tap on a view that does not exist here is dropped')
assert.equal(resolveQueued(null, all), null)
// --- The caption keeps one short sentence, never the place name; Return resumes a flight where the visitor left it.
assert.equal(firstSentence('85 km across, with rays that reach across much of the near side.'), '85 km across, with rays that reach across much of the near side.')
assert.equal(firstSentence('Tranquility Base on the 2011 orbiter photograph. The lander’s shadow is about five pixels wide.'), 'Tranquility Base on the 2011 orbiter photograph.')
assert.equal(firstSentence('No full stop'), 'No full stop')
assert.equal(firstSentence('  A 2.5 km wide pit. Next.'), 'A 2.5 km wide pit.')
for (const h of HOTSPOTS) {
  const first = firstSentence(h.caption).toLowerCase()
  const name = h.title.toLowerCase().replace(/ crater$/, '')
  assert.ok(first.length > 0 && first.length <= 100, `${h.id}: a short caption sentence`)
  assert.notEqual(first, name, `${h.id}: the caption is not the name`)
}
assert.equal(resumeProgress({ id: 'surface', u: 0.4 }, 'surface'), 0.4, 'resumes where it was')
assert.equal(resumeProgress({ id: 'surface', u: 0.4 }, 'tycho-rim'), 0, 'another flight starts at the top')
assert.equal(resumeProgress(null, 'surface'), 0)
assert.equal(resumeProgress({ id: 'surface', u: 0.01 }, 'surface'), 0, 'left in its first moments: from the start')
assert.equal(resumeProgress({ id: 'surface', u: 0.99 }, 'surface'), 0, 'left at the very end: from the start')
assert.equal(resumeProgress({ id: 'surface', u: NaN }, 'surface'), 0)
assert.equal(actionKey({ kind: 'pin', id: 'x' }), 'pin:x')

// --- Authoring rule: for every flight in the list, the Sun is above the horizon over every waypoint at the moment's date, and the
// first waypoint is over the subject. (A route that starts in the night, as Long shadows and Sunrise arc A/B did, is black.)
const SUBJECTS: Record<string, { lon: number; lat: number; tolDeg: number } | 'terminator'> = {
  'tycho-rim': { ...TYCHO, tolDeg: 6 },
  'surface': { lon: -20.0786, lat: 9.6209, tolDeg: 6 },
  'plato-rim': { ...PLATO, tolDeg: 6 },
  'rille-run': { ...RIMA_HADLEY, tolDeg: 3 },
  'terminator-run': 'terminator',
  'sunrise-arc-a': 'terminator',
  'sunrise-arc-b': 'terminator',
}
// Flights that left the list keep their authoring rule too (they stay reachable by ?moment=).
const kept = ['plato-rim', 'rille-run', 'sunrise-arc-a', 'sunrise-arc-b']
const flightMoments = all.flatMap((e) => e.steps).filter((s) => s.action.kind === 'moment').map((s) => MOMENTS.find((m) => m.id === s.action.id)!).filter((m) => m.cinematicFlight && m.id !== 'earthrise' && m.id !== 'solar-eclipse').concat(kept.map((id) => MOMENTS.find((m) => m.id === id)!))
assert.deepEqual(flightMoments.map((m) => m.id), ['tycho-rim', 'surface', 'terminator-run', ...kept], 'the flights the list offers, then the four kept behind ?moment=')
for (const m of flightMoments) {
  const f = getCinematicFlight(m.cinematicFlight)!
  const pts = f.waypoints!
  const e = ephemerisAt(m.time())
  const { min, max } = routeSunRange(e, pts)
  assert.ok(min > 1, `${m.id}: the Sun is above the horizon over every waypoint (lowest ${min.toFixed(1)} deg)`)
  const subject = SUBJECTS[m.id]
  assert.ok(subject, `${m.id} has a subject`)
  if (subject === 'terminator') {
    const first = sunElevationDeg(e, pts[0].lon, pts[0].lat)
    assert.ok(first >= 1 && first <= 12, `${m.id}: the first waypoint is just east of the terminator (${first.toFixed(1)} deg)`)
    assert.ok(max <= 17, `${m.id}: low Sun over the whole route (highest ${max.toFixed(1)} deg)`)
    assert.ok(min >= 2, `${m.id}: lit from the first frame (${min.toFixed(1)} deg)`)
  } else {
    const off = angularDistance(pts[0].lon, pts[0].lat, subject.lon, subject.lat) / DEG
    assert.ok(off <= subject.tolDeg, `${m.id}: the first waypoint is ${off.toFixed(1)} deg from its subject`)
  }
  // The Sun does not set during the flight either (the date is fixed for it, but say so).
  assert.ok(m.cinematicFlight && f.seconds > 0)
}
// The re-dated flights are in their morning: low Sun that is still rising (a lunar morning, not an evening).
for (const id of ['terminator-run', 'sunrise-arc-a', 'sunrise-arc-b', 'rille-run']) {
  const m = MOMENTS.find((x) => x.id === id)!
  const pts = getCinematicFlight(id)!.waypoints!
  const t = m.time()
  const a = routeSunRange(ephemerisAt(t), pts).min
  const b = routeSunRange(ephemerisAt(new Date(t.getTime() + 3600_000)), pts).min
  assert.ok(b > a, `${id}: the Sun is rising`)
}
// Hadley Rille: a low Sun (6 deg over its darkest waypoint) so the channel throws a shadow.
{
  const m = MOMENTS.find((x) => x.id === 'rille-run')!
  const { min, max } = routeSunRange(ephemerisAt(m.time()), getCinematicFlight('rille-run')!.waypoints!)
  assert.ok(min >= 5 && max <= 10, `Hadley Rille is lit by a low Sun (${min.toFixed(1)} to ${max.toFixed(1)} deg)`)
}

// --- The Quality sheet's old "Go to the terminator" pose (now in the debug sheet) sits on the terminator: the Sun a few degrees up and rising.
{
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const m = /const TERMINATOR_TEST_TIME = '([^']+)'/.exec(main)
  assert.ok(m, 'the terminator test pose has a named time')
  const t = new Date(m![1])
  const el = sunElevationDeg(ephemerisAt(t), -3.7, 19)
  assert.ok(el > 1 && el < 5, `the terminator pose has the Sun ${el.toFixed(1)} deg up`)
  assert.ok(sunElevationDeg(ephemerisAt(new Date(t.getTime() + 3600_000)), -3.7, 19) > el, 'and rising (morning terminator)')
}
console.log('viewpoint-list.test ok')

// --- ‹ on the ground (owner complaint 10, 2026-10-23): at an entry's first step it climbs out over the site ('orbit') and stays in the entry; from a later step it
// is the step before (ground-local in main.ts); from orbit it is prevPos, and only there does the ring wrap. prevPosFrom keeps the old rule as its default.
{
  const a17i = all.findIndex((e) => e.id === 'pin-apollo17')
  assert.deepEqual(prevMoveFrom(all, { entry: a17i, step: 0 }, true), { kind: 'orbit', pos: { entry: a17i, step: 0 }, action: { kind: 'orbit', id: 'pin-apollo17' } }, 'Eye level on the ground: up over the site, not Apollo 11')
  assert.deepEqual(prevMoveFrom(all, { entry: a17i, step: -1 }, true), { kind: 'orbit', pos: { entry: a17i, step: 0 }, action: { kind: 'orbit', id: 'pin-apollo17' } }, 'the hover view (no sub-view) on the ground: the same climb')
  assert.deepEqual(prevMoveFrom(all, { entry: a17i, step: 1 }, true), { kind: 'step', pos: { entry: a17i, step: 0 } }, 'from the ALSEP panorama: Eye level (a glide, main.ts)')
  assert.deepEqual(prevMoveFrom(all, { entry: a17i, step: 0 }, false), { kind: 'step', pos: { entry: a17i - 1, step: 0 } }, 'from orbit: the entry before, as always')
  assert.deepEqual(prevMoveFrom(all, { entry: 0, step: 0 }, false), { kind: 'step', pos: { entry: all.length - 1, step: 0 } }, 'the ring wraps from orbit')
  assert.deepEqual(prevMoveFrom(all, { entry: 0, step: 0 }, true), { kind: 'orbit', pos: { entry: 0, step: 0 }, action: { kind: 'orbit', id: all[0].id } }, 'never from the ground')
  assert.equal(prevMoveFrom(all, null, true), null)
  assert.equal(prevMoveFrom(all, { entry: 99, step: 0 }, true), null)
  for (const e of all) for (const s of e.steps) {
    const pos = { entry: all.indexOf(e), step: e.steps.indexOf(s) }
    assert.deepEqual(prevPosFrom(all, pos), prevPos(all, pos), 'prevPosFrom without onGround is prevPos')
    assert.deepEqual(prevPosFrom(all, pos, false), prevPos(all, pos))
    const m = prevMoveFrom(all, pos, true)
    assert.deepEqual(prevPosFrom(all, pos, true), m?.pos ?? null, 'prevPosFrom is the position part of prevMoveFrom')
    if (pos.step === 0) assert.equal(m?.kind, 'orbit'); else assert.equal(m?.kind, 'step')
  }
  assert.equal(prevPosFrom(all, null), null)
  assert.deepEqual(prevPosFrom(all, { entry: a17i, step: 0 }, true), { entry: a17i, step: 0 }, 'the pill keeps naming Eye level while the camera climbs')
  // The list itself has no orbit step: the climb is not a place.
  assert.ok(!all.some((e) => e.steps.some((s) => s.action.kind === 'orbit')))
}
console.log('viewpoint-list.test.mts: prevMoveFrom / prevPosFrom (#10): ok')
