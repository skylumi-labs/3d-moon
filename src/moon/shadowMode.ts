/**
 * Crater-shadow quality, a RUNTIME switch (one uniform, no recompile).
 *  full: the rest path as shipped: the shadow cache where a layer serves, the full live march elsewhere, four sub-pixel samples along the terminator.
 *  baked: Sun-independent far tables plus 32 near steps; Fast where a table cannot serve.
 *  fast: the cache where it serves; everywhere else the lite single-sample march (stride 4, no edge refine or deep-near loop, cut at 24 deg), at rest too.
 *  off:  no horizon march at all. Day/night lighting (n.l), eclipse and earthshine stay; slopes are still lit, cast shadows are gone.
 * `?shadows=full|baked|fast|off` overrides, for A/B. The quality settings (src/quality) call setShadowMode.
 */
export type ShadowMode = 'full' | 'baked' | 'fast' | 'off'
const MODES: readonly ShadowMode[] = ['full', 'baked', 'fast', 'off']
export const SHADOW_MODE_UNIFORM: Record<ShadowMode, number> = { full: 0, fast: 1, off: 2, baked: 3 }

export function shadowModeFromSearch(search: string): ShadowMode | null {
  try {
    const v = new URLSearchParams(search).get('shadows')
    return MODES.find((m) => m === v) ?? null
  } catch { return null }
}
function fromUrl(): ShadowMode | null {
  try { return shadowModeFromSearch(location.search) } catch { return null }
}
let mode: ShadowMode = fromUrl() ?? 'full'
const listeners = new Set<(m: ShadowMode) => void>()

export function getShadowMode(): ShadowMode { return mode }
/** Sets the mode; an explicit `?shadows=` in the URL stays in force (A/B arms must not be changed by a persisted setting). */
export function setShadowMode(next: ShadowMode): void {
  const forced = fromUrl()
  const m = forced ?? next
  if (!MODES.includes(m) || m === mode) return
  mode = m
  for (const fn of listeners) fn(mode)
}
export function onShadowModeChange(fn: (m: ShadowMode) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn) } }
