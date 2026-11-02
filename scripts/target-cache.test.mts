// Zoom hitches: a render-target set built inside a frame is a GPU allocation. With the default three sets, a gesture that starts on another grid or a
// ladder step builds a fourth and evicts one, so the next gesture pays again. The counters make that visible in __moon.perf (built, evicted),
// and ?targetcache=N lets the rig A/B a larger cache.
import assert from 'node:assert/strict'
import { DEFAULT_TARGET_SETS, TargetCache } from '../src/post/targets.ts'
import { CLASS_TABLE, shellProfile } from '../src/quality/startupClass.ts'

const W = 1440, H = 900
const size = (s: number): [number, number] => [Math.round(W * s), Math.round(H * s)]
/** A session of gestures: each starts on a grid, may step the ladder down once, refines through 0.7 to full size. */
function session(c: TargetCache, gestures: Array<[number, number | null]>): void {
  for (const [start, step] of gestures) {
    c.get(...size(start))
    if (step !== null) c.get(...size(step))
    c.get(...size(0.7))
    c.get(...size(1))
  }
}
const gestures: Array<[number, number | null]> = [[0.5, 0.35], [0.5, null], [0.35, 0.25], [0.5, 0.35], [0.5, null], [0.35, null]]

const small = new TargetCache()
assert.equal(DEFAULT_TARGET_SETS, 3)
session(small, gestures)
const big = new TargetCache()
big.maxSets = 5
session(big, gestures)
assert.ok(small.stats().targetEvicted > 0 && small.stats().targetBuilt > 4, 'three sets thrash when gestures start on different grids')
assert.equal(big.stats().targetEvicted, 0, 'five sets hold every grid the ladder uses (0.25, 0.35, 0.5, 0.7, 1)')
assert.equal(big.stats().targetBuilt, 5)
assert.ok(small.stats().targetBuilt > big.stats().targetBuilt, 'fewer builds with the larger cache')
assert.equal(big.get(...size(0.5)), big.get(...size(0.5)), 'a held set is reused')
console.log('target-cache ok', small.stats(), big.stats())

// The iOS app: one render size (the website's ios class keeps main's 2).
assert.equal(CLASS_TABLE.ios.targetSets, 2, 'iOS website: main value')
// iOS app: one render size. A second size evicts the first, so a motion grid on another size rebuilds the set (the counted cost).
{
  const c = new TargetCache()
  c.maxSets = shellProfile('ios', CLASS_TABLE.ios, true).targetSets
  c.get(...size(1))
  c.get(...size(0.5))
  assert.equal(c.stats().targetSets, 1, 'the iOS app keeps one set')
  assert.equal(c.stats().targetEvicted, 1, 'the second size evicts the first')
}
