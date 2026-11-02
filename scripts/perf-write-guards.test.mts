import assert from 'node:assert/strict'

class FakeElement {
  attrs = new Map<string, string>()
  children: FakeElement[] = []
  style: Record<string, string> = {}
  viewBoxWrites = 0
  private _hidden = true
  hiddenWrites = 0
  constructor(readonly tag: string) {}
  set hidden(value: boolean) { this.hiddenWrites++; this._hidden = value }
  get hidden(): boolean { return this._hidden }
  setAttribute(name: string, value: string): void {
    if (name === 'viewBox') this.viewBoxWrites++
    this.attrs.set(name, value)
  }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null }
  append(...children: FakeElement[]): void { this.children.push(...children) }
  addEventListener(): void {}
  getComputedTextLength(): number { return 0 }
}

const documentFake = {
  hidden: false,
  createElementNS: (_namespace: string, tag: string) => new FakeElement(tag),
}
Object.assign(globalThis, {
  document: documentFake,
  window: { innerWidth: 800, innerHeight: 600 },
})

const { Hud } = await import('../src/hud.ts')
const { mountRoutes } = await import('../src/ui/routes.ts')

type HudFixture = {
  infoBtn: FakeElement
  notesEl: FakeElement
  notesKey: string
  forcedOnce: boolean
  notesLayoutSize: string
  notesTop: number | null
  setNotes(notes: string[], forceOpen: boolean, htmlChanged?: boolean): void
}

// Calling setNotes with unchanged notes/layout leaves the already-hidden info button alone.
{
  const hud = Object.create(Hud.prototype) as HudFixture
  const note = 'same note'
  hud.infoBtn = new FakeElement('button')
  hud.notesEl = new FakeElement('div')
  hud.notesKey = note
  hud.forcedOnce = false
  hud.notesLayoutSize = '800x600'
  hud.notesTop = 20
  hud.setNotes([note], false, false)
  assert.equal(hud.infoBtn.hidden, true)
  assert.equal(hud.infoBtn.hiddenWrites, 0, 'setNotes skips the redundant hidden assignment')

  // Repair a visibility change made outside Hud.
  hud.infoBtn.hidden = false
  const externallyShown = hud.infoBtn.hiddenWrites
  hud.setNotes([note], false, false)
  assert.equal(hud.infoBtn.hidden, true)
  assert.equal(hud.infoBtn.hiddenWrites, externallyShown + 1, 'setNotes restores externally changed visibility')

  // Repair a replaced button whose new instance is externally visible.
  hud.infoBtn = new FakeElement('button')
  hud.infoBtn.hidden = false
  const replacedShown = hud.infoBtn.hiddenWrites
  hud.setNotes([note], false, false)
  assert.equal(hud.infoBtn.hidden, true)
  assert.equal(hud.infoBtn.hiddenWrites, replacedShown + 1, 'setNotes hides an externally replaced button')
}

// A second frame at the same viewport does not rewrite the SVG viewBox.
{
  const root = new FakeElement('div')
  const routes = mountRoutes(root as never, { fly: () => undefined })
  const frame = { vw: 800, vh: 600, aspect: 4 / 3, hidden: true, dist: 4 } as never
  routes.update(frame)
  routes.update(frame)
  const svg = root.children[0]
  assert.equal(svg.getAttribute('viewBox'), '0 0 800 600')
  assert.equal(svg.viewBoxWrites, 1, 'routes skips the redundant viewBox assignment')

  // Restore an externally changed viewBox and a removed viewBox.
  svg.setAttribute('viewBox', '0 0 1 1')
  routes.update(frame)
  assert.equal(svg.getAttribute('viewBox'), '0 0 800 600', 'routes restores an externally changed viewBox')
  svg.attrs.delete('viewBox')
  routes.update(frame)
  assert.equal(svg.getAttribute('viewBox'), '0 0 800 600', 'routes restores a removed viewBox')

  // A remounted SVG gets its own correct viewBox on its first update.
  root.children.splice(0, root.children.length)
  const remountedRoutes = mountRoutes(root as never, { fly: () => undefined })
  const remountedSvg = root.children[0]
  remountedRoutes.update(frame)
  assert.equal(remountedSvg.getAttribute('viewBox'), '0 0 800 600', 'remounted routes write the correct viewBox')
  assert.equal(remountedSvg.viewBoxWrites, 1)
}

console.log('perf-write-guards.test ok')
