import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { elevationRampGlsl, elevationRangeLabels, ELEVATION_RAMP, rangeMetersForAltitude, relativeElevationFraction } from '../src/topography/elevation'
import { moonFragment } from '../src/moon/moonShader'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.doesNotMatch(main, /mountTopography|topographyUi|params\.get\(['"]topography['"]\)/, 'the visitor UI does not mount or activate the colour overlay')
assert.match(main, /cur\.searchParams\.delete\(['"]topography['"]\)/, 'shared URLs discard the retired overlay flag')
assert.doesNotMatch(main, /searchParams\.set\(['"]topography['"]/, 'shared URLs never write the retired overlay flag')

assert.equal(rangeMetersForAltitude(Number.NaN), 250)
assert.equal(rangeMetersForAltitude(0), 25)
assert.ok(rangeMetersForAltitude(100) > rangeMetersForAltitude(1))
assert.ok(rangeMetersForAltitude(260) > 500 && rangeMetersForAltitude(260) < 1200, 'orbital crater relief retains gradation across hundreds of metres')
assert.equal(rangeMetersForAltitude(1e9), 18_000)
assert.deepEqual(elevationRangeLabels(250), ['−250 m', '+250 m'])
assert.equal(relativeElevationFraction(10, 10, 100), 0.5)
assert.equal(relativeElevationFraction(110, 10, 100), 1)
assert.equal(relativeElevationFraction(-90, 10, 100), 0)
assert.deepEqual(ELEVATION_RAMP.map((stop) => stop.hex), ['#2455e8', '#00cce8', '#ffe45c', '#ff713d', '#e941a5'])

const globalShader = moonFragment(180, 4096)
assert.match(globalShader, /if \(uTopoOn > 0\.5\)/)
assert.match(globalShader, /heightAt\(uv, lodN\)/)
assert.ok(!elevationRampGlsl().includes('sampler'))

const patchShader = moonFragment(180, 4096, '', true, [
  { h: true, r: true, fadeM: 1200 },
  { h: true, r: true, fadeM: 320 },
  { h: true, r: true, fadeM: 80 },
])
assert.match(patchShader, /topographyHQ\(p, -3, lod0/)
assert.match(patchShader, /float topographyHQ\(vec3 x, int lmin, float lodG, float fpM\)/)
assert.match(patchShader, /mix\(1\.0, uPatchGround, forTerrain\)/)
assert.match(patchShader, /0\.65 \* uTopoWhiteIF/)
assert.match(patchShader, /0\.42 \+ 0\.58 \* max/)
const samplers = patchShader.match(/uniform\s+(?:highp\s+)?sampler(?:2D|2DArray)\s+\w+/g) ?? []
assert.ok(samplers.length <= 16, `topography shader uses ${samplers.length} samplers`)
console.log(`topography.test: ${samplers.length} samplers in the three-level patch shader; range and ramp checks passed`)
