import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shareParams, readShare, sitePin, type ShareState } from '../src/ui/shareView'
import { PATCH_SITES } from '../src/moon/patch/sites'

// The Share button left the bar (owner review 2026-10-23, #12); the link itself stays: main.ts builds it for the native shell (currentView) and the S key (shareLink).
const barTs = readFileSync(new URL('../src/ui/bar.ts', import.meta.url), 'utf8')
const mainTs = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.doesNotMatch(barTs, /id: 'share'|shareUrl/, 'no Share item, no link in the bar')
assert.match(mainTs, /^function shareUrl\(\): string/m)
assert.match(mainTs, /currentView: \(\) => new URL\(shareUrl\(\)\)\.search/)
assert.match(mainTs, /share: \(\) => \{ void shareLink\(\) \}/)

const base: ShareState = {
  autoOff: false, live: false, time: new Date('2026-10-06T12:34:56Z'), layoutAim: false,
  pose: { lon: 0, lat: 0, dist: 6, roll: 0, pitch: 0 }, fovDeg: 30, defaultFovDeg: 30, pitchFelt: false,
  look: null, free: null, pin: null, ground: null, viewpoint: null,
}
/** A link as a visitor's browser would read it back. */
function open(s: ShareState): { q: URLSearchParams; start: ReturnType<typeof readShare> } {
  const u = new URL('https://moon.example/moon/index.html')
  for (const [k, v] of shareParams(s)) u.searchParams.set(k, v)
  const q = new URL(u.href).searchParams
  return { q, start: readShare((k) => q.get(k)) }
}

// A link never names an archive moment, and never brings the tour card.
for (const s of [base, { ...base, pin: 'a17', ground: { e: 1, n: 2, z: 3, heading: 4, pitch: 5, roll: 0, tanHalf: 0.46631, walk: false } }]) {
  assert.equal(open(s).q.has('moment'), false)
  assert.equal(open(s).q.has('archive'), false)
}

// Apollo 11 close-up, 600 m up: the pose comes back to the metre (the old 2-decimal link lost 300 m of longitude).
{
  const a11 = PATCH_SITES.a11
  const s: ShareState = { ...base, pose: { lon: a11.lon + 0.00137, lat: a11.lat - 0.00291, dist: 1.000345, roll: 12.5, pitch: 61.3 }, fovDeg: 30, pitchFelt: true, pin: 'a11', layoutAim: true }
  const { q, start } = open(s)
  assert.equal(start.pin, 'a11')
  assert.ok(Math.abs(start.pose.lon! - s.pose.lon) < 1e-5 && Math.abs(start.pose.lat! - s.pose.lat) < 1e-5)
  assert.ok(Math.abs(start.pose.dist! - s.pose.dist) < 1e-6, `dist ${start.pose.dist}`)
  assert.equal(start.pose.roll, 12.5); assert.equal(start.pose.pitch, 61.3)
  assert.equal(start.fovDeg, null)
  assert.equal(start.aim, true)
  assert.equal(q.get('t'), '2026-10-06T12:34:56Z')
}
// A lens other than the default travels; a live view carries no time.
assert.equal(open({ ...base, fovDeg: 20 }).start.fovDeg, 20)
assert.equal(open({ ...base, live: true }).q.has('t'), false)
// A pitch that is not felt at this distance is not written.
assert.equal(open({ ...base, pose: { ...base.pose, pitch: 40 } }).q.has('pitch'), false)

// Apollo 17 ground view: the camera, the mode and the viewpoint round-trip; there is no orbital pose in the link.
{
  const g = { e: -21.2, n: 21.2, z: 10.1234, heading: -45.5, pitch: -22.25, roll: 0, tanHalf: Math.tan(25 * Math.PI / 180), walk: true }
  const { q, start } = open({ ...base, pin: 'a17', ground: g, viewpoint: 'eye' })
  assert.equal(q.has('lon'), false)
  assert.equal(start.pin, 'a17'); assert.equal(start.viewpoint, 'eye')
  const r = start.ground!
  for (const k of ['e', 'n', 'z', 'heading', 'pitch', 'roll'] as const) assert.ok(Math.abs(r[k] - g[k]) < 1e-3, k)
  assert.ok(Math.abs(r.tanHalf - g.tanHalf) < 1e-5); assert.equal(r.walk, true)
}

// Earthrise: the turn to the Earth comes back, and so do the Sun, a half-turned blend and a free orientation.
assert.deepEqual(open({ ...base, look: { kind: 'earth', w: 1 } }).start.look, { kind: 'earth', w: 1 })
assert.deepEqual(open({ ...base, look: { kind: 'sun' } }).start.look, { kind: 'sun' })
assert.deepEqual(open({ ...base, look: { kind: 'earth', w: 0.375 } }).start.look, { kind: 'earth', w: 0.375 })
assert.equal(open(base).start.look, null)
{
  const free: [number, number, number, number] = [0.1, -0.2, 0.3, Math.sqrt(1 - 0.14)]
  const r = open({ ...base, free }).start.free!
  free.forEach((x, i) => assert.ok(Math.abs(r[i] - x) < 1e-6))
  assert.equal(open({ ...base, free: [0, 0, 0, 1] }).start.free, null, 'an identity turn is not written')
}

// Hostile or broken values are refused, not trusted.
assert.equal(readShare((k) => (k === 'pin' ? 'a17;alert(1)' : null)).pin, null)
assert.equal(readShare((k) => (k === 'g' ? '1,2,x,4,5,6,0.4' : null)).ground, null)
assert.equal(readShare((k) => (k === 'g' ? '1,2,3,4,5,6,-1,0' : null)).ground, null)
assert.equal(readShare((k) => (k === 'look' ? '7' : null)).look, null)

// A site's pictures are loaded first below the no-patch floor over the site, and always for the ground view; elsewhere the pose reopens on its own.
const floor = 1.057
const site = { patchSite: 'a11', patchReady: true, ground: false, near: true, dist: 0.9994, floor }
assert.equal(sitePin(site), 'a11')
assert.equal(sitePin({ ...site, patchSite: 'a17', dist: 1.0003 }), 'a17')
assert.equal(sitePin({ ...site, patchReady: false }), null)
assert.equal(sitePin({ ...site, dist: 1.2 }), null)
assert.equal(sitePin({ ...site, near: false }), null)
assert.equal(sitePin({ ...site, patchSite: null }), null)
assert.equal(sitePin({ ...site, patchSite: 'a17', ground: true, dist: 1.5 }), 'a17')
console.log('share-view: ok')
