import './caption.css'
import { getDock, trackCaptionBand } from './dock'

/**
 * A single short line naming the current view. Extra descriptive copy is kept in the API for callers but stays off the bottom bar.
 */
/** A chip under the sentence (the Retry of a photograph that did not load): it works wherever the place is, on screen or not. */
export interface CaptionAction { label: string; run(): void }
export interface CaptionApi {
  /** The line shown when nothing else claims the caption. `hint` is the one sentence under it (the first visit's "Drag to turn it"). */
  setHome(title: string, hint?: string): void
  /** A caption for a pin or a move; it stays until `clear`. */
  show(title: string, sentence?: string, action?: CaptionAction, status?: boolean): void
  /** A short message over whatever is showing, back after `ms`. */
  flash(title: string, sentence?: string, ms?: number): void
  /** Back to the Home line. */
  clear(): void
  /** What the element says now (for tests and the audit). */
  text(): { title: string; sentence: string; kind: 'home' | 'show' | 'flash'; action: string }
  readonly element: HTMLElement
}

export function mountCaption(root: HTMLElement): CaptionApi {
  const el = document.createElement('div')
  el.className = 'caption'
  el.id = 'caption'
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
  const titleEl = document.createElement('div')
  titleEl.className = 'caption-title'
  const textEl = document.createElement('div')
  textEl.className = 'caption-text'
  const actionEl = document.createElement('button')
  actionEl.type = 'button'
  actionEl.className = 'caption-action'
  actionEl.hidden = true
  let actionRun: (() => void) | null = null
  actionEl.addEventListener('click', (ev) => { ev.stopPropagation(); actionRun?.() })
  actionEl.addEventListener('pointerdown', (ev) => ev.stopPropagation())
  el.append(titleEl, textEl, actionEl)
  const dock = getDock(root)
  dock.prepend(el)
  el.hidden = true
  trackCaptionBand(dock, el)

  let home = { title: '', sentence: '' }
  let shown: { title: string; sentence: string; action?: CaptionAction; status: boolean } | null = null
  let flashed: { title: string; sentence: string } | null = null
  let flashTimer: ReturnType<typeof setTimeout> | null = null
  let cur = { title: '', sentence: '', kind: 'home' as 'home' | 'show' | 'flash', action: '', status: false }

  const paint = (): void => {
    const base = flashed ? { ...flashed, kind: 'flash' as const } : shown ? { ...shown, kind: 'show' as const } : { ...home, kind: 'home' as const }
    const act = base.kind === 'show' ? shown?.action : undefined
    const next = { title: base.title, sentence: base.sentence, kind: base.kind, action: act?.label ?? '', status: base.kind === 'show' && shown?.status === true }
    actionRun = act ? act.run : null
    if (next.title === cur.title && next.sentence === cur.sentence && next.kind === cur.kind && next.action === cur.action && next.status === cur.status) return
    const kindChanged = next.kind !== cur.kind
    cur = next
    el.classList.toggle('has-status', next.status)
    titleEl.textContent = next.title
    textEl.textContent = next.sentence
    actionEl.hidden = !next.action
    actionEl.textContent = next.action
    el.hidden = !next.title && !next.sentence
    // The Home line's time and percentage tick over without a fade; a change of what the caption IS fades in over 200 ms.
    if (kindChanged && next.title) {
      el.classList.add('fading')
      void el.offsetWidth
      el.classList.remove('fading')
    }
  }

  return {
    element: el,
    setHome(title, hint = '') { home = { title, sentence: hint }; paint() },
    show(title, sentence = '', action, status = false) { shown = { title, sentence, action, status }; paint() },
    flash(title, sentence = '', ms = 4000) {
      flashed = { title, sentence }
      if (flashTimer) clearTimeout(flashTimer)
      flashTimer = setTimeout(() => { flashed = null; flashTimer = null; paint() }, ms)
      paint()
    },
    clear() {
      shown = null
      flashed = null
      if (flashTimer) { clearTimeout(flashTimer); flashTimer = null }
      paint()
    },
    text: () => ({ ...cur }),
  }
}
