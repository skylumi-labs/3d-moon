// Offline, local files only. See --help.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync, gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { DataUtils } from 'three'

export const R = 1737400
export const TILE_SIZE = 128 // includes a one-texel gutter on every side
export const ANGLE_MAX = 64
export const START_OFFSET_M = 0.5
export const NEAR_M = 128
const add = (a, b, k) => a.map((v, i) => v + b[i] * k)
const scale = (a, k) => a.map(v => v * k)
const norm = a => scale(a, 1 / Math.hypot(...a))
const frame = (lat, lon) => {
  const p = lat * Math.PI / 180, l = lon * Math.PI / 180
  return { up: [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)], east: [-Math.sin(l), Math.cos(l), 0], north: [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)] }
}
export function horizonAngle(sample, { minD = NEAR_M, maxD = 45000, step = 4, grow = .005, bias = START_OFFSET_M, curvature = true } = {}) {
  if (!(minD > 0 && maxD >= minD && step > 0 && grow >= 0)) throw new Error('invalid march distances')
  const h0 = sample(0) + bias
  let best = 0
  for (let d = minD; d <= maxD; d += Math.max(step, d * grow)) {
    const h = sample(d)
    if (!Number.isFinite(h)) throw new Error('height source does not cover bake margin')
    const a = d / R
    const rise = curvature ? h - h0 - (R + h) * (2 * Math.sin(a / 2) ** 2) : h - h0
    const run = curvature ? (R + h) * Math.sin(a) : d
    best = Math.max(best, Math.atan2(rise, run) * 180 / Math.PI)
  }
  return best
}
export const packAngle = a => Math.round(Math.max(0, Math.min(ANGLE_MAX, a)) * 255 / ANGLE_MAX)
export const unpackAngle = a => a * ANGLE_MAX / 255
const read = f => { const b = fs.readFileSync(f); return b[0] === 31 && b[1] === 139 ? gunzipSync(b) : b }
const sha = b => createHash('sha256').update(b).digest('hex')
export function bilinear(data, w, h, x, y, wrap = false) {
  x -= .5; y = Math.max(0, Math.min(h - 1, y - .5))
  if (!wrap) x = Math.max(0, Math.min(w - 1, x))
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
  const r0 = Math.min(h - 1, iy) * w, r1 = Math.min(h - 1, iy + 1) * w
  let x0, x1
  if (wrap) { x0 = ((ix % w) + w) % w; x1 = (((ix + 1) % w) + w) % w } else { x0 = Math.min(w - 1, ix); x1 = Math.min(w - 1, ix + 1) }
  return (data[r0 + x0] * (1 - fx) + data[r0 + x1] * fx) * (1 - fy) + (data[r1 + x0] * (1 - fx) + data[r1 + x1] * fx) * fy
}
export function decodeGlobal(b) {
  if (b.toString('ascii', 0, 4) !== 'MHT1') throw new Error('Expected app MHT1 global map')
  const w = b.readUInt32LE(4), h = b.readUInt32LE(8), step = b.readFloatLE(12), span = b.readFloatLE(16), n = w * h
  if (span !== 180 || b.length !== 20 + 2 * n) throw new Error('Expected complete global MHT1 raster')
  const q = new Int32Array(n), heights = new Float32Array(n)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, z = (b[20 + i] << 8) | b[20 + n + i]
    q[i] = ((z >>> 1) ^ -(z & 1)) + (x ? q[i - 1] : 0) + (y ? q[i - w] : 0) - (x && y ? q[i - w - 1] : 0)
    heights[i] = DataUtils.fromHalfFloat(DataUtils.toHalfFloat(q[i] * step))
  }
  return { w, h, heights, hash: sha(b) }
}
export function gridKey(l) {
  return JSON.stringify([l.name, l.heights, l.heightFormat ?? 'f16', l.w, l.h, l.eastM, l.northM, l.texelEastM, l.texelNorthM, l.h0M, l.axisEastPerTexelM ?? null, l.axisSouthPerTexelM ?? null,
    ...(l.heightStepM === undefined ? [] : [l.heightStepM])])
}
export function upsample2x(src, w, h) {
  const W = 2 * w, H = 2 * h
  const out = new Float32Array(W * H)
  const cr = (t) => {
    const t2 = t * t, t3 = t2 * t
    return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2]
  }
  const at = (x, y) => src[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))]
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) / 2 - 0.5, y0 = Math.floor(fy), wy = cr(fy - y0)
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) / 2 - 0.5, x0 = Math.floor(fx), wx = cr(fx - x0)
      let v = 0
      for (let j = 0; j < 4; j++) {
        let row = 0
        for (let i = 0; i < 4; i++) row += wx[i] * at(x0 - 1 + i, y0 - 1 + j)
        v += wy[j] * row
      }
      out[y * W + x] = v
    }
  }
  return out
}

export function fitPatchRaster(l, input, maxTexture = Infinity) {
  const scale = (l.heightFormat === 'f32' || l.heightFormat === 'q16') && !l.detail && l.texelM < 2 ? 2 : 1
  const k = Math.min(1, maxTexture / Math.max(l.w * scale, l.h * scale))
  const w = Math.max(1, Math.floor(l.w * scale * k)), h = Math.max(1, Math.floor(l.h * scale * k))
  let data = input
  if (w === l.w * 2 && h === l.h * 2) data = upsample2x(input, l.w, l.h)
  else if (w !== l.w || h !== l.h) {
    data = new Float32Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = bilinear(input, l.w, l.h, (x + .5) * l.w / w, (y + .5) * l.h / h)
    if (l.heightFormat !== 'f32' && l.heightFormat !== 'q16') for (let i = 0; i < data.length; i++) {
      const hi = DataUtils.fromHalfFloat(DataUtils.toHalfFloat(data[i]))
      data[i] = hi + (l.heightFormat === 'f16x2' ? DataUtils.fromHalfFloat(DataUtils.toHalfFloat(data[i] - hi)) : 0)
    }
  }
  const sx = l.w / w, sy = l.h / h
  return { data, level: { ...l, w, h, texelEastM: l.texelEastM * sx, texelNorthM: l.texelNorthM * sy, texelM: l.texelM * Math.sqrt(sx * sy),
    ...(l.axisEastPerTexelM ? { axisEastPerTexelM: l.axisEastPerTexelM.map(v => v * sx), axisSouthPerTexelM: l.axisSouthPerTexelM.map(v => v * sy) } : {}) } }
}
let lastWeight = 0
function loadPatch(manifestPath, maxTexture, marginPath) {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  m.levels = m.levels.map(l => ({ ...l, h0M: l.h0M ?? m.h0M, assetDir: l.assetDir ?? path.dirname(path.resolve(manifestPath)) }))
  if (marginPath) {
    const margin = JSON.parse(fs.readFileSync(marginPath, 'utf8'))
    if (Math.abs(margin.site.lat - m.site.lat) > 1e-6 || Math.abs(margin.site.lon - m.site.lon) > 1e-6) throw new Error('Margin site mismatch')
    m.levels = [...margin.levels.map(l => ({ ...l, h0M: l.h0M ?? margin.h0M, assetDir: l.assetDir ?? path.dirname(path.resolve(marginPath)) })), ...m.levels]
  }
  const site = frame(m.site.lat, m.site.lon)
  const levels = m.levels.filter(l => l.heights).map(l => {
    l = { ...l, h0M: l.h0M ?? m.h0M }
    const b = read(path.resolve(l.assetDir ?? path.dirname(manifestPath), l.heights)), n = l.w * l.h
    const bytes = l.heightFormat === 'q16' || !l.heightFormat ? 2 : 4
    if (b.length !== n * bytes) throw new Error(`Bad height size: ${l.name}`)
    let data = new Float32Array(n)
    const q = l.heightFormat === 'q16' ? new Int32Array(n) : null
    for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) {
      const i = y * l.w + x
      if (q) {
        const z = (b[i] << 8) | b[n + i], residual = (z >>> 1) ^ -(z & 1)
        q[i] = residual + (x ? q[i - 1] : 0) + (y ? q[i - l.w] : 0) - (x && y ? q[i - l.w - 1] : 0)
        data[i] = q[i] * l.heightStepM
      } else data[i] = l.heightFormat === 'f32' ? b.readFloatLE(i * 4) : DataUtils.fromHalfFloat(b.readUInt16LE(i * 2)) + (l.heightFormat === 'f16x2' ? DataUtils.fromHalfFloat(b.readUInt16LE((n + i) * 2)) : 0)
      if (!Number.isFinite(data[i]) || data[i] === l.nodata) throw new Error(`Invalid height: ${l.name}`)
    }
    const fitted = fitPatchRaster(l, data, maxTexture)
    data = fitted.data; l = fitted.level
    const [a, c] = l.axisEastPerTexelM ?? [l.texelEastM, 0], [bb, d] = l.axisSouthPerTexelM ?? [0, -l.texelNorthM], det = a * d - bb * c
    if (!Number.isFinite(det) || det === 0) throw new Error(`Invalid grid: ${l.name}`)
    const corners = [[0, 0], [l.w, 0], [0, l.h], [l.w, l.h]].map(([x, y]) => [l.eastM + a * x + bb * y, l.northM + c * x + d * y])
    const bounds = [Math.min(...corners.map(v => v[0])), Math.min(...corners.map(v => v[1])), Math.max(...corners.map(v => v[0])), Math.max(...corners.map(v => v[1]))]
    const sample = (e, nn) => {
      const de = e - l.eastM, dn = nn - l.northM, x = (d * de - bb * dn) / det, y = (-c * de + a * dn) / det
      const edge = Math.min(x * l.texelEastM, (l.w - x) * l.texelEastM, y * l.texelNorthM, (l.h - y) * l.texelNorthM)
      const fade = l.texelM >= 30 ? Math.max(400, l.texelM * 16) : l.texelM >= 4 ? 1596 : l.texelM >= 1.9 ? 800 : l.texelM >= .5 ? 300 : 150
      const t = Math.max(0, Math.min(1, edge / fade)), weight = t * t * t * (t * (t * 6 - 15) + 10)
      lastWeight = weight
      return weight ? bilinear(data, l.w, l.h, x, y) + l.h0M : 0
    }
    return { l, bounds, sample, hash: sha(b) }
  })
  return { m, site, levels }
}

export async function bake(options) {
  const global = decodeGlobal(read(options.global)), patch = options.patch ? loadPatch(options.patch, options.maxTexture ?? Infinity, options.margin) : null
  const globalH = p => bilinear(global.heights, global.w, global.h, (Math.atan2(p[1], p[0]) / (2 * Math.PI) + .5) * global.w, (.5 - Math.asin(Math.max(-1, Math.min(1, p[2]))) / Math.PI) * global.h, true)
  const out = options.out
  fs.mkdirSync(out, { recursive: true })
  const manifest = { version: 1, tileSize: TILE_SIZE, angleMax: ANGLE_MAX, nearM: NEAR_M, biasM: START_OFFSET_M, radiusM: R, globalHash: global.hash, site: patch?.m.site ?? null, sources: [], tiles: [] }
  const stride = options.globalStride ?? 8
  const sources = [{ id: 'global', kind: 'global', directions: options.globalN ?? 32, bounds: [0, 0, 1, 1], dx: stride / global.w, dy: stride / global.h, height: globalH,
    point: (u, v) => frame(90 - Math.max(0, Math.min(1, v)) * 180, u * 360 - 180).up }]
  const pe = patch?.site.east, pn = patch?.site.north
  patch?.levels.forEach((level, index) => {
    const texel = options.patchTexel ?? 32
    sources.push({ id: level.l.name, kind: 'patch', key: gridKey(level.l), stack: patch.levels.slice(0, index + 1).map(v => gridKey(v.l)), hash: level.hash, directions: options.patchN ?? 64, bounds: level.bounds, dx: Math.max(texel, level.l.texelEastM), dy: Math.max(texel, level.l.texelNorthM),
      point: (e, n) => add(add(scale(patch.site.up, Math.sqrt(Math.max(0, 1 - (e * e + n * n) / R ** 2))), patch.site.east, e / R), patch.site.north, n / R),
      height: p => {
        let h = globalH(p)
        const e = (p[0] * pe[0] + p[1] * pe[1] + p[2] * pe[2]) * R, nn = (p[0] * pn[0] + p[1] * pn[1] + p[2] * pn[2]) * R
        for (let i = 0; i <= index; i++) { const hp = patch.levels[i].sample(e, nn), w = lastWeight; h = h * (1 - w) + hp * w }
        return h
      } })
  })
  let tileOrdinal = 0
  const scratch = [0, 0, 0]
  for (const source of sources) {
    const { directions: N, bounds: [x0, y0, x1, y1], dx, dy, height, point, ...meta } = source
    if (!Number.isInteger(N) || N < 4 || N > 64 || N % 4) throw new Error('N must be a multiple of 4, from 4 to 64')
    manifest.sources.push({ ...meta, directions: N, bounds: [x0, y0, x1, y1], dx, dy })
    const interior = TILE_SIZE - 2, nx = Math.ceil((x1 - x0) / (dx * interior)), ny = Math.ceil((y1 - y0) / (dy * interior))
    for (let row = 0; row < ny; row++) for (let col = 0; col < nx; col++) {
      const id = `${source.id}-${col}-${row}`
      const ordinal = tileOrdinal++
      if (options.only && !String(options.only).split(',').some(o => id.includes(o))) continue
      if (options.shard) { const [si, sn] = String(options.shard).split('/').map(Number); if (ordinal % sn !== si) continue }
      if (options.list) { console.log(`${id} ${ordinal}`); continue }
      const x = x0 + col * interior * dx, y = y0 + row * interior * dy
      const bytes = new Uint8Array(TILE_SIZE * TILE_SIZE * N)
      for (let j = 0; j < TILE_SIZE; j++) for (let i = 0; i < TILE_SIZE; i++) {
        const p = point(x + (i - .5) * dx, y + (j - .5) * dy)
        const east = norm([-p[1], p[0], 0]), north = [-p[2] * east[1], p[2] * east[0], Math.hypot(p[0], p[1])]
        for (let k = 0; k < N; k++) {
          const a = k * 2 * Math.PI / N, t = add(scale(north, Math.cos(a)), east, Math.sin(a))
          const angle = horizonAngle(d => { const c = Math.cos(d / R), sn = Math.sin(d / R); scratch[0] = p[0] * c + t[0] * sn; scratch[1] = p[1] * c + t[1] * sn; scratch[2] = p[2] * c + t[2] * sn; return height(scratch) }, { maxD: options.maxD ?? (source.kind === 'global' ? 300000 : 45000), step: options.step ?? 4, grow: options.grow ?? .005 })
          bytes[(Math.floor(k / 4) * TILE_SIZE * TILE_SIZE + j * TILE_SIZE + i) * 4 + k % 4] = packAngle(angle)
        }
      }
      const file = `${id}.rgba8.gz`, compressed = gzipSync(bytes)
      fs.writeFileSync(path.join(out, file), compressed)
      manifest.tiles.push({ id, source: source.id, file, rect: [x, y, Math.min(x1, x + interior * dx) - x, Math.min(y1, y + interior * dy) - y], bytes: bytes.length, sha256: sha(bytes) })
      console.log(`${id}: ${bytes.length} raw / ${compressed.length} gzip bytes`)
      // Persist progress after each tile. A partial manifest is valid and falls back outside its completed tiles.
      fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    }
  }
  return manifest
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = Object.fromEntries(process.argv.slice(2).map(arg => { const i = arg.indexOf('='); return [arg.slice(2, i < 0 ? undefined : i), i < 0 ? true : arg.slice(i + 1)] }))
  if (opts.help || !opts.out) {
    console.log('node scripts/bake-horizons.mjs --out=DIR [--patch=path/manifest.json] [--margin=path/wide/manifest.json] [--global=shared-assets/moon-height-4k.bin.gz] [--patchN=64] [--globalN=32] [--patchTexel=32] [--maxTexture=4096] [--globalStride=8] [--maxD=45000] [--step=4] [--grow=0.005] [--only=L2-0-0[,L1-]] [--shard=i/n] [--list]\nAll sources and margins are local; --patch is a coarse-to-fine manifest (compose wide + NAC levels with per-level assetDir and h0M if needed). --only is a tile-ID substring for sharding/smoke bakes; merge partial tile lists before upload.')
  } else {
    for (const k of ['patchN', 'globalN', 'patchTexel', 'maxTexture', 'globalStride', 'maxD', 'step', 'grow']) if (opts[k] !== undefined) {
      opts[k] = Number(opts[k]); if (!Number.isFinite(opts[k]) || opts[k] < (k === 'grow' ? 0 : Number.MIN_VALUE)) throw new Error(`Invalid --${k}`)
    }
    await bake({ global: 'shared-assets/moon-height-4k.bin.gz', ...opts })
  }
}
