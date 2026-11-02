/**
 * The shadow march over the Apollo 17 patch's real DTM (P2 of the moon site), on the CPU:
 *
 *   MOON_TILES_DIR=.tiles npx tsx scripts/march-a17.test.mts     (needs .patch/a17 from the built patch)
 *
 * The shipped shadow march read the 474 m global tiles only, so the patch's 2 m (L1) and 8 m (L2) heights never
 * cast a shadow: massif shadows came out as polygons of tile facets and craters cast none. The shader's answer
 * (moonShader.ts patchGround, marchHQ, near steps in horizonDegT) is mirrored here: the fused ground (tiles, then L2, then L1,
 * each blended over its own edge fade) sampled by the march's own schedule (march.ts, plus the near steps).
 *
 * Reference: a dense march (10 m steps to 2 km, 30 m to 8 km, 100 m to 40 km) over the fused ground, looking west (the
 * tour's Sun is 14 deg up in the west). For a grid of ground points over the valley and Suns of 5, 14, 25 and
 * 45 deg, it counts the points the reference puts in shadow and the march lights (missed) and the reverse (false).
 * Three marches are scored: the old one (tiles only, the shipped schedule), the new one, and the new one with its
 * patch mechanism neutered (a control: it must fail the bound, or the bound proves nothing).
 */
import { reportSkip } from './test-skip.mts'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { decodeHeightPlanes } from '../src/moon/tiles/codec.ts'
import { H_PX, H_SIZE, H_STEP_M, H_TEXEL_KM, MOON_R_KM, heightPath, levelDeg, levelNx, levelNy, tileOf } from '../src/moon/tiles/grid.ts'
import { MARCH_N, MARCH_NEAR_N, marchDistanceKm, marchLevel, marchNearDistanceKm, sampleElevation } from '../src/moon/march.ts'
import { fadeFor } from '../src/moon/patch/PatchLayer.ts'

const DEG = Math.PI / 180
const R = MOON_R_KM
const tilesDir = process.env.MOON_TILES_DIR
const patchDir = process.env.MOON_PATCH_DIR ?? '.patch'
const a17 = path.join(patchDir, 'a17')
if (!tilesDir || !fs.existsSync(path.join(tilesDir, 'manifest.json')) || !fs.existsSync(path.join(a17, 'manifest.json'))) {
  reportSkip('march-a17.test', 'data', 'needs MOON_TILES_DIR and .patch/a17 (built patch): the real-DTM march checks did NOT run')
  process.exit(0)
}

// ---- The patch's heights ----------------------------------------------------
const man = JSON.parse(fs.readFileSync(path.join(a17, 'manifest.json'), 'utf8'))
function half(h: number): number {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023
  return e === 0 ? s * m * 2 ** -24 : s * (1 + m / 1024) * 2 ** (e - 15)
}
interface Lv { w: number; h: number; eastM: number; northM: number; tE: number; tN: number; fadeM: number; z: Float32Array }
function loadLevel(name: string): Lv {
  const l = man.levels.find((x: { name: string }) => x.name === name)
  const b = zlib.gunzipSync(fs.readFileSync(path.join(a17, l.heights)))
  const n = l.w * l.h
  const u = new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + n * 4))
  const z = new Float32Array(n)
  for (let i = 0; i < n; i++) z[i] = half(u[i]) + half(u[n + i]) + man.h0M
  return { w: l.w, h: l.h, eastM: l.eastM, northM: l.northM, tE: l.texelEastM, tN: l.texelNorthM, fadeM: fadeFor(l.texelM), z }
}
const L2 = loadLevel('L2'), L1 = loadLevel('L1')

const lon0 = man.site.lon * DEG, lat0 = man.site.lat * DEG
const site = [Math.cos(lat0) * Math.cos(lon0), Math.cos(lat0) * Math.sin(lon0), Math.sin(lat0)]
const east = [-Math.sin(lon0), Math.cos(lon0), 0]
const north = [-Math.sin(lat0) * Math.cos(lon0), -Math.sin(lat0) * Math.sin(lon0), Math.cos(lat0)]
const RM = R * 1000
/** Metres east and north of the site of a unit vector (patchEN in the shader). */
function en(q: number[]): [number, number] {
  const d = [q[0] - site[0], q[1] - site[1], q[2] - site[2]]
  return [(d[0] * east[0] + d[1] * east[1] + d[2] * east[2]) * RM, (d[0] * north[0] + d[1] * north[1] + d[2] * north[2]) * RM]
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
function edge(l: Lv, qx: number, qy: number): number {
  const dx = Math.min(qx, l.w - qx) * l.tE, dy = Math.min(qy, l.h - qy) * l.tN
  return smooth(0, l.fadeM, Math.min(dx, dy))
}
function bilin(l: Lv, qx: number, qy: number): number {
  const x = qx - 0.5, y = qy - 0.5
  const ix = Math.floor(x), iy = Math.floor(y), ax = x - ix, ay = y - iy
  const g = (a: number, b: number) => l.z[Math.max(0, Math.min(l.h - 1, b)) * l.w + Math.max(0, Math.min(l.w - 1, a))]
  return (g(ix, iy) * (1 - ax) + g(ix + 1, iy) * ax) * (1 - ay) + (g(ix, iy + 1) * (1 - ax) + g(ix + 1, iy + 1) * ax) * ay
}

// ---- The tiles' heights (the shader's tile ground, from march.test.mts) ---------
const cache = new Map<string, Float32Array | null>()
function tile(l: number, tx: number, ty: number): Float32Array | null {
  const nx = levelNx(l), ny = levelNy(l)
  tx = ((tx % nx) + nx) % nx
  if (ty < 0 || ty >= ny) return null
  const key = `${l}/${tx}/${ty}`
  let t = cache.get(key)
  if (t === undefined) {
    const f = path.join(tilesDir!, heightPath(l, tx, ty))
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
function tileHeight(lon: number, lat: number, minLevel: number): number {
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

/** The fused ground at a unit vector (patchGround): tiles, then L2 over them, then L1 over that. `usePatch` false is the shipped ground. */
function ground(q: number[], lvl: number, usePatch: boolean): number {
  const ql = Math.hypot(q[0], q[1], q[2])
  const lon = Math.atan2(q[1], q[0]) / DEG, lat = Math.asin(q[2] / ql) / DEG
  const base = tileHeight(lon, lat, lvl)
  if (!usePatch) return base
  const [e, n] = en(q)
  let h = base
  for (const l of [L2, L1]) {
    const qx = (e - l.eastM) / l.tE, qy = (l.northM - n) / l.tN
    const w = edge(l, qx, qy)
    if (w > 0) h = h * (1 - w) + w * bilin(l, qx, qy)
  }
  return h
}

/** Skyline elevation (deg) looking west from the ground point at metres (e, n) from the site, over a list of (distance km, tile level). */
function skylineWest(e: number, n: number, samples: Iterable<[number, number]>, usePatch: boolean): number {
  const p = [0, 1, 2].map((i) => site[i] + (east[i] * e + north[i] * n) / RM)
  const pl = Math.hypot(p[0], p[1], p[2])
  const pn = p.map((v) => v / pl)
  const ee = [-pn[1], pn[0], 0]
  const el = Math.hypot(ee[0], ee[1])
  const t = ee.map((v) => -v / el)                       // west
  const h0 = ground(pn, 0, usePatch)
  let best = -Math.PI / 2
  for (const [d, lvl] of samples) {
    const th = d / R
    const c = Math.cos(th), s = Math.sin(th)
    const q = [pn[0] * c + t[0] * s, pn[1] * c + t[1] * s, pn[2] * c + t[2] * s]
    best = Math.max(best, sampleElevation(ground(q, lvl, usePatch), h0, d, R))
  }
  return best / DEG
}

const ref: [number, number][] = []
for (let d = 0.01; d < 2; d += 0.01) ref.push([d, 0])
for (let d = 2; d < 8; d += 0.03) ref.push([d, 0])
for (let d = 8; d <= 40; d += 0.1) ref.push([d, 0])
const far: [number, number][] = []
for (let k = 0; k < MARCH_N; k++) { const d = marchDistanceKm(k); far.push([d, marchLevel(d, H_TEXEL_KM)]) }
const near: [number, number][] = []
for (let k = 0; k < MARCH_NEAR_N; k++) near.push([marchNearDistanceKm(k), 0])
const withNear = [...near, ...far]

// Origins: a 700 m grid over the valley the tour looks at (the L2 DTM's middle: 18 km east-west, 34 km north-south, the site near its centre).
const pts: [number, number][] = []
for (let n = -19000; n <= 15000; n += 700) for (let e = -9000; e <= 9000; e += 700) pts.push([e, n])
// SHADOW_MAP=<file.json>: also write the reference skyline elevation (deg, looking west) on a 350 m grid, for a picture of where the shadows lie.
if (process.env.SHADOW_MAP) {
  const g: number[] = [], out = { e0: -9000, n0: 15000, step: 350, w: 52, h: 98, refDeg: g, newDeg: [] as number[] }
  for (let j = 0; j < out.h; j++) for (let i = 0; i < out.w; i++) { const e = out.e0 + i * out.step, n = out.n0 - j * out.step; g.push(skylineWest(e, n, ref, true)); out.newDeg.push(skylineWest(e, n, [...near, ...far], true)) }
  fs.writeFileSync(process.env.SHADOW_MAP, JSON.stringify(out))
}
const R0 = pts.map(([e, n]) => skylineWest(e, n, ref, true))
const OLD = pts.map(([e, n]) => skylineWest(e, n, far, false))
const NEW = pts.map(([e, n]) => skylineWest(e, n, withNear, true))
const NEUTERED = pts.map(([e, n]) => skylineWest(e, n, withNear, false))   // the new schedule without the patch heights

function score(got: number[], sun: number) {
  let shadow = 0, missed = 0, falseShadow = 0
  for (let i = 0; i < pts.length; i++) {
    const r = R0[i] > sun, g = got[i] > sun
    if (r) shadow++
    if (r && !g) missed++
    if (!r && g) falseShadow++
  }
  return { shadow, missed, falseShadow, n: pts.length }
}
const report: Record<string, unknown> = {}
for (const sun of [5, 14, 25, 45]) {
  const a = score(NEW, sun), o = score(OLD, sun), c = score(NEUTERED, sun)
  const wrong = (s: { missed: number; falseShadow: number }) => s.missed + s.falseShadow
  report[`sun ${sun}`] = { points: a.n, referenceShadow: a.shadow, newWrong: wrong(a), newMissed: a.missed, newFalse: a.falseShadow, oldWrong: wrong(o), neuteredWrong: wrong(c) }
  console.log('sun', sun, JSON.stringify(report[`sun ${sun}`]))
  // The new march gets almost every point right: wrong points are under 3% of the grid (the schedule steps 250 m, the reference 10 to 100 m).
  assert.ok(wrong(a) <= 0.03 * a.n, `sun ${sun}: the new march is wrong at ${wrong(a)} of ${a.n} points`)
  // The old and the neutered marches must lose by a wide margin (the bound discriminates).
  if (wrong(o) >= 30) {
    assert.ok(wrong(o) >= 2 * wrong(a) + 20, `sun ${sun}: old ${wrong(o)} wrong vs new ${wrong(a)}: the harness does not tell them apart`)
    assert.ok(wrong(c) >= 2 * wrong(a) + 20, `sun ${sun}: neutered ${wrong(c)} wrong vs new ${wrong(a)}: the patch mechanism is not what the test measures`)
  }
}
console.log('march-a17.test: real a17 DTM checks ran; tiles', tilesDir, 'patch', a17)
