// Fence-based block timing for devices without a timer query, and the one-block cap for gesture frames under the fixed shadow policy.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { FENCE_GIVE_UP_POLLS, FenceBlockTimer, fixedBlockBudget, type FenceGl } from '../src/moon/tiles/fenceBlockTimer.ts'

function fakeGl(): FenceGl & { done: Set<unknown>; made: number; deleted: number } {
  const g = {
    SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3,
    done: new Set<unknown>(), made: 0, deleted: 0,
    fenceSync() { const s = { id: ++g.made }; return s },
    clientWaitSync(s: unknown) { return g.done.has(s) ? 2 : 4 },
    deleteSync() { g.deleted++ },
    flush() { /* */ },
  }
  return g as never
}

test('budget: floor, measured, fenced cost and the gesture cap', () => {
  assert.equal(fixedBlockBudget(3, 0, 0, 0.25), 12)
  assert.equal(fixedBlockBudget(3, 0, 0, 0.2, 1), 1, 'a gesture frame is capped to one block')
  assert.equal(fixedBlockBudget(3, 0, 1.5, 0.2), 2, 'a fenced cost of 1.5 ms per block replaces the floor')
  assert.equal(fixedBlockBudget(3, 0.5, 1.5, 0.2), 2, 'the dearest estimate wins')
  assert.equal(fixedBlockBudget(0.25, 5, 0, 0.2), 1, 'never below one block')
  assert.equal(fixedBlockBudget(8, 0, 0, 0.01), 16)
})

test('fence: blocks that finish within one poll decay the estimate; slow ones set it', () => {
  const gl = fakeGl()
  const f = new FenceBlockTimer(gl)
  f.mark(3, 0)
  f.poll(5) // unsignalled
  f.poll(40) // still not
  gl.done.add(gl.made === 1 ? (f as unknown as { pending: Array<{ sync: unknown }> }).pending[0].sync : null)
  f.poll(50)
  assert.ok(Math.abs(f.perBlockMs - 50 / 3) < 1e-9, 'elapsed per block after two frames')
  const first = f.perBlockMs
  f.mark(2, 60)
  gl.done.add((f as unknown as { pending: Array<{ sync: unknown }> }).pending[0].sync)
  f.poll(61)
  assert.ok(f.perBlockMs < first, 'a fence that resolved at the first poll decays the estimate')
  assert.equal(gl.deleted, 2)
})

test('fence: bounded pending, give-up, no fences available', () => {
  const gl = fakeGl()
  const f = new FenceBlockTimer(gl)
  for (let i = 0; i < 10; i++) f.mark(1, i)
  assert.equal(f.marked, 4)
  for (let i = 0; i < FENCE_GIVE_UP_POLLS + 2; i++) f.poll(100 + i)
  assert.ok(f.resolved >= 1 && f.perBlockMs > 0, 'an fence that never signals is dropped with its elapsed time')
  const none = new FenceBlockTimer(null)
  none.mark(3, 0); none.poll(1)
  assert.equal(none.perBlockMs, 0)
  assert.equal(none.available, false)
})

test('wiring: both caches use the fence only without a timer, and gestures cap blocks at one', () => {
  const read = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')
  for (const f of ['../src/moon/tiles/ShadowCache.ts', '../src/moon/patch/PatchShadowCache.ts']) {
    const s = read(f)
    assert.match(s, /fixedBlockBudget\(/, f)
    assert.match(s, /this\.timer \? 0 : this\.fence\?\.perBlockMs \?\? 0/, f)
    assert.match(s, /!this\.timer && /, f)
    assert.match(s, /this\.fence\?\.poll\(now\)/, f)
  }
  const main = read('../src/main.ts')
  assert.match(main, /const blockCapFrame = gestureOn \|\| \(sharpMotionOn\(\) && flightScaleWasActive\)/)
  assert.equal(main.match(/\.\.\.\(blockCapFrame \? \{ maxBlocks: 1 \} : \{\}\)/g)?.length, 2, 'global and patch caches')
})
