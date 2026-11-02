// The debug Switches panel: absent without ?debug=1 (and in a capture), present with it, lists every offered switch, builds the right URLs for
// click / reset / copy, hides the restricted switch in a production build, and is keyboard reachable (real buttons, Escape closes).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { debugEnabled } from '../src/debug/gate.ts'
import { DEV_SWITCHES } from '../src/debug/devSwitches.ts'
import { mountSwitches } from '../src/debug/panel.ts'
import { SWITCHES, allDefaults, panelRows } from '../src/debug/switches.ts'

/** Just enough DOM for the panel: elements with attributes, children, text, listeners, hidden, remove, focus. */
class FakeEl {
  attrs = new Map<string, string>()
  children: FakeEl[] = []
  listeners = new Map<string, Array<(e: unknown) => void>>()
  parent: FakeEl | null = null
  textContent = ''
  hidden = false
  focused = false
  constructor(readonly tag: string) {}
  setAttribute(k: string, v: string): void { this.attrs.set(k, v) }
  removeAttribute(k: string): void { this.attrs.delete(k) }
  hasAttribute(k: string): boolean { return this.attrs.has(k) }
  getAttribute(k: string): string | null { return this.attrs.get(k) ?? null }
  append(...kids: FakeEl[]): void { for (const k of kids) { k.parent = this; this.children.push(k) } }
  addEventListener(t: string, f: (e: unknown) => void): void { const l = this.listeners.get(t) ?? []; l.push(f); this.listeners.set(t, l) }
  fire(t: string, e: unknown = {}): void { for (const f of this.listeners.get(t) ?? []) f(e) }
  focus(): void { this.focused = true }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null }
  all(): FakeEl[] { return [this, ...this.children.flatMap((c) => c.all())] }
  text(): string { return this.textContent + this.children.map((c) => c.text()).join(' ') }
}
let labelled = false
const makeDoc = () => {
  const head = new FakeEl('head'), body = new FakeEl('body')
  const doc = { head, body, getElementById: (id: string) => (labelled && id === 'review-label' ? new FakeEl('div') : null), createElement: (t: string) => new FakeEl(t) }
  return { doc: doc as unknown as Document, body, head }
}
const HREF = 'https://x.test/moon/index.html?debug=1'
const mount = (href: string, dev: boolean, extra: { switches?: typeof SWITCHES; navigate?: (u: string) => void; copy?: (t: string) => Promise<void> } = {}) => {
  const d = makeDoc()
  const api = mountSwitches({ doc: d.doc, href, dev, switches: extra.switches, navigate: extra.navigate ?? (() => undefined), copy: extra.copy ?? (() => Promise.resolve()) })
  const root = api.element as unknown as FakeEl
  return { ...d, api, root, all: root.all() }
}
const button = (all: FakeEl[], name: string, value: string): FakeEl => {
  const b = all.find((e) => e.tag === 'button' && e.getAttribute('data-switch') === name && e.getAttribute('data-value') === value)
  assert.ok(b, `button ${name}=${value}`)
  return b
}

// ---- the gate: absent without debug, in a capture; main.ts loads the panel only through a dynamic import behind it
assert.equal(debugEnabled(''), false)
assert.equal(debugEnabled('?debug=0'), false)
assert.equal(debugEnabled('?debug=1&still=1'), false, 'never in a capture')
assert.equal(debugEnabled('?debug=1'), true)
const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.ok(!/from '\.\/debug\/(panel|switches|devSwitches)'/.test(mainSrc), 'main.ts has no static import of the panel or the registry')
// DEV_TOOLS (false in a native build) lets the bundler drop the panel and the registry from the app (scripts/native-checks.mjs).
assert.match(mainSrc, /if \((?:DEV_TOOLS && )?debugEnabled\(location\.search\)\) void import\('\.\/debug\/panel'\)/, 'the panel is a dynamic import behind the gate')

// ---- present, collapsed, one toggle button
{
  const m = mount(HREF, false)
  assert.equal(m.body.children.length, 1)
  const toggle = m.all.find((e) => e.getAttribute('data-switches-toggle') !== null)
  assert.ok(toggle && toggle.tag === 'button', 'a real button')
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  const panelBody = m.all.find((e) => e.getAttribute('id') === 'moon-switches-body')
  assert.ok(panelBody?.hidden, 'collapsed at first')
  toggle.fire('click')
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  assert.equal(panelBody?.hidden, false)
  m.root.fire('keydown', { key: 'Escape' })
  assert.equal(panelBody?.hidden, true, 'Escape closes')
  assert.ok(toggle.focused, 'and returns focus to the toggle')
  m.api.setHidden(true); assert.equal(m.root.hidden, true)
  m.api.destroy(); assert.equal(m.body.children.length, 0); assert.equal(m.head.children.length, 0)
}

// ---- lists every switch (the dev build lists them all; production all but the restricted)
{
  const m = mount(HREF, true, { switches: [...SWITCHES, ...DEV_SWITCHES] })
  const rows = new Set(m.all.filter((e) => e.getAttribute('data-switch-row') !== null).map((e) => e.getAttribute('data-switch-row')))
  assert.deepEqual([...rows].sort(), [...SWITCHES, ...DEV_SWITCHES].map((s) => s.name).sort(), 'every registered switch has a row in a dev build')
  const groups = m.all.filter((e) => e.getAttribute('data-switch-group') !== null).map((e) => e.getAttribute('data-switch-group'))
  assert.deepEqual(groups, panelRows('', true, [...SWITCHES, ...DEV_SWITCHES]).map((g) => g.group), 'grouped by area, in order')
  for (const s of [...SWITCHES, ...DEV_SWITCHES].filter((x) => x.values.length)) {
    const row = m.all.find((e) => e.getAttribute('data-switch-row') === s.name)
    assert.ok(row)
    const btns = row.all().filter((e) => e.tag === 'button' && e.getAttribute('data-switch') !== null)
    const labels = btns.map((b) => b.getAttribute('data-value'))
    assert.deepEqual(labels, ['', ...s.values.filter((v) => v !== s.def)], `${s.name}: default first, then the other values`)
    assert.ok(btns.every((b) => b.getAttribute('type') === 'button' && b.getAttribute('aria-pressed') !== null), `${s.name}: real buttons with pressed state`)
  }
  // a free-form switch has no button, only its note
  const free = m.all.find((e) => e.getAttribute('data-switch-row') === 'lon')
  assert.equal(free?.all().filter((e) => e.tag === 'button' && e.getAttribute('data-switch') !== null).length, 0, 'no value buttons')
  assert.match(free?.text() ?? '', /URL only/)
}

// ---- restricted switches: no row, no button and no text in a production build; a button on the dev server
{
  const prod = mount(HREF + '&internal=1', false)
  assert.equal(prod.all.some((e) => e.getAttribute('data-switch-row') === 'internal'), false, 'internal has no row in production')
  assert.equal(prod.all.some((e) => e.getAttribute('data-switch') === 'internal'), false, 'and no button')
  assert.equal(prod.all.some((e) => e.getAttribute('data-switch-row') === 'pump'), true, 'ordinary switches are there')
  assert.doesNotMatch(prod.root.all().map((e) => `${e.text()} ${[...e.attrs.values()].join(' ')}`).join(' '), /internal/i, 'no text in the production panel names it')
  const dev = mount(HREF, true, { switches: [...SWITCHES, ...DEV_SWITCHES] })
  assert.ok(button(dev.all, 'internal', '1'), 'internal is a dev-server button')
  assert.equal(panelRows('', false, [...SWITCHES, ...DEV_SWITCHES]).flatMap((g) => g.rows).some((r) => r.def.name === 'internal'), false, 'a restricted switch is filtered out when dev is false even if listed')
}

// ---- clicks build the right URLs
{
  const seen: string[] = []
  const m = mount('https://x.test/moon/index.html?debug=1&pump=1&lon=4#top', false, { navigate: (u) => seen.push(u) })
  assert.equal(button(m.all, 'pump', '1').getAttribute('aria-pressed'), 'true', 'the value in force is pressed')
  assert.equal(button(m.all, 'pump', '').getAttribute('aria-pressed'), 'false')
  button(m.all, 'pump', '').fire('click')
  button(m.all, 'prefeat', '1').fire('click')
  button(m.all, 'uploads', '8').fire('click')
  button(m.all, 'shadows', 'off').fire('click')
  assert.deepEqual(seen, [
    'https://x.test/moon/index.html?debug=1&lon=4#top',
    'https://x.test/moon/index.html?debug=1&pump=1&lon=4&prefeat=1#top',
    'https://x.test/moon/index.html?debug=1&pump=1&lon=4&uploads=8#top',
    'https://x.test/moon/index.html?debug=1&pump=1&lon=4&shadows=off#top',
  ], 'a click sets or removes one parameter and keeps the rest and the hash')
  assert.match(m.root.text(), /Switches \(1 changed\)/, 'the toggle counts non-default settings (the view is not one)')
}

// ---- reset all and copy A/B
{
  const seen: string[] = []
  const copied: string[] = []
  const href = 'https://x.test/moon/index.html?debug=1&pump=1&shadows=fast&shreach=300&lon=4&moment=surface'
  const m = mount(href, false, { navigate: (u) => seen.push(u), copy: (t) => { copied.push(t); return Promise.resolve() } })
  m.all.find((e) => e.getAttribute('data-switches-reset') !== null)?.fire('click')
  assert.deepEqual(seen, ['https://x.test/moon/index.html?debug=1&lon=4&moment=surface'], 'reset keeps debug and the view, drops every setting')
  m.all.find((e) => e.getAttribute('data-switches-copy') !== null)?.fire('click')
  assert.deepEqual(copied, [`A (current): ${href}\nB (all defaults): ${allDefaults(href)}`])
  await new Promise((r) => setTimeout(r, 0))
  assert.match(m.root.text(), /Copied A\/B links/)
}
// ---- text filter, changed only, free-form input, review badge
{
  const seen: string[] = []
  const m = mount('https://x.test/m/?debug=1&pump=1', false, { navigate: (u) => seen.push(u) })
  const row = (n: string) => m.all.find((e) => e.getAttribute('data-switch-row') === n)!
  const filter = m.all.find((e) => e.getAttribute('data-switches-filter') !== null)!
  filter.setAttribute('value', 'prefetchlru'); filter.fire('input', {})
  assert.equal(row('prefetchlru').hasAttribute('data-hide'), false)
  assert.equal(row('pump').hasAttribute('data-hide'), true, 'a non-matching row is hidden')
  filter.setAttribute('value', ''); filter.fire('input', {})
  assert.equal(row('pump').hasAttribute('data-hide'), false)
  const only = m.all.find((e) => e.getAttribute('data-switches-changed') !== null)!
  only.fire('click')
  assert.equal(only.getAttribute('aria-pressed'), 'true')
  assert.equal(row('pump').hasAttribute('data-hide'), false, 'a changed row stays')
  assert.equal(row('prefetchlru').hasAttribute('data-hide'), true, 'an unchanged row goes')
  only.fire('click')
  assert.equal(row('prefetchlru').hasAttribute('data-hide'), false)
  // a free-form number
  const up = m.all.find((e) => e.getAttribute('data-switch-input') === 'uploads')!
  up.setAttribute('value', '16')
  m.all.find((e) => e.getAttribute('data-switch-set') === 'uploads')!.fire('click')
  up.setAttribute('value', ' ')
  m.all.find((e) => e.getAttribute('data-switch-set') === 'uploads')!.fire('click')
  m.all.find((e) => e.getAttribute('data-switch-set') === 'lon')!.fire('click')
  assert.deepEqual(seen, ['https://x.test/m/?debug=1&pump=1&uploads=16', 'https://x.test/m/?debug=1&pump=1', 'https://x.test/m/?debug=1&pump=1'], 'the input sets the parameter; empty removes it')
  assert.equal(m.root.getAttribute('style'), null)
  labelled = true
  const m2 = mount(HREF, false)
  assert.equal(m2.root.getAttribute('style'), 'top:44px', 'starts below the review badge')
  labelled = false
}
console.log('switches panel ok')
