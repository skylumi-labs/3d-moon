// Screen-space-error tile LOD (wanted.ts effectiveFootprintKm): the level follows the SHARP axis of a pixel's ground footprint, so a grazing
// view keeps its fine tiles to the horizon instead of dropping to the 4k map. Pure of GL.
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { ANISO_TILE, computeWanted, effectiveFootprintKm, type StreamView } from '../src/moon/tiles/wanted.ts'
import { H_TEXEL_KM, MOON_R_KM, pageWidth } from '../src/moon/tiles/grid.ts'
import { levelRow, finestWanted } from '../src/moon/tiles/levels.ts'
import { moonFragment } from '../src/moon/moonShader.ts'

// Projected-error math.
assert.equal(effectiveFootprintKm(1, 1), 1, 'nadir: the pixel footprint itself')
assert.equal(effectiveFootprintKm(1, 0.5), 1, 'within the filter reach (1/mu <= aniso): the short axis')
assert.equal(effectiveFootprintKm(1, 0.15), 1, 'the curvature clamp (mu 0.15 -> 6.7x) is still inside 8x')
assert.equal(effectiveFootprintKm(1, 0.01), 1, 'mu is clamped, never a division by ~0')
assert.equal(effectiveFootprintKm(1, 0.15, 1), 1 / 0.15, 'aniso 1 is the old long-axis rule')
assert.ok(Math.abs(effectiveFootprintKm(1, 0.1, 4) - 1 / 0.15 / 4) < 1e-12, 'a weaker filter keeps part of the stretch')
// The level that footprint picks: grazing at 0.15 asked for 2.7 octaves coarser before.
const fp = 0.9 // km: one pixel across the view
const old = finestWanted(fp / 0.15, H_TEXEL_KM, 2, 0), now = finestWanted(effectiveFootprintKm(fp, 0.15), H_TEXEL_KM, 2, 0)
assert.ok(now < old, `grazing now asks a finer level (${now} < ${old})`)
assert.equal(now, finestWanted(fp, H_TEXEL_KM, 2, 0))

// An oblique low view over an all-present 3-level set: more level-0 tiles are wanted than under the old rule, and every one of them is
// farther from the nadir than the old rule reached.
function viewOver(dist: number, lon: number, lat: number, pitchDeg: number): StreamView {
  const d = Math.PI / 180, w = 2400, h = 1360
  const dir = new THREE.Vector3(Math.cos(lat * d) * Math.cos(lon * d), Math.cos(lat * d) * Math.sin(lon * d), Math.sin(lat * d))
  const nadir = dir.clone().negate()
  const right = new THREE.Vector3().crossVectors(nadir, new THREE.Vector3(0, 0, 1)).normalize()
  const up = new THREE.Vector3().crossVectors(right, nadir).normalize()
  const fwd = nadir.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(right, pitchDeg * d))
  const tanH = Math.tan(15 * d)
  return { pos: dir.clone().multiplyScalar(dist), right, up: up.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(right, pitchDeg * d)), back: fwd.clone().negate(), tanHalf: tanH, aspect: w / h, tanPerPx: 2 * tanH / h, moonX: new THREE.Vector3(1, 0, 0), moonY: new THREE.Vector3(0, 1, 0), moonZ: new THREE.Vector3(0, 0, 1) }
}
const pw = pageWidth(0)
const ctx = (aniso?: number) => ({ deepest: 0, isPresent: () => true, keyOf: (l: number, tx: number, ty: number) => (levelRow(l) + ty) * pw + tx, aniso })
const v = viewOver(1 + 200 / MOON_R_KM, 0, 10, 55)
const count = (m: Map<number, { level: number }>, l: number) => [...m.values()].filter((t) => t.level === l).length
const a = computeWanted(v, ctx(1)), b = computeWanted(v, ctx())
assert.ok(count(b, 0) > count(a, 0), `oblique: level-0 tiles ${count(a, 0)} -> ${count(b, 0)}`)
assert.ok(b.size >= a.size)
assert.equal(ANISO_TILE, 8)

// Four height-normal samples integrate the long axis, retaining a finer
// transverse footprint. Colour residency continues to use hardware anisotropy.
const normalFootprintKm = (minorKm: number, mu: number): number => Math.max(minorKm, minorKm / Math.max(Math.abs(mu), 0.02) / 4)
assert.equal(normalFootprintKm(0.14, 0.15), 0.14 / 0.15 / 4)
assert.equal(normalFootprintKm(0.14, 0.5), 0.14)
assert.equal(normalFootprintKm(0.14, 1), 0.14, 'nadir normal footprint equals the colour footprint')
assert.ok(normalFootprintKm(0.14, 0.1) > effectiveFootprintKm(0.14, 0.1), 'oblique normal footprint exceeds colour footprint')
const tileRamp = (fpKm: number, texelKm: number): number => 1 - Math.min(1, Math.max(0, (fpKm / texelKm - 1))) ** 2 * (3 - 2 * Math.min(1, Math.max(0, (fpKm / texelKm - 1))))
assert.ok(tileRamp(0.20, H_TEXEL_KM * 0.25) < tileRamp(0.20, H_TEXEL_KM * 0.5), 'normal footprint transitions from coarse to finer levels monotonically')
assert.ok(tileRamp(0.20, H_TEXEL_KM * 0.25) > 0 && tileRamp(0.20, H_TEXEL_KM * 0.5) > 0, 'oblique normal blend retains graded coarse and deep contributions')
const deepFrag = moonFragment(180, 4096, '', true, null, false, -3, true)
assert.match(deepFrag, /float fpTileN = mix\(length\(uCamPos - p\) \* R_KM \* uTileTanPerPx \/ max\(muP, 0\.15\), max\(kmPerPx, kmPerPx \* normalRatio \/ 4\.0\), uNormalFilter\)/)
assert.match(deepFrag, /nwn3 = tileWeight\(tn3, -3, fpTileN, nGate\)/)
assert.match(deepFrag, /gTileMarch = tGate \* uTileMarch/)
assert.match(deepFrag, /dFp = effFp\(length\(uCamPos - p\)/, 'detail and colour retain the anisotropic footprint')
console.log('tile-lod: ok', count(a, 0), '->', count(b, 0))
