import assert from 'node:assert/strict'
import { hygStars, matchHyg } from './hyg-match.mts'

const csv = [
  '"id","hip","ra","dec","mag","proper"',
  '0,,0.000000,0.000000,-26.700,Sol',
  '1,1,0.00533333333,-44.291,6.28,',
  '2,2,1.0000000,10.0,6.60,',
  '3,3,2.0000000,-5.5,4.10,',
].join('\n')
const cat = hygStars(csv)
assert.equal(cat.length, 2, 'Sol and stars fainter than V 6.5 are dropped')
assert.ok(Math.abs(cat[0][0] - 0.08) < 1e-6, 'RA hours become degrees')
assert.deepEqual(matchHyg([[0.08, -44.291, 6.28], [30, -5.5, 4.1], [1, 1, 1]], cat), { shipped: 3, catalogue: 2, matched: 2 })
assert.throws(() => hygStars('id,ra,dec\n1,2,3'), /no "mag" column/)
console.log('hyg-match ok')
