/**
 * Builds the Haase 25 cm tier ("L-1") for the Apollo 17 site patch: an image level at 0.25 m per texel around the
 * lunar module, plus the 1.5 m DTM under it in full float precision. Separate from build-patch.mts (it does not touch
 * that script's output; it reads that patch's manifest only for h0M and the site).
 *
 *   npx tsx scripts/build-haase-tier.mts --pkg <dir with the package's EXTRAS/GIS GeoTIFFs> --out <dir> \
 *        [--sun-az <deg from north, east positive> --sun-el <deg>] [--sun-time <ISO>] [--patch-manifest <a17 manifest.json>]
 *
 * Needs gdal_translate (GDAL) to cut two windows (the tier from the 25 cm image, the DTM around it) to raw rasters.
 *
 * Image encoding is the one of every other level: byte = 128 + 40 log2(ratio), ratio = photograph divided by the shading the
 * 1.5 m DTM gives it under the image's own Sun (build-patch's shadeWith, so the same lunar-Lommel-Seeliger blend), then by
 * its own 400 m average. It is a detail ratio, not albedo: the DTM only removes relief coarser than ~3 m, so craterlets,
 * boulders and their shadows stay in it. 128 = no data or ratio 1. The tier stays on the package's transverse Mercator grid
 * (no resampling, so the 25 cm pixels are untouched); the manifest fragment carries the grid's axes in the site tangent plane
 * (measured in this tangent-plane convention the axes are turned 0.011 deg, 0.3 m over the tier: 1 texel at the far corners if ignored).
 * Frame: the Haase products sit 12.7 m west and 7.2 m south of the existing a17 patch's L0/L1 (measured). --shift-east/--shift-north (metres, default 0)
 * move this tier's grid origin into the patch frame so it lies on top of L0/L1; the manifest records the shift and the unshifted origin.
 * Heights: float32 little endian, gzip, metres above the sphere minus h0M (the a17 patch's h0M), on the DTM's own 1.5 m grid
 * padded by 60 m; sample them bicubically (a bilinear 1.5 m field shows facets at a 0.25 m view).
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { ephemerisAt } from '../src/ephemeris'
import { Vector3 } from 'three'

const arg = (k: string): string | undefined => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined }
const CFG = JSON.parse(fs.readFileSync(new URL('./haase-a17.json', import.meta.url), 'utf8'))
const SHIFT_E = Number(arg('--shift-east') ?? 0), SHIFT_N = Number(arg('--shift-north') ?? 0)
const PKG = path.resolve(arg('--pkg') ?? '.'), OUT = path.resolve(arg('--out') ?? '.haase-tier')
fs.mkdirSync(OUT, { recursive: true })
const R_M = 1737400
const D2R = Math.PI / 180
const P25 = CFG.p25 as { file: string; w: number; h: number; x0: number; y0: number; px: number }
const DTM = CFG.dtm as { file: string; w: number; h: number; x0: number; y0: number; px: number }
const WIN = CFG.window as { col0: number; row0: number; n: number }
const N = WIN.n

// ---- spherical transverse Mercator (central meridian 30.7, k 1), the package CRS ----
const LON0 = 30.7
const tmInverse = (x: number, y: number): [number, number] => {
  const D = y / R_M, e = x / R_M
  return [Math.atan2(Math.sinh(e), Math.cos(D)) / D2R + LON0, Math.asin(Math.sin(D) / Math.cosh(e)) / D2R]
}

// ---- cut the windows ----
const cut = (name: string, src: string, args: string[]): string => {
  const out = path.join(OUT, name)
  if (!fs.existsSync(out)) {
    const r = spawnSync('gdal_translate', ['-q', '-of', 'ENVI', ...args, path.join(PKG, 'EXTRAS/GIS', src), out], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error(`gdal_translate failed for ${name}`)
  }
  return out
}
const imgFile = cut('p25.raw', P25.file, ['-srcwin', String(WIN.col0), String(WIN.row0), String(N), String(N)])
const img = new Uint8Array(fs.readFileSync(imgFile).buffer.slice(0))
if (img.length !== N * N) throw new Error('window size mismatch')
// tier pixel (i, j) centre in TM metres
const tx0 = P25.x0 + WIN.col0 * P25.px, ty0 = P25.y0 - WIN.row0 * P25.px
const PAD = 60
const dc0 = Math.floor((tx0 - PAD - DTM.x0) / DTM.px), dr0 = Math.floor((DTM.y0 - (ty0 + PAD)) / DTM.px)
const dc1 = Math.ceil((tx0 + N * P25.px + PAD - DTM.x0) / DTM.px), dr1 = Math.ceil((DTM.y0 - (ty0 - N * P25.px - PAD)) / DTM.px)
const DW = dc1 - dc0, DH = dr1 - dr0
const dtmFile = cut('dtm.raw', DTM.file, ['-srcwin', String(dc0), String(dr0), String(DW), String(DH)])
const dtmBuf = fs.readFileSync(dtmFile)
const dtm = new Float32Array(dtmBuf.buffer.slice(dtmBuf.byteOffset, dtmBuf.byteOffset + DW * DH * 4))
const isNoData = (v: number): boolean => !(v > -1e6)
let dtmNoData = 0
{ // holes take the mean of the valid 3 x 3 neighbours, repeatedly (few, small)
  for (let pass = 0; pass < 20; pass++) {
    let left = 0
    const copy = Float32Array.from(dtm)
    for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) {
      if (!isNoData(copy[y * DW + x])) continue
      if (pass === 0) dtmNoData++
      let a = 0, c = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < DW && yy < DH && !isNoData(copy[yy * DW + xx])) { a += copy[yy * DW + xx]; c++ } }
      if (c) dtm[y * DW + x] = a / c; else left++
    }
    if (!left) break
  }
}

// ---- the Sun ----
const SITE = { lat: CFG.lm.lat as number, lon: CFG.lm.lon as number }
const lonR = SITE.lon * D2R, latR = SITE.lat * D2R
const lunarL = (a: number): number => Math.max(0, 1 - 0.019 * a + 2.42e-4 * a * a - 1.46e-6 * a * a * a)
function shadeWith(sunE: number, sunN: number, sunU: number, L: number, nx: number, ny: number, nz: number): number {
  const mu0 = Math.max(0, nx * sunE + ny * sunN + nz * sunU)
  const mu = Math.max(1e-3, nz)
  return 2 * L * mu0 / (mu0 + mu + 1e-5) + (1 - L) * mu0
}
let sunE: number, sunN: number, sunU: number, sunLabel: string
{
  const az = arg('--sun-az'), el = arg('--sun-el')
  if (az !== undefined && el !== undefined) {
    const a = Number(az) * D2R, e = Number(el) * D2R
    sunE = Math.sin(a) * Math.cos(e); sunN = Math.cos(a) * Math.cos(e); sunU = Math.sin(e); sunLabel = `override az ${az} el ${el}`
  } else {
    const A = CFG.sun.anchor
    const time = new Date(arg('--sun-time') ?? new Date(new Date(A.utc).getTime() + (CFG.sun.sclkM - A.m) * 1000).toISOString())
    const e = ephemerisAt(time)
    const up = new Vector3(Math.cos(latR) * Math.cos(lonR), Math.cos(latR) * Math.sin(lonR), Math.sin(latR)).applyMatrix3(e.moonToWorld)
    const east = new Vector3(-Math.sin(lonR), Math.cos(lonR), 0).applyMatrix3(e.moonToWorld)
    const north = new Vector3(-Math.sin(latR) * Math.cos(lonR), -Math.sin(latR) * Math.sin(lonR), Math.cos(latR)).applyMatrix3(e.moonToWorld)
    sunE = e.sunDir.dot(east); sunN = e.sunDir.dot(north); sunU = e.sunDir.dot(up); sunLabel = `ephemeris ${time.toISOString()}`
  }
}
const sunElDeg = Math.asin(sunU) / D2R, sunAzDeg = Math.atan2(sunE, sunN) / D2R
const L = lunarL(90 - sunElDeg)
const S0 = shadeWith(sunE, sunN, sunU, L, 0, 0, 1)
console.log('sun', sunLabel, 'el', sunElDeg.toFixed(2), 'az from north', sunAzDeg.toFixed(1))

// ---- DTM slopes at the nodes (central differences), bilinear to the tier texel ----
const sxN = new Float32Array(DW * DH), syN = new Float32Array(DW * DH)
for (let y = 1; y < DH - 1; y++) for (let x = 1; x < DW - 1; x++) {
  const i = y * DW + x
  sxN[i] = (dtm[i + 1] - dtm[i - 1]) / (2 * DTM.px); syN[i] = (dtm[i - DW] - dtm[i + DW]) / (2 * DTM.px)
}
function slopeAt(fx: number, fy: number): [number, number] {
  const x = Math.max(1, Math.min(DW - 3, Math.floor(fx))), y = Math.max(1, Math.min(DH - 3, Math.floor(fy)))
  const tx = Math.max(0, Math.min(1, fx - x)), ty = Math.max(0, Math.min(1, fy - y))
  const i = y * DW + x
  const bl = (a: Float32Array): number => (a[i] * (1 - tx) + a[i + 1] * tx) * (1 - ty) + (a[i + DW] * (1 - tx) + a[i + DW + 1] * tx) * ty
  return [bl(sxN), bl(syN)]
}
// ---- flatten ----
const flat = new Float32Array(N * N), ok = new Uint8Array(N * N)
const clampMin = CFG.flattenClampMin as number
let nValid = 0
for (let j = 0; j < N; j++) {
  const yM = ty0 - (j + 0.5) * P25.px
  for (let i = 0; i < N; i++) {
    const v = img[j * N + i]
    if (v === 0) continue
    const xM = tx0 + (i + 0.5) * P25.px
    const [sx, sy] = slopeAt((xM - DTM.x0) / DTM.px - 0.5 - dc0, (DTM.y0 - yM) / DTM.px - 0.5 - dr0)
    const inv = 1 / Math.hypot(sx, sy, 1)
    const s = shadeWith(sunE, sunN, sunU, L, -sx * inv, -sy * inv, inv) / S0
    flat[j * N + i] = v / Math.max(clampMin, s); ok[j * N + i] = 1; nValid++
  }
}
// 400 m box average, on a 1 m grid of block means so the box filter is cheap
const BLK = Math.round(1 / P25.px), NB = Math.floor(N / BLK)
const bs = new Float32Array(NB * NB), bo = new Uint8Array(NB * NB)
for (let bj = 0; bj < NB; bj++) for (let bi = 0; bi < NB; bi++) {
  let a = 0, c = 0
  for (let dy = 0; dy < BLK; dy++) for (let dx = 0; dx < BLK; dx++) { const k = (bj * BLK + dy) * N + bi * BLK + dx; if (ok[k]) { a += flat[k]; c++ } }
  if (c > BLK * BLK / 2) { bs[bj * NB + bi] = a / c; bo[bj * NB + bi] = 1 }
}
function boxAverage(v: Float32Array, m: Uint8Array, w: number, h: number, r: number): Float32Array {
  const sumX = new Float64Array(w * h), cntX = new Float64Array(w * h)
  for (let y = 0; y < h; y++) {
    let s = 0, c = 0
    for (let x = -r; x < w; x++) {
      const add = x + r, sub = x - r - 1
      if (add < w && add >= 0 && m[y * w + add]) { s += v[y * w + add]; c++ }
      if (sub >= 0 && m[y * w + sub]) { s -= v[y * w + sub]; c-- }
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
const avgB = boxAverage(bs, bo, NB, NB, Math.round(CFG.avgRadiusM))
const avgUnder = (i: number, j: number): number => {
  const fx = (i + 0.5) / BLK - 0.5, fy = (j + 0.5) / BLK - 0.5
  const x0 = Math.max(0, Math.min(NB - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(NB - 2, Math.floor(fy)))
  const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0))
  const a = avgB[y0 * NB + x0], b = avgB[y0 * NB + x0 + 1], c = avgB[(y0 + 1) * NB + x0], d = avgB[(y0 + 1) * NB + x0 + 1]
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
}
const encode = (ratio: number): number => Math.max(1, Math.min(255, Math.round(128 + 40 * Math.log2(Math.max(ratio, 1e-3)))))
const detail = new Uint8Array(N * N).fill(128)
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const k = j * N + i
  if (!ok[k]) continue
  const avg = avgUnder(i, j)
  if (avg > 0) detail[k] = encode(flat[k] / avg)
}
const bytes: Record<string, number> = {}
const gz = (name: string, buf: Uint8Array): void => { const z = zlib.gzipSync(buf, { level: 9 }); fs.writeFileSync(path.join(OUT, name), z); bytes[name] = z.length }
gz('Lm1.r.u8.gz', detail)
// The lunar module is filled out of the tier as a step of this build (the raw tier is kept beside it; a stale raw from an earlier build is dropped first).
// The disc is the Haase control point's tier texel, so it applies only to the Apollo 17 tier.
if (arg('--no-mask') === undefined) {
  fs.rmSync(path.join(OUT, 'Lm1.r.raw.u8.gz'), { force: true })
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.resolve(path.dirname(new URL(import.meta.url).pathname), 'mask-tier-lm.mts'), '--dir', OUT], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('the lunar module mask step failed')
}

// ---- heights: float32, minus h0M, the DTM's own grid ----
const patchManifestPath = arg('--patch-manifest')
const H0 = patchManifestPath ? (JSON.parse(fs.readFileSync(patchManifestPath, 'utf8')).h0M as number) : (CFG.h0M as number)
const hOut = new Float32Array(DW * DH)
for (let k = 0; k < hOut.length; k++) hOut[k] = dtm[k] - H0
gz('Lm1.h.f32.gz', new Uint8Array(hOut.buffer))

// ---- manifest fragment: grid axes in the site tangent plane (same convention as build-patch: metres east/north of the site) ----
// Tangent plane origin: the a17 patch's own site point (its manifest), so eastM/northM mean what they mean there; the Haase LM is not that point.
const TS = patchManifestPath ? (JSON.parse(fs.readFileSync(patchManifestPath, 'utf8')).site as { lat: number; lon: number }) : SITE
const tsLatR = TS.lat * D2R
const tangent = (lon: number, lat: number): [number, number] => [R_M * Math.cos(tsLatR) * (lon - TS.lon) * D2R, R_M * (lat - TS.lat) * D2R]
const gridInfo = (x0: number, y0: number, px: number) => {
  const c = tangent(...tmInverse(x0, y0)), ex = tangent(...tmInverse(x0 + px, y0)), sy = tangent(...tmInverse(x0, y0 - px))
  const [lon0, lat0] = tmInverse(x0, y0)
  return { lon0: lon0 + SHIFT_E / (R_M * Math.cos(tsLatR) * D2R), lat0: lat0 + SHIFT_N / (R_M * D2R), eastM: c[0] + SHIFT_E, northM: c[1] + SHIFT_N, haaseFrameEastM: c[0], haaseFrameNorthM: c[1], axisEastPerTexelM: [ex[0] - c[0], ex[1] - c[1]], axisSouthPerTexelM: [sy[0] - c[0], sy[1] - c[1]], rotationDeg: Math.atan2(ex[1] - c[1], ex[0] - c[0]) / D2R }
}
const lmT = tangent(CFG.lm.lon, CFG.lm.lat)
const lmTShift: [number, number] = [lmT[0] + SHIFT_E, lmT[1] + SHIFT_N]
const fragment = {
  version: 1,
  note: 'optional level L-1; add to a17 manifest.levels (finest first in sampling order) when present',
  tangentPlaneOriginLonLat: [TS.lon, TS.lat],
  site: 'eastM/northM are metres east/north of tangentPlaneOriginLonLat (the a17 manifest site point), like the other levels',
  siteLmLonLat: [CFG.lm.lon, CFG.lm.lat],
  detailEncoding: 'ratio = 2^((byte - 128) / 40)',
  level: {
    name: 'L-1', w: N, h: N, texelM: P25.px, ...gridInfo(tx0, ty0, P25.px),
    detail: 'Lm1.r.u8.gz', detailBytes: bytes['Lm1.r.u8.gz'],
    tmOriginXY: [tx0, ty0], crs: 'package TM: transverse Mercator, central meridian 30.7, k 1, false easting 0, sphere 1737400 m',
    effectiveResolutionNote: 'native pixels 27 cm across track x 56 cm along track (LROC post 379), resampled to 25 cm; the along-track axis is roughly north-south',
  },
  heights: {
    file: 'Lm1.h.f32.gz', encoding: 'float32 little endian, row major from the top-left, metres above the 1737.4 km sphere minus h0M', h0M: H0, bytes: bytes['Lm1.h.f32.gz'],
    w: DW, h: DH, texelM: DTM.px, tmOriginXY: [DTM.x0 + dc0 * DTM.px, DTM.y0 - dr0 * DTM.px], ...gridInfo(DTM.x0 + dc0 * DTM.px, DTM.y0 - dr0 * DTM.px, DTM.px), holesFilled: dtmNoData, sample: 'bicubic (Catmull-Rom); source is a 1.5 m DTM',
  },
  frameShiftEastNorthM: [SHIFT_E, SHIFT_N],
  lmTier: { col: (CFG.lm.tmX - tx0) / P25.px, row: (ty0 - CFG.lm.tmY) / P25.px, tangentEastNorthM_haaseFrame: lmT, tangentEastNorthM_inShiftedFrame: lmTShift },
  sun: { label: sunLabel, elDeg: +sunElDeg.toFixed(2), azFromNorthDeg: +sunAzDeg.toFixed(1) },
  flattening: { clampMin: clampMin, avgRadiusM: CFG.avgRadiusM, reliefScaleRemovedM: '>= ~3 (1.5 m DTM)' },
  validShare: nValid / (N * N),
  credit: CFG.credit,
}
fs.writeFileSync(path.join(OUT, 'haase-tier.manifest.json'), JSON.stringify(fragment, null, 1))
console.log(JSON.stringify({ ...fragment, level: { ...fragment.level, axisSouthPerTexelM: undefined } }, null, 1))
