import { gazetteerTable, loadGazetteer } from '../labels/gazetteerTable'
import { GLOBAL_TEXEL_KM, effectiveFootprintKm } from '../moon/tiles/wanted'
import { DEEPEST_LEVEL, H_TEXEL_KM, MOON_R_KM } from '../moon/tiles/grid'
import { COARSEST_LEVEL, finestWanted } from '../moon/tiles/levels'
import { prefeatOn, type PrefetchTarget } from './prefetch'

export interface FlightPrefetchPose { lon: number; lat: number; dist: number; pitch?: number; roll?: number }
export interface FlightPrefetchView { pose: FlightPrefetchPose; fovDeg: number }
interface Feature { id: number; name: string; kind: string; lon: number; lat: number; diameterKm: number }
/** The rows, and their indices sorted by latitude (radians in `lat`), so a sample visits only the rows of its latitude band. */
interface FeatureIndex { rows: Feature[]; order: Int32Array; lat: Float64Array; all: Int32Array }
let featureRows: { src: object; index: FeatureIndex } | null = null
const NO_FEATURES: FeatureIndex = { rows: [], order: new Int32Array(0), lat: new Float64Array(0), all: new Int32Array(0) }
/**
 * The Gazetteer's features as prefetch rows. The table is a lazy chunk (gazetteerTable.ts): until it has loaded there are none, and a
 * flight planned in that window prefetches its path centres only (the tile-centre ladder), as the opening already does.
 */
function gazetteerFeatures(): FeatureIndex {
  const t = gazetteerTable()
  if (!t) { void loadGazetteer().catch(() => undefined); return NO_FEATURES }
  if (featureRows?.src !== t) {
    const rows = (t.features as unknown as Array<[number, string, string, number, number, number]>).map(
      ([id, name, kind, lon, lat, diameterKm]): Feature => ({ id, name, kind, lon, lat, diameterKm }),
    )
    const order = Int32Array.from(rows.keys()).sort((a, b) => rows[a]!.lat - rows[b]!.lat)
    featureRows = { src: t, index: { rows, order, lat: Float64Array.from(order, (i) => rows[i]!.lat * DEG), all: Int32Array.from(rows.keys()) } }
  }
  return featureRows.index
}
/** First position in `sorted` whose value is >= x. */
function lowerBound(sorted: Float64Array, x: number): number {
  let lo = 0, hi = sorted.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid]! < x) lo = mid + 1; else hi = mid }
  return lo
}
/**
 * Indices (ascending, the table's own order) of the rows whose latitude is within `reach` radians of `q`, a small margin wider: the
 * caller's exact test decides, so the result is the same as a scan of every row, in the same order (the 8-a-sample cap depends on it).
 */
function featuresInBand(index: FeatureIndex, q: number, reach: number): Int32Array {
  const margin = 1e-9 + reach * 1e-9
  const from = lowerBound(index.lat, q - reach - margin), to = lowerBound(index.lat, q + reach + margin)
  // A wide band (a view from far out) costs less as a scan of every row than as a sort; a typed array sorts numerically without a comparator.
  return to - from > index.rows.length / 8 ? index.all : index.order.slice(from, to).sort()
}
const DEG = Math.PI / 180
/** A gazetteer feature is prefetched only where it projects over this many pixels. */
const FEATURE_MIN_PX = 40
/** Canvas height the centre ladder has always assumed; the feature cap uses the real one (`heightPx`). */
const DEFAULT_HEIGHT_PX = 1080

/** Ground intersection of the centre ray (falls back to nadir when it misses the Moon). */
function centreGround(pose: FlightPrefetchPose): { lon: number; lat: number } {
  const pitch = Math.max(0, pose.pitch ?? 0) * DEG
  const r = pose.dist, disc = 1 - r * r * Math.sin(pitch) ** 2
  if (disc <= 0 || pitch < 1e-8) return { lon: pose.lon, lat: pose.lat }
  const ray = r * Math.cos(pitch) - Math.sqrt(disc)
  const delta = Math.atan2(ray * Math.sin(pitch), r - ray * Math.cos(pitch))
  const bearing = -(pose.roll ?? 0) * DEG
  const lat1 = pose.lat * DEG, lon1 = pose.lon * DEG
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(bearing))
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(delta) * Math.cos(lat1), Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2))
  return { lon: ((lon2 / DEG + 540) % 360) - 180, lat: lat2 / DEG }
}

/** Range (Moon radii) and incidence cosine of the ray `off` radians from nadir, from a camera at `dist` radii; null when it misses the Moon. */
function rayHit(dist: number, off: number): { range: number; mu: number } | null {
  const disc = 1 - dist * dist * Math.sin(off) ** 2
  if (disc <= 0) return null
  const range = dist * Math.cos(off) - Math.sqrt(disc)
  const dx = Math.sin(off), dy = -Math.cos(off)
  const px = range * dx, py = dist + range * dy
  return { range, mu: Math.max(0.15, -(px * dx + py * dy)) }
}

/**
 * The finest height level the streamer wants at a flight sample, with the whole ladder open. It follows the streamer's own rule
 * (wanted.ts: per-ray range x canvasTanPerPx, incidence-corrected, anisotropic) on the centre ray and on the lowest ray of the frame
 * (the nearest ground), whichever is finer. `heightPx` is the streamer's `ch`. `pxKm` is the centre pixel's ground size, km.
 */
export function wantedFineAt(pose: FlightPrefetchPose, fovDeg: number, heightPx: number): { level: number; pxKm: number } {
  const h = Math.max(1, heightPx), tanHalf = Math.tan(fovDeg * DEG / 2)
  const pitch = Math.max(0, pose.pitch ?? 0) * DEG
  const levelOf = (off: number): { level: number; pxKm: number } | null => {
    const hit = rayHit(pose.dist, off)
    if (!hit) return null
    const pxKm = Math.max(1e-6, hit.range * MOON_R_KM * 2 * tanHalf / h)
    const footprint = effectiveFootprintKm(pxKm, hit.mu)
    return { level: Math.min(COARSEST_LEVEL, footprint / GLOBAL_TEXEL_KM >= 0.9 ? COARSEST_LEVEL : finestWanted(footprint, H_TEXEL_KM, 2, DEEPEST_LEVEL)), pxKm }
  }
  const centre = levelOf(pitch) ?? { level: COARSEST_LEVEL, pxKm: Math.max(1e-6, (pose.dist - 1) * MOON_R_KM * 2 * tanHalf / h) }
  const low = levelOf(Math.max(0, pitch - Math.atan(tanHalf)))
  return { level: Math.min(centre.level, low?.level ?? COARSEST_LEVEL), pxKm: centre.pxKm }
}

/**
 * Build a bounded, ordered ahead-of-camera tile request list for a known flight.
 * Tiles are assigned to their first-need sample and requested two seconds early.
 * The centre footprint follows the same anisotropic footprint and LOD ladder as
 * the live streamer's terrain sampler.
 */
export function flightPrefetchTargets(
  poseAt: (u: number) => FlightPrefetchView,
  durationMs: number,
  viewport: { aspect: number; fovDeg?: number; samples?: number; leadMs?: number; /** false: tile centres only, no gazetteer-feature targets (default true). */ features?: boolean; /** Deepest level asked for (default: all the ladder gives). */ minLevel?: number; /** Cap feature levels and drop small features (default: off, `?prefeat=1` turns it on). */ featureCaps?: boolean; /** Canvas height in device pixels (the streamer's `ch`); the feature cap needs it. Default 1080, for tests. */ heightPx?: number; /** Texels per pixel the level is chosen at (default 2, the streamer's WANT_TEXELS; a sharp flight passes WANT_TEXELS_FLIGHT). */ texels?: number },
): PrefetchTarget[] {
  const samples = Math.max(40, Math.floor(viewport.samples ?? 48))
  const lead = viewport.leadMs ?? 2000
  const caps = viewport.featureCaps ?? prefeatOn()
  const firstNeed = new Map<string, { target: PrefetchTarget; at: number }>()
  const featureNeed = new Map<string, { target: PrefetchTarget; at: number }>()
  for (let i = 0; i <= samples; i++) {
    const u = i / samples
    const { pose, fovDeg } = poseAt(u)
    const centre = centreGround(pose)
    const fov = (viewport.fovDeg ?? fovDeg) * DEG
    const altitudeKm = Math.max(1e-6, pose.dist - 1) * MOON_R_KM
    const minorKm = Math.max(1e-6, 2 * altitudeKm * Math.tan(fov / 2) / 1080)
    const footprint = effectiveFootprintKm(minorKm, Math.max(0.15, Math.cos((pose.pitch ?? 0) * DEG)))
    const wanted = Math.min(COARSEST_LEVEL, footprint / GLOBAL_TEXEL_KM >= 0.9 ? COARSEST_LEVEL : finestWanted(footprint, H_TEXEL_KM, viewport.texels ?? 2, 0))
    const deepest = Math.min(COARSEST_LEVEL, Math.max(wanted, viewport.minLevel ?? -Infinity))
    // What the streamer wants here with the whole ladder open: the finest level a feature tile can be useful at this sample.
    // Pixel basis of the streamer (canvasTanPerPx = tanHalf / (ch / 2)) and the slant range to the centre ray's ground point.
    const { level: wantedFine, pxKm: featureMinorKm } = wantedFineAt(pose, fov / DEG, viewport.heightPx ?? DEFAULT_HEIGHT_PX)
    const levels = Array.from({ length: COARSEST_LEVEL - deepest + 1 }, (_, n) => deepest + n)
    const at = Math.max(0, u * durationMs - lead)
    const key = `${centre.lon.toFixed(3)}/${centre.lat.toFixed(3)}/${deepest}`
    if (!firstNeed.has(key)) firstNeed.set(key, { target: { lon: centre.lon, lat: centre.lat, levels }, at })

    // A feature enters the view when its angular distance is within the
    // horizontal/vertical camera swath plus half its own radius.
    // Convert the view cone into a surface angle using the camera altitude.
    // FOV alone is not a surface angle, especially for a close pass.
    const altitudeR = Math.max(0, pose.dist - 1)
    const halfHorizontal = Math.atan(Math.tan(fov / 2) * Math.max(1, viewport.aspect))
    const cameraR = 1 + altitudeR
    const disc = 1 - cameraR * cameraR * Math.sin(halfHorizontal) ** 2
    const surfaceHalf = disc <= 0 ? Math.acos(1 / cameraR) : (() => {
      const ray = cameraR * Math.cos(halfHorizontal) - Math.sqrt(disc)
      return Math.atan2(ray * Math.sin(halfHorizontal), cameraR - ray * Math.cos(halfHorizontal))
    })()
    // Keep the true geometric surface footprint and add only the requested
    // 25% safety margin. Altitude is already accounted for by surfaceHalf.
    const swath = surfaceHalf
    if (viewport.features === false) continue
    let featuresAtSample = 0
    const q = centre.lat * DEG, reach2 = (swath * 1.25) ** 2
    const index = gazetteerFeatures()
    // Only the rows in the swath's latitude band (the test below adds the longitude term to the same latitude term): 9,080 rows
    // a sample were most of a pick's frame on a slow CPU (rig 2026-10-30).
    for (const n of featuresInBand(index, q, swath * 1.25)) {
      const f = index.rows[n]!
      const p = f.lat * DEG
      if ((p - q) * (p - q) > reach2) continue
      let dLon = f.lon - centre.lon
      dLon = ((dLon + 540) % 360) - 180
      const latDelta = p - q, lonDelta = dLon * DEG * Math.cos(q)
      if (latDelta * latDelta + lonDelta * lonDelta > reach2) continue
      const dl = dLon * DEG
      const angle = Math.acos(Math.max(-1, Math.min(1, Math.sin(p) * Math.sin(q) + Math.cos(p) * Math.cos(q) * Math.cos(dl))))
      if (angle > swath * 1.25 + f.diameterKm / (2 * MOON_R_KM)) continue
      if (featuresAtSample >= 8) break
      // A feature narrower than ~40 px at this sample is not worth fine tiles; its deepest level is what the streamer
      // wants at this sample (`wantedFine`, real canvas height, slant range).
      if (caps && f.diameterKm / featureMinorKm < FEATURE_MIN_PX) continue
      featuresAtSample++
      const featureKey = `feature:${f.id}`
      const floor = caps ? Math.max(wantedFine, viewport.minLevel ?? -Infinity) : DEEPEST_LEVEL
      const prev = featureNeed.get(featureKey)
      const fine = Math.min(floor, prev ? prev.target.levels![0]! : floor)
      const featureLevels = Array.from({ length: COARSEST_LEVEL - fine + 1 }, (_, n) => fine + n)
      if (!prev || at < prev.at || fine < prev.target.levels![0]!) featureNeed.set(featureKey, { target: { lon: f.lon, lat: f.lat, levels: featureLevels, finestFirst: true }, at: prev ? Math.min(at, prev.at) : at })
    }
  }
  const centres = [...firstNeed.values()].sort((a, b) => a.at - b.at)
  const features = [...featureNeed.values()].sort((a, b) => a.at - b.at).slice(0, 160)
  const ordered = [...centres, ...features]
  const seen = new Set<string>()
  return ordered.filter(({ target }) => {
    const key = `${target.lon.toFixed(3)}/${target.lat.toFixed(3)}/${target.levels?.join(',')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 200).map(({ target }) => target)
}
