import type { EarthFrame } from '../camera/pose'

/**
 * Where the subject may sit: the viewport minus the cards, chip rows and panels laid over it. Pure geometry, so
 * the rule "nothing covers the Moon" is a number a test can check (scripts/layout.test.mts), not a hope about CSS.
 */
export interface Rect { left: number; top: number; right: number; bottom: number }
export type Side = 'left' | 'right' | 'top' | 'bottom'
export interface Occluder { rect: Rect; side: Side }

/** Air kept between the subject's disc and whatever stands beside it, px. */
export const CLEARANCE = 14
/** The subject is never squeezed below this share of the viewport's short side, whatever stands over it. */
export const MIN_FILL = 0.3

/** The part of the viewport no occluder claims. Each occluder takes the band from its side's edge to its far edge. */
export function safeRect(vw: number, vh: number, occluders: Occluder[]): Rect {
  const s: Rect = { left: 0, top: 0, right: vw, bottom: vh }
  for (const o of occluders) {
    const r = o.rect
    if (r.right <= r.left || r.bottom <= r.top) continue
    if (o.side === 'left') s.left = Math.max(s.left, r.right + CLEARANCE)
    else if (o.side === 'right') s.right = Math.min(s.right, r.left - CLEARANCE)
    else if (o.side === 'top') s.top = Math.max(s.top, r.bottom + CLEARANCE)
    else s.bottom = Math.min(s.bottom, r.top - CLEARANCE)
  }
  // Bands that swallow the screen leave the subject centred in the viewport rather than nowhere.
  if (s.right - s.left < vw * 0.2 || s.bottom - s.top < vh * 0.2) return { left: 0, top: 0, right: vw, bottom: vh }
  return s
}

/**
 * The Earth-view frame for a safe rect: the Moon's centre at the rect's centre, its diameter `fill` of the rect's
 * short side (and so of the viewport's short side scaled down by the same ratio).
 */
export function subjectFrame(vw: number, vh: number, safe: Rect, fill: number): EarthFrame {
  const w = safe.right - safe.left, h = safe.bottom - safe.top
  const cx = (safe.left + safe.right) / 2, cy = (safe.top + safe.bottom) / 2
  const share = Math.max(MIN_FILL, Math.min(1, Math.min(w, h) / Math.min(vw, vh)))
  return { nx: (cx / vw) * 2 - 1, ny: 1 - (cy / vh) * 2, fill: fill * share }
}

/** Steps a frame toward a target at `rate` per second so a card appearing does not snap the Moon across the screen. */
export function easeFrame(cur: EarthFrame, target: EarthFrame, dt: number, rate = 7): EarthFrame {
  const k = 1 - Math.exp(-rate * dt)
  const m = (a: number, b: number): number => (Math.abs(b - a) < 1e-4 ? b : a + (b - a) * k)
  return { nx: m(cur.nx, target.nx), ny: m(cur.ny, target.ny), fill: m(cur.fill, target.fill) }
}
export const frameSettled = (a: EarthFrame, b: EarthFrame): boolean => a.nx === b.nx && a.ny === b.ny && a.fill === b.fill

/**
 * Home's aim (flight feel v2, owner 2026-10-29: "I would have expected us to fly to the middle"): the disc of radius `radiusPx` stays at the
 * middle of the viewport whenever it fits there inside the safe rect, and moves only as far as it must to clear what stands over the
 * frame (the bar, the caption) when it does not. `subjectFrame` centres it in the safe rect instead, which put the Home Moon 35 to 40 px
 * above the middle on every screen with a bar. A disc too large for the safe rect gets the safe rect's centre on that axis.
 */
export function minimalAim(vw: number, vh: number, safe: Rect, radiusPx: number): { nx: number; ny: number } {
  const axis = (mid: number, lo: number, hi: number): number => {
    const a = lo + radiusPx, b = hi - radiusPx
    if (a > b) return (lo + hi) / 2
    return Math.max(a, Math.min(b, mid))
  }
  const cx = axis(vw / 2, safe.left, safe.right), cy = axis(vh / 2, safe.top, safe.bottom)
  return { nx: (cx / vw) * 2 - 1, ny: 1 - (cy / vh) * 2 }
}
