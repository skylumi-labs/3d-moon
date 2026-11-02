/**
 * The device-class key and quality tier (R5, wave-1 slice): `T0`..`T4`, the GPU family and `<device>_<family>_<tier>`.
 *
 * This is a COPY of the SkyLumi app's `src/lib/qualityTier.ts` table (with the `deviceTier.ts` rule inlined), so the two repos bucket a device
 * the same way in telemetry. `scripts/device-class-key.test.mts` holds the same rows as the app's `qualityTier.test.ts`; both assert the
 * same row hash, so changing one table without the other fails a test. Pure functions: nothing reads the page, no consumer calls it yet,
 * and `?class=` (startupClass.ts) is unchanged. Do not read a `?tier=` here: `tier` is already the Apollo 17 layer switch in this viewer.
 *
 * The table, in order:
 *  - `gpuFamily` from the unmasked renderer string (a software rasteriser wins; no string is `other`).
 *  - swiftshader -> T0, final.
 *  - base: desktop apple/nvidia/amd T4, other desktop T3; tablet apple T3, other T2; phone apple T2, other T1.
 *  - +1 for a non-desktop non-apple device with deviceMemory >= 8 and hardwareConcurrency >= 8 (flagship).
 *  - -1 for deviceMemory <= 2 or hardwareConcurrency <= 2; -1 for saveData or a slow-2g / 2g connection; -1 per context loss (at most -2).
 *  - floor T1 for a real GPU. Unknown inputs never demote. `charging === false` is reported as `onBattery` and does not move the tier.
 *
 * Device tier (copy of the app's deviceTier.ts): iOS-like first (short side >= 600 CSS px is a tablet, below a phone), then a coarse
 * pointer by the same threshold, then a fine pointer is a desktop.
 *
 * Mapping the Moon's `startupClass` rows to the key is at the bottom (`keyForStartupClass`). It is a different question from the class:
 * the class sets where the quality ladders start (a low-memory laptop is `tablet` there) while the key buckets the hardware (that laptop is
 * `desktop_intel_*`). The mapping therefore takes the class's own device kind and leaves the class itself alone.
 */

import type { Hints, QualityClass } from './startupClass.ts'

export type DeviceKind = 'phone' | 'tablet' | 'desktop'
export type QualityTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4'
export const QUALITY_TIERS: readonly QualityTier[] = ['T0', 'T1', 'T2', 'T3', 'T4']
export type GpuFamily = 'apple' | 'adreno' | 'mali' | 'powervr' | 'intel' | 'nvidia' | 'amd' | 'swiftshader' | 'other'
export const GPU_FAMILIES: readonly GpuFamily[] = ['apple', 'adreno', 'mali', 'powervr', 'intel', 'nvidia', 'amd', 'swiftshader', 'other']

/** Short side, in CSS px, at or above which a touch device is a tablet. */
export const TABLET_MIN_SHORT_SIDE_CSS_PX = 600

export interface TierInputs {
  /** iPhone/iPad/iPod UA, or the iPadOS `MacIntel` + `maxTouchPoints > 1` tell. */
  readonly isIosLike: boolean
  /** `matchMedia('(pointer: coarse)')`. */
  readonly coarsePointer: boolean
  /** `min(innerWidth, innerHeight)` in CSS px; 0 when there is no viewport. */
  readonly shortSideCssPx: number
  readonly deviceMemory?: number
  readonly renderer?: string
  readonly hardwareConcurrency?: number
  readonly saveData?: boolean
  readonly effectiveType?: string
  readonly charging?: boolean
  readonly contextLosses?: number
}

export interface TierResult {
  readonly deviceTier: DeviceKind
  readonly gpuFamily: GpuFamily
  readonly tier: QualityTier
  readonly deviceClassKey: string
  readonly onBattery: boolean
}

export function resolveDeviceKind(inputs: Pick<TierInputs, 'isIosLike' | 'coarsePointer' | 'shortSideCssPx'>): DeviceKind {
  const large = Number.isFinite(inputs.shortSideCssPx) && inputs.shortSideCssPx >= TABLET_MIN_SHORT_SIDE_CSS_PX
  if (inputs.isIosLike) return large ? 'tablet' : 'phone'
  if (inputs.coarsePointer) return large ? 'tablet' : 'phone'
  return 'desktop'
}

const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|software/i

export function gpuFamilyFromRenderer(renderer: string | null | undefined): GpuFamily {
  if (!renderer) return 'other'
  if (SOFTWARE_RE.test(renderer)) return 'swiftshader'
  if (/\bapple\b/i.test(renderer)) return 'apple'
  if (/adreno/i.test(renderer)) return 'adreno'
  if (/\bmali\b/i.test(renderer)) return 'mali'
  if (/powervr|\bpvr\b/i.test(renderer)) return 'powervr'
  if (/\bintel\b/i.test(renderer)) return 'intel'
  if (/nvidia|geforce|\bgtx\b|\brtx\b|quadro/i.test(renderer)) return 'nvidia'
  if (/\bamd\b|radeon/i.test(renderer)) return 'amd'
  return 'other'
}

function baseTier(device: DeviceKind, family: GpuFamily): number {
  if (device === 'desktop') return family === 'apple' || family === 'nvidia' || family === 'amd' ? 4 : 3
  if (device === 'tablet') return family === 'apple' ? 3 : 2
  return family === 'apple' ? 2 : 1
}

const atMost = (v: number | undefined, limit: number): boolean => typeof v === 'number' && Number.isFinite(v) && v <= limit
const atLeast = (v: number | undefined, limit: number): boolean => typeof v === 'number' && Number.isFinite(v) && v >= limit

export function resolveQualityTier(inputs: TierInputs): TierResult {
  const deviceTier = resolveDeviceKind(inputs)
  const gpuFamily = gpuFamilyFromRenderer(inputs.renderer)
  let level: number
  if (gpuFamily === 'swiftshader') {
    level = 0
  } else {
    level = baseTier(deviceTier, gpuFamily)
    if (deviceTier !== 'desktop' && gpuFamily !== 'apple' && atLeast(inputs.deviceMemory, 8) && atLeast(inputs.hardwareConcurrency, 8)) level += 1
    if (atMost(inputs.deviceMemory, 2) || atMost(inputs.hardwareConcurrency, 2)) level -= 1
    if (inputs.saveData === true || inputs.effectiveType === 'slow-2g' || inputs.effectiveType === '2g') level -= 1
    const losses = typeof inputs.contextLosses === 'number' && Number.isFinite(inputs.contextLosses) ? Math.min(2, Math.max(0, Math.floor(inputs.contextLosses))) : 0
    level -= losses
    level = Math.max(1, Math.min(4, level))
  }
  const tier = QUALITY_TIERS[level]
  return { deviceTier, gpuFamily, tier, deviceClassKey: `${deviceTier}_${gpuFamily}_${tier.toLowerCase()}`, onBattery: inputs.charging === false }
}

export function deviceClassKey(inputs: TierInputs): string {
  return resolveQualityTier(inputs).deviceClassKey
}

// ---- Moon only: the startupClass rows (quality/startupClass.ts) to the key. Not part of the shared table.

/** The device kind each startup class stands for. `ios` is a phone or a tablet by its short side, so it has no fixed kind. */
export const CLASS_DEVICE_KIND: Readonly<Record<QualityClass, DeviceKind | null>> = {
  ios: null,
  ipad: 'tablet',
  'phone-android': 'phone',
  tablet: 'tablet',
  desktop: 'desktop',
  software: 'desktop',
}

/**
 * The key for a detected startup class and the hints it came from. The class decides the device kind (so a forced `?class=` shows in the
 * key); ios falls back to the app's short-side rule. `software` carries the swiftshader family through the renderer string; when the class
 * was forced to `software` with no such renderer, the family is still swiftshader.
 */
export function keyForStartupClass(cls: QualityClass, h: Hints, extra: Pick<TierInputs, 'hardwareConcurrency' | 'effectiveType' | 'charging' | 'contextLosses'> = {}): TierResult {
  const kind = CLASS_DEVICE_KIND[cls] ?? (h.shortSide >= TABLET_MIN_SHORT_SIDE_CSS_PX ? 'tablet' : 'phone')
  const forcedSoftware = cls === 'software' && !SOFTWARE_RE.test(h.renderer ?? '')
  return resolveQualityTier({
    // The device kind is fixed by the class, so the inputs are chosen to land on it through the shared rule.
    isIosLike: cls === 'ios' || cls === 'ipad',
    coarsePointer: kind !== 'desktop',
    shortSideCssPx: kind === 'tablet' ? Math.max(h.shortSide, TABLET_MIN_SHORT_SIDE_CSS_PX) : kind === 'phone' ? Math.min(h.shortSide, TABLET_MIN_SHORT_SIDE_CSS_PX - 1) : h.shortSide,
    deviceMemory: h.deviceMemory,
    renderer: forcedSoftware ? 'SwiftShader' : h.renderer,
    saveData: h.saveData,
    ...extra,
  })
}
