/**
 * Foreground coverage for the display-space Sun (ground mode, a flight's lander).
 *
 * The coverage source is the scene target's depth attachment, which is current every frame at no extra pass: the ground pass writes the hit's depth
 * (gl_FragDepth, 1.0 where the ray found no ground), the lunar module is drawn with depth write, and the target is cleared to the far plane. A
 * pixel with depth < 1 shows terrain or the module, so the Sun's disc and core bloom do not belong there. (The scene target's alpha is no use:
 * the ground pass writes the exposure key into it, not coverage.)
 *
 * Two readers, both in the final pass:
 *  - per pixel, `sunFgCover` (fragment): the bilinear share of the four nearest scene texels that show foreground, which hides the disc and
 *    masks the bloom, veil and rays through the look's own `hide` (sunLook.ts), and keeps sky lift and grain on sky pixels;
 *  - once per frame, `sunFgOpenShare` (vertex, passed flat): the share of the Sun's disc that is not behind foreground, from SUN_COVER_TAPS depth
 *    texels spread evenly over the disc. It multiplies the CPU's open share (the lunar sphere and the Earth), so the glow fades as the Sun sets behind terrain.
 * A Sun outside the frame has no disc to sample: its share is read from the nearest edge texels and blended back to 1 over half a frame past the edge
 * (OFF_FRAME_MARGIN), so a Sun just off screen still fades behind the skyline and a Sun far off screen is left to uSunFade.
 */

/** Depth texels read across the Sun's disc for its open share. */
export const SUN_COVER_TAPS = 16
/** How far past the frame edge (as a share of the frame) the edge-clamped depth read still counts. */
export const OFF_FRAME_MARGIN = 0.5

/** `n` points spread evenly (equal area) over the unit disc, as a sunflower spiral: [x, y] in disc radii. */
export function sunDiscSamples(n: number = SUN_COVER_TAPS): [number, number][] {
  const golden = Math.PI * (3 - Math.sqrt(5))
  const out: [number, number][] = []
  for (let k = 0; k < n; k++) {
    const r = Math.sqrt((k + 0.5) / n), a = k * golden
    out.push([r * Math.cos(a), r * Math.sin(a)])
  }
  return out
}

/** The share of a disc (centre cx, cy; radius) that is open, from `cover(x, y)` in 0..1 sampled at the sunflower points. */
export function discOpenShare(cover: (x: number, y: number) => number, cx = 0, cy = 0, radius = 1, n: number = SUN_COVER_TAPS): number {
  let open = 0
  for (const [x, y] of sunDiscSamples(n)) open += 1 - Math.min(1, Math.max(0, cover(cx + x * radius, cy + y * radius)))
  return open / n
}

/** 1 while the Sun's centre is inside the frame, falling smoothly to 0 `OFF_FRAME_MARGIN` of a frame beyond the edge. `uv` is the Sun's centre, 0..1 across the frame. */
export function onFrameWeight(uvx: number, uvy: number): number {
  const d = Math.max(Math.abs(uvx - 0.5) - 0.5, Math.abs(uvy - 0.5) - 0.5, 0)
  const t = Math.min(1, d / OFF_FRAME_MARGIN)
  return 1 - t * t * (3 - 2 * t)
}

const f = (v: number): string => v.toFixed(5)

/** Vertex-shader text: declares and fills `vFgOpen`, the flat varying the fragment reads. Call `sunFgOpenShare()` from main(). */
export const SUN_COVER_VERTEX_GLSL = /* glsl */ `
uniform sampler2D uSceneDepth;
uniform float uFgOn;          // 1: the scene target's depth is the foreground coverage this frame
uniform vec2 uSunUv;
uniform vec2 uTargetPx;
uniform float uSunDiscPx;     // the Sun's disc radius in scene-target px
flat out float vFgOpen;
const vec2 SUN_TAPS[${SUN_COVER_TAPS}] = vec2[${SUN_COVER_TAPS}](${sunDiscSamples().map(([x, y]) => `vec2(${f(x)}, ${f(y)})`).join(', ')});
float sunFgOpenShare() {
  if (uFgOn < 0.5) return 1.0;
  ivec2 hi = ivec2(uTargetPx) - 1;
  vec2 c = uSunUv * uTargetPx;
  float rad = max(uSunDiscPx, 0.5);
  float open = 0.0;
  for (int i = 0; i < ${SUN_COVER_TAPS}; i++) {
    ivec2 p = clamp(ivec2(floor(c + SUN_TAPS[i] * rad)), ivec2(0), hi);
    open += texelFetch(uSceneDepth, p, 0).r >= 1.0 ? 1.0 : 0.0;
  }
  open /= ${SUN_COVER_TAPS}.0;
  float d = max(max(abs(uSunUv.x - 0.5) - 0.5, abs(uSunUv.y - 0.5) - 0.5), 0.0);
  float t = min(1.0, d / ${f(OFF_FRAME_MARGIN)});
  return mix(open, 1.0, t * t * (3.0 - 2.0 * t));
}
`

/** Fragment-shader text: `sunFgCover(uv)` is 1 on foreground (terrain, the module), 0 on sky. The host declares `uTargetPx`; `uSceneDepth` and `uFgOn` are declared here. */
export const SUN_COVER_FRAGMENT_GLSL = /* glsl */ `
uniform sampler2D uSceneDepth;
uniform float uFgOn;
flat in float vFgOpen;
float sunFgCover(vec2 uv) {
  if (uFgOn < 0.5) return 0.0;
  ivec2 hi = ivec2(uTargetPx) - 1;
  vec2 p = uv * uTargetPx - 0.5;
  vec2 fr = fract(p);
  ivec2 i0 = ivec2(floor(p));
  float c00 = texelFetch(uSceneDepth, clamp(i0, ivec2(0), hi), 0).r < 1.0 ? 1.0 : 0.0;
  float c10 = texelFetch(uSceneDepth, clamp(i0 + ivec2(1, 0), ivec2(0), hi), 0).r < 1.0 ? 1.0 : 0.0;
  float c01 = texelFetch(uSceneDepth, clamp(i0 + ivec2(0, 1), ivec2(0), hi), 0).r < 1.0 ? 1.0 : 0.0;
  float c11 = texelFetch(uSceneDepth, clamp(i0 + ivec2(1, 1), ivec2(0), hi), 0).r < 1.0 ? 1.0 : 0.0;
  return mix(mix(c00, c10, fr.x), mix(c01, c11, fr.x), fr.y);
}
`
