import './centreCaption.css'
import { getDock } from './dock'
import { MIN_CAPTION_W, RowClearance, naturalWidth, transitionMovesRow, type ClearanceInput, type Rect } from './centreCaptionLayout'
import type { CaptionView } from '../labels/centreCaptionCore'

export interface CentreCaptionUi {
  /** Applies the controller's view each frame; returns true when the geometry (and so the label exclusion) changed this call. */
  apply(view: CaptionView): boolean
  /** A central interval wide enough for a name exists on the row right now. */
  usable(): boolean
  /** The caption's rect while it is on screen or fading, else null (the label layer keeps clear of it). */
  rect(): Rect | null
  /** Something that can change the row's clearance changed. */
  invalidate(): void
  readonly element: HTMLElement
}

/** The rectangles that can stand in the caption's row. The flight pad and its toggle are measured themselves, not their zero-size anchor. */
export const ROW_SELECTORS = ['.touch-ctl-pad', '.tc-toggle', '#hud', '#credit']
/**
 * What is observed on each row element. Attribute filters only name what changes clearance (shown/hidden, open/closed); a style attribute is NOT
 * watched (the stick's knob rewrites it every pointer move), and the HUD's text is not watched at all (it rewrites every frame): sizes come from the
 * ResizeObserver, motion from transition events, popup content from its own child list.
 */
const WATCH: Record<string, MutationObserverInit> = {
  '.touch-ctl': { attributes: true, attributeFilter: ['data-open', 'hidden', 'class'] },
  '.touch-ctl-pad': { attributes: true, attributeFilter: ['hidden', 'class'] },
  '.tc-toggle': { attributes: true, attributeFilter: ['aria-pressed', 'class'] },
  // The brand line fades out on stillness (brandFade.ts sets data-brand): while it is faded the caption may use its space.
  '#credit': { attributes: true, attributeFilter: ['data-brand', 'class'] },
}

export function visibleRect(el: Element): Rect | null {
  if ((el as HTMLElement).hidden) return null
  // A faded brand line is not text on screen: its space is free for the name (the line wins whenever it is shown, it is the credit).
  if ((el as HTMLElement).dataset?.brand === 'out') return null
  const cs = getComputedStyle(el)
  if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null
}

/**
 * Watches everything that can change what stands in the caption's way: the dock's, the caption's and the controls' sizes, the pad and toggle opening and
 * closing (their transitions), the brand line fading, controls that mount late, and the window. `invalidate` is called on a change, `transition(now)` on a
 * control transition that moves a measured rectangle (the placement is then refreshed until it settles). Shared by the plain caption and the lock label.
 */
export function observeRowControls(root: HTMLElement, dock: HTMLElement, el: HTMLElement, invalidate: () => void, transition: (now: number) => void): void {
  // Clearance depends on the dock and caption sizes, the pad and toggle (their open/close transitions), the reduced-detail popup (shown or hidden, content changes) and the HUD's size.
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(invalidate) : null
  ro?.observe(dock); ro?.observe(el); ro?.observe(document.documentElement)
  const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(invalidate) : null
  const watched = new WeakSet<Element>()
  const watch = (): void => {
    for (const s of ROW_SELECTORS) for (const n of document.querySelectorAll(s)) {
      if (watched.has(n)) continue
      watched.add(n)
      ro?.observe(n)
      for (const [match, init] of Object.entries(WATCH)) if (n.matches(match)) mo?.observe(n, init)
    }
    const wrap = document.querySelector('.touch-ctl')
    if (wrap && !watched.has(wrap)) { watched.add(wrap); mo?.observe(wrap, WATCH['.touch-ctl']) }
  }
  watch()
  if (typeof MutationObserver !== 'undefined') {
    // Controls that mount after this one are picked up when the root's or the dock's children change.
    const late = new MutationObserver(() => { watch(); invalidate() })
    late.observe(root, { childList: true })
    late.observe(dock, { childList: true })
  }
  window.addEventListener('resize', invalidate)
  window.visualViewport?.addEventListener('resize', invalidate)
  const MEASURED = [...ROW_SELECTORS, '.touch-ctl'].join(', ')
  const trun = (e: Event): void => {
    const t = e.target
    if (t instanceof Element && transitionMovesRow(t.matches(MEASURED), (e as TransitionEvent).propertyName ?? '')) transition(performance.now())
  }
  const tend = trun
  document.addEventListener('transitionrun', trun, true)
  document.addEventListener('transitionend', tend, true)
  document.addEventListener('transitioncancel', tend, true)
  const arun = (e: Event): void => { const t = e.target; if (t instanceof Element && t.matches(MEASURED)) invalidate() }
  document.addEventListener('animationstart', arun, true)
  document.addEventListener('animationend', arun, true)
}

/** Mounts the plain-text caption in the dock (out of flow, above it) and keeps its clearance from the real control rectangles. */
export function mountCentreCaption(root: HTMLElement): CentreCaptionUi {
  const dock = getDock(root)
  const el = document.createElement('div')
  el.className = 'centre-caption'
  el.id = 'centre-caption'
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
  dock.append(el)
  // The safe-area insets of the viewport, read through a zero-size probe (the dock has none of its own).
  const probe = document.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)'
  document.body.append(probe)

  const clearance = new RowClearance()
  let lastText = ''
  let lastRect: Rect | null = null
  let lastDockLeft = 0
  const invalidate = (): void => clearance.invalidate()

  const measure = (): ClearanceInput => {
    const dockR = dock.getBoundingClientRect()
    lastDockLeft = dockR.left
    const pad = parseFloat(getComputedStyle(dock).paddingLeft) || 12
    const pcs = getComputedStyle(probe)
    const w = document.documentElement.clientWidth || window.innerWidth
    const height = el.offsetHeight || 22
    const rowBottom = dockR.top - 8
    const rects: Rect[] = []
    for (const s of ROW_SELECTORS) for (const n of document.querySelectorAll(s)) { const r = visibleRect(n); if (r) rects.push(r) }
    // The natural width of the name, measured on a max-content copy of the box.
    const prev = { left: el.style.left, right: el.style.right, width: el.style.width }
    el.style.left = '0px'; el.style.right = 'auto'; el.style.width = 'max-content'
    const textW = el.firstChild ? naturalWidth(Math.max(el.scrollWidth, el.getBoundingClientRect().width)) : 0
    el.style.left = prev.left; el.style.right = prev.right; el.style.width = prev.width
    return { viewportW: w, insetL: parseFloat(pcs.paddingLeft) || 0, insetR: parseFloat(pcs.paddingRight) || 0, pad, rowTop: rowBottom - height, rowBottom, rects, textW, minW: MIN_CAPTION_W }
  }

  observeRowControls(root, dock, el, invalidate, (now) => clearance.transition(now))

  return {
    element: el,
    invalidate,
    usable: () => clearance.placement !== null,
    rect: () => lastRect,
    apply(view: CaptionView): boolean {
      const want = view.occupied ? view.text : ''
      if (want !== lastText) { el.textContent = want; lastText = want; clearance.invalidate() }
      const now = performance.now()
      // Layout is read only when something told the tracker (or a control transition is settling): an idle or moving camera costs no reads.
      const worked = clearance.needsRefresh(now)
      const geom = clearance.refresh(now, measure)
      const p = clearance.placement, input = clearance.input
      if (geom && p && input) { el.style.left = `${(p.left - lastDockLeft).toFixed(1)}px`; el.style.right = 'auto'; el.style.width = `${p.width.toFixed(1)}px` }
      el.classList.toggle('on', view.visible)
      // The caption's rect comes from the cached placement and row.
      if (worked || view.occupied !== (lastRect !== null)) lastRect = view.occupied && p && input ? { left: p.left, right: p.left + p.width, top: input.rowTop, bottom: input.rowBottom } : null
      return geom
    },
  }
}
