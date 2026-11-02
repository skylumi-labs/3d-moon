/**
 * The shadow march (src/moon/march.ts, mirrored in moonShader.ts) against a
 * dense reference march, on real LOLA rows from a built tile set:
 *
 *   MOON_TILES_DIR=.tiles npx tsx scripts/march.test.mts
 *
 * Without MOON_TILES_DIR only the tile-free checks run and it says so.
 * The tile checks run the CPU mirror of the shader's march (same schedule,
 * same rise-over-run geometry, same tile-level choice) over Copernicus and
 * Tycho, Sun due east at 3, 6, 10 and 20 deg, and count pixels where the
 * reference says shadow and the march says light (missed), and the reverse
 * (false). The design's measured numbers for candidate B were 4.5 to 7.7%
 * missed of the shadow area and none false; the shipped 32-step march
 * missed 27 to 76%.
 */
import { reportSkip } from './test-skip.mts'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { decodeHeightPlanes } from '../src/moon/tiles/codec.ts'
import { H_PX, H_SIZE, H_STEP_M, H_TEXEL_KM, MOON_R_KM, heightPath, levelDeg, levelNx, levelNy, tileOf } from '../src/moon/tiles/grid.ts'
import { MARCH_LINEAR_N, MARCH_N, marchDistanceKm, marchLevel, omcSmall, sampleElevation, sinSmall } from '../src/moon/march.ts'
import { moonFragment } from '../src/moon/moonShader.ts'

const DEG = Math.PI / 180
const R = MOON_R_KM

// ---- Tile-free checks -----------------------------------------------------
{
  assert.equal(MARCH_N, 64)
  assert.equal(marchDistanceKm(0), 0.25)
  assert.equal(marchDistanceKm(MARCH_LINEAR_N - 1), 10)
  assert.ok(Math.abs(marchDistanceKm(MARCH_LINEAR_N) - 11) < 1e-9)
  assert.ok(Math.abs(marchDistanceKm(MARCH_N - 1) - 300) < 1e-6)
  for (let k = 1; k < MARCH_N; k++) assert.ok(marchDistanceKm(k) > marchDistanceKm(k - 1))
  // Levels: fine near, coarser far, never beyond the three levels.
  assert.equal(marchLevel(1, H_TEXEL_KM), 0)
  assert.equal(marchLevel(300, H_TEXEL_KM), 2)
  // Rise over run agrees with the vector difference where that is accurate, and is exact on flat ground.
  const flat = sampleElevation(0, 0, 100, R)
  assert.ok(Math.abs(flat - -(100 / R) / 2) < 1e-7, 'flat ground falls away by half the arc angle')
  // A 1 km rim 5 km away: atan((1 km minus the 7 m curvature drop) / 5 km).
  const rim = sampleElevation(1000, 0, 5, R)
  assert.ok(Math.abs(rim / DEG - Math.atan((1 - 25 / (2 * R)) / 5) / DEG) < 0.02, `rim ${rim / DEG}`)
}

// The series the shaders use in place of the GPU's sin and cos, over the march's whole range.
{
  for (let x = 1e-4; x <= 0.18; x *= 1.15) {
    assert.ok(Math.abs(sinSmall(x) - Math.sin(x)) <= 2e-9, `sinSmall ${x}`)
    assert.ok(Math.abs(omcSmall(x) - (1 - Math.cos(x))) <= 1e-10 + 1e-8 * x * x, `omcSmall ${x}`)
  }
  // The series form gives the true curvature drop at the first step (flat ground 1.5 km out sits th/2 below the tangent) without any GPU trig.
  // Whether a given GPU's cos is wrong there cannot be run here (Node has no GPU): the shader-source check below is the guard.
  const th = 1.5 / R
  const newElev = Math.atan2(-R * omcSmall(th), R * sinSmall(th)) / DEG
  assert.ok(Math.abs(newElev - -(th / 2) / DEG) < 1e-4, `the series form reads ${newElev} deg, the true drop`)
}
// Both shader marches take their sines and cosines from the series and from no GPU trig
// (moonShader.ts horizonDeg and horizonDegT): the mechanism itself, since a GPU cannot run here.
{
  const src = moonFragment(180, 4096, '', true)
  const bodies = ['float horizonDeg(vec3 p', 'float horizonDegT(vec3 p'].map((h) => {
    const a = src.indexOf(h)
    assert.ok(a > 0, `${h} is in the shader`)
    return src.slice(a, src.indexOf('\n}\n', a))
  })
  for (const b of bodies) {
    assert.ok(/sinSmall\(th\)/.test(b) && /omcSmall\(th\)/.test(b), 'the march uses the series')
    assert.ok(!/\b(sin|cos)\s*\(/.test(b), 'no GPU sin or cos inside a march')
    assert.ok(!/Q - P|vec3 v = Q/.test(b), 'no difference of two 1,737 km vectors')
  }
}

// ---- Real tiles -----------------------------------------------------------
const dir = process.env.MOON_TILES_DIR
if (!dir || !fs.existsSync(path.join(dir, 'manifest.json'))) {
  reportSkip('march.test', 'data', 'MOON_TILES_DIR not set (or no manifest): the real-LOLA march checks did NOT run')
  process.exit(0)
}

const cache = new Map<string, Float32Array | null>()
function tile(l: number, tx: number, ty: number): Float32Array | null {
  const nx = levelNx(l), ny = levelNy(l)
  tx = ((tx % nx) + nx) % nx
  if (ty < 0 || ty >= ny) return null
  const key = `${l}/${tx}/${ty}`
  let t = cache.get(key)
  if (t === undefined) {
    const f = path.join(dir!, heightPath(l, tx, ty))
    if (!fs.existsSync(f)) t = null
    else {
      const q = decodeHeightPlanes(new Uint8Array(zlib.gunzipSync(fs.readFileSync(f))))
      t = new Float32Array(q.length)
      for (let i = 0; i < q.length; i++) t[i] = q[i] * H_STEP_M
    }
    cache.set(key, t)
  }
  return t
}

/** Bilinear height (m) at lon/lat from the finest tile at or below `minLevel` (the shader's marchH without the fade). */
function height(lon: number, lat: number, minLevel: number): number {
  for (let l = minLevel; l < 3; l++) {
    const { tx, ty } = tileOf(l, lon, lat)
    const t = tile(l, tx, ty)
    if (!t) continue
    const d = levelDeg(l)
    const fx = (((lon + 180) % 360 + 360) % 360) / d - tx
    const fy = (90 - lat) / d - ty
    const x = 1 + fx * H_PX - 0.5, y = 1 + fy * H_PX - 0.5
    const ix = Math.max(0, Math.min(H_SIZE - 2, Math.floor(x))), iy = Math.max(0, Math.min(H_SIZE - 2, Math.floor(y)))
    const ax = Math.max(0, Math.min(1, x - ix)), ay = Math.max(0, Math.min(1, y - iy))
    const g = (a: number, b: number) => t[b * H_SIZE + a]
    return (g(ix, iy) * (1 - ax) + g(ix + 1, iy) * ax) * (1 - ay) + (g(ix, iy + 1) * (1 - ax) + g(ix + 1, iy + 1) * ax) * ay
  }
  throw new Error(`no tile under ${lon}, ${lat}`)
}

/** Elevation (deg) of the skyline due east of (lon, lat) for a schedule of (distance, level) samples. */
type Elev = (hq: number, h0: number, d: number) => number
const realElev: Elev = (hq, h0, d) => sampleElevation(hq, h0, d, R)
function skylineEast(lon: number, lat: number, samples: Iterable<[number, number]>, elev: Elev = realElev): number {
  const cl = Math.cos(lat * DEG), sl = Math.sin(lat * DEG), co = Math.cos(lon * DEG), so = Math.sin(lon * DEG)
  const p = [cl * co, cl * so, sl]
  const e = [-so, co, 0]
  const h0 = height(lon, lat, 0)
  let best = -Math.PI / 2
  for (const [d, lvl] of samples) {
    const th = d / R
    const c = Math.cos(th), s = Math.sin(th)
    const q = [p[0] * c + e[0] * s, p[1] * c + e[1] * s, p[2] * c + e[2] * s]
    const ql = Math.hypot(q[0], q[1], q[2])
    const hq = height(Math.atan2(q[1], q[0]) / DEG, Math.asin(q[2] / ql) / DEG, lvl)
    best = Math.max(best, elev(hq, h0, d))
  }
  return best / DEG
}

const refSamples: [number, number][] = []
for (let d = 0.06; d < 80; d += 0.06 * (1 + d / 30)) refSamples.push([d, 0])
const newSamples: [number, number][] = []
for (let k = 0; k < MARCH_N; k++) { const d = marchDistanceKm(k); newSamples.push([d, marchLevel(d, H_TEXEL_KM)]) }
// The design's model of the march this replaces: 32 geometric steps 1.5 to 300 km, filtered at 0.19 d.
const oldSamples: [number, number][] = []
for (let k = 0; k < 32; k++) {
  const d = 1.5 * Math.pow(300 / 1.5, k / 31)
  oldSamples.push([d, Math.max(0, Math.min(2, Math.floor(Math.log2(Math.max(1, 0.19 * d / H_TEXEL_KM)) + 0.5)))])
}

interface Rate { shadow: number; missed: number; falseShadow: number; n: number }
function compare(lon0: number, lat0: number, w: number, h: number, sunElev: number, schedule: [number, number][], stepPx: number, elev: Elev = realElev): Rate {
  const r: Rate = { shadow: 0, missed: 0, falseShadow: 0, n: 0 }
  for (let j = 0; j < h * 64; j += stepPx) for (let i = 0; i < w * 64; i += stepPx) {
    const lon = lon0 + i / 64, lat = lat0 + h - j / 64
    const ref = skylineEast(lon, lat, refSamples) > sunElev
    const got = skylineEast(lon, lat, schedule, elev) > sunElev
    r.n++
    if (ref) r.shadow++
    if (ref && !got) r.missed++
    if (!ref && got) r.falseShadow++
  }
  return r
}

const sites: [string, number, number][] = [['Copernicus', -25, 5], ['Tycho', -18, -48]]
const report: Record<string, unknown> = {}
for (const [name, lon0, lat0] of sites) {
  for (const sun of [3, 6, 10, 20]) {
    const nu = compare(lon0, lat0, 12, 8, sun, newSamples, 8)
    const od = compare(lon0, lat0, 12, 8, sun, oldSamples, 8)
    const missedPct = 100 * nu.missed / Math.max(1, nu.shadow), falsePct = 100 * nu.falseShadow / nu.n
    const oldMissedPct = 100 * od.missed / Math.max(1, od.shadow)
    report[`${name} sun ${sun}`] = { pixels: nu.n, shadowPct: +(100 * nu.shadow / nu.n).toFixed(2), newMissedOfShadowPct: +missedPct.toFixed(1), newFalsePct: +falsePct.toFixed(3), oldMissedOfShadowPct: +oldMissedPct.toFixed(1) }
    console.log(name, sun, JSON.stringify(report[`${name} sun ${sun}`]), 'shadow pixels', nu.shadow)
    // Candidate B measured 4.5 to 7.7% on Copernicus; allow up to 12% (20% at Sun 20 deg, where few, thin shadows make the share noisy; measured 11 to 17%). Too few shadow pixels make the share meaningless.
    if (nu.shadow >= 40) assert.ok(missedPct <= (sun >= 20 ? 20 : 12), `${name} sun ${sun}: the march misses ${missedPct.toFixed(1)}% of the shadow`)
    // The reference stops at 80 km and the march goes to 300, so a few far skylines add real shadow: a small false share is allowed.
    // Measured: 0 pixels in six cases, 3 (Tycho 3 deg) and 1 (Tycho 10 deg) of 6,144. The bound is an absolute pixel count per
    // case (the old 1.5% of the frame was twice the whole shadow at Sun 20 deg): 5 pixels, and never more than 1% of the shadow.
    assert.ok(nu.falseShadow <= Math.max(5, 0.01 * nu.shadow), `${name} sun ${sun}: ${nu.falseShadow} false-shadow pixels (of ${nu.n}; shadow ${nu.shadow})`)
    // The harness must discriminate: the old schedule loses much more (design: 27 to 76%).
    if (nu.shadow > 40) assert.ok(oldMissedPct >= 2 * missedPct && oldMissedPct >= 15, `${name} sun ${sun}: old ${oldMissedPct.toFixed(1)}% vs new ${missedPct.toFixed(1)}%`)
  }
}
// The bound must discriminate: a march without the curvature drop sees every far rise as higher than it is,
// and its false shadow blows through the bound the real one meets.
{
  const flat: Elev = (hq, h0, d) => Math.atan2((hq - h0) * 0.001, d)
  const bad = compare(-18, -48, 12, 8, 3, newSamples, 8, flat)
  assert.ok(bad.falseShadow > 5 && bad.falseShadow > 0.01 * bad.shadow, `control: a flat-ground march gives ${bad.falseShadow} false-shadow pixels, more than the bound`)
  console.log('control (no curvature drop): false-shadow pixels', bad.falseShadow)
}
console.log(JSON.stringify(report, null, 1))
console.log('march.test: tile checks ran on real LOLA tiles from', dir)
