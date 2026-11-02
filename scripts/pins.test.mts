/** Pin layout: every shown pin has its label, edges flip, clashes hide (ui/pinLayout.ts), and the hotspot set's shape. tsx scripts/pins.test.mts */
import assert from 'node:assert/strict'
import { pinBoxes, placePins } from '../src/ui/pinLayout.ts'
import { HOTSPOTS } from '../src/hotspots.ts'

// Room on the right: label right. At the right edge: label left. Squeezed both ways: no placement.
assert.deepEqual(pinBoxes(100, 100, 80, 375).map((b) => b.left), [false, true])
assert.deepEqual(pinBoxes(340, 100, 80, 375).map((b) => b.left), [true])
assert.deepEqual(pinBoxes(30, 100, 80, 100), [])

// The WP2 phone shot (375 wide): the home pins at their screen positions. No pin is left as a bare dot: each is placed with a label side or hidden.
const wText = (label: string): number => label.length * 6.6 + 30
const home = [
  { id: 'apollo17', label: 'Apollo 17', x: 250, y: 273 },
  { id: 'copernicus', label: 'Copernicus', x: 137, y: 295 },
  { id: 'apollo11', label: 'Apollo 11', x: 240, y: 316 },
  { id: 'earth', label: 'From Earth', x: 187, y: 330 },
  { id: 'tycho', label: 'Tycho', x: 166, y: 413 },
  { id: 'earthrise', label: 'Earthrise', x: 306, y: 328 },
]
const placed = placePins(home.map((p) => ({ id: p.id, x: p.x, y: p.y, wText: wText(p.label) })), 375)
for (const [id, fit] of placed) if (fit) assert.ok(fit.box[2] - fit.box[0] > 30, `${id}: a label's room`)
assert.ok(placed.get('apollo17'), 'the first pin is shown')
// The limb pin cannot put its label on the right and would sit on Apollo 11's on the left: hidden, not a dot.
assert.equal(placed.get('earthrise'), null)
const shown = [...placed.values()].filter(Boolean) as Array<{ box: [number, number, number, number] }>
for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
  const a = shown[i].box, b = shown[j].box
  assert.ok(!(a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]), 'no two shown pins overlap')
}

// The set: From Earth and Apollo 17 at eye level are views of the viewpoint list, not drawn on the Moon; the rest are places on it.
const earth = HOTSPOTS.find((h) => h.id === 'pin-earth')
assert.equal(earth?.pinned, false)
const listOnly = new Set(['pin-earth', 'pin-apollo17-eye'])
assert.ok(HOTSPOTS.filter((h) => !listOnly.has(h.id)).every((h) => h.pinned !== false))
assert.ok(HOTSPOTS.filter((h) => listOnly.has(h.id)).every((h) => h.pinned === false))
// Apollo 17 is the fixed-module ground view; Apollo 11 is the site end with no ground landing.
const a17 = HOTSPOTS.find((h) => h.id === 'pin-apollo17')
assert.equal(a17?.fixed, true); assert.equal(a17?.groundEnd, 'eye'); assert.equal(a17?.needsPatch, 'a17')
const a11 = HOTSPOTS.find((h) => h.id === 'pin-apollo11')
assert.equal(a11?.groundEnd, undefined); assert.ok(!a11?.fixed)
console.log('pins.test ok')
