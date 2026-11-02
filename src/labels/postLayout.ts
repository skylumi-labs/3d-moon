/**
 * The Labels layer's layout, pure (no DOM, no renderer): which labels may show, where each one's post and name go, and how
 * they appear and leave. The ui layer (src/ui/labels.ts) projects the rows, measures the names and draws what this returns.
 *
 * The rules that keep it calm (owner 2026-10-17: "make sure the logic when labels appear and disappear is absolutely flawless"):
 * - Zooming in never removes a label. The tier thresholds only remove on the way OUT, and every threshold has hysteresis
 *   (appear below one span, leave above a larger one; appear above one limb angle, leave below a smaller one).
 * - A label on screen keeps its slot while that slot is free and is placed before any newcomer of its own or a lower tier, so
 *   nothing swaps back and forth and zooming in (which only brings in tiers 2 and 3) never evicts a name; only a major name
 *   entering the frame may take the place of a minor one.
 * - A new label must be placeable for APPEAR_DELAY_MS before it fades in; a label that loses its place fades out and, while it
 *   fades, its box stays reserved against newcomers (two names never cross-fade over each other).
 * - The hovered label and the one the visitor flew to are pinned: placed first, never moved, never dropped while on screen.
 */
import type { Tier } from './curated'

export type Box = [left: number, top: number, right: number, bottom: number]
export interface Pt { x: number; y: number }

/** Frame spans (km across the short side) below which a tier may appear, and above which it leaves. */
export const TIER_SPAN = { 2: { appear: 2400, leave: 2900 }, 3: { appear: 1000, leave: 1250 } } as const
/** Limb: a label appears where its surface faces the camera by more than APPEAR (cosine), and leaves below LEAVE. */
export const FACING = { appear: 0.16, leave: 0.07 } as const
export const APPEAR_DELAY_MS = 110
export const FADE_IN_MS = 320
export const FADE_OUT_MS = 220
/** Post length on screen at full lean, px, by tier. */
export const POST_PX: Record<Tier, number> = { 1: 46, 2: 34, 3: 24 }
/** Gap between a post's tip and its name, px; and the half-size of the icon drawn at the surface point. */
export const GAP_PX = 6
export const ICON_HALF_PX = 8
/** Labels keep this far inside the frame, px. */
export const EDGE_PX = 8

/** Whether a row may show at this zoom and limb angle, with hysteresis on both (`shown`: it is on screen now). */
export function eligible(tier: Tier, spanKm: number, facing: number, shown: boolean): boolean {
  if (facing < (shown ? FACING.leave : FACING.appear)) return false
  if (tier === 1) return true
  const t = TIER_SPAN[tier]
  return spanKm < (shown ? t.leave : t.appear)
}

/** Opacity from the limb: full above FACING.appear, falling to zero at FACING.leave. */
export function limbAlpha(facing: number): number {
  const t = Math.max(0, Math.min(1, (facing - FACING.leave) / (FACING.appear - FACING.leave)))
  return t * t * (3 - 2 * t)
}

/** On-screen post length, px: full when the post is seen side-on, 40 % when it points at the camera. `sinLean` is the sine of
 * the angle between the surface normal and the line of sight. */
export function postLength(tier: Tier, sinLean: number): number {
  return POST_PX[tier] * (0.4 + 0.6 * Math.max(0, Math.min(1, sinLean)))
}

export interface PostCandidate {
  id: string
  tier: Tier
  /** Order within the tier, 0 first (by size and importance), at most 199. */
  order: number
  /** The surface point on screen (where the icon is drawn). */
  base: Pt
  /** Unit screen direction of the post (the surface normal, projected). */
  dir: Pt
  /** Post length for this tier and lean, px. */
  postPx: number
  /** The label's box: width, height, and the height of its first (name) row, which the leader meets in the middle. */
  w: number
  h: number
  nameH: number
  /** Hovered or flown to: placed first and kept. */
  pinned?: boolean
  /** A smaller form (the name alone) tried after every slot of the full one: a crowded major label drops its line of context
   * before it drops out. Its slots' keys start with 'c'. */
  compact?: { w: number; h: number }
  /** Offered by the region fill only (the zoom alone keeps it out): it joins a short grid cell, see centreFill. */
  fill?: boolean
}

/**
 * Grid-based replacement for the old middle-third fill; only cells centred on the projected Moon count.
 */
/** Target cell edge in CSS pixels. Rounding counts keeps cells near square across common frame sizes. */
export const FILL_CELL_PX = 240
/** Per-frame budget for new region-fill names. */
export const REGION_FILL = 12
/** Whether a candidate holds its cell: an ordinary name does; a fill and the terminator line's label do not (the terminator is a
 * line across the disc, not a place, and its label alone left the middle of a half-lit Moon bare, owner 2026-10-24). */
export const holdsCell = (c: Pick<PostCandidate, 'id' | 'fill'>): boolean => !c.fill && c.id !== 'terminator'
/** Compatibility threshold: a cell is short below one ordinary name. */
export const CENTRE_MIN = 1
/** Compatibility export; this now names the bounded region-fill budget. */
export const CENTRE_FILL = REGION_FILL
export interface Disc { center: Pt; radius: number }
export interface FillCell { id: string; box: Box; center: Pt }
/** Cells are sized from the frame and only cells centred on the visible projected Moon disc are eligible. */
export function fillCells(bounds: Box, disc: Disc, target = FILL_CELL_PX): FillCell[] {
  const w = Math.max(1, bounds[2] - bounds[0]), h = Math.max(1, bounds[3] - bounds[1])
  const cols = Math.max(1, Math.round(w / target)), rows = Math.max(1, Math.round(h / target))
  const cw = w / cols, ch = h / rows, out: FillCell[] = []
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const center = { x: bounds[0] + (col + 0.5) * cw, y: bounds[1] + (row + 0.5) * ch }
    if (Math.hypot(center.x - disc.center.x, center.y - disc.center.y) > disc.radius) continue
    out.push({ id: `${col}:${row}`, center, box: [bounds[0] + col * cw, bounds[1] + row * ch, bounds[0] + (col + 1) * cw, bounds[1] + (row + 1) * ch] })
  }
  return out
}
/** Cell containing a point; shown labels can stay in a slightly grown cell during camera motion. */
export function fillCellAt(point: Pt, cells: readonly FillCell[], grow = 0): FillCell | undefined {
  return cells.find((c) => point.x >= c.box[0] - grow && point.x <= c.box[2] + grow && point.y >= c.box[1] - grow && point.y <= c.box[3] + grow)
}
/** Spans (km) below which a row may be offered as a fill and above which a fill name on screen leaves: a notable (tier 2) name out
 * to where the ordinary tier-2 names have just left; a minor one (tier 3, the Gazetteer's rows) out to a little past the home view,
 * so a visit to the limb does not leave small names on the far-out Moon. Hysteresis as TIER_SPAN; the limb rule is FACING's. */
export const FILL_SPAN = { 2: { appear: 2900, leave: 3200 }, 3: { appear: 2600, leave: 3200 } } as const
export function fillEligible(tier: Tier, spanKm: number, facing: number, shown: boolean): boolean {
  if (tier === 1 || facing < (shown ? FACING.leave : FACING.appear)) return false
  const t = FILL_SPAN[tier]
  return spanKm < (shown ? t.leave : t.appear)
}
/** Which horizontal third of the frame a point stands in. */
export function thirdOf(x: number, bounds: Box): 'left' | 'centre' | 'right' {
  const t = (x - bounds[0]) / Math.max(1e-6, bounds[2] - bounds[0])
  return t < 1 / 3 ? 'left' : t < 2 / 3 ? 'centre' : 'right'
}
/** What the last layout made of a candidate: placed, dropped, or not seen yet (a newcomer counts as a name until the layout says otherwise). */
export type Verdict = 'placed' | 'dropped' | 'new'
/**
 * The fill: `shown` is a fill name on screen (its life eligible); `verdict` the last layout's word on a candidate. A shown fill stays
 * offered while on frame, regardless of recovered counts or camera motion. New fills are limited to one per short cell and the
 * global REGION_FILL budget.
 */
export function centreFill(cands: PostCandidate[], bounds: Box, shown: (id: string) => boolean, verdict: (id: string) => Verdict = () => 'new', cells = fillCells(bounds, { center: { x: (bounds[0] + bounds[2]) / 2, y: (bounds[1] + bounds[3]) / 2 }, radius: Infinity })): PostCandidate[] {
  const onFrame = (c: PostCandidate): boolean => inside([c.base.x, c.base.y, c.base.x, c.base.y], bounds)
  const out = cands.filter((c) => !c.fill || (shown(c.id) && onFrame(c)))
  const ordinary = out.filter((c) => holdsCell(c) && onFrame(c) && verdict(c.id) !== 'dropped')
  const occupied = new Set(ordinary.map((c) => fillCellAt(c.base, cells)?.id).filter((id): id is string => !!id))
  const activeShown = out.filter((c) => c.fill && shown(c.id)).length
  let budget = Math.max(0, REGION_FILL - activeShown)
  const offered = cands.filter((c) => c.fill && !shown(c.id) && onFrame(c) && fillCellAt(c.base, cells))
  offered.sort((a, b) => a.tier - b.tier || a.order - b.order || (a.id < b.id ? -1 : 1))
  const filledCells = new Set<string>()
  for (const c of out) if (c.fill && onFrame(c)) { const cell = fillCellAt(c.base, cells); if (cell) filledCells.add(cell.id) }
  for (const c of offered) {
    if (!budget) break
    const cell = fillCellAt(c.base, cells)!
    if (occupied.has(cell.id) || filledCells.has(cell.id)) continue
    out.push(c); filledCells.add(cell.id); budget--
  }
  return out
}

/** Where a name is drawn: its box follows its tip (the post at `lf` of its length) by the offset `off` the slot gave it. */
export function drawnBox(c: Pick<PostCandidate, 'base' | 'dir' | 'postPx'>, lf: number, off: Pt, w: number, h: number): Box {
  const x = c.base.x + c.dir.x * c.postPx * lf + off.x, y = c.base.y + c.dir.y * c.postPx * lf + off.y
  return [x, y, x + w, y + h]
}
/**
 * Names sliding to new slots (the 70 ms ease) must not cross each other or a fading name: of the boxes drawn this frame (`now`,
 * the eased position; `at`, the box at the slot the layout gave, null for a name that is leaving and has none), returns the ids
 * that must jump to their slot instead of easing there: a moving name whose eased box touches another drawn box. Slot boxes of
 * one layout stand apart from each other and from the leaving boxes it reserved, so after the jump nothing touches.
 */
export function settleMoves(drawn: ReadonlyArray<{ id: string; now: Box; at: Box | null }>): Set<string> {
  const jump = new Set<string>()
  // A snap can land on a third name's still-easing box. Recheck after each
  // batch; each iteration adds at least one id, so this is bounded by n + 1.
  for (let iteration = 0; iteration <= drawn.length; iteration++) {
    let changed = false
    const box = (d: typeof drawn[number]): Box => jump.has(d.id) && d.at ? d.at : d.now
    for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) {
      const a = drawn[i], b = drawn[j]
      if (!overlaps(box(a), box(b))) continue
      for (const d of [a, b]) if (d.at && !sameBox(d.now, d.at) && !jump.has(d.id)) { jump.add(d.id); changed = true }
    }
    if (!changed) break
  }
  return jump
}
const sameBox = (a: Box, b: Box): boolean => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01 && Math.abs(a[2] - b[2]) < 0.01 && Math.abs(a[3] - b[3]) < 0.01

/** The names of each third of the frame (the rig's and `__moon.labels.debug()`'s view of the complaint): placed and dropped candidates by the third their point stands in, and the blocked boxes that touch each third. */
export function thirds(cands: ReadonlyArray<{ id: string; base: Pt }>, placed: ReadonlySet<string>, blocked: readonly Box[], bounds: Box): Record<'left' | 'centre' | 'right', { placed: string[]; dropped: string[]; blocked: number }> {
  const out = { left: { placed: [] as string[], dropped: [] as string[], blocked: 0 }, centre: { placed: [] as string[], dropped: [] as string[], blocked: 0 }, right: { placed: [] as string[], dropped: [] as string[], blocked: 0 } }
  for (const c of cands) (placed.has(c.id) ? out[thirdOf(c.base.x, bounds)].placed : out[thirdOf(c.base.x, bounds)].dropped).push(c.id)
  const w = (bounds[2] - bounds[0]) / 3
  const bands: Array<['left' | 'centre' | 'right', Box]> = [['left', [bounds[0], bounds[1], bounds[0] + w, bounds[3]]], ['centre', [bounds[0] + w, bounds[1], bounds[0] + 2 * w, bounds[3]]], ['right', [bounds[0] + 2 * w, bounds[1], bounds[2], bounds[3]]]]
  for (const b of blocked) for (const [k, band] of bands) if (overlaps(b, band)) out[k].blocked++
  return out
}

/** Shared label rank for layout and motion thinning: pinned, then already shown, tier, and curated order. */
export function postCandidateRank(c: PostCandidate, shown: ReadonlyMap<string, string>): number {
  return (c.pinned ? -1e6 : 0) + c.tier * 1000 - (shown.has(c.id) ? 1200 : 0) + Math.min(199, Math.max(0, c.order))
}

export type Side = 'r' | 'l' | 'a' | 'b'
export interface Slot { key: string; side: Side; lf: number; tip: Pt; rect: Box }

const tipAt = (c: PostCandidate, lf: number): Pt => ({ x: c.base.x + c.dir.x * c.postPx * lf, y: c.base.y + c.dir.y * c.postPx * lf })

/**
 * A candidate's slots in order of preference: beside the post's tip on the side the post leans to, on a longer post, above or
 * below the tip, diagonally off it; then hugging the icon (no post); then across the lean; then (near the frame's edge) on a
 * post turned inward or hanging under or over the icon.
 */
export function slotsFor(c: PostCandidate): Slot[] {
  if (!c.compact) return slotsOf(c, '')
  return [...slotsOf(c, ''), ...slotsOf({ ...c, w: c.compact.w, h: c.compact.h, nameH: Math.min(c.nameH, c.compact.h), compact: undefined }, 'c')]
}

function slotsOf(c: PostCandidate, prefix: string): Slot[] {
  const out: Slot[] = []
  const first: Side = c.dir.x >= 0 ? 'r' : 'l'
  const second: Side = first === 'r' ? 'l' : 'r'
  const side = (s: Side, lf: number, key: string, dy = 0): void => {
    const t = tipAt(c, lf)
    const gap = lf === 0 ? ICON_HALF_PX + GAP_PX : GAP_PX
    const top = t.y - c.nameH / 2 + dy
    const x = s === 'r' ? t.x + gap : t.x - gap - c.w
    out.push({ key: prefix + key, side: s, lf, tip: t, rect: [x, top, x + c.w, top + c.h] })
  }
  const vert = (s: 'a' | 'b', lf: number): void => {
    const t = tipAt(c, lf)
    const x = t.x - c.w / 2
    const top = s === 'a' ? t.y - GAP_PX - c.h : t.y + GAP_PX
    out.push({ key: prefix + s + lf, side: s, lf, tip: t, rect: [x, top, x + c.w, top + c.h] })
  }
  // Along the lean first (the post carries the name away from its place), then the name beside its own icon with no post,
  // and only then across the lean, where the leader has to turn back past the post.
  side(first, 1, first + '1')
  side(first, 1.6, first + '1.6')
  vert(c.dir.y <= 0 ? 'a' : 'b', 1)
  side(first, 1, first + 'u1', -(c.h - c.nameH / 2) - 4); side(first, 1, first + 'd1', c.nameH / 2 + 4)
  side(first, 0, first + '0'); side(second, 0, second + '0')
  side(second, 1, second + '1'); side(second, 1.6, second + '1.6')
  vert(c.dir.y <= 0 ? 'b' : 'a', 1)
  side(second, 1, second + 'u1', -(c.h - c.nameH / 2) - 4); side(second, 1, second + 'd1', c.nameH / 2 + 4)
  // Near the frame's edge the outward lean runs off screen: the post turns inward, or the name hangs under or over the icon.
  side(second, -1, second + '-1'); side(first, -1, first + '-1')
  const hang = (s: 'a' | 'b'): void => {
    const x = c.base.x - c.w / 2
    const top = s === 'a' ? c.base.y - ICON_HALF_PX - GAP_PX - c.h : c.base.y + ICON_HALF_PX + GAP_PX
    out.push({ key: prefix + s + '0', side: s, lf: 0, tip: { ...c.base }, rect: [x, top, x + c.w, top + c.h] })
  }
  hang(c.base.y < 200 ? 'b' : 'a'); hang(c.base.y < 200 ? 'a' : 'b')
  return out
}

export const overlaps = (a: Box, b: Box): boolean => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
/** Whether the segment from p to q passes through box b (Liang-Barsky clipping). */
export function segmentHits(p: Pt, q: Pt, b: Box): boolean {
  const dx = q.x - p.x, dy = q.y - p.y
  const ps = [-dx, dx, -dy, dy], qs = [p.x - b[0], b[2] - p.x, p.y - b[1], b[3] - p.y]
  let t0 = 0, t1 = 1
  for (let i = 0; i < 4; i++) {
    if (ps[i] === 0) { if (qs[i] < 0) return false; continue }
    const t = qs[i] / ps[i]
    if (ps[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t } else { if (t < t0) return false; if (t < t1) t1 = t }
  }
  return true
}
const inside = (r: Box, bounds: Box): boolean => r[0] >= bounds[0] + EDGE_PX && r[1] >= bounds[1] + EDGE_PX && r[2] <= bounds[2] - EDGE_PX && r[3] <= bounds[3] - EDGE_PX
const iconBox = (p: Pt): Box => [p.x - ICON_HALF_PX, p.y - ICON_HALF_PX, p.x + ICON_HALF_PX, p.y + ICON_HALF_PX]

export interface Placement { id: string; slot: Slot; icon: Box }
/** Why placePosts dropped a candidate (the diagnostic view only). */
export type DropReason = 'off-frame' | 'budget' | 'point-covered' | 'no-slot'

/**
 * Places the candidates. `shown` holds the ids on screen now with their slot keys; `reserved` the boxes of labels fading
 * out (closed to every label but a pinned one: two names never cross-fade over each other); `blocked` the boxes of the chrome
 * (caption, bar, pins); `maxPlaced` the frame's budget of names (newcomers stop at it, names on screen at two over it). Order:
 * pinned, then by tier, and within a tier the labels already shown before new ones, each in its own order. A shown label tries
 * its slot first. `reasons`, when given, receives why each dropped candidate was dropped.
 */
export function placePosts(cands: PostCandidate[], shown: ReadonlyMap<string, string>, reserved: Box[], blocked: Box[], bounds: Box, maxPlaced = Infinity, reasons?: Map<string, DropReason>): Map<string, Placement> {
  // Ranks (lower first): shown tier 1, shown tier 2, NEW tier 1, shown tier 3, new tier 2, new tier 3. A label that zooming in
  // brings in (tiers 2 and 3) never takes the place of one already on screen; a major name entering the frame still beats a minor one.
  const sorted = [...cands].sort((a, b) => postCandidateRank(a, shown) - postCandidateRank(b, shown) || (a.id < b.id ? -1 : 1))
  const taken: Box[] = [...blocked]
  const icons: Box[] = []
  const out = new Map<string, Placement>()
  const onFrame = (c: PostCandidate): boolean => inside([c.base.x, c.base.y, c.base.x, c.base.y], bounds)
  // The points of the labels already on screen are held before any name is placed, so a name never slides over a point that is
  // already labelled (greedy placement otherwise lets an earlier name cover a later label's point and drop it). A held point
  // binds every label of its own tier or a lower one; a more important newcomer may take its place (the held label then leaves).
  const held = sorted.filter((c) => (shown.has(c.id) || c.pinned) && onFrame(c)).map((c) => ({ id: c.id, tier: c.tier, box: iconBox(c.base) }))
  for (const c of sorted) {
    if (!onFrame(c)) { reasons?.set(c.id, 'off-frame'); continue }
    const icon = iconBox(c.base)
    const isNew = !shown.has(c.id) && !c.pinned
    // The frame's budget of names: a newcomer needs room under it, a name already on screen keeps its place up to two over it.
    if (!c.pinned && out.size >= maxPlaced + (isNew ? 0 : 2)) { reasons?.set(c.id, 'budget'); continue }
    const bound = held.filter((h) => h.id !== c.id && (!isNew || h.tier <= c.tier)).map((h) => h.box)
    // A box a leaving name still draws in is closed to everyone but a pinned label (a shown name moves rather than cross-fades over it).
    const free = (r: Box): boolean => !taken.some((t) => overlaps(r, t)) && !bound.some((t) => overlaps(r, t)) && !(!c.pinned && reserved.some((t) => overlaps(r, t)))
    // A post never runs through another label's icon.
    const postClear = (s: Slot): boolean => s.lf === 0 || (!icons.some((t) => segmentHits(c.base, s.tip, t)) && !bound.some((t) => segmentHits(c.base, s.tip, t)))
    // A newcomer's point must be clear; a label on screen leaves if an earlier, more important name now covers its point.
    if (!c.pinned && !free(icon) && (isNew || taken.some((t) => overlaps(icon, t)))) { reasons?.set(c.id, 'point-covered'); continue }
    const slots = slotsFor(c)
    const prev = shown.get(c.id)
    if (prev) slots.sort((a, b) => Number(b.key === prev) - Number(a.key === prev))
    // A pinned label keeps its slot whenever the name still fits there (the post rule yields to not moving under the pointer).
    let pick = c.pinned && prev ? slots.find((s) => s.key === prev && inside(s.rect, bounds) && free(s.rect)) : undefined
    pick ??= slots.find((s) => inside(s.rect, bounds) && !overlaps(s.rect, icon) && free(s.rect) && postClear(s))
    // A pinned label (under the pointer, or the place just flown to) is never dropped while its point is on screen: with no
    // free slot it keeps the one it had, or the first that fits the frame.
    if (!pick && c.pinned) pick = slots.find((s) => s.key === prev && inside(s.rect, bounds)) ?? slots.find((s) => inside(s.rect, bounds) && !overlaps(s.rect, icon))
    if (!pick) { reasons?.set(c.id, 'no-slot'); continue }
    taken.push(pick.rect, icon)
    icons.push(icon)
    out.set(c.id, { id: c.id, slot: pick, icon })
  }
  return out
}

/**
 * One label's life on screen: its opacity, how long it has been placeable, and the box it reserves while it leaves. `eligible` is the
 * tier hysteresis (kept through motion thinning); `appeared` is whether the label has finished its appear delay since it last became
 * eligible. The two are separate (issue #256): only a label that has appeared skips the delay when it is placed again.
 */
export interface Life { alpha: number; target: 0 | 1; eligible: boolean; appeared: boolean; readySince: number; slotKey: string | null; rect: Box | null }

/**
 * Advances every label's life by one frame. A placed label that was not on screen waits APPEAR_DELAY_MS of being placeable,
 * then fades in; a label that is no longer placed fades out from where it was. Returns the ids still worth drawing.
 */
export function stepLives(lives: Map<string, Life>, placed: ReadonlyMap<string, Placement>, now: number, dt: number, instant = false, eligibleIds: ReadonlySet<string> = new Set(placed.keys())): string[] {
  for (const [id, p] of placed) {
    let l = lives.get(id)
    if (!l) { l = { alpha: 0, target: 0, eligible: false, appeared: false, readySince: now, slotKey: null, rect: null }; lives.set(id, l) }
    if (l.target === 0 && l.alpha <= 0 && now - l.readySince < APPEAR_DELAY_MS && !instant) { l.slotKey = p.slot.key; l.rect = p.slot.rect; continue }
    l.target = 1
    l.appeared = true
    l.slotKey = p.slot.key
    l.rect = p.slot.rect
  }
  const drawn: string[] = []
  for (const [id, l] of lives) {
    l.eligible = eligibleIds.has(id)
    if (!placed.has(id)) {
      l.target = 0
      // A label that has appeared keeps its clock while it stays eligible: motion thinning may remove placement
      // temporarily, and it returns at once. A newcomer still waiting out its delay (collision-blocked, or thinned)
      // restarts it: the delay asks for APPEAR_DELAY_MS of continuous placeability (issue #256).
      if (!l.eligible) { l.readySince = Infinity; l.appeared = false } else if (!l.appeared) l.readySince = Infinity
    } else if (!Number.isFinite(l.readySince)) l.readySince = now
    const rate = instant ? Infinity : l.target === 1 ? dt / FADE_IN_MS : dt / FADE_OUT_MS
    l.alpha = l.target === 1 ? Math.min(1, l.alpha + rate) : Math.max(0, l.alpha - rate)
    if (l.alpha <= 0 && l.target === 0) {
      // Motion thinning removes placement, not eligibility. Keep that history so tier hysteresis
      // still applies when the full candidate set returns after motion rests.
      if (!placed.has(id) && !l.eligible) lives.delete(id)
      continue
    }
    drawn.push(id)
  }
  return drawn
}

/** The labels on screen now (fully or fading in) and their slots: the `shown` argument of the next placePosts. */
export function shownSlots(lives: ReadonlyMap<string, Life>): Map<string, string> {
  const out = new Map<string, string>()
  for (const [id, l] of lives) if (l.target === 1 && l.slotKey) out.set(id, l.slotKey)
  return out
}

/** The boxes of labels fading out, where they were placed. The layer itself reserves the box a leaving name is drawn in
 * (`drawnBox` with the name's eased offset), so this is the tests' convenience only. */
export function leavingBoxes(lives: ReadonlyMap<string, Life>): Box[] {
  const out: Box[] = []
  for (const l of lives.values()) if (l.target === 0 && l.alpha > 0 && l.rect) out.push(l.rect)
  return out
}

/** Whether a label that reserved space while leaving has stopped reserving its old rectangle. */
export function leavingLabelReleased(previous: ReadonlySet<string>, lives: ReadonlyMap<string, Life>): boolean {
  for (const id of previous) {
    const life = lives.get(id)
    if (!life || life.target !== 0 || life.alpha <= 0 || !life.rect) return true
  }
  return false
}

/** While the camera moves, reuse placements for at most 100 ms; names continue following their projected tips. A reused layout
 * is kept only while the names, followed to where their tips are now (`drawn`), still stand apart: the moment two of them (or a
 * name and another's point) would touch, the frame places afresh. */
export const PLACE_MS = 100
export function placeOrReuse(prev: { at: number; placed: Map<string, Placement> } | null, now: number, ids: ReadonlySet<string>, fresh: () => Map<string, Placement>, drawn?: (id: string, p: Placement) => { rect: Box; icon: Box } | null, others: readonly Box[] = []): { at: number; placed: Map<string, Placement>; reused: boolean } {
  if (!prev || now - prev.at > PLACE_MS || now < prev.at) return { at: now, placed: fresh(), reused: false }
  const placed = new Map<string, Placement>()
  for (const [id, p] of prev.placed) if (ids.has(id)) placed.set(id, p)
  // `others`: boxes drawn by names outside the layout (the leaving ones, where they are drawn now); a reused name may not touch them either.
  if (drawn && !apart([...placed.values()].map((p) => drawn(p.id, p)), others)) return { at: now, placed: fresh(), reused: false }
  return { at: prev.at, placed, reused: true }
}
/** Whether no two of the drawn boxes touch, no name covers another's point, and none touches one of the `others` (boxes that are
 * not the layout's to move, such as leaving names; those are not checked against each other). */
export function apart(boxes: ReadonlyArray<{ rect: Box; icon: Box } | null>, others: readonly Box[] = []): boolean {
  const bs = boxes.filter((b): b is { rect: Box; icon: Box } => b !== null)
  for (let i = 0; i < bs.length; i++) {
    for (let j = 0; j < bs.length; j++) if (i !== j && (overlaps(bs[i].rect, bs[j].rect) || overlaps(bs[i].rect, bs[j].icon))) return false
    for (const o of others) if (overlaps(bs[i].rect, o)) return false
  }
  return true
}
