/**
 * Layers of the heights array. The built levels carry colour and take one layer each of the `colourCap` paired layers; a manifest's deeper
 * levels are heights only (207 KB a layer, against 778 KB with colour) and need many more slots than a 5 degree tile set does. WANTED_AT_FLOOR
 * is what a nadir frame at the camera floor wants per deepest level, measured with `computeWanted` on a 390x844 @3x phone (30 degree field
 * across the short side) over an all-present set within 30 degrees of the equator, nadir and 25 degree pitch, 130 to 400 km (at -3: 104 to
 * 133; the other rows are the same sweep). Capacity is that plus a quarter for the ring around the frame, bounded by the GPU's layer limit
 * (142 at -3: ~29 MB of heights; the 112 includes the anisotropic footprint rule, wanted.ts effectiveFootprintKm, which keeps grazing frames fine to the horizon). Poleward the count grows (tiles narrow in longitude: 222 at 60 degrees), and there the cut
 * (wanted.ts cutWantedSplit) trims the finest wants, never the coarse fallbacks. Without deeper levels the capacity is `colourCap`.
 */
export const WANTED_AT_FLOOR: Readonly<Record<number, number>> = { [-1]: 30, [-2]: 62, [-3]: 112 }
export function heightCapacity(colourCap: number, deepest: number, maxLayers: number, floor = 0): number {
  const wanted = WANTED_AT_FLOOR[Math.max(deepest, -4)] ?? 0
  if (deepest >= 0 || wanted === 0) return colourCap
  return Math.max(colourCap, Math.min(Math.max(Math.ceil(wanted * 5 / 4) + 2, floor), maxLayers))
}

/**
 * Heights layers a device class asks for on top of `heightCapacity`'s phone-nadir rule (its `floor`). A desktop oblique fly view wants far more
 * than a phone at nadir: at the low Copernicus oblique (1.046 radii, pitch 56 degrees) the rig measured ~136 wanted height tiles against 142
 * layers, and every back-and-forth drag evicted and re-uploaded ~490 of them a pass. Heights-only layers
 * cost 207 KB each (R16F 322 px, no mips), so the desktop's 256 cost +114 x 207 KB = +23.6 MB over 142. The shadow cache sizes its array
 * from the want (`heightWant` + SPARE_LAYERS), not from this capacity, so it does not grow with it. The `software` class spreads the desktop profile and gets 256 too. `?heightcache=N` (N >= 8) overrides the
 * class for a same-build A/B: `?heightcache=142` reproduces the old desktop size. Absent class value and switch: 0 (the phone rule alone).
 */
export function heightFloor(search: string, classHeights?: number): number {
  const q = Number(new URLSearchParams(search).get('heightcache'))
  if (Number.isFinite(q) && q >= 8) return Math.floor(q)
  return classHeights ?? 0
}

/** The TC cache before this change and the size every class without its own `tcTiles` keeps (tcDetail.ts TC_CAPACITY re-exports it). */
export const TC_CAPACITY_DEFAULT = 96
/**
 * Layers of the TC (JAXA Terrain Camera) detail cache: `?tccache=N` (N >= 8, a measurement), else the class's `tcTiles`, else 96; bounded by the
 * GPU's layer limit and 254 (the page table stores layer + 1 in a byte). The same Copernicus oblique wanted ~94 TC tiles against 96 and loaded
 * ~627 a warm pass; a TC layer is 382 px R8 with mips, ~195 KB, so 192 layers cost +18.7 MB over 96.
 */
export function tcCapacity(maxLayers: number, search: string, classTc?: number): number {
  const q = Number(new URLSearchParams(search).get('tccache'))
  const n = Number.isFinite(q) && q >= 8 ? Math.floor(q) : (classTc ?? TC_CAPACITY_DEFAULT)
  return Math.max(8, Math.min(n, maxLayers, 254))
}

/**
 * TC tiles a frame may want at once, the rest of the cache being history. The TC want at an oblique fly view has no ceiling below the cache: the
 * Copernicus oblique wanted 94 of 96, 190 of 192 and 252 of 254 (rig 2026-10-13, cut by `keep` at capacity - 2), and every extra slot became one
 * more wanted tile, so loads per warm drag pass rose with the cache (750, 988, 1220) instead of falling. Capping the want at the old 94 keeps the
 * picture exactly as before and leaves the extra layers to hold recently wanted tiles, so a drag that comes back finds them resident.
 * `?tcwant=N` (N >= 8) overrides for an A/B; never more than capacity - 2 (the admission reserve).
 */
export const TC_WANT_DEFAULT = TC_CAPACITY_DEFAULT - 2
export function tcWantCap(capacity: number, search: string): number {
  const q = Number(new URLSearchParams(search).get('tcwant'))
  const n = Number.isFinite(q) && q >= 8 ? Math.floor(q) : TC_WANT_DEFAULT
  return Math.max(1, Math.min(n, capacity - 2))
}

/**
 * Height layers a frame may want (the `heightCap` of wanted.ts cutWantedSplit), the rest of the array being history. Same reasoning as the TC
 * want: with the want left at the whole 256-layer array the Copernicus oblique wanted 98 instead of 76 level -3 tiles, drew finer ground and cost
 * more GPU per frame (rig 2026-10-13: GPU fence p50 terminator-grazing 8.6 to 12.8 ms, terminator-zoom 14.4 to 18.3 ms; drag-ground presented
 * 95 to 92 %). Capping the want at the phone-nadir rule (`ruleCap`, 142 with a -3 level) bounds what is FETCHED; it draws what main draws only if the extra
 * layers are also not drawn, so a slot that leaves the want is parked (`parkingOn`): page entry cleared, layer and data kept, and a drag that comes back
 * finds the tiles resident and re-pages them with no upload. Without parking (`?park=0`) the history stays paged and the shader draws it. `?heightwant=N` (N >= 8) overrides for an A/B; bounded by the array.
 */
export function heightWantCap(search: string, ruleCap: number, heightCap: number): number {
  const q = Number(new URLSearchParams(search).get('heightwant'))
  const n = Number.isFinite(q) && q >= 8 ? Math.floor(q) : ruleCap
  return Math.max(1, Math.min(n, heightCap))
}

/**
 * Whether a cache parks the slots that leave its wanted set (TileStreamer.park, TcStreamer.park): page entry cleared, layer and data kept, so the extra
 * layers past the want are history that is not drawn, and a later want pages them again with the arrival fade (no fetch, decode or upload). Only a cache
 * with history to hold parks (`wantCap` under what its array could want): a phone, whose want is its whole array, behaves exactly as before. `?park=0`
 * (`switchOn` false) restores the first behaviour, where history stays paged and drawn, for a same-build A/B.
 */
/** A slot is parked only after it has been unwanted this long (ms): a zoom oscillating across a level threshold must not pop or re-fade a band on every reversal. */
export const PARK_MS = 1000
/** `?parkms=N` (0..5000, whole ms) overrides PARK_MS for a same-build A/B; anything else keeps the default. */
export function parkMsOf(search: string): number {
  const raw = new URLSearchParams(search).get('parkms')
  if (raw === null || raw.trim() === '') return PARK_MS
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 && n <= 5000 ? n : PARK_MS
}

/**
 * One cancellable wake for the next parking deadline. Rendering is dirty-gated, so a settled view would never run `update` again and tiles that went
 * unwanted would stay paged past their deadline; the streamer calls `schedule` each update with the earliest deadline (frame time, -1 for none) and
 * the callback marks the view dirty. `setTimeout` is looked up at call time (a test swaps it).
 */
export class ParkWake {
  private timer: ReturnType<typeof setTimeout> | null = null
  private due = -1
  /** Suspended (context lost, disposed): nothing is scheduled and a callback already queued does nothing. */
  private off = false
  schedule(nextDue: number, now: number, wake: () => void): void {
    if (this.off) return
    if (nextDue < 0) { this.cancel(); return }
    if (this.timer !== null && this.due === nextDue) return
    this.cancel()
    this.due = nextDue
    this.timer = setTimeout(() => { this.timer = null; this.due = -1; if (!this.off) wake() }, Math.max(0, nextDue - now) + 1)
  }
  /** Cancels the pending wake for good: later `schedule` calls are ignored. */
  suspend(): void { this.off = true; this.cancel() }
  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null; this.due = -1
  }
}

export function parkingOn(switchOn: boolean, wantCap: number, arrayWant: number): boolean {
  return switchOn && wantCap < arrayWant
}
