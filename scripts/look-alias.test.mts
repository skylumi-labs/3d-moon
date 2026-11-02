import assert from 'node:assert/strict'
import { dialValue, isLookA } from '../src/moon/moonShader.ts'
const d = (q: string, n: string, o: number, a: number) => dialValue(q, n, o, a, -1, 1000)
assert.equal(isLookA('?look=a'), true)
assert.equal(isLookA(''), false)
assert.equal(isLookA('?look=b'), false)
assert.equal(d('', 'shadowfill', 0.03, 0.04), 0.03, 'original look by default')
assert.equal(d('?look=a', 'shadowfill', 0.03, 0.04), 0.04, 'look=a gives option A')
assert.equal(d('?look=a&shadowfill=0.05', 'shadowfill', 0.03, 0.04), 0.05, 'a dial still overrides look=a')
assert.equal(d('?radkey=1', 'radkey', 0, 1), 1)
assert.equal(d('?shadowfill=abc', 'shadowfill', 0.03, 0.04), 0.03, 'a bad value falls back')
console.log('look-alias.test.mts: ok')
