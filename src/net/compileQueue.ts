/**
 * The background shader compiles, one per idle callback, in the order the viewer first needs them (R50).
 *
 * Before this the page issued each compile where its trigger happened: the tile variants after the first frame, the ground pass's four programs
 * back to back when the Apollo 17 patch became ready, and the lunar module's link as soon as its model parsed. On a phone or Safari the driver
 * links on the main thread (there is no parallel compile there), so those arrived as one block of long tasks around the arrival. Now each step
 * is its own queue entry; the queue takes one entry per idle callback, waits for it to settle, and only then asks for the next idle slot.
 *
 * `?precompile=` switches steps: absent or `1` runs every step ahead of need (the default), `0` or `off` runs none (the first draw compiles, as
 * before any of this), and a comma list (`?precompile=tiles,lm`) runs only those. The `meta` step is the independent metadata program: it is
 * not part of the default, because only a visibility calibration or an audit draws with it; `?precompile=meta` (or a list naming it) adds it.
 * Pure: tests drive it with a hand-flushed deferral, no WebGL.
 */
export type PrecompileStep = 'tiles' | 'ground' | 'lm' | 'meta'

/** Steps by first need: the tile variants (the first tap on a surface pin), the ground pass (the patch is ready), the lunar module (the arrival). */
export const PRECOMPILE_ORDER: readonly PrecompileStep[] = ['tiles', 'ground', 'lm', 'meta']
/** The steps that run when the switch is absent. */
export const PRECOMPILE_DEFAULT: ReadonlySet<PrecompileStep> = new Set<PrecompileStep>(['tiles', 'ground', 'lm'])

/** The steps `?precompile=` selects. An unknown name in a list is ignored; a list with none known selects nothing. */
export function precompileSteps(search: string): ReadonlySet<PrecompileStep> {
  const v = new URLSearchParams(search).get('precompile')
  if (v === null || v === '' || v === '1' || v === 'on') return PRECOMPILE_DEFAULT
  if (v === '0' || v === 'off') return new Set()
  if (v === 'all') return new Set(PRECOMPILE_ORDER)
  return new Set(v.split(',').map((s) => s.trim()).filter((s): s is PrecompileStep => (PRECOMPILE_ORDER as readonly string[]).includes(s)))
}

export interface CompileQueue {
  /** Adds a step. A step already queued or run is not added again; a step the switch left out is dropped. Returns whether it was accepted. */
  enqueue(step: PrecompileStep, run: () => Promise<unknown>): boolean
  /** Steps in the order they ran (tests, and `__moon` for the rig). */
  readonly ran: readonly PrecompileStep[]
  /** Steps waiting. */
  readonly pending: number
}

/** `defer(cb)` calls `cb` in a later idle slot (the page passes requestIdleCallback; tests pass a list they flush by hand). */
export function createCompileQueue(defer: (cb: () => void) => void, enabled: ReadonlySet<PrecompileStep>): CompileQueue {
  const waiting = new Map<PrecompileStep, () => Promise<unknown>>()
  const seen = new Set<PrecompileStep>()
  const ran: PrecompileStep[] = []
  let scheduled = false
  let busy = false
  const pump = (): void => {
    if (scheduled || busy || waiting.size === 0) return
    scheduled = true
    defer(() => {
      scheduled = false
      if (busy) return
      // The step first needed goes first, whatever order the steps were added in.
      const next = PRECOMPILE_ORDER.find((s) => waiting.has(s))
      if (!next) return
      const run = waiting.get(next)!
      waiting.delete(next)
      busy = true
      ran.push(next)
      // A failed compile is not an error: the first draw compiles the same program.
      void Promise.resolve().then(run).catch(() => undefined).then(() => { busy = false; pump() })
    })
  }
  return {
    enqueue(step, run) {
      if (!enabled.has(step) || seen.has(step)) return false
      seen.add(step)
      waiting.set(step, run)
      pump()
      return true
    },
    get ran() { return ran },
    get pending() { return waiting.size },
  }
}
