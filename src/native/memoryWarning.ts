/**
 * The OS memory warning, as the viewer sees it. The native plugin ("MoonMemory", in the native shell)
 * sends `memoryWarning`; the native host (the shell's capacitorHost.ts) forwards it here, and the quality ledger lowers its GPU ceiling the same way a
 * WebGL context loss does: to 0.7 of what it holds (quality/runtime.ts memoryWarning). Nothing here touches the render loop.
 */

/** The plugin's contract, as the native host registers it. */
export interface MoonMemoryPlugin {
  addListener(event: 'memoryWarning', listener: () => void): Promise<{ remove: () => Promise<void> }>
  /** Android 14+ only: the foreground poll of ActivityManager.getMemoryInfo (the system no longer sends the trim levels). */
  addListener(event: 'memorySample', listener: (sample: MemorySample) => void): Promise<{ remove: () => Promise<void> }>
}

/** One reading of ActivityManager.MemoryInfo, in bytes (`lowMemory` is the system's own flag). */
export interface MemorySample { availMem: number; threshold: number; lowMemory: boolean }

/** A sample counts as low when the system says so, or when free memory is within this factor of the kill threshold. */
export const LOW_MEMORY_MARGIN = 1.25
/** The watcher re-arms only when free memory is back above this factor of the threshold, so a reading on the line does not warn twice. */
export const LOW_MEMORY_REARM = 1.75

export function sampleIsLow(s: MemorySample, wasLow: boolean): boolean {
  if (![s.availMem, s.threshold].every((n) => Number.isFinite(n) && n >= 0)) return wasLow
  if (s.lowMemory || s.availMem <= s.threshold * LOW_MEMORY_MARGIN) return true
  return wasLow && s.availMem <= s.threshold * LOW_MEMORY_REARM
}

/**
 * Turns the Android poll into warnings: one per crossing into low memory, none while it stays low, one more after it recovered and fell
 * again. Backgrounding sends no sample (the native poll runs only in the foreground), so it cannot lower the ceiling.
 */
export function createMemoryWatcher(onWarn: () => void): (s: MemorySample) => void {
  let low = false
  return (s) => {
    const now = sampleIsLow(s, low)
    if (now && !low) onWarn()
    low = now
  }
}

/** What the handler needs from the quality ledger. */
export interface MemoryWarningTarget { memoryWarning(): void }

/** The handler the host calls on each warning: one lowering of the ceiling, nothing else. */
export function handleMemoryWarning(target: MemoryWarningTarget): void {
  target.memoryWarning()
}
