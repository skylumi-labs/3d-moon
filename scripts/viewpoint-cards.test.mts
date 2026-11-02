import assert from 'node:assert/strict'
import { VIEWPOINT_ENTRIES } from '../src/viewpointList.ts'
import { SHORT_MAX, STRIP_DRAG_PX, shortLine, stripDragMove, stripDragStart, stripDragTakes, thumbBase, thumbSrc } from '../src/ui/viewpointCards.ts'

// The stills live beside the tiles: .../moon/tiles/ -> .../moon/thumbs/.
const hosted = 'https://storage.googleapis.com/example-mirror/moon/tiles/'
assert.equal(thumbBase(hosted), 'https://storage.googleapis.com/example-mirror/moon/thumbs/')
assert.equal(thumbBase('/moon/tiles'), '/moon/thumbs/', 'a base without the trailing slash')
assert.equal(thumbBase('/moon/tiles/'), '/moon/thumbs/')
assert.equal(thumbBase(''), './thumbs/', 'no base (dev or artifact build): ./thumbs/')
assert.equal(thumbBase(undefined), './thumbs/')
assert.equal(thumbBase('https://example.org/data'), 'https://example.org/data/thumbs/', 'a base not ending in tiles/ gets thumbs/ under it')

const t = thumbSrc('https://h/moon/thumbs/', 'pin-tycho')
assert.equal(t.src, 'https://h/moon/thumbs/pin-tycho@1x.webp')
assert.equal(t.srcset, 'https://h/moon/thumbs/pin-tycho@1x.webp 1x, https://h/moon/thumbs/pin-tycho@2x.webp 2x')

// Every entry has a short line of a few words (no times).
for (const e of VIEWPOINT_ENTRIES) {
  const s = shortLine(e.id, e.caption)
  assert.ok(s.length > 0 && s.length <= SHORT_MAX, `${e.id}: "${s}" is ${s.length} chars`)
  assert.doesNotMatch(s, /\d:\d\d|seconds?\b/i, `${e.id}: no duration in the line`)
}
assert.equal(shortLine('unknown', 'A long sentence about a place that goes on well past the limit of the card. And more.').length <= SHORT_MAX, true)
assert.equal(shortLine('unknown', 'Short one. Second.'), 'Short one')

// Drag-to-scroll (owner review 2026-10-23, #6): a mouse press on the strip scrolls it once it has travelled STRIP_DRAG_PX; under that it stays a tap on a card
// (no scrollLeft is written, the click goes through); past it the strip follows the pointer, scrolling against the drag, and keeps following back under the threshold.
assert.equal(STRIP_DRAG_PX, 6)
const d = stripDragStart(300, 120)
assert.deepEqual(d, { x0: 300, scroll0: 120, dragging: false })
let r = stripDragMove(d, 303)
assert.equal(r.scrollLeft, null, 'a tremor of 3 px is still a tap'); assert.equal(r.drag.dragging, false)
r = stripDragMove(r.drag, 296)
assert.equal(r.scrollLeft, null, 'and 4 px the other way too')
r = stripDragMove(r.drag, 310)
assert.equal(r.drag.dragging, true, '10 px: a drag'); assert.equal(r.scrollLeft, 110, 'the content follows the pointer to the right: scrollLeft falls')
r = stripDragMove(r.drag, 250)
assert.equal(r.scrollLeft, 170, 'to the left: it rises')
r = stripDragMove(r.drag, 301)
assert.equal(r.scrollLeft, 119, 'back within the threshold a started drag still follows (no snap back to a tap)')
assert.equal(stripDragMove(stripDragStart(300, 0), 294).scrollLeft, 6, 'exactly STRIP_DRAG_PX starts it')
// Only the primary mouse (or pen) button takes the strip; a finger pans the native scroller itself, and a right or middle button does nothing.
assert.equal(stripDragTakes('mouse', 0), true)
assert.equal(stripDragTakes('pen', 0), true)
assert.equal(stripDragTakes('touch', 0), false)
assert.equal(stripDragTakes('mouse', 1), false)
assert.equal(stripDragTakes('mouse', 2), false)
// The wiring (the event handling itself is scripts/strip-drag.test.mts): the strip gets attachStripDrag, the pictures are not draggable, the sheet is never the camera's.
import { readFileSync } from 'node:fs'
const nav = readFileSync(new URL('../src/ui/navigator.ts', import.meta.url), 'utf8')
assert.match(nav, /attachStripDrag\(listEl\)/)
assert.match(nav, /img\.draggable = false/, 'the browser does not lift the picture instead')
assert.match(nav, /sheet\.dataset\.noDrag = ''/, 'the sheet is never handed to the camera (camera/controls.ts eligibleOverlay)')
const pins = readFileSync(new URL('../src/ui/pins.css', import.meta.url), 'utf8')
assert.match(pins, /\.viewpoints-list \{[^}]*touch-action: pan-x;[^}]*pointer-events: auto;[^}]*user-select: none;/, 'a finger still pans; the whole box takes the pointer')
assert.match(pins, /\.viewpoints-list\.dragging \{ scroll-snap-type: none;/, 'a snap container re-snaps every scrollLeft write: snapping is off while the pointer holds the strip')
const navCss = readFileSync(new URL('../src/ui/navigator.css', import.meta.url), 'utf8')
assert.match(navCss, /\.nav-card\.cur \.nav-pic \{[^}]*border-color:[^}]*\}/, 'the selected treatment is on the picture')
assert.doesNotMatch(navCss, /\.nav-card\.cur\s*\{[^}]*outline|\.nav-card\.cur\s*\{[^}]*box-shadow/, 'no selected ring around the text')
assert.match(navCss, /\.nav-subs \{[^}]*width: max-content;[^}]*max-width: min\(640px, 86vw\);/, 'sub-views run in one row past their card, wrapping only past 640 px')
assert.match(navCss, /\.bar-sheet\.viewpoints-sheet \.nav-subs > button \{[^}]*min-height: 28px;/, 'sub-view chips are compact')
console.log('viewpoint-cards: ok')
