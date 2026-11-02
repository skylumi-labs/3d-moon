import * as THREE from 'three'
import { MOON_R_KM, H_TEXEL_KM, DEEPEST_LEVEL, levelDeg, levelNx, levelNy, tileIndex } from './grid'
import { COARSEST_LEVEL, finestWanted } from './levels'

/** Level l tiles are wanted while a pixel spans at most this many of their height texels (the shader's ramp ends at 2). */
export const WANT_TEXELS = 2
/**
 * Texels per pixel a tile level is wanted at while a scripted flight runs under ?sharp=1 (`StreamView.texels`): one level coarser than WANT_TEXELS, so a
 * flight's working set fits a phone's 48-layer cache. The end dwell (a rest view) uses WANT_TEXELS again and streams the finer levels.
 */
export const WANT_TEXELS_FLIGHT = 1
export const SAMPLES_X = 80, SAMPLES_Y = 56
/** A sample this close to a tile's edge (share of the tile) also wants the neighbour, so a tile never ends at a seam with its neighbour missing. */
export const EDGE_WANT = 0.2
export const GLOBAL_TEXEL_KM = (2 * Math.PI * MOON_R_KM) / 4096
/** Anisotropy the colour textures filter with; the tile LOD must agree with it (moonShader.ts ANISO_TILE). */
export const ANISO_TILE = 8

/**
 * The footprint (km) a tile's level is chosen for. A pixel on ground seen at cosine `mu` covers `minorKm` across the view and
 * `minorKm / mu` along it. The old rule took the long axis, so every grazing view asked for a level up to 2.7 octaves too coarse for
 * the sharp direction (the far field went soft). An anisotropic filter resolves the long axis down to `aniso` times the short one,
 * so the level that matches it is `max(minor, major / aniso)`: the short axis once the ratio is within the filter's reach.
 * mu is clamped at 0.15 (the curvature of the Moon, not terrain, sets it there).
 */
export function effectiveFootprintKm(minorKm: number, mu: number, aniso = ANISO_TILE): number {
  const major = minorKm / Math.max(mu, 0.15)
  return Math.max(minorKm, major / aniso)
}

export interface StreamView {
  /** Camera position, Moon radii, world frame. */
  pos: THREE.Vector3
  right: THREE.Vector3
  up: THREE.Vector3
  back: THREE.Vector3
  tanHalf: number
  aspect: number
  /** Tangent of one canvas pixel's angle (full-resolution canvas, not the scaled target). */
  tanPerPx: number
  /** Moon body axes in the world frame. */
  moonX: THREE.Vector3
  moonY: THREE.Vector3
  moonZ: THREE.Vector3
  /** A gesture is moving the camera: the wanted set may be up to MOVING_WANTED_MS old (see reuseWanted). */
  moving?: boolean
  /** Scripted flights bypass the gesture wanted-set throttle so demand tracks every sampled pose. */
  flight?: boolean
  /** The camera is scripted (a flight, the hover over a site, a descent, ground mode, a glide): the detail share leaves the focus indicator out. */
  scripted?: boolean
  /** False for a frame-stepped capture: the wanted set must then answer the exact pose of every frame (default true). */
  flightReuse?: boolean
  /** Texels per pixel this view wants a level at; absent: WANT_TEXELS. Set only by a sharp flight (WANT_TEXELS_FLIGHT). */
  texels?: number
  /** Identity of the active scripted camera flight. */
  flightId?: number
  /** A site's photograph is downloading while a descent waits for it: the tiles yield the link (few in flight, low priority). */
  patchLoading?: boolean
  /** Smoothed rAF interval in ms (main.ts `frameMs`): at rest a slow frame uploads proportionally more tiles (uploadsThisFrame). Absent: the fixed UPLOADS_AT_REST. */
  frameMs?: number
  /** `?pressyield=1` (rest-to-motion, WP-A): the first PRESS_YIELD_MS after a pointerdown upload nothing, so the gesture's first frames carry no tile upload. Fetches and decodes go on. */
  yield?: boolean
}

/** Cap on tile jobs in flight when a descent waits for its patch: the patch download owns the link, the tiles take what is left. */
export const PATCH_LOADING_INFLIGHT = 2
/** How many tile jobs may be in flight: the patch-loading cap wins over the normal and the flight caps. */
export function inflightCap(v: { flight?: boolean; patchLoading?: boolean }, normal: number, flight: number): number {
  const cap = v.flight ? flight : normal
  return v.patchLoading ? Math.min(cap, PATCH_LOADING_INFLIGHT) : cap
}

/**
 * computeWanted samples 4480 rays and runs once per streamer (tiles, detail, TC): measured 10+ ms each, every frame of a drag, on the main thread, in
 * series with the GPU. While a gesture moves the camera the set changes slowly against what the network can deliver, so it is recomputed at most this often.
 * The first frame after the gesture (moving false) always recomputes, so the view the camera comes to rest on is the one that is fetched.
 */
export const MOVING_WANTED_MS = 90
/** Tile uploads per frame (per streamer) when no gesture is moving the camera. */
export const UPLOADS_AT_REST = 4
/** Tile uploads per frame (per streamer) during a scripted flight: a texSubImage3D lands on the GPU process and stalls the frame behind it, so a flight spreads them . */
export const UPLOADS_IN_FLIGHT = 4
/** At-rest uploads scale with the frame interval: one upload per UPLOAD_MS_PER_TILE ms of frame, clamped to [UPLOADS_AT_REST, UPLOADS_AT_REST_MAX]. */
export const UPLOAD_MS_PER_TILE = 8
export const UPLOADS_AT_REST_MAX = 16

/**
 * The tile pump, opt-in (`?pump=1`; absent is today). `?uploads=N` pins the at-rest upload count to N, 1..16, with or without the pump.
 * Pump on: a settled fetch/decode admits the next queued job at once instead of waiting for the next drawn frame, and at rest the uploads per frame follow the frame interval.
 * Pump off (default): admission only inside update(), UPLOADS_AT_REST uploads per frame at rest.
 */
export interface PumpConfig { pump: boolean; uploads: number }
export function pumpOf(search: string): PumpConfig {
  const q = new URLSearchParams(search)
  const n = Number(q.get('uploads'))
  return { pump: q.get('pump') === '1', uploads: q.has('uploads') && Number.isInteger(n) && n >= 1 && n <= UPLOADS_AT_REST_MAX ? n : 0 }
}
/**
 * Fold one frameLoop tick's rAF gap into the smoothed frame cost the at-rest upload budget reads. The caller feeds every rAF tick: rAF runs at display rate even when
 * nothing is dirty, so an idle stretch between draws reads as 16 ms ticks, not as one slow frame. A gap over a second (hidden tab, stall) is ignored.
 */
export function foldRafGap(prev: number, gap: number): number {
  if (!(gap > 0 && gap <= 1000)) return prev
  return prev * 0.85 + Math.min(gap, 500) * 0.15
}
/** Live configuration; a test replaces it with setPump. */
let pumpCfg: PumpConfig = pumpOf(typeof location === 'undefined' ? '' : location.search)
export function setPump(search: string): void { pumpCfg = pumpOf(search) }
export function pumpOn(): boolean { return pumpCfg.pump }
/**
 * May a settled job admit more work outside update()? Never in a frame-stepped capture (flightReuse false): admission there must happen on the frame
 * so the capture stays deterministic, and never before a first update() has given a view to admit against.
 */
export function mayPump(v: { flightReuse?: boolean } | null | undefined): boolean { return pumpCfg.pump && !!v && v.flightReuse !== false }

/**
 * Centre-out upload order (R59). Decoded tiles used to go to the GPU in arrival order, so a slow-to-fetch tile near the middle of the frame waited behind
 * edge tiles that happened to land first. With the reveal on, each upload takes the ready tile with the lowest CURRENT wanted priority
 * (coarse level first, then nearest the middle of the frame, the order fetches are already admitted in); ties keep arrival order; a tile nobody wants any more
 * goes last. `?reveal=0` restores arrival order. The fetch order, the uploads per frame and the fade are untouched, so this changes which tile comes first, not how many.
 */
export function revealOf(search: string): boolean { return new URLSearchParams(search).get('reveal') !== '0' }
let revealOn = revealOf(typeof location === 'undefined' ? '' : location.search)
export function setReveal(search: string): void { revealOn = revealOf(search) }
export function takeReady<T extends { job: { key: number } }>(ready: T[], wanted: ReadonlyMap<number, { priority: number }>): T | undefined {
  if (!revealOn || ready.length < 2) return ready.shift()
  let best = 0, bestP = Infinity
  for (let i = 0; i < ready.length; i++) {
    const w = wanted.get(ready[i].job.key)
    const p = w ? w.priority : Infinity
    if (p < bestP) { best = i; bestP = p }
  }
  return ready.splice(best, 1)[0]
}

/** How many ready tiles one streamer uploads this frame: one under a gesture, UPLOADS_IN_FLIGHT in a flight, at rest UPLOADS_AT_REST or, with the pump, one per UPLOAD_MS_PER_TILE of frame interval. */
export function uploadsThisFrame(v: { moving?: boolean; flight?: boolean; frameMs?: number; yield?: boolean }, frameMs: number | undefined = v.frameMs): number {
  if (v.yield) return 0
  if (v.flight) return UPLOADS_IN_FLIGHT
  if (v.moving) return 1
  if (pumpCfg.uploads > 0) return pumpCfg.uploads
  if (!pumpCfg.pump || frameMs === undefined || !Number.isFinite(frameMs)) return UPLOADS_AT_REST
  return Math.min(UPLOADS_AT_REST_MAX, Math.max(UPLOADS_AT_REST, Math.round(frameMs / UPLOAD_MS_PER_TILE)))
}
export function reuseWanted(v: StreamView, memoAt: number, now: number): boolean {
  return !!v.moving && !v.flight && now - memoAt < MOVING_WANTED_MS && now >= memoAt
}

/**
 * Equal when two views want the same tiles. The inputs are rounded: the Moon's axes turn with the simulated clock (2.7e-6 rad a second), so
 * an exact key changed EVERY frame of a camera that had not moved and the wanted set (about 10 ms) was recomputed at rest. The rounding is
 * 2e-6 rad on the Moon's axes (about a second of lunar rotation), 1e-6 on the camera (1.7 m, far below any tile edge or footprint it could
 * change) and six figures on the scalars: a tile edge crossing is delayed by a frame or a second, never missed.
 */
export function viewKey(v: StreamView): string {
  const q = (x: number, step: number): number => Math.round(x / step)
  const f = (a: THREE.Vector3, step: number): string => `${q(a.x, step)},${q(a.y, step)},${q(a.z, step)}`
  const sc = (x: number): string => x.toPrecision(6)
  return [f(v.pos, 1e-6), f(v.right, 1e-6), f(v.up, 1e-6), f(v.back, 1e-6), sc(v.tanHalf), sc(v.aspect), sc(v.tanPerPx), f(v.moonX, 2e-6), f(v.moonY, 2e-6), f(v.moonZ, 2e-6)].join('|')
}

/**
 * The identity of a memoised wanted set: the view AND whether it was computed from every other ray (`moving`). Without the flag the strided set
 * of a gesture's last frames was returned unchanged at rest (same pose, same key) and the narrowest tiles were never requested.
 */
export function wantedMemoKey(v: StreamView, extra = ''): string {
  return `${viewKey(v)}${extra}${v.moving ? '|m' : ''}${v.flight ? '|f' : ''}${v.texels !== undefined ? `|t${v.texels}` : ''}`
}

/** May the memo (made at `memoAt` under `memoKey`) answer this frame? Same identity, or a moving frame inside the throttle window. */
export function wantedMemoValid(memoKey: string, key: string, v: StreamView, memoAt: number, now: number, noThrottle = false, flightWindowMs = 0, memoView?: StreamView, computedAt = memoAt): boolean {
  return key === memoKey && !v.flight || (!noThrottle && reuseWanted(v, memoAt, now)) || flightReuseWanted(v, memoAt, now, flightWindowMs, memoView, computedAt)
}

/**
 * Wanted-set windows during a scripted flight, ms, one per streamer (colour/height, TC, detail). The wanted set cost 8 to 9 ms per frame on the rig
 * (three streamers, every frame, up to 48 ms in a frame with the exposure search), and a flight's camera moves a few pixels per frame: a set that
 * is up to 3 to 5 frames old requests the same tiles, and the flight prefetch runs 2 s ahead of the camera anyway. The windows differ so the three
 * recomputes land on different frames instead of one.
 */
/** Default flight-window multiplier (J1 rig A/B: x4 removes ~60 % of the >=50 ms gaps on the Plato/Tycho flights with no residency loss). `?flightwant=1` restores the old 50/67/84 ms windows. Clamp 1..8. */
export const FLIGHT_WANTED_DEFAULT = 4
export function flightWantedScale(search: string): number {
  const raw = new URLSearchParams(search).get('flightwant')
  if (raw === null) return FLIGHT_WANTED_DEFAULT
  const v = Number(raw)
  return Number.isFinite(v) && v >= 1 && v <= 8 ? v : FLIGHT_WANTED_DEFAULT
}
const FLIGHT_WANTED_SCALE = (() => { try { return flightWantedScale(location.search || (window as { __moonQuery?: string }).__moonQuery || '') } catch { return FLIGHT_WANTED_DEFAULT } })()
export const FLIGHT_WANTED_MS = { tiles: 50 * FLIGHT_WANTED_SCALE, tc: 67 * FLIGHT_WANTED_SCALE, detail: 84 * FLIGHT_WANTED_SCALE } as const

/** Measurement only (`?wantprobe=1`): how much of an exact (unthrottled) want is resident, and how much of it the throttled memo does not hold. */
export function wantResidency(exact: Map<number, Want>, memo: Map<number, Want> | null, resident: (key: number) => boolean): { wanted: number; resident: number; stale: number } {
  let res = 0, stale = 0
  for (const w of exact.values()) { if (resident(w.key)) res++; if (memo && !memo.has(w.key)) stale++ }
  return { wanted: exact.size, resident: res, stale }
}
export function flightReuseWanted(v: StreamView, memoAt: number, now: number, windowMs: number, memoView?: StreamView, computedAt = memoAt): boolean {
  if (!v.flight || v.flightReuse === false || !memoView?.flight || windowMs <= 0 || now < computedAt || now - computedAt >= windowMs) return false
  const closeAxis = (a: THREE.Vector3, b: THREE.Vector3): boolean => a.distanceTo(b) <= 1e-4
  if (!closeAxis(v.moonX, memoView.moonX) || !closeAxis(v.moonY, memoView.moonY) || !closeAxis(v.moonZ, memoView.moonZ)) return false
  if (Math.abs(v.tanHalf - memoView.tanHalf) > 1e-6 * Math.max(1, Math.abs(memoView.tanHalf)) || Math.abs(v.aspect - memoView.aspect) > 1e-6 * Math.max(1, Math.abs(memoView.aspect))) return false
  if (v.flightId !== memoView.flightId) return false
  const angle = Math.acos(Math.max(-1, Math.min(1, v.back.dot(memoView.back) / Math.max(1e-12, v.back.length() * memoView.back.length()))))
  const altitude = (view: StreamView): number => view.pos.length() - 1
  return angle <= 0.15 * v.tanHalf && Math.abs(altitude(v) - altitude(memoView)) <= 0.05 * Math.max(1e-9, altitude(memoView))
}

/** What `computeWanted` needs to know of the tile set. */
export interface WantContext {
  /** Finest level the set has (0, or -1 to -4). */
  deepest: number
  /** Does the manifest list this tile? */
  isPresent(level: number, index: number): boolean
  /** The tile's key (page-table cell). */
  keyOf(level: number, tx: number, ty: number): number
  /** Anisotropy the footprint assumes (default ANISO_TILE; 1 is the old long-axis rule, kept for tests). */
  aniso?: number
  /**
   * Fixed shadow policy: also mark `shade` on the level the shader's `horizonSun` reads for each pixel (round of log2 of the footprint ALONG the view over the
   * height texel, mu clamped at 0.02, capped at level 2). That footprint ignores the anisotropic filter, so near a limb or a grazing corner it is several
   * levels coarser than `finest`, and a tile there was never built: the fixed shader then drew the coarse horizon map at the frame edge. Off (default): the
   * legacy rule `level <= finest + 1` alone, so legacy and the live march are unchanged.
   */
  shaderShade?: boolean
}

/** The shader's footprint floor on mu for the shadow LOD (moonShader.ts lodST). */
export const SHADOW_LOD_MU_MIN = 0.02

/**
 * The tile level `horizonSun` rounds to for a pixel whose long-axis footprint is `log2(footprint / height texel) = lodExp`: the level the fixed shader reads
 * its cached horizon from (moonShader.ts `int lm = min(int(floor(lodT + 0.5)), 2)`, lodT floored at the deepest level).
 */
export function shaderShadowLevel(lodExp: number, deepest: number): number {
  return Math.min(COARSEST_LEVEL, Math.floor(Math.max(deepest, lodExp) + 0.5))
}

/**
 * The ground geometry of a view's ray grid, the part of `computeWanted` that does not depend on which tiles a streamer has: for each ray that meets
 * the sphere inside the shader's gate, in sample order, the wrapped longitude (deg, 0..360), the latitude (deg), the effective pixel footprint on the
 * ground (km) and the distance from the frame centre. The tile, detail and TC streamers each ran this pass (4480 ray-sphere hits, two atan2/asin, a
 * normalise per ray) on the same view and differed only in the per-level walk after it.
 */
export interface RaySamples { n: number; lonW: Float64Array; lat: Float64Array; fpKm: Float64Array; centre: Float64Array; /** log2(long-axis footprint / height texel), mu clamped at SHADOW_LOD_MU_MIN: the shadow LOD the shader rounds. */ shLod: Float64Array }

export function raySamples(v: StreamView, aniso: number | undefined): RaySamples {
  const tanW = v.tanHalf * v.aspect
  const r = new THREE.Vector3(), m = new THREE.Vector3(), p = new THREE.Vector3(), tc = new THREE.Vector3()
  // A moving gesture samples every other ray in each direction (a quarter of the work); the first frame at rest samples them all.
  const st = v.moving && !v.flight ? 2 : 1
  const cap = SAMPLES_X * SAMPLES_Y
  const lonW = new Float64Array(cap), lat = new Float64Array(cap), fpKm = new Float64Array(cap), centre = new Float64Array(cap), shLod = new Float64Array(cap)
  let n = 0
  for (let j = 0; j < SAMPLES_Y; j += st) for (let i = 0; i < SAMPLES_X; i += st) {
    const sx = ((i + 0.5) / SAMPLES_X * 2 - 1) * tanW, sy = ((j + 0.5) / SAMPLES_Y * 2 - 1) * v.tanHalf
    r.copy(v.back).multiplyScalar(-1).addScaledVector(v.right, sx).addScaledVector(v.up, sy).normalize()
    const t = -v.pos.dot(r)
    if (t <= 0) continue
    m.copy(v.pos).addScaledVector(r, t)
    const b2 = m.lengthSq()
    if (b2 >= 1) continue
    p.copy(v.pos).addScaledVector(r, t - Math.sqrt(1 - b2))
    tc.copy(v.pos).sub(p)
    const range = tc.length()
    const muRaw = p.dot(tc) / range
    const mu = Math.max(0.15, muRaw)
    const minorKm = range * MOON_R_KM * v.tanPerPx
    const fp = effectiveFootprintKm(minorKm, mu, aniso)
    // The shader's gate: no tile is drawn at 0.9 global texels per pixel or more.
    if (fp / GLOBAL_TEXEL_KM >= 0.9) continue
    const lon = Math.atan2(p.dot(v.moonY), p.dot(v.moonX)) * 180 / Math.PI
    lat[n] = Math.asin(Math.max(-1, Math.min(1, p.dot(v.moonZ)))) * 180 / Math.PI
    lonW[n] = ((lon + 180) % 360 + 360) % 360
    fpKm[n] = fp
    shLod[n] = Math.log2(minorKm / Math.max(muRaw, SHADOW_LOD_MU_MIN) / H_TEXEL_KM)
    centre[n] = Math.hypot(sx / tanW, sy / v.tanHalf)
    n++
  }
  return { n, lonW, lat, fpKm, centre, shLod }
}

/**
 * `?wantshare=0` gives every `computeWanted` its own ray pass (the old behaviour); otherwise the three streamers of one frame share one. The memo holds the
 * last pass keyed by EXACT equality of every input (not the rounded viewKey), so a hit returns precisely what a fresh pass would. Gain only where the streamers
 * recompute on the same frame (the first frame at rest, the start of a gesture, a camera stop); their staggered flight windows still recompute apart.
 */
export function wantShareOf(search: string): boolean { return new URLSearchParams(search).get('wantshare') !== '0' }
let shareOn = wantShareOf(typeof location === 'undefined' ? '' : location.search || (globalThis as { __moonQuery?: string }).__moonQuery || '')
export function setWantShare(search: string): void { shareOn = wantShareOf(search); shared = null }
export function wantShareEnabled(): boolean { return shareOn }
/** Ray passes run and reused since start (a test and `?perf=1` read them). */
export const rayPassStats = { computed: 0, shared: 0 }
interface SharedPass { key: number[]; aniso: number | undefined; moving: boolean; flight: boolean; samples: RaySamples }
let shared: SharedPass | null = null
function viewNumbers(v: StreamView): number[] {
  return [v.pos.x, v.pos.y, v.pos.z, v.right.x, v.right.y, v.right.z, v.up.x, v.up.y, v.up.z, v.back.x, v.back.y, v.back.z, v.tanHalf, v.aspect, v.tanPerPx,
    v.moonX.x, v.moonX.y, v.moonX.z, v.moonY.x, v.moonY.y, v.moonY.z, v.moonZ.x, v.moonZ.y, v.moonZ.z]
}
export function sharedRaySamples(v: StreamView, aniso: number | undefined): RaySamples {
  if (!shareOn) { rayPassStats.computed++; return raySamples(v, aniso) }
  const key = viewNumbers(v)
  const moving = !!v.moving, flight = !!v.flight
  const s = shared
  if (s && s.aniso === aniso && s.moving === moving && s.flight === flight && s.key.every((x, i) => x === key[i])) { rayPassStats.shared++; return s.samples }
  const samples = raySamples(v, aniso)
  rayPassStats.computed++
  shared = { key, aniso, moving, flight, samples }
  return samples
}

/**
 * The tiles a frame wants, before the cache cut: a grid of rays over the frame, the level chosen from the pixel footprint on the ground, each
 * with its coarser ancestors as fallback (level 2 always) and, near a tile's edge, the neighbour. Pure of GL, so it is tested on a stub view.
 */
export function computeWanted(v: StreamView, ctx: WantContext): Map<number, Want> {
  const out = new Map<number, Want>()
  const rs = sharedRaySamples(v, ctx.aniso)
  const shaderLv = ctx.shaderShade === true
  // Per level: its tile grid, worked out once, and the last sample's answer. Neighbouring rays land in the same tile far more often than not
  // (a nadir frame at the floor wants about 60 tiles for 4480 rays), and then the tiles a sample wants are the same entries as the last one's:
  // only their priority and keep scores can change. `sig` identifies a (tile, edge zone) cell; `ents`/`pens` are the present tiles it wants.
  const nL = COARSEST_LEVEL + 1 - DEEPEST_LEVEL
  const lvDeg = new Float64Array(nL), lvNx = new Float64Array(nL), lvNy = new Float64Array(nL)
  const sig = new Float64Array(nL).fill(-1)
  const ents: Want[][] = Array.from({ length: nL }, () => [])
  const pens: number[][] = Array.from({ length: nL }, () => [])
  for (let l = DEEPEST_LEVEL; l <= COARSEST_LEVEL; l++) { const i = l - DEEPEST_LEVEL; lvDeg[i] = levelDeg(l); lvNx[i] = levelNx(l); lvNy[i] = levelNy(l) }
  for (let ri = 0; ri < rs.n; ri++) {
    const lat = rs.lat[ri], lonW = rs.lonW[ri], fpKm = rs.fpKm[ri], centre = rs.centre[ri]
    const finest = finestWanted(fpKm, H_TEXEL_KM, v.texels ?? WANT_TEXELS, ctx.deepest)
    // The finest level that helps and every coarser one as its fallback (L2 always).
    for (let l = Math.min(finest, COARSEST_LEVEL); l <= COARSEST_LEVEL; l++) {
      const li = l - DEEPEST_LEVEL
      const d = lvDeg[li], nx = lvNx[li], ny = lvNy[li]
      const tx = Math.min(nx - 1, Math.floor(lonW / d)), ty = Math.min(ny - 1, Math.max(0, Math.floor((90 - lat) / d)))
      const fx = lonW / d - tx, fy = (90 - lat) / d - ty
      // Edge zone per axis: 0 the tile itself, 1 also the lower neighbour, 2 also the upper one (same rule as the neighbour pick below).
      const zx = fx < EDGE_WANT ? 1 : fx > 1 - EDGE_WANT ? 2 : 0
      const zy = fy < EDGE_WANT && ty > 0 ? 1 : fy > 1 - EDGE_WANT && ty < ny - 1 ? 2 : 0
      const s = (ty * nx + tx) * 9 + zy * 3 + zx
      const keep = keepScore(centre, l)
      const sh = l <= finest + 1 || (shaderLv && l === shaderShadowLevel(rs.shLod[ri], ctx.deepest))
      const base = (COARSEST_LEVEL - l) * 10 + centre
      if (s === sig[li]) {
        const es = ents[li], ps = pens[li]
        for (let k = 0; k < es.length; k++) {
          const e = es[k]
          const pr = base + ps[k]
          if (pr < e.priority) e.priority = pr
          if (keep < e.keep) e.keep = keep
          if (sh) e.shade = true
        }
        continue
      }
      sig[li] = s
      const es = ents[li], ps = pens[li]
      es.length = 0; ps.length = 0
      const cols = zx === 1 ? [tx, (tx + nx - 1) % nx] : zx === 2 ? [tx, (tx + 1) % nx] : [tx]
      const rows = zy === 1 ? [ty, ty - 1] : zy === 2 ? [ty, ty + 1] : [ty]
      for (const cy of rows) for (const cx of cols) {
        if (!ctx.isPresent(l, tileIndex(l, cx, cy))) continue
        const key = ctx.keyOf(l, cx, cy)
        // Coarse first, then near the middle of the frame; a neighbour a little after its sample's own tile.
        const pen = cx === tx && cy === ty ? 0 : 0.3
        const priority = base + pen
        let e = out.get(key)
        if (!e) { e = { key, level: l, tx: cx, ty: cy, priority, keep }; out.set(key, e) }
        else { if (priority < e.priority) e.priority = priority; if (keep < e.keep) e.keep = keep }
        if (sh) e.shade = true
        es.push(e); ps.push(pen)
      }
    }
  }
  return out
}

/** A tile the frame wants. `keep` orders the cut when more are wanted than the cache holds (lower is kept first). */
export interface Want {
  key: number; level: number; tx: number; ty: number; priority: number; keep: number
  /** Some pixel's footprint reads this level for its shading (the shader's round(log2 ratio) is the finest wanted level or the next): the shadow cache builds only these. */
  shade?: boolean
}

/**
 * Keep score of a tile wanted by a sample `centre` (0 at the middle of the frame, ~1.4 at a corner)
 * at a level: near the middle first, finer before coarser. A coarse fallback only stands in while
 * its finer tile loads (the 4k map shows through beyond it), so it is the first to give up a slot.
 */
export const keepScore = (centre: number, level: number): number => centre + 0.25 * level

/**
 * When more tiles are wanted than the cache holds (a phone at pitch), the coarse fallbacks used to
 * fill it and starve the near-ground level-0 tiles (measured: 4 of 20 level-0 tiles resident at 24
 * layers). Drops the worst-scoring wants past `capacity - 2` (two layers stay free for arrivals);
 * dropped tiles are simply not wanted: evictable and not fetched.
 */
export function cutWanted<T extends { key: number; keep: number }>(out: Map<number, T>, capacity: number, only: (t: T) => boolean = () => true, reserve = 2): void {
  const room = Math.max(1, capacity - reserve)
  const pool = [...out.values()].filter(only)
  if (pool.length <= room) return
  const ranked = pool.sort((a, b) => a.keep - b.keep)
  for (let i = room; i < ranked.length; i++) out.delete(ranked[i].key)
}

/**
 * The cut for a set with two caches: the built levels (0 to 2) carry colour, held in `colourCap` layers; deeper tiles carry heights only and
 * live in the layers past them, so the whole array is `heightCap` layers (TileStreamer). The colour-bearing wants are cut to their own share
 * first and are then EXEMPT from the second cut, which trims only the deeper wants to what is left: a flood of fine tiles (a phone nadir at the
 * floor wants 100 to 220) can never push the coarse fallbacks out of the cache and leave the uncovered part of the frame on the 4k map. `admissionReserve`
 * replaces the default two-slot arrival slack for the deeper pool when the uploader has a larger class-specific reserve.
 */
export function cutWantedSplit<T extends { key: number; keep: number; level: number }>(out: Map<number, T>, colourCap: number, heightCap: number, admissionReserve = 2): void {
  // The coarsest level (20 degree tiles, the always-wanted floor under everything finer) is exempt: a pitched frame wants more level-0/1 tiles
  // than a phone's colour layers hold (effectiveFootprintKm), and losing a level-2 tile drops that ground to the 4k map.
  let floorTiles = 0
  for (const t of out.values()) if (t.level === COARSEST_LEVEL) floorTiles++
  cutWanted(out, colourCap - floorTiles, (t) => t.level >= 0 && t.level < COARSEST_LEVEL)
  let built = 0
  for (const t of out.values()) if (t.level >= 0) built++
  // TileStreamer keeps a small number of colour layers available for future
  // colour-bearing arrivals. Match that admission reserve here so the cut
  // cannot promise more height-only tiles than upload() can place.
  const deepRoom = Math.max(1, heightCap - built - admissionReserve)
  const deep = [...out.values()].filter((t) => t.level < 0)
  if (deep.length > deepRoom) {
    // Keep a bounded finest-level share so a polar view retains central -3
    // detail while the remainder preserves its coarser deep fallbacks. A
    // strict coarser-first cut removes every -3 tile; a strict finest-first
    // cut removes the -2/-1 coverage needed to grade into the built map.
    const levels = [...new Set(deep.map((t) => t.level))].sort((a, b) => a - b)
    const finest = levels[0]
    const fine = deep.filter((t) => t.level === finest).sort((a, b) => a.keep - b.keep)
    const fineKeep = Math.min(fine.length, Math.max(1, Math.floor(deepRoom / 4)))
    const keep = new Set(fine.slice(0, fineKeep).map((t) => t.key))
    const remainder = deep.filter((t) => !keep.has(t.key)).sort((a, b) => b.level - a.level || a.keep - b.keep)
    for (let i = Math.max(0, deepRoom - fineKeep); i < remainder.length; i++) out.delete(remainder[i].key)
  }
}

/**
 * The highest and lowest ground (m) of each 20 deg tile, 18 x 9 cells of (max, min), for the terrain
 * shell (moonShader.ts boundAt). Taken over the level-0 tiles inside each cell, NOT from the level-2
 * tiles' own manifest entries: those are box-filtered copies, so their extremes are smoothed and
 * would cut summits off the shell (374 of the 2,592 level-0 tiles lie outside their level-2
 * parent's range in the built set). A cell with no tile keeps the globe's bounds.
 */
export function boundGrid(man: { present: string[]; maxQ: number[][]; minQ: number[][]; height: { stepM: number } }, up = 11000, down = -9300): Float32Array {
  const nx0 = 72, nx = 18, ny = 9
  const out = new Float32Array(nx * ny * 2)
  for (let cy = 0; cy < ny; cy++) for (let cx = 0; cx < nx; cx++) {
    let hi = -Infinity, lo = Infinity
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const k = (cy * 4 + j) * nx0 + cx * 4 + i
      if (man.present[0][k] !== '1') { hi = Infinity; lo = -Infinity; continue }
      hi = Math.max(hi, man.maxQ[0][k] * man.height.stepM)
      lo = Math.min(lo, man.minQ[0][k] * man.height.stepM)
    }
    const o = 2 * (cy * nx + cx)
    out[o] = Number.isFinite(hi) ? hi : up
    out[o + 1] = Number.isFinite(lo) ? lo : down
  }
  return out
}
