import { LABELS, type MoonLabel } from './data'
import { whenGazetteer } from './gazetteerTable'

const DEG = Math.PI / 180
export type SphericalBin = { items: MoonLabel[]; center: [number, number, number] }

/** Index feature coordinates in 10° equirectangular cells with a spherical center for conservative cone searches. */
export function makeSphericalBins(labels: MoonLabel[], binDeg = 10): Map<number, SphericalBin> {
  const lonBins = Math.ceil(360 / binDeg), latBins = Math.ceil(180 / binDeg)
  const bins = new Map<number, SphericalBin>()
  for (const label of labels) {
    const latBin = Math.max(0, Math.min(latBins - 1, Math.floor((label.lat + 90) / binDeg)))
    const lonBin = Math.max(0, Math.min(lonBins - 1, Math.floor((label.lon + 180) / binDeg)))
    const key = latBin * lonBins + lonBin
    const bin = bins.get(key)
    if (bin) { bin.items.push(label); continue }
    const lat = (-90 + (latBin + 0.5) * binDeg) * DEG
    const lon = (-180 + (lonBin + 0.5) * binDeg) * DEG
    const c = Math.cos(lat)
    bins.set(key, { items: [label], center: [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)] })
  }
  return bins
}

/** Return every feature in cells whose spherical caps intersect the requested search cone. */
export function candidatesInSphericalCone(bins: Map<number, SphericalBin>, x: number, y: number, z: number, radiusDeg: number, binCapDeg = 8.5): MoonLabel[] {
  const paddedRadius = Math.min(Math.PI, (radiusDeg + binCapDeg) * DEG)
  const minDot = Math.cos(paddedRadius)
  const result: MoonLabel[] = []
  for (const bin of bins.values()) {
    if (bin.center[0] * x + bin.center[1] * y + bin.center[2] * z >= minDot) result.push(...bin.items)
  }
  return result
}

export function unitVector(latDeg: number, lonDeg: number): [number, number, number] {
  const lat = latDeg * DEG, lon = lonDeg * DEG, c = Math.cos(lat)
  return [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)]
}

export interface LabelIndex { units: Map<string, [number, number, number]>; bins: Map<number, SphericalBin> }
let indexed: { src: MoonLabel[]; index: LabelIndex } | null = null
/**
 * Unit vector (Moon frame: x to lon 0, z north) of every label by id, and the spherical bins over all of them: one build, shared by the
 * labels layer and the centre caption. Rebuilt once when the Gazetteer arrives (LABELS is replaced then); built from the sites alone before.
 */
export function labelIndex(): LabelIndex {
  if (!indexed || indexed.src !== LABELS) {
    indexed = { src: LABELS, index: { units: new Map(LABELS.map((l) => [l.id, unitVector(l.lat, l.lon)])), bins: makeSphericalBins(LABELS) } }
  }
  return indexed.index
}
// Build it when the table lands, not on the first caption or label frame that needs it.
whenGazetteer(() => { labelIndex() })
