/**
 * The bottom row's sizes, mirrored from bar.css / touchControls.css / navigator.css (scripts/touch-layout.test.mts checks they agree), and the questions
 * the row asks: does the open touch pad stand in the bar's own row, and how much of the bar must move into More while a flight's slider is in it?
 *
 * The bar row (always the closed bar, whatever the pad does): [prev, list|Return, next] | [Home, Labels, Time, More, controls toggle].
 * The pad is always complete: [look up | down] | [- +] | [stick] (owner decision 2026-10-24, option A: all flight buttons or none, never some in More; the Orbit | Turn
 * switch went on 2026-10-31, and the groups have the bar's thin dividers between them, item E).
 * Where it stands: if the whole closed bar plus the complete pad fits one bar (a 52 rem bar from 1024 px, padFitsRow) the pad is in the bar's row, between the navigator and the icons.
 * Otherwise it has a glass row of its own, attached directly above the bar in the same dock (.bar-padrow), the bar's width, and the bar row is exactly the closed bar.
 * While Return's slot is reserved, the closed row moves items into More when needed; the arrows remain visible.
 * During a flight: [prev, Stop + pause + slider, Return, next] | [icons that fit; the rest are in More]. The duplicate picker button and separator leave the row, and the toggle moves into More.
 * Below 360 px, More itself leaves the flight row temporarily; the pad row, if open, stays where it is.
 */
/** Under this viewport width the row uses the tight sizes, so a 360 to 399 px phone still holds the pad in the row. */
export const TIGHT_VIEWPORT_PX = 400
/** Under this width even the closed row uses 36 px buttons. */
export const SMALL_VIEWPORT_PX = 360
/** The smallest tap target anywhere in the row (Return, pause). */
export const MIN_TARGET_PX = 40
/** What the range of the flight's slider needs (px) beside its pause button and padding. */
export const FLIGHT_RANGE_MIN_PX = 96
/** Under TIGHT_VIEWPORT_PX the range gives up 32 px so Back, pause, Return, next, More and the toggle still fit beside it. */
export const FLIGHT_RANGE_TIGHT_PX = FLIGHT_RANGE_MIN_PX
export const flightRangePx = (_vw: number): number => FLIGHT_RANGE_MIN_PX
/** The slider's own padding (4 px each side). */
export const FLIGHT_SLIDER_PAD_PX = 6
/** `h` is the pad's height (its halves are 2 px less: the surface's border); `capExtra` the width the border adds to a pair of halves. */
export interface RowSizes { btn: number; half: number; h: number; capExtra: number; stick: number; gap: number }
/** The bar's buttons with the row closed: 44 px where there is room, 40 px on a 360 to 399 px phone, 36 px under that. */
export const closedBtn = (vw: number): number => (vw >= TIGHT_VIEWPORT_PX ? 44 : vw >= SMALL_VIEWPORT_PX ? 40 : 36)
/** Return and pause: at least 40 px, and the bar's button size where that is more. */
export const targetPx = (btn: number): number => Math.max(btn, MIN_TARGET_PX)
/** Sizes of the pad standing in the bar's row: the buttons keep their closed size (44 px, 40 px under 400 px) and the pad halves are 40 x 40 px everywhere; under 400 px the stick is 42 px. */
export const rowSizes = (vw: number): RowSizes =>
  vw >= TIGHT_VIEWPORT_PX ? { btn: 44, half: 40, h: 42, capExtra: 2, stick: 48, gap: 6 } : { btn: 40, half: 40, h: 42, capExtra: 2, stick: 42, gap: 4 }
/** The pad has three groups at every width: the tilt pair, the zoom pair (two capsules of two halves) and the stick. */
export const PAD_CAPS = 2
/** The thin dividers between the groups (touchControls.css .tc-sep): one fewer than the groups, each SEP_PX wide; the pad's gap is their space. */
export const PAD_SEPS = PAD_CAPS
export const SEP_PX = 1
/** The pad's items in a row: the capsules, the stick and the dividers; there is one gap fewer than items. */
const PAD_GAPS = PAD_CAPS + 1 + PAD_SEPS - 1
/** The pad: its two capsules (two halves each), the stick, the dividers, and the gaps between. */
export const padWidthPx = (vw: number): number => { const s = rowSizes(vw); return PAD_CAPS * (2 * s.half + s.capExtra) + s.stick + PAD_SEPS * SEP_PX + PAD_GAPS * s.gap }
/** From this viewport width a bar with the pad or a flight in it may grow past 36 rem, so every icon and the open pad stay in ONE row (bar.css: .bar.padrow and .bar.flying in the same media query). */
export const WIDE_VIEWPORT_PX = 1024
/** The bar's widest, in rem: 36 below WIDE_VIEWPORT_PX (phones, tablets: unchanged), 52 from it. */
export const barMaxRem = (vw: number): number => (vw >= WIDE_VIEWPORT_PX ? 52 : 36)
/** The bar's own widest width: barMaxRem, never wider than the viewport less the dock's side padding (at least 8 px, or the safe-area inset). */
export const barMaxPx = (vw: number, rem: number, insetL: number, insetR: number): number =>
  Math.min(barMaxRem(vw) * rem, vw - Math.max(8, insetL) - Math.max(8, insetR))

/** The pad's own row (.bar-padrow): the bar's width. Its halves are 44 px wide and tall at every width (owner 2026-10-31, item E: 44 px targets; two pairs fit from 320 px), the stick 44 (so the row is the bar's 48 px tall, item E; rig 2026-10-31: a 48 px stick made it 52), the groups spread with at least `gap` between them, `inset` px of padding each side (1 under 360 px, 7 from it). */
export interface PadRowSizes { half: number; h: number; stick: number; gap: number; inset: number }
export const padRowSizes = (vw: number): PadRowSizes =>
  vw >= TIGHT_VIEWPORT_PX ? { half: 44, h: 44, stick: 44, gap: 6, inset: 7 } : vw >= SMALL_VIEWPORT_PX ? { half: 44, h: 44, stick: 44, gap: 4, inset: 7 } : { half: 44, h: 44, stick: 44, gap: 2, inset: 1 }
/** What the pad row needs: the complete pad (two capsules, each with the surface's 2 px border), the stick, the dividers, the minimum gaps, the padding and the row's 1 px border each side. */
export const padRowNeedPx = (vw: number): number => { const s = padRowSizes(vw); return PAD_CAPS * (2 * s.half + 2) + s.stick + PAD_SEPS * SEP_PX + PAD_GAPS * s.gap + 2 * s.inset + 2 }
/** The closed row at its fullest: three navigator buttons, the reserved Back slot, and the five icons. */
export const closedNeedPx = (vw: number): number => 8 * closedBtn(vw) + targetPx(closedBtn(vw)) + 5 + 4

/** The flight slider (Stop, pause, padding, a range of at least FLIGHT_RANGE_MIN_PX). */
export const sliderZonePx = (btn: number, range = FLIGHT_RANGE_MIN_PX): number => 2 * targetPx(btn) + FLIGHT_SLIDER_PAD_PX + range
/** The flight row hides the redundant picker and separator: prev, reserved Return and next, Stop + pause + range, and `icons` buttons. */
export const flightNeedPx = (vw: number, icons: number): number => sliderZonePx(closedBtn(vw), flightRangePx(vw)) + 2 * closedBtn(vw) + targetPx(closedBtn(vw)) + icons * closedBtn(vw)
/**
 * How much of the bar moves into More while a flight's slider is in the row: 0 keeps four bar icons, 1 keeps Home and More, 2 keeps More (or none below 360 px).
 */
export const flightCompactLevel = (vw: number, roomPx: number): 0 | 1 | 2 =>
  roomPx >= flightNeedPx(vw, 4) ? 0 : roomPx >= flightNeedPx(vw, 2) ? 1 : roomPx >= flightNeedPx(vw, vw < SMALL_VIEWPORT_PX ? 0 : 1) ? 2 : 2
/** What the one-row case needs: the closed bar at its fullest and the complete pad beside it (the pad has no margin in the row; closedNeedPx keeps a 5 px allowance where the separator was). */
export const rowNeedPx = (vw: number): number => closedNeedPx(vw) + padWidthPx(vw)
/** The same row while a flight's slider is in it, every icon kept: the pad must not move when a flight starts, so the single row has to hold this too. */
export const flightRowNeedPx = (vw: number): number => flightNeedPx(vw, 4) + padWidthPx(vw)
/**
 * True when the whole row (the closed bar exactly as it is, the complete pad, and a flight's slider if one plays) fits ONE bar at this width: the pad stands in the bar's row.
 * Else the pad gets its own row above the bar (the wide-screen case is a 52 rem bar from 1024 px; everything narrower is two rows).
 */
export const padFitsRow = (vw: number, rem: number, insetL: number, insetR: number): boolean =>
  barMaxPx(vw, rem, insetL, insetR) >= Math.max(rowNeedPx(vw), flightRowNeedPx(vw))
/**
 * How much of the bar moves into More (0, 1 or 2, flightCompactLevel): only a flight's slider ever does it. `padInBarRow` is true only on a wide screen where the pad stands in the bar's own row (it then takes its width);
 * with the pad in its own row (or closed) the bar row is exactly the closed bar, so it is the same with the pad open or closed.
 */
export const barCompactLevel = (vw: number, roomPx: number, flying: boolean, padInBarRow: boolean, backReserved = false): 0 | 1 | 2 => {
  const room = roomPx - (padInBarRow ? padWidthPx(vw) : 0)
  if (flying) return flightCompactLevel(vw, room)
  if (!backReserved) return 0
  const btn = closedBtn(vw)
  if (room >= closedNeedPx(vw)) return 0
  return room >= 7 * btn + 9 ? 1 : 2
}
