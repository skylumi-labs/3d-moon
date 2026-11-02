import { smoothstep } from '../camera/tween'

type V = { x: number; y: number; z: number }

/**
 * How much of the hover highlight to draw (0 to 1): all of it while the area is small in the frame, fading out as its radius
 * passes 45 % of the frame's narrower half-extent and gone at 90 %, so a close view of a crater is never washed gold (owner, 2026-10-17).
 * A sea lights its own lava, not a disc, and is the point of the hover at the zooms that show it: its glow stays until its radius
 * is 1.2 narrow half-extents and is gone at 2.4 (inside the sea, where every pixel would be gold).
 * `centre` is Moon-fixed (unit sphere), the camera is in the world frame; the Moon's axes in the world frame turn one into the other.
 */
export function highlightFit(centre: readonly [number, number, number], r: number, camPos: V, tanHalf: number, axes: { moonX: V; moonY: V; moonZ: V }, sea = false, aspect = 1): number {
  const [a, b, c] = centre, { moonX: mx, moonY: my, moonZ: mz } = axes
  const d = Math.hypot(camPos.x - (mx.x * a + my.x * b + mz.x * c), camPos.y - (mx.y * a + my.y * b + mz.y * c), camPos.z - (mx.z * a + my.z * b + mz.z * c))
  const tanNarrow = tanHalf * Math.min(1, aspect > 0 ? aspect : 1)
  const fill = r / Math.max(1e-6, d * tanNarrow)
  const from = sea ? 1.2 : 0.45
  return 1 - smoothstep((fill - from) / from)
}

/**
 * The hover highlight's gold wash, as the Moon pass draws it (moonShader.ts, the `uHlOn` block; `?hlwash=legacy` keeps the 2026-10-17 form).
 * The shape is unchanged: a lift of HL_LIFT inside the area, and a wash of HL_WASH_WHITE of the exposure's white weighted by the disc's interior
 * (HL_FILL) and its rim (HL_RIM). What changed (owner, 2026-10-23, Korolev at night: "a big yellow blob ... should never happen"): the wash used to
 * be the same share of white whatever the ground's own light, so an unlit far-side crater was a flat opaque tan disc. Now the wash follows the
 * ground's luminance `lum` (in units of white): nothing under HL_WASH_LUM_ZERO, the full wash from HL_WASH_LUM_FULL, linear between, so sunlit
 * ground (0.3 to 1 white) is drawn exactly as before and unlit ground gets no interior wash at all. The rim alone keeps a thin floor of
 * HL_RIM_DARK_WHITE of white on dark ground, so the area still reads as an outline. The exposure key is forced to the short exposure by the same
 * radiance-weighted share (`key`), so an unlit interior is left on its long exposure (earthshine, the night floor) instead of going black.
 * `highlightWashProp` is the GLSL twin's `hlWashProp` (HIGHLIGHT_WASH_GLSL); scripts/highlight-fit.test.mts compares the text and the values.
 */
export const HL_WASH_WHITE = 0.16
export const HL_LIFT = 0.25
export const HL_FILL = 0.5
export const HL_RIM = 0.65
export const HL_WASH_LUM_ZERO = 0.005
export const HL_WASH_LUM_FULL = 0.12
export const HL_RIM_DARK_WHITE = 0.04
/** The rim's wash share on black ground: HL_RIM_DARK_WHITE of white out of the rim's full HL_WASH_WHITE * HL_RIM. */
export const HL_RIM_DARK_PROP = HL_RIM_DARK_WHITE / (HL_WASH_WHITE * HL_RIM)
/** The rim's half-width is never more than this many output pixels (a close crater's rim was a broad band). */
export const HL_RIM_MAX_PX = 3

/** The share of the full wash the ground's luminance (in units of white) earns: 0 under HL_WASH_LUM_ZERO, 1 from HL_WASH_LUM_FULL. */
export function highlightWashProp(lum: number): number {
  return Math.max(0, Math.min(1, (lum - HL_WASH_LUM_ZERO) / (HL_WASH_LUM_FULL - HL_WASH_LUM_ZERO)))
}

/**
 * The wash of one pixel: `lum` its ground luminance (I/F), `white` the exposure's white (I/F), `fill` the disc interior's weight and `rim`
 * the rim's (0 to 1 each, the shader's smoothsteps), `on` the highlight's strength. Returns the multiplier on the ground (`lift`), the additive
 * gold in I/F (`add`), and the share by which the pixel is moved to the short exposure (`key`).
 */
export function highlightWash(lum: number, white: number, fill: number, rim: number, on = 1): { lift: number; add: number; key: number } {
  const ha = Math.max(0, Math.min(1, HL_FILL * fill + HL_RIM * rim)) * on
  const prop = highlightWashProp(lum / Math.max(white, 1e-9))
  const haRad = Math.max(0, Math.min(1, HL_FILL * fill * prop + HL_RIM * rim * Math.max(prop, HL_RIM_DARK_PROP))) * on
  return { lift: 1 + HL_LIFT * ha, add: HL_WASH_WHITE * white * haRad, key: haRad }
}

/** The GLSL twin of highlightWashProp (same maths; keep the two in step, scripts/highlight-fit.test.mts compares their text and values). */
export const HIGHLIGHT_WASH_GLSL = /* glsl */ `
// The hover wash's share of its full value for ground at lum of the exposure's white (src/labels/highlightFit.ts highlightWashProp).
float hlWashProp(float lum) { return clamp((lum - ${HL_WASH_LUM_ZERO.toFixed(3)}) / ${(HL_WASH_LUM_FULL - HL_WASH_LUM_ZERO).toFixed(3)}, 0.0, 1.0); }
`
