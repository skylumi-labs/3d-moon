/**
 * The debug switches that change a tile's decode. The page reads them from its URL; a decode Worker cannot (its `location.search` is the worker
 * script's own URL), so the page sends them with every job (tilePool.ts) and the Worker applies them before decoding (tileJob.ts). A switch added
 * here reaches the Worker with no allow-list to keep in step.
 */
export interface DecodeFlags { decontour: boolean; ewaa: boolean; polarfilter: boolean; destripe: boolean; half: boolean }

export function flagsFromSearch(search: string): DecodeFlags {
  const q = new URLSearchParams(search)
  return { decontour: q.get('decontour') !== '0', ewaa: q.get('ewaa') !== '0', polarfilter: q.get('polarfilter') !== '0', destripe: q.get('destripe') !== '0', half: q.get('half') !== '0' }
}

let current: DecodeFlags = flagsFromSearch(typeof location === 'undefined' ? '' : location.search)

export function decodeFlags(): DecodeFlags { return current }
export function setDecodeFlags(f: DecodeFlags): void { current = f }
