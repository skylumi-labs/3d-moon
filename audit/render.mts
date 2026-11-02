// The page's own render-rate evidence: one sample per requestAnimationFrame, taken inside the page (audit/lib.mts `SAMPLER`).
// Capture (screenshot + metadata, ~0.3-1 fps on the 2026-10-02 L4 run) is a separate, slower channel: the gates that need a
// rate or a reaction time read THIS series, and judge captured frames only where the capture was dense enough to see.

/** Samples in page time mapped onto the recorder's clock (seconds). Parallel arrays, not objects, so a 25-minute run stays small. */
export interface DenseSeries {
  t: number[]
  /** `__moon.frames` (renders so far). */
  frames: number[]
  /** The exposure controller's drawn white (NaN where the build does not report it). */
  white: number[]
  /** A number that changes whenever the camera or the sky clock moves. */
  cam: number[]
  /** The journey slider position 0-1 (0 when absent). */
  slider: number[]
  /** generation * 8 + status code: changes when a journey starts, arrives, fails. */
  jkey: number[]
  /** `__moon.cuts.length`: the page's own declared exposure cuts so far. */
  cuts: number[]
  /** Spans (recorder seconds) in which the capture loop held the render loop (`auditBegin` to `auditEnd`); no samples exist inside them. */
  held: Array<[number, number]>
}
export const emptyDense = (): DenseSeries => ({ t: [], frames: [], white: [], cam: [], slider: [], jkey: [], cuts: [], held: [] })

const overlapsHeld = (d: DenseSeries, a: number, b: number): boolean => d.held.some(([h0, h1]) => a < h1 && b > h0)

/**
 * Render cadence over the un-held part of the run: intervals between consecutive samples that do not span a capture hold.
 * `fps` is samples per un-held second (what a viewer's rAF loop did); `maxGapS` the longest un-held interval.
 */
export function renderCadence(d: DenseSeries): { fps: number; maxGapS: number; count: number; activeS: number } {
  let active = 0, n = 0, maxGap = 0
  for (let i = 1; i < d.t.length; i++) {
    if (overlapsHeld(d, d.t[i - 1], d.t[i])) continue
    const gap = d.t[i] - d.t[i - 1]
    active += gap; n++; maxGap = Math.max(maxGap, gap)
  }
  return { fps: active > 0 ? n / active : 0, maxGapS: maxGap, count: d.t.length, activeS: active }
}

/** Times at which the camera/clock, the slider or the journey state changed from the previous sample. */
export function motionTimes(d: DenseSeries): number[] {
  const out: number[] = []
  for (let i = 1; i < d.t.length; i++)
    if (d.cam[i] !== d.cam[i - 1] || d.slider[i] !== d.slider[i - 1] || d.jkey[i] !== d.jkey[i - 1]) out.push(d.t[i])
  return out
}

/** Sample count inside [a, b] (un-held samples only: held spans carry none). */
export function samplesIn(d: DenseSeries, a: number, b: number): number {
  let n = 0
  for (const t of d.t) if (t >= a && t <= b) n++
  return n
}

/** Longest stretch of the window [a, b] that is not inside a capture hold. */
export function observedSpan(d: DenseSeries, a: number, b: number): number {
  let free = b - a
  for (const [h0, h1] of d.held) free -= Math.max(0, Math.min(b, h1) - Math.max(a, h0))
  return Math.max(0, free)
}
