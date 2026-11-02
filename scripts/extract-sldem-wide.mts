/**
 * Produces the `<site>.wide-source.json` + `<site>.wide-effective-metres.f32` pairs that build-wide-height.mts
 * consumes, straight from the PDS SLDEM2015 512 ppd FLOAT tiles. Local-only: reads tiles by row seek (never whole),
 * uploads nothing, and the outputs are build inputs, never committed.
 *
 * Contract (build-wide-height.mts `at()`): file row r covers latitude 30 - (r+.5)/512, file column c covers
 * longitude (c+.5)/512 (pixel registered, both measured from the 30N / 0E tile-grid origin, so a southern tile
 * continues the same row numbering). A stride-1 raster is the native crop. A stride-2 raster takes every second
 * row (centre +.5) and the 2-pixel horizontal mean (centre +1.0): effective ~120 m.
 * Heights leave here as float32 metres above the 1737.4 km reference sphere (label: UNIT KILOMETER, OFFSET is the
 * sphere radius and is NOT added).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const PPD = 512, R = 1737400, EXTENT_M = 148000, GRID_TOP_LAT = 30, PAD_PX = 8, MAX_ABS_M = 12000
export const SITE_PLAN: Record<string, { lat: number, lon: number, stride: 1 | 2 }> = {
  a11: { lat: 0.6741, lon: 23.4730, stride: 1 }, a17: { lat: 20.1911, lon: 30.7723, stride: 1 },  // stride 2 (118 m) was the first live build; 2026-10-21 rebuild at the native 59 m
}

/** `--sites a17,a11` -> the sites to build; empty means every planned site. Throws on an unknown name. */
export function parseSites(arg: string): string[] {
  const names = arg.split(',').map(x => x.trim()).filter(Boolean)
  for (const n of names) if (!(n in SITE_PLAN)) throw new Error('Unknown site ' + n)
  return names.length ? names : Object.keys(SITE_PLAN)
}

export interface SldemLabel {
  productId: string, lines: number, samples: number, littleEndian: boolean, scale: number, unitToMetres: number,
  missing: number | null, maxLat: number, minLat: number, westLon: number, eastLon: number,
  /** global tile-grid row/column of this tile's first pixel (row 0 = latitude 30N) */
  row0: number, col0: number,
}

const rawValue = (text: string, key: string, required = true): string | null => {
  const m = text.match(new RegExp('^[ \\t]*' + key + '[ \\t]*=[ \\t]*(.+)$', 'm'))
  if (!m) { if (required) throw new Error(`Label missing ${key}`); return null }
  return m[1].replace(/<[^>]*>/g, '').replace(/\/\*.*$/, '').trim().replace(/^["']|["']$/g, '')
}
const num = (text: string, key: string): number => {
  const v = Number(rawValue(text, key)); if (!Number.isFinite(v)) throw new Error(`Label ${key} is not numeric`); return v
}

/** Parses and VALIDATES a PDS3 SLDEM2015 label; throws on anything the extraction would silently mis-register. */
export function parseLabel(text: string): SldemLabel {
  const type = rawValue(text, 'SAMPLE_TYPE')!, bits = num(text, 'SAMPLE_BITS')
  if (bits !== 32) throw new Error('Expected 32-bit samples')
  const littleEndian = /^(PC_REAL|LSB_IEEE_REAL)$/.test(type)
  if (!littleEndian && !/^(MSB_IEEE_REAL|IEEE_REAL|SUN_REAL|MAC_REAL)$/.test(type)) throw new Error('Unsupported SAMPLE_TYPE ' + type)
  const unit = rawValue(text, 'UNIT')!.toUpperCase()
  if (unit !== 'KILOMETER' && unit !== 'METER') throw new Error('Unsupported UNIT ' + unit)
  const lines = num(text, 'LINES'), samples = num(text, 'LINE_SAMPLES'), res = num(text, 'MAP_RESOLUTION')
  if (res !== PPD) throw new Error('Only the 512 ppd product is supported')
  if (num(text, 'OFFSET') !== 1737.4 || num(text, 'A_AXIS_RADIUS') !== 1737.4) throw new Error('Reference sphere is not 1737.4 km')
  if (rawValue(text, 'MAP_PROJECTION_TYPE')!.toUpperCase() !== 'SIMPLE CYLINDRICAL') throw new Error('Not a simple cylindrical map')
  if (num(text, 'RECORD_BYTES') !== samples * 4 || num(text, 'FILE_RECORDS') !== lines) throw new Error('Record layout does not match LINES/LINE_SAMPLES')
  const maxLat = num(text, 'MAXIMUM_LATITUDE'), minLat = num(text, 'MINIMUM_LATITUDE')
  const westLon = num(text, 'WESTERNMOST_LONGITUDE'), eastLon = num(text, 'EASTERNMOST_LONGITUDE')
  if ((maxLat - minLat) * PPD !== lines || (eastLon - westLon) * PPD !== samples) throw new Error('Bounds do not match LINES/LINE_SAMPLES')
  // Pixel registration: the first pixel centre sits half a pixel inside the tile edge.
  if (num(text, 'LINE_PROJECTION_OFFSET') !== maxLat * PPD - .5) throw new Error('Unexpected LINE_PROJECTION_OFFSET (not pixel registered)')
  if (num(text, 'SAMPLE_PROJECTION_OFFSET') !== (num(text, 'CENTER_LONGITUDE') - westLon) * PPD - .5) throw new Error('Unexpected SAMPLE_PROJECTION_OFFSET (not pixel registered)')
  const missing = rawValue(text, 'MISSING_CONSTANT', false)
  const row0 = (GRID_TOP_LAT - maxLat) * PPD, col0 = westLon * PPD
  if (!Number.isInteger(row0) || !Number.isInteger(col0)) throw new Error('Tile is not aligned to the 512 ppd grid')
  return { productId: rawValue(text, 'PRODUCT_ID')!, lines, samples, littleEndian, scale: num(text, 'SCALING_FACTOR'), unitToMetres: unit === 'KILOMETER' ? 1000 : 1,
    missing: missing === null ? null : Number(missing.replace(/^16#([0-9A-Fa-f]+)#$/, (_, h) => String(new Float32Array(new Uint32Array([parseInt(h, 16)]).buffer)[0]))),
    maxLat, minLat, westLon, eastLon, row0, col0 }
}

export interface Tile { label: SldemLabel, imgPath: string }
export const openTile = (imgPath: string, labelPath?: string): Tile => {
  const base = imgPath.replace(/\.img$/i, '')
  const lbl = labelPath ?? [base + '.LBL', base + '.lbl'].find(p => fs.existsSync(p))
  if (!lbl) throw new Error('No .LBL beside ' + imgPath)
  const label = parseLabel(fs.readFileSync(lbl, 'utf8'))
  if (fs.statSync(imgPath).size !== label.lines * label.samples * 4) throw new Error(`${imgPath}: size does not match the label (truncated download?)`)
  return { label, imgPath }
}

/** Tangent-plane square's lat/lon extremes (same projection as build-wide-height), degrees. */
export function footprint(latDeg: number, lonDeg: number, extentM = EXTENT_M) {
  const lat0 = latDeg * Math.PI / 180, lon0 = lonDeg * Math.PI / 180
  const S = [Math.cos(lat0) * Math.cos(lon0), Math.cos(lat0) * Math.sin(lon0), Math.sin(lat0)]
  const E = [-Math.sin(lon0), Math.cos(lon0), 0], N = [-Math.sin(lat0) * Math.cos(lon0), -Math.sin(lat0) * Math.sin(lon0), Math.cos(lat0)]
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity
  const K = 512
  for (let a = 0; a <= K; a++) for (const [u, w] of [[a / K, 0], [a / K, 1], [0, a / K], [1, a / K]]) {
    const e = (-extentM / 2 + u * extentM) / R, north = (extentM / 2 - w * extentM) / R, radial = Math.sqrt(1 - e * e - north * north)
    const v = S.map((s, k) => s * radial + E[k] * e + N[k] * north)
    const lon = Math.atan2(v[1], v[0]) * 180 / Math.PI, lat = Math.asin(v[2]) * 180 / Math.PI
    latMin = Math.min(latMin, lat); latMax = Math.max(latMax, lat); lonMin = Math.min(lonMin, lon); lonMax = Math.max(lonMax, lon)
  }
  return { latMin, latMax, lonMin, lonMax }
}

export interface CropPlan { column: number, rowNorthGrid: number, width: number, height: number, stride: 1 | 2 }
export function planCrop(site: string): CropPlan {
  const { lat, lon, stride } = SITE_PLAN[site], f = footprint(lat, lon), pad = PAD_PX * stride
  const rowNorthGrid = Math.floor((GRID_TOP_LAT - f.latMax) * PPD) - pad
  const rowLast = Math.ceil((GRID_TOP_LAT - f.latMin) * PPD) + pad
  let column = Math.floor(f.lonMin * PPD) - pad
  if (stride === 2) column -= ((column % 2) + 2) % 2
  const colLast = Math.ceil(f.lonMax * PPD) + pad
  return { column, rowNorthGrid, width: Math.floor((colLast - column + 1) / stride), height: Math.floor((rowLast - rowNorthGrid) / stride) + 1, stride }
}

/** The reader's bounds test (`x >= 0 && x < width-1`, same for y) evaluated at the footprint extremes. */
export function coverageOk(site: string, p: CropPlan): boolean {
  const { lat, lon } = SITE_PLAN[site], f = footprint(lat, lon)
  for (const la of [f.latMin, f.latMax]) for (const lo of [f.lonMin, f.lonMax]) {
    const x = (lo * PPD - p.column - (p.stride === 2 ? 1 : .5)) / p.stride, y = ((GRID_TOP_LAT - la) * PPD - p.rowNorthGrid - .5) / p.stride
    if (x < 0 || y < 0 || x >= p.width - 1 || y >= p.height - 1) return false
  }
  return true
}

const fdBySize = new Map<string, number>()
const fdOf = (file: string) => { let fd = fdBySize.get(file); if (fd === undefined) { fd = fs.openSync(file, 'r'); fdBySize.set(file, fd) } return fd }
export const closeTiles = () => { for (const fd of fdBySize.values()) fs.closeSync(fd); fdBySize.clear() }

/** Reads `count` samples of global row `row` from `col`, converted to metres; throws on any nodata. */
function readRowMetres(tiles: Tile[], row: number, col: number, count: number): Float64Array {
  const t = tiles.find(x => row >= x.label.row0 && row < x.label.row0 + x.label.lines && col >= x.label.col0 && col + count <= x.label.col0 + x.label.samples)
  if (!t) throw new Error(`Tile set does not cover row ${row}, columns ${col}..${col + count - 1}`)
  const L = t.label, buf = Buffer.alloc(count * 4)
  if (fs.readSync(fdOf(t.imgPath), buf, 0, buf.length, (row - L.row0) * L.samples * 4 + (col - L.col0) * 4) !== buf.length) throw new Error('Short read from ' + t.imgPath)
  const out = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    const dn = L.littleEndian ? buf.readFloatLE(i * 4) : buf.readFloatBE(i * 4), m = dn * L.scale * L.unitToMetres
    if (!Number.isFinite(dn) || (L.missing !== null && dn === L.missing) || Math.abs(m) > MAX_ABS_M)
      throw new Error(`Nodata/invalid SLDEM sample ${dn} at grid row ${row}, column ${col + i} (${L.productId})`)
    out[i] = m
  }
  return out
}

export function extractSite(site: string, tiles: Tile[], outDir: string) {
  const plan = planCrop(site), { lat, lon } = SITE_PLAN[site]
  if (!coverageOk(site, plan)) throw new Error(site + ': planned crop does not cover the 148 km tangent-plane square')
  const { width, height, stride, column, rowNorthGrid } = plan, raster = new Float32Array(width * height)
  for (let j = 0; j < height; j++) {
    const row = readRowMetres(tiles, rowNorthGrid + j * stride, column, width * stride)
    for (let i = 0; i < width; i++) {
      let s = 0; for (let k = 0; k < stride; k++) s += row[i * stride + k]
      raster[j * width + i] = s / stride
    }
  }
  const bytes = Buffer.from(raster.buffer), nativeM = 2 * Math.PI * R / (360 * PPD)
  const meta = { width, height, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), lat, lon, column, rowNorthGrid,
    sourceRowStride: stride, effectiveTexelNorthM: nativeM * stride, effectiveTexelEastM: nativeM * stride * Math.cos(lat * Math.PI / 180),
    format: 'float32 little-endian, metres above the 1737.4 km reference sphere, row 0 north', gridOrigin: 'row 0 = 30N, column 0 = 0E, pixel registered at 512 ppd',
    reduction: stride === 2 ? 'every second source row; horizontal 2-pixel mean' : 'native crop',
    sourceProducts: tiles.map(t => t.label.productId), sourceUnits: 'DN km x1000 = metres (OFFSET not added)' }
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, site + '.wide-effective-metres.f32'), bytes)
  fs.writeFileSync(path.join(outDir, site + '.wide-source.json'), JSON.stringify(meta, null, 2))
  return meta
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  if (os.endianness() !== 'LE') throw new Error('Little-endian host required for the f32 output')
  const arg = (n: string) => process.argv[process.argv.indexOf('--' + n) + 1] ?? ''
  const imgs = arg('tiles').split(',').filter(Boolean), out = arg('out')
  if (!imgs.length || !out) throw new Error('--tiles <a.IMG,b.IMG,...> and --out <dir> required (optional --sites a17[,a11]; a11 needs the 00N_30N AND 30S_00S tiles)')
  const tiles = imgs.map(p => openTile(p))
  try { for (const site of parseSites(process.argv.includes('--sites') ? arg('sites') : '')) { const m = extractSite(site, tiles, out); console.log(`${site}: ${m.width}x${m.height}, stride ${m.sourceRowStride}, column ${m.column}, rowNorthGrid ${m.rowNorthGrid}, sha256 ${m.sha256.slice(0, 12)}`) } }
  finally { closeTiles() }
}
