/** Move a 0..1 glare share at a bounded rate, without overshooting the target. */
export function stepGlareScale(cur: number | null, target: number, dtSeconds: number, jump = false, maxPerSecond = 4): number {
  if (cur === null || jump) return target
  const gap = target - cur
  const step = Math.min(Math.abs(gap), Math.max(0, maxPerSecond) * Math.max(0, dtSeconds))
  return cur + Math.sign(gap) * step
}
