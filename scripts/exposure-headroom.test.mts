import assert from 'node:assert/strict'
import { SUBJECT_HOLD_CAP_STOPS, SUBJECT_HOLD_FLOOR_STOPS, anchoredBrightest, subjectHoldAnchor } from '../src/post/exposure'

// The subject lock holds the white from the last rest frame (a dark one: tiny). It may never put the picture more than
// SUBJECT_HOLD_FLOOR_STOPS over the frame's own search, or a fully lit face clips (owner, 4 Oct 2026).
const lock = { weight: 1, capStops: SUBJECT_HOLD_CAP_STOPS, floorStops: SUBJECT_HOLD_FLOOR_STOPS }
const own = 0.36
const stopsOver = (b: number): number => Math.log2(own / b)

// held white from a dark frame: far below what the lit face needs
assert.ok(stopsOver(anchoredBrightest(own, { ...lock, white: 0.012 })) <= 0.3, 'a dark held white must not overexpose a lit face')
// held white from a brighter frame: darkening is allowed, but only up to the cap
const dark = anchoredBrightest(own, { ...lock, white: 100 })
assert.ok(Math.abs(Math.log2(dark / own) - SUBJECT_HOLD_CAP_STOPS) < 1e-9)
// a held white inside the band is kept (no breathing)
assert.ok(Math.abs(anchoredBrightest(own, { ...lock, white: own * 1.2 }) - own * 1.2) < 1e-9)
// weight 0 changes nothing
assert.equal(anchoredBrightest(own, { ...lock, weight: 0, white: 0.012 }), own)
assert.ok(SUBJECT_HOLD_FLOOR_STOPS <= 0.5, 'the over-exposure allowance stays small')
// The anchor main.ts builds must bind the two limits to the right slots: a swap (cap 0.25, floor 1) passes every check above.
const built = subjectHoldAnchor(0.012, 1)
assert.equal(built.capStops, SUBJECT_HOLD_CAP_STOPS); assert.equal(built.floorStops, SUBJECT_HOLD_FLOOR_STOPS)
assert.ok(stopsOver(anchoredBrightest(own, subjectHoldAnchor(0.012, 1))) <= 0.3, 'through the real builder: a dark held white may not overexpose')
assert.ok(Math.abs(Math.log2(anchoredBrightest(own, subjectHoldAnchor(100, 1)) / own) - SUBJECT_HOLD_CAP_STOPS) < 1e-9, 'through the real builder: a bright held white darkens by the cap')
console.log('exposure-headroom ok')
