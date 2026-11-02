/**
 * Stage-2 reconstruction choice for the magnified frame (post/final.ts sceneRead). The default kernel is bilinear plus an edge-aware limb rule and an
 * anti-sparkle blend tuned for magnification of 3 and more; at 1.4 to 2.5 (a ?sharp=1 flight at grid 0.5 to 0.7) that shows stair-steps.
 * Catmull-Rom (five bilinear fetches) with a light sharpen is the alternative: `?upscale=bilinear|catmull`, catmull by default only under ?sharp=1.
 */
export type UpscaleMode = 'bilinear' | 'catmull'
/** Catmull-Rom is used at or under this magnification (canvas px per render px); above it the anti-sparkle kernel is the better tool. */
export const CATMULL_MAX_MAG = 2.5
/** Under this the frame is not magnified at all. */
export const CATMULL_MIN_MAG = 1.02
/** Unsharp amount (shader constant mirrors it), masked off where the scene alpha is not opaque (limb, stars). */
export const CATMULL_SHARPEN = 0.25

export function upscaleMode(search: string, sharpOn: boolean): UpscaleMode {
  const v = new URLSearchParams(search).get('upscale')
  return v === 'bilinear' || v === 'catmull' ? v : sharpOn ? 'catmull' : 'bilinear'
}

/** 1 when the Catmull-Rom stage applies at this magnification, else 0. */
export function catmullOn(mode: UpscaleMode, magnification: number): 0 | 1 {
  return mode === 'catmull' && magnification >= CATMULL_MIN_MAG && magnification <= CATMULL_MAX_MAG ? 1 : 0
}
