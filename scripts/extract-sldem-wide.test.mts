import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { PPD, SITE_PLAN, closeTiles, extractSite, footprint, openTile, parseLabel, parseSites, planCrop, type Tile } from './extract-sldem-wide.mts'

// Synthetic PDS3 tiles at the real 512 ppd grid, small footprint. The height field is AFFINE in (lat, lon) in
// metres, so bilinear sampling reproduces it exactly and any registration shift shows as metres of error.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sldem-extract-'))
const fields: Record<string, (lat: number, lon: number) => number> = {
  a11: (lat, lon) => -2000 + 800 * (lat - 0.6741) + 300 * (lon - 23.473),
  a17: (lat, lon) => 1000 + 600 * (lat - 20.1911) - 400 * (lon - 30.7723),
}
const labelText = (id: string, o: { maxLat: number, minLat: number, west: number, east: number, type?: string, extra?: string, lineOff?: number }) => {
  const lines = (o.maxLat - o.minLat) * PPD, samples = (o.east - o.west) * PPD
  return `PDS_VERSION_ID = "PDS3"
PRODUCT_ID                = "${id}"
RECORD_BYTES              = ${samples * 4}
FILE_RECORDS              = ${lines}
  OBJECT                    = IMAGE
    LINES                 = ${lines}
    LINE_SAMPLES          = ${samples}
    SAMPLE_TYPE           = ${o.type ?? 'PC_REAL'}
    SAMPLE_BITS           = 32
    UNIT                  = KILOMETER
    SCALING_FACTOR        = 1
    OFFSET                = 1737.4
${o.extra ?? ''}  END_OBJECT              = IMAGE
 MAP_PROJECTION_TYPE          = "SIMPLE CYLINDRICAL"
 MAP_RESOLUTION               = 512 <pix/deg>
 A_AXIS_RADIUS                = 1737.4 <km>
 CENTER_LONGITUDE             = 180. <deg>
 MAXIMUM_LATITUDE             = ${o.maxLat} <deg>
 MINIMUM_LATITUDE             = ${o.minLat} <deg>
 WESTERNMOST_LONGITUDE        = ${o.west} <deg>
 EASTERNMOST_LONGITUDE        = ${o.east} <deg>
 LINE_PROJECTION_OFFSET       = ${o.lineOff ?? o.maxLat * PPD - .5} <pix>
 SAMPLE_PROJECTION_OFFSET     = ${(180 - o.west) * PPD - .5} <pix>
END
`
}
const makeTile = (name: string, o: { maxLat: number, minLat: number, west: number, east: number }, field: (a: number, b: number) => number,
  poke?: (row: number, col: number) => number | undefined): Tile => {
  const lines = (o.maxLat - o.minLat) * PPD, samples = (o.east - o.west) * PPD, img = path.join(tmp, name + '.IMG')
  fs.writeFileSync(path.join(tmp, name + '.LBL'), labelText(name, o))
  const fd = fs.openSync(img, 'w'), row = new Float32Array(samples)
  for (let r = 0; r < lines; r++) {
    const lat = o.maxLat - (r + .5) / PPD
    for (let c = 0; c < samples; c++) row[c] = poke?.(r, c) ?? field(lat, o.west + (c + .5) / PPD) / 1000 // file is km
    fs.writeSync(fd, row)
  }
  fs.closeSync(fd)
  return openTile(img)
}

const fixtures = (a11?: (r: number, c: number) => number | undefined) => ({
  a11: [makeTile('N0_3.5', { maxLat: 3.5, minLat: 0, west: 20.5, east: 26.5 }, fields.a11, a11), makeTile('S0_2.5', { maxLat: 0, minLat: -2.5, west: 20.5, east: 26.5 }, fields.a11)],
  a17: [makeTile('N17.5_23', { maxLat: 23, minLat: 17.5, west: 27.5, east: 34 }, fields.a17)],
})

try {
  // --- label parsing: the real label's values, byte order, registration guard
  const real = parseLabel(labelText('SLDEM2015_512_00N_30N_000_045_FLOAT', { maxLat: 30, minLat: 0, west: 0, east: 45 }))
  assert.equal(real.lines, 15360); assert.equal(real.samples, 23040); assert.equal(real.row0, 0); assert.equal(real.col0, 0)
  assert.equal(real.unitToMetres, 1000); assert.equal(real.littleEndian, true)
  assert.equal(parseLabel(labelText('S', { maxLat: 0, minLat: -30, west: 0, east: 45 })).row0, 15360, 'southern tile continues the row numbering')
  assert.equal(parseLabel(labelText('B', { maxLat: 30, minLat: 0, west: 0, east: 45, type: 'MSB_IEEE_REAL' })).littleEndian, false)
  assert.equal(parseLabel(labelText('M', { maxLat: 30, minLat: 0, west: 0, east: 45, extra: '    MISSING_CONSTANT      = -32768.0\n' })).missing, -32768)
  assert.throws(() => parseLabel(labelText('X', { maxLat: 30, minLat: 0, west: 0, east: 45, lineOff: 15360 })), /pixel registered/)

  // --- the 148 km square is covered with margin for both sites
  for (const s of Object.keys(SITE_PLAN)) {
    const p = planCrop(s), f = footprint(SITE_PLAN[s].lat, SITE_PLAN[s].lon)
    assert.ok(p.width * p.stride / PPD > f.lonMax - f.lonMin && p.height * p.stride / PPD > f.latMax - f.latMin)
  }
  assert.equal(SITE_PLAN.a17.stride, 1, 'a17 is the native 59 m crop')
  assert.deepEqual(parseSites('a17'), ['a17']); assert.deepEqual(parseSites(''), ['a11', 'a17']); assert.throws(() => parseSites('a99'), /Unknown site/)

  // --- extraction + the REAL build-wide-height reader
  const tiles = fixtures()
  const outDir = path.join(tmp, 'src'), meta: Record<string, ReturnType<typeof extractSite>> = {}
  for (const s of ['a11', 'a17'] as const) meta[s] = extractSite(s, tiles[s], outDir)
  closeTiles()
  for (const s of ['a11', 'a17'] as const) {
    const m = meta[s], bytes = fs.readFileSync(path.join(outDir, s + '.wide-effective-metres.f32'))
    assert.equal(bytes.length, m.bytes); assert.equal(bytes.length, m.width * m.height * 4)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), m.sha256)
    assert.equal(m.sourceRowStride, SITE_PLAN[s].stride)
    const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    // planted-pixel registration, independent of the reader: output (i, j) -> grid centre
    for (const [i, j] of [[0, 0], [m.width - 1, 0], [0, m.height - 1], [m.width >> 1, m.height >> 1], [m.width - 1, m.height - 1]]) {
      const row = m.rowNorthGrid + j * m.sourceRowStride + .5, col = m.column + (m.sourceRowStride === 2 ? 1 : .5) + i * m.sourceRowStride
      const want = fields[s](30 - row / PPD, col / PPD)
      assert.ok(Math.abs(f[j * m.width + i] - want) < 0.02, `${s} (${i},${j}): ${f[j * m.width + i]} vs ${want}`)
    }
  }
  assert.ok(Math.abs(meta.a17.effectiveTexelNorthM - 59.2253) < 1e-3)
  assert.ok(Math.abs(meta.a11.effectiveTexelNorthM - 59.2253) < 1e-3)

  const runBuild = (src: string, out: string) => spawnSync(process.execPath, ['--import', 'tsx', path.join(import.meta.dirname, 'build-wide-height.mts'), '--source', src, '--out', out], { encoding: 'utf8' })
  const readGround = (out: string, s: string) => JSON.parse(fs.readFileSync(path.join(out, s, 'manifest.json'), 'utf8')).site.groundM as number
  const built = path.join(tmp, 'built'), res = runBuild(outDir, built)
  assert.equal(res.status, 0, res.stderr)
  for (const s of ['a11', 'a17'] as const) {
    const want = fields[s](SITE_PLAN[s].lat, SITE_PLAN[s].lon), got = readGround(built, s)
    assert.ok(Math.abs(got - want) < 0.05, `${s} site height read back by build-wide-height: ${got} vs ${want}`)
  }

  // --- neuter proof: the same check must FAIL when the row origin is flipped (north-up raster written south-up)
  const bad = path.join(tmp, 'flipped'); fs.mkdirSync(bad)
  for (const s of ['a11', 'a17'] as const) {
    const m = meta[s], f = new Float32Array(fs.readFileSync(path.join(outDir, s + '.wide-effective-metres.f32')).buffer.slice(0)), flipped = new Float32Array(f.length)
    for (let j = 0; j < m.height; j++) flipped.set(f.subarray(j * m.width, (j + 1) * m.width), (m.height - 1 - j) * m.width)
    const b = Buffer.from(flipped.buffer)
    fs.writeFileSync(path.join(bad, s + '.wide-effective-metres.f32'), b)
    fs.writeFileSync(path.join(bad, s + '.wide-source.json'), JSON.stringify({ ...m, sha256: createHash('sha256').update(b).digest('hex') }))
  }
  const rb = runBuild(bad, path.join(tmp, 'built-bad'))
  const flippedWrong = rb.status !== 0 || ['a11', 'a17'].some(s => Math.abs(readGround(path.join(tmp, 'built-bad'), s) - fields[s](SITE_PLAN[s].lat, SITE_PLAN[s].lon)) > 5)
  assert.ok(flippedWrong, 'a flipped row origin must be caught by the registration check')

  // --- a tile set that does not reach the footprint (north tile only) is a hard error, not a silent edge fill
  assert.throws(() => extractSite('a11', [tiles.a11[0]], path.join(tmp, 'short')), /does not cover/)
  closeTiles()
  // --- nodata is rejected, never filled (poke a NaN, then a below-range value, inside the a11 crop)
  for (const bad of [NaN, -99999]) {
    const t = fixtures((r, c) => (r === 3.5 * PPD - 1 - 10 && c === 1000 ? bad : undefined))
    assert.throws(() => extractSite('a11', t.a11, path.join(tmp, 'nodata')), /Nodata\/invalid/)
    closeTiles()
  }
} finally { closeTiles(); fs.rmSync(tmp, { recursive: true, force: true }) }
console.log('extract-sldem-wide.test.mts: label registration guards, km->metres, tile stitching across 0N, row/column registration read back through build-wide-height, flipped-row neuter, nodata rejection, sha256: ok')
