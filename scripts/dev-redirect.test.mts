// devRedirect: with MOON_REMOTE_BASE a missing patch / mid-patch / tile file is redirected to the hosted copy (was a 404: no A17 patch on the dev server).
import assert from 'node:assert/strict'
import { devRedirect, devTcBase } from '../src/moon/tiles/devRedirect.ts'

const base = 'https://example.test/moon'
assert.equal(devRedirect('/moon/patch', '/a17/manifest.json', { MOON_REMOTE_BASE: base }), 'https://example.test/moon/patch/a17/manifest.json')
assert.equal(devRedirect('/moon/mid-patch', '/a17/x.bin', { MOON_REMOTE_BASE: base + '/' }), 'https://example.test/moon/mid-patch/a17/x.bin')
assert.equal(devRedirect('/moon/tiles', '/h/0/44_6.bin.gz', { MOON_REMOTE_BASE: base }), 'https://example.test/moon/tiles/h/0/44_6.bin.gz')
assert.equal(devRedirect('/moon/patch', '/a17/manifest.json', {}), null, 'unset: a 404 as before')
// The older deep-only variable keeps its scope.
assert.equal(devRedirect('/moon/tiles', '/h/-2/1_1.bin.gz', { MOON_DEEP_REDIRECT: 'https://d.test/tiles' }), 'https://d.test/tiles/h/-2/1_1.bin.gz')
assert.equal(devRedirect('/moon/tiles', '/h/0/1_1.bin.gz', { MOON_DEEP_REDIRECT: 'https://d.test/tiles' }), null)
assert.equal(devRedirect('/moon/patch', '/a17/manifest.json', { MOON_DEEP_REDIRECT: 'https://d.test/tiles' }), null)
assert.equal(devRedirect('/moon/tiles', '/manifest.json', { MOON_TILES_REMOTE: 'https://t.test/tiles' }), 'https://t.test/tiles/manifest.json')
assert.equal(devRedirect('/moon/patch', '/a17/manifest.json', { MOON_TILES_REMOTE: 'https://t.test/tiles' }), null)
// The dev server's Terrain Camera base follows MOON_REMOTE_BASE (vite.config.ts sets VITE_MOON_TC from it); without one there is none.
assert.equal(devTcBase({ MOON_REMOTE_BASE: base }), 'https://example.test/moon/tc/v3/')
assert.equal(devTcBase({ MOON_REMOTE_BASE: base + '/' }), 'https://example.test/moon/tc/v3/')
assert.equal(devTcBase({}), undefined)
assert.equal(devTcBase({ MOON_REMOTE_BASE: '' }), undefined)
console.log('dev redirect ok')
