import { resolveDataBase } from '../dataBase'

/**
 * Where the site patches come from (scripts/build-patch.mts writes one per site). Like the
 * tiles they are static files hosted apart from the app, and none is hosted yet. The base holds one
 * directory per site (<base>a11/manifest.json, <base>a17/manifest.json, see src/moon/patch/sites.ts):
 *
 *   ?patch=off      no patches
 *   ?patch=<url>    that base
 *   VITE_MOON_PATCH the build's base (set it when a host exists)
 *   dev server      /moon/patch/, served from $MOON_PATCH_DIR (default ./.patch)
 *   otherwise       '' = no patches, and the site behaves exactly as before
 *
 * A site whose directory is missing is left out of the tours.
 */
export const DEFAULT_PATCH_BASE: string = (import.meta.env?.VITE_MOON_PATCH as string | undefined) ?? (import.meta.env?.DEV ? '/moon/patch/' : '')

export function patchBase(search = location.search): string | null {
  return resolveDataBase('patch', new URLSearchParams(search).get('patch'), DEFAULT_PATCH_BASE)
}

/** The most levels one patch may declare (the shader has this many slots). */
export const MAX_PATCH_LEVELS = 7
/** Patch shader's six always-used fragment units: global colour/height, three tile samplers, and tile bounds. */
export const PATCH_SHADER_FIXED_SAMPLERS = 6
/** Patch levels may use the remaining ten units on the minimum WebGL2 fragment limit of sixteen. */
export const MAX_PATCH_SAMPLERS = 10
/** `extraUnits`: fragment units the shader uses beyond the six fixed ones (the patch shadow cache's atlas is one). */
export function patchSamplerBudget(maxFragmentSamplers: number, extraUnits = 0): number {
  return Math.max(0, Math.min(MAX_PATCH_SAMPLERS - extraUnits, Math.floor(maxFragmentSamplers) - PATCH_SHADER_FIXED_SAMPLERS - extraUnits))
}

/** Optional independently versioned wide-height bridge; legacy fine assets retain their own origin. */
export function midPatchBase(search = location.search): string | null {
  const configured = (import.meta.env?.VITE_MOON_MID_PATCH as string | undefined) ?? (import.meta.env?.DEV ? '/moon/mid-patch/' : '')
  return resolveDataBase('midpatch', new URLSearchParams(search).get('midpatch'), configured)
}
