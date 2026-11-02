import './navigator.css'
import { getDock } from './dock'
import { DEFAULT_TILE_BASE } from '../moon/tiles/config'
import { shortLine, thumbBase, thumbSrc } from './viewpointCards'
import { attachStripDrag } from './stripDrag'
import type { BarApi, BarSheet } from './bar'
import { tablerIcon } from './tablerIcons'
import { announce } from './announce'
import { trackUsage, takeUsageSource, type UsageSource } from '../usage'
import { navArrowStep } from './navKeys'
import {
  type NavAction, type NavEntry, type NavPos, type NavState, NAV_IDLE, VIEWPOINT_ENTRIES,
  availableEntries, describeNav, locate, navArrive, navAway, navClear, navReturnStep, nextPos, prevMoveFrom, resolveQueued, stepAt,
} from '../viewpointList'

/** What the navigator needs from the renderer; main.ts implements it. */
export interface NavigatorHost {
  /** Whether this build can show the action (its data is there). Asked once the site probe is done. */
  has(a: NavAction): boolean
  /**
   * Runs a step: flies there, starts the flight, opens the panorama. `resume`: it is the Return button, so a flight carries on from where the visitor left it.
   * `replay`: the explicit "fly there again" (the Apollo 17 arrival from the ground), which Return and ‹ never ask for.
   */
  run(a: NavAction, opts?: { resume?: boolean; replay?: boolean }): void
  /** How far the step's data has got while it loads (a short line), or null. */
  status(a: NavAction): string | null
  /**
   * The visitor stands on a site's ground (the Apollo 17 ground view or one of its panoramas): ‹ at the entry's first step then climbs out over the site
   * (viewpointList prevMoveFrom) instead of flying to the entry before, and the entry's card offers "Fly there again". Absent: the ring as from orbit.
   */
  onGround?(): boolean
  /** Ends a selected moment in place, leaving the camera where it is. */
  stopMoment?(): void
}

export interface NavigatorApi {
  /** The sheet that lists the viewpoints; the tour card sits in `cardSlot` at its top. */
  readonly sheet: HTMLElement
  readonly cardSlot: HTMLElement
  /** Where the journey slider goes (in the row, in place of the buttons, while a flight plays). */
  readonly sliderSlot: HTMLElement
  /** The probe of the Apollo sites and the tiles is done: the list is trimmed to what exists and a tap made meanwhile now runs. */
  setReady(): void
  /** A viewpoint was reached or asked for by something other than the pill (a pin on the Moon, a ?moment= link, the browser's Back). */
  noteSelected(a: NavAction): void
  /** The visitor dragged, zoomed or turned away from the viewpoint. */
  away(): void
  /** Something that is not a viewpoint took the camera (Home, a label's fly-to). */
  clear(): void
  closeSheet(): void
  /** Once a frame or so: the loading line and the pill's state. Cheap when nothing changed. */
  update(): void
  /** The action of the step the pill names now, or null. */
  current(): NavAction | null
  /** The state, for tests and captures. */
  state(): { state: NavState; ready: boolean; queued: NavAction | null; entries: readonly NavEntry[] }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}
function btn(cls: string, text: string, aria: string, nav?: string): HTMLButtonElement {
  const b = el('button', cls, text)
  b.type = 'button'
  b.setAttribute('aria-label', aria)
  if (nav) b.dataset.nav = nav
  return b
}

const THUMBS = thumbBase(DEFAULT_TILE_BASE)

/**
 * The navigator, inside the bar's row: `‹  ☰  ›`, and, once a viewpoint is chosen, a small caption just above the row with its name and `5 of 9` (before
 * any viewpoint there is no caption: "Viewpoints · 9 places and flights" said nothing, owner review 2026-10-23, #5). The list button opens the filmstrip
 * of viewpoints (the Viewpoints sheet), which a mouse drag scrolls (#6); the arrows, and Left and Right while the row or the list has focus, step through
 * them, sub-views first. While a flight plays the journey slider shares the row and its caption remains the picker. When the visitor has moved off the viewpoint, Back
 * gets its own reserved slot while the caption clears. Their positions stay stable through a drag, and the visitor can choose another scene from the list.
 * Manual navigation with no viewpoint is told to the bar (setCompact), which keeps its row short and lets the pad open on a desktop.
 * It stays tappable from the first frame: a tap before the sites are probed is queued and run when the list is ready.
 */
export function mountNavigator(root: HTMLElement, bar: BarApi, host: NavigatorHost): NavigatorApi {
  const dock = getDock(root)

  // The list sheet: a strip of cards.
  const sheet = el('div', 'bar-sheet viewpoints-sheet')
  sheet.id = 'bar-viewpoints'
  sheet.setAttribute('role', 'group')
  sheet.setAttribute('aria-label', 'Viewpoints')
  sheet.hidden = true
  // A press in the sheet is never handed to the camera (camera/controls.ts eligibleOverlay): the strip scrolls, the Moon stays.
  sheet.dataset.noDrag = ''
  const cardSlot = el('div', 'viewpoints-journeys')
  cardSlot.setAttribute('aria-label', 'Cinematic journeys')
  const listEl = el('div', 'viewpoints-list')
  sheet.append(cardSlot, listEl)

  // The buttons (items of the bar's row) and the caption over it.
  const pill = el('div', 'nav-pill')
  pill.setAttribute('role', 'group')
  pill.setAttribute('aria-label', 'Viewpoint')
  const prevB = btn('nav-arrow nav-prev', '', 'Previous viewpoint', 'prev')
  prevB.innerHTML = tablerIcon('chevronLeft', 24)
  const nextB = btn('nav-arrow nav-next', '', 'Next viewpoint', 'next')
  nextB.innerHTML = tablerIcon('chevronRight', 24)
  const nameB = btn('nav-list', '', 'Choose a viewpoint', 'open')
  nameB.innerHTML = tablerIcon('list', 22)
  nameB.setAttribute('aria-haspopup', 'true')
  nameB.setAttribute('aria-controls', 'bar-viewpoints')
  nameB.setAttribute('aria-expanded', 'false')
  const returnB = btn('nav-return', '', 'Back to the scene you left', 'return')
  returnB.innerHTML = tablerIcon('arrowBackUp', 22)
  returnB.title = 'Back to the scene you left'
  // Keep the slot in the row while away toggles during a drag, so no other control shifts under the finger.
  returnB.setAttribute('aria-hidden', 'true')
  returnB.disabled = true
  const returnWord = el('span', 'nav-return-word', 'Back')
  returnWord.setAttribute('aria-hidden', 'true')
  returnB.append(returnWord)
  const sliderSlot = el('div', 'nav-slider')
  const stopB = btn('nav-stop', '■', 'Stop the moment and leave the camera here', 'stop-moment')
  stopB.setAttribute('aria-hidden', 'true')
  stopB.disabled = true
  sliderSlot.append(stopB)
  pill.append(sliderSlot, prevB, nameB, returnB, nextB)
  bar.navSlot.append(pill)
  // The caption is a button too: the list stays one tap away while Return stands in the list button's place, and while a flight hides it. Hidden until a viewpoint is chosen.
  const caption = el('button', 'nav-caption')
  caption.type = 'button'
  caption.hidden = true
  caption.setAttribute('aria-label', 'Viewpoints list')
  caption.setAttribute('aria-haspopup', 'true')
  caption.setAttribute('aria-controls', 'bar-viewpoints')
  caption.setAttribute('aria-expanded', 'false')
  const titleEl = el('b', 'nav-title')
  const dotsEl = el('span', 'nav-dots')
  const countEl = el('small', 'nav-count')
  caption.append(titleEl, dotsEl, countEl)
  const barEl = bar.element
  // The caption stands right over the row; the sheet is before it in the page order and above it on screen.
  dock.insertBefore(caption, barEl)
  dock.insertBefore(sheet, caption)

  const sheetApi: BarSheet = { isOpen: () => !sheet.hidden, close: () => setOpen(false) }
  bar.registerSheet(sheetApi)
  function setOpen(open: boolean, focusIn = false): void {
    // Focus inside the list goes back to the pill's name when the list closes (Escape, a row, Home), not to the page.
    if (!open && !sheet.hidden && sheet.contains(document.activeElement)) (visible(nameB) ? nameB : caption).focus({ preventScroll: true })
    sheet.hidden = !open
    nameB.setAttribute('aria-expanded', String(open))
    caption.setAttribute('aria-expanded', String(open))
    nameB.classList.toggle('open', open)
    if (open) {
      const target = sheet.querySelector<HTMLElement>('.nav-card.cur') ?? sheet.querySelector<HTMLElement>('.nav-card')
      // The current card is scrolled to the middle of the strip (the strip only, not the page).
      if (target) listEl.scrollLeft = Math.max(0, target.offsetLeft - (listEl.clientWidth - target.offsetWidth) / 2)
      // Opened from the name (Enter, Space or a tap): focus goes to the current row, or the first, so the keyboard is in the list.
      if (focusIn) target?.focus({ preventScroll: true })
    }
  }

  /** Whether the button takes part in the page now. */
  function visible(b: HTMLElement): boolean { return !b.hidden && b.getClientRects().length > 0 }

  let ready = false
  let entries: readonly NavEntry[] = VIEWPOINT_ENTRIES
  let state: NavState = NAV_IDLE
  let queued: NavAction | null = null
  let lastKey = ''
  let lastSig = ''
  /** The title announced at the start of the flight now under way; spoken as the arrival when the flight's slider leaves the row. */
  let flyingTo: string | null = null

  function renderList(): void {
    // Stepping with Left/Right from inside the list rebuilds it: focus stays on the same row (or sub-view chip).
    const act = document.activeElement as HTMLElement | null
    const had = act && listEl.contains(act) ? { row: act.dataset.row, step: act.dataset.step } : null
    listEl.replaceChildren()
    entries.forEach((e, i) => {
      // A card: the still, the name, a few words. The current entry's sub-views are one tap each, under its card.
      const col = el('div', 'nav-col')
      const b = el('button', 'nav-card')
      b.type = 'button'
      b.dataset.row = e.id
      b.title = e.caption
      const pic = el('span', 'nav-pic')
      pic.dataset.name = e.name
      const img = el('img')
      const t = thumbSrc(THUMBS, e.id)
      img.src = t.src; img.srcset = t.srcset; img.alt = ''
      img.draggable = false // a mouse drag scrolls the strip; the browser must not lift the picture instead
      img.decoding = 'async'
      img.loading = i < 3 ? 'eager' : 'lazy'
      img.addEventListener('error', () => { pic.classList.add('no-img'); img.remove() })
      pic.append(img)
      if (e.steps.length > 1) pic.append(el('span', 'nav-views', `${e.steps.length} views`))
      b.append(pic, el('b', '', e.name), el('small', '', shortLine(e.id, e.caption)))
      b.addEventListener('click', () => { setOpen(false); go({ entry: i, step: 0 }) })
      col.append(b)
      if (state.pos?.entry === i && e.steps.length > 1) {
        const subs = el('div', 'nav-subs')
        e.steps.forEach((s, k) => {
          const c = el('button', s.action.kind === 'panorama' ? 'nav-subview panorama-entry' : 'nav-subview', s.label ?? e.name)
          c.type = 'button'
          c.dataset.step = String(k)
          if (s.action.kind === 'panorama') c.dataset.panorama = s.action.id
          c.setAttribute('aria-pressed', String(!state.away && state.pos?.step === k))
          c.addEventListener('click', () => { setOpen(false); go({ entry: i, step: k }) })
          subs.append(c)
        })
        // On the ground the steps are ground-local (a glide, an overlay): the flight to the site is its own, explicit chip (#10), never Return or ‹.
        if (host.onGround?.()) {
          const r = el('button', 'nav-subview nav-replay', 'Fly there again')
          r.type = 'button'
          r.dataset.replay = e.id
          r.addEventListener('click', () => { setOpen(false); go({ entry: i, step: 0 }, false, true) })
          subs.append(r)
        }
        col.append(subs)
      }
      listEl.append(col)
    })
    if (had) {
      const again = had.row ? listEl.querySelector<HTMLElement>(`[data-row="${had.row}"]`) : had.step ? listEl.querySelector<HTMLElement>(`.nav-subview[data-step="${had.step}"]`) : null
      again?.focus({ preventScroll: true })
    }
  }

  function render(force = true): void {
    const v = describeNav(entries, state)
    const loading = ready ? statusOf() : queued ? 'Getting the places ready…' : null
    // The ground state is part of the picture: the "Fly there again" chip appears on landing and goes with the climb (update() runs this every 250 ms).
    const ground = host.onGround?.() ?? false
    const sig = `${JSON.stringify(v)}|${loading}|${entries.length}|${ground}`
    if (!force && sig === lastSig) return
    lastSig = sig
    titleEl.textContent = state.away ? '' : v.title
    countEl.textContent = state.away ? '' : loading ?? v.count
    // Away from a viewpoint, clear the caption: the list remains available in the row.
    const hideCaption = !state.pos || state.away
    if (caption.hidden !== hideCaption) { caption.hidden = hideCaption; fit() }
    pill.classList.toggle('away', v.dimmed)
    pill.classList.toggle('loading', !!loading)
    pill.setAttribute('aria-busy', String(!!loading))
    returnB.hidden = !state.pos
    bar.setBackReserved(!!state.pos)
    returnB.classList.toggle('available', v.canReturn)
    returnB.setAttribute('aria-hidden', String(!v.canReturn))
    returnB.disabled = !v.canReturn
    nameB.hidden = false
    const current = stepAt(entries, state.pos)?.action
    stopB.hidden = current?.kind !== 'moment'
    stopB.setAttribute('aria-hidden', String(current?.kind !== 'moment'))
    stopB.disabled = current?.kind !== 'moment'
    prevB.disabled = !v.canPrev
    nextB.disabled = !v.canNext
    const pickerTitle = state.away ? '' : v.title
    nameB.setAttribute('aria-label', pickerTitle ? `${pickerTitle}${v.count ? `, ${v.count}` : ''}. Choose a viewpoint` : 'Choose a viewpoint')
    nameB.title = pickerTitle ? `${pickerTitle}. Viewpoints` : 'Viewpoints'
    // Manual navigation: no viewpoint yet, or moved off one. The bar keeps its row short and the pad may open (bar.ts, touchControls.ts).
    bar.setCompact(!state.pos)
    if (dotsEl.childElementCount !== v.dots) {
      dotsEl.replaceChildren(...Array.from({ length: v.dots }, () => el('i')))
    }
    ;[...dotsEl.children].forEach((d, i) => d.classList.toggle('on', i === v.dotIndex))
    dotsEl.hidden = v.dots === 0
    // The list: the current row is pressed unless the visitor has left it; its caption (and its sub-views) show, the others stay one line.
    const key = `${state.pos?.entry ?? -1}|${entries.length}|${ground}`
    if (key !== lastKey) { lastKey = key; renderList() }
    listEl.querySelectorAll<HTMLButtonElement>('.nav-card').forEach((b, i) => {
      b.setAttribute('aria-pressed', String(state.pos?.entry === i && !state.away))
      b.classList.toggle('cur', state.pos?.entry === i)
    })
    listEl.querySelectorAll<HTMLButtonElement>('.nav-subview').forEach((c) => c.setAttribute('aria-pressed', String(!state.away && state.pos?.step === Number(c.dataset.step))))
  }

  function statusOf(): string | null {
    const s = stepAt(entries, state.pos)
    return s && !state.away ? host.status(s.action) : null
  }

  /** Goes to a step: the pill names it at once; the camera moves now, or when the list is ready. `replay`: the flight again (the chip), not the ground-local step. */
  /** Usage: a viewpoint was opened, and how (the one viewpoint_open call site; a pin or a link arrives through noteSelected below). */
  function opened(a: NavAction, source: UsageSource): void { trackUsage('viewpoint_open', { id: a.id, source }) }
  function go(pos: NavPos, resume = false, replay = false, source: UsageSource = 'list'): void {
    const step = stepAt(entries, pos)
    if (!step) return
    if (!resume) opened(step.action, source)
    state = navArrive(state, pos)
    const v = describeNav(entries, state)
    flyingTo = v.title
    announce({ kind: 'start', title: v.title, count: v.count })
    if (!ready) queued = step.action
    else host.run(step.action, resume ? { resume: true } : replay ? { replay: true } : undefined)
    render()
  }
  /**
   * ‹: the step before, or, on the ground at the entry's first step, the climb out over the site (owner complaint 10, 2026-10-23: "it's strange that we fly
   * again after clicking back; stay on the moon"). The climb keeps the pill on the entry's first step; main.ts dims it when the camera has left the ground.
   */
  function back(): void {
    const m = prevMoveFrom(entries, state.pos, host.onGround?.() ?? false)
    if (!m) return
    if (m.kind === 'step') { go(m.pos, false, false, 'prev'); return }
    opened(m.action, 'prev')
    state = navArrive(state, m.pos)
    if (ready) host.run(m.action)
    render()
  }

  prevB.addEventListener('click', back)
  nextB.addEventListener('click', () => { const p = nextPos(entries, state.pos); if (p) go(p, false, false, 'next') })
  returnB.addEventListener('click', () => {
    if (!navReturnStep(entries, state) || !state.pos) return
    go(state.pos, true)
  })
  stopB.addEventListener('click', () => host.stopMoment?.())
  nameB.addEventListener('click', () => {
    const open = !!sheet.hidden
    if (open) bar.closeSheetsExcept(sheetApi)
    setOpen(open, true)
  })
  // The caption only opens: a list that is already open stays as it is.
  caption.addEventListener('click', (ev) => {
    if (!sheet.hidden) return
    bar.closeSheetsExcept(sheetApi)
    setOpen(true, ev.detail === 0)
  })
  // A flight's slider in the row: the bar makes room for it (setFlight), and focus that was on a button the slider replaced moves to one that is still there.
  const flightWatch = (): void => {
    const on = !!sliderSlot.querySelector('.journey-scrub:not([hidden])')
    if (on === flying) return
    flying = on
    if (!on && flyingTo) { announce({ kind: 'arrive', title: flyingTo }); flyingTo = null }
    const act = document.activeElement
    bar.setFlight(on)
    render() // the arrows' hidden state reads `flying`
    if (on && act === nameB) {
      const pause = sliderSlot.querySelector<HTMLElement>('.js-pause:not([hidden])')
      ;(pause ?? (nextB.disabled || nextB.hidden ? bar.element.querySelector<HTMLElement>('[data-bar="more"]') : nextB))?.focus({ preventScroll: true })
    }
  }
  let flying = false
  if (typeof MutationObserver !== 'undefined') new MutationObserver(flightWatch).observe(sliderSlot, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] })
  // Left and Right step while focus is in the pill or the list: the camera also owns the page-level arrow keys, so the press stops here.
  // Not in the flight's slider (it is in the pill): there they move the slider (navKeys.ts).
  // The arrows remain visible when Return shows, so Left and Right keep stepping viewpoints.
  const onKey = (e: KeyboardEvent): void => {
    const step = navArrowStep({ key: e.key, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, inInput: e.target instanceof HTMLInputElement })
    if (!step) return
    e.preventDefault(); e.stopPropagation()
    if (step === 'prev') { back(); return }
    const p = nextPos(entries, state.pos)
    if (p) go(p, false, false, 'next')
  }
  pill.addEventListener('keydown', onKey)
  caption.addEventListener('keydown', onKey)
  sheet.addEventListener('keydown', onKey)

  // A mouse (or pen) drag scrolls the strip (stripDrag.ts; owner review 2026-10-23, #6): a plain click still opens its card.
  attachStripDrag(listEl)

  // --nav-h: what the viewpoint caption adds over the 48 px row (the sheets' height budget, pins.css); nothing while it is hidden.
  const fit = (): void => { document.documentElement.style.setProperty('--nav-h', `${caption.hidden ? 0 : caption.offsetHeight + 8}px`) }
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(caption)
  fit()

  render()
  return {
    sheet, cardSlot, sliderSlot,
    setReady(): void {
      if (ready) return
      ready = true
      const was = state.pos ? stepAt(entries, state.pos)?.action ?? null : null
      entries = availableEntries(VIEWPOINT_ENTRIES, host.has)
      state = was ? { pos: locate(entries, was), away: state.away } : state
      if (!state.pos) state = NAV_IDLE
      lastKey = ''
      const q = resolveQueued(queued, entries)
      const act = queued
      queued = null
      render()
      if (q && act) { state = navArrive(state, q); render(); host.run(act) }
    },
    noteSelected(a): void {
      opened(a, takeUsageSource() ?? 'link')
      const pos = locate(entries, a)
      state = pos ? navArrive(state, pos) : navClear()
      queued = null
      render()
    },
    away(): void {
      const s = navAway(state)
      if (s === state) return
      const title = describeNav(entries, state).title
      state = s
      if (flying) { flyingTo = null; announce({ kind: 'stop' }) }
      else if (s.pos) announce({ kind: 'moved', title })
      render()
    },
    clear(): void { if (state.pos || state.away) { state = navClear(); render() } },
    closeSheet: () => setOpen(false),
    current: () => stepAt(entries, state.pos)?.action ?? null,
    update: () => render(false),
    state: () => ({ state, ready, queued, entries }),
  }
}
