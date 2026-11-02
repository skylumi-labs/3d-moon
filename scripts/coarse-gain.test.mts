/**
 * The coarse exposure search of a gesture is corrected by a measured full/coarse ratio (src/post/coarseGain.ts):
 *   node --import tsx scripts/coarse-gain.test.mts
 */
import assert from 'node:assert/strict'
import { COARSE_GAIN_BLEND, COARSE_GAIN_MAX_STOPS, COARSE_GAIN_REFRESH_MS, CoarseGain, coarseGainOf } from '../src/post/coarseGain.ts'
import { applyCoarseGain, coarseGainFor, computeExposure } from '../src/post/exposure.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { earthViewCamera } from '../src/camera/pose.ts'

// 1. The ratio is full over coarse, clamped, and 1 when either search found nothing lit.
{
  assert.equal(coarseGainOf(0.05, 0.025), 2)
  assert.equal(coarseGainOf(0.025, 0.05), 0.5, 'a coarse search that reads HIGH is corrected down too (seen mid-zoom)')
  assert.equal(coarseGainOf(0.05, 0.05), 1)
  assert.equal(coarseGainOf(0, 0.05), 1)
  assert.equal(coarseGainOf(0.05, 0), 1)
  assert.equal(coarseGainOf(Number.NaN, 0.05), 1)
  const limit = Math.pow(2, COARSE_GAIN_MAX_STOPS)
  assert.equal(coarseGainOf(1, 1e-6), limit, 'clamped at +3 stops')
  assert.equal(coarseGainOf(1e-6, 1), 1 / limit, 'clamped at -3 stops')
}

// 2. The held ratio: measured on the first frame, refreshed on a schedule, blended in the log domain, cleared at rest.
{
  const g = new CoarseGain()
  assert.equal(g.gain, 1)
  assert.ok(g.due(1000), 'the first frame of a gesture measures')
  g.update(1000, 2.4)
  assert.equal(g.gain, 2.4, 'the first measurement is taken whole')
  assert.ok(!g.due(1000 + COARSE_GAIN_REFRESH_MS - 1), 'no search in between')
  assert.ok(g.due(1000 + COARSE_GAIN_REFRESH_MS), 'one full search per refresh')
  g.update(1250, 1)
  const expected = Math.exp(Math.log(2.4) * (1 - COARSE_GAIN_BLEND))
  assert.ok(Math.abs(g.gain - expected) < 1e-12, `a refresh blends (${g.gain} vs ${expected})`)
  for (let i = 0; i < 12; i++) g.update(1500 + i * COARSE_GAIN_REFRESH_MS, 1)
  assert.ok(Math.abs(g.gain - 1) < 1e-3, 'it converges on a steady measurement')
  assert.ok(g.due(0), 'a clock that went back re-measures')
  g.reset()
  assert.equal(g.gain, 1)
  assert.ok(g.due(5), 'after a rest the next gesture measures on its first frame')
}

// 3. The gain scales the coarse search's brightness and exposure; it leaves a full search and gain 1 alone.
{
  const e = ephemerisAt(new Date('2026-10-26T12:00:00Z'))
  const cam = earthViewCamera(e, 1.6)
  const base = { cam, aspect: 1.6, canvasHeight: 900, ephem: e, albedo: null, lonSpan: 180, preExposeOn: true }
  const plain = computeExposure({ ...base, coarse: true })
  const doubled = computeExposure({ ...base, coarse: true, coarseGain: 2 })
  assert.ok(Math.abs(doubled.white / plain.white - 2) < 1e-9, `a gain of 2 doubles the white (${doubled.white / plain.white})`)
  assert.ok(doubled.preExpose <= plain.preExpose, 'a brighter frame never gets more pre-exposure')
  assert.equal(computeExposure({ ...base, coarse: true, coarseGain: 1 }).white, plain.white)
  const full = computeExposure(base)
  assert.equal(computeExposure({ ...base, coarseGain: 3 }).white, full.white, 'a full search ignores the gain')
  const s = { best: 1, bestA: 0.5, esMax: 0.1, hits: 5, samples: 9, sunlitFraction: 0.5, eclipseLevel: 0 }
  assert.deepEqual(applyCoarseGain(s, 1), s)
  assert.deepEqual(applyCoarseGain(s, 0), s, 'a degenerate gain changes nothing')
  assert.equal(applyCoarseGain(s, 2).bestA, 1)
  assert.equal(applyCoarseGain(s, 2).esMax, 0.1, 'only the sunlit brightness is scaled')
  // measuring on a view where the two searches agree (no albedo map, nothing to miss) gives 1.
  const g = coarseGainFor(base)
  assert.ok(g > 0.125 && g <= 8, `the measured ratio is inside its clamp (${g})`)
}

console.log('coarse-gain tests passed')
