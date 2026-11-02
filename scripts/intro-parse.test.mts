/**
 * When a visit starts with the splash and the flyby (src/intro/parse.ts):
 *   npm test
 */
import assert from 'node:assert/strict'
import { introWanted, stripOverlayParams, formatLoaded, loadedLabel } from '../src/intro/parse.ts'

const w = (q: string, automated = false): boolean => introWanted(new URLSearchParams(q), automated)
// A person opening the page itself gets it, with or without harmless keys.
assert.equal(w(''), true)
assert.equal(w('labels=1&t=2026-10-14T20:00:00Z'), true)
// A link that names a view opens on it.
for (const q of ['view=fly&lon=-20&lat=9&dist=1.2', 'pin=a17', 'moment=surface', 'start=earth', 'look=earth', 'g=1']) assert.equal(w(q), false, q)
// An automated browser (the rig, the audits) gets the page as before.
assert.equal(w('', true), false)
assert.equal(w('perfhud=1', true), false)
// The explicit switch wins either way.
assert.equal(w('intro=0'), false)
assert.equal(w('intro=1', true), true)
assert.equal(w('intro=1&pin=a17'), true)
// The reload a lost GPU context caused (issue #206) never shows the splash, whatever the link or the switch says.
assert.equal(introWanted(new URLSearchParams(''), false, true), false)
assert.equal(introWanted(new URLSearchParams('intro=1'), false, true), false)
assert.equal(introWanted(new URLSearchParams(''), false, false), true, 'an ordinary start is unchanged')
// F15: the panorama key leaves the address when the panorama closes; nothing else does.
assert.equal(stripOverlayParams('https://x.test/moon/?view=fly&panorama=alsep&t=1'), 'https://x.test/moon/?view=fly&t=1')
assert.equal(stripOverlayParams('https://x.test/moon/?panorama=alsep'), 'https://x.test/moon/')
assert.equal(stripOverlayParams('https://x.test/moon/?pin=a17'), 'https://x.test/moon/?pin=a17', 'no overlay key: the same string')
// F4: the loading line shows real bytes only.
assert.equal(formatLoaded(0), '0 KB')
assert.equal(formatLoaded(NaN), '0 KB')
assert.equal(formatLoaded(300), '1 KB')
assert.equal(formatLoaded(812 * 1024), '812 KB')
assert.equal(formatLoaded(1.45 * 1024 * 1024), '1.4 MB')
// A cross-origin download without Timing-Allow-Origin reports 0 bytes: from then on the line counts files, never a stalled byte total.
assert.equal(loadedLabel(812 * 1024, 3, 0), '812 KB loaded')
assert.equal(loadedLabel(734 * 1024, 14, 11), '14 files loaded')
assert.equal(loadedLabel(0, 1, 1), '1 file loaded')
console.log('intro-parse: ok')
