import type { PanoramaTier } from './manifest'

export interface PanoramaDevice {
  maxTextureSize: number
  coarsePointer: boolean
  deviceMemoryGB?: number
  /** The widest tier the device's quality class allows (ClassProfile.panoMax: the iOS class is 4096, the compact tier). */
  maxWidth?: number
}

/** Keeps phone GPUs at the published 8192 px tier; larger tiers require a capable desktop GPU. */
export function choosePanoramaTier(tiers: readonly PanoramaTier[], device: PanoramaDevice): PanoramaTier {
  if (!tiers.length) throw new Error('panorama has no image tiers')
  const lowMemory = device.deviceMemoryGB !== undefined && device.deviceMemoryGB <= 4
  // The class's width (iOS: the compact tier, about 12 MB with mips, not 37 MB at 8192) bounds the choice on top of the memory and texture rules.
  const byDevice = lowMemory || device.maxTextureSize < 8192
    ? Math.min(4096, device.maxTextureSize)
    : device.coarsePointer || device.maxTextureSize < 16384 || device.deviceMemoryGB === undefined
      ? Math.min(8192, device.maxTextureSize)
      : device.maxTextureSize
  const cap = Math.min(byDevice, device.maxWidth ?? Infinity)
  const selected = [...tiers].sort((a, b) => b.width - a.width).find((tier) => tier.width <= cap)
  if (!selected) throw new Error(`This device supports textures up to ${device.maxTextureSize} px; the panorama needs at least 4096 px.`)
  return selected
}
