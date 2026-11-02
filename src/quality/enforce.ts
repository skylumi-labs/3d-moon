/**
 * Memory ceiling enforcement (roadmap R54, W3-M1), as pure decisions; main.ts executes them.
 *
 * Three parts, all deterministic:
 *  1. Budget arithmetic: what the ledger holds at the Apollo 17 pose per class (`a17Estimate`, ESTIMATES built from the ledger's own byte helpers
 *     and the allocation sizes in src/), and the patch cap that keeps the sum under the class ceiling (`patchCapFor`). The cap is a row of
 *     CLASS_TABLE (`patchResidentBytes`); scripts/memory-enforce.test.mts pins the row to this arithmetic.
 *  2. Overrun detection: the ledger above the ceiling for `OVERRUN_HOLD_MS` (a spike while a target set is swapped is not an overrun).
 *  3. Shed order: what is released first when it stays over. Nothing that is on screen goes while something off screen can: the landing-site
 *     patch (only when the camera is outside its coverage), then the colour/height tile cache, rebuilt smaller to the room that is left. The tile
 *     rebuild shows the 4k maps until tiles stream back, so it is last.
 * `?memcap=0` turns parts 1 and 3 and the Earth map size off (the class rows return to their values before R54).
 */
import { crossfadeBytes, targetSetBytes, textureBytes } from './ledger'

const MB = 1048576

/** The default resident cap of PatchLayer when a class gives none. */
export const PATCH_DEFAULT_BYTES = 192 * MB
/** A patch under this cannot hold even its coarse level (PatchLayer refuses a budget edge under 32 px); below it the patch is not worth loading. */
export const PATCH_MIN_BYTES = 32 * MB
/** Headroom left under the ceiling for what the ledger does not count (driver padding, scratch) and the estimates' error. */
export const SAFETY_BYTES = 16 * MB

/** The Earth maps at 2048x1024: albedo RGBA8 + three R8 maps, mips (EarthPass), plus the transmittance LUTs (~1 MB). */
export const earthBytes = (width: number): number => {
  const h = width / 2
  return textureBytes(width, h, 4, { mips: true }) + 3 * textureBytes(width, h, 1, { mips: true }) + MB
}

export interface A17Inputs {
  /** Drawing buffer in px at the typical phone/tablet canvas (CSS size x dprCap). */
  canvasW: number
  canvasH: number
  targetSets: number
  tiles: number
  tc: boolean
  lmShadowRes: number
  earthWidth: number
}

/** Typical canvas CSS sizes per class (iPhone 15 portrait, iPad portrait, Pixel portrait, a tablet, a desktop window). */
export const CANVAS_CSS: Record<string, [number, number]> = {
  ios: [393, 852], ipad: [820, 1180], 'phone-android': [412, 915], tablet: [800, 1280], software: [1512, 945], desktop: [1512, 945],
}

/** Per-tile pair bytes (heights R16F 322 px + colour 382 px with mips), as TILE_PAIR_BYTES in main.ts. */
export const TILE_PAIR = 1.05 * MB

/**
 * The ledger at the A17 pose WITHOUT the patch, bytes, by line. Estimates: the global maps (colour 4096x2048 with mips, 44.7 MB; the height map
 * about 11 MB), the horizon array (about 24 MB) and the lander shadow target plus Sun map (`lm`) are rounded from the ledger readouts in
 * targets, crossfade, tiles and the Earth are computed. The rig's
 * `moon-ledger.mjs --poses a17` replaces every number here with a measured one.
 */
export function a17Estimate(i: A17Inputs): Record<'maps' | 'baked' | 'targets' | 'crossfade' | 'tiles' | 'tc' | 'lm' | 'earth', number> {
  const w = i.canvasW, h = i.canvasH
  return {
    maps: textureBytes(4096, 2048, 4, { mips: true }) + 11 * MB,
    baked: 24 * MB,
    // One set live at a time plus the previous one kept for the swap (targets.ts keeps `targetSets` sizes; the ground set has depth).
    targets: Math.round(targetSetBytes(w, h, { depth: true }) * Math.min(i.targetSets, 2)),
    crossfade: crossfadeBytes(w, h),
    tiles: Math.round(i.tiles * TILE_PAIR),
    tc: i.tc ? Math.round(35.5 * MB) : 0,
    // Lander shadow target (depth 32-bit + Sun map, 4 + 4 B per texel) at the class resolution.
    lm: i.lmShadowRes * i.lmShadowRes * 8,
    earth: earthBytes(i.earthWidth),
  }
}

export const sum = (o: Record<string, number>): number => Object.values(o).reduce((a, b) => a + b, 0)

/**
 * The patch cap for a ceiling and a non-patch estimate: what is left minus the safety margin, rounded DOWN to 8 MB, between PATCH_MIN_BYTES
 * and the layer default. Infinity ceiling: the default (undefined in the table).
 */
export function patchCapFor(ceiling: number, nonPatchBytes: number): number {
  if (!Number.isFinite(ceiling)) return PATCH_DEFAULT_BYTES
  const room = ceiling - nonPatchBytes - SAFETY_BYTES
  const cap = Math.floor(Math.max(0, room) / (8 * MB)) * 8 * MB
  return Math.max(PATCH_MIN_BYTES, Math.min(PATCH_DEFAULT_BYTES, cap))
}

// ---- overrun detection

/** The ledger must stay above the ceiling this long before a shed starts (a target swap holds two sets for a moment). */
export const OVERRUN_HOLD_MS = 2000
/** After a shed starts, the next one waits this long (the release itself needs a calm frame and a re-stream). */
export const OVERRUN_COOLDOWN_MS = 15_000

export interface OverrunWatch { since: number | null; lastFireAt: number }
export const newOverrunWatch = (): OverrunWatch => ({ since: null, lastFireAt: -Infinity })

/** One poll. Returns true exactly when a shed should be armed. Pure on its inputs apart from the watch it is handed. */
export function overrunPoll(w: OverrunWatch, now: number, total: number, ceiling: number): boolean {
  if (!Number.isFinite(ceiling) || total <= ceiling) { w.since = null; return false }
  if (w.since === null) w.since = now
  if (now - w.since < OVERRUN_HOLD_MS || now - w.lastFireAt < OVERRUN_COOLDOWN_MS) return false
  w.lastFireAt = now
  w.since = null
  return true
}

// ---- shed order

export interface ShedState {
  total: number
  ceiling: number
  /** Patch bytes in the ledger and whether a patch is loaded and may be dropped now. */
  patchBytes: number
  patchReady: boolean
  /** The camera is outside the patch's coverage and not in ground mode: the patch is not on screen. */
  awayFromPatch: boolean
  /** Tile cache: bytes the ledger holds for it, layers now, the least it may have, bytes per layer. */
  tilesReady: boolean
  tilesBytes: number
  tileLayers: number
  minLayers: number
  pairBytes: number
  /** A gesture, flight, ground mode, capture, load or lost context: nothing is released now. */
  busy: boolean
}

export interface ShedPlan {
  /** Steps in the order they run. */
  steps: Array<'patch' | 'tiles'>
  /** Layers the tile cache is rebuilt with, when 'tiles' is a step. */
  tileLayers: number | null
  /** What the ledger would hold after the steps, bytes. */
  projected: number
  /** The plan reaches the ceiling. */
  fits: boolean
}

/** Layers a rebuild can keep so that the total (the rest of the ledger unchanged) is at most the ceiling; never below `minLayers`. */
export function layersToFit(total: number, tilesBytes: number, ceiling: number, pairBytes: number, minLayers: number): number {
  const room = ceiling - (total - tilesBytes)
  return Math.max(minLayers, Math.floor(Math.max(0, room) / pairBytes))
}

/**
 * The steps that bring the ledger under the ceiling, least visible first, and nothing more than needed: a patch that is off screen goes before
 * any tile does, and the tiles are rebuilt only to the room that is left. A busy view returns no steps (the caller keeps the overrun pending).
 */
export function shedPlan(s: ShedState): ShedPlan {
  const none: ShedPlan = { steps: [], tileLayers: null, projected: s.total, fits: s.total <= s.ceiling }
  if (none.fits || s.busy) return none
  const steps: ShedPlan['steps'] = []
  let total = s.total
  if (s.patchReady && s.awayFromPatch && s.patchBytes > 0) { steps.push('patch'); total -= s.patchBytes }
  let tileLayers: number | null = null
  if (total > s.ceiling && s.tilesReady) {
    const n = layersToFit(total, s.tilesBytes, s.ceiling, s.pairBytes, s.minLayers)
    if (n < s.tileLayers) { steps.push('tiles'); tileLayers = n; total -= s.tilesBytes - n * s.pairBytes }
  }
  return { steps, tileLayers, projected: total, fits: total <= s.ceiling }
}
