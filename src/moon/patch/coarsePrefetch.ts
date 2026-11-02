import type { Moment } from '../../moments'
import type { PatchLevel, PatchManifest } from './PatchLayer'

/**
 * Early, low-priority fetch of a site photograph's COARSE level (R57, TM-11). `prefetchPatch` warms the manifest only, so the coarse raster started
 * downloading once the camera was already demanding it, and the Apollo 17 arrival (which waits for the coarse photograph, up to ARRIVAL_WAIT_MS) held
 * behind that download. Selecting a moment that lands on a patch now starts the first level's two files at low priority; the real load (`fetchPatchAsset`,
 * a plain `fetch`) is then served from the browser's HTTP cache. Bytes only: nothing is decoded, no texture is made, and the level is the single one the
 * layer loads first, never the fine ones (those stay camera-demanded). `?patchpre=0` turns it off. Whether the HTTP cache keeps the bytes depends on the
 * object's cache headers, which a Node test cannot see: the cold-load `patchTrace` on the rig is the measurement.
 */
export function patchPrefetchOn(search: string): boolean { return new URLSearchParams(search).get('patchpre') !== '0' }

/** Upper bound on the raw (inflated) bytes of the one level prefetched; a bigger coarse level is left to the camera's own demand. */
export const COARSE_PREFETCH_MAX_RAW_BYTES = 48 * 1024 * 1024

/** The moment lands on a site patch (its photograph is what the arrival waits for). */
export function momentNeedsPatch(m: Pick<Moment, 'needsPatch'>): string | null { return m.needsPatch ?? null }

/** Raw size of the files a level names: q16/half heights are two bytes per texel, f16x2/f32 four, detail one. */
export function levelRawBytes(lv: Pick<PatchLevel, 'w' | 'h' | 'heights' | 'detail' | 'heightFormat'>): number {
  const heights = lv.heights ? lv.w * lv.h * (lv.heightFormat === 'q16' || !lv.heightFormat ? 2 : 4) : 0
  return heights + (lv.detail ? lv.w * lv.h : 0)
}

/** The urls of the coarse level's files (the first level of the manifest, which is the one the layer loads first), or none when it is too large to prefetch. */
export function coarseLevelUrls(manifest: Pick<PatchManifest, 'levels'>, base: string): string[] {
  const lv = manifest.levels?.[0]
  if (!lv || levelRawBytes(lv) > COARSE_PREFETCH_MAX_RAW_BYTES) return []
  return [lv.heights, lv.detail].filter((f): f is string => !!f).map((f) => `${base}${f}`)
}

export interface CoarsePrefetchDeps {
  fetchImpl: (url: string, init?: RequestInit & { priority?: 'low' | 'high' | 'auto' }) => Promise<{ ok: boolean; json?: () => Promise<unknown>; arrayBuffer?: () => Promise<ArrayBuffer> }>
}

const started = new Set<string>()
/** Forgets what was started (tests). */
export function resetCoarsePrefetch(): void { started.clear() }

/** Starts the fetches once per site base. Never rejects; resolves when they are done. Returns the urls it asked for. */
export async function prefetchPatchCoarse(base: string, deps: CoarsePrefetchDeps): Promise<string[]> {
  if (started.has(base)) return []
  started.add(base)
  try {
    const res = await deps.fetchImpl(`${base}manifest.json`, { priority: 'low' })
    if (!res.ok || !res.json) return []
    const urls = coarseLevelUrls(await res.json() as PatchManifest, base)
    // Read each body to the end: only a completed response is stored by the HTTP cache. The bytes are dropped at once.
    await Promise.all(urls.map((u) => Promise.resolve().then(async () => { const r = await deps.fetchImpl(u, { priority: 'low' }); if (r.ok) await r.arrayBuffer?.() }).catch(() => undefined)))
    return urls
  } catch { started.delete(base); return [] }
}
