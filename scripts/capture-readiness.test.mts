import assert from 'node:assert/strict'
import { advanceShadowIdleDraws, shadowMotionForFrame } from '../src/capture/readiness.ts'

let state = advanceShadowIdleDraws(0, true)
assert.deepEqual(state, { count: 1, ready: false }, 'one idle draw cannot finish shadow work')
state = advanceShadowIdleDraws(state.count, false)
assert.deepEqual(state, { count: 0, ready: false }, 'pending or dirty shadow work resets the consecutive draw count')
state = advanceShadowIdleDraws(state.count, true)
state = advanceShadowIdleDraws(state.count, true)
assert.deepEqual(state, { count: 2, ready: true }, 'capture waits for two idle shadow draws')
assert.equal(shadowMotionForFrame(true, true), false, 'capture draws let retained tween shadow caches build as rest frames')
assert.equal(shadowMotionForFrame(false, true), true, 'live motion remains classified as motion outside capture')
console.log('capture-readiness.test ok')
