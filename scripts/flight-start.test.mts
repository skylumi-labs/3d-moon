/** A5: a viewpoint pick moves the camera on the first frame (source guards on main.ts; the planner's own shape is in path.test.mts). */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.match(main, /const PICK_FADE_HOLD_MS = 0\b/, 'a pick holds the camera for no time')
assert.equal((main.match(/beginDateChange\(momentTime, PICK_FADE_HOLD_MS, true\)/g) ?? []).length, 2, 'playMoment and approachSite both start the date change as a journey start (cut, no ghost)')
assert.ok(!/beginDateChange\(momentTime, PICK_FADE_HOLD_MS, !instant\)/.test(main), 'a ?moment= link (instant) is a journey start too: no frozen-Home ghost under the flight (R4 1021b)')
const pm = main.slice(main.indexOf('function playMoment('), main.indexOf('Object.assign(api, {\n  playMoment'))
assert.ok(pm.length > 500, 'found playMoment')
assert.ok(!/[^_]FADE_HOLD_MS/.test(pm), 'playMoment does not use the held fade')
const prov = pm.indexOf('tilesProvisional = true')
assert.ok(prov > 0, 'a moment that needs tiles but no patch proceeds on the base maps')
assert.ok(/void ensureTiles\(\)\.then\(/.test(pm.slice(prov, prov + 700)), 'tiles load in parallel; a re-plan only when the real floor differs')
assert.match(main, /if \(auditFloor === null\) rig\.setFloor\(expectedLoadingFloor\(\)\)/, 'the rig gets the expected finest floor while the manifest loads')
assert.match(main, /const EXPECTED_FINEST_HEIGHT_TEXEL_KM = 0\.0592/, 'the finest hosted height texel')
assert.match(main, /closeUpDist\(tween\.plan\.to\.pose\.lon, tween\.plan\.to\.pose\.lat\) - tween\.floorDist/, 'the re-plan guard compares the target floor with the plan floor')
assert.ok(!/function restoreFloorAfterFailure[\s\S]{0,600}flyTo\(/.test(main), 'a failed load never forces a move')
assert.ok(prov < pm.indexOf('flyTo('), 'the provisional branch precedes the first flyTo')
console.log('flight-start.test ok')
