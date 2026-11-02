/**
 * Where the lock label's text block stands beside its brackets, from real rectangles. Pure: the DOM layer measures, this decides.
 * The same clearance as the plain caption's row (centreCaptionLayout.ts): the viewport's safe area and every visible control rectangle (the dock, the flight
 * pad and its toggle, the HUD, the credit) are kept clear by `gap`. The block is tried right of the brackets (the artboard), then left, below and above; the
 * first that fits wins. The brackets themselves must be clear too, or nothing is shown.
 */
import type { Rect } from './centreCaptionLayout'
import type { Box } from '../labels/lockLabelCore'

export interface LockInput {
  viewportW: number
  viewportH: number
  /** Safe-area insets, px. */
  insetL: number
  insetR: number
  insetT: number
  insetB: number
  /** The brackets. */
  box: Box
  /** The fully typed block's size, px (measured once per name, so the block never moves while it types). */
  textW: number
  textH: number
  rects: readonly Rect[]
  /** Breathing room from the brackets, px. */
  side?: number
  /** Breathing room from each control and the screen edge, px. */
  gap?: number
}
export type Side = 'right' | 'left' | 'below' | 'above'
export interface LockPlacement { side: Side; left: number; top: number }

const overlaps = (a: Rect, b: Rect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
const grow = (r: Rect, g: number): Rect => ({ left: r.left - g, top: r.top - g, right: r.right + g, bottom: r.bottom + g })

export function placeLock(i: LockInput): LockPlacement | null {
  const side = i.side ?? 14, gap = i.gap ?? 8
  const lo = Math.max(gap, i.insetL), hi = i.viewportW - Math.max(gap, i.insetR)
  const top = Math.max(gap, i.insetT), bottom = i.viewportH - Math.max(gap, i.insetB)
  const inside = (r: Rect): boolean => r.left >= lo && r.right <= hi && r.top >= top && r.bottom <= bottom
  const clear = (r: Rect): boolean => inside(r) && !i.rects.some((c) => c.right > c.left && c.bottom > c.top && overlaps(grow(c, gap), r))
  const b = i.box
  const boxRect: Rect = { left: b.left, top: b.top, right: b.left + b.width, bottom: b.top + b.height }
  if (!clear(boxRect)) return null
  const cx = b.left + b.width / 2, cy = b.top + b.height / 2
  const tries: Array<[Side, number, number]> = [
    ['right', b.left + b.width + side, cy - i.textH / 2],
    ['left', b.left - side - i.textW, cy - i.textH / 2],
    ['below', cx - i.textW / 2, b.top + b.height + side],
    ['above', cx - i.textW / 2, b.top - side - i.textH],
  ]
  for (const [s, left, t] of tries) {
    const r: Rect = { left, top: t, right: left + i.textW, bottom: t + i.textH }
    if (clear(r)) return { side: s, left, top: t }
  }
  return null
}

/** The rectangle the label occupies (brackets and block), for the map labels and the first-visit hotspots to keep clear of. */
export function lockRect(box: Box, p: LockPlacement | null, textW: number, textH: number): Rect {
  const r: Rect = { left: box.left, top: box.top, right: box.left + box.width, bottom: box.top + box.height }
  if (!p) return r
  return { left: Math.min(r.left, p.left), top: Math.min(r.top, p.top), right: Math.max(r.right, p.left + textW), bottom: Math.max(r.bottom, p.top + textH) }
}
