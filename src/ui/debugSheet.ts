import './debugSheet.css'
import { mountQualityAdvanced } from './quality'
import { mountStarTune } from './starTune'

/** A debug switch: a button that shows its state. */
export interface DebugToggle {
  id: string
  label: string
  note: string
  get(): boolean
  set(on: boolean): void
}
export interface DebugGoto { action: string; label: string; title: string; run(): void }
export interface DebugHooks {
  starBoost: number
  onStarBoost(b: number): void
  toggles: DebugToggle[]
  gotos: DebugGoto[]
}
export interface DebugSheetApi { open(): void; close(): void; isOpen(): boolean; toggle(): void; readonly element: HTMLElement }

/**
 * The hidden debug sheet (five presses of the Credits link within three seconds, see debugTaps.ts): the star brightness slider, the fine
 * Quality rows, the measurement overlays and the text overlays, and two test views. Not part of the visitor's interface. Esc or Close closes it;
 * it does not close on an outside tap, so a slider can be moved while watching the Moon.
 */
export function mountDebugSheet(root: HTMLElement, hooks: DebugHooks, returnFocus: () => void): DebugSheetApi {
  const sheet = document.createElement('section')
  sheet.id = 'debug-sheet'
  sheet.className = 'debug-sheet'
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-label', 'Debug settings')
  sheet.hidden = true
  const head = document.createElement('header')
  const h = document.createElement('h2')
  h.textContent = 'Debug'
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'debug-close'
  close.textContent = 'Close'
  close.setAttribute('aria-label', 'Close debug settings')
  head.append(h, close)
  sheet.append(head)

  const section = (title: string): HTMLElement => {
    const s = document.createElement('div')
    s.className = 'debug-section'
    const t = document.createElement('h3')
    t.textContent = title
    s.append(t)
    sheet.append(s)
    return s
  }

  mountStarTune(section('Stars'), hooks.starBoost, hooks.onStarBoost)

  const overlays = section('Overlays')
  const refreshers: Array<() => void> = []
  for (const t of hooks.toggles) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'debug-toggle'
    b.dataset.debug = t.id
    const name = document.createElement('b')
    name.textContent = t.label
    const note = document.createElement('small')
    note.textContent = t.note
    b.append(name, note)
    const sync = (): void => { b.setAttribute('aria-pressed', String(t.get())) }
    b.addEventListener('click', () => { t.set(!t.get()); sync() })
    sync()
    refreshers.push(sync)
    overlays.append(b)
  }

  const quality = section('Quality, fine-grained')
  const advanced = mountQualityAdvanced(quality)

  if (hooks.gotos.length) {
    const views = section('Test views')
    for (const g of hooks.gotos) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'debug-goto'
      b.dataset.action = g.action
      b.textContent = g.label
      b.title = g.title
      b.addEventListener('click', () => { g.run(); api.close() })
      views.append(b)
    }
  }
  root.append(sheet)

  const api: DebugSheetApi = {
    element: sheet,
    isOpen: () => !sheet.hidden,
    open() {
      if (!sheet.hidden) return
      for (const r of refreshers) r()
      advanced.refresh()
      sheet.hidden = false
      close.focus({ preventScroll: true })
    },
    close() {
      if (sheet.hidden) return
      const hadFocus = sheet.contains(document.activeElement)
      sheet.hidden = true
      if (hadFocus) returnFocus()
    },
    toggle() { if (sheet.hidden) api.open(); else api.close() },
  }
  close.addEventListener('click', () => api.close())
  // Capture before the page's own Escape handler: closing the sheet must not also end a flight or go Home.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || sheet.hidden) return
    e.preventDefault(); e.stopImmediatePropagation()
    api.close()
  }, true)
  return api
}
