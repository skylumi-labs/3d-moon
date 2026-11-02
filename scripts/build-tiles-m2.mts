#!/usr/bin/env -S npx tsx
/**
 * Milestone 2 tile builder (DESIGN-M2.md section 4).
 *
 *   npx tsx scripts/build-tiles-m2.mts --src <dir> --out <dir> [--region lon0,lon1,lat0,lat1] [--levels 0,1,2]
 *
 * <dir> holds two rasters, both whole-globe equirectangular, longitude -180 at
 * the left edge, north up (NASA SVS 4720, public domain):
 *   ldem64.raw       LOLA ldem_64_uint.tif as raw little-endian uint16, 23040 x 11520;
 *                    height (m) = (v - 20000) / 2 above the 1737.4 km sphere
 *   color_full.tif   lroc_color_poles.tif (27360 x 13680, RGB)
 * (`gdal_translate -of ENVI ldem_64_uint.tif ldem64.raw` makes the first.)
 *
 * Writes <out>/manifest.json, <out>/h/<level>/<tx>_<ty>.bin.gz (heights, codec.ts)
 * and <out>/c/<level>/<tx>_<ty>.webp (colour, WebP q80). With --region only the
 * level-0 tiles that touch the box are written; levels 1 and 2 are always the
 * whole globe. The output is NOT for the repository: keep it in a scratch
 * directory and host it (DESIGN-M2.md, section 5).
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { encodeHeightPlanes, decodeHeightPlanes } from '../src/moon/tiles/codec'
import {
  BORDER, C_PX, C_SIZE, C_TEXEL_KM, H_PX, H_SIZE, H_STEP_M, H_TEXEL_KM, L0_DEG, TILE_LEVELS,
  colorPath, heightPath, levelNx, levelNy, tileIndex, type TileManifest,
} from '../src/moon/tiles/grid'

const sharp = createRequire(import.meta.url)('sharp') as typeof import('sharp')
sharp.concurrency(2)

const arg = (k: string, d?: string): string | undefined => {
  const i = process.argv.indexOf(`--${k}`)
  return i >= 0 ? process.argv[i + 1] : d
}
const SRC = arg('src')
const OUT = arg('out')
if (!SRC || !OUT) throw new Error('usage: --src <dir> --out <dir> [--region lon0,lon1,lat0,lat1] [--levels 0,1,2]')
const LEVELS = (arg('levels', '0,1,2') as string).split(',').map(Number)
const region = arg('region')?.split(',').map(Number)
if (region && (region.length !== 4 || region.some((v) => !Number.isFinite(v)))) throw new Error('--region lon0,lon1,lat0,lat1')

const HW = 360 * (H_PX / L0_DEG), HH = 180 * (H_PX / L0_DEG)
const CW = 360 * (C_PX / L0_DEG), CH = 180 * (C_PX / L0_DEG)
const t0 = Date.now()
const log = (s: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`)

const wrapX = (x: number, w: number): number => ((x % w) + w) % w
const clampY = (y: number, h: number): number => Math.max(0, Math.min(h - 1, y))

/** Does the level-0 tile (tx, ty) touch the --region box? */
function wanted(level: number, tx: number, ty: number): boolean {
  if (level > 0 || !region) return true
  const [lon0, lon1, lat0, lat1] = region
  const d = L0_DEG
  const tl0 = -180 + tx * d, tl1 = tl0 + d
  const tb1 = 90 - ty * d, tb0 = tb1 - d
  return tl1 > lon0 && tl0 < lon1 && tb1 > lat0 && tb0 < lat1
}

// ---------------------------------------------------------------- heights
log('reading heights')
const rawH = fs.readFileSync(path.join(SRC, 'ldem64.raw'))
if (rawH.length !== HW * HH * 2) throw new Error(`ldem64.raw is ${rawH.length} bytes, expected ${HW * HH * 2}`)
const u16 = new Uint16Array(rawH.buffer, rawH.byteOffset, HW * HH)
/** Heights in metres per level: level 0 reads the u16 grid, coarser ones are box means. */
interface HRaster { w: number; h: number; at(x: number, y: number): number }
const hr: HRaster[] = [{ w: HW, h: HH, at: (x, y) => (u16[y * HW + x] - 20000) * 0.5 }]
for (let l = 1; l < TILE_LEVELS; l++) {
  if (!LEVELS.includes(l)) { hr.push(hr[l - 1]); continue }
  const p = hr[l - 1], w = p.w >> 1, h = p.h >> 1
  const a = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = (p.at(2 * x, 2 * y) + p.at(2 * x + 1, 2 * y) + p.at(2 * x, 2 * y + 1) + p.at(2 * x + 1, 2 * y + 1)) / 4
  hr.push({ w, h, at: (x, y) => a[y * w + x] })
  log(`height level ${l} raster ${w} x ${h}`)
}

function cutHeights(level: number, tx: number, ty: number): { q: Int32Array; minQ: number; maxQ: number } {
  const r = hr[level]
  const q = new Int32Array(H_SIZE * H_SIZE)
  let minQ = Infinity, maxQ = -Infinity
  for (let j = 0; j < H_SIZE; j++) {
    const y = clampY(ty * H_PX + j - BORDER, r.h)
    for (let i = 0; i < H_SIZE; i++) {
      const x = wrapX(tx * H_PX + i - BORDER, r.w)
      const v = Math.round(r.at(x, y) / H_STEP_M)
      q[j * H_SIZE + i] = v
      if (j >= BORDER && j < H_SIZE - BORDER && i >= BORDER && i < H_SIZE - BORDER) { if (v < minQ) minQ = v; if (v > maxQ) maxQ = v }
    }
  }
  return { q, minQ, maxQ }
}

// ------------------------------------------------------------------ output
const present: string[][] = [], minQ: number[][] = [], maxQ: number[][] = []
for (let l = 0; l < TILE_LEVELS; l++) {
  const n = levelNx(l) * levelNy(l)
  present.push(Array(n).fill('0')); minQ.push(Array(n).fill(0)); maxQ.push(Array(n).fill(0))
}
let bytesH = 0, bytesC = 0, nH = 0, nC = 0
const perLevel = Array.from({ length: TILE_LEVELS }, () => ({ h: 0, c: 0, nh: 0, nc: 0 }))
for (const l of LEVELS) for (const s of ['h', 'c']) fs.mkdirSync(path.join(OUT, s, String(l)), { recursive: true })

function writeHeights(level: number, tx: number, ty: number): void {
  const { q, minQ: lo, maxQ: hi } = cutHeights(level, tx, ty)
  const gz = zlib.gzipSync(Buffer.from(encodeHeightPlanes(q)), { level: 9 })
  // Self-check: what the browser will read is what was cut.
  const back = decodeHeightPlanes(new Uint8Array(zlib.gunzipSync(gz)))
  for (let i = 0; i < q.length; i++) if (back[i] !== q[i]) throw new Error(`round-trip mismatch in L${level} ${tx}_${ty}`)
  fs.writeFileSync(path.join(OUT, heightPath(level, tx, ty)), gz)
  const k = tileIndex(level, tx, ty)
  minQ[level][k] = lo; maxQ[level][k] = hi
  bytesH += gz.length; nH++; perLevel[level].h += gz.length; perLevel[level].nh++
}

for (const l of LEVELS) {
  for (let ty = 0; ty < levelNy(l); ty++) for (let tx = 0; tx < levelNx(l); tx++) if (wanted(l, tx, ty)) writeHeights(l, tx, ty)
  log(`heights level ${l}: ${perLevel[l].nh} tiles, ${(perLevel[l].h / 1e6).toFixed(1)} MB`)
}

// ------------------------------------------------------------------ colour
const s2l = new Float32Array(256)
for (let i = 0; i < 256; i++) { const x = i / 255; s2l[i] = x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
const l2s = new Uint8Array(4097)
for (let i = 0; i <= 4096; i++) { const x = i / 4096; l2s[i] = Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)) }
/** 2x2 mean in linear light of an RGB raster. */
function halve(src: Uint8Array, w: number, h: number, dst: Uint8Array, dstRow0: number): void {
  const ow = w >> 1
  for (let y = 0; y < h >> 1; y++) for (let x = 0; x < ow; x++) for (let c = 0; c < 3; c++) {
    const i0 = ((2 * y) * w + 2 * x) * 3 + c, i1 = i0 + 3, i2 = i0 + w * 3, i3 = i2 + 3
    const m = (s2l[src[i0]] + s2l[src[i1]] + s2l[src[i2]] + s2l[src[i3]]) * 0.25
    dst[((dstRow0 + y) * ow + x) * 3 + c] = l2s[Math.round(m * 4096)]
  }
}

async function writeColor(level: number, tx: number, ty: number, pix: Uint8Array): Promise<void> {
  const webp = await sharp(pix, { raw: { width: C_SIZE, height: C_SIZE, channels: 3 } }).webp({ quality: 80, effort: 4 }).toBuffer()
  fs.writeFileSync(path.join(OUT, colorPath(level, tx, ty)), webp)
  present[level][tileIndex(level, tx, ty)] = '1'
  bytesC += webp.length; nC++; perLevel[level].c += webp.length; perLevel[level].nc++
}

/** A tile from a raster with wrap and clamp, border included. */
function cutColor(r: { w: number; h: number; row: (y: number) => Uint8Array; rowOffset?: number }, tx: number, ty: number): Uint8Array {
  const out = new Uint8Array(C_SIZE * C_SIZE * 3)
  for (let j = 0; j < C_SIZE; j++) {
    const row = r.row(clampY(ty * C_PX + j - BORDER, r.h))
    for (let i = 0; i < C_SIZE; i++) {
      const x = wrapX(tx * C_PX + i - BORDER, r.w)
      out[(j * C_SIZE + i) * 3] = row[x * 3]; out[(j * C_SIZE + i) * 3 + 1] = row[x * 3 + 1]; out[(j * C_SIZE + i) * 3 + 2] = row[x * 3 + 2]
    }
  }
  return out
}

const needCoarse = LEVELS.some((l) => l > 0)
const cr: (Uint8Array | null)[] = [null, needCoarse ? new Uint8Array((CW >> 1) * (CH >> 1) * 3) : null, null]
if (LEVELS.includes(0) || needCoarse) {
  for (let ty = 0; ty < levelNy(0); ty++) {
    const wantRow = LEVELS.includes(0) && Array.from({ length: levelNx(0) }, (_, tx) => wanted(0, tx, ty)).some(Boolean)
    if (!wantRow && !needCoarse) continue
    const top = Math.max(0, ty * C_PX - BORDER), bot = Math.min(CH, ty * C_PX + C_PX + BORDER)
    const band = await sharp(path.join(SRC, 'color_full.tif'), { limitInputPixels: false })
      .extract({ left: 0, top, width: CW, height: bot - top }).removeAlpha().raw().toBuffer()
    const bandRows = bot - top
    const row = (y: number): Uint8Array => band.subarray((y - top) * CW * 3, (y - top + 1) * CW * 3)
    if (wantRow) {
      const jobs: Promise<void>[] = []
      for (let tx = 0; tx < levelNx(0); tx++) if (wanted(0, tx, ty)) jobs.push(writeColor(0, tx, ty, cutColor({ w: CW, h: CH, row }, tx, ty)))
      await Promise.all(jobs)
    }
    if (needCoarse) {
      // The band's interior rows (the border rows are the neighbours').
      const first = ty * C_PX - top
      halve(band.subarray(first * CW * 3, (first + C_PX) * CW * 3), CW, C_PX, cr[1] as Uint8Array, ty * (C_PX >> 1))
    }
    void bandRows
    log(`colour row ${ty + 1}/${levelNy(0)}: ${nC} tiles, ${(bytesC / 1e6).toFixed(1)} MB`)
  }
}
if (LEVELS.includes(1) || LEVELS.includes(2)) {
  const l1 = cr[1] as Uint8Array
  const w1 = CW >> 1, h1 = CH >> 1
  if (LEVELS.includes(2)) { cr[2] = new Uint8Array((w1 >> 1) * (h1 >> 1) * 3); halve(l1, w1, h1, cr[2] as Uint8Array, 0) }
  for (const l of [1, 2]) {
    if (!LEVELS.includes(l)) continue
    const data = cr[l] as Uint8Array
    const w = CW >> l, h = CH >> l
    const r = { w, h, row: (y: number) => data.subarray(y * w * 3, (y + 1) * w * 3) }
    for (let ty = 0; ty < levelNy(l); ty++) {
      const jobs: Promise<void>[] = []
      for (let tx = 0; tx < levelNx(l); tx++) jobs.push(writeColor(l, tx, ty, cutColor(r, tx, ty)))
      await Promise.all(jobs)
    }
    log(`colour level ${l}: ${perLevel[l].nc} tiles, ${(perLevel[l].c / 1e6).toFixed(1)} MB`)
  }
}

// ---------------------------------------------------------------- manifest
for (const l of LEVELS) {
  for (let k = 0; k < present[l].length; k++) {
    const tx = k % levelNx(l), ty = Math.floor(k / levelNx(l))
    // A tile is present only if both its files were written.
    if (present[l][k] === '1' && !fs.existsSync(path.join(OUT, heightPath(l, tx, ty)))) present[l][k] = '0'
  }
}
const manifest: TileManifest = {
  version: 1, tileDeg: L0_DEG, levels: TILE_LEVELS,
  height: { px: H_PX, border: BORDER, stepM: H_STEP_M, ppd: H_PX / L0_DEG, texelKm: +H_TEXEL_KM.toFixed(4) },
  color: { px: C_PX, border: BORDER, ppd: C_PX / L0_DEG, texelKm: +C_TEXEL_KM.toFixed(4) },
  present: present.map((p) => p.join('')),
  minQ, maxQ,
  source: 'NASA SVS 4720 (public domain): LOLA ldem_64 heights, LROC WAC Hapke-normalised colour (lroc_color_poles)',
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest))
const summary = {
  region: region ?? 'globe', levels: LEVELS,
  heightTiles: nH, colourTiles: nC, heightMB: +(bytesH / 1e6).toFixed(1), colourMB: +(bytesC / 1e6).toFixed(1),
  perLevel, manifestKB: +(fs.statSync(path.join(OUT, 'manifest.json')).size / 1e3).toFixed(1), seconds: Math.round((Date.now() - t0) / 1000),
}
fs.writeFileSync(path.join(OUT, 'build-summary.json'), JSON.stringify(summary, null, 1))
console.log(JSON.stringify(summary, null, 1))
