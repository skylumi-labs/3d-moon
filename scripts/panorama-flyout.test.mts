/**
 * The fly-out over the Apollo 17 site (R2 4:08): continuity of the ground glide to the overhead view, and the wiring in main.ts. Since
 * 2026-10-23 (owner complaint 10, "stay on the moon") closing a panorama opened from the ground shows the retained ground pose again
 * with no travel; the fly-out remains for a panorama opened from orbit (a link) and for ‹ at Eye level (navigator 'orbit', leaveGround overSite).
 *   npm test
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { Vector3 } from 'three'
import { GroundCamera } from '../src/ground/GroundCamera.ts'

const from = { pos: new Vector3(-21, -21, 1.7), headingDeg: 40, pitchDeg: 0, rollDeg: 0, tanHalf: 0.47 }
const to = { pos: new Vector3(0, 0, 2000), headingDeg: 40, pitchDeg: -89, rollDeg: 0, tanHalf: 0.27 }
const smooth = (s: number): number => s * s * (3 - 2 * s)
const N = 192
const pts: Vector3[] = []
const pitches: number[] = []
for (let i = 0; i <= N; i++) {
  const v = GroundCamera.blend(from, to, smooth(i / N))
  pts.push(v.pos); pitches.push(v.pitchDeg)
}
assert.ok(pts[0].distanceTo(from.pos) < 1e-9, 'the fly-out starts at the ground pose')
assert.ok(pts[N].distanceTo(to.pos) < 1e-9, 'and ends over the site')
assert.ok(pitches[N] <= -88, 'looking down on the landing zone')
const steps = pts.slice(1).map((p, i) => p.distanceTo(pts[i]))
for (let i = 1; i < steps.length - 1; i++) {
  const nb = Math.max(steps[i - 1], steps[i + 1])
  if (nb > 0) assert.ok(steps[i] <= 3 * nb + 1e-9, `no frame jump at ${i}: ${steps[i]} vs ${nb}`)
}
for (let i = 1; i < pts.length; i++) assert.ok(pts[i].z >= pts[i - 1].z - 1e-9, 'altitude never falls')

const src = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const onClose = src.slice(src.indexOf('onClose: () => {'), src.indexOf('const wanted = APOLLO17_PANORAMAS'))
assert.ok(/if \(!onApollo17Ground\(\)\) flyOutOverSite\(\)/.test(onClose), 'closing a panorama flies out only from orbit; on the ground the retained pose is shown again (#10)')
assert.ok(!/^\s*flyOutOverSite\(\)\s*$/m.test(onClose), 'no unconditional fly-out on close')
const at = src.indexOf('function flyOutOverSite')
const fly = src.slice(at, at + 700)
assert.ok(/leaveGround\(false, \(\) => navApi\?\.away\(\), true\)/.test(fly) && /flyTo\(/.test(fly), 'from the ground view one glide; from the rig one fly-to')
assert.ok(/navApi\?\.away\(\)/.test(fly), 'the pill dims after the fly-out')
// V12: opening a panorama takes the camera but keeps the site's photograph load; closing retries any level it aborted.
const onOpen = src.slice(src.indexOf('onOpen: () => {'), src.indexOf('onClose: () => {'))
assert.ok(/takeCurrentScriptCamera\('other', true\)/.test(onOpen), 'opening holds the patch load')
assert.ok(/const keepPatch = holdPatch \|\|/.test(src), 'stopMoments honours holdPatch')
assert.ok(/patch\?\.retryRefinement\(\)\s*\n(\s*\/\/[^\n]*\n)*\s*if \(!onApollo17Ground\(\)\) flyOutOverSite\(\)/.test(onClose), 'closing retries the refinement, then (from orbit only) flies out; on the ground the retry runs under the kept view')
const landing = src.slice(src.indexOf('function stepSiteLanding'), src.indexOf('function apexAltitude'))
assert.ok(/patch\.loading \? 25000 : 6000/.test(landing), 'the landing waits longer while the photograph is still downloading')
console.log('panorama fly-out ok')
