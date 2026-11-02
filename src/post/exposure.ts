import { Vector3 } from 'three'
import { coarseGainOf } from './coarseGain'
import { MOON_R_KM } from '../glsl/common'
import type { Ephemeris } from '../ephemeris'
import type { ViewCamera } from '../camera/pose'
import type { AlbedoPyramid } from '../moon/maps'
import { earthShadowOnMoonParts, luminance } from '../lighting/shadowMath'
import { type ReliefField, reliefMu0 } from '../moon/tiles/relief'
import { ES_KEY_MAX, STAR_PEAK, SUN_V, WHITE_FLOOR, lunarL, normalAlbedo, phaseA } from '../moon/photometry'
import { AMBIENT_EARTHSHINE_SHARE, earthAngularRadius, earthDiscMu } from '../moon/earthlight'

/**
 * The camera's exposure, as moon-v1's fly mode sets it (no air here, so its
 * air-dependent terms are at their in-flight values everywhere, the opening
 * view included):
 *
 * - The short exposure puts the brightest sunlit ground in the frame at
 *   white, with the map's own albedo under each sample ray, but is never
 *   longer than a 10 deg sliver seen from behind needs (WHITE_FLOOR).
 * - The long exposure is set on the brightest earthlit highland in the
 *   frame, never longer than a sixth of the brightest earthshine needs
 *   (ES_KEY_MAX), so the night side dims as the Earth wanes and goes black
 *   near full Moon. With nothing lit in view it is set for stars instead.
 * - The two blend by how much of the ground in view is sunlit: fused below
 *   a fifth, one exposure above 45%.
 */

const DEG = Math.PI / 180
/** The 4k map's texel at the equator, km: where tile relief stops being drawn (moonShader.ts's gate). */
const GLOBAL_TEXEL_KM = 2 * Math.PI * MOON_R_KM / 4096
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * The night side, as ONE monotone function of how strong the earthshine is next to the sunlit ground, q = esLevelView / bestA
 * (both I/F of the same frame). Across a lunation log2 q runs from about +14 (new Moon, no sunlit ground), through -11 (a thin
 * crescent), -14 (first quarter), -16 (a gibbous) to -25 and below (full Moon), so one number says where on the phase the frame
 * is. Everything the night side needs is derived from it, so no part of it flips at a quarter: the fuse (how much of the long
 * exposure is blended in), the long exposure's key cap and the level it tops out at.
 */
const log2q = (q: number): number => (q > 0 ? Math.log2(q) : -Infinity)
/** 0 at a full Moon's ratio, 1 from a first quarter's crescent side on: the night side's weight. */
const nightWeight = (q: number): number => smooth(-18.5, -12.5, log2q(q))
/** How much of the night is fused into the picture (0 = one exposure). */
export function nightSideFuse(q: number): number { return nightWeight(q) }
/** The long exposure is never longer than this key (I/F): the brightest earthshine's key, a sixth of it beside a crescent. */
export function nightSideKeyCap(q: number): number { return ES_KEY_MAX * Math.pow(1 / 6, nightWeight(q)) }
/**
 * Where the long exposure tops out (display linear, about 65/255 at 0.06): a look choice, shown darker than day. Beside sunlit
 * ground `sunPresence` (0..1) lifts it from 0.035, a night side alone, to 0.06. An eclipse's bent light is the picture, so it may
 * fill more.
 */
export const NIGHT_LONGMAX_ALONE = 0.035
export const NIGHT_LONGMAX_BESIDE = 0.06
export function nightSideLongMax(_q: number, sunPresence: number, eclipse = false): number {
  const p = Math.max(0, Math.min(1, sunPresence))
  return NIGHT_LONGMAX_ALONE + (NIGHT_LONGMAX_BESIDE - NIGHT_LONGMAX_ALONE) * p + (eclipse ? 0.1 : 0)
}

export interface FrameSearch {
  /** Brightest sunlit ground in view as a 0.2-albedo highland, I/F. */
  best: number
  /** The same with the map's albedo under each ray (the white point). */
  bestA: number
  /** Brightest earthlit geometry in view (unit albedo and earthshine). */
  esMax: number
  /** Sample rays that met the Moon, and the share of those on sunlit ground. */
  hits: number
  samples: number
  sunlitFraction: number
  /**
   * Brightest ground lit only by sunlight bent through the Earth's air (a
   * lunar eclipse), as a 0.2-albedo highland's I/F; 0 outside an eclipse.
   */
  eclipseLevel: number
}

export interface Exposure {
  /** I/F that maps to white. */
  white: number
  /** Multiplier on radiance before the half-float store. */
  preExpose: number
  /** The long exposure's key level (I/F) and the earthlit ground's own level. */
  esLevel: number
  esLevelView: number
  longMax: number
  /** 0 = one exposure, 1 = two fused. */
  hdr: number
  starLift: number
  whiteFloored: boolean
  /** The frame's own white (I/F, before the air's exposure term and before any anchor). */
  frameBrightest: number
  search: FrameSearch
}

/**
 * The share of the FRAME (sample grid, sky included) that may sit above white: the white point is the p98 of the frame (measured on the
 * earthshine crescent: 1% left its frame p99 at 200 grey, 2% puts it at 246). A thin crescent is a few percent of the frame, so its white is the brightness a fair share of
 * the crescent exceeds (not the limb-most rim), and the crescent's own frame p99 lands at white. Fully lit frames (a ground-only
 * view) get p98 of the lit ground, inside the plan's p98 to p99.5.
 */
export const WHITE_CLIP_SHARE = 0.02
/**
 * Ease an eclipse frame's Earth exposure anchor by its visible projected
 * area. `earthWeight` is a composition weight, not radiance: multiplying the
 * Earth white point by it made a partly visible Earth look brighter and
 * brighter as the anchor weakened. Blend in log exposure space from the
 * normal scene floor instead, so area zero leaves the Moon's own search in
 * charge and a fully present Earth gets its real white point.
 */
export function visibleEarthWhite(earthWeight: number): number {
  const w = Math.max(0, Math.min(1, earthWeight))
  if (w === 0) return 0
  return WHITE_FLOOR * Math.pow(EARTH_WHITE_IF / WHITE_FLOOR, w)
}
/** The value that `share` of `total` samples exceed, of the lit samples `v` (the largest when fewer than that are lit; 0 for none). */
export function topShareValue(v: number[], share: number, total: number): number {
  if (!v.length) return 0
  const a = Float64Array.from(v).sort()
  // A small lit area (a far-off full Moon is a few dozen samples) cannot spare the share the whole frame may clip: with fewer than four times that many lit samples the
  // white is the brightness a quarter of them exceed. It used to run off the end and answer with the DIMMEST lit sample, which clipped the whole disc to a white blob.
  const k = Math.max(0, Math.min(Math.floor(a.length * 0.25), Math.floor(share * total)))
  return a[a.length - 1 - k]
}

/**
 * Rays over the frame as the shader casts them: the brightest sunlit ground,
 * the brightest earthlit ground, and how much of the ground in view is
 * sunlit. The reflectance is the shader's, including its cap on the limb
 * term. The grid is laid on the canvas's aspect, not the render target's, so
 * a coarse frame in motion and the refined frame at rest expose alike.
 */
export function searchFrame(
  cam: ViewCamera, aspect: number, e: Ephemeris, albedo: AlbedoPyramid | null, lonSpan: number,
  relief: { field: ReliefField; canvasHeight: number } | null = null,
  coarse = false,
): FrameSearch {
  // A frame that has not moved searches to the same answer (the search is a pure function of the camera, the ephemeris, the albedo pyramid and the
  // relief the streamer holds). At rest it used to run, with its look-ahead cameras, every frame: about 1.2 s of main-thread time in 4 s at the Copernicus floor.
  const key = searchKey(cam, aspect, e, albedo, lonSpan, relief, coarse)
  if (key !== null) {
    const hit = searchMemo.get(key)
    if (hit) return hit
  }
  // A time scrub moves the Sun every frame, so the exact memo never hits and the ~5,000-sample search ran 2 to 4 times a frame. While a scrub holds
  // `searchReuseMs` open, the answer for the same camera, albedo and relief is reused for that long (the exposure controller slews anyway, and
  // shadows are drawn from the live Sun in the shader, not from this search); the first frame after the scrub closes it searches exactly.
  const looseKey = reuse.ms > 0 ? searchKey(cam, aspect, LOOSE_EPHEMERIS, albedo, lonSpan, relief, coarse) : null
  if (looseKey !== null) {
    const hit = looseMemo.get(looseKey)
    if (hit && reuse.now() - hit.at <= reuse.ms) return hit.out
  }
  const out = searchFrameRaw(cam, aspect, e, albedo, lonSpan, relief, coarse)
  if (looseKey !== null) {
    if (looseMemo.size >= SEARCH_MEMO_MAX) looseMemo.delete(looseMemo.keys().next().value as string)
    looseMemo.set(looseKey, { out, at: reuse.now() })
  }
  if (key !== null) {
    if (searchMemo.size >= SEARCH_MEMO_MAX) searchMemo.delete(searchMemo.keys().next().value as string)
    searchMemo.set(key, out)
  }
  return out
}
const SEARCH_MEMO_MAX = 8
/** The scrub's staleness allowance (ms; 0 = exact), and the clock it is read on (injectable for tests). */
const realClock = (): number => performance.now()
const reuse = { ms: 0, now: realClock }
const looseMemo = new Map<string, { out: FrameSearch; at: number }>()
/** Open (ms > 0) or close (0) the reuse window of searchFrame; closing drops what it held so the next search is exact, and puts the real clock back (an injected one does not outlive its test). */
export function setSearchReuseMs(ms: number, now?: () => number): void {
  reuse.ms = Math.max(0, ms)
  if (now) reuse.now = now
  if (reuse.ms === 0) { looseMemo.clear(); if (!now) reuse.now = realClock }
}
/** What a time-blind search key sees of the ephemeris: nothing, so two searches that differ only in the date share a key. */
const LOOSE_EPHEMERIS = { sunDir: new Vector3(), earthDir: new Vector3(), moonX: new Vector3(), moonY: new Vector3(), moonZ: new Vector3(), sunKm: new Vector3(), earthKm: new Vector3() } as unknown as Ephemeris
const searchMemo = new Map<string, FrameSearch>()
const albedoIds = new WeakMap<object, number>()
let nextAlbedoId = 1
/** A string that is equal exactly when two searches would give the same answer; null when the relief field cannot say when it changes. */
export function searchKey(
  cam: ViewCamera, aspect: number, e: Ephemeris, albedo: AlbedoPyramid | null, lonSpan: number,
  relief: { field: ReliefField; canvasHeight: number } | null,
  coarse = false,
): string | null {
  if (relief && relief.field.version === undefined) return null
  let aid = 0
  if (albedo) { aid = albedoIds.get(albedo) ?? nextAlbedoId++; albedoIds.set(albedo, aid); aid += albedo.levels.length / 1000 }
  const f = (v: Vector3): string => `${v.x},${v.y},${v.z}`
  return [f(cam.pos), f(cam.right), f(cam.up), f(cam.back), cam.tanHalf, aspect, f(e.sunDir), f(e.earthDir), f(e.moonX), f(e.moonY), f(e.moonZ),
    e.sunKm.x, e.sunKm.y, e.sunKm.z, e.earthKm.x, e.earthKm.y, e.earthKm.z, aid, lonSpan, relief ? `${relief.canvasHeight}:${relief.field.version}` : '-', coarse ? '1' : '0'].join('|')
}
function searchFrameRaw(
  cam: ViewCamera, aspect: number, e: Ephemeris, albedo: AlbedoPyramid | null, lonSpan: number,
  relief: { field: ReliefField; canvasHeight: number } | null = null,
  coarse = false,
): FrameSearch {
  const C = cam.pos
  const S = e.sunDir, E = e.earthDir
  const earthR = earthAngularRadius(e.earthKm.length() / MOON_R_KM, MOON_R_KM)
  const NY = coarse ? 20 : 56, NX = Math.max(8, Math.round(NY * aspect))
  const tanW = cam.tanHalf * aspect
  let best = 0, esMax = 0, hits = 0, sunlit = 0, eclipseLevel = 0
  // The white comes from the sampled frame's high percentile, not its maximum: the maximum sits on one limb-most sample at the
  // map's brightest pyramid cell, so only that rim reached white and a crescent's typical pixel sat at a third of it.
  // Filled during the main grid only (the refinement below hunts the maximum for `best`, which it would bias).
  const aSamples: number[] = []
  let collecting = true
  // The Earth's shadow on the Moon (src/eclipse/): the world frame is
  // Moon-centred, the Sun and Earth positions are in Moon radii.
  const sunPos: [number, number, number] = [e.sunKm.x / MOON_R_KM, e.sunKm.y / MOON_R_KM, e.sunKm.z / MOON_R_KM]
  const earthPos: [number, number, number] = [e.earthKm.x / MOON_R_KM, e.earthKm.y / MOON_R_KM, e.earthKm.z / MOON_R_KM]
  let bestAt: [number, number] | null = null

  // The map's normal albedo for the brightest ground within spacingKm of a
  // point (the max pyramid; 0.2 without it).
  const albedoAt = (p: Vector3, spacingKm: number): number => {
    if (!albedo) return 0.2
    const lon = Math.atan2(p.dot(e.moonY), p.dot(e.moonX)) / DEG
    const lat = Math.asin(Math.max(-1, Math.min(1, p.dot(e.moonZ)))) / DEG
    const u = (lon + lonSpan) / (2 * lonSpan), v = (90 - lat) / 180
    if (u < 0 || u > 1) return 0.2
    const k = Math.max(0, Math.min(albedo.levels.length - 1, Math.ceil(Math.log2(Math.max(1, spacingKm / albedo.cellKm))) + (coarse ? 2 : 1)))
    const L = albedo.levels[k]
    const x = Math.min(L.w - 1, Math.floor(u * L.w)), y = Math.min(L.h - 1, Math.floor(v * L.h))
    return normalAlbedo(L.y[y * L.w + x])
  }
  // Angle between neighbouring samples; ground between them, km
  // (foreshortened, at most 4x).
  const stepAngle = Math.max(2 * tanW / NX, 2 * cam.tanHalf / NY)
  const r = new Vector3(), p = new Vector3(), V = new Vector3()
  const K = e.moonZ, tanPerPx = relief ? cam.tanHalf / (relief.canvasHeight / 2) : 0
  const east = new Vector3(), north = new Vector3()
  // Ground that faces the Sun is brighter than the smooth sphere's (see moon/tiles/relief.ts), by the share the
  // shader draws tile relief here: none where a pixel spans 0.9 texels of the 4k map or more, so views the tiles do not touch expose exactly as before.
  const reliefLifted = (pt: Vector3, mu0f: number, mu: number): number => {
    const fpKm = C.distanceTo(pt) * MOON_R_KM * tanPerPx / Math.max(mu, 0.15)
    const w = 1 - smooth(0.5, 0.9, fpKm / GLOBAL_TEXEL_KM)
    if (w <= 0) return mu0f
    east.crossVectors(K, pt)
    if (east.lengthSq() < 1e-12) return mu0f
    east.normalize()
    north.crossVectors(pt, east)
    const lon = Math.atan2(pt.dot(e.moonY), pt.dot(e.moonX)) / DEG
    const lat = Math.asin(Math.max(-1, Math.min(1, pt.dot(K)))) / DEG
    const tan = relief!.field.facingTan(lon, lat, Math.atan2(S.dot(north), S.dot(east)))
    if (tan === null) return mu0f
    return mu0f + w * (reliefMu0(mu0f, tan) - mu0f)
  }

  // Returns the 0.2-highland brightness at a ray (tangent-plane sx, sy), or
  // -1 on a miss; updates bestA and esMax on the way.
  const probe = (sx: number, sy: number): number => {
    r.copy(cam.right).multiplyScalar(sx).addScaledVector(cam.up, sy).sub(cam.back).normalize()
    const tc = -C.dot(r)
    if (tc <= 0) return -1
    p.copy(C).addScaledVector(r, tc)
    const b2 = p.lengthSq()
    if (b2 >= 1) return -1
    // A camera inside the unit sphere (a site patch's floor, over ground below the reference sphere) meets the ground
    // about where the ray leaves the sphere; outside it, the near hit as ever.
    p.copy(C).addScaledVector(r, C.lengthSq() < 1 ? tc + Math.sqrt(1 - b2) : tc - Math.sqrt(1 - b2))
    V.copy(C).sub(p).normalize()
    const mu = Math.max(0, p.dot(V))
    const mu0Flat = p.dot(S)
    let mu0 = mu0Flat
    if (relief && mu0Flat > 0 && !coarse) mu0 = reliefLifted(p, mu0Flat, mu)
    const capL = smooth(8, 0, Math.asin(Math.min(1, mu)) / DEG)
    let bright = 0
    let shadow = 1
    if (mu0 > 0) {
      const sh = earthShadowOnMoonParts([p.x, p.y, p.z], sunPos, earthPos)
      const a = Math.acos(Math.max(-1, Math.min(1, V.dot(S)))) / DEG
      const L = lunarL(a)
      const lit = 0.2 * phaseA(a) * (2 * L * mu0 / Math.max(1e-6, mu0 + Math.max(mu, mu0 * capL)) + (1 - L) * mu0)
      // Direct light through the penumbra is the short exposure's; below
      // 2% of the Sun the ground is read on the long exposure instead (the
      // shader's key does the same), where only the bent light matters.
      const dl = sh.direct[0] === 1 && sh.direct[1] === 1 && sh.direct[2] === 1 ? 1 : luminance(sh.direct)
      eclipseLevel = Math.max(eclipseLevel, lit * luminance(sh.refracted))
      shadow = dl >= 0.02 ? dl : 0
      bright = lit * shadow
      const spacingKm = C.distanceTo(p) * MOON_R_KM * stepAngle / Math.max(mu, 0.25)
      if (shadow > 0 && collecting && bright > 0) aSamples.push(bright / 0.2 * albedoAt(p, spacingKm))
    }
    // The same earthlight the shader draws (src/moon/earthlight.ts): the Earth is a disc, so ground whose horizon cuts it is still lit, and ground with
    // no view of it gets the ambient estimate. Without this a polar frame (Earth on the horizon) measured no earthlight and was exposed for stars.
    const muE = earthDiscMu(p.dot(E), earthR)
    esMax = Math.max(esMax, AMBIENT_EARTHSHINE_SHARE * 0.5)
    if (muE > 0) {
      const aE = Math.acos(Math.max(-1, Math.min(1, V.dot(E)))) / DEG
      const LE = lunarL(aE)
      esMax = Math.max(esMax, phaseA(Math.max(aE, 0.5)) * (2 * LE * muE / (muE + Math.max(mu, muE * capL) + 1e-4) + (1 - LE) * muE))
    }
    return bright
  }

  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const sx = ((i + 0.5) / NX * 2 - 1) * tanW
      const sy = ((j + 0.5) / NY * 2 - 1) * cam.tanHalf
      const b = probe(sx, sy)
      if (b < 0) continue
      hits++
      if (b > 0) sunlit++
      if (b > best) {
        best = b
        bestAt = [sx, sy]
      }
    }
  }
  collecting = false
  // Refine around the best cell: the maximum sits on a limb or a terminator.
  if (bestAt) {
    const ux = 2 * tanW / NX, uy = 2 * cam.tanHalf / NY
    const rSpan = coarse ? 2 : 6
    const rStep = coarse ? 2 : 6
    for (let j = -rSpan; j <= rSpan; j++) {
      for (let i = -rSpan; i <= rSpan; i++) {
        const b = probe(bestAt[0] + i * ux / rStep, bestAt[1] + j * uy / rStep)
        if (b > best) best = b
      }
    }
  }
  const bestA = topShareValue(aSamples, WHITE_CLIP_SHARE, NX * NY)
  return { best, bestA, esMax, hits, samples: NX * NY, sunlitFraction: hits ? sunlit / hits : 0, eclipseLevel }
}

export interface ExposureInput {
  cam: ViewCamera
  /** Canvas width over height. */
  aspect: number
  /** Canvas height, device px: the star key is set for the canvas's own pixels. */
  canvasHeight: number
  ephem: Ephemeris
  albedo: AlbedoPyramid | null
  lonSpan: number
  /** false stores raw I/F (?preexpose=0, the test switch). */
  preExposeOn: boolean
  /**
   * I/F that the sunlit Earth in view should map to white (earthWhiteIF), or
   * 0 when no lit Earth is in the frame. It sets the white point only when the
   * Moon's own sunlit ground in view is much dimmer (or absent), so a frame
   * with a bright Moon keeps the Moon's exposure and lets the Earth clip.
   */
  earthWhite?: number
  /** Resident tiles' relief summaries (null without tiles): the search then credits ground that faces the Sun. */
  relief?: ReliefField | null
  /**
   * Over a site patch: the photograph's detail and its relief run brighter than the map's own brightest ground (the
   * patch's detail ratio reaches 1.9 at its 99.9th percentile), so the white point rises by this factor (1: none).
   */
  patchGain?: number
  /**
   * The air of the ridge view (src/ridge): the camera looks through it, so the Moon's light is dimmed by `transmission` (its
   * green-channel value along the line to the Moon) and the long exposure is also keyed on the twilight sky (`skyLevel`, I/F, the
   * sky beside the Moon), whichever is brighter, as a photographer would. `air` (1 on the ground, 0 in space) fades all three
   * out, and `ev` is a look choice in stops (moon-v1's ridge preset: 0.3). Absent: no air, as everywhere else on the site.
   */
  /**
   * A camera to search the frame with, when the real one is a wide lens on a Moon a few pixels across (the ridge lift-off): the search
   * samples a coarse grid and would miss the disc, so the exposure would jump to the star key. Same position and axes, narrower field.
   */
  searchCam?: ViewCamera
  /**
   * A site anchor: a camera on a lander keeps one exposure for the ground it is coming down on, it does not re-expose for each
   * patch of ground it passes. `white` is the white point (I/F) the site's arrival frame asks for; `weight` (0..1) is how far
   * the frame is pulled to it (in stops). Without it a mare plain seen from 15 km is exposed on its own dark albedo and washes out.
   */
  anchor?: {
    white: number
    weight: number
    /** The anchor may not move the picture more than this many stops from the frame's own search. */
    capStops?: number
    /** A tighter limit on how much brighter than the frame's own search the anchor may make the picture. */
    floorStops?: number
  }
  air?: { air: number; transmission: number; skyLevel: number; ev: number }
  /** A minimum for `starLift` (0..1; the ?starlift= rig switch). Absent or 0: the exposure is unchanged. */
  starLiftFloor?: number
  /** In motion: reduced-grid and coarse-mip search for smooth frame rates. */
  coarse?: boolean
  /** With `coarse`: the measured full/coarse ratio of the brightest ground (post/coarseGain.ts), applied to the coarse search's brightness. 1 or absent leaves the coarse answer as it is. */
  coarseGain?: number
}

/** A coarse search's brightness scaled by the measured full/coarse ratio, so the gesture exposes like the rest frame it will end on. */
export function applyCoarseGain(s: FrameSearch, gain: number): FrameSearch {
  return gain === 1 || !(gain > 0) ? s : { ...s, best: s.best * gain, bestA: s.bestA * gain }
}

/** Headroom of a ground-only frame's white point over its brightest ground. A look choice. */
export const GROUND_ONLY_HEADROOM = 1.1
/** Cloud-topped Earth's typical bright-disc I/F, a modelled round number (the Earth pass's clouds are 0.72 albedo). */
export const EARTH_WHITE_IF = 0.6
/** White point for a frame whose brightest thing is the refracted ring around a night Earth: an exposure CHOICE (a short one, so the ring is a line, not a flood), not a measurement. */
export const RING_WHITE_IF = 0.1
/** White point when the Sun's disc itself is in the frame (I/F of the disc is ~46,000): an exposure choice that keeps the disc a saturated dot and its glare a soft halo, not a measurement. */
export const SUN_WHITE_IF = 50

/**
 * The subject lock (main.ts subjectAnchor) may hold the picture DARKER than the frame's own search by this many stops (a bright highland
 * entering the search must not make the disc breathe), but BRIGHTER by only this much. It used to be a full stop each way: after a drag
 * from the dark side to a fully lit face the held white sat a stop under the frame's own, and 90% of the disc was at white (owner, 4 Oct:
 * "overexposed, that should never happen").
 */
export const SUBJECT_HOLD_CAP_STOPS = 1
export const SUBJECT_HOLD_FLOOR_STOPS = 0.25

/** The subject lock's anchor for a held white: the one place the cap and the floor are bound to their slots (main.ts builds it here, the test pins it). */
export function subjectHoldAnchor(white: number, weight: number): { white: number; weight: number; capStops: number; floorStops: number } {
  return { white, weight, capStops: SUBJECT_HOLD_CAP_STOPS, floorStops: SUBJECT_HOLD_FLOOR_STOPS }
}

/** The white an anchor leaves, given the frame's own `brightest` (the pure part of computeExposure's anchor step). */
export function anchoredBrightest(brightest: number, a: { white: number; weight: number; capStops?: number; floorStops?: number }): number {
  const k = Math.max(0, Math.min(1, a.weight))
  let anchorWhite = a.capStops === undefined ? a.white : Math.min(a.white, brightest * Math.pow(2, a.capStops))
  if (a.floorStops !== undefined) anchorWhite = Math.max(anchorWhite, brightest * Math.pow(2, -a.floorStops))
  return Math.exp(Math.log(brightest) + (Math.log(anchorWhite) - Math.log(brightest)) * k)
}

/** The full/coarse ratio of the brightest ground for this frame's camera (one full and one coarse search; both are memoised). */
export function coarseGainFor(x: ExposureInput): number {
  return coarseCalibrationFor(x).gain
}

/** `coarseGainFor` plus the share of sunlit ground the FULL search found: a flight on the coarse search still shows the HUD's "sunlit %" from a full search, never a 20-row estimate. */
export function coarseCalibrationFor(x: ExposureInput): { gain: number; sunlitFraction: number } {
  const at = (coarse: boolean): FrameSearch => searchFrame(x.searchCam ?? x.cam, x.aspect, x.ephem, x.albedo, x.lonSpan, x.relief ? { field: x.relief, canvasHeight: x.canvasHeight } : null, coarse)
  const full = at(false)
  return { gain: coarseGainOf(full.bestA, at(true).bestA), sunlitFraction: full.sunlitFraction }
}

export function computeExposure(x: ExposureInput): Exposure {
  const found = searchFrame(x.searchCam ?? x.cam, x.aspect, x.ephem, x.albedo, x.lonSpan, x.relief ? { field: x.relief, canvasHeight: x.canvasHeight } : null, x.coarse ?? false)
  const search = x.coarse ? applyCoarseGain(found, x.coarseGain ?? 1) : found
  const A = x.air?.air ?? 0
  // Through the air the Moon's light is dimmed, so the exposures lengthen (moon-v1's ext[1] and its ev control).
  const tEff = (1 + ((x.air?.transmission ?? 1) - 1) * A) * Math.pow(2, -(x.air?.ev ?? 0) * A)
  const tRaw = 1 + ((x.air?.transmission ?? 1) - 1) * A
  const qNight = search.esMax > 0 ? Math.max(0.16 * x.ephem.earthshine * search.esMax * tRaw, search.eclipseLevel) / Math.max(search.bestA, 1e-9) : 0
  const autoFuse = nightSideFuse(qNight) * ((x.earthWhite ?? 0) > 0 && search.bestA < 0.5 * (x.earthWhite ?? 0) ? 0 : 1)
  const hdr = A + (1 - A) * autoFuse
  // White on the brightest sunlit ground actually in the frame (the far
  // side's highlands are brighter than the 0.2 a highland is usually given).
  const earthOnly = (x.earthWhite ?? 0) > 0 && search.bestA < 0.5 * (x.earthWhite ?? 0)
  // A frame of nothing but ground (no sky, no limb) is exposed with headroom: white on its brightest spot would put a flat plain
  // at 100% and wash it; a camera leaves the brightest ground a stop below clipping (a look choice).
  const groundOnly = search.hits > 0 && search.hits === search.samples ? GROUND_ONLY_HEADROOM : 1
  let brightest = Math.max(search.bestA * (x.patchGain ?? 1) * groundOnly, WHITE_FLOOR, earthOnly ? (x.earthWhite ?? 0) : 0)
  /** What the frame's own search asked for, before any anchor (a gesture's lock is taken from this). */
  const frameBrightest = brightest
  if (x.anchor && x.anchor.weight > 0 && x.anchor.white > 0 && !earthOnly && search.hits > 0) {
    brightest = anchoredBrightest(brightest, x.anchor)
  }
  const white = brightest * tEff
  let preExpose = x.preExposeOn ? 8 / (brightest * tRaw) : 1

  const esLevelView = Math.max(0.16 * x.ephem.earthshine * search.esMax * tRaw, search.eclipseLevel)
  // With nothing lit in view the long exposure is set for stars to
  // magnitude 5.5 (their peak pixel at the canvas's own pixel size; a few
  // seconds on a real camera), so an unlit disc shows as a gap in them.
  // With earthlit ground in view the cap is a sixth of the brightest
  // earthshine's key, so a quarter Moon's night side reads, dimmer than a
  // new Moon's, while near full Moon it still goes black.
  const tppCanvas = x.cam.tanHalf / (x.canvasHeight / 2)
  const starKey = STAR_PEAK * Math.PI * Math.pow(10, -0.4 * (5.5 - SUN_V)) / (tppCanvas * tppCanvas)
  const keyCap = nightSideKeyCap(qNight)
  // Only once the earthlit ground would be black anyway (32 times under the
  // cap) does the key move on to the stars.
  const sunPresence = smooth(Math.log2(WHITE_FLOOR) - 1, Math.log2(WHITE_FLOOR) + 3, Math.log2(Math.max(search.bestA, 1e-9)))
  const nothingLit = (1 - sunPresence) * (1 - smooth(keyCap / 64, keyCap / 16, esLevelView))
  const floorLong = Math.exp(Math.log(keyCap) + (Math.log(starKey) - Math.log(keyCap)) * nothingLit)
  const esLevel = Math.max(esLevelView, 4 * (x.air?.skyLevel ?? 0) * A, floorLong * (1 - A))
  // Beside a sunlit crescent the long exposure tops out in the lower third;
  // a night side alone is kept darker, so it reads as night and not as a
  // grey full Moon.
  // In a lunar eclipse the bent light IS the picture (a camera exposes for the
  // copper Moon, not for a night side), so it may fill the lower third too.
  const eclipseDriven = search.eclipseLevel > 0.16 * x.ephem.earthshine * search.esMax
  const longMaxFree = nightSideLongMax(qNight, sunPresence, eclipseDriven)
  const longMax = 0.3 * A + longMaxFree * (1 - A)
  if (x.preExposeOn && !earthOnly) {
    // Pre-exposure on the long exposure as well: the earthlit ground's key
    // is stored near 0.05 and faint stars' peaks above 1e-3, far from
    // half-float's flush limit; capped so the brightest possible sunlit
    // pixel (I/F 0.5) stays below half-float's maximum.
    preExpose = Math.min(1e5, Math.max(preExpose, 0.05 / esLevel))
  }
  const starLift = Math.max((1 - sunPresence) * (earthOnly ? 0 : 1), x.starLiftFloor ?? 0)
  return {
    white,
    preExpose,
    esLevel,
    esLevelView,
    longMax,
    hdr,
    starLift,
    whiteFloored: brightest === WHITE_FLOOR && !earthOnly,
    frameBrightest,
    search,
  }
}

/**
 * The white point the Sun or the Earth in the frame asks for, per mode. Orbit exposes for the brightest
 * thing in view (the Sun's disc 50 I/F, the Earth). On the ground the exposure is for the ground (a
 * surface photograph toward a low Sun blows the disc out and keeps the floor): a 50 I/F white point
 * maps the 0.017 I/F floor to black (G1b review 2.4). The disc clips through the shoulder and the glare pass.
 */
export function whiteTargetIF(inGround: boolean, requestedIF: number): number {
  return inGround ? 0 : requestedIF
}

/**
 * The night side's DISPLAY floor (`?nightfloor=<share>`, 0 = off): unlit ground is lifted so the surface always reads a little under the labels
 * (owner, 2026-10-23: "labels on black doesn't make any sense"). It is a look, not light: the Moon pass adds `albedo / 0.12 * uNightFloor` to ground
 * the Sun is below (moonShader.ts), where `uNightFloor` is the radiance (I/F) that the CURRENT exposure shows at `share` of display white for
 * 0.12 albedo, solved here per frame against the final pass's own curve (`unlitDisplay`). So auto-exposure cannot blow it up or lose it: near full
 * Moon the night side is on the short exposure (hdr 0, y = x) and the floor is `share` of white; beside a crescent it is on the long exposure, where
 * a white-relative radiance would saturate to `longMax` as a flat sheet (the #58 lesson), so there it is a share of the long exposure's key instead.
 * The exposure search never sees the floor (it would set the white point on its own lift). `share` is clamped to NIGHT_FLOOR_MAX_SHARE.
 */
export const NIGHT_FLOOR_MAX_SHARE = 0.05
/**
 * The default share (owner, 2026-10-24: a user landed on the far side near full Moon and saw an entirely black disc under the labels; the Moon must
 * never be so dark that its shapes are lost). 0.008 measured about 11 to 26 of 255 by albedo on the L4 (2026-10-23 verify sheet); `?nightfloor=0` turns it off.
 */
export const NIGHT_FLOOR_DEFAULT_SHARE = 0.008
/** `?nightfloor=` as a share of display white: absent or empty is the default; not a number or negative is 0 (off); capped at NIGHT_FLOOR_MAX_SHARE. */
export function nightFloorShare(value: string | null | undefined): number {
  if (value === null || value === undefined || value === '') return NIGHT_FLOOR_DEFAULT_SHARE
  const v = Number(value)
  return Number.isFinite(v) ? Math.max(0, Math.min(NIGHT_FLOOR_MAX_SHARE, v)) : 0
}
/**
 * The final pass's display luminance (linear, before its toe and shoulder) of a pixel read on the LONG exposure: src/post/final.ts
 * `yLong = uLongMax * (1 - exp(-0.7 sE)) + uStarLift * 0.6 * (1 - exp(-max(sE - 3, 0) / 12))`, then `y = mix(x, yLong, uHdr)`.
 * scripts/exposure.test.mts pins the shader text to this twin.
 */
export function unlitDisplay(radianceIF: number, x: Pick<Exposure, 'white' | 'esLevel' | 'longMax' | 'hdr' | 'starLift'>): number {
  const xw = radianceIF / x.white
  const sE = xw / Math.max(x.esLevel / x.white, 1e-9)
  const yLong = x.longMax * (1 - Math.exp(-0.7 * sE)) + (x.starLift ?? 0) * 0.6 * (1 - Math.exp(-Math.max(sE - 3, 0) / 12))
  return (1 - x.hdr) * xw + x.hdr * yLong
}
/**
 * The radiance (I/F, un-pre-exposed) that this exposure displays at `share` of white on unlit ground (`uNightFloor`): the inverse of
 * `unlitDisplay`, by bisection in log radiance. On the long exposure the target is capped at 0.6 of `longMax` (its saturation), and blended views
 * cap the solved radiance at three earthshine keys so the star lift cannot flatten albedo contrast. An unreachable capped target returns the cap and
 * fails dim. 0 when off or when no radiance up to one white reaches the target (fails dark, never bright).
 */
export function nightFloorRadiance(share: number, x: Pick<Exposure, 'white' | 'esLevel' | 'longMax' | 'hdr' | 'starLift'>): number {
  if (!(share > 0) || !(x.white > 0) || !(x.longMax > 0)) return 0
  const h = Math.max(0, Math.min(1, x.hdr))
  const target = Math.min(share, NIGHT_FLOOR_MAX_SHARE) * (1 - h) + Math.min(share, 0.6 * x.longMax) * h
  if (unlitDisplay(x.white, x) < target) return 0
  const cap = h >= 0.05 ? 3 * x.esLevel : x.white
  if (!(cap > 0)) return 0
  const maxRadiance = Math.min(x.white, cap)
  if (unlitDisplay(maxRadiance, x) < target) return maxRadiance
  let lo = Math.log(x.white * 1e-12), hi = Math.log(maxRadiance)
  for (let i = 0; i < 48; i++) {
    const mid = 0.5 * (lo + hi)
    if (unlitDisplay(Math.exp(mid), x) < target) lo = mid; else hi = mid
  }
  return Math.exp(hi)
}
