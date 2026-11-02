import type { VisibilityCalibration } from '../src/post/visibility.ts'
import { validateCalibration } from '../src/post/visibility.ts'
export interface VisibilityEvidence {
  frameId: number; width: number; height: number; metadata: Uint8Array; gray: Uint8Array
  calibration: VisibilityCalibration | null; ground: boolean; skewMs: number
  /** Foreground UI, Earth/Sun/glare exclusions, in normalized screenshot coordinates. */
  excludes: Array<[number, number, number, number]>
  offscreen: boolean
  limbApplicable: boolean; expectedNight: boolean
  bundleSha256: string; baselineEarthshineSha256: string | null; baselineVerified: boolean
}
const cachedMetrics = new WeakMap<VisibilityEvidence, VisibilityMetrics>()
export interface VisibilityMetrics {
  applicable: boolean; reason: string; covered: number; night: number; background: number
  discMean: number; discP99: number; nightMean: number; nightP99: number; lowContrast: number; worstLimbContrast: number | null
  detailContrast: number | null; excluded: number; limbSectors: number
}
const percentile = (v: number[], u: number) => v.length ? [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) * u)] : NaN
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / Math.max(1, v.length)
export function visibilityMetrics(e: VisibilityEvidence): VisibilityMetrics {
  if (!Number.isSafeInteger(e.width) || !Number.isSafeInteger(e.height) || e.width < 1 || e.height < 1
    || e.gray.length !== e.width * e.height || e.metadata.length !== e.gray.length * 4)
    throw new Error('Missing/misaligned native independent metadata')
  const empty: VisibilityMetrics = { applicable: false, reason: '', covered: 0, night: 0, background: 0,
    discMean: 0, discP99: 0, nightMean: 0, nightP99: 0, lowContrast: 0, worstLimbContrast: null, detailContrast: null, excluded: 0, limbSectors: 0 }
  const mask = new Uint8Array(e.gray.length)
  for (const [x, y, w, h] of e.excludes) for (let j = Math.max(0, Math.floor(y * e.height)); j < Math.min(e.height, Math.ceil((y + h) * e.height)); j++)
    for (let i = Math.max(0, Math.floor(x * e.width)); i < Math.min(e.width, Math.ceil((x + w) * e.width)); i++) mask[j * e.width + i] = 1
  const disc: number[] = [], night: number[] = [], low: number[] = [], high: number[] = [], bg: number[] = []
  const eligible: number[] = []
  let minX = e.width, maxX = 0, minY = e.height, maxY = 0
  for (let i = 0; i < e.gray.length; i++) {
    if (mask[i]) { empty.excluded++; continue }
    const cover = e.metadata[i * 4] / 255
    if (cover >= 0.98) { empty.covered++; disc.push(e.gray[i]); minX = Math.min(minX, i % e.width); maxX = Math.max(maxX, i % e.width); minY = Math.min(minY, Math.floor(i / e.width)); maxY = Math.max(maxY, Math.floor(i / e.width)) }
    if (cover >= 0.98 && e.metadata[i * 4 + 1] / 255 >= 0.98) {
      eligible.push(i); night.push(e.gray[i]); const template = e.metadata[i * 4 + 2] / 255 / cover
      if (template < 0.55) low.push(e.gray[i]); if (template > 0.75) high.push(e.gray[i])
    }
  }
  empty.night = night.length
  if (empty.covered < 64) { empty.reason = e.offscreen ? 'Moon outside camera frustum (explicit camera evidence)' : 'Incomplete: fewer than 64 independently covered interior samples'; return empty }
  if (!night.length) { empty.reason = 'No geometrically night-side surface in this frame'; return empty }
  if (night.length < 64) { empty.reason = 'Incomplete: fewer than 64 eligible night-side samples'; return empty }
  const margin = Math.max(4, Math.round(Math.max(maxX - minX, maxY - minY) * 0.08))
  for (let y = Math.max(0, minY - margin); y <= Math.min(e.height - 1, maxY + margin); y++) for (let x = Math.max(0, minX - margin); x <= Math.min(e.width - 1, maxX + margin); x++) {
    const i = y * e.width + x
    if (!mask[i] && e.metadata[i * 4] === 0 && e.gray[i] <= 40) bg.push(e.gray[i])
  }
  empty.background = bg.length
  if (!e.ground && bg.length < 64) { empty.reason = 'Incomplete: neighbouring sky reference unavailable'; return empty }
  const reference = e.ground ? percentile(night, 0.1) : percentile(bg, 0.95)
  const sectors: number[][] = Array.from({ length: 8 }, () => [])
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  for (const i of eligible) {
    const cosine = e.metadata[i * 4 + 3] / 255
    if (cosine > 0.25) continue
    const sector = Math.min(7, Math.floor((Math.atan2(Math.floor(i / e.width) - cy, i % e.width - cx) + Math.PI) / (Math.PI / 4)))
    sectors[sector].push(e.gray[i])
  }
  const sampled = sectors.filter(s => s.length >= 3)
  const limb = sampled.map(s => percentile(s, 0.1) - reference)
  let detail = low.length >= 8 && high.length >= 8 ? percentile(high, 0.5) - percentile(low, 0.5) : null
  if (e.ground) {
    const templates = eligible.map(i => e.metadata[i * 4 + 2] / Math.max(1, e.metadata[i * 4]))
    const lo = percentile(templates, .25), hi = percentile(templates, .75)
    if (hi - lo > .02) {
      const lowGround = eligible.filter((_, j) => templates[j] <= lo).map(i => e.gray[i])
      const highGround = eligible.filter((_, j) => templates[j] >= hi).map(i => e.gray[i])
      detail = percentile(highGround, .5) - percentile(lowGround, .5)
    } else detail = null
  }
  return { ...empty, applicable: true, reason: e.ground ? 'Ground: measured-albedo terrain contrast; sky annulus inapplicable' : 'Visible night-side and sampled limb sectors',
    discMean: mean(disc), discP99: percentile(disc, .99), nightMean: mean(night), nightP99: percentile(night, 0.99), lowContrast: percentile(night, 0.1) - reference,
    worstLimbContrast: limb.length ? Math.min(...limb) : null, detailContrast: detail, limbSectors: sampled.length }
}
export function g8(scenario: string, evidence: VisibilityEvidence[]): { gate: string; scenario: string; pass: boolean | null; detail: string } {
  const result = (pass: boolean | null, detail: string) => ({ gate: 'G8', scenario, pass, detail })
  if (!evidence.length) return result(false, 'Missing lossless, synchronized independent Moon evidence')
  let applicable = 0
  for (const e of evidence) {
    if (!e.calibration) return result(false, 'Visibility calibration pending: no exact-build lossless Earthshine baseline')
    if (e.bundleSha256 !== e.calibration.bundleSha256 || !e.baselineVerified || e.baselineEarthshineSha256 !== e.calibration.baselineEarthshineSha256) return result(false, 'Stale/unverified calibration candidate or lossless baseline identity')
    try { validateCalibration(e.calibration) } catch (error) { return result(false, String(error)) }
    if (!Number.isFinite(e.skewMs) || e.skewMs > 1 || e.frameId < 1) return result(false, 'Pixels and independent metadata are not the same frozen render frame')
    let m: VisibilityMetrics
    try { m = cachedMetrics.get(e) ?? visibilityMetrics(e) } catch (error) { return result(false, String(error)) }
    if (!m.applicable) { if (m.reason.startsWith('Incomplete:') || e.expectedNight && m.reason.startsWith('No geometrically')) return result(false, m.reason); continue }
    if (e.limbApplicable && m.limbSectors === 0) return result(false, 'Whole-disc evidence has no adequately sampled night-side limb sector')
    applicable++
    const contrast = e.calibration.minContrastGrey * 255, detail = e.calibration.minDetailGrey * 255
    if ((!e.ground && (m.lowContrast < contrast || (m.worstLimbContrast !== null && m.worstLimbContrast < contrast)))
      || m.detailContrast === null || m.detailContrast < detail)
      return result(false, `frame ${e.frameId}: night mean/p99 ${m.nightMean.toFixed(1)}/${m.nightP99.toFixed(1)}, low contrast ${m.lowContrast.toFixed(1)}, limb ${m.worstLimbContrast}, maria/highland ${m.detailContrast}; ${m.reason}`)
  }
  return result(applicable ? true : null, applicable ? `${applicable} eligible exact-frame lossless masks passed` : 'Explicitly no eligible night-side surface in selected frozen frames')
}

/** Retain native lossless files externally, not multi-gigabyte native arrays for every recorded frame. */
export function summarizeVisibility(e: VisibilityEvidence): VisibilityMetrics {
 const metrics = visibilityMetrics(e)
 cachedMetrics.set(e, metrics)
 e.gray = new Uint8Array(0)
 e.metadata = new Uint8Array(0)
 return metrics
}
