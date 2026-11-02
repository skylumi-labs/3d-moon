import { NEAR_SHADE_BASE_GLSL, nearBakeProcGlsl } from './nearField'

/**
 * The near field baked once per standing spot (`?near=photo`, default; `&bake=0` evaluates it per march step instead).
 *
 * The procedural field of nearField.ts (microrelief, craters, rocks, grain, the trampled ground) is drawn once into three nested, camera-centred levels of
 * NB_RES x NB_RES texels, each holding the modelled height over the measured ground (R) and the albedo factor (G) as half floats: 12 MiB in all. The
 * ground shader then reads a texel per march step instead of evaluating about 600 ALU of procedural height (nearBakeGlsl). Everything in a level is a
 * pure function of the world position, so a level re-centred on a texel boundary holds the same values as before: nothing shifts when it is redrawn.
 *
 * Levels are 8, 32 and 128 m wide (0.78, 3.1 and 12.5 cm per texel; the sampler reaches 4, 16 and 64 m from the centre). A level is redrawn, centred on the
 * camera, when the camera has moved more than a third of its width from its centre (`needsRebake`). Nothing here is measured; the detail is modelled.
 *
 * This file holds the parts that need no GPU (the geometry, the level choice, the shader text); NearBake.ts draws.
 */

/** Texels per side of every level. */
export const NB_RES = 1024
/** Metres across each level, finest first: a factor of four, so a pixel footprint of one to two texels of a level is one to two of its neighbour's at four times the distance. */
export const NB_EXTENT_M: readonly [number, number, number] = [8, 32, 128]
export const NB_LEVELS = NB_EXTENT_M.length
/** A level is redrawn when the camera has left the middle third of its width. */
export const NB_REBAKE_FRAC = 1 / 3
/** Half floats, two channels (height, albedo factor). */
export const NB_BYTES_PER_TEXEL = 4
/** The texel's band limit as a share of its size: octaves, rocks and grain finer than this are not in the level (the shade pass adds the finest grain itself). */
export const NB_FOOTPRINT = 0.75
/** Where a level fades into the next coarser one: its own border, as a share of its half width (Chebyshev), from NB_EDGE0 (full) to NB_EDGE1 (gone). */
export const NB_EDGE0 = 0.8
export const NB_EDGE1 = 0.97
/** A level is blended out as the pixel footprint grows past NB_FINE0 texels (gone at NB_FINE1): the coarser level takes over before the finer one aliases. */
export const NB_FINE0 = 2
export const NB_FINE1 = 4

export const texelM = (level: number): number => NB_EXTENT_M[level] / NB_RES

/** GPU memory of the three levels, bytes. The budget is 16 MiB. */
export function nearBakeBytes(): number { return NB_LEVELS * NB_RES * NB_RES * NB_BYTES_PER_TEXEL }

/** One level's place: its centre (metres east and north of the module), a multiple of its texel; `valid` once drawn. */
export interface BakeLevel { cx: number; cy: number; valid: boolean }

/** The centre a level takes for a camera at (e, n): the camera's position on the level's texel lattice, so a redraw reproduces the old values. */
export function snapCentre(v: number, level: number): number {
  const t = texelM(level)
  return Math.round(v / t) * t
}

/** The south-west corner of a level centred at (cx, cy): the world position of the lower-left texel's corner. */
export function levelOrigin(cx: number, cy: number, level: number): [number, number] {
  const h = NB_EXTENT_M[level] / 2
  return [cx - h, cy - h]
}

/** True when a level must be drawn: never drawn, or the camera is more than a third of the level's width from its centre (either axis). */
export function needsRebake(l: BakeLevel, camE: number, camN: number, level: number): boolean {
  if (!l.valid) return true
  const lim = NB_EXTENT_M[level] * NB_REBAKE_FRAC
  return Math.abs(camE - l.cx) > lim || Math.abs(camN - l.cy) > lim
}

/** Which levels to draw this frame. First draw: all that are missing, at once. Afterwards at most one per frame (the finest first), so a walk never stalls on three passes. */
export function levelsToBake(levels: readonly BakeLevel[], camE: number, camN: number): number[] {
  const due: number[] = []
  for (let l = 0; l < NB_LEVELS; l++) if (needsRebake(levels[l], camE, camN, l)) due.push(l)
  if (due.length === 0) return due
  if (levels.some((l) => !l.valid)) return due
  return [due[0]]
}

const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/**
 * The weight each level carries at a point and footprint, as the shader's `nfFetch` computes it (the tests pin the twin): the share inside the level (full to
 * 80 % of its half width, gone at 97 %), times, for every level but the coarsest, the fade-out as the footprint passes two texels (gone at four). The sample is
 * mixed coarse to fine, so a level's weight replaces the coarser result by that share.
 */
export function levelWeights(e: number, n: number, fpM: number, levels: readonly BakeLevel[]): number[] {
  const w: number[] = []
  for (let l = 0; l < NB_LEVELS; l++) {
    const lv = levels[l]
    if (!lv.valid) { w.push(0); continue }
    const half = NB_EXTENT_M[l] / 2
    const cheb = Math.max(Math.abs(e - lv.cx), Math.abs(n - lv.cy)) / half
    let a = 1 - smooth(NB_EDGE0, NB_EDGE1, cheb)
    if (l < NB_LEVELS - 1) a *= 1 - smooth(NB_FINE0, NB_FINE1, fpM / texelM(l))
    w.push(a)
  }
  return w
}

/** The finest level with any weight at a point and footprint (-1: none: the base terrain alone). */
export function finestLevel(e: number, n: number, fpM: number, levels: readonly BakeLevel[]): number {
  const w = levelWeights(e, n, fpM, levels)
  for (let l = 0; l < NB_LEVELS; l++) if (w[l] > 0) return l
  return -1
}

/**
 * The bake pass's fragment text (nearBakeFragment): one texel's `nfBake` (height and albedo factor) at a footprint of NB_FOOTPRINT texels, in the module's metre frame.
 */
export function nearBakeFragment(tracks: boolean): string {
  return /* glsl */ `
${nearBakeProcGlsl(tracks)}
uniform vec2 uBakeO;       // the level's south-west corner, metres east and north of the module
uniform float uBakeTexel;  // metres per texel
out vec4 fragColor;
void main() {
  vec2 p = uBakeO + gl_FragCoord.xy * uBakeTexel;   // gl_FragCoord is the texel's centre (i + 0.5)
  float h, a;
  nfBake(p, ${NB_FOOTPRINT.toFixed(2)} * uBakeTexel, h, a);
  fragColor = vec4(h, a, 0.0, 1.0);
}
`
}

/**
 * The ground shader's text for the baked path: the basics (hash, noise, step, surge, grain) and the sampler. `nfFetch(p, fpM)` is (height over the measured ground,
 * albedo factor) at a point, the levels mixed coarse to fine; `nfTexelA` is the texel of the levels it used. Outside every level the height is 0 and the factor 1.
 */
export function nearBakedGlsl(): string {
  const level = (l: number): string => `  {
    vec4 c = uNfC[${l}];
    vec2 uv = (p - c.xy) * c.z;
    vec2 e = abs(uv * 2.0 - 1.0);
    float a = c.z > 0.0 ? 1.0 - smoothstep(${NB_EDGE0.toFixed(2)}, ${NB_EDGE1.toFixed(2)}, max(e.x, e.y)) : 0.0;${l < NB_LEVELS - 1 ? `
    a *= 1.0 - smoothstep(${NB_FINE0.toFixed(1)}, ${NB_FINE1.toFixed(1)}, fp / c.w);` : ''}
    if (a > 0.0) { v = mix(v, textureLod(uNfTex, vec3(uv, ${l}.0), 0.0).rg, a); nfTexelA = mix(nfTexelA, c.w, a); }
  }`
  return `${NEAR_SHADE_BASE_GLSL}
// ---- The baked near field (src/ground/nearBake.ts): ${NB_LEVELS} nested levels of ${NB_RES}^2 texels, R height over the measured ground, G albedo factor.
uniform highp sampler2DArray uNfTex;
uniform vec4 uNfC[${NB_LEVELS}];   // per level: south-west corner east, north (m from the module), 1 / width (0: not drawn yet), texel (m)
float nfTexelA = ${texelM(NB_LEVELS - 1).toFixed(4)};
vec2 nfFetch(vec2 p, float fp) {
  vec2 v = vec2(0.0, 1.0);
  nfTexelA = ${texelM(NB_LEVELS - 1).toFixed(4)};
${Array.from({ length: NB_LEVELS }, (_, i) => level(NB_LEVELS - 1 - i)).join('\n')}
  return v;
}
`
}
