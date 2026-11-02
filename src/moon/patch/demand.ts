/** Pure camera-demand policy. Site selection alone never requests fine imagery. */
export interface PatchDemand {
  altitudeKm: number
  metresPerPixel: number
  /** True for a closer camera pose, including a tour descent. False for distant selection/prefetch. */
  zoomedIn: boolean
  /**
   * A tour descent is running. It asked for the fine levels and its own end pose (tilted, backed off the site and lifted by
   * the site funnel) can sit past a resident level's retention limit, so the layer keeps what is loaded and what is loading
   * until the descent ends. Evicting mid-descent re-bases it and starts the load again.
   */
  hold?: boolean
}
export interface DemandLevel { texelM: number; maxAltitudeKm?: number }

/** Enter at four pixels per source texel; retain until six to avoid oscillation. */
export function wantsLevel(level: DemandLevel, demand: PatchDemand, resident = false): boolean {
  if (!demand.zoomedIn || !Number.isFinite(demand.altitudeKm) || !Number.isFinite(demand.metresPerPixel)
    || demand.altitudeKm < 0 || demand.metresPerPixel <= 0) return false
  const altitudeLimit = level.maxAltitudeKm ?? (level.texelM >= 4 ? 250 : level.texelM >= 1 ? 30 : 10)
  return demand.altitudeKm <= altitudeLimit * (resident ? 1.2 : 1)
    && demand.metresPerPixel <= level.texelM * (resident ? 6 : 4)
}

/** C2-continuous overlap envelope, also used by the CPU package validator. */
export function overlapWeight(distanceM: number, fadeM: number): number {
  const t = Math.max(0, Math.min(1, distanceM / Math.max(1e-6, fadeM)))
  return t * t * t * (t * (t * 6 - 15) + 10)
}
