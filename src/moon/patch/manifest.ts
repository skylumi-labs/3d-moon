import type { PatchLevel, PatchManifest } from './PatchLayer'

export interface PatchProvenance {
  kind: 'measured' | 'reconstructed' | 'synthetic-fixture'
  source: string
  license: string
  coordinateFrame: 'moon-site-east-north-metres'
  verticalDatum: string
  referenceRadiusM: 1737400
  registrationErrorM: number
  heightSourceTexelM?: number
  imageSourceTexelM?: number
}
export interface PatchAssetIntegrity { bytes: number; sha256: string }

function check(ok: unknown, why: string): asserts ok { if (!ok) throw new Error(`Invalid patch manifest: ${why}`) }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const positive = (v: unknown): v is number => finite(v) && v > 0
const assetPath = (v: string) => /^[a-zA-Z0-9_./-]+$/.test(v) && !v.startsWith('/') && !v.split('/').includes('..')

/** Validate before any raster allocation/request. V1 remains supported but gains no coarse-data claim. */
export function validateManifest(m: PatchManifest, maxLevels: number): void {
  check(m && (m.version === 1 || m.version === 2), 'unsupported version')
  check(m.site && finite(m.site.lat) && Math.abs(m.site.lat) <= 90 && finite(m.site.lon)
    && finite(m.site.groundM) && finite(m.h0M), 'site/datum')
  check(Array.isArray(m.levels) && m.levels.length > 0 && m.levels.length <= maxLevels, 'level capacity')
  const names = new Set<string>()
  for (const l of m.levels) {
    check(typeof l.name === 'string' && l.name.length > 0 && !names.has(l.name), 'duplicate/missing name')
    names.add(l.name)
    check(Number.isSafeInteger(l.w) && Number.isSafeInteger(l.h) && l.w > 0 && l.h > 0
      && l.w * l.h <= 134217728, `${l.name} raster dimensions`)
    check(positive(l.texelM) && positive(l.texelEastM) && positive(l.texelNorthM)
      && finite(l.eastM) && finite(l.northM), `${l.name} grid`)
    check(!l.heightFormat || ['f16x2', 'f32', 'q16'].includes(l.heightFormat), `${l.name} encoding`)
    if (l.heightFormat === 'q16') check(positive(l.heightStepM), `${l.name} q16 height step`)
    check(l.heights || l.detail, `${l.name} empty level`)
    check(l.maxAltitudeKm === undefined || positive(l.maxAltitudeKm), `${l.name} altitude gate`)
    check(!!l.axisEastPerTexelM === !!l.axisSouthPerTexelM, `${l.name} incomplete rotation`)
    if (l.axisEastPerTexelM && l.axisSouthPerTexelM) {
      const [a, c] = l.axisEastPerTexelM, [b, d] = l.axisSouthPerTexelM
      check([a, b, c, d].every(finite) && Math.abs(a * d - b * c) > 1e-10, `${l.name} singular axes`)
    }
    for (const f of [l.heights, l.detail].filter((v): v is string => !!v)) {
      check(assetPath(f), `${l.name} asset path`)
      if (m.version === 2) {
        const integrity = m.assets?.[f]
        check(integrity && Number.isSafeInteger(integrity.bytes) && integrity.bytes > 0
          && /^[a-f0-9]{64}$/.test(integrity.sha256), `${l.name} asset integrity`)
        const expected = l.w * l.h * (f === l.heights ? (l.heightFormat === 'q16' || !l.heightFormat ? 2 : 4) : 1)
        check(integrity.bytes === expected, `${l.name} declared byte size`)
      }
    }
    if (m.version === 2) {
      const p = l.provenance
      check(p && ['measured', 'reconstructed', 'synthetic-fixture'].includes(p.kind)
        && typeof p.source === 'string' && p.source.length > 0 && typeof p.license === 'string' && p.license.length > 0
        && p.coordinateFrame === 'moon-site-east-north-metres' && p.referenceRadiusM === 1737400
        && typeof p.verticalDatum === 'string' && p.verticalDatum.length > 0
        && finite(p.registrationErrorM) && p.registrationErrorM >= 0, `${l.name} provenance`)
      check(!l.heights || positive(p.heightSourceTexelM), `${l.name} native height resolution`)
      check(!l.detail || positive(p.imageSourceTexelM), `${l.name} native image resolution`)
    }
  }
  check(m.levels.some((l) => l.heights), 'no height fallback')
  for (const channel of ['heights', 'detail'] as const) {
    const levels = m.levels.filter(l => l[channel])
    for (let i = 1; i < levels.length; i++)
      check(levels[i].texelM <= levels[i - 1].texelM, `${channel} levels must be coarse to fine`)
  }
  if (m.capabilities?.includes('continuous-height-mid-v1')) {
    check(m.version === 2 && m.levels.some(l => l.heights && l.provenance?.kind === 'measured'
      && l.w * l.texelEastM >= 140000 && l.h * l.texelNorthM >= 140000
      && (l.maxAltitudeKm ?? 0) >= 250 && (l.provenance.heightSourceTexelM ?? Infinity) <= 120), 'height-only band lacks measured wide coverage')
  }
  if (m.capabilities?.includes('continuous-mid-v1')) {
    check(m.version === 2 && m.levels.some((l) => l.heights && l.texelM >= 30
      && l.provenance?.kind !== 'synthetic-fixture' && (l.maxAltitudeKm ?? 0) >= 250), 'coarse band capability lacks measured coarse heights')
    check(m.levels.some((l) => l.detail && (l.provenance?.imageSourceTexelM ?? Infinity) <= 100
      && l.texelM >= 30 && l.provenance?.kind !== 'synthetic-fixture'), 'coarse band capability lacks image provenance')
  }
}

export function sourceBytes(l: PatchLevel): number {
  return l.w * l.h * ((l.heights ? (l.heightFormat === 'q16' || !l.heightFormat ? 2 : 4) : 0) + (l.detail ? 1 : 0))
}
export function samplerCount(levels: readonly PatchLevel[]): number {
  return levels.reduce((n, l) => n + Number(!!l.heights) + Number(!!l.detail), 0)
}

/**
 * Keep a coarse fallback and the finest declared source inside the patch shader's sampler budget. When there is room,
 * retain additional levels from fine to coarse so the closest imagery and height detail remain available.
 */
export function levelsWithinSamplerBudget(levels: readonly PatchLevel[], budget: number): PatchLevel[] {
  if (!levels.length || budget < 0) return []
  if (samplerCount(levels) <= budget) return [...levels]
  const first = levels[0], firstCost = samplerCount([first])
  if (firstCost > budget) return []
  if (levels.length === 1) return [first]
  const last = levels[levels.length - 1], lastCost = samplerCount([last])
  if (firstCost + lastCost > budget) return [first]
  const kept = new Set<PatchLevel>([first, last])
  let used = firstCost + lastCost
  for (let i = levels.length - 2; i > 0; i--) {
    const level = levels[i], cost = samplerCount([level])
    if (used + cost <= budget) { kept.add(level); used += cost }
  }
  return levels.filter((level) => kept.has(level))
}
