/**
 * Compiling the tile shader variants ahead of the first tap on a surface pin (MoonPass.prepareTiles). Compiled on the first
 * draw instead, they stall the main thread for as long as the driver takes to link them.
 *
 * The compile is local work (no network), so it runs once, a moment after the first frame, when the browser is idle. `defer`
 * says when (the page passes requestIdleCallback behind a delay; tests pass a queue they flush by hand).
 */
export const TILE_PREPARE_DELAY_MS = 1200

export function scheduleTilePrepare(defer: (cb: () => void) => void, run: () => Promise<void>): { cancel(): void; readonly started: boolean } {
  let cancelled = false
  let started = false
  defer(() => {
    if (cancelled || started) return
    started = true
    // A failed background compile is not an error: the first draw compiles the same program.
    void run().catch(() => undefined)
  })
  return { cancel: () => { cancelled = true }, get started() { return started } }
}
