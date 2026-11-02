/** Local-only, measured SLDEM height bridge. Global color is retained; no photometric claims or uploads. */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { validateManifest } from '../src/moon/patch/manifest.ts'
import type { PatchManifest } from '../src/moon/patch/PatchLayer.ts'
import { encodeHeightPlanes } from '../src/moon/tiles/codec.ts'
const arg = (name: string) => process.argv[process.argv.indexOf('--' + name) + 1] ?? ''
const sourceDir = arg('source'), out = arg('out'), only = process.argv.includes('--sites') ? arg('sites').split(',').filter(Boolean) : []
if (!sourceDir || !out) throw new Error('--source and --out required')
const R = 1737400, extent = 148000
const stepM = 0.25
for (const site of ['a11', 'a17'].filter(x => !only.length || only.includes(x))) {
 const p = JSON.parse(fs.readFileSync(path.join(sourceDir, site + '.wide-source.json'), 'utf8'))
 const bytes = fs.readFileSync(path.join(sourceDir, site + '.wide-effective-metres.f32'))
 if (bytes.length !== p.bytes || createHash('sha256').update(bytes).digest('hex') !== p.sha256) throw new Error('Incomplete/unverified wide source')
 const src = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
 const native = p.sourceRowStride === 1, n = native ? 2496 : 1248, texel = extent / n, lat0 = p.lat * Math.PI / 180, lon0 = p.lon * Math.PI / 180
 const S = [Math.cos(lat0) * Math.cos(lon0), Math.cos(lat0) * Math.sin(lon0), Math.sin(lat0)]
 const E = [-Math.sin(lon0), Math.cos(lon0), 0], N = [-Math.sin(lat0) * Math.cos(lon0), -Math.sin(lat0) * Math.sin(lon0), Math.cos(lat0)]
 const at = (lon: number, lat: number): number => {
  const x = (lon * 512 - p.column - (p.sourceRowStride === 2 ? 1 : .5)) / p.sourceRowStride
  const y = ((30 - lat) * 512 - p.rowNorthGrid - .5) / p.sourceRowStride
  if (x < 0 || y < 0 || x >= p.width - 1 || y >= p.height - 1) throw new Error('Source coverage too small for tangent-plane bridge')
  const i = Math.floor(x), j = Math.floor(y), a = x - i, b = y - j
  const vals = [src[j * p.width + i], src[j * p.width + i + 1], src[(j + 1) * p.width + i], src[(j + 1) * p.width + i + 1]]
  if (vals.some(v => !Number.isFinite(v) || v < -12000 || v > 12000)) throw new Error('Nodata/invalid source sample')
  return (vals[0] * (1 - a) + vals[1] * a) * (1 - b) + (vals[2] * (1 - a) + vals[3] * a) * b
 }
 const groundM = at(p.lon, p.lat), h0M = Math.round(groundM), raster = new Float32Array(n * n)
 let min = Infinity, max = -Infinity
 for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
  const e = (-extent / 2 + (x + .5) * texel) / R, north = (extent / 2 - (y + .5) * texel) / R, radial = Math.sqrt(1 - e * e - north * north)
  const v = S.map((s, k) => s * radial + E[k] * e + N[k] * north)
  const lon = Math.atan2(v[1], v[0]) * 180 / Math.PI, lat = Math.asin(v[2]) * 180 / Math.PI
  const height = at(lon, lat)
  raster[y * n + x] = height - h0M; min = Math.min(min, height); max = Math.max(max, height)
 }
 const q = new Int32Array(raster.length)
 let qMin = Infinity, qMax = -Infinity
 for (let i = 0; i < q.length; i++) {
  q[i] = Math.round(raster[i] / stepM)
  if (q[i] < -32768 || q[i] > 32767) throw new Error(`${site}: q16 height out of int16 range`)
  qMin = Math.min(qMin, q[i] * stepM + h0M); qMax = Math.max(qMax, q[i] * stepM + h0M)
 }
 const raw = Buffer.from(encodeHeightPlanes(q, n, n)), filename = 'mid-height.q16.gz', dir = path.join(out, site)
 fs.mkdirSync(dir, { recursive: true }); const gzip = zlib.gzipSync(raw, { level: 9 }); fs.writeFileSync(path.join(dir, filename), gzip)
 const manifest: PatchManifest = { version: 2, capabilities: ['continuous-height-mid-v1'], site: { name: site + ' SLDEM height bridge', lat: p.lat, lon: p.lon, groundM }, h0M,
  light: { time: '', sunElevationDeg: 0, sunEastFromNorthDeg: 0 }, credit: 'LOLA/SELENE terrain teams, NASA/GSFC PDS; source frame DE421',
  levels: [{ name: 'MID-' + site, w: n, h: n, texelM: texel, texelEastM: texel, texelNorthM: texel, eastM: -extent / 2, northM: extent / 2,
   heights: filename, heightFormat: 'q16', heightStepM: stepM, maxAltitudeKm: 250,
   provenance: { kind: 'measured', source: 'SLDEM2015 V2.0; exact local orthographic tangent-plane reprojection; quantised 0.25 m; ' + (!native ? 'source rows vertically decimated, horizontal2-pixel mean; effective120m' : 'native60m source'),
    license: 'NASA PDS scientific archive; cite LOLA/SELENE teams', coordinateFrame: 'moon-site-east-north-metres', verticalDatum: 'metres above1737400m sphere; source mean Earth/polar axis DE421', referenceRadiusM: R,
    registrationErrorM: Math.max(p.effectiveTexelNorthM, p.effectiveTexelEastM), heightSourceTexelM: Math.max(p.effectiveTexelNorthM, p.effectiveTexelEastM) } }],
  assets: { [filename]: { bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') } }, heightRangeM: [qMin, qMax] }
 validateManifest(manifest, 7)
 fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
 fs.writeFileSync(path.join(dir, 'provenance.json'), JSON.stringify({ ...p, outputExtentM: extent, outputTexelM: texel, compressedBytes: gzip.length, outputFrame: 'exact unit-sphere tangent plane matching PatchLayer.metresFromSite; bilinear registered source sampling',
  color: 'existing global approximately400m; no new intrinsic albedo or WAC baked-light image', applicability: 'central site corridor within148km width/height; outside it global terrain remains smoothly blended', caveats: ['NAC cross-product visual registration unrun', ...(native ? [] : ['Apollo17 is effective120m, not a filtered native60m product']), 'no publication'] }, null, 2))
 console.log(`${site}: ${n}x${n}, ${texel.toFixed(3)}m,148km square, gzip${gzip.length}bytes, heights${min.toFixed(1)}..${max.toFixed(1)}m, site${groundM.toFixed(2)}m`)
}
