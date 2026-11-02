/**
 * Build-block timing where there is no EXT_disjoint_timer_query_webgl2 (normal on Android): a fence is inserted after a frame's cache blocks and polled at the
 * start of later updates. A fence resolves once per frame at best, so it cannot read a sub-frame cost; it can tell whether the blocks finished within one
 * poll (cheap: the estimate decays toward 0) or took `polls` frames (the estimate is elapsed time per block, an upper bound). The scheduler uses
 * `perBlockMs` as a lower bound on a block's cost, replacing the desktop guess floor.
 */
export interface FenceGl {
  SYNC_GPU_COMMANDS_COMPLETE: number
  ALREADY_SIGNALED: number
  CONDITION_SATISFIED: number
  fenceSync(cond: number, flags: number): unknown
  clientWaitSync(sync: unknown, flags: number, timeout: number): number
  deleteSync(sync: unknown): void
  flush(): void
}

export const FENCE_MAX_PENDING = 4
export const FENCE_DECAY = 0.85
export const FENCE_EMA = 0.4
/** A fence unsigned after this many polls is dropped (context trouble); its elapsed time still counts as the cost. */
export const FENCE_GIVE_UP_POLLS = 12

export class FenceBlockTimer {
  private pending: Array<{ sync: unknown; t0: number; blocks: number; polls: number }> = []
  /** Estimated ms per block (0: nothing observed yet, or every fence resolved within one poll for long enough). */
  perBlockMs = 0
  marked = 0
  resolved = 0
  slow = 0

  constructor(private readonly gl: FenceGl | null) {}

  get available(): boolean { return this.gl !== null }

  /** Call right after the frame's blocks were submitted. */
  mark(blocks: number, nowMs: number): void {
    const gl = this.gl
    if (!gl || blocks <= 0 || this.pending.length >= FENCE_MAX_PENDING) return
    try {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
      if (!sync) return
      gl.flush()
      this.pending.push({ sync, t0: nowMs, blocks, polls: 0 })
      this.marked++
    } catch { /* no fences: no estimate */ }
  }

  /** Call once per update. */
  poll(nowMs: number): void {
    const gl = this.gl
    if (!gl) return
    try {
      while (this.pending.length) {
        const f = this.pending[0]
        const st = gl.clientWaitSync(f.sync, 0, 0)
        const done = st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED
        if (!done && f.polls + 1 < FENCE_GIVE_UP_POLLS) { f.polls++; break }
        if (done && f.polls === 0) this.perBlockMs *= FENCE_DECAY
        else {
          const per = (nowMs - f.t0) / f.blocks
          this.perBlockMs = this.perBlockMs > 0 ? (1 - FENCE_EMA) * this.perBlockMs + FENCE_EMA * per : per
          this.slow++
        }
        gl.deleteSync(f.sync)
        this.pending.shift()
        this.resolved++
      }
    } catch { this.pending.length = 0 }
  }
}

/** Blocks one fixed-policy frame may build: `budgetMs` over the dearest of the measured, fenced and floor per-block costs, capped by `maxBlocks` (a gesture frame). */
export function fixedBlockBudget(budgetMs: number, measuredPerBlockMs: number, fencePerBlockMs: number, floorMs: number, maxBlocks = 16): number {
  const per = Math.max(measuredPerBlockMs > 0 ? measuredPerBlockMs : 0, fencePerBlockMs > 0 ? fencePerBlockMs : 0, floorMs)
  return Math.max(1, Math.min(16, maxBlocks, Math.floor(budgetMs / per)))
}
