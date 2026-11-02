/**
 * Startup device classes (SPEC section 2.5). The class only sets where the quality ladders START and the memory ceiling; the rest-frame controller (not in this change) will measure after startup. The `desktop` row is literally today's behaviour (guarded by scripts/quality-class.test.mts).
 *
 * Deviations from the spec table, each deliberate:
 *  - `tablet` keeps today's 48 tile layers (tileCapacity already gave 48 to every coarse / small / low-memory device); raising it to the
 *    spec's 96 would add memory on devices that have no measured ceiling yet.
 *  - `software` (SwiftShader / llvmpipe) does NOT drop tiles at startup: every headless capture and audit runs on it, and removing
 *    content would change them. Only the ceiling is set.
 *  - An Intel / Mali / Adreno / PowerVR renderer string on a non-touch machine stays `desktop` (it does not lose tiles) but is flagged `integrated: true`.
 *  - `phone-android` takes the same DPR cap of 1.5 as ios (REVIEW-phone-perf S4: the Pixel's 886x1728 canvas at DPR 2 is 1.53 Mpx), and 1.25 close in (`closeDprCap`, quality/dpr.ts).
 * Ceilings are ESTIMATES until the device bisection of SPEC 4.1 gives real ones; they are flagged `est` everywhere they are shown.
 */

export type QualityClass = 'ios' | 'ipad' | 'phone-android' | 'tablet' | 'desktop' | 'software'
export const QUALITY_CLASSES: readonly QualityClass[] = ['ios', 'ipad', 'phone-android', 'tablet', 'desktop', 'software']

export interface Hints {
  ua: string
  platform: string
  maxTouchPoints: number
  coarsePointer: boolean
  /** Short side of the screen in CSS px. */
  shortSide: number
  deviceMemory?: number
  saveData?: boolean
  /** UNMASKED_RENDERER_WEBGL when the extension is there. */
  renderer?: string
}

export interface ClassProfile {
  /** GPU bytes the ledger may hold before allocations are refused / shed. Infinity = none (today's desktop). */
  ceilingBytes: number
  /** The ceiling is a placeholder estimate, to be replaced by a measured one. */
  ceilingEst: boolean
  /** Cap on the canvas device pixel ratio (today: 2 everywhere). */
  dprCap: number
  /** Under `CLOSE_DPR_FROM` camera radii the canvas DPR ramps down to this (phones: the close terminator is the costly frame). Absent = no distance rule. */
  closeDprCap?: number
  /** Cap for the canvas at rest (settled frames); motion frames keep `dprCap`/`closeDprCap` worth of pixels. Omitted: rest and motion share the ratio. */
  restDprCap?: number
  /** Cap for MOTION frames only, applied when the canvas at the full ratio is over `motionDprFromPx` device pixels (quality/dpr.ts motionDprFor); rest frames keep the full ratio. Omitted on every class: `?mdpr=` sets it (rest-to-motion, WP-A). */
  motionDprCap?: number
  /** The pixel count the motion cap applies from. Omitted: MOTION_DPR_FROM_PX (3 Mpx). */
  motionDprFromPx?: number
  /** Resident tile layers before `?tilecache` and MAX_ARRAY_TEXTURE_LAYERS. */
  tiles: number
  /** The JAXA TC detail cache (96 layers + an 18 MB page table) is created. */
  tc: boolean
  /** Heights-only layers the tile cache asks for at least (capacity.ts heightFloor; `?heightcache` overrides). Omitted: the phone-nadir rule alone (142 with a -3 level). */
  heightTiles?: number
  /** TC detail cache layers (capacity.ts tcCapacity; `?tccache` overrides). Omitted: 96. */
  tcTiles?: number
  /** Render-target sizes kept in the TargetCache. */
  targetSets: number
  /** Lunar-module shadow map resolution. */
  lmShadowRes: number
  /** Largest panorama tier (px wide), for chooseTier. */
  panoMax: number
  /** The motion grid the first gesture starts at (post/motionGrid.ts MOTION_STEPS); undefined = main.ts's own pixel-count rule, as before. */
  motionStart?: number
  /** Motion frames take the phone march caps (MoonPass.setMotionCaps) and a 4-level glare chain; rest frames are unchanged. */
  motionCaps?: boolean
  /** The part of a motion frame's GPU time that does not shrink with the grid (post/motionGrid.ts setFixedShare); undefined = 0, the pure pixel-count model. */
  motionFixedShare?: number
  /** Byte cap for the resident site-patch levels (moon/patch/PatchLayer.ts maxResidentBytes); undefined = the layer's own 192 MB default. */
  patchResidentBytes?: number
}

const DESKTOP: ClassProfile = {
  // Full terrain motion is pixel-bound; the historical 0.85 cheap-pass estimate remains available with ?fixedshare=.85 for A/B checks.
  ceilingBytes: Infinity, ceilingEst: false, dprCap: 2, tiles: 128, tc: true, targetSets: 3, lmShadowRes: 2048, panoMax: 16384, motionFixedShare: 0,
  // Heights sized past the Copernicus oblique working set (STALL-DIAG-2026-10-13; the want stays 142, the rest is history, parked: not drawn): +22.5 MiB heights
  // (est.; the shadow cache array is sized from the want, so it does not grow). TC stays 96: a 192-layer TC cost drag-ground 95 to 91 % presented on the
  // rig, measured before parking. The `software` class spreads this profile and gets 256 too.
  // Phone classes keep the old sizes (not measured there).
  heightTiles: 256,
}
const MB = 1048576
export const CLASS_TABLE: Record<QualityClass, ClassProfile> = {
  desktop: DESKTOP,
  software: { ...DESKTOP, ceilingBytes: 1024 * MB, ceilingEst: true, motionFixedShare: 0 },
  tablet: { ceilingBytes: 700 * MB, ceilingEst: true, dprCap: 2, tiles: 48, tc: true, targetSets: 3, lmShadowRes: 2048, panoMax: 8192 },
  'phone-android': { ceilingBytes: 500 * MB, ceilingEst: true, dprCap: 1.5, closeDprCap: 1.25, restDprCap: 2, tiles: 48, tc: false, targetSets: 2, lmShadowRes: 1024, panoMax: 8192, motionStart: 0.35, motionCaps: true },
  // iOS kills the WebKit GPU process at about 870 MB high-water (issue #66). The ledger is a LOWER bound (driver padding, three.js scratch and
  // the canvas's own buffers are not in it). iPhone: 255 MB tracked (roadmap R49, owner decision 2026-10-18), about 29% of the kill line, so
  // the uncounted part has room. An estimate until the device-probe runs give a measured number. TC is off: neither its layer array nor its 18 MB page table is allocated.
  ios: { ceilingBytes: 255 * MB, ceilingEst: true, dprCap: 1.5, tiles: 48, tc: false, targetSets: 2, lmShadowRes: 1024, panoMax: 8192, motionStart: 0.35, motionCaps: true, patchResidentBytes: 48 * MB },
  // R54 (W3-M1): `patchResidentBytes` on ios and ipad is the cap that keeps the A17-pose ledger under the ceiling (quality/enforce.ts patchCapFor, pinned by
  // scripts/memory-enforce.test.mts; estimates). The other classes already fit under the layer's 192 MB default. `?memcap=0` removes both rows.
  // iPad: its own class at the ceiling iOS had before R49 (400 MB, about 46% of the kill line), every other row the same as `ios`. An iPad has more memory
  // than an iPhone, but the WebKit kill line has only been measured on an iPhone, so 400 MB stays an estimate until the iPad is measured.
  ipad: { ceilingBytes: 400 * MB, ceilingEst: true, dprCap: 1.5, tiles: 48, tc: false, targetSets: 2, lmShadowRes: 1024, panoMax: 8192, motionStart: 0.35, motionCaps: true, patchResidentBytes: 136 * MB },
}

export interface Detected { cls: QualityClass; integrated: boolean; forced: boolean; why: string }

const SOFTWARE_RE = /swiftshader|llvmpipe|software|softpipe/i
const INTEGRATED_RE = /intel|mali|adreno|powervr|videocore/i

export function isIos(h: Pick<Hints, 'ua' | 'platform' | 'maxTouchPoints'>): boolean {
  return /iP(hone|ad|od)/.test(h.ua) || (h.platform === 'MacIntel' && h.maxTouchPoints > 1)
}

/** An iPad: the iPad user agent, or iPadOS in desktop mode (a Mac user agent with a touch screen). */
export function isIpad(h: Pick<Hints, 'ua' | 'platform' | 'maxTouchPoints'>): boolean {
  return /iPad/.test(h.ua) || (h.platform === 'MacIntel' && h.maxTouchPoints > 1)
}

/** `?class=` value to a class, or null. */
export function classFromSearch(search: string): QualityClass | null {
  const v = new URLSearchParams(search).get('class')
  return v !== null && (QUALITY_CLASSES as readonly string[]).includes(v) ? (v as QualityClass) : null
}

export function detectClass(h: Hints, forced: QualityClass | null = null): Detected {
  const integrated = !!h.renderer && INTEGRATED_RE.test(h.renderer) && !h.coarsePointer
  if (forced) return { cls: forced, integrated, forced: true, why: 'forced by ?class=' }
  // The renderer string wins: a software rasteriser is software whatever the user agent says.
  if (h.renderer && SOFTWARE_RE.test(h.renderer)) return { cls: 'software', integrated: false, forced: false, why: `renderer ${h.renderer}` }
  // iOS Safari exposes neither deviceMemory nor memory pressure and reports desktop-like limits: it is a class by user agent only.
  if (isIos(h)) return isIpad(h) ? { cls: 'ipad', integrated: false, forced: false, why: 'iPad user agent' } : { cls: 'ios', integrated: false, forced: false, why: 'iOS user agent' }
  const small = h.shortSide < 700
  // Exactly the test tileCapacity used for 48 layers before this class existed.
  if (h.coarsePointer || small || (h.deviceMemory !== undefined && h.deviceMemory <= 4)) {
    return { cls: small ? 'phone-android' : 'tablet', integrated, forced: false, why: h.coarsePointer ? 'coarse pointer' : small ? 'short side under 700' : 'deviceMemory <= 4' }
  }
  return { cls: 'desktop', integrated, forced: false, why: 'default' }
}

/** Reads the hints from the page. */
export function readHints(gl: WebGL2RenderingContext | null): Hints {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  let renderer: string | undefined
  try {
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    if (gl && ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
  } catch { /* the extension is optional */ }
  return {
    ua: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    coarsePointer: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    shortSide: Math.min(screen.width, screen.height),
    deviceMemory: nav.deviceMemory,
    saveData: nav.connection?.saveData,
    renderer,
  }
}

/**
 * How many layers of `perLayerBytes` fit in `headroomBytes`, between `min` and `want`. A phone never allocates its way past its ceiling:
 * the layer count (create-time only: texStorage3D is immutable) is cut to what is left.
 */
export function fitLayers(want: number, min: number, perLayerBytes: number, headroomBytes: number): number {
  if (!Number.isFinite(headroomBytes)) return want
  const fit = Math.floor(Math.max(0, headroomBytes) / perLayerBytes)
  return Math.max(min, Math.min(want, fit))
}

/** The profile for a detected class, with the one hint-dependent row of the spec: a phone-android with >= 8 GB (deviceMemory caps at 8) keeps TC. */
export function profileFor(cls: QualityClass, h: Pick<Hints, 'deviceMemory'>): ClassProfile {
  const base = CLASS_TABLE[cls]
  let p = base
  if (cls === 'phone-android' && h.deviceMemory !== undefined && h.deviceMemory >= 8) p = { ...p, tc: true }
  return p
}

/**
 * The iOS app's overrides on top of the website's ios class. The website keeps main's ios values: none of these was measured
 * in Safari, so they apply to the native shell only.
 * The WebKit GPU-process kill line on iOS is 300 MB: SkyLumi measured it on an iPhone 15, where 14 of 14 kills came at 311 to 384 MB of
 * GPU memory. The ceiling is 0.85 of that line: 300 x 0.85 = 255 MB. The ledger is a
 * LOWER bound (driver padding, three.js scratch and the canvas's own buffers are not in it), so the margin covers what it does not count.
 * An estimate until the owner's iPhone and iPad passes give a measured line. One render size, the compact 4096 panorama tier, a 96 MB patch cap.
 */
export const NATIVE_IOS: Partial<ClassProfile> = {
  ceilingBytes: 255 * MB, closeDprCap: 1.25, targetSets: 1, panoMax: 4096, patchResidentBytes: 96 * MB,
}

/**
 * The native shell's profile. The website gets `profile` back unchanged (the same object) on every class.
 * - phone-android (issue #206): the app never loads the TC detail cache, even with 8 GB of RAM. Measured through the ledger on the Pixel 10 Pro XL in
 *   the Apollo 17 ground view, TC held 35.5 MB (array 17.8 + page table 17.7) of a 376 to 464 MB total at the moment the WebView lost its context;
 *   the view does not use it.
 * - ios and ipad: NATIVE_IOS.
 */
export function shellProfile(cls: QualityClass, profile: ClassProfile, nativeShell: boolean): ClassProfile {
  if (!nativeShell) return profile
  // The native shell does not split iPad from iPhone (R49 splits the website's class only): both get the app overrides, as before the split.
  if (cls === 'ios' || cls === 'ipad') return { ...profile, ...NATIVE_IOS }
  return cls === 'phone-android' && profile.tc ? { ...profile, tc: false } : profile
}
