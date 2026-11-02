import { resolveDataBase } from '../dataBase'
/**
 * Where the tiles come from. Tiles are static files (DESIGN-M2.md section 5),
 * hosted apart from the app; the owner has not chosen a host yet, so:
 *
 *   ?tiles=off        no tiles (the old 3.58 radius floor, 4k maps only)
 *   ?tiles=<url>      that base (absolute, or a path such as /moon/tiles/)
 *   VITE_MOON_TILES   the build's base (set it when a host exists)
 *   dev server        /moon/tiles/, which vite.config.ts serves from
 *                     $MOON_TILES_DIR (default ./.tiles)
 *   otherwise         '' = no tiles, and the site behaves exactly as in milestone 1
 */
export const DEFAULT_TILE_BASE: string = (import.meta.env?.VITE_MOON_TILES as string | undefined) ?? (import.meta.env?.DEV ? '/moon/tiles/' : '')

export function tileBase(search = location.search): string | null {
  return resolveDataBase('tiles', new URLSearchParams(search).get('tiles'), DEFAULT_TILE_BASE)
}

/**
 * Resident tiles the GPU may hold: a tile is ~1.05 MB (heights R16F 322 px,
 * colour sRGB8_A8 382 px with mips). DESIGN-M2.md section 7: 48 layers (~51 MB)
 * on phones, 128 (~136 MB) on desktops; ?tilecache=N overrides.
 */
export function tileCapacity(maxLayers: number, search = location.search, classTiles?: number): number {
  const q = Number(new URLSearchParams(search).get('tilecache'))
  let n: number
  if (Number.isFinite(q) && q >= 8) n = Math.floor(q)
  else if (classTiles !== undefined) n = classTiles
  else {
    const nav = navigator as Navigator & { deviceMemory?: number }
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    const small = Math.min(screen.width, screen.height) < 700
    n = coarse || small || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) ? 48 : 128
  }
  return Math.max(8, Math.min(n, maxLayers))
}

export { heightCapacity, heightFloor, heightWantCap, tcCapacity, WANTED_AT_FLOOR } from './capacity'
