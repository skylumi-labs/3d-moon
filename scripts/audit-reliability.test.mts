import assert from 'node:assert/strict'
import { aggregate, validateSelection, cadence } from '../audit/verdict.mts'
import { g8, type VisibilityEvidence } from '../audit/visibility.mts'
import { g1, g2, g6, g7 } from '../audit/gates.mts'
import type { VisibilityCalibration } from '../src/post/visibility.ts'
assert.throws(() => validateSelection(['typo']), /Unknown/)
assert.throws(() => validateSelection([]), /empty/)
assert.throws(() => validateSelection(['chips'], ['missing'], ['now']), /chip/)
for (const gate of ['ERR', 'UNKNOWN', 'G8']) assert.equal(aggregate([{ gate, scenario: 'chips', pass: false, detail: 'exception' }], ['chips'], ['chips']).exitCode, 1)
assert.equal(aggregate([{ gate: 'G1', scenario: 'chips', pass: true, detail: '' }], ['chips', 'ground'], ['chips']).exitCode, 1)
assert.equal(aggregate([], ['chips'], ['chips']).exitCode, 1)
assert.equal(aggregate([{ gate: 'G1', scenario: 'chips', pass: null, detail: '' }], ['chips'], ['chips']).exitCode, 1)
assert.equal(g1('empty', [], []).pass, false)
assert.equal(g2('empty', []).pass, false)
assert.equal(g6('empty', []).pass, false)
assert.equal(cadence([]).fps, 0)
const p: VisibilityCalibration = { id: 'synthetic test only', bundleSha256: 'a'.repeat(64), baselineEarthshineSha256: 'b'.repeat(64), mariaGrey: .06, highlandGrey: .10, skyGrey: .01, minContrastGrey: .02, minDetailGrey: .02, earthshineMinimumGrey: .12 }
const good = (): VisibilityEvidence => {
  const e: VisibilityEvidence = { frameId: 1, width: 64, height: 64, metadata: new Uint8Array(64 * 64 * 4), gray: new Uint8Array(64 * 64).fill(2), calibration: p, ground: false, skewMs: 0, excludes: [], offscreen: false, limbApplicable: true, expectedNight: true, bundleSha256: p.bundleSha256, baselineEarthshineSha256: p.baselineEarthshineSha256, baselineVerified: true }
  for (let y = 8; y < 56; y++) for (let x = 8; x < 56; x++) {
    const i = y * 64 + x, low = x < 32
    e.metadata.set([255, 255, low ? 100 : 220, x < 12 || x > 52 ? 20 : 200], i * 4)
    e.gray[i] = low ? 20 : 35
  }
  return e
}
assert.equal(g8('good', [good()]).pass, true)
assert.equal(g8('missing', []).pass, false)
assert.equal(g8('uncalibrated', [{ ...good(), calibration: null }]).pass, false)
assert.equal(g8('empty-mask', [{ ...good(), metadata: new Uint8Array(64 * 64 * 4) }]).pass, false)
assert.equal(g8('skew', [{ ...good(), skewMs: 5 }]).pass, false)
const dark = good(); for (let i = 0; i < dark.gray.length; i++) if (dark.metadata[i * 4]) dark.gray[i] = 2
assert.equal(g8('invisible-disc', [dark]).pass, false)
const crescent = good(); for (let i = 0; i < crescent.gray.length; i++) if (crescent.metadata[i * 4]) { crescent.gray[i] = i % 64 > 52 ? 240 : 2; if (i % 64 > 52) crescent.metadata[i * 4 + 1] = 0 }
assert.equal(g8('bright-crescent-only', [crescent]).pass, false)
const flat = good(); for (let i = 0; i < flat.gray.length; i++) if (flat.metadata[i * 4]) flat.gray[i] = 25
assert.equal(g8('featureless-grey', [flat]).pass, false)
const fault = { normalS: 30, recoveryS: 40, intercepted: true, reload: false, normalGeneration: 1, recoveryGeneration: 1, arrived: true }
assert.equal(g7(fault).pass, true)
assert.equal(g7({ ...fault, intercepted: false }).pass, false)
assert.equal(g7({ ...fault, arrived: false }).pass, false)
assert.equal(aggregate([{ gate: 'G7', scenario: 'robust', pass: true, detail: 'proof' }], ['robust'], ['robust']).exitCode, 0)
assert.equal(aggregate([{ gate: 'G1', scenario: 'chips', pass: true, detail: 'partial' }], ['chips'], ['chips']).exitCode, 1, 'missing expected gates cannot pass')
console.log('audit-reliability.test.mts: fail-closed aggregation, empty telemetry/masks, invisible disc, crescent-only and uniform-grey negatives: ok')

assert.equal(aggregate([{ gate: 'G7', scenario: 'robust', pass: true, detail: 'arrived' }, { gate: 'ERR', scenario: 'robust', pass: false, detail: 'scenario exception after first gate' }], ['robust'], ['robust']).exitCode, 1)
for (const pass of [true, null]) assert.equal(aggregate([{ gate: 'G7', scenario: 'robust', pass: true, detail: 'arrived' }, { gate: 'ERR', scenario: 'robust', pass, detail: 'errors can never be promoted or marked inapplicable' }], ['robust'], ['robust']).exitCode, 1)

assert.equal(g8('stale-candidate', [{ ...good(), bundleSha256: 'c'.repeat(64) }]).pass, false)
assert.equal(g8('unverified-baseline', [{ ...good(), baselineVerified: false }]).pass, false)
const noLimb = good(); for (let i = 0; i < noLimb.gray.length; i++) noLimb.metadata[i * 4 + 3] = 200
assert.equal(g8('missing-whole-disc-limb', [noLimb]).pass, false)
