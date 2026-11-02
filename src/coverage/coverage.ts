// A named import, so the bundle carries only `regions` (not the build-time `builtFrom` URL that scripts/build-coverage.mts records).
import { regions } from './regions.json'
import { FLOOR_MAX_PX, SITE_CONE, angularDistance, siteAltR, wrapLon } from '../camera/pose'
import { MOON_R_KM } from '../glsl/common'

/**
 * Where the finest real data is (scripts/build-coverage.mts reads it from the hosted manifests into regions.json).
 * The zoom limit, the debug resolution map and the fly-to close-ups all read it, so none of them can promise more detail than
 * a texel somewhere holds. Nothing here upsamples: a place outside every fine region has the global tiles' texel and no more.
 */
export interface CoverageRegion {
  /** 'internal-only' data (restricted-licence sources: agency data without public clearance, company or unconfirmed licences; the JAXA SELENE Terrain Camera is not among them, it is public under the ISAS data policy with the credit "ISAS/JAXA (modified)") lives under its own tile prefix and is dropped by publicOnly(). */
  licence: 'public' | 'internal-only'
  credit: string
  id: string
  site: string | null
  /** Ground size of one source texel, metres. */
  texelM: number
  /** What the camera floor and the map count when the picture is coarser than one texel says (an anisotropic 27 x 56 cm image is 0.4 m): the viewer's own figure. Absent: texelM. */
  effectiveTexelM?: number
  imagery: boolean
  height: boolean
  lon0: number
  lon1: number
  lat0: number
  lat1: number
  source: string
}
/** The texel the viewer counts a region at. */
export const effTexelM = (r: CoverageRegion): number => r.effectiveTexelM ?? r.texelM
const BUNDLED: CoverageRegion[] = regions as CoverageRegion[]
const REMOTE: CoverageRegion[] = []
/** The one switch: every restricted-licence region removed. skylumi.app must ship only this set without fresh permission. */
export const publicOnly = (regions: CoverageRegion[]): CoverageRegion[] => regions.filter((r) => r.licence === 'public')
/** True only in the dev server. Vite folds `import.meta.env.DEV` to a literal false in a production build, so every branch behind it is dead code there (and `?.` keeps node, which has no import.meta.env, working in tests). */
export const DEV_BUILD: boolean = import.meta.env?.DEV === true
/** ?internal=1 counts only in a dev build. A production page ignores the parameter whatever the URL says. */
export const internalRequested = (dev: boolean, search: string): boolean => dev && new URLSearchParams(search).get('internal') === '1'
const INTERNAL = typeof location !== 'undefined' && internalRequested(DEV_BUILD, location.search)
/** What the page knows now: the bundled regions plus whatever hosted coverage.json files have been loaded. Restricted regions exist here only in the dev server with ?internal=1; a production build always holds the public set. */
export const REGIONS: CoverageRegion[] = INTERNAL ? [...BUNDLED] : publicOnly(BUNDLED)

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/** Validates a hosted coverage.json (TILE-CONTRACT.md section 3); rows that break the contract are dropped and reported, never guessed at. */
export function parseCoverage(json: unknown): { regions: CoverageRegion[]; rejected: string[] } {
  const rows = (json as { regions?: unknown })?.regions
  const regions: CoverageRegion[] = [], rejected: string[] = []
  if (!Array.isArray(rows)) return { regions, rejected: ['no regions array'] }
  for (const r of rows as Record<string, unknown>[]) {
    const ok = r && typeof r.id === 'string' && r.id.length > 0 && finite(r.texelM) && r.texelM > 0
      && finite(r.lon0) && finite(r.lon1) && finite(r.lat0) && finite(r.lat1) && r.lon0 >= -180 && r.lon1 <= 180 && r.lon0 < r.lon1 && r.lat0 >= -90 && r.lat1 <= 90 && r.lat0 < r.lat1
      && typeof r.imagery === 'boolean' && typeof r.height === 'boolean' && (r.imagery || r.height)
      && (r.licence === 'public' || r.licence === 'internal-only') && typeof r.credit === 'string' && r.credit.length > 0 && typeof r.source === 'string'
    if (ok) regions.push({ id: r.id as string, site: typeof r.site === 'string' ? r.site : null, texelM: r.texelM as number, ...(finite(r.effectiveTexelM) && r.effectiveTexelM >= (r.texelM as number) ? { effectiveTexelM: r.effectiveTexelM } : {}), imagery: r.imagery as boolean, height: r.height as boolean, lon0: r.lon0 as number, lon1: r.lon1 as number, lat0: r.lat0 as number, lat1: r.lat1 as number, licence: r.licence as 'public' | 'internal-only', credit: r.credit as string, source: r.source as string })
    else rejected.push(String((r as { id?: unknown })?.id ?? '?'))
  }
  return { regions, rejected }
}

const BUNDLED_IDS = new Set(BUNDLED.map((r) => r.id))
const GLOBAL_TEXEL_M = Math.min(...BUNDLED.filter((r) => r.site === null && r.imagery).map(effTexelM))
/** The rows a loader may keep: everything with allowInternal, otherwise the public set only. */
export const admitRegions = (list: CoverageRegion[], allowInternal: boolean): CoverageRegion[] => (allowInternal ? list : publicOnly(list))

/**
 * Adds hosted regions. A row tagged 'internal-only' is dropped here whatever the URL says (the hosted files are public, so a restricted row in one
 * is a mistake, never a source); restricted rows come only from addInternalRegions in the dev server. A hosted row never replaces a bundled id (a typo of "global" would
 * turn the whole Moon green and drop the floor everywhere), and an imagery row with no site cannot claim to be finer than the bundled global picture
 * (the global pyramid is fixed at three levels). A hosted row replaces an earlier hosted row of the same id. Returns how many were added.
 */
export function addRegions(list: CoverageRegion[]): number {
  return mergeRegions(admitRegions(list, false))
}
/** Dev only (see loadInternalCoverage): adds restricted rows when the page was opened with ?internal=1 on the dev server; otherwise adds nothing. */
export function addInternalRegions(list: CoverageRegion[], allow: boolean = INTERNAL): number {
  return allow ? mergeRegions(list) : 0
}
function mergeRegions(list: CoverageRegion[]): number {
  let n = 0
  for (const r of list) {
    if (BUNDLED_IDS.has(r.id)) { console.warn('coverage.json: row would replace a bundled region, ignored:', r.id); continue }
    if (r.imagery && r.site === null && effTexelM(r) < GLOBAL_TEXEL_M) { console.warn('coverage.json: a siteless imagery row cannot beat the global picture, ignored:', r.id); continue }
    const i = REGIONS.findIndex((x) => x.id === r.id)
    if (i >= 0) REGIONS[i] = r; else REGIONS.push(r)
    REMOTE.push(r); n++
  }
  return n
}

/**
 * The prefix roots the hosted coverage.json files live at (TILE-CONTRACT.md section 3): the tile and patch bases are `<root>tiles/` and
 * `<root>patch/`, and the file sits at `<root>coverage.json`. A base that does not end that way is itself the root. Duplicates are dropped.
 */
export function coverageRoots(bases: Array<string | null | undefined>): string[] {
  const out: string[] = []
  for (const b of bases) {
    if (!b) continue
    const root = b.replace(/\/?$/, '/').replace(/(tiles|patch)\/$/, '')
    if (!out.includes(root)) out.push(root)
  }
  return out
}

/** Fetches `<base>coverage.json` (a missing file is normal) and merges its public rows. Restricted rows in a hosted file are dropped by addRegions. */
export async function loadRemoteCoverage(base: string): Promise<number> {
  try {
    const res = await fetch(`${base.replace(/\/?$/, '/')}coverage.json`)
    if (!res.ok) return 0
    const { regions, rejected } = parseCoverage(await res.json())
    if (rejected.length) console.warn('coverage.json: rows rejected:', rejected.join(', '))
    return addRegions(regions)
  } catch { return 0 }
}

/**
 * Dev server only: the restricted rows, from `/moon/internal/coverage-internal.json`, which vite.config.ts serves from $MOON_INTERNAL_DIR (default ./.internal,
 * git-ignored, never the public bucket). A production build folds DEV_BUILD to false, so this function and its path are dead code there.
 */
export async function loadInternalCoverage(): Promise<number> {
  if (!DEV_BUILD || !INTERNAL) return 0
  try {
    const res = await fetch('/moon/internal/coverage-internal.json')
    if (!res.ok) return 0
    const { regions, rejected } = parseCoverage(await res.json())
    if (rejected.length) console.warn('coverage-internal.json: rows rejected:', rejected.join(', '))
    return addInternalRegions(regions, true)
  } catch { return 0 }
}

const inside = (r: CoverageRegion, lon: number, lat: number): boolean => {
  if (lat < r.lat0 || lat > r.lat1) return false
  if (r.lon0 <= -180 && r.lon1 >= 180) return true
  return wrapLon(lon) >= r.lon0 && wrapLon(lon) <= r.lon1
}

/** The regions covering a point, finest texel first. */
export function regionsAt(lon: number, lat: number, regions: CoverageRegion[] = REGIONS): CoverageRegion[] {
  return regions.filter((r) => inside(r, lon, lat)).sort((a, b) => effTexelM(a) - effTexelM(b))
}

/**
 * The finest texel (metres) at a point. `imagery` asks for photographs only (a height-only bridge does not make a picture sharper),
 * and is what the zoom limit uses; the debug map shows both.
 */
export function bestTexelM(lon: number, lat: number, opts: { imagery?: boolean; regions?: CoverageRegion[] } = {}): number {
  let best = Infinity
  for (const r of opts.regions ?? REGIONS) if ((!opts.imagery || r.imagery) && effTexelM(r) < best && inside(r, lon, lat)) best = effTexelM(r)
  return best
}

/** The region whose texel is finest at a point (imagery only), or null. */
export function finestRegionAt(lon: number, lat: number, regions: CoverageRegion[] = REGIONS): CoverageRegion | null {
  return regionsAt(lon, lat, regions).find((r) => r.imagery) ?? null
}

/**
 * The closest the camera may come over a point, Moon radii from the centre: one texel of the finest photograph per canvas pixel
 * (the same law as the global floor, camera/pose.ts floorDist) above the ground there. `groundM` is the height above the 1737.4 km
 * sphere. Closer would only magnify the data.
 */
export function zoomFloorAt(lon: number, lat: number, view: { shortPx: number; fovDeg: number; groundM?: number; regions?: CoverageRegion[] }): number {
  const t = bestTexelM(lon, lat, { imagery: true, regions: view.regions })
  if (!Number.isFinite(t)) return Infinity
  return 1 + (view.groundM ?? 0) / (MOON_R_KM * 1000) + siteAltR(t, Math.min(view.shortPx, FLOOR_MAX_PX), view.fovDeg)
}

/** Share 0 (coarsest) to 1 (finest) of a texel on the log scale between the global texel and 0.25 m: what the debug map colours by. */
export function detailShare(texelM: number): number {
  const lo = Math.log(0.25), hi = Math.log(400)
  return Math.max(0, Math.min(1, (hi - Math.log(Math.max(0.25, texelM))) / (hi - lo)))
}

/** Red (far, coarse) through yellow to green (fine), as 0..255 RGB. */
export function heatColor(share: number): [number, number, number] {
  const s = Math.max(0, Math.min(1, share))
  return s < 0.5 ? [220, Math.round(60 + 320 * s), 40] : [Math.round(220 - 360 * (s - 0.5)), 200, 60]
}

/** A point that sits at the middle of the finest imagery region of a site (for "fly to the green"), or null. */
export function regionCenter(r: CoverageRegion): { lon: number; lat: number } {
  return { lon: (r.lon0 + r.lon1) / 2, lat: (r.lat0 + r.lat1) / 2 }
}

/** Angular distance, radians, from a point to the nearest point of a region's box (0 inside; longitude wraps). */
export function boxDistanceRad(r: CoverageRegion, lon: number, lat: number): number {
  const la = Math.max(r.lat0, Math.min(r.lat1, lat))
  const d = wrapLon(lon - (r.lon0 + r.lon1) / 2), half = (r.lon1 - r.lon0) / 2
  const lo = Math.abs(d) <= half ? lon : d > 0 ? r.lon1 : r.lon0
  return angularDistance(lon, lat, lo, la)
}

/**
 * Altitude above the ground the camera may have over a point, radii: the lowest of one-texel-per-pixel altitudes of the photographs of
 * `siteId`, each widened as a cone from its box (SITE_CONE metres up per metre outside). Inside the finest box that is the finest
 * texel's altitude; past the box's edge it rises, so the camera never sits at 0.5 m per pixel over 8 m or 399 m data. `skip` names the
 * regions whose tiles failed to load (their pictures are not there). Infinity when no picture of the site remains.
 */
export function coverageAlt(siteId: string, lon: number, lat: number, view: { shortPx: number; fovDeg: number; skip?: ReadonlySet<string>; regions?: CoverageRegion[] }): number {
  let best = Infinity
  for (const r of view.regions ?? REGIONS) {
    if (r.site !== siteId || !r.imagery || view.skip?.has(r.id)) continue
    const alt = siteAltR(effTexelM(r), view.shortPx, view.fovDeg) + SITE_CONE * boxDistanceRad(r, lon, lat)
    if (alt < best) best = alt
  }
  return best
}

/** Distances (radians) at which `deeperFloorAt` looks for finer height data around a point: a sqrt(2) ladder from 20 urad (35 m) to 0.35 rad. */
const NEAR_LADDER: number[] = (() => { const l: number[] = []; for (let d = 2e-5; d < 0.35; d *= Math.SQRT2) l.push(d); return l })()
const NEAR_DIRS = 8

/**
 * The floor the height data under ONE point allows, with no search around it: `1 + altitude` of its own texel, Infinity where only the built
 * tiles are. It is the point value `deeperFloorAt` starts from; the zoom dolly builds its own continuous cone from many of these along its
 * path (camera/dolly.ts coneFloor), because the ladder search of `deeperFloorAt` is sampled and so steps where it is not exact.
 */
export function pointFloorAt(lon: number, lat: number, view: { shortPx: number; fovDeg: number; texelKmAt: (lon: number, lat: number) => number; globalTexelKm: number }): number {
  const own = view.texelKmAt(lon, lat)
  return own < view.globalTexelKm ? 1 + siteAltR(own * 1000, view.shortPx, view.fovDeg) : Infinity
}

/** Bisection steps that place an edge of finer data between two rungs of the ladder: the gap shrinks to 2^-24 of a rung (under a metre at the widest). */
const EDGE_STEPS = 24
/** How many of the edges found walk to the nearest point of their data, and the most steps each walk takes (halving its stride when stuck). */
const REFINE_EDGES = 2
const REFINE_STEPS = 80

/**
 * The closest the camera may come over (lon, lat) given the finest HEIGHT data the tile set really holds (TileStreamer.heightTexelKmAt,
 * which answers from the manifest's presence map): one texel per canvas pixel above the ground, as in `zoomFloorAt`, and a cone
 * (SITE_CONE metres up per metre) around any block of deeper tiles, so the floor rises smoothly past the block's edge and never steps.
 * `texelKmAt` returns the height texel under a point, `globalTexelKm` is the built texel; Infinity when nothing finer than the built
 * tiles lies within reach (the caller's global floor then rules). Heights only: colour stays the global map's.
 *
 * The search walks a sqrt(2) ladder of distances in NEAR_DIRS directions. Where a rung first finds finer data along a direction, the edge
 * of that data is bisected between that rung and the one before it (EDGE_STEPS), and the cone starts from the edge, not from the rung:
 * a cone from the rung itself is constant while the rung keeps hitting and then jumps by a third of the distance when the next rung in
 * takes over: a staircase of floor steps (16 km at 50 km up past a Terrain Camera block in scripts/deeper-floor.test.mts) that lifts a
 * camera riding the floor with a jump (owner item 7, "the view shifts unexpectedly" on a low flight). From the edge, and with the best
 * edges walked to the block's nearest point, the floor is the cone from that point: continuous (SITE_CONE-Lipschitz) as the camera moves.
 */
export function deeperFloorAt(lon: number, lat: number, view: { shortPx: number; fovDeg: number; texelKmAt: (lon: number, lat: number) => number; globalTexelKm: number; /** false: the old ladder (cone from the rung, `?flooredge=0`, the rig's legacy arm). */ edge?: boolean }): number {
  const alt = (texelKm: number): number => siteAltR(texelKm * 1000, view.shortPx, view.fovDeg)
  const own = view.texelKmAt(lon, lat)
  let best = own < view.globalTexelKm ? alt(own) : Infinity
  const cosLat = Math.max(0.05, Math.cos(lat * Math.PI / 180))
  const edge = view.edge !== false
  // One sample point at a time, in plain numbers (this runs for every floor query; no object per sample).
  let qLon = 0, qLat = 0
  const at = (d: number, a: number): boolean => {
    qLat = lat + (d * Math.cos(a)) * 180 / Math.PI
    if (qLat < -90 || qLat > 90) return false
    qLon = wrapLon(lon + (d * Math.sin(a) / cosLat) * 180 / Math.PI)
    return true
  }
  // The texel the previous rung saw along each direction (the point's own at the start), and that rung's distance.
  const prevT = new Array<number>(NEAR_DIRS).fill(own)
  let prevD = 0
  const found: Array<{ c: number; t: number; lon: number; lat: number; gap: number }> = []
  for (const d of NEAR_LADDER) {
    // A sample past the previous rung cannot beat `best` even at the finest texel on record (the cone alone is above it).
    if (SITE_CONE * (edge ? prevD : d) >= best) break
    for (let k = 0; k < NEAR_DIRS; k++) {
      const a = (k / NEAR_DIRS) * 2 * Math.PI
      if (!at(d, a)) continue
      const t = view.texelKmAt(qLon, qLat)
      const before = prevT[k]
      prevT[k] = t
      if (!edge) {
        if (t < view.globalTexelKm) best = Math.min(best, alt(t) + SITE_CONE * angularDistance(lon, lat, qLon, qLat))
        continue
      }
      // Nothing finer here, or nothing finer than the rung before already saw along this direction (that one's cone is lower).
      if (t >= view.globalTexelKm || t >= before) continue
      // The edge of data at least this fine lies between the two rungs: lo is coarser, hi is this fine or finer.
      let lo = prevD, hi = d, hLon = qLon, hLat = qLat
      for (let i = 0; i < EDGE_STEPS; i++) {
        const mid = 0.5 * (lo + hi)
        if (!at(mid, a)) break
        if (view.texelKmAt(qLon, qLat) <= t) { hi = mid; hLon = qLon; hLat = qLat } else lo = mid
      }
      const c = alt(t) + SITE_CONE * angularDistance(lon, lat, hLon, hLat)
      found.push({ c, t, lon: hLon, lat: hLat, gap: d - prevD })
      if (c < best) best = c
    }
    prevD = d
  }
  // Along a fixed direction the edge is exact, but the nearest point of a block need not lie on one of the directions (a corner passing
  // by): the switch from one direction to the next would still step. So the best few edges walk along the data (a pattern search that
  // stays on data at least as fine) to the point nearest the camera's ground point, where the cone is the exact one.
  found.sort((x, y) => x.c - y.c)
  for (let j = 0; j < Math.min(REFINE_EDGES, found.length); j++) {
    const f = found[j]
    let cLon = f.lon, cLat = f.lat, dist = angularDistance(lon, lat, cLon, cLat)
    let r = f.gap
    for (let i = 0; i < REFINE_STEPS && r > 1e-9; i++) {
      let moved = false, nLon = 0, nLat = 0, nd = dist
      const cl = Math.max(0.05, Math.cos(cLat * Math.PI / 180))
      for (let k = 0; k < NEAR_DIRS; k++) {
        const a = (k / NEAR_DIRS) * 2 * Math.PI
        const mLat = cLat + (r * Math.cos(a)) * 180 / Math.PI
        if (mLat < -90 || mLat > 90) continue
        const mLon = wrapLon(cLon + (r * Math.sin(a) / cl) * 180 / Math.PI)
        const md = angularDistance(lon, lat, mLon, mLat)
        if (md < nd && view.texelKmAt(mLon, mLat) <= f.t) { moved = true; nLon = mLon; nLat = mLat; nd = md }
      }
      if (moved) { cLon = nLon; cLat = nLat; dist = nd } else r *= 0.5
    }
    const c = alt(f.t) + SITE_CONE * dist
    if (c < best) best = c
  }
  return best === Infinity ? Infinity : 1 + best
}
