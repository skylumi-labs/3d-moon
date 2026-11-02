/**
 * The centre caption's picker: which named feature stands under the middle of the screen. Pure functions on plain data (Moon frame:
 * x to longitude 0, z north), so every rule is testable without a renderer.
 *
 * A pick has two parts. The HIT is where the centre ray meets the drawn surface: preferably read back from the renderer's own hit
 * target (exactly what is drawn, error = one pixel), else a CPU estimate from the retained level-2 height map (`fallbackHit`), which
 * carries a positional-error model. The CHOICE is the feature that hit belongs to, accepted only when the margin to every boundary that
 * could change the answer exceeds the hit's error (the uncertainty gate).
 */
import { LABELS, type MoonLabel } from './data'
import { candidatesInSphericalCone, labelIndex, unitVector } from './spatial'
import { whenGazetteer } from './gazetteerTable'
import { MOON_R_KM as R_KM } from '../glsl/common'
import { prominentAmong, PROM_RELAX, type ProjCam, type PromRow } from './centreProminence'

const RAD = Math.PI / 180
export type V3 = readonly [number, number, number]

/** Fraction of the frame's ground span a feature must cover to be named at all (the labels layer's own floors, declutter.ts). */
const MIN_SHARE = { mare: 0.12, other: 0.05 } as const
/**
 * FIT SCORING (owner feedback 2026-10-31: "over Copernicus at 1.27 radii it names Oceanus Procellarum"). The caption names the feature AT or NEAREST the centre
 * AT A SENSIBLE SCALE, not the smallest outline that happens to contain the point: a 2,600 km "ocean" contains half the near side, and naming it from a frame
 * 250 km wide says nothing about what is on screen. Every candidate gets
 *
 *   score = position(d, r, S) x scale(D / S)   (x LINEAR_WEIGHT for rimae, ranges and other linear or unknown classes)
 *
 * with d the great-circle distance from the hit to the feature's centre (km), r = D / 2 its radius (a linear feature: half its length), D its IAU diameter
 * and S the frame's short-side ground span.
 *   position: 1 at the feature's centre, falling to RIM_SCORE at the rim (1 - (1 - RIM_SCORE) (d / r)^2 inside), then linearly to 0 at OUT_SHARE x S beyond
 *             the rim. Continuous, so the rim is not a cliff; "beyond the rim" is measured against the frame, so a crater whose rim is near the centre of the
 *             frame still counts and one a third of a frame away does not.
 *   scale:    1 while the feature is between FIT_LO and FIT_HI frames across (readable and on screen), D / S / FIT_LO below (a speck), FIT_HI x S / D above
 *             (a backdrop much larger than the frame).
 * The highest score wins (ties: the smaller feature, then the id); below MIN_SCORE nothing is named. Worked example, Copernicus at 1.27 radii (S = 251 km):
 * the centre on Copernicus scores 1.0, Oceanus Procellarum 0.80 x 0.15 = 0.12; with the centre 32 km beyond Copernicus' rim, Copernicus still scores 0.34.
 * Intended consequence: the middle of a big mare seen from a frame much smaller than it (Mare Imbrium from 50-120 km) names nothing, or the crater or
 * ridge at the centre, rather than the mare. Known limitation: the Gazetteer gives a linear feature only a centre point and a length, so it is scored as
 * a disc of half its length around that point; a ring range (Montes Rook, Cordillera: centred on the basin, with no mountains there) or a long rille
 * scores far off its line. LINEAR_WEIGHT keeps such features behind discs; a distance-to-the-line term needs geometry the catalogue does not have.
 */
export const FIT_LO = 0.1
export const FIT_HI = 1.5
export const RIM_SCORE = 0.7
export const OUT_SHARE = 0.25
export const LINEAR_WEIGHT = 0.6
export const MIN_SCORE = 0.2
/** A retained name stays while it scores at least this share of the best candidate (a new name must be twice as good to replace it: no flicker between neighbours). */
export const RETAIN_SHARE = 0.5
/** The active viewpoint's own feature (its pill names it) scores this much more, so arriving at "Copernicus Crater" names Copernicus (est). */
export const PREFER_BOOST = 1.5
/** A retained name stays while the hit is within this much beyond its entry radius (est). */
export const HYST = 0.2
/** A choice is certain when the same feature wins everywhere within (hit error) / GATE of the hit (est): checked on rings of that radius and half of it. */
export const GATE = 0.25
/** Directions sampled on the outer ring (the inner ring uses half, offset); the check is a sampling, not an exact boundary distance. */
const RING_DIRS = 24
/** Texel pitch of the retained level-2 height mip, km (maps.ts: about 10 km). */
export const TEXEL_KM_L2 = 10.66
/** Fallback only: a feature smaller than this many texels has relief the retained map cannot resolve (est). */
const UNRESOLVED_TEXELS = 3
/** Fallback only: depth over diameter assumed for relief the map cannot resolve (an upper bound for fresh craters, est). */
const UNRESOLVED_DEPTH_RATIO = 0.2
const BIG_KM = 300
/** Slack (km, along the ray) beyond the predicted range's own error before a rendered range counts as an obstruction: relief the retained level-2 map cannot see. */
export const OCCLUSION_FLOOR_KM = 2

const DISC_CLASSES = new Set([
  'Crater, craters', 'Satellite Feature', 'Astronaut-named features', 'Mare, maria', 'Lacus, lacūs', 'Sinus, sinūs', 'Palus, paludes', 'Oceanus, oceani', 'Planitia, planitiae',
])
const LINEAR_CLASSES = new Set([
  'Rima, rimae', 'Dorsum, dorsa', 'Vallis, valles', 'Catena, catenae', 'Rupes, rupēs', 'Mons, montes', 'Promontorium, promontoria',
])

type FeatureRow = MoonLabel & { sizeKm: number }
const named = (l: MoonLabel): l is FeatureRow => l.kind !== 'site' && typeof l.sizeKm === 'number' && l.sizeKm > 0
interface PickTables { FEATURES: FeatureRow[]; BY_ID: Map<string, MoonLabel>; BIG: FeatureRow[]; MAX_SMALL_RAD: number }
let tabled: { src: MoonLabel[]; t: PickTables } | null = null
/** The picker's tables over LABELS; rebuilt once when the Gazetteer arrives, sites only (no features to pick) before. */
function tables(): PickTables {
  if (!tabled || tabled.src !== LABELS) {
    const FEATURES: FeatureRow[] = LABELS.filter(named)
    const small = FEATURES.filter((l) => l.sizeKm < BIG_KM).map((l) => l.sizeKm / 2 / R_KM)
    tabled = { src: LABELS, t: { FEATURES, BY_ID: new Map(LABELS.map((l) => [l.id, l])), BIG: FEATURES.filter((l) => l.sizeKm >= BIG_KM), MAX_SMALL_RAD: small.length ? Math.max(...small) : 0 } }
  }
  return tabled.t
}
whenGazetteer(() => { tables() })

export type FeatureClass = 'disc' | 'linear' | 'unknown'
export function classOf(l: MoonLabel): FeatureClass {
  const t = l.featureType ?? ''
  if (DISC_CLASSES.has(t)) return 'disc'
  if (LINEAR_CLASSES.has(t)) return 'linear'
  return 'unknown'
}
export const labelById = (id: string): MoonLabel | undefined => tables().BY_ID.get(id)

/** Where the centre ray met the surface, and how far off that may be. */
export interface CentreHit {
  lonDeg: number
  latDeg: number
  /** Lateral position error, km (Infinity when the hit is unknown or unreliable). */
  errKm: number
  /** Fallback only: tan(elevation of the ray over the local horizontal) and the effective relief factor, for the unresolved-relief term. */
  tanElev?: number
  reliefScale?: number
  /** True for the CPU estimate (retained level-2 map), false for the rendered hit. */
  fallback: boolean
  /** The ray this hit was measured along (a rendered hit): its origin, unit direction and the rendered range in Moon radii. */
  ray?: { pos: V3; dir: V3; rangeRadii: number }
  /** CPU estimate only: the predicted range along its ray (Moon radii) and the 1-sigma range error (km), from the sampled height, the relief scale and the decode/slope error. */
  rangeRadii?: number
  sigmaRangeKm?: number
  /** Set from comparing the rendered range with an independently predicted one: how far (km, beyond the tolerance) the rendered surface is NEARER than predicted, i.e. an obstruction. */
  occludedKm?: number
}

export interface Retained { id: string; acceptRad: number; /** Named by prominence from an unknown hit: a later certain contradiction (a smaller container) is not shielded by retention. */ provisional?: boolean }
export interface CentreChoice { label: MoonLabel; mode: 'contain' | 'near' | 'prominent'; angleRad: number; entryRad: number; errKm: number; marginKm: number; /** A prominence-only pick made without a known hit. */ provisional?: boolean; /** The fit score it won with (FIT SCORING); absent for a prominence pick. */ score?: number }
export interface PickResult {
  /** 'ok': a name; 'none': no feature there; 'uncertain': the hit is too uncertain to name anything. */
  status: 'ok' | 'none' | 'uncertain'
  choice: CentreChoice | null
  /** For 'uncertain': the candidate the gate rejected. Uncertainty never authorises promotion to a LARGER feature than a smaller container, so prominence compares against it. */
  rejected?: CentreChoice | null
  /** The retained name still holds at this hit, with the hit certain enough that it does. */
  retainedHolds: boolean
}

const angleBetween = (a: V3, b: V3): number => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))
export const radiusRad = (l: { sizeKm: number }): number => l.sizeKm / 2 / R_KM

/** A feature is named only while it is a readable share of the frame. */
function eligible(l: FeatureRow, spanKm: number): boolean {
  return l.sizeKm / spanKm >= (l.kind === 'mare' ? MIN_SHARE.mare : MIN_SHARE.other)
}

/** The position term: 1 at the centre, RIM_SCORE at the rim, 0 at OUT_SHARE x span beyond it (see FIT SCORING). */
export function positionScore(distKm: number, radiusKm: number, spanKm: number): number {
  if (distKm <= radiusKm) { const q = distKm / Math.max(1e-9, radiusKm); return 1 - (1 - RIM_SCORE) * q * q }
  return RIM_SCORE * Math.max(0, 1 - (distKm - radiusKm) / (OUT_SHARE * spanKm))
}
/** The scale term: 1 between FIT_LO and FIT_HI frames across, falling off in proportion outside (see FIT SCORING). */
export function scaleScore(sizeKm: number, spanKm: number): number {
  const s = sizeKm / spanKm
  return s < FIT_LO ? s / FIT_LO : s > FIT_HI ? FIT_HI / s : 1
}
/** The fit score of a feature whose centre is `distKm` from the hit, in a frame `spanKm` across (see FIT SCORING). */
export function fitScore(l: { sizeKm: number; featureType?: string }, distKm: number, spanKm: number): number {
  const base = positionScore(distKm, l.sizeKm / 2, spanKm) * scaleScore(l.sizeKm, spanKm)
  return classOf(l as MoonLabel) === 'disc' ? base : LINEAR_WEIGHT * base
}
/** How far (angle) beyond its centre a feature can still score: its radius plus OUT_SHARE of the span. */
export const reachRad = (l: { sizeKm: number }, spanKm: number): number => radiusRad(l) + OUT_SHARE * spanKm / R_KM

/** Candidate rows for a hit: every big feature plus the cone query for the rest, widened by `extraKm` (verified against brute force in the tests). */
export function candidatesFor(unit: V3, spanKm: number, extraKm = 0): FeatureRow[] {
  const coneDeg = (tables().MAX_SMALL_RAD + (OUT_SHARE * spanKm + extraKm) / R_KM) / RAD
  const seen = new Set<string>()
  const out: FeatureRow[] = []
  for (const l of [...tables().BIG, ...candidatesInSphericalCone(labelIndex().bins, unit[0], unit[1], unit[2], coneDeg)]) {
    if (!named(l) || seen.has(l.id)) continue
    seen.add(l.id)
    out.push(l)
  }
  return out
}

/** The CPU-model error that relief the map cannot resolve adds for a feature of this size (fallback hits only), km. */
function unresolvedErrKm(hit: CentreHit, l: FeatureRow): number {
  if (!hit.fallback || l.sizeKm >= UNRESOLVED_TEXELS * TEXEL_KM_L2) return 0
  const tan = Math.max(1e-3, hit.tanElev ?? 1e-3)
  return UNRESOLVED_DEPTH_RATIO * l.sizeKm * (hit.reliefScale ?? 1) / tan
}

/**
 * The feature under a hit. `spanKm` is the frame's short-side ground span. `retained` (the name on screen or last shown) is judged
 * separately: it holds while the hit is within its accept radius and certain.
 */
export function pickCentre(hit: CentreHit, spanKm: number, retained?: Retained | null, view?: ProjCam | null, prefer?: readonly string[] | null): PickResult {
  let base = pickByHit(hit, spanKm, retained, prefer)
  if (!view) return base
  const unknown = !Number.isFinite(hit.errKm) || !Number.isFinite(hit.lonDeg) || !Number.isFinite(hit.latDeg)
  // A prominence-only name chosen from an unknown hit is provisional: a later CERTAIN hit inside a smaller container replaces it (retention does not shield it).
  const retainedLabel = retained ? labelById(retained.id) : undefined
  const contradicted = !!(retained?.provisional && base.status === 'ok' && base.choice && base.choice.mode === 'contain' && base.choice.label.id !== retained.id
    && retainedLabel && named(retainedLabel) && named(base.choice.label) && base.choice.label.sizeKm < retainedLabel.sizeKm)
  if (contradicted) base = { ...base, retainedHolds: false }
  return withProminence(base, hit, unknown, contradicted, spanKm, retained, view, prefer)
}

/**
 * Screen-space prominence (owner decision): a crater (any non-mare disc feature) whose projected disc is large and whose rim comes close to the screen
 * centre is named even when the exact centre point lies just outside its rim, because that is what the visitor is looking at. It replaces the
 * fit-scoring answer only when that answer is nothing, a linear or unknown-class feature, or a LARGER feature (a mare); a smaller crater keeps it. A feature that was prominent stays prominent under relaxed thresholds, so two similar craters do not trade places.
 */
function withProminence(base: PickResult, hit: CentreHit, unknown: boolean, contradicted: boolean, spanKm: number, retained: Retained | null | undefined, view: ProjCam, prefer?: readonly string[] | null): PickResult {
  // Prominence is screen-space geometry of the presented camera: it does not depend on the terrain hit, so it also works when the hit is uncertain or
  // unknown (a CPU estimate with the height map pending). The neighbourhood is searched around the centre ray's point on the sphere (the relief moves it by km).
  const centre = raySphereV(view.pos, [-view.back[0], -view.back[1], -view.back[2]], 1)
  if (!centre) return base
  const u = centre
  // A rendered hit whose range falls SHORT of an independently predicted one (CPU height sample, same relief scale, same texel ray) means something stands in
  // front of the crater (a ridge): it may be hidden. Depressions and ordinary elevation shift the hit along the ray but not short of the prediction.
  if (!unknown && !hit.fallback && hit.occludedKm !== undefined && hit.occludedKm > 0) return base
  // A rim near the screen centre is near the hit on the ground: the nearby craters, widened by the margin's ground reach at a low elevation.
  const reach = (tables().MAX_SMALL_RAD + 0.6 * spanKm / R_KM)
  const rowOf = (l: MoonLabel): PromRow | null => {
    const v = labelIndex().units.get(l.id)
    return v && named(l) && l.kind === 'crater' && classOf(l) === 'disc' ? { id: l.id, unit: v, rho: radiusRad(l) } : null
  }
  const rows: PromRow[] = []
  const seen = new Set<string>()
  for (const l of [...tables().BIG, ...candidatesInSphericalCone(labelIndex().bins, u[0], u[1], u[2], reach / RAD)]) {
    if (seen.has(l.id)) continue
    seen.add(l.id)
    const row = rowOf(l)
    if (row && angleBetween(u, row.unit) <= row.rho + reach) rows.push(row)
  }
  const retainedRow = retained ? rowOf(labelById(retained.id) ?? ({} as MoonLabel)) : null
  // A retained crater that is still prominent (relaxed) keeps the name: no jump.
  if (retained && retainedRow && !contradicted && prominentAmong(view, [retainedRow], PROM_RELAX).length) return { ...base, retainedHolds: true }
  const best = prominentAmong(view, rows)[0]
  if (!best) return base
  const label = labelById(best.id)
  if (!label || !named(label)) return base
  let current = base.choice ?? base.rejected ?? null
  let fromProxy = false
  if (unknown && !current) {
    // No hit to judge a smaller container by: the centre ray's point on the sphere stands in for it, so an unknown hit cannot promote past a smaller container.
    const proxy = pickByHit({ lonDeg: Math.atan2(u[1], u[0]) / RAD, latDeg: Math.asin(Math.max(-1, Math.min(1, u[2]))) / RAD, errKm: 0, fallback: false }, spanKm, null, prefer)
    current = proxy.choice ?? proxy.rejected ?? null
    fromProxy = true
  }
  const retainedLabel = retained ? labelById(retained.id) : undefined
  const retainedLarger = !!(retainedLabel && named(retainedLabel) && retainedLabel.sizeKm > label.sizeKm)
  // Fit scoring already names a disc whose rim is near the centre ('near' mode is a scored choice, not a guess): only nothing, a linear or unknown-class feature,
  // or a LARGER feature gives way to a prominent crater.
  const replaces = !current || (fromProxy && current.label.id === label.id)
    || (current.label.id !== label.id && (classOf(current.label) !== 'disc' || (named(current.label) && current.label.sizeKm > label.sizeKm)))
  if (!replaces || (base.retainedHolds && !retainedLarger)) return base
  const v = labelIndex().units.get(label.id)!
  const choice: CentreChoice = { label, mode: 'prominent', angleRad: angleBetween(u, v), entryRad: radiusRad(label), errKm: 0, marginKm: Infinity, ...(unknown ? { provisional: true } : {}) }
  return { status: 'ok', choice, retainedHolds: false }
}

/** The point `km` from `u` along the unit tangent direction at angle `th` (the ring of the certainty check). */
function offsetPoint(u: V3, th: number, km: number): V3 {
  const ref: V3 = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const e1x = u[1] * ref[2] - u[2] * ref[1], e1y = u[2] * ref[0] - u[0] * ref[2], e1z = u[0] * ref[1] - u[1] * ref[0]
  const l1 = Math.hypot(e1x, e1y, e1z) || 1
  const e1: V3 = [e1x / l1, e1y / l1, e1z / l1]
  const e2: V3 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]]
  const a = km / R_KM, c = Math.cos(a), s = Math.sin(a), ct = Math.cos(th), st = Math.sin(th)
  return [u[0] * c + (e1[0] * ct + e2[0] * st) * s, u[1] * c + (e1[1] * ct + e2[1] * st) * s, u[2] * c + (e1[2] * ct + e2[2] * st) * s]
}

function pickByHit(hit: CentreHit, spanKm: number, retained?: Retained | null, prefer?: readonly string[] | null): PickResult {
  if (!Number.isFinite(hit.errKm) || !Number.isFinite(hit.lonDeg) || !Number.isFinite(hit.latDeg)) return { status: 'uncertain', choice: null, retainedHolds: false }
  const u = unitVector(hit.latDeg, hit.lonDeg)
  // The unresolved-relief term of a fallback hit grows with the feature's smallness; the largest any eligible candidate could add bounds the search ring.
  const maxUnres = hit.fallback ? UNRESOLVED_DEPTH_RATIO * UNRESOLVED_TEXELS * TEXEL_KM_L2 * (hit.reliefScale ?? 1) / Math.max(1e-3, hit.tanElev ?? 1e-3) : 0
  const searchKm = Math.min((hit.errKm + maxUnres) / GATE, 2 * spanKm)
  const cands = candidatesFor(u, spanKm, searchKm).filter((l) => eligible(l, spanKm))
  const units = cands.map((l) => labelIndex().units.get(l.id)!)
  const boost = (id: string): number => (prefer && prefer.includes(id) ? PREFER_BOOST : 1)
  const scoreOf = (l: FeatureRow, v: V3, p: V3): number => fitScore(l, angleBetween(p, v) * R_KM, spanKm) * boost(l.id)
  /** The winner at a point: highest score, then the smaller feature, then the id. */
  const winnerAt = (p: V3): { i: number; score: number; second: number } => {
    let i = -1, best = 0, second = -1, secondScore = 0
    for (let k = 0; k < cands.length; k++) {
      const sc = scoreOf(cands[k], units[k], p)
      if (!(sc > 0)) continue
      const better = i < 0 || sc > best || (sc === best && (cands[k].sizeKm < cands[i].sizeKm || (cands[k].sizeKm === cands[i].sizeKm && cands[k].id < cands[i].id)))
      if (better) { if (i >= 0) { second = i; secondScore = best } i = k; best = sc }
      else if (second < 0 || sc > secondScore) { second = k; secondScore = sc }
    }
    return { i: best >= MIN_SCORE ? i : -1, score: best, second }
  }
  const w = winnerAt(u)

  // The certainty radius: the hit's own error plus the unresolved relief of the winner and its closest rival, over the gate.
  const unres = Math.max(w.i >= 0 ? unresolvedErrKm(hit, cands[w.i]) : 0, w.second >= 0 ? unresolvedErrKm(hit, cands[w.second]) : 0)
  const errKm = hit.errKm + unres
  const ringKm = errKm / GATE
  const ring: V3[] = []
  // An error ring wider than the searched candidates (2 frames) cannot be checked: such a hit names nothing new.
  const tooWide = ringKm > searchKm + 1e-9
  if (ringKm > 1e-6 && !tooWide) {
    for (let k = 0; k < RING_DIRS; k++) ring.push(offsetPoint(u, (2 * Math.PI * k) / RING_DIRS, ringKm))
    for (let k = 0; k < RING_DIRS / 2; k++) ring.push(offsetPoint(u, (2 * Math.PI * (k + 0.5)) / (RING_DIRS / 2), 0.5 * ringKm))
  }

  // Retained: an independent test, so a pan inside the old name's reach never jumps to a feature that is not clearly better.
  let retainedHolds = false
  if (retained) {
    const r = tables().BY_ID.get(retained.id)
    const ru = labelIndex().units.get(retained.id)
    if (r && ru && named(r)) {
      const ang = angleBetween(u, ru)
      const runres = unresolvedErrKm(hit, r)
      const within = (retained.acceptRad - ang) * R_KM > 0 && hit.errKm + runres <= GATE * (retained.acceptRad - ang) * R_KM
      const holdsAt = (p: V3): boolean => {
        const sc = scoreOf(r, ru, p)
        // A retained name needs a score of its own (MIN_SCORE): hysteresis keeps it against a better rival, never where nothing would be named.
        if (!(sc >= MIN_SCORE)) return false
        const b = winnerAt(p)
        return b.i < 0 || cands[b.i].id === r.id || sc >= RETAIN_SHARE * b.score
      }
      retainedHolds = within && !tooWide && holdsAt(u) && ring.every(holdsAt)
    }
  }
  if (w.i < 0) return { status: 'none', choice: null, retainedHolds }

  const l = cands[w.i]
  const ang = angleBetween(u, units[w.i])
  const mode: 'contain' | 'near' = classOf(l) === 'disc' && ang <= radiusRad(l) ? 'contain' : 'near'
  const choice: CentreChoice = { label: l, mode, angleRad: ang, entryRad: reachRad(l, spanKm), errKm, marginKm: ringKm, score: w.score }
  // Certain only when the same feature wins on both rings (a boundary between two answers closer than the ring makes the pick uncertain).
  if (tooWide) return { status: 'uncertain', choice: null, rejected: choice, retainedHolds }
  for (const p of ring) {
    const b = winnerAt(p)
    if (b.i < 0 || cands[b.i].id !== l.id) return { status: 'uncertain', choice: null, rejected: choice, retainedHolds }
  }
  return { status: 'ok', choice, retainedHolds }
}

// ---------------------------------------------------------------------------------------------------------------------
// Hits
// ---------------------------------------------------------------------------------------------------------------------

export function lonLatOfPoint(p: V3): { lonDeg: number; latDeg: number } {
  const len = Math.hypot(p[0], p[1], p[2]) || 1
  return { lonDeg: Math.atan2(p[1], p[0]) / RAD, latDeg: Math.asin(Math.max(-1, Math.min(1, p[2] / len))) / RAD }
}

/**
 * A hit from the renderer's hit target: the surface point `rangeRadii` along `dir` (the ray of the texel that was read) from `pos`.
 * `offPx` is how far that texel's centre is from the screen centre, in pixels (0 when the ray is the exact centre ray; an even-sized target has
 * no centre texel, so a read texel is up to ~0.71 px off). The error bounds the displacement of the surface point between the read ray and the
 * centre ray: half a pixel plus the offset, times the pixel's footprint at that range, stretched by the foreshortening 1 / sin(elevation) of the
 * ray over the local horizontal (floored at 0.05, about 3 degrees).
 */
export function hitFromRange(pos: V3, dir: V3, rangeRadii: number, pixelTan: number, offPx = 0): CentreHit {
  const p: V3 = [pos[0] + dir[0] * rangeRadii, pos[1] + dir[1] * rangeRadii, pos[2] + dir[2] * rangeRadii]
  const n = Math.hypot(p[0], p[1], p[2]) || 1
  const sinElev = Math.abs(dir[0] * p[0] + dir[1] * p[1] + dir[2] * p[2]) / n
  const err = rangeRadii * pixelTan * R_KM * (0.5 + offPx) / Math.max(0.05, sinElev)
  return { ...lonLatOfPoint(p), errKm: Math.max(0.01, err), fallback: false }
}

/** The world direction of the ray through texel (ix, iy) of a w x h target for a camera sample (GL origin bottom-left), and the texel's distance from the screen centre in pixels. */
export function texelRay(cam: { back: V3; up: V3; tanHalf: number; aspect: number }, w: number, h: number, ix: number, iy: number): { dir: V3; offPx: number } {
  const nx = (ix + 0.5) / w * 2 - 1, ny = (iy + 0.5) / h * 2 - 1
  const { back, up } = cam
  // right = up x back (x right, y up, z back).
  const right: V3 = [up[1] * back[2] - up[2] * back[1], up[2] * back[0] - up[0] * back[2], up[0] * back[1] - up[1] * back[0]]
  const d: V3 = [
    -back[0] + right[0] * nx * cam.tanHalf * cam.aspect + up[0] * ny * cam.tanHalf,
    -back[1] + right[1] * nx * cam.tanHalf * cam.aspect + up[1] * ny * cam.tanHalf,
    -back[2] + right[2] * nx * cam.tanHalf * cam.aspect + up[2] * ny * cam.tanHalf,
  ]
  const l = Math.hypot(d[0], d[1], d[2])
  return { dir: [d[0] / l, d[1] / l, d[2] / l], offPx: Math.hypot((ix + 0.5) - w / 2, (iy + 0.5) - h / 2) }
}

/** The sphere of radius `r` along a ray, first intersection (Moon radii), or null. */
export function raySphereV(pos: V3, dir: V3, r: number): V3 | null {
  const b = pos[0] * dir[0] + pos[1] * dir[1] + pos[2] * dir[2]
  const c = pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2] - r * r
  const disc = b * b - c
  if (disc < 0) return null
  const t = -b - Math.sqrt(disc)
  if (t < 0) return null
  return [pos[0] + dir[0] * t, pos[1] + dir[1] * t, pos[2] + dir[2] * t]
}

/** The retained height grid as the picker needs it. */
export interface HeightSource {
  /** Metres above the mean-radius sphere, or null when unreadable. */
  sampleM(lonDeg: number, latDeg: number): number | null
  /** The map is the flat stand-in still loading: unknown, not zero. */
  pending: boolean
  /** Decoded half-error of the heights, m. */
  halfErrorM: number
}

export const HIT_ITER = 4
const CONVERGED_KM = 0.2

/**
 * The CPU estimate of the centre hit when no rendered hit can be read: the sphere, then up to HIT_ITER passes of height sampling at
 * the effective relief (`relief` = reliefShare(|pos|) x uHeightMix, as the renderer scales it). Never a certain pick on its own:
 * the error is `sigma_h / tan(elevation)` with sigma_h from the decode error and the local slope (one texel apart), scaled by the relief;
 * a pending map, a miss or non-convergence is unknown (Infinity). The picker adds the unresolved-relief term for small features.
 */
export function fallbackHit(pos: V3, dir: V3, src: HeightSource, relief: number): CentreHit {
  const sphere = raySphereV(pos, dir, 1)
  const unknown = (ll: { lonDeg: number; latDeg: number }): CentreHit => ({ ...ll, errKm: Infinity, fallback: true })
  if (!sphere) return unknown({ lonDeg: NaN, latDeg: NaN })
  const base = lonLatOfPoint(sphere)
  // Where the renderer shows no relief (zoomed out) the sphere is exact.
  if (relief < 1e-3) return { ...base, errKm: 0.05, tanElev: 1e3, reliefScale: 0, fallback: true, rangeRadii: Math.hypot(sphere[0] - pos[0], sphere[1] - pos[1], sphere[2] - pos[2]), sigmaRangeKm: 0.05 }
  if (src.pending) return unknown(base)
  let hit: V3 = sphere
  let ll = base
  let converged = false
  for (let i = 0; i < HIT_ITER; i++) {
    const hRaw = src.sampleM(ll.lonDeg, ll.latDeg)
    if (hRaw === null) return unknown(ll)
    const next = raySphereV(pos, dir, 1 + hRaw * relief / 1000 / R_KM)
    if (!next) return unknown(ll)
    const moved = Math.hypot(next[0] - hit[0], next[1] - hit[1], next[2] - hit[2]) * R_KM
    hit = next
    ll = lonLatOfPoint(hit)
    if (moved < CONVERGED_KM) { converged = true; break }
  }
  if (!converged) return unknown(ll)
  const n = Math.hypot(hit[0], hit[1], hit[2])
  // Clamped: a nadir ray rounds to sin > 1, and sqrt(1 - sin^2) would be NaN (an unknown hit straight down, which every pitch-0 phone view used to get).
  const sinElev = Math.min(1, Math.abs(dir[0] * hit[0] + dir[1] * hit[1] + dir[2] * hit[2]) / n)
  const tanElev = sinElev / Math.max(1e-6, Math.sqrt(Math.max(0, 1 - sinElev * sinElev)))
  // Local slope: one texel east, one texel north (dimensionless metres per metre).
  const dLon = TEXEL_KM_L2 / R_KM / RAD / Math.max(0.05, Math.cos(ll.latDeg * RAD)), dLat = TEXEL_KM_L2 / R_KM / RAD
  const h0 = src.sampleM(ll.lonDeg, ll.latDeg), hE = src.sampleM(ll.lonDeg + dLon, ll.latDeg), hN = src.sampleM(ll.lonDeg, ll.latDeg + dLat)
  if (h0 === null || hE === null || hN === null) return unknown(ll)
  const slope = Math.max(Math.abs(hE - h0), Math.abs(hN - h0)) / (TEXEL_KM_L2 * 1000)
  const sigmaKm = Math.max(src.halfErrorM / 1000, slope * TEXEL_KM_L2 / 2) * relief
  return {
    ...ll, errKm: sigmaKm / Math.max(1e-3, tanElev), tanElev, reliefScale: relief, fallback: true,
    rangeRadii: Math.hypot(hit[0] - pos[0], hit[1] - pos[1], hit[2] - pos[2]), sigmaRangeKm: sigmaKm / Math.max(0.05, sinElev),
  }
}
