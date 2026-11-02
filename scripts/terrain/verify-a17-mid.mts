/**
 * Format checks for the rebuilt Apollo 17 mid (SLDEM2015 height bridge) patch at 59 m. Runs on the build VM before anything is uploaded
 * (scripts/terrain/a17_mid_59m_vm.sh) and by hand on a downloaded copy. Nothing here touches the network or GCS except through the
 * file paths it is given.
 *
 *   node --import tsx scripts/terrain/verify-a17-mid.mts --dir <dir with manifest.json + mid-height.q16.gz> [--live <dir with the live 118 m copy>]
 *
 * Hard checks (exit 1): everything the app's loader relies on (version 2 manifest, capability, 2496 square q16 raster over the 148 km
 * tangent-plane square, h0M = round(groundM), asset bytes and sha256 of the inflated planes, finite heights, recorded range).
 * Comparison with the live 118 m copy is only reported (WARN), because the thresholds are sanity guesses, not measured.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { decodeHeightPlanes } from '../../src/moon/tiles/codec.ts'

export const N59 = 2496, EXTENT_M = 148000, HEIGHTS_FILE = 'mid-height.q16.gz'
interface Level { name: string, w: number, h: number, texelM: number, texelEastM: number, texelNorthM: number, eastM: number, northM: number, heights: string, heightFormat: string, heightStepM?: number, maxAltitudeKm: number, provenance: { source: string, heightSourceTexelM: number } }
export interface MidManifest { version: number, capabilities: string[], site: { lat: number, lon: number, groundM: number }, h0M: number, levels: Level[], assets: Record<string, { bytes: number, sha256: string }>, heightRangeM: [number, number] }

/** Returns the list of failed checks (empty = good) for a manifest and its inflated raster bytes. */
export function checkMid(m: MidManifest, raw: Buffer): string[] {
  const bad: string[] = [], need = (ok: boolean, why: string) => { if (!ok) bad.push(why) }
  need(m.version === 2, 'manifest version is not 2')
  need(Array.isArray(m.capabilities) && m.capabilities.includes('continuous-height-mid-v1'), 'capability continuous-height-mid-v1 missing')
  need(Math.abs(m.site?.lat - 20.1911) < 1e-9 && Math.abs(m.site?.lon - 30.7723) < 1e-9, 'site is not Apollo 17')
  need(m.h0M === Math.round(m.site?.groundM), 'h0M is not round(groundM)')
  const l = m.levels?.[0]
  need(m.levels?.length === 1 && !!l, 'expected exactly one level')
  if (!l) return bad
  need(l.name === 'MID-a17', 'level name is not MID-a17')
  need(l.w === N59 && l.h === N59, `raster is not ${N59} square`)
  need(Math.abs(l.texelM * N59 - EXTENT_M) < 1e-6 && l.texelM > 59 && l.texelM < 60, 'texel is not 148 km / 2496 (about 59.3 m)')
  need(l.texelM === l.texelEastM && l.texelM === l.texelNorthM, 'texel sizes differ')
  need(l.eastM === -EXTENT_M / 2 && l.northM === EXTENT_M / 2, 'level origin is not the corner of the 148 km square')
  need(l.heights === HEIGHTS_FILE && l.heightFormat === 'q16' && l.heightStepM === 0.25, 'heights file name or q16 step changed')
  need(l.maxAltitudeKm === 250, 'maxAltitudeKm changed from the live 250')
  need(!/effective120m/.test(l.provenance?.source ?? '') && l.provenance?.heightSourceTexelM > 55 && l.provenance?.heightSourceTexelM < 60, 'provenance still describes the 118 m decimation')
  need(raw.length === N59 * N59 * 2, 'inflated q16 planes are not 2496*2496*2 bytes')
  const a = m.assets?.[HEIGHTS_FILE]
  need(!!a && a.bytes === raw.length && a.sha256 === createHash('sha256').update(raw).digest('hex'), 'asset bytes/sha256 do not match the raster')
  if (raw.length === N59 * N59 * 2) {
    const q = decodeHeightPlanes(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength), N59, N59)
    const f = Float32Array.from(q, (v) => v * (l.heightStepM ?? 0.25))
    let min = Infinity, max = -Infinity, badSample = 0
    for (let i = 0; i < f.length; i++) { const v = f[i] + m.h0M; if (!Number.isFinite(v) || Math.abs(v) > 12000) badSample++; else { if (v < min) min = v; if (v > max) max = v } }
    need(badSample === 0, `${badSample} non-finite or out-of-range samples`)
    need(Math.abs(min - m.heightRangeM?.[0]) < 0.01 && Math.abs(max - m.heightRangeM?.[1]) < 0.01, 'heightRangeM does not match the raster')
    const c = f[(N59 / 2) * N59 + N59 / 2] + m.h0M
    need(Math.abs(c - m.site.groundM) < 60, `site height ${c.toFixed(1)} vs groundM ${m.site.groundM.toFixed(1)} differ by more than one texel's relief`)
  }
  return bad
}

export interface LiveCompare { rmsM: number, maxAbsM: number, centreDiffM: number, meanDiffM: number }
/** Block-averages the 2496 raster 2x2 onto the live 1248 grid (same extent, texel centres coincide) and compares physical heights. */
export function compareToLive(newRaw: Buffer, newH0: number, liveRaw: Buffer, liveH0: number): LiveCompare {
  const a = new Float32Array(newRaw.buffer.slice(newRaw.byteOffset, newRaw.byteOffset + newRaw.byteLength)), b = new Float32Array(liveRaw.buffer.slice(liveRaw.byteOffset, liveRaw.byteOffset + liveRaw.byteLength))
  const n = Math.sqrt(b.length)
  if (!Number.isInteger(n) || a.length !== 4 * b.length) throw new Error('rasters are not 2x apart')
  let s2 = 0, sd = 0, mx = 0, centre = 0
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const w = 2 * n, i = 2 * y * w + 2 * x
    const avg = (a[i] + a[i + 1] + a[i + w] + a[i + w + 1]) / 4 + newH0, d = avg - (b[y * n + x] + liveH0)
    s2 += d * d; sd += d; mx = Math.max(mx, Math.abs(d)); if (y === n / 2 && x === n / 2) centre = d
  }
  return { rmsM: Math.sqrt(s2 / b.length), maxAbsM: mx, centreDiffM: centre, meanDiffM: sd / b.length }
}

const readDir = (dir: string) => {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as MidManifest
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(dir, m.levels[0].heights)))
  const l = m.levels[0], n = l.w * l.h
  const f = l.heightFormat === 'q16'
    ? Float32Array.from(decodeHeightPlanes(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength), l.w, l.h), (v) => v * (l.heightStepM ?? 0.25))
    : new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + n * 4))
  return { m, raw, compareRaw: Buffer.from(f.buffer) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k: string) => process.argv.includes('--' + k) ? process.argv[process.argv.indexOf('--' + k) + 1] : ''
  const dir = arg('dir'); if (!dir) throw new Error('--dir required')
  const { m, raw, compareRaw } = readDir(dir), bad = checkMid(m, raw)
  for (const b of bad) console.log('FAIL', b)
  if (arg('live')) {
    const live = readDir(arg('live')), c = compareToLive(compareRaw, m.h0M, live.compareRaw, live.m.h0M)
    console.log(`compare to live 118 m (2x2 mean): rms ${c.rmsM.toFixed(2)} m, max ${c.maxAbsM.toFixed(1)} m, mean ${c.meanDiffM.toFixed(2)} m, centre ${c.centreDiffM.toFixed(2)} m`)
    if (c.rmsM > 40 || Math.abs(c.centreDiffM) > 15 || Math.abs(c.meanDiffM) > 5) console.log('WARN comparison outside the sanity guess (rms 40 m, centre 15 m, mean 5 m): look before activating (these thresholds are estimates, not measured)')
  }
  console.log(bad.length ? `verify-a17-mid: ${bad.length} FAILED` : 'verify-a17-mid: ok')
  process.exit(bad.length ? 1 : 0)
}
