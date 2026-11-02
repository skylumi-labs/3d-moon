/**
 * Where the centre caption may stand on its row above the dock, from real rectangles. Pure: the DOM layer measures, this decides.
 * The row is limited to the viewport's left and right safe-area insets (the dock itself has none), every overlapping control rect is cut
 * out, and the widest remaining interval is used: the name stays centred on the screen when it fits there, else it is centred in the interval.
 */
export interface Rect { left: number; top: number; right: number; bottom: number }

export interface ClearanceInput {
  viewportW: number
  /** Left and right safe-area insets of the viewport, px. */
  insetL: number
  insetR: number
  /** The dock's own horizontal padding, px (the row never reaches the screen edge). */
  pad: number
  /** The caption's row: its top and bottom edges, px from the top of the viewport. */
  rowTop: number
  rowBottom: number
  /** Everything that can stand in the row: the visible flight pad, the transformed toggle, the open reduced-detail popup, the HUD, the chip. */
  rects: readonly Rect[]
  /** The name's natural width, px. */
  textW: number
  /** The narrowest interval worth showing a name in, px (est). */
  minW: number
  /** Breathing room kept from each control, px. */
  gap?: number
}
export interface Placement { left: number; width: number }

export const MIN_CAPTION_W = 120

/**
 * The width to give a name of measured natural width `measured` (a fractional rect width, or a rounded scrollWidth): rounded UP plus a little slack.
 * A box a fraction of a pixel narrower than its text overflows, and `text-overflow: ellipsis` then eats the last letters ("Oceanus Procellaru...")
 * with plenty of room around. The box is only ever narrower than its text when the interval truly is.
 */
export const CAPTION_SLACK_PX = 2
export const naturalWidth = (measured: number): number => Math.ceil(measured) + CAPTION_SLACK_PX

export function placeCaption(i: ClearanceInput): Placement | null {
  const gap = i.gap ?? 8
  const lo = Math.max(i.pad, i.insetL), hi = i.viewportW - Math.max(i.pad, i.insetR)
  if (!(hi - lo >= i.minW)) return null
  let free: Array<[number, number]> = [[lo, hi]]
  for (const r of i.rects) {
    if (!(r.right > r.left) || !(r.bottom > r.top)) continue
    if (r.bottom <= i.rowTop || r.top >= i.rowBottom) continue
    const a = r.left - gap, b = r.right + gap
    const next: Array<[number, number]> = []
    for (const [x0, x1] of free) {
      if (b <= x0 || a >= x1) { next.push([x0, x1]); continue }
      if (a > x0) next.push([x0, a])
      if (b < x1) next.push([b, x1])
    }
    free = next
  }
  let best: [number, number] | null = null
  for (const iv of free) if (iv[1] - iv[0] >= i.minW && (!best || iv[1] - iv[0] > best[1] - best[0])) best = iv
  if (!best) return null
  const width = Math.min(Math.max(1, i.textW), best[1] - best[0])
  const centred = i.viewportW / 2 - width / 2
  const left = centred >= best[0] && centred + width <= best[1] ? centred : best[0] + (best[1] - best[0] - width) / 2
  return { left, width }
}

/**
 * Whether a transition or animation can move or hide a rectangle the row is measured against: only on the measured elements themselves (the pad, its
 * toggle and wrapper, the chip, its popup, the HUD), and only for properties that change geometry or visibility. A descendant's own motion (the
 * a descendant transform transition, icon rotations, item fades inside the pad) leaves every occupied rectangle unchanged.
 */
const ROW_PROPERTIES = new Set(['bottom', 'right', 'left', 'top', 'width', 'height', 'transform', 'translate', 'scale', 'opacity', 'display', 'visibility'])
export function transitionMovesRow(isMeasuredElement: boolean, property: string): boolean {
  return isMeasuredElement && ROW_PROPERTIES.has(property)
}

/** Longest control transition (the pad's unfold, 0.26 s) plus a frame or two. */
export const TRANSITION_SETTLE_MS = 450

/**
 * Keeps the placement fresh. Anything that can change the row's clearance calls `invalidate()` (a dock or caption size change, a popup shown, hidden
 * or rewritten, a control mounted), and `transition(now)` on a control transition event; the placement is recomputed on the next `refresh`, and on every
 * `refresh` until the transitions settle (the pad's rect moves each frame while it unfolds), even while the caption stays shown.
 */
export class RowClearance {
  private dirty = true
  private motionUntil = 0
  private key = 'init'
  placement: Placement | null = null
  /** The input of the last measurement (the row's edges, for the caption's cached rect). */
  input: ClearanceInput | null = null
  invalidate(): void { this.dirty = true }
  transition(now: number): void { this.motionUntil = now + TRANSITION_SETTLE_MS; this.dirty = true }
  needsRefresh(now: number): boolean { return this.dirty || now < this.motionUntil }
  /** Recomputes when needed; true when the placement (and so the label layer's exclusion rectangle) changed. */
  refresh(now: number, measure: () => ClearanceInput): boolean {
    if (!this.needsRefresh(now)) return false
    this.dirty = false
    const input = measure()
    this.input = input
    this.placement = placeCaption(input)
    const p = this.placement
    const key = p ? `${p.left.toFixed(1)}:${p.width.toFixed(1)}:${input.rowBottom.toFixed(1)}` : 'none'
    const changed = key !== this.key
    this.key = key
    return changed
  }
}
