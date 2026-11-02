import assert from 'node:assert/strict'
import { REVIEW_LABEL_MAX, parseReviewLabel } from '../src/ui/reviewLabel.ts'

assert.equal(parseReviewLabel(''), null)
assert.equal(parseReviewLabel('?a=1'), null)
assert.equal(parseReviewLabel('?label='), null)
assert.equal(parseReviewLabel('?label=%20%20'), null)
assert.equal(parseReviewLabel('?label=Old%20look%20%C2%B7%20Copernicus'), 'Old look · Copernicus')
assert.equal(parseReviewLabel('?label=a%0Ab%09c'), 'a b c')
assert.equal(parseReviewLabel('?label=<img src=x onerror=1>'), '<img src=x onerror=1>', 'markup stays plain text (textContent only)')
assert.equal(REVIEW_LABEL_MAX, 60)
assert.equal(parseReviewLabel('?label=' + 'x'.repeat(200))?.length, 60)
assert.equal(parseReviewLabel('?label=' + 'x'.repeat(60))?.length, 60)
assert.equal(parseReviewLabel('?label=' + 'x'.repeat(59))?.length, 59)
console.log('review-label.test.mts: ok')
