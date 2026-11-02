// The label layer must stop scheduling its own frames when inputs and animation have settled.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { FADE_OUT_MS, leavingLabelReleased, stepLives, type Life } from '../src/labels/postLayout.ts'

register('data:text/javascript,' + encodeURIComponent(`export async function load(url, ctx, next) { if (url.endsWith('.css')) return { format: 'module', source: 'export default {}', shortCircuit: true }; return next(url) }`))

class FakeEl {
  attrs = new Map<string, string>()
  children: FakeEl[] = []
  parent: FakeEl | null = null
  style: Record<string, string> = {}
  dataset: Record<string, string> = {}
  classes = new Set<string>()
  listeners = new Map<string, Array<(event: unknown) => void>>()
  hidden = false
  inert = false
  tabIndex = 0
  textContent = ''
  className = ''
  id = ''
  type = ''
  value = ''
  autocomplete = ''
  placeholder = ''
  constructor(readonly tag: string) {}
  get classList() {
    return {
      add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
      toggle: (name: string, force?: boolean) => { const on = force ?? !this.classes.has(name); if (on) this.classes.add(name); else this.classes.delete(name); return on },
    }
  }
  append(...kids: FakeEl[]): void { for (const kid of kids) { kid.parent = this; this.children.push(kid) } }
  replaceChildren(...kids: FakeEl[]): void { this.children = []; this.append(...kids) }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null }
  setAttribute(key: string, value: string): void { this.attrs.set(key, value) }
  getAttribute(key: string): string | null { return this.attrs.get(key) ?? null }
  addEventListener(type: string, listener: (event: unknown) => void): void { const list = this.listeners.get(type) ?? []; list.push(listener); this.listeners.set(type, list) }
  fire(type: string): void { for (const listener of this.listeners.get(type) ?? []) listener({}) }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  get offsetWidth() { return 200 }
  get offsetHeight() { return 40 }
  getContext() { return null }
  closest() { return null }
  all(): FakeEl[] { return [this, ...this.children.flatMap((child) => child.all())] }
}

let clock = 1000
let nextFrame = 1
const frames = new Map<number, FrameRequestCallback>()
const win = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener: () => undefined }
const doc = { createElement: (tag: string) => new FakeEl(tag), createElementNS: (_ns: string, tag: string) => new FakeEl(tag), documentElement: new FakeEl('html'), activeElement: null }
Object.assign(globalThis, {
  window: win,
  document: doc,
  Element: FakeEl,
  requestAnimationFrame: (callback: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, callback); return id },
  getComputedStyle: () => ({ fontSize: '16px', fontFamily: 'sans-serif' }),
})
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true })
Object.defineProperty(globalThis, 'matchMedia', { value: undefined, configurable: true })

const { mountLabels } = await import('../src/ui/labels.ts')
// A cached placement must be invalidated after a departing label stops reserving its old rectangle.
{
  const lives = new Map<string, Life>([['departing', { alpha: 0.1, target: 0, eligible: false, appeared: true, readySince: Infinity, slotKey: 'r1', rect: [40, 40, 140, 60] }]])
  const leaving = new Set(['departing'])
  assert.equal(leavingLabelReleased(leaving, lives), false, 'a fading label still blocks its rectangle')
  lives.get('departing')!.target = 1
  assert.equal(leavingLabelReleased(leaving, lives), true, 'a label that becomes placeable stops blocking its old rectangle')
  lives.get('departing')!.target = 0
  stepLives(lives, new Map(), FADE_OUT_MS, FADE_OUT_MS)
  assert.equal(leavingLabelReleased(leaving, lives), true, 'finishing the fade releases its stale placement blocker')
}
const css = readFileSync(new URL('../src/ui/labels.css', import.meta.url), 'utf8')
assert.match(css, /\.moon-labels\.ml-fast \.ml-svg \{[^}]*filter: drop-shadow\(0 0 1\.5px/, 'the fast path keeps the established whole-SVG shadow')
assert.match(css, /\.ml-post \{[^}]*filter: drop-shadow\(0 0 1\.5px/, 'the legacy path keeps the established post shadow')
assert.match(css, /\.ml-halo \{[^}]*stroke-width: 3\.6;/, 'icons keep their established explicit halo')
assert.doesNotMatch(css, /ml-post-halo/, 'no extra post halo stacks with the established shadow')
const v = (x: number, y: number, z: number) => ({ x, y, z })
const dist = 2.2
const angle = -30 * Math.PI / 180
const pos = v(Math.sin(angle) * dist, 0.25 * dist, Math.cos(angle) * dist)
const len = Math.hypot(pos.x, pos.y, pos.z)
const back = v(pos.x / len, pos.y / len, pos.z / len)
const right = v(back.z, 0, -back.x)
const rightLen = Math.hypot(right.x, right.z)
right.x /= rightLen; right.z /= rightLen
const up = v(back.y * right.z - back.z * right.y, back.z * right.x - back.x * right.z, back.x * right.y - back.y * right.x)
const frame = {
  cam: { pos, back, right, up, tanHalf: Math.tan(15 * Math.PI / 180) },
  aspect: 1280 / 720,
  e: { moonX: v(1, 0, 0), moonY: v(0, 0, -1), moonZ: v(0, 1, 0), subSolar: { lon: 20, lat: 2 } },
  dist,
  fovDeg: 5,
  hidden: false,
  blocked: [],
} as never
const root = new FakeEl('div')
const api = mountLabels(root as never, { select: () => undefined, search: () => undefined, highlight: () => undefined }, true, true)
api.update(frame)
await Promise.resolve()
for (let i = 0; i < 80 && frames.size; i++) {
  const [id, callback] = frames.entries().next().value as [number, FrameRequestCallback]
  frames.delete(id)
  clock += 16.7
  callback(clock)
  await Promise.resolve()
}
const firstLabel = root.all().find((el) => el.tag === 'button' && el.dataset.label)
assert.ok(firstLabel, 'a visible label is available to hover')
// Put placement and Gazetteer refreshes at different phases before the hover invalidates placement.
clock += 8.3
api.update({ ...frame, moving: true })
clock += 8.3
api.update({ ...frame, moving: false })
firstLabel.fire('pointerenter')
firstLabel.fire('pointerleave')
await Promise.resolve()

let callbacks = 0
while (frames.size && callbacks < 1200) {
  const [id, callback] = frames.entries().next().value as [number, FrameRequestCallback]
  frames.delete(id)
  clock += 16.7
  callback(clock)
  callbacks++
  await Promise.resolve()
}
assert.ok(callbacks < 1200, `the idle scheduler stops after the motion rest delay and fades settle (${callbacks} callbacks)`)
assert.equal(frames.size, 0, 'no callback remains queued after the layer settles')
console.log(`labels-scheduler: stopped after ${callbacks} callbacks`)
