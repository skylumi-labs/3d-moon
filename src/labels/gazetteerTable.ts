/**
 * The full USGS/IAU Gazetteer table (9,080 rows, about 680 kB of JSON) as a lazy chunk. It used to be a static import of three
 * modules and so sat in the entry chunk, parsed before the first frame. Now `loadGazetteer()` fetches it after the first frame
 * (main.ts, startDeferredLoads), and everything that needs the rows (the label search, the close-up names, the centre caption's
 * feature picker, the flight prefetch's feature targets) reads them through `gazetteerTable()`, which is null until it has loaded.
 * The curated labels do not wait for it: they read `curatedGazetteer.json`, the rows they use (scripts/labels.test.mts pins
 * those rows to this table).
 */
export type GazetteerRow = [id: number, name: string, kind: 'mare' | 'crater' | 'range', lon: number, lat: number, sizeKm: number | null, featureType: string]
export interface GazetteerTable { accessed: string; features: GazetteerRow[] }

let table: GazetteerTable | null = null
let pending: Promise<GazetteerTable> | null = null
const listeners = new Set<(t: GazetteerTable) => void>()

/** The loaded table, or null while the chunk has not arrived (callers fall back to what they had before the Gazetteer: sites and curated labels only). */
export const gazetteerTable = (): GazetteerTable | null => table

/** Fetch the table once; every caller shares the promise. A failed fetch is retried by the next call. */
export function loadGazetteer(): Promise<GazetteerTable> {
  if (table) return Promise.resolve(table)
  pending ??= import('./gazetteerFeatures.json').then((m) => {
    table = (m.default ?? m) as unknown as GazetteerTable
    for (const cb of listeners) cb(table)
    return table
  }, (e: unknown) => { pending = null; throw e })
  return pending
}

/** Run `cb` when the table arrives (at once if it already has). */
export function whenGazetteer(cb: (t: GazetteerTable) => void): void {
  if (table) cb(table)
  else listeners.add(cb)
}
