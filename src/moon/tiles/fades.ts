import type { QualityClass } from '../../quality/startupClass'

/**
 * Tile fades, the look half of R57 (analyst TM-7 and TM-9). Pure functions and the two switches that choose them, so a Node test can drive the
 * streamers' fade arithmetic without a GL.
 *
 * - Fade-out (`?fadeout=0` restores the hard step): a parked tile used to be unpaged in one frame, so heights, slopes and colour jumped from the fine
 *   level to the coarser one wherever a pixel still weighed it (a frame edge between ray samples, a capacity cut, the first second after a zoom-out).
 *   Now its fade value falls from where it stands to 0 over the same FADE_MS an arrival takes, and a tile wanted again mid-fade climbs back from there.
 *   Only parking fades: an evicted slot's layer is overwritten by the tile that evicted it in the same call, so it cannot be shown any longer.
 * - Batched fade starts (`?fadebatch=0` restores a start at the upload frame): tiles that arrive within BATCH_MS of each other start their fade on the
 *   same grid line, so a trickle of arrivals makes a few fade windows (a few runs of full-size frames) instead of one continuous one. A fade starts at
 *   most BATCH_MS after the upload; until then the coarser level shows, exactly as it did for the fetch.
 * - Fade cadence (`?fadebatch=0` restores every frame; `=1` forces it on every class): when the only reason for a frame is a tile fade, a class whose
 *   rest frame is over budget draws it every FADE_CADENCE_MS rather than every vsync (main.ts). The fade values follow the clock, so a skipped frame
 *   loses a step of the fade, never time.
 */
export const BATCH_MS = 80
/** The draw interval of a fade-only frame on the classes that get the cadence: about four frames in one 250 ms fade. */
export const FADE_CADENCE_MS = 66
/** Classes whose full rest frame is expensive enough to thin out the fade frames: the same set the web frame cap names. */
export const CADENCE_CLASSES: readonly QualityClass[] = ['ios', 'ipad', 'phone-android', 'tablet']

export interface FadeConfig {
  /** A parked tile fades out. */
  out: boolean
  /** Fade starts snap up to a multiple of this (ms); 0 starts at the upload frame. */
  batchMs: number
  /** `?fadebatch=`: absent follows the class, 0 never thins the frames, 1 thins them on every class, `cost` thins them on the class set and wherever the measured full frame is over two vsyncs (rest-to-motion, WP-A). */
  cadence: 'class' | 'off' | 'on' | 'cost'
}

export function fadesOf(search: string): FadeConfig {
  const q = new URLSearchParams(search)
  const batch = q.get('fadebatch')
  return {
    out: q.get('fadeout') !== '0',
    batchMs: batch === '0' ? 0 : BATCH_MS,
    cadence: batch === '0' ? 'off' : batch === '1' ? 'on' : batch === 'cost' ? 'cost' : 'class',
  }
}

let cfg: FadeConfig = fadesOf(typeof location === 'undefined' ? '' : location.search || (globalThis as { __moonQuery?: string }).__moonQuery || '')
export function setFades(search: string): void { cfg = fadesOf(search) }
export function fadeOutOn(): boolean { return cfg.out }
export function fadeBatchMs(): number { return cfg.batchMs }

/**
 * The draw interval for a fade-only frame on this class, ms; 0 means every frame. `fullMs` is the measured full-size rest frame (0 unknown) and `vsyncMs` the display's
 * interval: under `?fadebatch=cost` a class off the list still gets the cadence while its measured rest frame is over two vsyncs (the owner's 4.58 Mpx desktop drew
 * about 16 full-size fade frames a second for 10-14 s after every gesture). The class rule is unchanged without the switch.
 */
export function fadeCadenceMs(cls: QualityClass, config: FadeConfig = cfg, fullMs = 0, vsyncMs = 1000 / 60): number {
  if (config.cadence === 'off') return 0
  if (config.cadence === 'on' || CADENCE_CLASSES.includes(cls)) return FADE_CADENCE_MS
  return config.cadence === 'cost' && fullMs > 2 * vsyncMs ? FADE_CADENCE_MS : 0
}

/** When an arrival's fade starts: `now` rounded up to the next multiple of `batchMs` (0 or less: `now`). */
export function fadeStartAt(now: number, batchMs: number): number {
  return batchMs > 0 ? Math.ceil(now / batchMs) * batchMs : now
}

/** Fade-in value, 0..1, of a tile whose fade started at `readyAt`; a start in the future (a batched one) reads 0. */
export function fadeInLevel(now: number, readyAt: number, fadeMs: number): number {
  return Math.max(0, Math.min(1, (now - readyAt) / fadeMs))
}

/** Fade-out value, 0..1: `from` at `leaveAt`, falling linearly to 0 over `fadeMs`, the same slope as the arrival so a reversal meets itself. */
export function fadeOutLevel(from: number, leaveAt: number, now: number, fadeMs: number): number {
  return Math.max(0, from * (1 - (now - leaveAt) / fadeMs))
}

/** The `readyAt` that makes a fade-in continue from `level` at `now` (a tile wanted again while it was leaving). */
export function fadeInFrom(level: number, now: number, fadeMs: number): number {
  return now - Math.max(0, Math.min(1, level)) * fadeMs
}
