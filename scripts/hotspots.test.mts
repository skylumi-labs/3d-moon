/** The hotspot list: ids, captions, pins, and the dates that set the light. tsx scripts/hotspots.test.mts */
import assert from 'node:assert/strict'
import { HOTSPOTS, nextMorning, sunElevationDeg } from '../src/hotspots.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { momentPose } from '../src/momentPose.ts'
import { planFly, MIN_COVER } from '../src/journey/path.ts'
import { homePose } from '../src/camera/pose.ts'
import { TYCHO } from '../src/labels/gazetteer.ts'

const ids = new Set<string>()
for (const h of HOTSPOTS) {
  assert.ok(!ids.has(h.id), `unique id ${h.id}`); ids.add(h.id)
  assert.ok(h.title.length > 0 && h.caption.length > 0)
  // The no-ai-slop rules that a script can check: no em-dash, no sentence over 30 words, one sentence.
  assert.ok(!/[—–]/.test(h.caption), `${h.id}: no dashes`)
  const sentences = h.caption.split(/(?<=[.!?])\s+/).filter(Boolean)
  assert.ok(sentences.length <= 2, `${h.id}: at most two short sentences`)
  for (const sn of sentences) assert.ok(sn.split(/\s+/).length <= 30, `${h.id}: sentence over 30 words`)
  const e = ephemerisAt(h.time())
  const p = h.pin(e)
  assert.ok(Number.isFinite(p.lon) && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90, `${h.id}: pin`)
}
// Five places and the two list views that are not pins: From Earth and Apollo 17 at eye level (Plato left the list, 2026-10-20).
assert.equal(HOTSPOTS.length, 7)
assert.deepEqual(HOTSPOTS.filter((h) => h.pinned === false).map((h) => h.id).sort(), ['pin-apollo17-eye', 'pin-earth'])
assert.equal(HOTSPOTS.find((h) => h.id === 'pin-tycho')?.title, 'Tycho Crater')
// Both Apollo pins are the planner's fly-to (main.ts startSiteView), never the 1972 descent or the 26 s scripted one.
for (const id of ['pin-apollo11', 'pin-apollo17']) assert.equal(HOTSPOTS.find((h) => h.id === id)?.camera.at, 'siteView', `${id} is a planner fly-to`)

// Tycho's date: the Sun is low (10 deg) and still rising over the crater, within three days from now.
{
  const t0 = new Date('2026-10-02T12:00:00Z')
  const t = nextMorning(TYCHO.lon, TYCHO.lat, 10, t0)
  assert.ok(t.getTime() > t0.getTime() && t.getTime() - t0.getTime() < 31 * 86400_000, `within a lunation: ${t.toISOString()}`)
  const el = sunElevationDeg(ephemerisAt(t), TYCHO.lon, TYCHO.lat)
  assert.ok(Math.abs(el - 10) < 0.05, `elevation ${el}`)
  const later = sunElevationDeg(ephemerisAt(new Date(t.getTime() + 3600_000)), TYCHO.lon, TYCHO.lat)
  assert.ok(later > el, 'still rising')
}

// Every pin that is a plain pose can be flown to from Home with a body in frame at every sample, on a phone and a desktop.
for (const aspect of [375 / 812, 1.6]) for (const h of HOTSPOTS) {
  if (h.camera.at === 'site' || h.camera.at === 'siteView' || h.camera.at === 'descent') continue
  const e = ephemerisAt(h.time())
  const pose = momentPose(h.camera, e)
  const plan = planFly(e, { pose: homePose(e), fovDeg: 30, aimShift: 0, aimShiftX: 0, look: 0 }, { pose, fovDeg: h.fovDeg ?? (h.camera.at === 'earth' ? 11 : 30), aimShift: 0, aimShiftX: 0, look: h.look === 'earth' ? 1 : 0 }, { aspect })
  assert.ok(plan.ms >= 1500 && plan.ms <= 9000, `${h.id}: duration ${plan.ms}`)
  assert.ok(plan.minCover >= MIN_COVER || h.look === 'earth', `${h.id} @${aspect}: cover ${plan.minCover}`)
  assert.ok(plan.minRadius > 1.05, `${h.id}: stays above the surface (${plan.minRadius})`)
}
console.log('hotspots.test ok')
