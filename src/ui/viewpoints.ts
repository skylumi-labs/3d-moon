import './viewpoints.css'
import { getDock } from './dock'

/**
 * The two viewpoints of the Apollo 17 ground view, a segmented control above the bar (MOON-UX-REDESIGN.md, section 3.2):
 * "Beside the module" (10 m up, looking at it) and "Eye level" (1.7 m up, 20 m from a pad). Shown only in the ground view;
 * neither segment is pressed once the visitor has moved off both.
 */
export interface ViewpointHooks { select(kind: 'hover' | 'eye'): void }
export type Viewpoint = 'hover' | 'eye'

export function mountViewpoints(root: HTMLElement, hooks: ViewpointHooks): { update(visible: boolean, current: Viewpoint | null): void } {
  const row = document.createElement('div')
  row.className = 'viewpoints'
  row.setAttribute('role', 'group')
  row.setAttribute('aria-label', 'Viewpoint')
  row.hidden = true
  const btns = new Map<Viewpoint, HTMLButtonElement>()
  for (const [kind, label] of [['eye', 'Eye level']] as const) {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.viewpoint = kind
    b.textContent = label
    b.addEventListener('click', () => hooks.select(kind))
    row.append(b)
    btns.set(kind, b)
  }
  const dock = getDock(root)
  // Above the navigator pill, which stays directly over the bar.
  const bar = dock.querySelector(':scope > .nav-caption') ?? dock.querySelector(':scope > .bar')
  if (bar) dock.insertBefore(row, bar); else dock.append(row)
  let shown = false, cur: Viewpoint | null = null
  return {
    update(visible, current) {
      if (visible !== shown) { shown = visible; row.hidden = !visible }
      if (current !== cur) { cur = current; for (const [k, b] of btns) b.setAttribute('aria-pressed', String(k === current)) }
    },
  }
}
