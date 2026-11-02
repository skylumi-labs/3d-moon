import assert from 'node:assert/strict'
import { CREDIT_CATALOG, creditsAreOpen, creditsClick, creditsFocus, creditsPointer, dismissCredits, initialCreditsOpenState, selectCredits, sphereVisibleInFrame, creditSurfaceHit, groundCreditTargets, type CreditsContext } from '../src/ui/credits.ts'
import { TileStreamer } from '../src/moon/tiles/TileStreamer.ts'
import { detailSourcesAt, DETAIL_PAGE_H, DETAIL_PAGE_W, detailRow } from '../src/moon/tiles/detail.ts'
import { pageWidth, tileOf } from '../src/moon/tiles/grid.ts'
import { levelRow } from '../src/moon/tiles/levels.ts'
import { patchDetailWeightAt } from '../src/moon/patch/levels.ts'
import type { PatchLevel } from '../src/moon/patch/PatchLayer.ts'

const view = (changes: Partial<CreditsContext> = {}): CreditsContext => ({
  moonVisible: false, lunarTilesVisible: false, polarWacVisible: false, sitePatchVisible: null,
  apollo17TierVisible: false, apollo17FlightVisible: false, lunarModuleVisible: false, earthVisible: false, starsVisible: false,
  ...changes,
})

assert.ok(CREDIT_CATALOG.length >= 10, 'the complete source catalogue is present')
assert.ok(CREDIT_CATALOG.every((row) => row.title && row.credit && row.detail), 'every row retains attribution and a useful limitation')

// Licence review 2026-10-12: gazetteer, panoramas and open-source notices are catalogued; dead and generic links are gone.
{
  const byId = new Map(CREDIT_CATALOG.map((row) => [row.id, row]))
  assert.match(byId.get('gazetteer')!.credit, /IAU WGPSN, Gazetteer of Planetary Nomenclature/)
  assert.ok(byId.get('gazetteer')!.links.some((l) => l.href.includes('planetarynames.wr.usgs.gov')))
  assert.match(byId.get('jaxa-tc')!.credit, /ISAS\/JAXA \(modified\)/)
  assert.match(byId.get('jaxa-tc')!.detail, /We thank the SELENE\(KAGUYA\) TC team and the SELENE Data Archive/)
  assert.match(byId.get('polar-wac')!.credit, /Abstract #5132/)
  assert.match(byId.get('lunar-tiles')!.credit, /Wagner/)
  assert.match(byId.get('apollo-17-tier')!.credit, /Earth and Space Science 6\(1\)/)
  assert.ok(byId.get('apollo-17-tier')!.links.some((l) => l.href.includes('10.1029/2018EA000408')))
  assert.match(byId.get('apollo-17-panoramas')!.credit, /JSC2004e52772.*Warren Harold/)
  assert.ok(byId.get('hyg-stars')!.links.some((l) => l.href === 'https://creativecommons.org/licenses/by-sa/4.0/'))
  assert.ok(byId.get('open-source')!.links.some((l) => l.href.endsWith('THIRD-PARTY-NOTICES.txt')))
  const hrefs = CREDIT_CATALOG.flatMap((row) => row.links.map((l) => l.href))
  assert.ok(!hrefs.some((h) => h.includes('10.1016/j.pss.2020.105122')), 'the dead Speyerer DOI is gone')
  assert.ok(!hrefs.includes('https://visibleearth.nasa.gov/images/57747/blue-marble-clouds'), 'the redirecting clouds link is gone')
  assert.ok(selectCredits(view({ moonVisible: true })).has('gazetteer'))
  assert.ok(!selectCredits(view({ earthVisible: true })).has('gazetteer'))
  assert.ok(selectCredits(view({ sitePatchVisible: 'a17' })).has('apollo-17-panoramas'))
  assert.ok(!selectCredits(view({ sitePatchVisible: 'a11' })).has('apollo-17-panoramas'))
  assert.match(byId.get('open-source')!.credit, /Tabler Icons/)
  assert.ok(selectCredits(view()).has('open-source'))
}

// A globe view and an Earth view expose different maps; unavailable or distant optional tiers stay unmarked.
{
  const globe = selectCredits(view({ moonVisible: true }))
  assert.ok(globe.has('moon-base'))
  assert.ok(!globe.has('earth-maps'))
  const earth = selectCredits(view({ earthVisible: true }))
  assert.ok(earth.has('earth-maps'))
  assert.ok(!earth.has('moon-base'))
  assert.ok(!selectCredits(view({ moonVisible: true, lunarTilesVisible: true })).has('polar-wac'))
  assert.ok(!selectCredits(view({ moonVisible: true })).has('apollo-17'))
  assert.ok(!selectCredits(view({ moonVisible: true, sitePatchVisible: 'a17' })).has('apollo-17-tier'))
  assert.ok(selectCredits(view({ sitePatchVisible: 'a17', apollo17TierVisible: true })).has('apollo-17-tier'))
  assert.ok(selectCredits(view({ sitePatchVisible: 'a17' })).has('modelled-light'), 'ground/site shading also uses the modelled-light pipeline')
  assert.ok(selectCredits(view({ apollo17FlightVisible: true })).has('apollo-17-flight'))
}

// The sphere test rejects a fully occulted Earth while keeping the foreground Moon.
{
  const camera = { pos: [0, 0, 3] as const, right: [1, 0, 0] as const, up: [0, 1, 0] as const, back: [0, 0, 1] as const, tanHalf: 0.4, aspect: 1.5 }
  assert.equal(sphereVisibleInFrame(camera, [0, 0, 0], 1), true)
  assert.equal(sphereVisibleInFrame(camera, [0, 0, -20], 2, [{ centre: [0, 0, 0], radius: 1 }]), false)
  assert.ok(!selectCredits(view({ moonVisible: true, earthVisible: false })).has('earth-maps'))
  assert.ok(!selectCredits(view({ moonVisible: true, starsVisible: false })).has('hyg-stars'), 'no sampled sky means no stars attribution')
  assert.ok(selectCredits(view({ starsVisible: true })).has('hyg-stars'))
}

// Explicit close/Escape/outside dismissal survives focus restoration; new deliberate entry reopens.
{
  let s = initialCreditsOpenState()
  s = creditsFocus(s, true, true)
  assert.equal(creditsAreOpen(s), false, 'Tab onto the Credits trigger does not open the panel')
  s = creditsClick(s)
  assert.equal(creditsAreOpen(s), true, 'activating it (Enter, Space, click) opens it')
  s = creditsFocus(s, true)
  assert.equal(creditsAreOpen(s), true, 'focus on something inside the open panel keeps it open')
  s = dismissCredits(s, true)
  assert.equal(creditsAreOpen(s), false)
  s = creditsFocus(s, true)
  assert.equal(creditsAreOpen(s), false, 'programmatic focus restoration is suppressed once')
  s = creditsFocus(s, false)
  s = creditsFocus(s, true)
  assert.equal(creditsAreOpen(s), true, 'focus inside the panel opens it (the panel is only reachable when it is already shown)')
  s = creditsClick(s)
  assert.equal(creditsAreOpen(s), true, 'trigger click pins open')
  s = creditsClick(s)
  assert.equal(creditsAreOpen(s), false, 'second click dismisses without stale focus reopening')
  s = creditsPointer(s, true)
  assert.equal(creditsAreOpen(s), true, 'pointer re-entry opens after dismissal')
  s = dismissCredits(s)
  assert.equal(creditsAreOpen(s), false, 'outside click dismisses')
}

// Exercise the actual TileStreamer page lookup using a synthetic RGBA page and resident-slot map.
{
  const streamer = Object.create(TileStreamer.prototype) as TileStreamer & Record<string, unknown>
  const deepest = -1, width = pageWidth(deepest)
  const pageData = new Float32Array(width * 252 * 4)
  const slots = new Map<number, { colour: boolean }>()
  Object.assign(streamer, { deepest, pageW: width, pageData, bySlotKey: slots })
  const seed = (level: number, lon: number, lat: number, colour: boolean, fade = 1): number => {
    const { tx, ty } = tileOf(level, lon, lat)
    const key = (levelRow(level) + ty) * width + tx
    pageData[4 * key] = 1
    pageData[4 * key + 1] = fade
    slots.set(key, { colour })
    return key
  }
  const sourceAt = (lon: number, lat: number, c: number, h: number): boolean => streamer.sourceAt(lon, lat, c, h, 1)
  seed(0, 0, 0, true)
  assert.equal(sourceAt(0, 0, 0.001, 0.001), true, 'a bound color tile contributes')
  slots.clear()
  const normalOnly = seed(1, 0, 0, false)
  assert.equal(sourceAt(0, 0, 10, 0.001), true, 'normal-only coarse tile counts through the shader normal footprint')
  pageData[4 * normalOnly + 1] = 0
  assert.equal(sourceAt(0, 0, 10, 0.001), false, 'zero fade removes the only coarse contribution')
  slots.clear()
  seed(-1, 0, 0, false, 0)
  assert.equal(sourceAt(0, 0, 10, 0.001), false, 'zero page fade is not a source')
  slots.clear()
  assert.equal(sourceAt(0, 0, 0.001, 0.001), false, 'a page entry without a resident slot is not a source')
  slots.clear()
  seed(-1, 0, 0, false)
  assert.equal(sourceAt(0, 0, 10, 0.001), true, 'deep height-only levels contribute to geometry')
}

// A preblended polar tile contains global-only, mixed, then polar-only ratios across 76–80 degrees.
{
  const data = new Float32Array(DETAIL_PAGE_W * DETAIL_PAGE_H * 4)
  for (const lat of [75.5, 78, 80.5]) for (const level of [-1, -2]) {
    const { tx, ty } = tileOf(level, 2.5, lat)
    const offset = 4 * ((detailRow(level) + ty) * DETAIL_PAGE_W + tx)
    data[offset] = 1; data[offset + 1] = 1; data[offset + 2] = 1; data[offset + 3] = 0
  }
  assert.deepEqual(detailSourcesAt(data, 2.5, 75.5, 0.001), { global: true, polar: false })
  assert.deepEqual(detailSourcesAt(data, 2.5, 78, 0.001), { global: true, polar: true })
  assert.deepEqual(detailSourcesAt(data, 2.5, 80.5, 0.001), { global: false, polar: true })
  {
    const { tx, ty } = tileOf(-1, 2.5, 78)
    const at = 4 * ((detailRow(-1) + ty) * DETAIL_PAGE_W + tx)
    data[at + 1] = 0
  }
  assert.deepEqual(detailSourcesAt(data, 2.5, 78, 0.001), { global: true, polar: true }, 'the other detail level can still contribute during fade')
  for (const level of [-1, -2]) {
    const { tx, ty } = tileOf(level, 2.5, 78)
    const at = 4 * ((detailRow(level) + ty) * DETAIL_PAGE_W + tx)
    data[at + 1] = 1; data[at + 3] = 1 // missing western neighbour
  }
  assert.deepEqual(detailSourcesAt(data, 2.5, 78, 0.001), { global: false, polar: false }, 'the edge feather suppresses both badges at zero weight')
}

// Site image rows use shader-equivalent footprint, coverage and edge fade decisions.
{
  const level: PatchLevel = { name: 'tier-image', w: 1000, h: 1000, eastM: -500, northM: 500, texelM: 1, texelEastM: 1, texelNorthM: 1, detail: 'tier.webp' }
  assert.ok(patchDetailWeightAt(level, 0, 0, 1, true) > 0.99, 'resident centre sample contributes')
  assert.equal(patchDetailWeightAt(level, 0, 0, 40, true), 0, 'footprints beyond 32 texels contribute nothing')
  assert.equal(patchDetailWeightAt(level, 0, 0, 1, false), 0, 'a nonresident image is not credited')
  assert.equal(patchDetailWeightAt(level, 1000, 0, 1, true), 0, 'outside samples do not contribute')
}

// Issue #17: a camera just inside the reference sphere (terrain stands above it) must sample the ground in front of it.
{
  const rad = Math.PI / 180
  const lon = 30.772 * rad, lat = 20.191 * rad
  const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)] as const
  const east = [-Math.sin(lon), Math.cos(lon), 0] as const
  const norm = (v: number[]): [number, number, number] => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l] }
  const dist = 0.9988353267456781
  const pos: [number, number, number] = [up[0] * dist, up[1] * dist, up[2] * dist]
  // Looking 20 degrees below the horizon toward the east (pitch 70 from the zenith-down axis).
  const look = (below: number, east_: number): [number, number, number] => norm([
    east[0] * Math.cos(below * rad) * east_ - up[0] * Math.sin(below * rad),
    east[1] * Math.cos(below * rad) * east_ - up[1] * Math.sin(below * rad),
    east[2] * Math.cos(below * rad) * east_ - up[2] * Math.sin(below * rad)])
  const hit = creditSurfaceHit(pos, look(20, 1), [0, 0, 0], 1)
  assert.ok(Number.isFinite(hit) && hit < 0.05, `inside-sphere camera samples the ground ahead, got ${hit}`)
  const point = norm([pos[0] + look(20, 1)[0] * hit, pos[1] + look(20, 1)[1] * hit, pos[2] + look(20, 1)[2] * hit])
  assert.ok(point[0] * up[0] + point[1] * up[1] + point[2] * up[2] > 0.999, 'the sample is near the site, not the far side')
  assert.equal(creditSurfaceHit(pos, look(-10, 1), [0, 0, 0], 1), Infinity, 'looking above the horizon from inside sees sky, not the far side')
  // Flying out: from above the sphere the same downward ray lands on the near surface, and a camera far away looking away clears.
  const high: [number, number, number] = [up[0] * 3, up[1] * 3, up[2] * 3]
  assert.ok(Math.abs(creditSurfaceHit(high, [-up[0], -up[1], -up[2]], [0, 0, 0], 1) - 2) < 1e-9)
  assert.equal(creditSurfaceHit(high, up, [0, 0, 0], 1), Infinity, 'camera that left the ground and looks away samples nothing')
}

console.log('credits source selection and bounded interaction model: ok')

// Ground view: the credits read the visible ground, not one ray. A camera at eye height with the horizon at mid-screen (pitch 0)
// has its centre ray in the sky, yet the lower half of the frame is ground and its sources are on screen.
{
  const level = { pos: [10, 20, 1.7] as const, right: [1, 0, 0] as const, up: [0, 0, 1] as const, back: [0, -1, 0] as const, tanHalf: Math.tan(15 * Math.PI / 180), aspect: 1.6 }
  assert.deepEqual(groundCreditTargets(level, 0, null).length > 0, true, 'a level camera still sees ground in the lower frame')
  const t = groundCreditTargets(level, 0, null)
  assert.ok(t.every((x) => x.n > 20 && x.rangeM > 0 && Number.isFinite(x.e)), 'every target lies ahead of the camera')
  assert.ok(t.every((x) => x.rangeM > 1.7), 'and on the ground, not at the camera')
  const down = { ...level, up: [0, Math.sin(0.35), Math.cos(0.35)] as const, back: [0, -Math.cos(0.35), Math.sin(0.35)] as const }
  assert.ok(groundCreditTargets(down, 0, 5).length >= 3, 'a camera looking down samples across the frame')
  assert.ok(groundCreditTargets(down, 0, 5).some((x) => Math.abs(x.e - 10) > 0.5), 'including rays to either side of the centre')
  const sky = { ...level, up: [0, -0.5, 0.866] as const, back: [0, -0.866, -0.5] as const }
  assert.deepEqual(groundCreditTargets({ ...sky, tanHalf: 0.01 }, 0, null), [], 'a camera looking up at the sky has no ground')
}
console.log('ground credit targets ok')
