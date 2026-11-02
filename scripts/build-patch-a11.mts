/**
 * Builds the Apollo 11 patch pyramid (DESIGN-ZOOM.md): heights and image detail
 * from the LROC NAC DTM `NAC_DTM_APOLLO11` (2 m post spacing) and its 0.5 m
 * orthophoto `..._M150361817_50CM`, both public-domain PDS products.
 *
 *   npx tsx scripts/build-patch-a11.mts --src <dir with dtm.tif + ortho1.tif> --out <dir>
 *
 * Needs the `gdal_translate` command line tool (GDAL) once, to unpack the two
 * GeoTIFFs to raw rasters (dtm.raw, ortho.raw, kept in --src).
 *
 * What it writes (all gzip, little endian):
 *   manifest.json                 levels, grids, site numbers, credit
 *   L2.h.f16.gz  L1.h.f16.gz      heights, half float, metres minus H0 (manifest `h0M`)
 *   L2.r.u8.gz L1.r.u8.gz L0.r.u8.gz
 *                                 image detail: a byte per texel, ratio = 2^((b-128)/40),
 *                                 the photograph flattened by the terrain shading it was
 *                                 taken under and divided by its own 400 m average
 *
 * Levels: L2 8 m over the whole 4.2 x 28 km DTM; L1 2 m, 4.2 x 8.2 km around the
 * site; L0 0.5 m, 2.05 x 2.05 km around the site (image only: the heights stop at 2 m).
 * The global colour map keeps the absolute brightness; the patch only adds detail
 * around it, so nothing here is claimed as albedo.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { ephemerisAt } from '../src/ephemeris'
import { Vector3 } from 'three'

const arg = (k: string): string | undefined => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined }
const SRC = path.resolve(arg('--src') ?? '.')
const OUT = path.resolve(arg('--out') ?? '.patch')
fs.mkdirSync(OUT, { recursive: true })

// ---- the grids (from the PDS labels / gdalinfo) -----------------------------
const R_M = 1737400
const STD_PARALLEL = 1 * Math.PI / 180
const DTM = { w: 2111, h: 13978, x0: -4748754.0000014, y0: 37496.000000011, px: 2 }
const ORTHO = { w: 8440, h: 55908, x0: -4748752.9999999, y0: 37494.999999999, px: 0.5 }
const lonOfX = (x: number): number => 180 + (x / (R_M * Math.cos(STD_PARALLEL))) * 180 / Math.PI
const latOfY = (y: number): number => (y / R_M) * 180 / Math.PI
/** The site: the Apollo 11 lunar module, from the LROC image (checked by eye on the L0 output). */
const SITE = { lat: 0.6741, lon: 23.4730 }
const SUN_TIME = new Date('2011-01-22T19:00:00Z')

function unpack(name: string, tif: string, raw: string): string {
  const out = path.join(SRC, raw)
  if (!fs.existsSync(out)) {
    const r = spawnSync('gdal_translate', ['-q', '-of', 'ENVI', path.join(SRC, tif), out], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error(`gdal_translate failed for ${name}`)
  }
  return out
}
const dtmRaw = fs.readFileSync(unpack('dtm', 'dtm.tif', 'dtm.raw'))
const dtm = new Float32Array(dtmRaw.buffer, dtmRaw.byteOffset, DTM.w * DTM.h)
const orthoBuf = fs.readFileSync(unpack('ortho', 'ortho1.tif', 'ortho.raw'))
const ortho = new Uint8Array(orthoBuf.buffer, orthoBuf.byteOffset, ORTHO.w * ORTHO.h)
if (dtmRaw.length !== DTM.w * DTM.h * 4 || orthoBuf.length !== ORTHO.w * ORTHO.h) throw new Error('raw sizes do not match the labels')

const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)
/** Float to half float bits (round to nearest; the values here are small, so no overflow handling beyond clamping). */
function toHalf(v: number): number {
  f32[0] = v
  const x = u32[0]
  const sign = (x >>> 16) & 0x8000
  const exp = ((x >>> 23) & 0xff) - 127 + 15
  const man = x & 0x7fffff
  if (exp <= 0) {
    if (exp < -10) return sign
    const m = (man | 0x800000) >> (1 - exp)
    return sign | ((m + 0x1000) >> 13)
  }
  if (exp >= 31) return sign | 0x7bff
  const r = sign | (exp << 10) | (man >> 13)
  return r + ((man >> 12) & 1)
}

const isNoData = (v: number): boolean => !(v > -1e6)

// ---- heights: fill the holes, subtract H0 ---------------------------------------
let nodata = 0
let sum = 0, n = 0
for (let i = 0; i < dtm.length; i++) { const v = dtm[i]; if (isNoData(v)) nodata++; else { sum += v; n++ } }
const H0 = Math.round(sum / n)
// Holes take the mean of valid samples in a growing window (few and small; the shader only reads slopes).
{
  const W = DTM.w, H = DTM.h
  const rowsWithHoles = new Set<number>()
  for (let i = 0; i < dtm.length; i++) if (isNoData(dtm[i])) rowsWithHoles.add(Math.floor(i / W))
  const copy = Float32Array.from(dtm)
  for (const y of rowsWithHoles) for (let x = 0; x < W; x++) {
    if (!isNoData(copy[y * W + x])) continue
    let acc = 0, cnt = 0
    for (let r = 2; r <= 64 && cnt === 0; r *= 2) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
        const v = copy[yy * W + xx]
        if (!isNoData(v)) { acc += v; cnt++ }
      }
    }
    dtm[y * W + x] = cnt ? acc / cnt : H0
  }
}
let hMin = Infinity, hMax = -Infinity
for (let i = 0; i < dtm.length; i++) { hMin = Math.min(hMin, dtm[i]); hMax = Math.max(hMax, dtm[i]) }

// ---- the light the photograph was taken under -----------------------------------
const e = ephemerisAt(SUN_TIME)
const lonR = SITE.lon * Math.PI / 180, latR = SITE.lat * Math.PI / 180
const up = new Vector3(Math.cos(latR) * Math.cos(lonR), Math.cos(latR) * Math.sin(lonR), Math.sin(latR)).applyMatrix3(e.moonToWorld)
const east = new Vector3(-Math.sin(lonR), Math.cos(lonR), 0).applyMatrix3(e.moonToWorld)
const north = new Vector3(-Math.sin(latR) * Math.cos(lonR), -Math.sin(latR) * Math.sin(lonR), Math.cos(latR)).applyMatrix3(e.moonToWorld)
const sunEl = Math.asin(e.sunDir.dot(up))
const sunE = e.sunDir.dot(east), sunN = e.sunDir.dot(north), sunU = e.sunDir.dot(up)
const phaseDeg = 90 - sunEl * 180 / Math.PI
const lunarL = (a: number): number => Math.max(0, 1 - 0.019 * a + 2.42e-4 * a * a - 1.46e-6 * a * a * a)
const L = lunarL(phaseDeg)
/** The site shader's surface term (moonShader.ts) for a normal, viewed from straight above. */
function shade(nx: number, ny: number, nz: number): number {
  const mu0 = Math.max(0, nx * sunE + ny * sunN + nz * sunU)
  const mu = Math.max(1e-3, nz)
  return 2 * L * mu0 / (mu0 + mu + 1e-5) + (1 - L) * mu0
}
const S0 = shade(0, 0, 1)

/** Slope (east, north; rise over run) of the DTM at fractional pixel coordinates, central differences on the 2 m grid. */
function slopeAt(fx: number, fy: number): [number, number] {
  const x = Math.max(1, Math.min(DTM.w - 2, Math.round(fx))), y = Math.max(1, Math.min(DTM.h - 2, Math.round(fy)))
  const i = y * DTM.w + x
  return [(dtm[i + 1] - dtm[i - 1]) / (2 * DTM.px), (dtm[i - DTM.w] - dtm[i + DTM.w]) / (2 * DTM.px)]
}

// ---- image detail ratio -----------------------------------------------------------
// The photograph divided by the shading the terrain gave it, then by its own 400 m average.
// Work on the 8 m grid for the average (box filter), and per texel for the flattening.
const BLOCK = 4 // DTM texel per L2 texel
const L2 = { w: Math.floor(DTM.w / BLOCK), h: Math.floor(DTM.h / BLOCK), px: DTM.px * BLOCK }

/** Mean of valid ortho pixels over an ortho window; returns 0 when none is valid. */
function orthoFlat(ox: number, oy: number): number {
  if (ox < 0 || oy < 0 || ox >= ORTHO.w || oy >= ORTHO.h) return 0
  const v = ortho[oy * ORTHO.w + ox]
  if (v === 0) return 0
  // DTM pixel under this ortho pixel (the two grids are offset by 1 m).
  const fx = (ORTHO.x0 + (ox + 0.5) * ORTHO.px - DTM.x0) / DTM.px - 0.5
  const fy = (DTM.y0 - (ORTHO.y0 - (oy + 0.5) * ORTHO.px)) / DTM.px - 0.5
  const [sx, sy] = slopeAt(fx, fy)
  const inv = 1 / Math.hypot(sx, sy, 1)
  const s = shade(-sx * inv, -sy * inv, inv) / S0
  return v / Math.max(0.35, s)
}

// The 8 m grid of flattened brightness, then its 400 m box average.
const flat8 = new Float32Array(L2.w * L2.h)
const valid8 = new Uint8Array(L2.w * L2.h)
{
  const per = Math.round(L2.px / ORTHO.px) // 16
  for (let j = 0; j < L2.h; j++) for (let i = 0; i < L2.w; i++) {
    const ox0 = Math.round((DTM.x0 + i * L2.px - ORTHO.x0) / ORTHO.px), oy0 = Math.round((ORTHO.y0 - (DTM.y0 - j * L2.px)) / ORTHO.px)
    let acc = 0, cnt = 0
    for (let dy = 0; dy < per; dy += 2) for (let dx = 0; dx < per; dx += 2) {
      const f = orthoFlat(ox0 + dx, oy0 + dy)
      if (f > 0) { acc += f; cnt++ }
    }
    if (cnt > per * per / 16) { flat8[j * L2.w + i] = acc / cnt; valid8[j * L2.w + i] = 1 }
  }
}
const AVG_R = 25 // 8 m texels: a 51 texel (about 400 m) box
const avg8 = boxAverage(flat8, valid8, L2.w, L2.h, AVG_R)

function boxAverage(v: Float32Array, ok: Uint8Array, w: number, h: number, r: number): Float32Array {
  const sumX = new Float64Array(w * h), cntX = new Float64Array(w * h)
  for (let y = 0; y < h; y++) {
    let s = 0, c = 0
    for (let x = -r; x < w; x++) {
      const add = x + r, sub = x - r - 1
      if (add < w && add >= 0 && ok[y * w + add]) { s += v[y * w + add]; c++ }
      if (sub >= 0 && ok[y * w + sub]) { s -= v[y * w + sub]; c-- }
      if (x >= 0) { sumX[y * w + x] = s; cntX[y * w + x] = c }
    }
  }
  const out = new Float32Array(w * h)
  for (let x = 0; x < w; x++) {
    let s = 0, c = 0
    for (let y = -r; y < h; y++) {
      const add = y + r, sub = y - r - 1
      if (add < h && add >= 0) { s += sumX[add * w + x]; c += cntX[add * w + x] }
      if (sub >= 0) { s -= sumX[sub * w + x]; c -= cntX[sub * w + x] }
      if (y >= 0) out[y * w + x] = c > 0 ? s / c : 0
    }
  }
  return out
}

/** The 400 m average under an ortho pixel, bilinear on the 8 m grid. */
function avgUnder(ox: number, oy: number): number {
  const fx = (ORTHO.x0 + (ox + 0.5) * ORTHO.px - DTM.x0) / L2.px - 0.5
  const fy = (DTM.y0 - (ORTHO.y0 - (oy + 0.5) * ORTHO.px)) / L2.px - 0.5
  const x0 = Math.max(0, Math.min(L2.w - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(L2.h - 2, Math.floor(fy)))
  const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0))
  const a = avg8[y0 * L2.w + x0], b = avg8[y0 * L2.w + x0 + 1], c = avg8[(y0 + 1) * L2.w + x0], d = avg8[(y0 + 1) * L2.w + x0 + 1]
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
}
const encode = (ratio: number): number => Math.max(1, Math.min(255, Math.round(128 + 40 * Math.log2(Math.max(ratio, 1e-3)))))

// ---- levels -----------------------------------------------------------------------
interface Level {
  name: string
  w: number
  h: number
  /** Longitude of the left edge, latitude of the top edge, degrees, and degrees per texel. */
  lon0: number
  lat0: number
  dLon: number
  dLat: number
  texelM: number
  heights?: string
  detail: string
}
const levels: Level[] = []
const gz = (name: string, buf: Uint8Array): number => {
  const z = zlib.gzipSync(buf, { level: 9 })
  fs.writeFileSync(path.join(OUT, name), z)
  return z.length
}
/** Grid in degrees of a raster whose top-left corner is at (x, y) metres in the source projection. */
const grid = (x: number, y: number, w: number, h: number, px: number) => ({
  lon0: lonOfX(x), lat0: latOfY(y), dLon: lonOfX(x + px) - lonOfX(x), dLat: -(latOfY(y) - latOfY(y - px)), w, h, texelM: px,
})
const bytes: Record<string, number> = {}

function writeHeights(name: string, x0: number, y0: number, w: number, h: number, step: number): void {
  // step: DTM texels per output texel (1 or 4). Box average.
  const out = new Uint16Array(w * h)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let acc = 0, cnt = 0
    for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) {
      const x = x0 + i * step + dx, y = y0 + j * step + dy
      if (x < DTM.w && y < DTM.h) { acc += dtm[y * DTM.w + x]; cnt++ }
    }
    out[j * w + i] = toHalf(acc / cnt - H0)
  }
  bytes[name] = gz(name, new Uint8Array(out.buffer))
}

function writeDetail(name: string, x0m: number, y0m: number, w: number, h: number, px: number): void {
  // x0m, y0m: top-left corner in the source projection (m); px: metres per output texel; box average of the ortho.
  const per = Math.max(1, Math.round(px / ORTHO.px))
  const out = new Uint8Array(w * h).fill(128)
  const ox0 = Math.round((x0m - ORTHO.x0) / ORTHO.px), oy0 = Math.round((ORTHO.y0 - y0m) / ORTHO.px)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let acc = 0, cnt = 0
    for (let dy = 0; dy < per; dy++) for (let dx = 0; dx < per; dx++) {
      const f = orthoFlat(ox0 + i * per + dx, oy0 + j * per + dy)
      if (f > 0) { acc += f; cnt++ }
    }
    if (cnt === 0) continue
    const avg = avgUnder(ox0 + i * per + per / 2, oy0 + j * per + per / 2)
    if (avg > 0) out[j * w + i] = encode(acc / cnt / avg)
  }
  bytes[name] = gz(name, out)
}

// L2: the whole DTM at 8 m.
{
  const x = DTM.x0, y = DTM.y0
  const g = grid(x, y, L2.w, L2.h, L2.px)
  writeHeights('L2.h.f16.gz', 0, 0, L2.w, L2.h, BLOCK)
  writeDetail('L2.r.u8.gz', x, y, L2.w, L2.h, L2.px)
  levels.push({ name: 'L2', ...g, heights: 'L2.h.f16.gz', detail: 'L2.r.u8.gz' })
}
// The site in DTM texels.
const siteX = R_M * Math.cos(STD_PARALLEL) * ((SITE.lon - 180) * Math.PI / 180)
const siteY = R_M * SITE.lat * Math.PI / 180
const siteI = Math.round((siteX - DTM.x0) / DTM.px), siteJ = Math.round((DTM.y0 - siteY) / DTM.px)
// L1: 2 m, the DTM's width, 4096 lines around the site.
{
  const h = 4096
  const j0 = Math.max(0, Math.min(DTM.h - h, siteJ - h / 2))
  const x = DTM.x0, y = DTM.y0 - j0 * DTM.px
  const g = grid(x, y, DTM.w, h, DTM.px)
  writeHeights('L1.h.f16.gz', 0, j0, DTM.w, h, 1)
  writeDetail('L1.r.u8.gz', x, y, DTM.w, h, DTM.px)
  levels.push({ name: 'L1', ...g, heights: 'L1.h.f16.gz', detail: 'L1.r.u8.gz' })
}
// L0: 0.5 m, 4096 square around the site (image only).
{
  const n = 4096
  const ci = Math.round((siteX - ORTHO.x0) / ORTHO.px), cj = Math.round((ORTHO.y0 - siteY) / ORTHO.px)
  const x = ORTHO.x0 + (ci - n / 2) * ORTHO.px, y = ORTHO.y0 - (cj - n / 2) * ORTHO.px
  const g = grid(x, y, n, n, ORTHO.px)
  writeDetail('L0.r.u8.gz', x, y, n, n, ORTHO.px)
  levels.push({ name: 'L0', ...g, detail: 'L0.r.u8.gz' })
}

// The ground height at the site (DTM, m from the 1737.4 km sphere): a 5 x 5 texel mean.
let gs = 0, gc = 0
for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { gs += dtm[(siteJ + dy) * DTM.w + siteI + dx]; gc++ }
const manifest = {
  version: 1,
  site: { name: 'Apollo 11 landing site', lat: SITE.lat, lon: SITE.lon, groundM: Math.round(gs / gc) },
  h0M: H0,
  heightRangeM: [Math.round(hMin), Math.round(hMax)],
  nodataShare: nodata / dtm.length,
  detailEncoding: 'ratio = 2^((byte - 128) / 40)',
  light: { time: SUN_TIME.toISOString(), sunElevationDeg: +(sunEl * 180 / Math.PI).toFixed(2), sunEastFromNorthDeg: +(Math.atan2(sunE, sunN) * 180 / Math.PI).toFixed(1) },
  levels: levels.map((l) => {
    const east = R_M * Math.cos(latR)
    const d = Math.PI / 180
    return {
      ...l,
      // Where the grid sits, in metres east and north of the site (a tangent plane at the site), so the shader
      // never subtracts two longitudes near 23.47 (float32 would give 0.65 m steps).
      eastM: east * (l.lon0 - SITE.lon) * d,
      northM: R_M * (l.lat0 - SITE.lat) * d,
      texelEastM: east * l.dLon * d,
      texelNorthM: R_M * Math.abs(l.dLat) * d,
    }
  }),
  bytes,
  credit: 'NASA/GSFC/Arizona State University',
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1))
console.log(JSON.stringify({ ...manifest, levels: levels.map((l) => ({ name: l.name, w: l.w, h: l.h, texelM: l.texelM })) }, null, 1))
