/** Counts consecutive rendered draws with every shadow cache idle. */
export function advanceShadowIdleDraws(previous: number, allIdle: boolean): { count: number; ready: boolean } {
  const count = allIdle ? previous + 1 : 0
  return { count, ready: count >= 2 }
}

/** Capture retries render a fixed logical pose and must let shadow caches build as in a rest frame. */
export function shadowMotionForFrame(capture: boolean, otherwiseMoving: boolean): boolean {
  return !capture && otherwiseMoving
}

export interface CaptureReadinessTimeout<W> {
  i: number
  waitedMs: number
  resident: false
  timedOut: true
  why: W
}

/** Poll capture readiness without allowing a stalled resource to hang a film forever. */
export async function waitForCaptureReadiness<T, W>(
  i: number,
  step: () => Promise<{ ready: true; value: T } | { ready: false; why: W }>,
  options: { now: () => number; sleep: (ms: number) => Promise<void>; timeoutMs?: number; cancelled?: () => boolean },
): Promise<{ i: number; waitedMs: number; resident: true; value: T } | CaptureReadinessTimeout<W> | { i: number; waitedMs: number; resident: false; cancelled: true }> {
  const started = options.now()
  const timeoutMs = options.timeoutMs ?? 20_000
  for (;;) {
    if (options.cancelled?.()) return { i, waitedMs: Math.max(0, Math.round(options.now() - started)), resident: false, cancelled: true }
    const result = await step()
    const waitedMs = Math.max(0, Math.round(options.now() - started))
    if (options.cancelled?.()) return { i, waitedMs, resident: false, cancelled: true }
    if (result.ready) return { i, waitedMs, resident: true, value: result.value }
    if (waitedMs >= timeoutMs) return { i, waitedMs, resident: false, timedOut: true, why: result.why }
    await options.sleep(Math.min(16, timeoutMs - waitedMs))
  }
}
