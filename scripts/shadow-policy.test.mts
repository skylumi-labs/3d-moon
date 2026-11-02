import assert from 'node:assert/strict'
import {
  accountShadowFrame, addVisibleShadowDemand, bodyFrameSunEpoch, cacheBuildMotion, cacheReadDuringMotion, sunDirectionInBodyFrame,
  parseShadowPolicy, shadowChangeDecision, shadowJobCanPublish,
} from '../src/moon/shadowPolicy.ts'

assert.equal(parseShadowPolicy(''), 'legacy')
assert.equal(parseShadowPolicy('?shadowpolicy=legacy'), 'legacy')
assert.equal(parseShadowPolicy('?shadowpolicy=fixed'), 'fixed')
assert.equal(parseShadowPolicy('?shadowpolicy=unknown'), 'legacy')

const sun = [0.3, 0.4, 0.5] as const
const epoch = bodyFrameSunEpoch(sun)
assert.equal(epoch, bodyFrameSunEpoch([0.6, 0.8, 1]), 'body frame direction normalizes to a stable epoch')
assert.notEqual(epoch, bodyFrameSunEpoch([0.31, 0.4, 0.5]), 'a Sun direction change changes the epoch')
assert.deepEqual(sunDirectionInBodyFrame([1, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]), [1, 0, 0])
assert.deepEqual(sunDirectionInBodyFrame([1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, 0, 1]), [0, -1, 0], 'fixed world Sun changes body-frame direction when the Moon turns')

assert.deepEqual(shadowChangeDecision('camera'), { epochDelta: 0, invalidate: false, drift: false, preserveEntries: true }, 'camera-only motion preserves entries')
assert.deepEqual(shadowChangeDecision('live-tick'), { epochDelta: 0, invalidate: false, drift: true, preserveEntries: true }, 'live ticks retain bounded drift handling')
for (const cause of ['date-jump', 'turn', 'terrain-revision', 'context-restore'] as const) {
  const d = shadowChangeDecision(cause)
  assert.equal(d.invalidate, true, `${cause} invalidates immediately`)
  assert.equal(d.epochDelta, 1, `${cause} advances the publication epoch`)
  assert.equal(d.drift, false)
}

const demand = addVisibleShadowDemand(new Set(['warm']), ['new-a', 'new-b'])
assert.deepEqual([...demand].sort(), ['new-a', 'new-b', 'warm'], 'new visible tiles add demand without removing warm entries')
assert.equal(shadowJobCanPublish(4, 4), true)
assert.equal(shadowJobCanPublish(3, 4), false, 'a completed job from before a seek cannot publish')

assert.equal(cacheReadDuringMotion('legacy', false), false)
assert.equal(cacheReadDuringMotion('fixed', false), true, 'fixed keeps valid reads on during gestures')
assert.equal(cacheBuildMotion('legacy', true), true)
assert.equal(cacheBuildMotion('fixed', true), false, 'fixed removes generic motion as a scheduler blocker')
assert.equal(cacheBuildMotion('fixed', true, true), true, 'the sharp pacer cut-cost stage defers builds under fixed too')
assert.equal(cacheBuildMotion('fixed', false, true), true)
assert.equal(cacheBuildMotion('legacy', false, true), true)
assert.equal(cacheBuildMotion('legacy', false, false), false)

assert.deepEqual(accountShadowFrame({
  mode: 'full', bakedDrawing: false, patchCacheOn: false, globalCacheOn: true,
  globalBuilt: 2, patchBuilt: 1, globalPending: 4, patchPending: 3, bakedPending: 0,
}), { mode: 'full', path: 'global-cache', globalLayersBuilt: 2, patchLayersBuilt: 1, cacheLayersBuilt: 3, pendingDemand: 7 })
assert.equal(accountShadowFrame({ mode: 'full', bakedDrawing: false, patchCacheOn: true, globalCacheOn: true, globalBuilt: 0, patchBuilt: 0, globalPending: 0, patchPending: 0, bakedPending: 0 }).path, 'patch-cache')
assert.equal(accountShadowFrame({ mode: 'baked', bakedDrawing: true, patchCacheOn: false, globalCacheOn: false, globalBuilt: 0, patchBuilt: 0, globalPending: 0, patchPending: 0, bakedPending: 1 }).path, 'baked')
assert.equal(accountShadowFrame({ mode: 'baked', bakedDrawing: false, patchCacheOn: false, globalCacheOn: false, globalBuilt: 0, patchBuilt: 0, globalPending: 0, patchPending: 0, bakedPending: 1 }).path, 'live-march', 'Baked unavailable reports its actual Fast fallback')
assert.equal(accountShadowFrame({ mode: 'off', bakedDrawing: false, patchCacheOn: true, globalCacheOn: true, globalBuilt: 0, patchBuilt: 0, globalPending: 0, patchPending: 0, bakedPending: 0 }).path, 'off')
console.log('shadow-policy: ok')
