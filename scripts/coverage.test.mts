/** The coverage lookup, the position-aware zoom limit and the public-only switch: npm test */
import assert from 'node:assert/strict'
import { REGIONS, addRegions as addR0, boxDistanceRad, coverageAlt, coverageRoots, bestTexelM, detailShare, finestRegionAt, heatColor, publicOnly, regionsAt, zoomFloorAt, type CoverageRegion } from '../src/coverage/coverage.ts'
import { PATCH_SITES } from '../src/moon/patch/sites.ts'
import { floorDist } from '../src/camera/pose.ts'

const a11 = PATCH_SITES.a11, a17 = PATCH_SITES.a17
// The finest photograph at each site is the manifest's: 0.5 m, 0.25 m (the 25 cm tier) and the global texel elsewhere.
assert.equal(bestTexelM(a11.lon, a11.lat, { imagery: true }), 0.5)
assert.equal(bestTexelM(a17.lon, a17.lat, { imagery: true }), 0.4, 'the 25 cm tier is counted at the viewer\'s effective 0.4 m')
assert.equal(bestTexelM(-120, -60, { imagery: true }), 399)
// A height-only bridge is terrain, not a sharper picture: 8 m L2 imagery at 3 km, the 59 m bridge alone at 60 km.
assert.equal(bestTexelM(a11.lon, a11.lat + 0.3, { imagery: true }), 8)
assert.equal(bestTexelM(a11.lon + 1.5, a11.lat, { imagery: true }), 399)
assert.equal(bestTexelM(a11.lon + 1.5, a11.lat), 59.29)
assert.equal(finestRegionAt(a17.lon, a17.lat)?.id, 'a17-L-1')
assert.ok(regionsAt(a11.lon, a11.lat).length >= 4)
// Longitude wraps.
assert.equal(bestTexelM(a11.lon + 360, a11.lat, { imagery: true }), 0.5)

// The zoom limit depends on position: far lower over Apollo 11 than anywhere else, and never below the surface.
const view = { shortPx: 800, fovDeg: 30 }
const global = zoomFloorAt(0, 40, view)
const at11 = zoomFloorAt(a11.lon, a11.lat, view)
assert.ok(at11 < 1.001 && at11 > 1, `Apollo 11 floor ${at11}`)
assert.ok(global > 1.3 && global < floorDist(0.4738, 800) + 0.1)
assert.ok(at11 < global)
// Finer data goes lower: Apollo 17's 25 cm floor sits below its own 0.6 m level's.
const noTier = REGIONS.filter((r) => r.id !== 'a17-L-1')
assert.ok(zoomFloorAt(a17.lon, a17.lat, view) < zoomFloorAt(a17.lon, a17.lat, { ...view, regions: noTier }))
// A larger canvas stops earlier (one texel per pixel), capped.
assert.ok(zoomFloorAt(0, 40, { ...view, shortPx: 1200 }) > global)
assert.equal(zoomFloorAt(0, 40, { ...view, shortPx: 9000 }), zoomFloorAt(0, 40, { ...view, shortPx: 1200 }))
// No imagery anywhere: no floor claim.
assert.equal(zoomFloorAt(0, 0, { ...view, regions: [] }), Infinity)

// The heat colour: coarse is red, fine is green, monotone.
assert.ok(detailShare(0.25) === 1 && detailShare(400) === 0 && detailShare(399) > 0)
const [r0, g0] = heatColor(detailShare(399)), [r1, g1] = heatColor(detailShare(0.5))
assert.ok(r0 > g0 && g1 > r1, 'red for coarse, green for fine')
assert.ok(detailShare(8) < detailShare(2) && detailShare(2) < detailShare(0.5))

// The switch: restricted regions leave with one call, public ones stay.
const restricted: CoverageRegion = { licence: 'internal-only', credit: 'SENTINEL-CREDIT-RESTRICTED', id: 'x', site: null, texelM: 0.25, imagery: true, height: false, lon0: 0, lon1: 1, lat0: 0, lat1: 1, source: 'test' }
assert.equal(publicOnly([restricted, ...REGIONS]).length, REGIONS.length)
assert.ok(REGIONS.every((r) => r.licence === 'public'), 'the shipped set is public only')
console.log('coverage.test ok')

// Hosted coverage.json: a valid row lights up a new region, bad rows are dropped and named, restricted rows stay out of the public set.
import { addRegions, parseCoverage } from '../src/coverage/coverage.ts'
const good = { id: 'new-site', site: 'zz', texelM: 1, imagery: true, height: true, lon0: 10, lon1: 11, lat0: 5, lat1: 6, licence: 'public', credit: 'NASA/GSFC/Arizona State University', source: 'test' }
const parsed = parseCoverage({ regions: [good, { ...good, id: 'bad-box', lon0: 12 }, { ...good, id: 'bad-texel', texelM: 0 }, { ...good, id: 'no-data', imagery: false, height: false }, { ...good, id: 'no-credit', credit: '' }, { ...good, id: 'restricted', licence: 'internal-only', credit: 'SENTINEL-CREDIT-RESTRICTED' }] })
assert.deepEqual(parsed.rejected.sort(), ['bad-box', 'bad-texel', 'no-credit', 'no-data'])
assert.equal(bestTexelM(10.5, 5.5, { imagery: true }), 399)
assert.equal(addRegions(parsed.regions), 1, 'the restricted row is not added without ?internal=1')
assert.equal(bestTexelM(10.5, 5.5, { imagery: true }), 1, 'a hosted region lights up the map')
assert.equal(parseCoverage({}).regions.length, 0)
console.log('coverage remote ok')

// The heat map: a pixel looking straight down at Apollo 11 is green, one over a mare far from any patch is red, space is clear.
import { Vector3 } from 'three'
import { heatmapPixels, lonLatAt } from '../src/coverage/heatmap.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
{
  const e = ephemerisAt(new Date('2026-10-20T12:00:00Z'))
  const dirOf = (lon: number, lat: number) => { const d = Math.PI / 180; return new Vector3().addScaledVector(e.moonX, Math.cos(lat * d) * Math.cos(lon * d)).addScaledVector(e.moonY, Math.cos(lat * d) * Math.sin(lon * d)).addScaledVector(e.moonZ, Math.sin(lat * d)).normalize() }
  const camAt = (lon: number, lat: number, dist: number, tanHalf = 0.2) => {
    const back = dirOf(lon, lat), up0 = e.moonZ.clone().addScaledVector(back, -e.moonZ.dot(back)).normalize(), right = new Vector3().crossVectors(up0, back)
    return { pos: back.clone().multiplyScalar(dist), right, up: up0, back, tanHalf }
  }
  const cam = camAt(a11.lon, a11.lat, 1.05)
  const mid = lonLatAt(cam, 1, e, 0, 0)!
  assert.ok(Math.abs(mid.lon - a11.lon) < 0.01 && Math.abs(mid.lat - a11.lat) < 0.01, `centre pixel is the sub-camera point ${JSON.stringify(mid)}`)
  assert.equal(lonLatAt(camAt(0, 0, 20, 0.05), 1, e, 0.99, 0.99), null, 'off the disc')
  const px = heatmapPixels(cam, 1, e, 9, 9)
  const c = (4 * 9 + 4) * 4
  assert.ok(px[c + 3] > 0 && px[c + 1] > px[c], 'Apollo 11 pixel is green')
  const far = heatmapPixels(camAt(-60, 10, 3), 1, e, 9, 9)
  assert.ok(far[c + 3] > 0 && far[c] > far[c + 1], 'a place with only the global picture is red')
  assert.equal(heatmapPixels(camAt(0, 0, 20, 0.05), 1, e, 4, 4)[3], 0, 'corner of an all-space frame is clear')
}
console.log('heatmap ok')

// Hosted rows are append-only for bundled ids and a siteless imagery row cannot beat the global picture (review P2-4).
{
  const before = bestTexelM(0, 0, { imagery: true })
  assert.equal(addR0([{ ...good, site: null, id: 'global', texelM: 0.5, lon0: -180, lon1: 180, lat0: -90, lat1: 90 }]), 0)
  assert.equal(addR0([{ ...good, site: null, id: 'typo-global', texelM: 0.5, lon0: -180, lon1: 180, lat0: -90, lat1: 90 }]), 0, 'siteless imagery finer than the global picture')
  assert.equal(bestTexelM(0, 0, { imagery: true }), before)
  assert.equal(addR0([{ ...good, id: 'hosted-site', site: 'zz', lon0: 40, lon1: 41, lat0: 5, lat1: 6 }]), 1, 'a site row may be fine')
}
// Hosted files are read from the prefix ROOT, as the contract says (review P1-6).
assert.deepEqual(coverageRoots(['https://h/moon/tiles/', 'https://h/moon/patch/']), ['https://h/moon/'])
assert.deepEqual(coverageRoots(['/moon/tiles', null, '/moon/patch/']), ['/moon/'])
assert.deepEqual(coverageRoots(['https://h/x/']), ['https://h/x/'])

// The camera floor follows the pictures under the camera (review P1-4). Built like main.ts applyFloor: rig.site.alt = coverageAlt.
import { siteAltR, siteFloorDist } from '../src/camera/pose.ts'
{
  const view = { shortPx: 906, fovDeg: 30 }
  const site = { lon: a11.lon, lat: a11.lat, groundR: 0, altR: siteAltR(0.5, 906, 30), alt: (lon: number, lat: number) => coverageAlt('a11', lon, lat, view) }
  const mPerRad = 1737400, mPerDegLon = mPerRad * Math.PI / 180 * Math.cos(a11.lat * Math.PI / 180)
  const at = (eastM: number) => siteFloorDist(site, a11.lon + eastM / mPerDegLon, a11.lat)
  const alt = (eastM: number) => (at(eastM) - 1) * mPerRad
  const over0 = alt(0)
  assert.ok(over0 > 700 && over0 < 1000, `850 m up over the 0.5 m picture, got ${over0}`)
  // The 2 m and 8 m strips end 1.16 km east of the lander: well past the 0.5 m box the floor rises, it does not stay at 850 m.
  assert.ok(alt(1500) > 1.8 * over0, `1.5 km east: ${alt(1500)}`)
  assert.ok(alt(1500) > alt(1100) && alt(1100) > alt(900) - 1, 'continuous and rising outward, no cliff')
  // A cone, not a step: 100 m of ground moves the floor by at most the cone slope (SITE_CONE) times it, plus rounding.
  for (let e = 800; e < 4000; e += 100) assert.ok(Math.abs(alt(e + 100) - alt(e)) <= 2 * 100 * 1.05 + 1, `step at ${e}`)
  // Failed levels are not counted: without the 0.5 m and 2 m pictures the floor over the lander is the 8 m picture's.
  const skipSite = { ...site, alt: (lon: number, lat: number) => coverageAlt('a11', lon, lat, { ...view, skip: new Set(['a11-L0', 'a11-L1']) }) }
  const failedAlt = (siteFloorDist(skipSite, a11.lon, a11.lat) - 1) * mPerRad
  assert.ok(failedAlt > 10000 && failedAlt < 16000, `8 m floor ${failedAlt}`)
  const allFailed = coverageAlt('a11', a11.lon, a11.lat, { ...view, skip: new Set(['a11-L0', 'a11-L1', 'a11-L2']) })
  assert.equal(allFailed, Infinity, 'no picture of the site left: the floor is the global one')
  assert.ok(boxDistanceRad(REGIONS.find((r) => r.id === 'a11-L0')!, a11.lon, a11.lat) === 0)
}
console.log('coverage floor ok')
