// The Labels layer's write path in motion (labelfast): a scripted flight and a still frame on a fake DOM that counts every write and every layout read.
// Still frame: 0 writes. Flight: far fewer writes than the old path (`?labelfast=0`). Rendered values equal the old path's to the device-pixel quantum.
// No layout read inside a frame. npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`export async function load(url, ctx, next) { if (url.endsWith('.css')) return { format: 'module', source: 'export default {}', shortCircuit: true }; return next(url, ctx) }`))

// ---- A fake DOM: elements with attributes, style, classes, dataset, children; every mutation and every layout read is counted.
// `calls`: every DOM write the code makes, changing the value or not (each one builds a string, crosses into the browser and is parsed).
// `writes`: only those that change what the element holds (what the browser then restyles). Layout reads: `reads`.
const counts = { calls: 0, writes: 0, reads: 0 }
const mark = (): void => { counts.writes++ }
const call = (): void => { counts.calls++ }
function recording<T extends object>(target: T): T {
  return new Proxy(target, { set(o, k, v) { call(); if ((o as Record<string | symbol, unknown>)[k] !== v) mark(); (o as Record<string | symbol, unknown>)[k] = v; return true } })
}
class FakeEl {
  attrs = new Map<string, string>()
  children: FakeEl[] = []
  parent: FakeEl | null = null
  style = recording({} as Record<string, string>)
  dataset = recording({} as Record<string, string>)
  classes = new Set<string>()
  listeners = new Map<string, Array<(e: unknown) => void>>()
  private _hidden = false
  private _inert = false
  private _tab = 0
  private _text = ''
  innerHTMLValue = ''
  className = ''
  id = ''
  type = ''
  value = ''
  autocomplete = ''
  placeholder = ''
  constructor(readonly tag: string) {}
  get classList() {
    return {
      add: (...c: string[]) => { for (const x of c) { call(); if (!this.classes.has(x)) { this.classes.add(x); mark() } } },
      toggle: (c: string, force?: boolean) => { call(); const want = force ?? !this.classes.has(c); if (want !== this.classes.has(c)) { if (want) this.classes.add(c); else this.classes.delete(c); mark() } return want },
    }
  }
  get hidden() { return this._hidden }
  set hidden(v: boolean) { call(); if (v !== this._hidden) mark(); this._hidden = v }
  get inert() { return this._inert }
  set inert(v: boolean) { call(); if (v !== this._inert) mark(); this._inert = v }
  get tabIndex() { return this._tab }
  set tabIndex(v: number) { call(); if (v !== this._tab) mark(); this._tab = v }
  get textContent() { return this._text }
  set textContent(v: string) { call(); this._text = v; mark() }
  set innerHTML(v: string) { call(); this.innerHTMLValue = v; mark() }
  get offsetWidth() { counts.reads++; return 200 }
  get offsetHeight() { counts.reads++; return 40 }
  getBoundingClientRect() { counts.reads++; return { left: 12, top: 12, right: 292, bottom: 54, width: 280, height: 42 } }
  setAttribute(k: string, v: string): void { call(); if (this.attrs.get(k) !== v) mark(); this.attrs.set(k, v) }
  getAttribute(k: string): string | null { return this.attrs.get(k) ?? null }
  append(...kids: FakeEl[]): void { for (const k of kids) { k.parent = this; this.children.push(k) } mark() }
  replaceChildren(...kids: FakeEl[]): void { this.children = []; this.append(...kids) }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; mark() }
  closest(): null { return null }
  addEventListener(t: string, f: (e: unknown) => void): void { const l = this.listeners.get(t) ?? []; l.push(f); this.listeners.set(t, l) }
  fire(t: string, e: unknown = {}): void { for (const f of this.listeners.get(t) ?? []) f(e) }
  getContext(): null { return null }
  all(): FakeEl[] { return [this, ...this.children.flatMap((c) => c.all())] }
}
let clock = 1000
const win = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener: () => undefined }
const doc = { createElement: (t: string) => new FakeEl(t), createElementNS: (_n: string, t: string) => new FakeEl(t), documentElement: new FakeEl('html'), activeElement: null }
Object.assign(globalThis, { window: win, document: doc, Element: FakeEl, requestAnimationFrame: () => 1, getComputedStyle: () => { counts.reads++; return { fontSize: '16px', fontFamily: 'sans-serif' } } })
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true })
Object.defineProperty(globalThis, 'matchMedia', { value: undefined, configurable: true })

const { mountLabels, labelFastFromSearch, labelThinFromSearch, labelSpreadFromSearch } = await import('../src/ui/labels.ts')

// ---- A scripted flight around the Moon: the camera orbits and descends; a still frame is the same pose held.
const v = (x: number, y: number, z: number) => ({ x, y, z })
function frame(angleDeg: number, dist: number, moving = false) {
  const a = angleDeg * Math.PI / 180
  const pos = v(Math.sin(a) * dist, 0.25 * dist, Math.cos(a) * dist)
  const len = Math.hypot(pos.x, pos.y, pos.z)
  const back = v(pos.x / len, pos.y / len, pos.z / len)
  const right = v(back.z, 0, -back.x)
  const rl = Math.hypot(right.x, right.z)
  right.x /= rl; right.z /= rl
  const up = v(back.y * right.z - back.z * right.y, back.z * right.x - back.x * right.z, back.x * right.y - back.y * right.x)
  const e = { moonX: v(1, 0, 0), moonY: v(0, 0, -1), moonZ: v(0, 1, 0), subSolar: { lon: 20, lat: 2 } }
  return { cam: { pos, back, right, up, tanHalf: Math.tan(15 * Math.PI / 180) }, aspect: 1280 / 720, e, dist, fovDeg: 30, hidden: false, blocked: [] as Array<[number, number, number, number]>, moving } as never
}
const noHost = { select: () => undefined, search: () => undefined, highlight: () => undefined }
const mount = (fast: boolean, dpr = 1) => { win.devicePixelRatio = dpr; const root = new FakeEl('div'); const api = mountLabels(root as never, noHost, true, fast); return { root, api, dpr } }
const buttons = (root: FakeEl): Map<string, FakeEl> => new Map(root.all().filter((e) => e.tag === 'button' && e.dataset.label).map((e) => [e.dataset.label, e]))
const groups = (root: FakeEl): Map<string, FakeEl> => new Map(root.all().filter((e) => e.tag === 'g' && e.dataset.label).map((e) => [e.dataset.label, e]))
const nums = (s: string): number[] => (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)

const FLIGHT = Array.from({ length: 150 }, (_, i) => frame(-30 + i * 0.5, 2.2 - i * 0.004, true))
function run(m: ReturnType<typeof mount>, frames: unknown[], each?: () => void): void {
  for (const f of frames) { clock += 16; win.devicePixelRatio = m.dpr; m.api.update(f as never); each?.() }
}

// The switch reader.
assert.equal(labelFastFromSearch(''), true)
assert.equal(labelFastFromSearch('?labelfast=0'), false)
assert.equal(labelFastFromSearch('?labelfast=1&x=2'), true)
assert.equal(labelThinFromSearch(''), true)
assert.equal(labelThinFromSearch('?labelthin=0'), false)
assert.equal(labelThinFromSearch('?labelthin=1&x=2'), true)
assert.equal(labelSpreadFromSearch(''), true)
assert.equal(labelSpreadFromSearch('?labelspread=0'), false)
assert.equal(labelSpreadFromSearch('?labelspread=1&x=2'), true)

// ---- The centre fill at the complaint's pose (owner 2026-10-22; sub-camera near 83 E, 14 N, 2.5 R): the curated rows there are
// tier 3, so without the fill (`?labelspread=0`) the middle third is empty while the edges carry names; with it the middle third
// carries a name (the Gazetteer is not loaded here: the curated fill alone), drawn, and the edges keep theirs.
{
  type Thirds = Record<'left' | 'centre' | 'right', { placed: string[]; dropped: string[] }>
  const east = frame(173, 2.5)
  const got = new Map<boolean, { thirds: Thirds; candidates: Array<{ id: string; fill: boolean; placed: boolean; why?: string }>; visible: string[] }>()
  for (const spread of [true, false]) {
    clock = 20000
    const root = new FakeEl('div')
    const api = mountLabels(root as never, noHost, true, true, true, spread)
    for (let i = 0; i < 120; i++) { clock += 16; api.update(east as never) }
    const d = api.debug() as { thirds: Thirds; candidates: Array<{ id: string; fill: boolean; placed: boolean; why?: string }> }
    got.set(spread, { ...d, visible: api.visibleIds() })
  }
  const off = got.get(false)!, on = got.get(true)!
  assert.ok(off.thirds.left.placed.length + off.thirds.right.placed.length >= 4, `the edges carry names (${off.thirds.left.placed.length} + ${off.thirds.right.placed.length})`)
  assert.equal(off.thirds.centre.placed.length, 0, 'labelspread=0: the middle third is empty')
  assert.ok(off.candidates.every((c) => !c.fill), 'labelspread=0 offers no fill candidates')
  assert.ok(on.thirds.centre.placed.length >= 1, `the fill puts a name in the middle third (${on.thirds.centre.placed.join(' ')})`)
  const fills = on.candidates.filter((c) => c.fill && c.placed).map((c) => c.id)
  // Since 2026-10-24 the fill works per grid cell over the disc (owner: names crowd the rim, none in the centre), so a fill may
  // stand in any empty cell, not only the middle third: every placed fill is drawn, and one of them stands in the middle third.
  assert.ok(fills.length >= 1 && fills.every((id) => on.visible.includes(id)), `fill names are drawn (${fills.join(' ')})`)
  assert.ok(fills.some((id) => on.thirds.centre.placed.includes(id)), `a fill name stands in the middle third (${fills.join(' ')})`)
  assert.deepEqual(off.thirds.left.placed, on.thirds.left.placed.filter((id) => off.thirds.left.placed.includes(id)), 'the edges keep their names')
  assert.ok(on.candidates.filter((c) => !c.placed).every((c) => c.why), 'every dropped candidate carries its reason')
}

const still = frame(-30 + 75 * 0.5, 1.9)
const result: Record<string, { flightCalls: number; flight: number; stillCalls: number; still: number; reads: number }> = {}
for (const fast of [true, false]) {
  clock = 1000
  const m = mount(fast)
  run(m, [frame(-30, 2.2)])
  run(m, FLIGHT.slice(0, 20)) // warm-up: names are made and fade in
  counts.calls = 0; counts.writes = 0; counts.reads = 0
  run(m, FLIGHT.slice(20))
  const flightCalls = counts.calls, flightWrites = counts.writes, flightReads = counts.reads
  assert.ok(m.api.visibleIds().length >= 6, `${fast ? 'fast' : 'old'}: names are drawn (${m.api.visibleIds().length})`)
  run(m, Array(220).fill(still)) // settle: fades done, slides eased
  counts.calls = 0; counts.writes = 0; counts.reads = 0
  run(m, Array(30).fill(still))
  result[fast ? 'fast' : 'old'] = { flightCalls, flight: flightWrites, stillCalls: counts.calls, still: counts.writes, reads: flightReads + counts.reads }
}
console.log('labels-motion writes', JSON.stringify(result))
assert.equal(result.fast.stillCalls, 0, 'a still frame makes no DOM write call')
assert.equal(result.fast.still, 0)
assert.ok(result.old.stillCalls > 100, `the old path rewrites every value on a still frame (${result.old.stillCalls} calls)`)
assert.equal(result.fast.reads, 0, 'no layout read in any frame after the first')
assert.ok(result.old.reads > 100, 'the old path reads layout every frame (the counter works)')
assert.ok(result.fast.flightCalls * 2 <= result.old.flightCalls, `in a flight the fast path makes at most half the DOM write calls (${result.fast.flightCalls} against ${result.old.flightCalls})`)
assert.ok(result.fast.flight <= result.old.flight, 'and never more value changes')

// ---- The rendered values equal the old path's to the device-pixel quantum.
for (const dpr of [1, 2, 3]) {
  clock = 5000
  const a = mount(true, dpr), b = mount(false, dpr)
  const q = 0.5 / dpr + 0.051 // half a device pixel, plus the old path's own 0.1 rounding
  let compared = 0
  const frames = [frame(-30, 2.2), ...FLIGHT, ...Array(60).fill(still)]
  for (const f of frames) {
    clock += 16
    win.devicePixelRatio = dpr
    a.api.update(f as never); b.api.update(f as never)
    assert.deepEqual(a.api.visibleIds(), b.api.visibleIds(), 'the same names are drawn')
    const ba = buttons(a.root), bb = buttons(b.root), ga = groups(a.root), gb = groups(b.root)
    assert.deepEqual([...ba.keys()].sort(), [...bb.keys()].sort(), 'the same elements exist')
    for (const [id, x] of ba) {
      const y = bb.get(id) as FakeEl
      const pxs = (t: string): number[] => [...t.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
      const tx = pxs(x.style.transform), ty = pxs(y.style.transform)
      assert.equal(tx.length, 2); assert.equal(ty.length, 2)
      tx.slice(0, 2).forEach((n, i) => assert.ok(Math.abs(n - ty[i]) <= q, `${id} translate ${n} vs ${ty[i]} at dpr ${dpr}`))
      assert.ok(Math.abs(Number(x.style.opacity) - Number(y.style.opacity)) <= 0.003, `${id} opacity ${x.style.opacity} vs ${y.style.opacity}`)
      assert.equal(x.style.width, y.style.width); assert.equal(x.dataset.side, y.dataset.side); assert.equal(x.tabIndex, y.tabIndex)
      const gx = ga.get(id) as FakeEl, gy = gb.get(id) as FakeEl
      const [px_, py_] = [gx.children[0], gy.children[0]]
      const dx = nums(px_.attrs.get('d') ?? ''), dy = nums(py_.attrs.get('d') ?? '')
      assert.equal(dx.length, dy.length, `${id} path shape`)
      dx.forEach((n, i) => assert.ok(Math.abs(n - dy[i]) <= q, `${id} path ${n} vs ${dy[i]}`))
      const ix = nums(gx.children[1].attrs.get('transform') ?? ''), iy = nums(gy.children[1].attrs.get('transform') ?? '')
      assert.equal(ix.length, 2); assert.equal(iy.length, 2)
      ix.forEach((n, i) => assert.ok(Math.abs(n - iy[i]) <= q, `${id} icon ${i}`))
      assert.ok(Math.abs(Number(gx.style.opacity) - Number(gy.style.opacity)) <= 0.003)
      compared++
    }
  }
  assert.ok(compared > 500, `compared ${compared} drawn names at dpr ${dpr}`)
}

// ---- No two drawn names overlap in any frame of the flight or the settle, fading ones included (review 2026-10-23): the boxes
// the layer draws (`debug().drawn`: eased, settled by settleMoves, the leaving names where they are drawn) are checked pairwise
// every frame, including pairs of names that are both leaving.
{
  clock = 30000
  const m = mount(true)
  const ov = (a: number[], b: number[]): boolean => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
  let frames = 0, drawnTotal = 0, movingPairs = 0, leavingPairs = 0
  const bad: string[] = []
  const check = (): void => {
    const d = (m.api.debug() as { drawn: Array<{ id: string; box: number[]; leaving: boolean }> }).drawn
    frames++; drawnTotal += d.length
    for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) {
      if (!ov(d[i].box, d[j].box)) continue
      if (d[i].leaving && d[j].leaving) leavingPairs++
      movingPairs++
      if (bad.length < 5) bad.push(`${d[i].id}${d[i].leaving ? '(leaving)' : ''} x ${d[j].id}${d[j].leaving ? '(leaving)' : ''} at frame ${frames}`)
    }
  }
  run(m, [frame(-30, 2.2), ...FLIGHT, ...Array(80).fill(still), ...FLIGHT.slice().reverse(), ...Array(80).fill(still)], check)
  assert.ok(drawnTotal / frames >= 6, `names are drawn through the run (${(drawnTotal / frames).toFixed(1)} per frame)`)
  assert.equal(movingPairs, 0, `a drawn name never overlaps another (${movingPairs} pairs over ${frames} frames: ${bad.join('; ')})`)
  console.log('labels-motion overlap', JSON.stringify({ frames, perFrame: +(drawnTotal / frames).toFixed(1), leavingPairs }))
}

// ---- A hovered name: the card is placed without a layout read in the frame, and a still hovered frame writes nothing.
{
  clock = 9000
  const m = mount(true)
  run(m, Array(120).fill(still))
  const first = [...buttons(m.root).values()][0]
  first.fire('pointerenter')
  counts.reads = 0
  run(m, Array(60).fill(still))
  assert.equal(counts.reads, 0, 'a hovered frame reads no layout')
  counts.calls = 0
  run(m, Array(30).fill(still))
  assert.equal(counts.calls, 0, 'a still hovered frame makes no write call')
}

// ---- Forced-layout pin: the frame function itself names no layout-reading call except on the lines kept for the old path.
{
  const src = readFileSync(new URL('../src/ui/labels.ts', import.meta.url), 'utf8')
  const a = src.indexOf('function stepInner('), b = src.indexOf('let debugSource')
  assert.ok(a > 0 && b > a)
  const body = src.slice(a, b).split('\n').filter((l) => !l.includes('labelfast=0')).join('\n')
  for (const bad of ['getComputedStyle', 'getBoundingClientRect', 'offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'clientWidth', 'clientHeight', 'scrollTop', 'scrollWidth', 'innerWidth', 'innerHeight', 'getClientRects'])
    assert.ok(!body.includes(bad), `stepInner reads layout through ${bad}`)
  for (const bad of ['style.left', 'style.top', '.left =', '.top ='])
    assert.ok(!body.includes(bad), `stepInner positions with ${bad}`)
}
console.log('labels-motion.test ok')
