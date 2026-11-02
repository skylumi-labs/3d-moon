/**
 * The visitor's quality settings (the Quality sheet on the bar). One store for the whole page; the lanes that draw read `getQuality()`.
 *
 * - Persisted in localStorage (every access in try/catch: private windows, blocked storage and quota errors leave the defaults).
 * - URL parameters override for an A/B and are never written back: ?quality=auto|high|battery, ?shadows=full|fast|off,
 *   ?detail=full|reduced (a number keeps its older meaning, the detail strength), ?glow=on|off|1|0.
 *   A control the visitor then touches wins over its URL value for the rest of the session.
 * - An explicit choice (a shadows / detail / glow row the visitor set) beats the preset; the preset only fills the rows that were never set.
 * - Auto never turns shadows off, silently or otherwise: only the visitor's own Shadows choice (or the URL) does.
 */
export type QualityPreset = 'auto' | 'high' | 'battery'
export type ShadowMode = 'full' | 'baked' | 'fast' | 'off'
export type DetailMode = 'full' | 'reduced'
/** Motion detail: 'smooth' runs the cheap motion shader while you drag, fly or zoom (V1.1's look in motion); 'classic' keeps the full shader in motion. */
export type MotionMode = 'smooth' | 'classic'
export interface QualitySettings { preset: QualityPreset; shadows: ShadowMode; detail: DetailMode; glow: boolean; motion: MotionMode }

export const PRESETS: readonly QualityPreset[] = ['auto', 'high', 'battery']
export const SHADOW_MODES: readonly ShadowMode[] = ['full', 'baked', 'fast', 'off']
export const DETAIL_MODES: readonly DetailMode[] = ['full', 'reduced']
export const MOTION_MODES: readonly MotionMode[] = ['smooth', 'classic']
export const STORAGE_KEY = 'moon.quality.v1'

/** What each preset sets for the rows the visitor has not chosen. Battery trades some shadow and surface fidelity, never the shadows themselves. */
export const PRESET_DEFAULTS: Record<QualityPreset, Omit<QualitySettings, 'preset'>> = {
  auto: { shadows: 'full', detail: 'full', glow: true, motion: 'smooth' },
  high: { shadows: 'full', detail: 'full', glow: true, motion: 'smooth' },
  battery: { shadows: 'fast', detail: 'reduced', glow: true, motion: 'smooth' },
}

type Explicit = Partial<Omit<QualitySettings, 'preset'>>
interface State { preset: QualityPreset; explicit: Explicit }

const isPreset = (v: unknown): v is QualityPreset => typeof v === 'string' && (PRESETS as readonly string[]).includes(v)
const isShadow = (v: unknown): v is ShadowMode => typeof v === 'string' && (SHADOW_MODES as readonly string[]).includes(v)
// Baked remains an internal renderer mode, but is no longer an offered visitor setting.
const isVisitorShadow = (v: unknown): v is Exclude<ShadowMode, 'baked'> => isShadow(v) && v !== 'baked'
const isMotion = (v: unknown): v is MotionMode => typeof v === 'string' && (MOTION_MODES as readonly string[]).includes(v)
const isDetail = (v: unknown): v is DetailMode => typeof v === 'string' && (DETAIL_MODES as readonly string[]).includes(v)

/** Reads a stored blob; anything malformed is ignored field by field. */
export function parseStored(raw: string | null): State {
  const out: State = { preset: 'auto', explicit: {} }
  if (!raw) return out
  let o: unknown
  try { o = JSON.parse(raw) } catch { return out }
  if (!o || typeof o !== 'object') return out
  const r = o as Record<string, unknown>
  if (isPreset(r.preset)) out.preset = r.preset
  if (isVisitorShadow(r.shadows)) out.explicit.shadows = r.shadows
  if (isDetail(r.detail)) out.explicit.detail = r.detail
  if (typeof r.glow === 'boolean') out.explicit.glow = r.glow
  if (isMotion(r.motion)) out.explicit.motion = r.motion
  return out
}

/** The URL's overrides; a value that is not one of the choices is ignored (so ?detail=0.5 stays the old detail-strength dial). */
export function parseSearch(search: string): { preset?: QualityPreset; explicit: Explicit } {
  const q = new URLSearchParams(search)
  const out: { preset?: QualityPreset; explicit: Explicit } = { explicit: {} }
  const quality = q.get('quality'); if (isPreset(quality)) out.preset = quality
  // `baked` is not a visitor setting or a persisted choice, but remains an internal benchmark URL mode.
  const shadows = q.get('shadows'); if (isShadow(shadows)) out.explicit.shadows = shadows
  const detail = q.get('detail')
  if (isDetail(detail)) out.explicit.detail = detail
  else if (detail !== null && detail.trim() !== '' && Number(detail) === 0) out.explicit.detail = 'reduced' // the older numeric dial: ?detail=0 is no detail
  const glow = q.get('glow')
  if (glow === '1' || glow === 'on') out.explicit.glow = true
  else if (glow === '0' || glow === 'off') out.explicit.glow = false
  // ?phonemotion=0|1 and the older ?motionshader=0|1 both seed the Motion detail row (motionshader wins when both are given).
  for (const name of ['phonemotion', 'motionshader']) {
    const v = q.get(name)
    if (v === '0') out.explicit.motion = 'classic'
    else if (v === '1') out.explicit.motion = 'smooth'
  }
  return out
}

let deviceClass = 'desktop'
let bakedAvailable = false
/** Availability is for the current view; explicit choices always win. No persistence side effect. */
export function setBakedAvailability(cls: string, available: boolean): void {
  getQuality()
  if (deviceClass === cls && bakedAvailable === available) return
  deviceClass = cls; bakedAvailable = available; publish()
}
export function resolve(preset: QualityPreset, explicit: Explicit): QualitySettings {
  const d = PRESET_DEFAULTS[preset]
  // Baked is never a default in this build: the owner picks it from the sheet after comparing (Auto stays Full on desktop and phone).
  return { preset, shadows: explicit.shadows ?? d.shadows, detail: explicit.detail ?? d.detail, glow: explicit.glow ?? d.glow, motion: explicit.motion ?? d.motion }
}

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}
function search(): string {
  try { return typeof location === 'undefined' ? '' : location.search } catch { return '' }
}

let stored: State | null = null
let urlPreset: QualityPreset | undefined
let urlExplicit: Explicit = {}
let current: QualitySettings | null = null
const listeners = new Set<(q: QualitySettings) => void>()

function init(): QualitySettings {
  let raw: string | null = null
  try { raw = storage()?.getItem(STORAGE_KEY) ?? null } catch { raw = null }
  stored = parseStored(raw)
  const u = parseSearch(search())
  urlPreset = u.preset
  urlExplicit = u.explicit
  current = compute()
  return current
}
function compute(): QualitySettings {
  const s = stored ?? { preset: 'auto' as QualityPreset, explicit: {} }
  return resolve(urlPreset ?? s.preset, { ...s.explicit, ...urlExplicit })
}

/** The effective settings now (URL over stored over preset). The same object until something changes, so it is safe in a frame loop. */
export function getQuality(): QualitySettings { return current ?? init() }

/** True when the visitor (or the URL) set this row, so it is not simply following the preset. */
export function isExplicit(key: 'shadows' | 'detail' | 'glow' | 'motion'): boolean {
  getQuality()
  return (stored?.explicit[key] !== undefined) || (urlExplicit[key] !== undefined)
}

/** A control the visitor touched replaces its URL parameter: drop it from the address so a reload does not bring the URL value back. */
const URL_PARAM = { preset: 'quality', shadows: 'shadows', detail: 'detail', glow: 'glow', motion: 'phonemotion' } as const
function dropUrlParam(key: keyof typeof URL_PARAM): void {
  try {
    if (typeof history === 'undefined' || typeof location === 'undefined') return
    const u = new URL(location.href)
    const names: string[] = key === 'motion' ? ['phonemotion', 'motionshader'] : [URL_PARAM[key]]
    if (!names.some((n) => u.searchParams.has(n))) return
    for (const n of names) u.searchParams.delete(n)
    history.replaceState(history.state, '', u)
  } catch { /* no history in this context */ }
}

function persist(): void {
  if (!stored) return
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify({ preset: stored.preset, ...stored.explicit })) } catch { /* storage blocked or full: the choice lasts for this visit */ }
}

function publish(): void {
  const next = compute()
  const prev = current!
  if (next.preset === prev.preset && next.shadows === prev.shadows && next.detail === prev.detail && next.glow === prev.glow && next.motion === prev.motion) return
  current = next
  for (const fn of [...listeners]) { try { fn(next) } catch { /* a listener must not stop the others */ } }
}

/** Changes settings. An invalid value is ignored. A touched control wins over its URL value from here on. */
export function setQuality(patch: Partial<QualitySettings>): void {
  getQuality()
  const s = stored!
  if (patch.preset !== undefined && isPreset(patch.preset)) { s.preset = patch.preset; urlPreset = undefined; dropUrlParam('preset') }
  if (patch.shadows !== undefined && isShadow(patch.shadows)) { s.explicit.shadows = patch.shadows; delete urlExplicit.shadows; dropUrlParam('shadows') }
  if (patch.detail !== undefined && isDetail(patch.detail)) { s.explicit.detail = patch.detail; delete urlExplicit.detail; dropUrlParam('detail') }
  if (patch.motion !== undefined && isMotion(patch.motion)) { s.explicit.motion = patch.motion; delete urlExplicit.motion; dropUrlParam('motion') }
  if (typeof patch.glow === 'boolean') { s.explicit.glow = patch.glow; delete urlExplicit.glow; dropUrlParam('glow') }
  persist()
  publish()
}

/** Forgets the visitor's explicit rows so the preset decides again. */
export function resetQuality(): void {
  getQuality()
  stored = { preset: stored!.preset, explicit: {} }
  urlExplicit = {}
  for (const k of ['shadows', 'detail', 'glow', 'motion'] as const) dropUrlParam(k)
  persist()
  publish()
}

export function onQualityChange(fn: (q: QualitySettings) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Test hook: forget everything held in memory so the next read starts from storage and the URL again. */
export function _resetForTest(): void {
  deviceClass = 'desktop'; bakedAvailable = false; stored = null; current = null; urlPreset = undefined; urlExplicit = {}; listeners.clear()
}
