import assert from 'node:assert/strict'
import fs from 'node:fs'
import { BAND_HANDOVER_MS, bandMustAbandon, bandStartAllowed } from '../src/post/bandGate.ts'

const ok = { cutFrames: 0, sinceScriptedMs: 10_000, exposureMoving: false }
assert.equal(bandStartAllowed(ok), true)
assert.equal(bandStartAllowed({ ...ok, cutFrames: 2 }), false, 'not across a declared exposure cut')
assert.equal(bandStartAllowed({ ...ok, sinceScriptedMs: BAND_HANDOVER_MS - 1 }), false, 'not in the first 500 ms after a move')
assert.equal(bandStartAllowed({ ...ok, sinceScriptedMs: BAND_HANDOVER_MS }), true)
assert.equal(bandStartAllowed({ ...ok, exposureMoving: true }), false, 'not while the exposure moves')
assert.equal(bandMustAbandon(0, false), false)
assert.equal(bandMustAbandon(1, false), true)
assert.equal(bandMustAbandon(0, true), true)

const src = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.ok(/bandsWorth\(\) && bandStartAllowed\(/.test(src), 'main gates the start of a banded frame')
assert.ok(/bandMustAbandon\(exposureCutFrames, exposureControl\.moving\)/.test(src), 'main abandons a banded frame on a cut')
console.log('band gate ok')
