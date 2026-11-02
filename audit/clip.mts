// Clipping measure for the Moon-disc frames: the share of LIT pixels (any channel above LIT_MIN) that sit at white (every channel above CLIP_MIN).
export const LIT_MIN = 40
export const CLIP_MIN = 245
/** Frames of a Moon view may clip at most this share of their lit pixels (a bright limb and a few specular craters, not a disc). */
export const MAX_CLIPPED_LIT_SHARE = 0.03
export function clippedLitShare(rgba: Uint8Array | Uint8ClampedArray, channels = 4): { lit: number; clipped: number; share: number } {
  let lit = 0, clipped = 0
  for (let i = 0; i < rgba.length; i += channels) {
    const mx = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]), mn = Math.min(rgba[i], rgba[i + 1], rgba[i + 2])
    if (mx > LIT_MIN) { lit++; if (mn >= CLIP_MIN) clipped++ }
  }
  return { lit, clipped, share: lit ? clipped / lit : 0 }
}
