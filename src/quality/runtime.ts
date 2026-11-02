/**
 * The page's quality system, startup half: the device class, its table, the GPU ledger and the ?debug=1 / ?perfhud=1 readout.
 * main.ts reads `quality.dprCap`, `quality.profile` and `quality.ceilingBytes`. Nothing here changes after startup.
 *
 * Switches: ?dpr=<n> forces the canvas pixel ratio (measurement). ?class=ios|phone-android|tablet|desktop|software forces the startup class (measurement and emulation).
 */
import { dprOverrideFromSearch, restDprFromSearch } from './dpr'
import { ledger, LEDGER_CATEGORIES, mb } from './ledger'
import { describeQuality } from './apply'
import { getQuality } from './settings'
import { resolveSharp, setSharp, type SharpConfig } from './sharp'
import { LOST_CEILING_EXPIRES_KEY, LOST_CEILING_KEY, startCeiling } from './contextRecovery'
import { classFromSearch, detectClass, profileFor, shellProfile, readHints, type ClassProfile, type Detected, type Hints } from './startupClass'

export interface Quality {
  readonly detected: Detected
  readonly hints: Hints
  readonly profile: ClassProfile
  /** The cap on the canvas device pixel ratio (the class table's `dprCap`; 2 on desktop, as before). */
  readonly dprCap: number
  /** The close-in cap (radii rule in dpr.ts) or undefined. */
  readonly closeDprCap: number | undefined
  /** `?restdpr=<n>` (cap for rest frames) or `?restdpr=off`, else the class's `restDprCap`; undefined: rest uses the motion ratio. */
  readonly restDprCap: number | undefined
  /** `?dpr=<n>`: the measurement override, taken verbatim (no cap, no distance rule). */
  readonly dprOverride: number | undefined
  /** `?sharp=1` (quality/sharp.ts): the touch-class sharp-first knobs, or SHARP_OFF. */
  readonly sharp: SharpConfig
  /** GPU bytes the ledger may hold (Infinity on desktop). */
  readonly ceilingBytes: number
  /** What the page actually allocated after the ledger fit (main.ts records the post-fit tile layers here; the chip reads it). */
  readonly allocated: { tiles?: number }
  /** How many WebGL context losses this session has seen. */
  readonly contextLosses: number
  /** How many OS memory warnings this session has had (native shell). The chip reads it: "Memory". */
  readonly memoryWarnings: number
  /** A WebGL context loss lowers the ceiling to 0.7x of what the ledger held, this session only (nothing is stored across visits). */
  contextLost(): void
  /** An OS memory warning (native shell) lowers the ceiling by the same rule as a context loss, without counting as one. */
  memoryWarning(): void
  snapshot(): Record<string, unknown>
}

/** The ceiling after a context loss or a memory warning: 0.7 of what the ledger holds, never above the current ceiling (pure, tested). */
export function lowerCeiling(current: number, allocatedBytes: number): number {
  return Math.min(current, Math.round(allocatedBytes * 0.7))
}

/** `?memcap=0` turns memory-ceiling enforcement (R54) off: the patch cap rows and the overrun shed. */
export const memcapOff = (search: string): boolean => new URLSearchParams(search).get('memcap') === '0'

export function initQuality(init: { gl: WebGL2RenderingContext; search: string; nativeShell?: boolean }): Quality {
  const hints = readHints(init.gl)
  const detected = detectClass(hints, classFromSearch(init.search))
  // ?memcap=0: the class rows as they were before R54 (no patch cap on the website's ios and ipad), applied before the native shell's own overrides.
  const webProfile = profileFor(detected.cls, hints)
  const profile = shellProfile(detected.cls, memcapOff(init.search) ? { ...webProfile, patchResidentBytes: undefined } : webProfile, init.nativeShell === true)
  // A reload that a context loss caused starts at the lowered ceiling (sessionStorage, this tab's session only; see contextRecovery.ts).
  let stored: string | null = null
  let expires: string | null = null
  try { stored = sessionStorage.getItem(LOST_CEILING_KEY); expires = sessionStorage.getItem(LOST_CEILING_EXPIRES_KEY) } catch { /* blocked: start at the class ceiling */ }
  let ceilingBytes = startCeiling(profile.ceilingBytes, stored, expires)
  if (ceilingBytes === profile.ceilingBytes) {
    try { sessionStorage.removeItem(LOST_CEILING_KEY); sessionStorage.removeItem(LOST_CEILING_EXPIRES_KEY) } catch { /* blocked */ }
  }
  let contextLosses = ceilingBytes < profile.ceilingBytes ? 1 : 0
  let memoryWarnings = 0
  const allocated: { tiles?: number } = {}
  // Before the first motionKnobs() call in main.ts: the knobs read this holder.
  const sharp = resolveSharp(detected.cls, init.search, init.nativeShell === true)
  setSharp(sharp)
  return {
    detected, hints, profile, allocated, sharp,
    dprCap: profile.dprCap,
    closeDprCap: profile.closeDprCap,
    restDprCap: restDprFromSearch(init.search, profile.restDprCap),
    dprOverride: dprOverrideFromSearch(init.search),
    get ceilingBytes() { return ceilingBytes },
    get contextLosses() { return contextLosses },
    get memoryWarnings() { return memoryWarnings },
    contextLost: () => {
      contextLosses++
      ceilingBytes = lowerCeiling(ceilingBytes, ledger.total())
    },
    memoryWarning: () => {
      memoryWarnings++
      ceilingBytes = lowerCeiling(ceilingBytes, ledger.total())
    },
    snapshot: () => ({
      sharp, class: detected.cls, why: detected.why, forced: detected.forced, integrated: detected.integrated, hints,
      profile: { ...profile, ceilingBytes: Number.isFinite(profile.ceilingBytes) ? profile.ceilingBytes : null },
      ceilingBytes: Number.isFinite(ceilingBytes) ? ceilingBytes : null, contextLosses, memoryWarnings,
      ledger: { total: ledger.total(), highWater: ledger.highWater, byCategory: ledger.byCategory(), top: ledger.entries().slice(0, 12), highTop: ledger.highWaterTop(16) },
    }),
  }
}

/** ?debug=1 or ?perfhud=1: a corner readout of the class, the ledger total and high-water, and the ledger by category. */
export function mountQualityReadout(root: HTMLElement, q: Quality, visible = true): { setVisible(on: boolean): void; isVisible(): boolean } {
  const el = document.createElement('pre')
  el.id = 'quality-readout'
  el.style.cssText = 'position:absolute;right:14px;top:calc(env(safe-area-inset-top,0px) + 190px);z-index:6;margin:0;pointer-events:none;font:11px/1.35 ui-monospace,Menlo,monospace;color:#cfe3ff;background:rgba(10,12,18,.72);padding:6px 8px;border-radius:8px;max-width:340px;white-space:pre-wrap;text-shadow:none'
  el.hidden = !visible
  root.append(el)
  const tick = (): void => {
    if (el.hidden) return
    const cats = ledger.byCategory()
    const ceil = Number.isFinite(q.ceilingBytes) ? `${mb(q.ceilingBytes)} MB${q.profile.ceilingEst ? ' est' : ''}` : 'none'
    el.textContent = [
      `quality: ${q.detected.cls} (${q.detected.why})`,
      describeQuality(getQuality(), q.detected.cls),
      `GPU ledger ${mb(ledger.total())} MB (peak ${mb(ledger.highWater)}), ceiling ${ceil}`,
      LEDGER_CATEGORIES.filter((k) => cats[k] > 0).map((k) => `${k} ${mb(cats[k])}`).join('  '),
    ].join('\n')
  }
  tick()
  setInterval(tick, 500)
  return { setVisible(on) { el.hidden = !on; if (on) tick() }, isVisible: () => !el.hidden }
}
