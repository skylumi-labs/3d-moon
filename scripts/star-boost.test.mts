import assert from 'node:assert/strict'
import { DEFAULT_STAR_BOOST, STAR_BOOST_KEY, STAR_BOOST_MAX_GAIN, boostGain, clampBoost, loadBoost, loadStarLiftFloor, saveBoost } from '../src/sky/starBoost.ts'
assert.equal(boostGain(0), 1, 'boost 0 leaves the physical flux unchanged')
assert.equal(boostGain(1), STAR_BOOST_MAX_GAIN)
assert.equal(STAR_BOOST_MAX_GAIN, 80, 'twice the earlier top end of 40')
assert.ok(Math.abs(boostGain(0.5) - Math.sqrt(80)) < 1e-9, 'geometric mapping')
let prev = 0
for (let i = 0; i <= 100; i++) { const g = boostGain(i / 100); assert.ok(g > prev, 'strictly increasing'); assert.ok(g / (prev || g) < 1.05, 'continuous steps'); prev = g }
assert.equal(clampBoost(-3), 0); assert.equal(clampBoost(9), 1); assert.equal(clampBoost(NaN), 0)
const mem = new Map<string, string>()
const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
assert.equal(loadBoost('', st), 1, 'default is 1.0')
assert.equal(DEFAULT_STAR_BOOST, 1)
assert.ok(boostGain(DEFAULT_STAR_BOOST) > 5 * boostGain(0.6), 'default gain is clearly above the old 0.6 look (80 vs ~14)')
assert.notEqual(STAR_BOOST_KEY, 'moonsite.starBoost', 'storage key is versioned')
const old = { getItem: (k: string) => (k === 'moonsite.starBoost' ? '0.6' : null) }
assert.equal(loadBoost('', old), 1, 'a value saved by the old version does not pin the old look')
assert.equal(loadStarLiftFloor(''), 0, 'starlift default 0 leaves the exposure unchanged')
assert.equal(loadStarLiftFloor('?starlift=0.3'), 0.3)
assert.equal(loadStarLiftFloor('?starlift=9'), 1); assert.equal(loadStarLiftFloor('?starlift=x'), 0)
saveBoost(0.4, st); assert.equal(loadBoost('', st), 0.4)
assert.equal(loadBoost('?starboost=0.8', st), 0.8, 'URL wins')
assert.equal(loadBoost('', { getItem: () => { throw new Error('blocked') } }), 1)
const z = new Map<string, string>(); saveBoost(0, { setItem: (k, v) => { z.set(k, v) } }); assert.equal(loadBoost('', { getItem: (k) => z.get(k) ?? null }), 0, 'a saved 0 is kept')
console.log('star-boost ok')
