// First-visit hotspots: when they show, what is remembered, the layout pass, and that the overlay has no loop of its own.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { projectPinTo } from '../src/ui/pinMath.ts'
import { HOTSPOTS } from '../src/hotspots.ts'
import { needsMove, SEEN_KEY, VISITED_KEY, hotspotsMode, layoutHotspots, readRemembered, writeSeen, writeVisited, type GateInput, type StoreLike } from '../src/ui/firstHotspots.ts'

const gate = (q: string, o: Partial<GateInput> = {}): GateInput => ({ params: new URLSearchParams(q), still: false, archive: false, debug: false, automated: false, seen: false, ...o })

// Gate.
assert.equal(hotspotsMode(gate('')), 'first')
assert.equal(hotspotsMode(gate('', { seen: true })), 'off', 'second load')
assert.equal(hotspotsMode(gate('?view=earth')), 'off', 'shared link')
assert.equal(hotspotsMode(gate('?lon=10&lat=5&dist=2')), 'off')
assert.equal(hotspotsMode(gate('?pin=pin-tycho')), 'off')
assert.equal(hotspotsMode(gate('?moment=apollo11')), 'off')
assert.equal(hotspotsMode(gate('?panorama=1')), 'off')
assert.equal(hotspotsMode(gate('', { still: true })), 'off')
assert.equal(hotspotsMode(gate('?hotspots=1', { still: true })), 'off', 'still wins over the switch')
assert.equal(hotspotsMode(gate('', { archive: true })), 'off')
assert.equal(hotspotsMode(gate('', { debug: true })), 'off')
assert.equal(hotspotsMode(gate('', { automated: true })), 'off', 'the rig gets the bare page')
assert.equal(hotspotsMode(gate('?hotspots=1', { automated: true })), 'forced')
assert.equal(hotspotsMode(gate('?hotspots=1', { seen: true })), 'forced', 'forced ignores seen')
assert.equal(hotspotsMode(gate('?hotspots=1&view=earth')), 'forced')
assert.equal(hotspotsMode(gate('?hotspots=1', { archive: true })), 'off')
assert.equal(hotspotsMode(gate('?hotspots=0')), 'off')

// Storage.
const mem = (): StoreLike & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) } } }
{
  const s = mem()
  assert.deepEqual(readRemembered(() => s), { seen: false, visited: [] })
  assert.equal(writeSeen(() => s), true)
  assert.equal(writeVisited(() => s, new Set(['pin-tycho', 'pin-earthrise'])), true)
  assert.equal(s.m.get(SEEN_KEY), '1')
  assert.deepEqual(readRemembered(() => s), { seen: true, visited: ['pin-tycho', 'pin-earthrise'] })
  s.m.set(VISITED_KEY, '{bad'); assert.deepEqual(readRemembered(() => s).visited, [], 'bad JSON')
  s.m.set(VISITED_KEY, '[1,"a",null]'); assert.deepEqual(readRemembered(() => s).visited, ['a'])
}
{
  const boom = (): StoreLike => { throw new Error('SecurityError') }
  assert.deepEqual(readRemembered(boom), { seen: false, visited: [] }, 'a throwing store reads as a first load')
  assert.equal(writeSeen(boom), false)
  assert.equal(writeVisited(boom, ['a']), false)
  assert.deepEqual(readRemembered(() => null), { seen: false, visited: [] })
  const ro: StoreLike = { getItem: () => null, setItem: () => { throw new Error('quota') } }
  assert.equal(writeSeen(() => ro), false)
}

// Layout.
{
  const none: readonly [number, number, number, number][] = []
  const P = (id: string, x: number, y: number) => ({ id, x, y, labelW: 90 })
  const a = layoutHotspots([P('a', 200, 200), P('b', 230, 210), P('c', 400, 200)], 800, none)
  assert.deepEqual(a.map((p) => p.id), ['a', 'c'], 'b is under 56 px from a: dropped, not moved')
  assert.ok(a.every((p) => p.label && !p.left))
  const edge = layoutHotspots([P('a', 760, 200)], 800, none)
  assert.equal(edge[0].left, true, 'no room at the right: label flips')
  const bar = layoutHotspots([P('a', 200, 700), P('b', 200, 300)], 800, [[0, 680, 800, 900]])
  assert.deepEqual(bar.map((p) => p.id), ['b'], 'a ring under the bar or caption is dropped')
  const cap = layoutHotspots([P('a', 100, 100), P('b', 300, 100)], 800, [[190, 90, 300, 110]])
  assert.equal(cap.find((p) => p.id === 'a')?.label, false, 'label meeting the caption is left off, the ring stays')
  const close = layoutHotspots([P('a', 100, 100), P('b', 200, 100)], 800, none)
  assert.equal(close[1].label, true)
  const clash = layoutHotspots([{ id: 'a', x: 100, y: 100, labelW: 150 }, { id: 'b', x: 270, y: 100, labelW: 90 }], 800, none)
  assert.equal(clash[1].left, false)
  assert.equal(clash[1].label, true)
  assert.equal(layoutHotspots([], 800, none).length, 0)
}

// A ring never placed (NaN) must be moved: the NaN comparison bug left every ring at the corner.
assert.equal(needsMove(NaN, NaN, 100, 100), true)
assert.equal(needsMove(100, 100, 100.02, 100), false)
assert.equal(needsMove(100, 100, 101, 100), true)
// The hotspots with a ring are the pinned ones; the Earth view is a view, not a place.
assert.ok(!HOTSPOTS.filter((h) => h.pinned !== false).some((h) => h.id === 'pin-earth'))
// A camera at Home (3.6 radii, looking at the centre): a point on the near side gets a finite position inside the viewport.
{
  const cam = { pos: { x: 3.6, y: 0, z: 0 }, back: { x: 1, y: 0, z: 0 }, right: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 }, tanHalf: Math.tan(15 * Math.PI / 180) } as never
  const out = { x: NaN, y: NaN }
  const n = Math.hypot(0.9, 0.3, 0.2)
  assert.equal(projectPinTo(out, cam, 1.6, 0.9 / n, 0.3 / n, 0.2 / n, 1280, 800), true)
  assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y) && out.x > 0 && out.x < 1280 && out.y > 0 && out.y < 800)
  assert.equal(projectPinTo(out, cam, 1.6, -1, 0, 0, 1280, 800), false, 'far side')
}

// The overlay has no loop of its own: it runs only when the frame loop calls update(), so a sleeping loop means no work here.
for (const f of ['../src/ui/firstHotspotsView.ts', '../src/ui/firstHotspots.ts']) {
  const src = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  assert.ok(!/requestAnimationFrame|setInterval|setTimeout|ResizeObserver|MutationObserver/.test(src), `${f} must not schedule its own work`)
}
console.log('first-hotspots ok')
