import { C_TEXEL_KM, H_TEXEL_KM } from './grid'

/**
 * Focus pull, part A (off by default since 2026-11-01, `?focuspull=1` turns it on; it was on by default from 2026-10-31): the colour of a pixel drawn from a tile level coarser than the one its footprint wants is defocused by
 * the detail it lacks, and when the finer tile lands that defocus ramps to 0 over FOCUS_PULL_MS. It replaces the 250 ms opacity fade of the built colour
 * levels (TileStreamer FADE_MS) and nothing else: heights, slopes, lighting and shadows are the same code with the same weights.
 *
 * - A tile of level 0..2 that is WANTED and not resident is marked "pending" in the page table (green channel 2, red 0). The shader (moonShader.ts
 *   FOCUS_COLOR) then knows the finer level is on its way. A tile nobody asked for, the server does not have or the cache cannot hold is never marked, so
 *   it never defocuses anything: with every wanted tile resident the image is the switch-off image (the lack below is exactly 0).
 * - The lack of a pixel is the difference between the texel size, in pixels, of the colour the pixel shows now and of the colour it will show once every
 *   pending or resident level is fully in: both chains are the shader's own (the 4k map, then levels 2, 1, 0 mixed by ramp x gate), the first with each
 *   resident level weighted by pull(fade). The defocus is a disc of radius BLUR_PER_LACK x lack pixels (a gaussian of sigma SIGMA_PER_LACK x lack, the
 *   prototype's 0.7 x missing texel px).
 * - This file holds the CPU twin of that arithmetic (the indicator's "how much of the frame is still coarse, and by how much" reads it) and the switch.
 */
export const FOCUS_PULL_MS = 350
/** The page table's green value of a wanted, not yet resident tile (a resident tile's is its fade, 0..1). */
export const PENDING_MARK = 2
/**
 * A pending mark that is let go (the tile left the wanted set, backed off after a failure, or a resident tile finished leaving) does not vanish: its strength,
 * the green value minus 1 (1 at PENDING_MARK, 0 at 1), falls over FOCUS_PULL_MS on the arrival's own curve (release), so the blur it caused ramps out the way
 * an arrival's ramps in instead of ending on one frame.
 */
export const RELEASE_FLOOR = 1
/** The strength of a released mark `ms` after it was let go: (1 - u)^3, i.e. 1 - pull(u), the arrival's ramp. 0 from FOCUS_PULL_MS on. */
export function release(ms: number): number { return 1 - pull(ms / FOCUS_PULL_MS) }
/** The green value of a released mark of strength `p` (0..1), and back. */
export const releaseMark = (p: number): number => RELEASE_FLOOR + Math.max(0, Math.min(1, p))
export const markStrength = (g: number): number => Math.max(0, Math.min(1, g - RELEASE_FLOOR))
/** Disc radius, pixels, per pixel of lack; the equal-variance gaussian is sigma = SIGMA_PER_LACK x lack. */
export const BLUR_PER_LACK = 1.4
export const SIGMA_PER_LACK = 0.7
/** Below this lack (pixels) the shader draws the plain colour; above it the blur radius is capped at MAX_BLUR_PX. */
export const MIN_LACK_PX = 0.1
export const MAX_BLUR_PX = 48
export const FOCUS_TAPS = 12
/** The lack a ray must show to count as "still coarse" for the indicator: a blur of about a third of a pixel is below what the eye sees. */
export const COARSE_LACK_PX = 0.35

/**
 * Off by default (owner 2026-11-01, before the public launch: no lens effect while loading); `?focuspull=1` turns it on, `?focuspull=0` off.
 * It was on by default from 2026-10-31 (phone walkthrough); films and stills (`?still=1`) were always kept off unless `?focuspull=1`.
 */
export function focusPullOf(search: string): boolean {
  return new URLSearchParams(search).get('focuspull') === '1'
}
/** The page's query string (the Artifact preview carries it in window.__moonQuery). */
export const focusSearch = (): string => (typeof location === 'undefined' ? '' : location.search || (globalThis as { __moonQuery?: string }).__moonQuery || '')
let on = focusPullOf(focusSearch())
export function setFocusPull(search: string): void { on = focusPullOf(search) }
export function focusPullOn(): boolean { return on }

/** The tile fade length the streamer uses: the focus pull's ramp under the switch, else the opacity fade. */
export function tileFadeMs(opacityFadeMs: number): number { return on ? FOCUS_PULL_MS : opacityFadeMs }

/** Blur left of a tile whose fade stands at `a` (0..1): cubic ease-out, 1 at arrival, 0 when fully in (the prototype's 1 - (1 - u)^3 pull). */
export function pull(a: number): number {
  const u = Math.max(0, Math.min(1, a))
  const r = 1 - u
  return 1 - r * r * r
}

const smooth = (e0: number, e1: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }

/** The shader's tile weight without the fade: ramp x gate (moonShader.ts tileWeight with a = 1). */
export function levelWeight(level: number, fpKm: number, baseTexelKm: number): number {
  const ramp = 1 - smooth(1, 2, fpKm / (H_TEXEL_KM * 2 ** level))
  const gate = 1 - smooth(0.5, 0.9, fpKm / baseTexelKm)
  return ramp * gate
}

/**
 * One colour level under a pixel: `resident` has a layer, `pending` is wanted and on its way, `fade` the page table's 0..1. `hold` (0..1, default 1) is the
 * strength of a pending mark: below 1 while a released mark ramps out.
 */
export interface LevelState { resident: boolean; pending: boolean; fade: number; hold?: number }

/**
 * The lack, in pixels, of a pixel whose footprint is `fpKm` (one pixel). `lv[l]` is the state of level l (0..2); `w[l]` its ramp x gate. Sres is the texel
 * size of the colour on screen now (resident levels weighted by pull(fade)), Sid of the colour once every resident and pending level is in (a pending level
 * at its mark's strength, so a released mark's blur ramps out).
 */
export function lackPx(fpKm: number, baseTexelKm: number, lv: readonly LevelState[], w: readonly number[]): number {
  let sRes = baseTexelKm / fpKm, sId = sRes
  for (let l = 2; l >= 0; l--) {
    const texelPx = C_TEXEL_KM * 2 ** l / fpKm
    const s = lv[l]
    const ideal = s.resident ? w[l] : s.pending ? w[l] * (s.hold ?? 1) : 0
    const now = s.resident ? w[l] * pull(s.fade) : 0
    sRes += (texelPx - sRes) * now
    sId += (texelPx - sId) * ideal
  }
  return Math.max(0, sRes - sId)
}

/** The blur radius, pixels, the shader draws for a lack (0: none). */
export function blurRadiusPx(lack: number): number {
  return lack > MIN_LACK_PX ? Math.min(MAX_BLUR_PX, BLUR_PER_LACK * lack) : 0
}

/** What the indicator needs of a frame: the share of the visible frame still drawn coarser than wanted, and the mean lack of that part in px. */
export interface CoarseMeasure { coarse: number; lackPx: number }

/**
 * The compact ray record a streamer keeps from one wanted-set computation: for each ray that meets the ground inside the tile gate, its footprint (km) and, per
 * level 0..2, the page key of the tile under it and its ramp x gate. `total` is the number of rays of the whole grid, sky included.
 */
export interface FocusRays { n: number; total: number; fpKm: Float32Array; key: Int32Array; w: Float32Array }

export function buildFocusRays(
  rs: { n: number; lonW: ArrayLike<number>; lat: ArrayLike<number>; fpKm: ArrayLike<number> },
  total: number, baseTexelKm: number,
  keyAt: (level: number, lonW: number, lat: number) => number,
): FocusRays {
  const fp = new Float32Array(rs.n), key = new Int32Array(3 * rs.n).fill(-1), w = new Float32Array(3 * rs.n)
  for (let i = 0; i < rs.n; i++) {
    fp[i] = rs.fpKm[i]
    for (let l = 0; l < 3; l++) {
      const wl = levelWeight(l, rs.fpKm[i], baseTexelKm)
      if (wl <= 0) continue
      w[3 * i + l] = wl
      key[3 * i + l] = keyAt(l, rs.lonW[i], rs.lat[i])
    }
  }
  return { n: rs.n, total, fpKm: fp, key, w }
}

/** The measure for one frame; `stateOf(key)` reads the page table. Cheap: no trig, a few table reads per ray. */
export function measureCoarse(rays: FocusRays, baseTexelKm: number, stateOf: (key: number) => LevelState): CoarseMeasure {
  if (rays.total <= 0) return { coarse: 0, lackPx: 0 }
  const none: LevelState = { resident: false, pending: false, fade: 0 }
  const lv: LevelState[] = [none, none, none]
  const w = [0, 0, 0]
  let coarse = 0, sum = 0
  for (let i = 0; i < rays.n; i++) {
    for (let l = 0; l < 3; l++) { const k = rays.key[3 * i + l]; lv[l] = k < 0 ? none : stateOf(k); w[l] = rays.w[3 * i + l] }
    const lack = lackPx(rays.fpKm[i], baseTexelKm, lv, w)
    if (lack > COARSE_LACK_PX) { coarse++; sum += lack }
  }
  return { coarse: coarse / rays.total, lackPx: coarse > 0 ? sum / coarse : 0 }
}
