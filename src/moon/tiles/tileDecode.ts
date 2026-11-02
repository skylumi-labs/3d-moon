import { H_STEP_M } from './grid'
import { decodeHeightPlanes, qToMetres } from './codec'
import { deblockChroma } from './deblock'
import { colorMips } from './colorMips'
import { buildRelief } from './relief'
import { destripeHeights, prepareHeights } from './smoothDeep'

/**
 * The CPU half of a height tile: the integer plane to metres, a deeper tile's mid height taken off, the smoothed copy that is uploaded and
 * the relief summary the exposure search reads. One function so the main-thread path and the decode Worker (tileWorker.ts) run the same code
 * and cannot drift: the Worker's output is pinned bit for bit to this by scripts/tile-worker.test.mts.
 *
 * `colourless`: the tile has no colour of its own (a deeper tile), so it is destriped first. The relief is built from the heights BEFORE the
 * destripe and smoothing, as it always was.
 */
export interface DecodedHeights { heights: Float32Array; mid: number; relief: Float32Array }

export function decodeTileHeights(raw: Uint8Array, level: number, ty: number, deeper: boolean, stepM: number, colourless: boolean): DecodedHeights {
  const q = decodeHeightPlanes(raw)
  const heights = new Float32Array(q.length)
  const step = deeper ? stepM : H_STEP_M
  for (let i = 0; i < q.length; i++) heights[i] = deeper ? q[i] * step : qToMetres(q[i])
  // A deeper tile stores its heights minus its mid height: half float spacing is 2 m above 2048 m, 4 m above 4096 m, and the quantisation
  // terraces every highland slope. Inside +-2048 m of the mid every metre is exact. The shader adds the mid back from the page table.
  let mid = 0
  if (deeper) {
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < heights.length; i++) { const h = heights[i]; if (h < lo) lo = h; if (h > hi) hi = h }
    mid = Math.round((lo + hi) / 2)
    for (let i = 0; i < heights.length; i++) heights[i] -= mid
  }
  return { heights: prepareHeights(colourless ? destripeHeights(heights, level) : heights, level, ty), mid, relief: buildRelief(heights, level, ty) }
}

/** Colour pixels (RGBA) to the mip chain that is uploaded; level 0, the one drawn magnified, first loses the 16 pixel codec blocks in its chroma (deblock.ts). */
export function prepareColour(px: Uint8ClampedArray, level: number, size: number): Uint8Array[] {
  if (level === 0) deblockChroma(px, size)
  return colorMips(px, size)
}
