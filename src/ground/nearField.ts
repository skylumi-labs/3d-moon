/**
 * `?near=photo` (ON BY DEFAULT since 2026-10-18, owner decision; `?near=off` restores the old ground): a MODELLED near-field ground layer for ground mode at Apollo 17.
 *
 * Two ways to draw it. The default BAKES it (nearBake.ts, NearBakePass.ts): this file's procedural field is drawn once per standing spot into three nested
 * camera-centred textures (about 0.8, 3.1 and 12.5 cm per texel out to about 60 m), and the ground shader reads a texel per march step. `&bake=0` is the first
 * prototype: the same field evaluated per march step in the shader (about 5 to 15 times the cost on near pixels; kept for A/B). The comments below describe the field.
 *
 * What the data gives at eye level is the 25 cm orthoimage (native 27 x 56 cm) and a 1.5 m terrain model (relief under about 3 m
 * removed by its flattening), so within 100 m of a standing camera one screen pixel is 1 to 10 cm and the ground is the photograph
 * magnified 5 to 40 times: blurry, with no relief finer than metres, no rocks, no grain, no self-shadowing. This switch adds, inside
 * about 300 m of the camera (full to NF_R0, gone by NF_R1) and band-limited by pixel footprint (a feature finer than the pixel is dropped):
 *
 * - fractal microrelief, wavelengths 8 m to 3 cm, amplitude as lambda^0.8 above 50 cm and lambda^0.6 below (RMS slope rising toward
 *   small scales; Helfenstein and Shepard's mare roughness is the prior, not a measurement of this site);
 * - small craters on six rotated grids (cells 60 m to 35 cm, NF_CRATERS), diameters 0.12 to 0.45 of the cell with cumulative counts as
 *   D^-2 (the small-crater equilibrium slope), at most about a tenth of the equilibrium density so most of the surface is unpitted;
 *   depth/diameter 0.04 (degraded, most) to 0.2 (fresh, few), irregular outlines, fresh ones with a sharper crest and brighter soil;
 * - rocks from 7 mm to 1.6 m on five rotated grids (NF_ROCKS) on one cumulative law, N(>D) proportional to D^-2.5 (the sub-metre
 *   Surveyor-era slopes; about 0.24 per m^2 above 10 cm and 5e-4 per m^2 above 1 m here (raised 1.6 times in round 2): an estimate in the published range, not a
 *   count at this site), squat faceted blocks partly buried, each with its own albedo (0.9 to 1.8 of the soil);
 * - a regolith grain in the albedo (mottling at 2.5 m, clods at 30 cm, grain at 5 and 1.2 cm);
 * - a narrow opposition surge (Hapke SHOE shape, h = 0.03, B0 = 0.25, normalised at 30 deg phase) on the Sun term of the whole ground pass;
 * - the hit march steps no farther than it can without skipping a modelled rock (budget NF_GSTEPS), the Sun-visibility march is
 *   finer to 90 m and dithered per pixel, so rocks, craters and the relief cast and receive the Sun's shadow like the measured terrain does;
 * - with `&tracks=1`: a pair of rover tracks and a line of boot prints near the module. A MODEL of where such tracks could be, not the
 *   real ones (the LROC photograph shows the real trampled ground; it is not read here).
 *
 * Nothing here is measured: the detail is generated from published statistics, so the HUD says so (NEAR_LABEL) whenever it is on.
 * Within 9 m of the module the detail fades to zero (the pads sit on the measured ground; the descent engine did sweep the ground
 * under it, Clegg et al.). The probe pass (the module's placement, the camera's height) keeps the measured ground.
 *
 * Switch registry (for the debug Switches panel, branch wt7/switches): see NEAR_SWITCHES.
 */

export type NearMode = 'off' | 'photo'

/** The query string the page runs with (the Artifact preview carries it in window.__moonQuery). */
function query(): string {
  if (typeof location === 'undefined') return ''
  return location.search || (typeof window !== 'undefined' ? (window as { __moonQuery?: string }).__moonQuery ?? '' : '')
}

export function parseNear(search: string): NearMode {
  return new URLSearchParams(search).get('near') === 'off' ? 'off' : 'photo'
}
/** `?bake=0` (with near=photo): evaluate the modelled ground per march step in the shader, as the first prototype did (A/B and fallback). Default: baked per standing spot (nearBake.ts). */
export function parseBake(search: string): boolean {
  const p = new URLSearchParams(search)
  return parseNear(search) === 'photo' && p.get('bake') !== '0'
}
/**
 * `?tracks=` is a sub-switch of `?near=photo`: it does nothing alone. Baked (the default), the trampled ground (disturbed darker soil, boot prints, rover tracks)
 * is on unless `tracks=0`, because it costs nothing per frame; with `bake=0` it is the old opt-in `tracks=1`.
 */
export function parseTracks(search: string): boolean {
  const p = new URLSearchParams(search)
  if (parseNear(search) !== 'photo') return false
  return p.get('tracks') === '1' || (parseBake(search) && p.get('tracks') !== '0')
}
/** `?nearlook=film` (with near=photo, default on): a LOOK tweak toward the Apollo 17 Hasselblad frames (contrast about flat sunlit ground, a slightly darker and browner soil). Not a physical claim. `nearlook=0` turns it off. */
export function parseLook(search: string): boolean {
  const p = new URLSearchParams(search)
  return parseNear(search) === 'photo' && p.get('nearlook') !== '0'
}

/** Read once at module load: the shader text is built from these at compile time, like the other ground shader switches. */
export const NEAR: NearMode = parseNear(query())
export const NEAR_BAKED: boolean = parseBake(query())
export const NEAR_TRACKS: boolean = parseTracks(query())
export const NEAR_LOOK: boolean = parseLook(query())

/** For the debug Switches panel: what the query keys mean and what they take. */
export const NEAR_SWITCHES = [
  { key: 'near', values: ['off', 'photo'], default: 'photo', what: 'Ground mode: modelled near-field relief, rocks, craters, grain, trampled ground and opposition surge around the camera, baked once per standing spot (on by default; modelled, not measured). off is the ground without it.' },
  { key: 'bake', values: ['0', '1'], default: '1', what: 'With near=photo: 0 evaluates the modelled ground per march step in the shader (the first prototype, slow) instead of baking it into textures.' },
  { key: 'tracks', values: ['0', '1'], default: '1', what: 'With near=photo: the modelled trampled ground (disturbed darker soil, boot prints, rover tracks), not the real ones. On by default when baked; with bake=0 it needs tracks=1.' },
  { key: 'nearlook', values: ['0', 'film'], default: 'film', what: 'With near=photo: a look tweak toward the Apollo 17 Hasselblad frames (contrast about flat sunlit ground, a darker, browner soil). Not a physical claim. nearlook=0 turns it off.' },
] as const

/** Metres from the camera: full strength to NF_R0, gone beyond NF_R1. */
export const NF_R0 = 100
export const NF_R1 = 300
/** Metres from the module: no modelled detail inside NF_LM0, full beyond NF_LM1. */
export const NF_LM0 = 6
export const NF_LM1 = 9
/** The highest a modelled rock stands over the measured ground (the hit march's step margin). */
export const NF_MAX_M = 0.8
/** The fixed-step march budget with the finer near-field steps (the default march has 384). */
export const NF_GSTEPS = 768

/** The HUD's sentence while the switch is on (a label must not claim more than the data under it supports). */
export const NEAR_LABEL = 'Near ground modelled: within about 60 m of the camera the regolith grain, small craters, rocks and pebbles are generated from published size statistics (prototype, ?near=photo), not photographed or measured at this spot. The far terrain is the data'
/** With `&bake=0` the modelled ground reaches about 300 m. */
export const NEAR_LABEL_DIRECT = NEAR_LABEL.replace('about 60 m', 'about 300 m')
export const TRACKS_LABEL = 'The trampled ground, boot prints and rover tracks are a model of where such marks could be, not the real ones'
export const LOOK_LABEL = 'The ground\'s brightness, contrast and tint are tuned toward the Apollo 17 film frames: a look, not a measurement'

/** Crater classes: grid cell (m), probability of a crater in a cell, grid rotation (rad). Diameters 0.12 to 0.45 of the cell. */
export const NF_CRATERS: ReadonlyArray<readonly [number, number, number]> = [[60, 0.35, 0.3], [20, 0.45, 1.1], [7, 0.55, 2.0], [2.5, 0.65, 2.7], [0.9, 0.7, 0.7], [0.35, 0.6, 1.6]]
/** Rock classes: smallest diameter (m; a class spans a factor of 3), grid cell (m), probability, rotation. Cumulative counts N(>D) fall as D^-2.5 across and within classes. */
export const NF_ROCKS: ReadonlyArray<readonly [number, number, number, number]> = [[0.0067, 0.0632, 0.8, 1.9], [0.02, 0.25, 0.8, 0.4], [0.06, 1.0, 0.8, 1.3], [0.18, 3.95, 0.8, 2.2], [0.54, 15.6, 0.8, 2.9]]

/** Expected rocks per square metre with a diameter of at least D metres (D within the modelled 7 mm to 1.6 m), from the classes above. */
export function rocksPerM2Above(D: number): number {
  let n = 0
  for (const [dmin, cell, prob] of NF_ROCKS) {
    const dmax = 3 * dmin
    if (D >= dmax) continue
    const lo = Math.max(D, dmin)
    // Within a class the cumulative share above lo is (lo^-2.5 - dmax^-2.5) / (dmin^-2.5 - dmax^-2.5).
    n += (prob / (cell * cell)) * (lo ** -2.5 - dmax ** -2.5) / (dmin ** -2.5 - dmax ** -2.5)
  }
  return n
}

const f = (x: number): string => x.toFixed(4)

/** Metres from the module where the trampled-ground layer (prints, tracks, disturbed soil) starts and where it is full: the pads sit on measured ground inside this. */
export const NF_TR0 = 5
export const NF_TR1 = 7.5
/**
 * Where the crew's work areas could be, metres east and north of the module: a flag-like stop, and the routes to it, to a parking place and to a sampling stop.
 * A MODEL of where such marks could be, not the real ones (the LROC photograph shows the real trampled ground; it is not read here).
 */
export const NF_FLAG_AT: readonly [number, number] = [-24, 12]
/** The rover's final parking place: about 158 m from the module at azimuth about 94 deg (ALSJ, photographic estimate, up to 50 m error; LANDING-ASSETS.md). */
export const NF_PARK_AT: readonly [number, number] = [157.6, -11.0]
export const NF_PATHS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[-5, 1], [-10, 4], [-16, 8], [-20, 10.5], [-24, 12]],
  [[-5, -2], [-3, -8], [2, -13], [8, -16]],
  [[-6, 3], [-10, -6], [-16, -14], [-22, -20]],
  [[3, 6], [8, 12], [12, 20]],
]
/** Modelled rover wheel tracks (a pair 1.83 m apart): long gentle arcs round the module, as a rover parked and driven off from here could leave. */
export const NF_ROVER_ARCS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[-60, -38], [-45, -30], [-30, -22], [-16, -14], [-6, -10], [6, -10], [20, -15], [40, -26], [70, -35]],
  [[-50, 34], [-36, 24], [-24, 17], [-14, 13], [-6, 11], [3, 14]],
  [[14, -14], [15, -4], [14, 6], [18, 20], [26, 36], [36, 60]],
  [[96, -24], [120, -17], [142, -12], [157.6, -11]],
  [[157.6, -11], [172, -8], [192, -2]],
]
/** How much darker disturbed soil reads than the undisturbed soil at full disturbance (a look estimate from the Hasselblad frames, not a measurement). */
export const NF_DISTURBED_DARKEN = 0.3

const v2 = (a: readonly [number, number]): string => `vec2(${f(a[0])}, ${f(a[1])})`

/** Shared basics: constants, hashes, noise and the two globals the albedo reads. */
const NEAR_BASE_GLSL = /* glsl */ `
// ---- Near-field ground, ?near=photo (src/ground/nearField.ts). MODELLED, NOT MEASURED: everything below is generated from published statistics.
const float NF_R0 = ${NF_R0.toFixed(1)};
const float NF_R1 = ${NF_R1.toFixed(1)};
const float NF_LM0 = ${NF_LM0.toFixed(1)};
const float NF_LM1 = ${NF_LM1.toFixed(1)};
const float NF_MAX = ${NF_MAX_M.toFixed(2)};
float nfRockB = 1.0;   // set by nfRock: the albedo factor of the rock under the point
float nfFresh = 0.0;   // set by nfRock: the share of a fresh crater's bright floor and rim under the point
float nfLight = 0.0;   // set by nfWheels: the share of a rut's lighter churned edge under the point
// An integer hash of the float's bits (PCG, two rounds): a sin() hash loses its randomness at the 1e5 cells a 2 mm grain needs over a few metres.
float nfHash(vec2 p) {
  uvec2 v = floatBitsToUint(p) * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  return float(v.x >> 8u) * (1.0 / 16777216.0);
}
vec2 nfHash2(vec2 p) {
  uvec2 v = floatBitsToUint(p) * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  return vec2(v >> 8u) * (1.0 / 16777216.0);
}
float nfNoise(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(nfHash(i), nfHash(i + vec2(1.0, 0.0)), f.x), mix(nfHash(i + vec2(0.0, 1.0)), nfHash(i + vec2(1.0, 1.0)), f.x), f.y) * 2.0 - 1.0;
}
mat2 nfRot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
`

/** The step, the opposition surge and the finest grain: shared by the direct and the baked path (the shade pass uses them). */
const NEAR_STEP_GLSL = /* glsl */ `
// Narrow opposition surge (Hapke's SHOE shape, h 0.03, B0 0.25) on top of the fitted phase law, whose exp(-a / 20) already holds the broad
// part; normalised at 30 degrees phase so the brightness elsewhere stays the fitted law's.
float nfSurge(float phaseDeg) {
  float g = phaseDeg * 0.017453292519943295;
  return (1.0 + 0.25 / (1.0 + tan(0.5 * g) / 0.03)) / (1.0 + 0.25 / (1.0 + tan(0.2617994) / 0.03));
}
// The finest albedo grain (1.2 cm, 5 mm, 2 mm), by footprint. The bake holds the 1.2 cm term at the texel's footprint (nfGrainBaked); the shade pass adds
// nfGrainFine(pixel footprint) minus that, so the first metres carry grain finer than a texel and a distant pixel loses the baked grain it cannot resolve.
float nfGrainBaked(vec2 p, float fp) {
  return 0.10 * nfNoise(p / 0.012 + 57.0) * (1.0 - smoothstep(0.003, 0.012, fp));
}
float nfGrainFine(vec2 p, float fp) {
  float g = nfGrainBaked(p, fp)
    + 0.10 * nfNoise(p / 0.005 + 83.0) * (1.0 - smoothstep(0.0012, 0.005, fp))
    + 0.08 * nfNoise(p / 0.002 + 17.0) * (1.0 - smoothstep(0.0005, 0.002, fp));
  // Bright flecks (rock chips, 3 cm and 8 mm) and dark pits between clods: a skewed grain, so the soil reads gritty and not like noise.
  float n3 = nfNoise(p / 0.03 + 9.0), n8 = nfNoise(p / 0.008 + 5.0);
  g += 0.45 * smoothstep(0.55, 0.95, n3) * (1.0 - smoothstep(0.008, 0.03, fp))
     + 0.5 * smoothstep(0.55, 0.95, n8) * (1.0 - smoothstep(0.002, 0.008, fp))
     - 0.3 * smoothstep(0.6, 0.95, -n8) * (1.0 - smoothstep(0.002, 0.008, fp));
  return g;
}
// Slope (rise over run) of three octaves of relief finer than the bake holds (2.4, 1.2 and 0.6 cm wavelength, 3 to 1.3 mm high), by footprint: the shade pass adds it to
// the baked slope, so the first metres are not a magnified texel.
vec2 nfBump(vec2 p, float fp) {
  vec2 s = vec2(0.0);
  float lam = 0.024, amp = 0.003;
  for (int i = 0; i < 3; i++) {
    float k = 1.0 - smoothstep(0.25 * lam, 0.6 * lam, fp);
    if (k <= 0.0) break;
    float e = 0.25 * lam;
    vec2 q = p / lam + float(i) * 13.7;
    float h0 = nfNoise(q);
    s += amp * k * vec2(nfNoise(q + vec2(0.25, 0.0)) - h0, nfNoise(q + vec2(0.0, 0.25)) - h0) / e;
    lam *= 0.5; amp *= 0.65;
  }
  return s;
}
// The hit march's step: the clearance step of before, but inside the near field no farther than the clearance over the highest modelled feature allows
// (floor 4 cm + 1.2 % of the distance), so a ray cannot step over a rock.
float nfStep(float c, float dz, float t) {
  float s = max(c / (0.75 + abs(dz)), 0.012 * t + 0.02);
  float w = 1.0 - smoothstep(NF_R0, NF_R1, t);
  if (w <= 0.0) return s;
  return mix(s, max((c - NF_MAX) / (0.75 + abs(dz)), 0.04 + 0.012 * t), w);
}
`

/** Direct path only: the layer's weight at a ground point by the distance from the camera (the hit ray's origin) and from the module. */
const NEAR_CAM_GLSL = /* glsl */ `
float nfW(vec2 en) {
  return (1.0 - smoothstep(NF_R0, NF_R1, length(en - uGCam.xy))) * smoothstep(NF_LM0, NF_LM1, length(en));
}
`

/**
 * The procedural near field. `baked` (the bake pass of nearBake.ts, evaluated once per texel) lets a crater overlap its grid cell (3 x 3 cells searched), warps
 * the grids, and gives each crater its own outline, rim and tilt, so no stamp repeats; the direct path (`?bake=0`) keeps one crater per cell. `tracks` adds the
 * trampled ground (baked) or the old tracks and prints (direct).
 */
function nearProcGlsl(tracks: boolean, baked: boolean): string {
  const NB = baked
  return /* glsl */ `
// Band-limited fractal microrelief, 8 m to 3 cm, amplitude as lambda^0.8 above 50 cm and lambda^0.6 below (RMS slope rising toward
// small scales, as on mare regolith: clods and lumps);
// an octave finer than about a third of the pixel's footprint is dropped (no aliasing at distance).
float nfRelief(vec2 p, float fpM) {
  float h = 0.0, lam = 8.0, amp = 0.16;
  const mat2 R = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 9; i++) {
    float k = 1.0 - smoothstep(0.25 * lam, 0.6 * lam, fpM);
    if (k <= 0.0) break;
    float n = nfNoise(p / lam);${baked ? `
    // Below half a metre the soil is clods: creased (valleys sharper than ridges) and rougher than the first octaves, so the cm-scale relief casts shadows.
    if (i >= 3) n = mix(n, 1.0 - 2.0 * abs(n), 0.5);` : ''}
    h += amp * k * n;
    p = R * p + vec2(17.3, 9.1);
    lam *= 0.5; amp *= i < 4 ? 0.574 : ${baked ? '0.7' : '0.62'};
  }
  return h;
}
// One crater per lattice cell at most. D from 0.12 to 0.45 of the cell with cumulative counts as D^-2 (the small-crater equilibrium slope);
// depth/diameter 0.04 (degraded, most) to 0.2 (fresh, few); a raised rim that is low on degraded craters. Each crater has its own outline
// (an ellipse with its own axis ratio and angle, +-7 % lumps), rim height (0.5 to 1.5) and a rim that is higher on one side.
float nfCraterAt(vec2 p, vec2 c, float cell, float prob, float seed, float k, inout float fresh) {
  vec2 r = nfHash2(c + seed);
  if (r.x > prob) return 0.0;
  float D = 0.12 * cell * pow(1.0 - nfHash(c + seed + 7.3) * 0.929, -0.5);
  float Rr = 0.5 * D;
  vec2 h3 = nfHash2(c + seed + 3.7);
  vec2 ctr = (c + 0.5 + (h3 - 0.5) * ${NB ? '1.0' : '(1.0 - 3.0 * Rr / cell)'}) * cell;
  vec2 q = p - ctr;
  float ql = length(q);
  if (ql > 1.65 * Rr) return 0.0;
  vec2 dir = ql > 0.0 ? q / ql : vec2(1.0, 0.0);
  float ea = 6.2831853 * nfHash(c + seed + 12.1);
  float el = ${NB ? '0.8 + 0.2 * nfHash(c + seed + 13.3)' : '1.0'};
  vec2 qe = nfRot(ea) * q;
  float d = length(vec2(qe.x, qe.y / el)) / Rr;
  // An irregular outline (+-7 %), so no crater is a perfect circle.
  d *= 1.0 + 0.07 * nfNoise(dir * 1.5 + c * 2.3 + seed);
  if (d > 1.5) return 0.0;
  float dd = mix(0.04, 0.2, r.y * r.y * r.y * r.y);
  float fr = smoothstep(0.1, 0.17, dd);
  fresh = max(fresh, k * fr * (1.0 - smoothstep(0.9, 1.4, d)));
  float depth = dd * D;
  // Fresh: a parabolic bowl with a sharp crest; degraded: (1 - d^2)^2, no crease at the rim.
  float u = d < 1.0 ? 1.0 - d * d : 0.0;
  float bowl = -depth * mix(u * u, u, fr);
  float rimK = ${NB ? '0.5 + nfHash(c + seed + 14.7)' : '1.0'};
  float asym = ${NB ? '1.0 + 0.4 * nfNoise(dir * 1.3 + c * 1.7 + seed + 4.0)' : '1.0'};
  float rim = depth * mix(0.08, 0.3, fr) * rimK * asym * exp(-pow((d - 1.0) / 0.22, 2.0)) * (1.0 - smoothstep(1.2, 1.5, d));
  return bowl + rim;
}
float nfCrater(vec2 p, float cell, float prob, float ang, float seed, float fpM, inout float fresh) {
  float k = 1.0 - smoothstep(0.1 * cell, 0.4 * cell, fpM);
  if (k <= 0.0) return 0.0;${NB ? `
  // The lattice is warped by a slow noise, so the rotated grid does not show as rows of craters.
  p += 0.22 * cell * vec2(nfNoise(p / (3.0 * cell) + seed * 1.7), nfNoise(p / (3.0 * cell) + seed * 2.3 + 11.0));` : ''}
  p = nfRot(ang) * p;
  vec2 c0 = floor(p / cell);
  float h = 0.0;${NB ? `
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) h += nfCraterAt(p, c0 + vec2(float(i), float(j)), cell, prob, seed, k, fresh);` : `
  h = nfCraterAt(p, c0, cell, prob, seed, k, fresh);`}
  return k * h;
}
float nfCraters(vec2 p, float fpM, inout float fresh) {
  return ${NF_CRATERS.map(([cell, prob, ang], i) => `nfCrater(p, ${f(cell)}, ${f(prob)}, ${f(ang)}, ${(i + 1).toFixed(1)}, fpM, fresh)`).join('\n    + ')};
}
// One rock per cell at most, on a rotated grid: D from dmin to 3 dmin with cumulative counts as D^-2.5; a squat, faceted block
// (irregular outline, flattened top, surface facets), partly buried; mask (for the albedo) and the rock's albedo factor (0.75 to 1.5: from darker
// than the soil to a good deal brighter, as the Hasselblad frames show).
float nfRockCell(vec2 p, float dmin, float cell, float prob, float ang, float seed, float fpM, inout float mask) {
  float k = 1.0 - smoothstep(0.4 * dmin, 1.5 * dmin, fpM);
  if (k <= 0.0) return 0.0;
  p = nfRot(ang) * p;
  vec2 c = floor(p / cell);
  vec2 r = nfHash2(c + seed);
  if (r.x > prob) return 0.0;
  float D = dmin * pow(1.0 - r.y * 0.936, -0.4);
  float R = 0.5 * D;
  vec2 ctr = c * cell + 1.4 * R + nfHash2(c + seed + 5.1) * (cell - 2.8 * R);
  vec2 q = p - ctr;
  if (dot(q, q) > 1.6 * R * R) return 0.0;
  q = nfRot(6.2831853 * nfHash(c + seed + 2.2)) * q;
  vec2 ab = vec2(1.0, 0.55 + 0.45 * nfHash(c + seed + 9.9)) * R;
  float rq = length(q);
  vec2 dir = rq > 0.0 ? q / rq : vec2(1.0, 0.0);
  float facet = 1.0 + 0.22 * nfNoise(dir * 1.7 + c * 3.1 + seed);
  vec2 qq = q / (ab * facet);
  float s = 1.0 - dot(qq, qq);
  if (s <= 0.0) return 0.0;
  float hgt = R * (0.6 + 0.35 * nfHash(c + seed + 6.6));
  float bury = 0.1 + 0.4 * nfHash(c + seed + 4.4);
  float z = hgt * (pow(s, 0.4) - bury) + 0.1 * R * nfNoise(q / (0.4 * R) + seed + c);
  if (z <= 0.0) return 0.0;
  float m = k * smoothstep(0.0, 0.04 * R, z);
  if (m > mask) { mask = m; nfRockB = 0.75 + 0.75 * nfHash(c + seed + 8.8); }
  return k * z;
}
float nfRocks(vec2 p, float fpM, inout float mask) {
  return ${NF_ROCKS.map(([dmin, cell, prob, ang], i) => `nfRockCell(p, ${f(dmin)}, ${f(cell)}, ${f(prob)}, ${f(ang)}, ${(11 + i).toFixed(1)}, fpM, mask)`).join('\n    + ')};
}
${tracks && baked ? nearTrampleGlsl() : tracks ? nearTracksGlsl() : 'float nfTracks(vec2 p, float fpM) { return 0.0; }'}
// The rock mask at a point (0 soil, 1 rock); sets nfRockB (that rock's albedo factor) and nfFresh (a fresh crater's bright soil).
float nfRock(vec2 p, float fpM) {
  float m = 0.0, fr = 0.0;
  nfRockB = 1.0;
  nfRocks(p, fpM, m);
  nfCraters(p, fpM, fr);
  nfFresh = fr;
  return m;
}
// Albedo factor: soil mottling at 2.5 m (+-8 %), clods at 30 cm, grain at 5 cm and 1.2 cm (+-8 to 15 %), each fading with the footprint;
// fresh craters' less weathered soil 15 % brighter; rocks at their own factor (call nfRock first).
float nfAlbedo(vec2 p, float fpM, float rock) {
  float g = 0.08 * nfNoise(p / 2.5 + 3.0) * (1.0 - smoothstep(0.6, 2.5, fpM))
    + 0.08 * nfNoise(p / 0.3) * (1.0 - smoothstep(0.08, 0.3, fpM))
    + 0.15 * nfNoise(p / 0.05 + 31.0) * (1.0 - smoothstep(0.012, 0.05, fpM))
    + 0.10 * nfNoise(p / 0.012 + 57.0) * (1.0 - smoothstep(0.003, 0.012, fpM));
  return (1.0 + g) * (1.0 + 0.15 * nfFresh) * mix(1.0, nfRockB, rock);
}
${baked ? `
// One texel of the bake (nearBake.ts): h the modelled height over the measured ground (metres), alb the albedo factor. fp is the texel's band limit.
// Nothing natural within NF_LM1 of the module; the trampled layer starts at ${NF_TR0.toFixed(1)} m (the pads sit on measured ground inside it).
void nfBake(vec2 p, float fp, out float h, out float alb) {
  float fresh = 0.0, mask = 0.0, dark = 0.0, calm = 0.0;
  nfRockB = 1.0;
  nfLight = 0.0;
  float ht = ${tracks ? 'nfTrample(p, fp, dark, calm)' : '0.0'};
  float r = length(p);
  float wN = smoothstep(NF_LM0, NF_LM1, r);
  float wT = smoothstep(${NF_TR0.toFixed(1)}, ${NF_TR1.toFixed(1)}, r);
  float hr = nfRelief(p, fp) * (1.0 - 0.25 * calm);
  float hc = nfCraters(p, fp, fresh) * (1.0 - 0.4 * calm);
  float hk = nfRocks(p, fp, mask);
  nfFresh = fresh;
  h = wN * (hr + hc + hk) + wT * ht;
  alb = mix(1.0, nfAlbedo(p, fp, mask), wN) * (1.0 - ${NF_DISTURBED_DARKEN.toFixed(3)} * dark * wT) * (1.0 + 0.14 * nfLight * wT);
}` : `
// The modelled height over the measured ground at a point (metres), band-limited to the pixel's footprint.
float nfDetail(vec2 p, float fpM) {
  float m = 0.0, fr = 0.0;
  return nfRelief(p, fpM) + nfCraters(p, fpM, fr) + nfRocks(p, fpM, m) + nfTracks(p, fpM);
}`}
`
}

/** The direct path's `&tracks=1`: a pair of rover tracks and a line of boot prints near the module. */
function nearTracksGlsl(): string {
  return /* glsl */ `
// ---- \`&tracks=1\`, direct path: a MODEL of tracks, not the real ones. Two rover tracks (1.83 m apart, 23 cm wide, 3 cm deep, chevron tread) along a line
// 9 m south-west of the module running north-west, and boot prints (33 x 14 cm, 2.5 cm deep, ribbed sole) along a path from the module's west side.
float nfSeg(vec2 p, vec2 a, vec2 b, out float along) {
  vec2 ab = b - a, ap = p - a;
  float t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
  along = t * length(ab);
  return length(ap - ab * t);
}
float nfTracks(vec2 p, float fpM) {
  float k = 1.0 - smoothstep(0.05, 0.3, fpM);
  if (k <= 0.0) return 0.0;
  float h = 0.0;
  // Rover: the line from (-34, 4) to (4, -34) in metres, offset +-0.915 m across.
  vec2 a = vec2(-34.0, 4.0), b = vec2(4.0, -34.0);
  float along;
  float dc = nfSeg(p, a, b, along);
  vec2 dir = normalize(b - a);
  float side = dot(p - a, vec2(-dir.y, dir.x));
  float dw = abs(abs(side) - 0.915);
  if (dw < 0.14 && dc < 60.0) {
    float tread = 0.5 + 0.5 * sin(along * 20.0 + sign(side) * 4.0 * (abs(side) - 0.915));
    h -= k * (0.03 * (1.0 - smoothstep(0.08, 0.14, dw)) + 0.006 * tread * (1.0 - smoothstep(0.10, 0.13, dw)));
  }
  // Boot prints: along the path from (-5, 0) west to (-25, 2), one print every 0.75 m, alternating 0.18 m either side.
  vec2 pa = vec2(-5.0, 0.0), pb = vec2(-25.0, 2.0);
  float al2;
  float d2 = nfSeg(p, pa, pb, al2);
  if (d2 < 0.6) {
    vec2 pd = normalize(pb - pa);
    float n = floor(al2 / 0.75);
    float sideP = dot(p - pa, vec2(-pd.y, pd.x)) - (mod(n, 2.0) < 0.5 ? 0.18 : -0.18);
    float u = al2 - (n + 0.5) * 0.75;
    vec2 q = abs(vec2(u, sideP)) - vec2(0.165, 0.07);
    float box = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    if (box < 0.05) {
      float ribs = 0.5 + 0.5 * sin(u * 60.0);
      h -= k * (0.025 * (1.0 - smoothstep(-0.02, 0.03, box)) + 0.005 * ribs * (1.0 - smoothstep(-0.03, 0.0, box)));
    }
  }
  return h;
}`
}

/**
 * The baked path's trampled ground (`nfTrample`): disturbed soil that reads darker around the module and a flag-like stop, boot prints milling about on a rotated
 * lattice and walked along four routes (two passes each), and three pairs of rover wheel tracks. All a MODEL: where such marks could be, never the real ones.
 * Returns the height (metres, negative into the soil); dark is the disturbance 0..1 (the albedo darkens by NF_DISTURBED_DARKEN at 1), calm the share of natural
 * relief and craters the walking has churned away.
 */
function nearTrampleGlsl(): string {
  const segs: string[] = []
  NF_PATHS.forEach((path, pi) => {
    for (let i = 0; i + 1 < path.length; i++) segs.push(`  h += nfBoots(p, ${v2(path[i])}, ${v2(path[i + 1])}, ${(21 + pi * 7 + i).toFixed(1)}, dark);`)
  })
  NF_ROVER_ARCS.forEach((arc) => {
    let s0 = 0
    for (let i = 0; i + 1 < arc.length; i++) {
      segs.push(`  h += nfWheels(p, ${v2(arc[i])}, ${v2(arc[i + 1])}, ${f(s0)}, dark);`)
      s0 += Math.hypot(arc[i + 1][0] - arc[i][0], arc[i + 1][1] - arc[i][1])
    }
  })
  return /* glsl */ `
// ---- Trampled ground (baked path). A MODEL of where marks could be, not the real ones.
const vec2 NF_FLAG = ${v2(NF_FLAG_AT)};
const vec2 NF_PARK = ${v2(NF_PARK_AT)};
// One boot print in its own frame (x toe-ward, metres): a 33 x 14 cm rounded sole (scaled by sc) pressed 1.5 to 3 cm into the soil with a crisp wall, a deeper
// smooth heel block, chevron bars across the forefoot 3 cm apart, and a low raised lip. It is HEIGHT: the look comes from the shading and the shadows; the
// albedo only darkens a little. smear stretches it along its length (a foot that slid).
float nfBoot(vec2 q, float s, float sc, float smear, inout float dark) {
  q = vec2(q.x / (sc * smear), q.y / sc);
  vec2 d2 = abs(q) - vec2(0.165, 0.07) + 0.03;
  float sd = (length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0) - 0.03) * sc;
  if (sd > 0.06) return 0.0;
  float dep = (0.015 + 0.015 * s) * sc;
  float inside = 1.0 - smoothstep(-0.012, 0.004, sd);
  float heel = 1.0 + 0.4 * (1.0 - smoothstep(-0.13, -0.08, q.x));
  float bar = 0.5 + 0.5 * cos(6.2831853 * (q.x + 0.35 * abs(q.y)) / 0.03);
  float tread = mix(1.0, 0.4 + 0.6 * bar, smoothstep(-0.10, -0.07, q.x));
  float lip = 0.3 * exp(-pow((sd - 0.02) / 0.018, 2.0));
  dark = max(dark, 0.18 * inside);
  return dep * (lip - inside * heel * tread);
}
// Disturbance 0..1 at a point: round the module (an irregular edge about 12 to 34 m out), the flag-like stop and the rover's parking place.
float nfTrampleT(vec2 p) {
  float r = length(p) * (1.0 + 0.3 * nfNoise(p / 14.0 + 5.0));
  float t = 1.0 - smoothstep(12.0, 34.0, r);
  float rf = length(p - NF_FLAG) * (1.0 + 0.3 * nfNoise(p / 6.0 + 9.0));
  t = max(t, 0.8 * (1.0 - smoothstep(1.5, 7.0, rf)));
  float rp = length(p - NF_PARK) * (1.0 + 0.3 * nfNoise(p / 7.0 + 13.0));
  t = max(t, 0.9 * (1.0 - smoothstep(3.0, 18.0, rp)));
  return t * (0.75 + 0.25 * nfNoise(p / 5.0 + 1.0));
}
// Prints milling about: two rotated lattices (0.62 m and 0.93 m cells), a print in a cell with the chance the disturbance gives, any way round, of any size
// between 0.85 and 1.25 of a boot's and sometimes smeared, so they overlap and do not read as a grid.
float nfScatterLattice(vec2 p, float cell, float rot, float seed, float prob, inout float dark) {
  vec2 g = nfRot(rot) * p / cell;
  vec2 c0 = floor(g);
  float h = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = c0 + vec2(float(i), float(j));
    vec2 r = nfHash2(c + seed);
    vec2 ctr = (c + 0.5 + (nfHash2(c + seed + 2.0) - 0.5) * 0.9) * cell;
    if (r.x > prob * nfTrampleT(nfRot(-rot) * ctr)) continue;
    vec2 r3 = nfHash2(c + seed + 6.0);
    vec2 q = nfRot(6.2831853 * r.y) * (g * cell - ctr);
    h += nfBoot(q, nfHash(c + seed + 4.0), 0.85 + 0.4 * r3.x, 1.0 + 0.8 * step(0.75, r3.y) * r3.x, dark);
  }
  return h;
}
float nfScatter(vec2 p, inout float dark) {
  return nfScatterLattice(p, 0.62, 0.7, 41.0, 0.32, dark) + nfScatterLattice(p, 0.93, 1.9, 61.0, 0.22, dark);
}
// Prints walked along a route segment: one every 0.78 m alternating foot, a little off the line and turned, 40 % missing, two passes (the second 0.22 m aside).
float nfBoots(vec2 p, vec2 a, vec2 b, float seed, inout float dark) {
  vec2 ab = b - a;
  float L = length(ab);
  vec2 dir = ab / L;
  float al = dot(p - a, dir), lat = dot(p - a, vec2(-dir.y, dir.x));
  if (al < -0.5 || al > L + 0.5 || abs(lat) > 1.0) return 0.0;
  float n0 = floor(al / 0.78);
  float h = 0.0;
  for (int pss = 0; pss < 2; pss++) {
    for (int i = -1; i <= 1; i++) {
      float n = n0 + float(i);
      vec2 id = vec2(n, seed + float(pss) * 17.0);
      vec2 r = nfHash2(id);
      if (r.x > 0.6) continue;
      float foot = mod(n, 2.0) < 0.5 ? 1.0 : -1.0;
      vec2 ctr = vec2((n + 0.5) * 0.78 + (r.y - 0.5) * 0.15, foot * 0.17 + (pss == 1 ? 0.22 : 0.0) + (nfHash(id + 3.3) - 0.5) * 0.18);
      vec2 q = nfRot((nfHash(id + 7.7) - 0.5) * 1.1) * (vec2(al, lat) - ctr);
      h += nfBoot(q, nfHash(id + 1.9), 0.9 + 0.3 * nfHash(id + 5.5), 1.0, dark);
    }
  }
  return h;
}
// One segment of a rover's wheel tracks: a pair 1.83 m apart, 23 cm wide, 1 to 2 cm deep, chevron tread, a lighter churned edge, s0 the length of the route before it.
float nfWheels(vec2 p, vec2 a, vec2 b, float s0, inout float dark) {
  vec2 ab = b - a;
  float L = length(ab);
  vec2 dir = ab / L;
  float al = dot(p - a, dir), side = dot(p - a, vec2(-dir.y, dir.x));
  if (al < 0.0 || al > L || abs(side) > 1.4) return 0.0;
  float along = s0 + al;
  // The route wanders a little (a rover is steered, not ruled): the pair shifts sideways with the distance along it.
  side += 0.18 * nfNoise(vec2(along * 0.07, 7.0));
  float off = abs(side) - 0.915;
  float dw = abs(off);
  if (dw > 0.22) return 0.0;
  float depth = 0.010 + 0.010 * (0.5 + 0.5 * nfNoise(vec2(along * 0.15, 3.0)));
  // Chevron tread: bars 4.5 cm apart in a V that points along the way.
  float tread = 0.5 + 0.5 * cos(6.2831853 * (along + 0.6 * dw) / 0.045);
  float prof = 1.0 - smoothstep(0.075, 0.115, dw);
  float edge = exp(-pow((dw - 0.14) / 0.035, 2.0));
  dark = max(dark, 0.2 * prof);
  nfLight = max(nfLight, edge);
  return -depth * prof * (0.6 + 0.4 * tread) + 0.5 * depth * edge;
}
// The trampled ground's height, the disturbance (dark) and the churned share (calm) at a point; band-limited to the footprint.
float nfTrample(vec2 p, float fp, out float dark, out float calm) {
  dark = 0.0;
  float T = nfTrampleT(p);
  calm = 0.9 * T;
  float k = 1.0 - smoothstep(0.05, 0.3, fp);
  float h = 0.0;
  if (k > 0.0 && (T > 0.02 || length(p) < 80.0 || length(p - NF_PARK) < 40.0)) {
    h += nfScatter(p, dark);
${segs.join('\n')}
    h *= k;
  }
  dark = max(dark, 0.4 * T);
  return h;
}`
}

/** The direct path's GLSL (needs uGCam; metres east and north of the module): `nfW` the weight, `nfDetail`, `nfRock`, `nfAlbedo`, `nfSurge`, `nfStep`. */
export function nearGlsl(tracks: boolean): string {
  return NEAR_BASE_GLSL + NEAR_CAM_GLSL + nearProcGlsl(tracks, false) + NEAR_STEP_GLSL
}
export const NEAR_GLSL = nearGlsl(NEAR_TRACKS)
/** The bake pass's GLSL (nearBake.ts): the procedural field with the baked-path crater model, `nfBake` and `nfGrainFine`. */
export function nearBakeProcGlsl(tracks: boolean): string {
  return NEAR_BASE_GLSL + nearProcGlsl(tracks, true)
}
/** The baked path's shared part for the ground shader: the basics, the step, the surge (the procedural field is not compiled in). */
export const NEAR_SHADE_BASE_GLSL = NEAR_BASE_GLSL + NEAR_STEP_GLSL
