/**
 * `?shadowdebug=serve` (dev builds, rig only): colour every Moon pixel by what served its Sun horizon, so a fixed-versus-legacy difference can be
 * assigned to a path. The shader sets `gServe` in horizonSun (moonShader.ts); this module is the one table the shader colours, the CPU classifier
 * and the rig job share. The view draws through the ?dbg= route (FinalPass converts the value straight to sRGB), so the palette is exact.
 */
export const SERVE_DBG_VALUE = 20
/** The view-visibility variant of the same debug route (`__moon.visSummary()`): uDbg value and its palette. */
export const VIS_DBG_VALUE = 21
export const VIS_CATEGORIES: readonly ServeCategory[] = [
  { code: 0, key: 'visNotNeeded', label: 'no viewer march (elevation >= 38, ray-resolved terrain, motion frame)', rgb: [0.25, 0.25, 0.25] },
  { code: 1, key: 'visSkipped', label: 'viewer march skipped: the viewer clears the horizon envelope', rgb: [0, 1, 0] },
  { code: 2, key: 'visMarched', label: 'viewer march run (an envelope gave a bound but the viewer does not clear it)', rgb: [1, 0, 0] },
  { code: 3, key: 'visGated', label: 'viewer march run, tile share > 0, and the tile envelope gave no bound here', rgb: [1, 0.5, 0] },
  { code: 4, key: 'visNoEnv', label: 'viewer march run, tile share 0, and the envelope gave no bound here', rgb: [0.6, 0, 0.6] },
]
/** The tile-share debug view (uDbg 22, `__moon.tileShareSummary()`): colours by gTileMarch, so the pixels of the liveGate class can be told apart by how much tile they carry. */
export const W_DBG_VALUE = 22
export const W_CATEGORIES: readonly ServeCategory[] = [
  { code: 0, key: 'w0', label: 'gTileMarch = 0: the 4k map only (the only pixels the envelope serves)', rgb: [0, 0.8, 0.8] },
  { code: 1, key: 'w0to25', label: '0 < gTileMarch <= 0.25', rgb: [0.8, 0.8, 0] },
  { code: 2, key: 'w25to50', label: '0.25 < gTileMarch <= 0.5', rgb: [1, 0.5, 0] },
  { code: 3, key: 'w50to75', label: '0.5 < gTileMarch <= 0.75', rgb: [1, 0, 0.5] },
  { code: 4, key: 'w75to999', label: '0.75 < gTileMarch < 0.999', rgb: [0.5, 0, 1] },
  { code: 5, key: 'w1', label: 'gTileMarch >= 0.999: the tile march (the Sun-keyed tile cache serves it)', rgb: [0.25, 0.25, 0.25] },
]
/**
 * The bound-check view (uDbg 23, `__moon.boundSummary()`, dev builds): per Moon pixel the legacy live horizon toward the Sun (horizonAt, the very march the unmodified shader runs) against the envelope bound
 * the fixed policy would use (horizonBound with the Sun's azimuth sector). A bound must never be below the live horizon; the skip fires when the Sun clears the bound by the certificate.
 */
export const BOUND_DBG_VALUE = 23
/** The same check for the VIEWER-visibility skip (`__moon.viewBoundSummary()`): the live horizon toward the viewer against the bound the viewer skip reads. */
export const VIEW_BOUND_DBG_VALUE = 24
export const BOUND_CATEGORIES: readonly ServeCategory[] = [
  { code: 0, key: 'bNotRead', label: 'no horizon read here (night, or the Sun above 38 deg / the viewer test not run)', rgb: [0.25, 0.25, 0.25] },
  { code: 1, key: 'bNoBound', label: 'no bound here (off, unbuilt, unbounded, lod > 6.5, tile not faded): the live march runs', rgb: [0.6, 0, 0.6] },
  { code: 2, key: 'bOk', label: 'bound >= the live horizon', rgb: [0, 0.8, 0] },
  { code: 3, key: 'bExcessHalf', label: 'live horizon above the bound by up to half the skip tolerance, and the skip fires: the picture does not change', rgb: [1, 1, 0] },
  { code: 4, key: 'bExcessTol', label: 'live horizon above the bound by half the skip tolerance up to all of it, and the skip fires: the picture still does not change', rgb: [1, 0.5, 0] },
  { code: 5, key: 'bExcessHarm', label: '4k-map pixel (no tile share): live horizon above the bound by MORE than the skip tolerance and the skip fires: the picture can change (there must be none)', rgb: [1, 0, 0] },
  { code: 6, key: 'bExcessNoSkip', label: 'live horizon above the bound but the skip does not fire: the live march runs, harmless', rgb: [0, 0.6, 1] },
  { code: 7, key: 'bHarmTile1', label: 'tile pixel (gTileMarch > 0): live horizon above the bound by more than the skip tolerance, by up to 1 deg over it', rgb: [1, 0.35, 0.35] },
  { code: 8, key: 'bHarmTile3', label: 'tile pixel: over the tolerance by 1..3 deg', rgb: [0.7, 0, 0] },
  { code: 9, key: 'bHarmTile6', label: 'tile pixel: over the tolerance by 3..6 deg', rgb: [0.45, 0, 0] },
  { code: 10, key: 'bHarmTileBig', label: 'tile pixel: over the tolerance by more than 6 deg', rgb: [0.25, 0, 0.05] },
]
export const BOUND_DEBUG_GLSL = /* glsl */ `
vec3 boundDebugColour(float g) {
${BOUND_CATEGORIES.map((c) => `  if (g < ${(c.code + 0.5).toFixed(1)}) return vec3(${c.rgb.map((v) => v.toFixed(3)).join(', ')});`).join('\n')}
  return vec3(1.0);
}
`
export const W_DEBUG_GLSL = /* glsl */ `
vec3 wDebugColour(float w) {
  if (w <= 0.0) return vec3(${W_CATEGORIES[0].rgb.map((v) => v.toFixed(3)).join(', ')});
  if (w <= 0.25) return vec3(${W_CATEGORIES[1].rgb.map((v) => v.toFixed(3)).join(', ')});
  if (w <= 0.5) return vec3(${W_CATEGORIES[2].rgb.map((v) => v.toFixed(3)).join(', ')});
  if (w <= 0.75) return vec3(${W_CATEGORIES[3].rgb.map((v) => v.toFixed(3)).join(', ')});
  if (w < 0.999) return vec3(${W_CATEGORIES[4].rgb.map((v) => v.toFixed(3)).join(', ')});
  return vec3(${W_CATEGORIES[5].rgb.map((v) => v.toFixed(3)).join(', ')});
}
`

export interface ServeCategory {
  /** The shader's gServe value. */
  readonly code: number
  readonly key: string
  readonly label: string
  /** Display colour, 0..1 per channel (written to the shader). */
  readonly rgb: readonly [number, number, number]
}

export const SERVE_CATEGORIES: ServeCategory[] = [
  { code: 0, key: 'analytic', label: 'no horizon read (fully lit, night, or no shadow needed)', rgb: [0.25, 0.25, 0.25] },
  { code: 1, key: 'exact', label: 'exact cached tile at the sampled LOD', rgb: [0, 1, 0] },
  { code: 2, key: 'parent1', label: 'parent tile, one level coarser', rgb: [0, 1, 1] },
  { code: 3, key: 'parent2', label: 'parent tile, two levels coarser', rgb: [0, 0, 1] },
  { code: 4, key: 'parent3', label: 'parent tile, three or more levels coarser', rgb: [1, 0, 1] },
  { code: 5, key: 'liveGate', label: 'live march: tile march not fully on here, or cache read off (as legacy)', rgb: [1, 0, 0] },
  { code: 6, key: 'liveMiss', label: 'live march: tile march on, no cache tile at any level', rgb: [1, 1, 0] },
  { code: 7, key: 'patch', label: 'patch or mid-patch cache', rgb: [1, 0.5, 0] },
  { code: 8, key: 'live', label: 'live march', rgb: [1, 1, 1] },
  { code: 11, key: 'envNone', label: 'live march, tile share 0, and the envelope gave no bound here (off, unbuilt, unbounded or lod > 6.5)', rgb: [0.55, 0.2, 0] },
  { code: 12, key: 'tileEnvNone', label: 'live march, tile share > 0, and the tile envelope (or, between, the 4k one) gave no bound here (off, tile not built or fading, cell unbuilt or unbounded)', rgb: [0.4, 0.1, 0.6] },
  { code: 13, key: 'tileEnvGated', label: 'live march, tile share > 0: the envelopes gave a bound but the Sun does not clear it by the certificate', rgb: [0.9, 0.2, 0.2] },
  { code: 14, key: 'tileEnvelopeLit', label: 'tile horizon envelope: the Sun clears the tile march\'s highest horizon (and, between, the 4k one), fully lit, no march', rgb: [0.2, 0.8, 0.5] },
  { code: 15, key: 'bakeLit', label: 'Sun-keyed 4k bake: the Sun clears the cell\'s highest horizon toward it (certificate), fully lit, no march', rgb: [0.55, 0.9, 0.2] },
  { code: 16, key: 'bakeDark', label: 'Sun-keyed 4k bake: the cell\'s lowest horizon toward the Sun clears the Sun (certificate), fully shadowed, no march', rgb: [0.1, 0.2, 0.9] },
  { code: 9, key: 'envelopeLit', label: 'horizon envelope: the Sun clears the 4k map\'s highest horizon, fully lit, no march', rgb: [0, 0.55, 0.25] },
]

SERVE_CATEGORIES.sort((a, b) => a.code - b.code)
export type ServeCounts = Record<string, number> & { offMoon: number; total: number }

const toSrgb8 = (c: number): number => Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255)
const PALETTE8 = SERVE_CATEGORIES.map((c) => c.rgb.map(toSrgb8))

/** GLSL for the debug colour of a gServe value. */
export const SERVE_DEBUG_GLSL = /* glsl */ `
vec3 serveDebugColour(float g) {
${SERVE_CATEGORIES.map((c) => `  if (g < ${(c.code + 0.5).toFixed(1)}) return vec3(${c.rgb.map((v) => v.toFixed(3)).join(', ')});`).join('\n')}
  return vec3(1.0);
}
`

/** GLSL for the debug colour of a gVis value. */
export const VIS_DEBUG_GLSL = /* glsl */ `
vec3 visDebugColour(float g) {
${VIS_CATEGORIES.map((c) => `  if (g < ${(c.code + 0.5).toFixed(1)}) return vec3(${c.rgb.map((v) => v.toFixed(3)).join(', ')});`).join('\n')}
  return vec3(1.0);
}
`
const VIS_PALETTE8 = VIS_CATEGORIES.map((c) => c.rgb.map(toSrgb8))
const W_PALETTE8 = W_CATEGORIES.map((c) => c.rgb.map(toSrgb8))
const B_PALETTE8 = BOUND_CATEGORIES.map((c) => c.rgb.map(toSrgb8))

/** Index into SERVE_CATEGORIES (or VIS_CATEGORIES with `vis`) of the palette colour nearest an sRGB byte triple, or -1 when it is nearer black (not Moon, or another pass). */
export function classifyServePixel(r: number, g: number, b: number, vis: boolean | 'w' | 'b' = false): number {
  let best = -1
  let bestD = Math.min(r * r + g * g + b * b, 40 * 40 * 3) // distance to black: an off-Moon pixel
  const pal = vis === 'b' ? B_PALETTE8 : vis === 'w' ? W_PALETTE8 : vis ? VIS_PALETTE8 : PALETTE8
  for (let i = 0; i < pal.length; i++) {
    const p = pal[i]
    const d = (r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

/** Counts per category from an RGBA8 buffer (every `stride`th pixel). */
export function summariseServe(rgba: ArrayLike<number>, stride = 1, vis: boolean | 'w' | 'b' = false): ServeCounts {
  const out: Record<string, number> = { offMoon: 0, total: 0 }
  const cats = vis === 'b' ? BOUND_CATEGORIES : vis === 'w' ? W_CATEGORIES : vis ? VIS_CATEGORIES : SERVE_CATEGORIES
  for (const c of cats) out[c.key] = 0
  for (let i = 0; i + 3 < rgba.length; i += 4 * stride) {
    const k = classifyServePixel(rgba[i], rgba[i + 1], rgba[i + 2], vis)
    out.total++
    if (k < 0) out.offMoon++
    else out[cats[k].key]++
  }
  return out as ServeCounts
}

/** The `?shadowdebug=` value in a query string ('serve' or null). */
export function parseShadowDebug(search: string): 'serve' | null {
  return new URLSearchParams(search).get('shadowdebug') === 'serve' ? 'serve' : null
}

/** Of the pixels that read a Sun horizon at all (analytic and off-Moon excluded): the share served by an exact cached tile and the share marched live. */
export function serveShares(c: Readonly<Record<string, number>>): { read: number; exactShare: number | null; marchedShare: number | null } {
  const marched = (c.liveGate ?? 0) + (c.liveMiss ?? 0) + (c.live ?? 0) + (c.envNone ?? 0) + (c.tileEnvNone ?? 0) + (c.tileEnvGated ?? 0)
  const exact = (c.exact ?? 0) + (c.envelopeLit ?? 0) + (c.bakeLit ?? 0) + (c.bakeDark ?? 0) + (c.tileEnvelopeLit ?? 0) + (c.parent1 ?? 0) + (c.parent2 ?? 0) + (c.parent3 ?? 0) + (c.patch ?? 0)
  const read = marched + exact
  return { read, exactShare: read > 0 ? exact / read : null, marchedShare: read > 0 ? marched / read : null }
}

/** Whether the shader should carry the serving-mask code: a dev build whose URL asks for ?shadowdebug=serve. Read at shader-build time, so the shipped source is byte-identical otherwise. */
export function serveDebugOn(): boolean {
  if (import.meta.env?.VITE_NATIVE_BUILD === 'true') return false
  const loc = (globalThis as { location?: { search?: string } })
  return parseShadowDebug(loc.location?.search ?? '') === 'serve'
}

/** `?shadowdebug=count` (dev builds, rig only; use with `&dbg=25`): the shader counts the tile / 4k horizon marches each pixel RAN, over all sub-pixel taps (moonShader.ts gMc). Read at shader-build time. */
export function countDebugOn(): boolean {
  if (import.meta.env?.VITE_NATIVE_BUILD === 'true') return false
  const loc = (globalThis as { location?: { search?: string } })
  return new URLSearchParams(loc.location?.search ?? '').get('shadowdebug') === 'count'
}

/**
 * Decode the count view (uDbg 25): R = tile marches of the Sun reads, G = 4k marches of the Sun reads (0..4 each, quarter steps of linear light),
 * B = (tile viewer march + 2 x 4k viewer march) (0..3). Returns per-pixel sums and histograms over the Moon pixels (any channel above the black threshold counts a pixel as on the Moon only if the Moon mask says so; off-Moon pixels are black = zero counts, so they add nothing).
 */
export function summariseCount(rgba: ArrayLike<number>): { pixels: number; tileSun: number; fourKSun: number; tileView: number; fourKView: number; tileSunHist: number[]; fourKSunHist: number[]; anyMarchPx: number } {
  const out = { pixels: 0, tileSun: 0, fourKSun: 0, tileView: 0, fourKView: 0, tileSunHist: [0, 0, 0, 0, 0], fourKSunHist: [0, 0, 0, 0, 0], anyMarchPx: 0 }
  const q = (v: number, scale: number): number => Math.min(scale, Math.round(v / 63.75))
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    out.pixels++
    const t = q(rgba[i], 4), k = q(rgba[i + 1], 4), v = q(rgba[i + 2], 3)
    out.tileSun += t; out.fourKSun += k
    out.tileView += v & 1; out.fourKView += v >> 1
    out.tileSunHist[t]++; out.fourKSunHist[k]++
    if (t + k + v > 0) out.anyMarchPx++
  }
  return out
}
