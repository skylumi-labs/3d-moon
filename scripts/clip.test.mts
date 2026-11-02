import assert from 'node:assert/strict'
import { MAX_CLIPPED_LIT_SHARE, clippedLitShare } from '../audit/clip.mts'
const px = (v: number[]): Uint8Array => Uint8Array.from(v.flatMap((g) => [g, g, g, 255]))
assert.equal(clippedLitShare(px([0, 0, 10, 20])).lit, 0)
assert.equal(clippedLitShare(px([0, 0, 10, 20])).share, 0)
const white = clippedLitShare(px(new Array(100).fill(252)))
assert.equal(white.share, 1); assert.ok(white.share > MAX_CLIPPED_LIT_SHARE)
const ok = clippedLitShare(px([...new Array(98).fill(180), 255, 255]))
assert.ok(Math.abs(ok.share - 0.02) < 1e-9 && ok.share <= MAX_CLIPPED_LIT_SHARE)
console.log('clip ok')
