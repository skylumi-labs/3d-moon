/**
 * GpuLedger: every GPU allocation the page makes, in bytes (SPEC-dynamic-quality-any-device.md, P0).
 *
 * three.js counts texture OBJECTS, not bytes, so each allocation site reports its own size here. The ledger is a LOWER
 * BOUND (driver padding and three.js's own scratch are not in it); the startup ceiling comes from device measurement,
 * not from this sum. No three.js import: this file is pure so its tests run under node.
 */

export type LedgerCategory =
  | 'baked' | 'maps' | 'targets' | 'crossfade' | 'tiles' | 'detail' | 'tc' | 'patch' | 'lm' | 'earth' | 'pano' | 'probe' | 'other'

export const LEDGER_CATEGORIES: readonly LedgerCategory[] = ['baked', 'maps', 'targets', 'crossfade', 'tiles', 'detail', 'tc', 'patch', 'lm', 'earth', 'pano', 'probe', 'other']

/** Bytes of a 2D texture / target level chain. `mips` = full chain (adds 1/3), `layers` for arrays. */
export function textureBytes(w: number, h: number, bytesPerTexel: number, opts: { mips?: boolean; layers?: number } = {}): number {
  const base = w * h * bytesPerTexel * (opts.layers ?? 1)
  return Math.round(opts.mips ? (base * 4) / 3 : base)
}

/** Bytes of an RGBA16F render target pyramid (the scene target's glare levels): the sum of `levels` halvings, down and up. */
export function glarePyramidBytes(w: number, h: number, levels: number, bytesPerTexel: number): number {
  let lw = w, lh = h, sum = 0
  for (let i = 0; i < levels; i++) {
    lw = Math.max(2, lw >> 1)
    lh = Math.max(2, lh >> 1)
    sum += lw * lh * bytesPerTexel
  }
  return sum * 2
}

/**
 * Bytes of one TargetCache set (scene RGBA16F, + moonMetadata only once asked for, +32-bit depth each in ground mode, and the
 * glare pyramid down and up). Matches what `TargetCache.get` reports (scripts/quality-class.test.mts).
 */
export function targetSetBytes(w: number, h: number, opts: { depth?: boolean; glareLevels?: number; metadata?: boolean } = {}): number {
  // RGBA16F colour (8 B) plus the 32-bit depth texture in ground mode. The metadata target is only there once a calibration or audit frame asked for it.
  const perTexel = 8 + (opts.depth ? 4 : 0)
  return Math.round((opts.metadata ? 2 : 1) * w * h * perTexel) + glarePyramidBytes(w, h, opts.glareLevels ?? 7, 8)
}

/** Bytes of the two RGBA8 crossfade attachments (final.ts keeps a scratch and a previous at the last target size). */
export const crossfadeBytes = (w: number, h: number): number => 2 * w * h * 4

export class GpuLedger {
  private readonly lines = new Map<string, { category: LedgerCategory; bytes: number }>()
  private high = 0
  /** The lines at the moment of the high-water mark (copied only when a new high is set): what a device pass reads after a loss. */
  private highLines: Array<{ key: string; bytes: number }> = []
  private readonly listeners = new Set<(total: number) => void>()

  /** Records (or replaces) one allocation under a stable key. Returns the new total. */
  set(category: LedgerCategory, key: string, bytes: number): number {
    if (!(bytes >= 0) || !Number.isFinite(bytes)) throw new Error(`ledger: bad byte count for ${key}: ${bytes}`)
    this.lines.set(`${category}:${key}`, { category, bytes })
    return this.changed()
  }

  /** Removes one allocation (disposed). Unknown keys are ignored. */
  release(category: LedgerCategory, key: string): number {
    this.lines.delete(`${category}:${key}`)
    return this.changed()
  }

  /** Removes every line of a category whose key starts with `prefix` (a streamer's textures, a target set). */
  releasePrefix(category: LedgerCategory, prefix: string): number {
    for (const k of [...this.lines.keys()]) if (k.startsWith(`${category}:${prefix}`)) this.lines.delete(k)
    return this.changed()
  }

  total(): number {
    let s = 0
    for (const l of this.lines.values()) s += l.bytes
    return s
  }

  get highWater(): number { return this.high }

  /** The largest lines held when the high-water mark was set, largest first. */
  highWaterTop(n = 16): Array<{ key: string; bytes: number }> {
    return [...this.highLines].sort((a, b) => b.bytes - a.bytes).slice(0, n)
  }

  byCategory(): Record<LedgerCategory, number> {
    const out = Object.fromEntries(LEDGER_CATEGORIES.map((c) => [c, 0])) as Record<LedgerCategory, number>
    for (const l of this.lines.values()) out[l.category] += l.bytes
    return out
  }

  /** Every line, largest first (the debug readout). */
  entries(): Array<{ key: string; bytes: number }> {
    return [...this.lines.entries()].map(([key, l]) => ({ key, bytes: l.bytes })).sort((a, b) => b.bytes - a.bytes)
  }

  onChange(fn: (total: number) => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** A lost context frees everything the GPU held; the lines go with it (the caller records the value first). */
  clear(): void {
    this.lines.clear()
    this.changed()
  }

  private changed(): number {
    const t = this.total()
    if (t > this.high) {
      this.high = t
      this.highLines = [...this.lines.entries()].map(([key, l]) => ({ key, bytes: l.bytes }))
    }
    for (const fn of this.listeners) fn(t)
    return t
  }
}

/** The page's one ledger. */
export const ledger = new GpuLedger()

export const mb = (bytes: number): string => (bytes / 1048576).toFixed(1)
