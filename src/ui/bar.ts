import './bar.css'
import { tablerIcon } from './tablerIcons'
import { getDock } from './dock'
import { coalescePerFrame } from '../scrub'
import { TIME_FIELDS_HELP, parseUtcFields } from './timeFields'
import { trackUsage } from '../usage'
import { barCompactLevel } from './dockRow'

/** What the bar needs from the renderer; main.ts implements it. */
export interface BarController {
  getTime(): Date
  /** Sets the moment shown. `live` keeps following the clock. */
  setTime(date: Date, live: boolean): void
  isLive(): boolean
  /** Home: the opening view, the clock at Now, sheets closed. */
  home(): void
  /** Called by the renderer after anything the bar shows has changed (the time). */
  onChange(cb: () => void): void
}

/** An item another feature adds to the bar (Labels, Quality, Relief, Credits). */
export interface BarItem {
  id: string
  label: string
  ariaLabel?: string
  /** Inner markup of a 24 by 24 stroke icon. */
  icon: string
  /** Where it sits among the items: Home is 0, Labels 20, Quality 34, Time 40, More 50, Relief 52, Credits 56. */
  order: number
  onClick(): void
  /** This item lives in the "More" sheet at every width (Quality, Relief, Credits), so the row keeps Home, Labels, Time and More (owner review 2026-10-23, #12: the desktop row showed everything). */
  overflow?: boolean
}

/** A sheet that opens above the bar (the hotspot list, the eclipse list): the bar closes it with the others (Escape, Home). */
export interface BarSheet {
  isOpen(): boolean
  close(): void
}

export interface BarApi {
  /** Adds an item (or replaces the one with its id). */
  addItem(item: BarItem): HTMLButtonElement
  /** Pins a bar item inside a feature-owned sheet until it is released. */
  setItemContainer(id: string, container: HTMLElement | null): void
  /** Registers a sheet another feature owns, so `closeSheets` and `sheetOpen` cover it. */
  registerSheet(sheet: BarSheet): void
  /** Opens one sheet and closes the others (the bar's own and the registered ones). */
  closeSheetsExcept(keep: BarSheet | null): void
  /** Closes the time sheet, the More sheet and every registered sheet; true when one was open. */
  closeSheets(): boolean
  /** Steps the time slider's value by one tick (the [ and ] keys); opens the sheet. */
  timeStep(dir: -1 | 1): void
  /** The time sheet, the More sheet or a registered sheet is open. */
  sheetOpen(): boolean
  /** Where the navigator mounts its buttons (left of the separator) and where the touch pad mounts when it sits in the row. */
  readonly navSlot: HTMLElement
  readonly padSlot: HTMLElement
  /** The pad's own glass row, directly above the bar in the dock, for every width where the whole row does not fit one bar (touchControls.ts says which). Hidden while empty or closed. */
  readonly padRow: HTMLElement
  /**
   * Manual navigation is on (no viewpoint yet, or the visitor moved off one; navigator.ts says): the row is the navigator, Home, Labels, Time and More, and the pad's
   * toggle (touchControls.ts) is in the More sheet. The bar dispatches `barmanual` with the state, so the pad can open itself on a desktop.
   * (The pad standing in the bar's own row, wide screens only, is told by the `barcompact` event the pad sends.)
   */
  setCompact(on: boolean): void
  /** Reserves Back's slot whenever a viewpoint is selected, so other row controls can compact if needed. */
  setBackReserved(on: boolean): void
  /** A flight's slider is in the row: as many items as the width needs (Labels and Time first, then Home) move into the More sheet meanwhile. The pad row, if open, stays where it is. */
  setFlight(on: boolean): void
  /** Re-anchors the slider at the time now shown (Home, a new moment). */
  reanchor(): void
  readonly element: HTMLElement
}

const HOUR_MS = 3_600_000
const MIN_MS = 60_000
/** The Day range is 3 days either way in 15 minute ticks; the Month range is one lunation (29.53 days), 14.77 days either way in hours. */
export const DAY_SPAN_MIN = 3 * 24 * 60
const DAY_STEP_MIN = 15
const MONTH_SPAN_H = Math.round(29.530589 * 24 / 2)

const WHEN = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
})

/** The date and the clock time apart: on a narrow sheet the date may be cut short, the time never is. */
const DATE_FULL = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const DATE_SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const CLOCK = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  if (text !== undefined) e.textContent = text
  return e
}
const ICON = {
  home: tablerIcon('home'),
  time: tablerIcon('clock'),
  more: tablerIcon('dots'),
}

/**
 * The one bar: one glass row of icon buttons, the same on a phone and a desktop: [navigator: prev, list, next] | [Home, Labels, Time, More, controls]. When the open pad does not fit that row it has a glass row of its own right above (`padRow`);
 * on a wide screen it stands in the row between the navigator and the icons (`padSlot`).
 * The labels are the buttons' accessible names and tooltips (and the text in the More sheet). The time sheet opens above the Time button.
 * Other features add their items with `addItem`; those flagged `overflow` (Quality, Relief, Credits) are in the More sheet at every width. There is no Share
 * button (owner review 2026-10-23, #12); the link builder stays in main.ts for the native shell and the S key.
 */
export function mountBar(root: HTMLElement, c: BarController): BarApi {
  const dock = getDock(root)
  const sheet = el('div', { class: 'bar-sheet bar-time', id: 'bar-time', role: 'group', 'aria-label': 'Time' })
  sheet.hidden = true
  const bar = el('nav', { class: 'bar', role: 'toolbar', 'aria-label': 'Moon controls' })
  const navSlot = el('div', { class: 'bar-navslot' })
  const padSlot = el('div', { class: 'bar-padslot' })
  const icons = el('div', { class: 'bar-icons' })
  bar.append(navSlot, padSlot, icons)
  // The pad's own row: before the bar in the DOM too, so Tab meets the pad first, then the bar.
  const padRow = el('div', { class: 'bar-padrow' })
  padRow.hidden = true
  dock.append(sheet, padRow, bar)

  const more = el('div', { class: 'bar-sheet bar-more', id: 'bar-more', role: 'group', 'aria-label': 'More' })
  more.hidden = true
  dock.insertBefore(more, padRow)
  const registered: BarSheet[] = []
  /** A phone's time sheet: the date drops the current year. */
  const tightSheet = window.matchMedia('(max-width: 440px)')
  /** The touch pad stands in the bar's own row (its `barcompact` event); else it has the row above (padRow). */
  let padInRow = false
  let flying = false
  let backReserved = false
  /** Manual navigation is on (setCompact): the pad's toggle is in the More sheet. */
  let manual = false
  const items = new Map<string, { item: BarItem; btn: HTMLButtonElement }>()
  const customContainers = new Map<string, HTMLElement>()
  let moreHasItems = false
  /** More stays while the sheet holds a bar item or something another module put there (another module's item). */
  const syncMore = (): void => {
    const show = moreHasItems || !!more.querySelector(':scope > :not(button[data-bar])')
    items.get('more')?.btn.toggleAttribute('hidden', !show)
    if (!show) setMoreOpen(false)
  }
  /**
   * The pad's toggle is the last icon (touchControls.ts appends it); while manual navigation is on it is in the More sheet, the pad itself being in the row.
   * Re-appended after the items on every place(), so the DOM order is the visual order (its CSS order is 70) and Tab follows the eye.
   */
  const placeToggle = (): void => {
    const toggle = icons.querySelector<HTMLElement>(':scope > .tc-toggle') ?? more.querySelector<HTMLElement>(':scope > .tc-toggle')
    if (!toggle) return
    const target = manual || flying ? more : icons
    if (toggle.parentElement !== target || toggle !== target.lastElementChild) target.append(toggle)
    toggle.classList.toggle('in-more', manual || flying)
  }
  const place = (): void => {
    let any = false
    // A flight's slider in a row too narrow for the icons moves items into More (focus stays on the same item, or on More if it went in). The pad never does: in its own row
    // the bar is exactly the closed bar, and in the bar's row (wide screens) everything fits by construction (dockRow.ts padFitsRow).
    // The classes first: on a wide screen they widen the bar, and the level reads its width.
    bar.classList.toggle('padrow', padInRow)
    bar.classList.toggle('flying', flying)
    bar.classList.toggle('compact', manual)
    const room = bar.getBoundingClientRect().width || Infinity
    const level = barCompactLevel(window.innerWidth, room, flying, padInRow, backReserved)
    const act = document.activeElement as HTMLElement | null
    // Buttons go into the bar in their visual order (not the order they were added in), so the Tab order is the order on screen.
    for (const { item, btn } of [...items.values()].sort((a, b) => a.item.order - b.item.order)) {
      if (customContainers.has(item.id)) continue
      const moved = level === 2 || (level === 1 && item.id !== 'home')
      if (item.id === 'more' || !item.overflow && !moved) { icons.append(btn); btn.classList.remove('in-more'); continue }
      any = true; more.append(btn); btn.classList.add('in-more')
    }
    placeToggle()
    moreHasItems = any
    syncMore()
    // Appending a button re-inserts it and drops its focus: give it back, or hand it to More when the button went into the closed sheet.
    if (act && act !== document.activeElement && act.isConnected && (act.closest('.bar, .bar-more'))) {
      if (more.hidden && more.contains(act)) items.get('more')?.btn.focus({ preventScroll: true })
      else act.focus({ preventScroll: true })
    }
  }
  const setMoreOpen = (open: boolean): void => {
    more.hidden = !open
    items.get('more')?.btn.setAttribute('aria-expanded', String(open))
    items.get('more')?.btn.setAttribute('aria-pressed', String(open))
  }
  const makeBtn = (it: BarItem): HTMLButtonElement => {
    const b = el('button', { type: 'button', 'data-bar': it.id, 'aria-label': it.ariaLabel ?? it.label })
    // Icon only on the bar; the word shows in the More sheet (.lbl) and is the tooltip.
    b.innerHTML = `${it.icon}<span class="lbl">${it.label}</span>`
    b.title = it.ariaLabel ?? it.label
    b.style.order = String(it.order)
    b.addEventListener('click', (ev) => {
      if (more.contains(b)) setMoreOpen(false)
      it.onClick()
      // A keyboard press that opened a sheet moves focus into it: the sheets sit before the bar in the page order, so Tab from the button would skip them.
      const sheetId = b.getAttribute('aria-controls')
      const target = sheetId ? document.getElementById(sheetId) : null
      if (ev.detail === 0 && target && !target.hidden) target.querySelector<HTMLElement>('button:not([hidden]), input, [href]')?.focus({ preventScroll: true })
    })
    return b
  }
  const addItem = (it: BarItem): HTMLButtonElement => {
    items.get(it.id)?.btn.remove()
    const btn = makeBtn(it)
    items.set(it.id, { item: it, btn })
    icons.append(btn)
    place()
    return btn
  }

  // --- the time sheet: the moment shown (UTC), Day or Month, the slider, Now.
  const when = el('button', { type: 'button', class: 'bar-when', 'aria-label': 'Time shown, UTC. Press to type a date and time.' })
  const nowBtn = el('button', { type: 'button', class: 'bar-now' }, 'Now')
  const head = el('div', { class: 'bar-sheet-head' })
  const seg = el('div', { class: 'bar-seg', role: 'group', 'aria-label': 'Slider range' })
  const dayBtn = el('button', { type: 'button', 'aria-label': 'Three days either way' }, '\u00B13 d')
  const monthBtn = el('button', { type: 'button', 'aria-label': 'One lunation' }, 'Month')
  seg.append(dayBtn, monthBtn)
  head.append(when, nowBtn, seg)
  const slider = el('input', { type: 'range', step: '1', value: '0', 'aria-label': 'Time slider' })
  const range = el('div', { class: 'bar-range' })
  range.append(slider)
  sheet.append(head, range)

  let rangeMode: 'day' | 'month' = 'day'
  let anchor = c.getTime().getTime()
  let fromSlider = false
  const applyRange = (): void => {
    const m = rangeMode === 'day' ? DAY_SPAN_MIN : MONTH_SPAN_H
    slider.min = String(-m)
    slider.max = String(m)
    slider.step = rangeMode === 'day' ? String(DAY_STEP_MIN) : '1'
    dayBtn.setAttribute('aria-pressed', String(rangeMode === 'day'))
    monthBtn.setAttribute('aria-pressed', String(rangeMode === 'month'))
    slider.setAttribute('aria-label', rangeMode === 'day' ? 'Time, 3 days either way' : 'Time, one lunation (29.5 days)')
  }
  const unit = (): number => (rangeMode === 'day' ? DAY_STEP_MIN * MIN_MS : HOUR_MS)
  const sliderToValue = (t: number): number => {
    const m = rangeMode === 'day' ? DAY_SPAN_MIN : MONTH_SPAN_H
    // Day ticks are minutes in steps of 15; Month ticks are hours.
    const v = rangeMode === 'day' ? Math.round((t - anchor) / MIN_MS / DAY_STEP_MIN) * DAY_STEP_MIN : Math.round((t - anchor) / HOUR_MS)
    return Math.max(-m, Math.min(m, v))
  }
  const sliderMs = (): number => Number(slider.value) * (rangeMode === 'day' ? MIN_MS : HOUR_MS)

  const refresh = (): void => {
    const t = c.getTime()
    // Narrow: the year goes when it is the current one. The clock time is its own span, so it always shows whole.
    const sameYear = t.getUTCFullYear() === new Date().getUTCFullYear()
    const dateText = (tightSheet.matches && sameYear ? DATE_SHORT : DATE_FULL).format(t) + ','
    const timeText = CLOCK.format(t) + ' UTC'
    const wd = when.firstElementChild
    if (wd?.textContent !== dateText || when.lastElementChild?.textContent !== timeText) {
      const d = el('span', { class: 'w-date' }, dateText)
      const k = el('span', { class: 'w-time' }, timeText)
      when.replaceChildren(d, ' ', k)
    }
    when.classList.toggle('live', c.isLive())
    nowBtn.disabled = c.isLive()
    // Once the clock is not live the Time icon is tinted blue; the date is in its name and tooltip.
    const tb = items.get('time')?.btn
    if (tb) {
      const name = c.isLive() ? 'Time' : `Time, set to ${WHEN.format(t)} UTC`
      tb.setAttribute('aria-label', name)
      tb.title = name
      tb.classList.toggle('not-live', !c.isLive())
    }
    // A time that changed from outside the slider (Now, Home, a moment) moves the zero to where it is.
    if (!fromSlider) anchor = t.getTime()
    slider.value = String(fromSlider ? Number(slider.value) : sliderToValue(t.getTime()))
  }
  /** Usage: how the visitor changed the time (the kind only, never the date). */
  const noteTime = (kind: 'now' | 'preset' | 'scrub'): void => trackUsage('time_change', { kind })
  const setTime = (d: Date, live = false): void => {
    fromSlider = false
    c.setTime(d, live)
    refresh()
  }
  // One clock update per frame, whatever the pointer's event rate: each update is an ephemeris and a new picture, and only the latest one is ever drawn.
  const sliderApply = coalescePerFrame<Date>((d) => {
    fromSlider = true
    c.setTime(d, false)
    fromSlider = false
  })
  slider.addEventListener('input', () => { noteTime('scrub'); sliderApply.push(new Date(anchor + sliderMs())) })
  slider.addEventListener('change', () => sliderApply.flush())
  // The handler above sets the time; main calls onChange -> refresh() while fromSlider is true, so the slider's zero stays where it was.
  nowBtn.addEventListener('click', () => { noteTime('now'); anchor = Date.now(); setTime(new Date(), true) })
  dayBtn.addEventListener('click', () => { rangeMode = 'day'; anchor = c.getTime().getTime(); applyRange(); refresh() })
  monthBtn.addEventListener('click', () => { rangeMode = 'month'; anchor = c.getTime().getTime(); applyRange(); refresh() })
  applyRange()

  // Typing a moment: two plain fields in the sheet (UTC date and time), styled like the bar. The browser's own date popup is not used:
  // it cannot be styled and opens at the top of the page.
  const editor = el('form', { class: 'bar-edit', 'aria-label': 'Type a date and time, UTC' })
  editor.hidden = true
  const dateIn = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'YYYY-MM-DD', maxlength: '10', 'aria-label': 'Date, UTC (year-month-day)', spellcheck: 'false' })
  const timeIn = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'HH:MM', maxlength: '5', 'aria-label': 'Time, UTC (hours:minutes)', spellcheck: 'false' })
  const setBtn = el('button', { type: 'submit' }, 'Set')
  editor.append(dateIn, timeIn, setBtn)
  // A red border alone says nothing: the plain rule goes under the fields while they are invalid.
  const editError = el('p', { class: 'bar-edit-error', role: 'alert' })
  editError.hidden = true
  const clearInvalid = (): void => { dateIn.removeAttribute('aria-invalid'); timeIn.removeAttribute('aria-invalid'); editError.hidden = true }
  dateIn.addEventListener('input', clearInvalid)
  timeIn.addEventListener('input', clearInvalid)
  editor.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); openEditor(false); when.focus({ preventScroll: true }) } })
  head.after(editor, editError)
  const openEditor = (open: boolean): void => {
    editor.hidden = !open
    if (!open) editError.hidden = true
    when.setAttribute('aria-expanded', String(open))
    if (open) {
      const iso = c.getTime().toISOString()
      dateIn.value = iso.slice(0, 10)
      timeIn.value = iso.slice(11, 16)
      clearInvalid()
      dateIn.focus({ preventScroll: true }); dateIn.select()
    }
  }
  when.setAttribute('aria-expanded', 'false')
  when.addEventListener('click', () => openEditor(!!editor.hidden))
  editor.addEventListener('submit', (ev) => {
    ev.preventDefault()
    const d = parseUtcFields(dateIn.value, timeIn.value)
    dateIn.toggleAttribute('aria-invalid', !d)
    timeIn.toggleAttribute('aria-invalid', !d)
    if (!d) { editError.textContent = TIME_FIELDS_HELP; editError.hidden = false; return }
    noteTime('preset')
    setTime(d)
    openEditor(false)
    when.focus({ preventScroll: true })
  })

  /** The sheet stands over the Time button: its centre follows the button's, kept inside the dock. */
  const anchorSheet = (): void => {
    const btn = items.get('time')?.btn
    if (!btn || sheet.hidden) return
    sheet.style.marginLeft = ''
    sheet.style.alignSelf = ''
    sheet.style.justifySelf = ''
    const dockBox = dock.getBoundingClientRect()
    const b = btn.getBoundingClientRect()
    const w = sheet.getBoundingClientRect().width
    if (!dockBox.width || !b.width) return
    const pad = parseFloat(getComputedStyle(dock).paddingLeft) || 0
    const left = Math.min(dockBox.width - pad - w, Math.max(pad, b.left + b.width / 2 - dockBox.left - w / 2))
    sheet.style.alignSelf = 'flex-start'
    sheet.style.justifySelf = 'start'
    sheet.style.marginLeft = `${Math.round(left)}px`
  }
  window.addEventListener('resize', anchorSheet)
  const setTimeOpen = (open: boolean): void => {
    if (open) { setMoreOpen(false); for (const r of registered) r.close() }
    sheet.hidden = !open
    items.get('time')?.btn.setAttribute('aria-expanded', String(open))
    items.get('time')?.btn.setAttribute('aria-pressed', String(open))
    if (!open) openEditor(false)
    if (open) { refresh(); anchorSheet() }
  }

  const home = addItem({ id: 'home', label: 'Home', ariaLabel: 'Home', icon: ICON.home, order: 0, onClick: () => { setTimeOpen(false); c.home() } })
  home.title = 'Home (H)'
  addItem({ id: 'time', label: 'Time', icon: ICON.time, order: 40, onClick: () => setTimeOpen(!!sheet.hidden) })
  addItem({ id: 'more', label: 'More', icon: ICON.more, order: 50, onClick: () => { const open = !!more.hidden; if (open) { setTimeOpen(false); for (const r of registered) r.close() } setMoreOpen(open) } })
  items.get('more')?.btn.setAttribute('aria-controls', 'bar-more')
  items.get('more')?.btn.setAttribute('aria-expanded', 'false')
  // A narrower window with the pad or a flight in the row: the fold is read from the new width (the pad's barcompact alone says nothing when its row state is unchanged).
  window.addEventListener('resize', () => { if (flying) place() })
  // The touch pad (touchControls.ts) tells the row when it stands in it.
  bar.addEventListener('barcompact', (e) => { const on = (e as CustomEvent<boolean>).detail; if (padInRow !== on) { padInRow = on; place() } })
  // Content another module adds to the sheet or takes back shows or hides More without a full place(); the pad's toggle, appended to the icons after the bar mounted, goes where manual navigation says.
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(syncMore).observe(more, { childList: true })
    new MutationObserver(() => { if (manual) placeToggle() }).observe(icons, { childList: true })
  }
  // The toggle in the sheet closes it like the sheet's own items do (on a phone the pad's opening moves Home, Labels and Time into the sheet: not into an open one).
  more.addEventListener('click', (e) => { if ((e.target as Element | null)?.closest('.tc-toggle')) setMoreOpen(false) })
  place()
  items.get('time')?.btn.setAttribute('aria-controls', 'bar-time')
  items.get('time')?.btn.setAttribute('aria-expanded', 'false')

  c.onChange(refresh)
  tightSheet.addEventListener('change', refresh)
  refresh()

  return {
    element: bar,
    navSlot,
    padSlot,
    padRow,
    setCompact(on) { if (manual !== on) { manual = on; place(); bar.dispatchEvent(new CustomEvent('barmanual', { detail: on })) } },
    setBackReserved(on) { if (backReserved !== on) { backReserved = on; place() } },
    setFlight(on) { if (flying !== on) { flying = on; place(); bar.dispatchEvent(new CustomEvent('barflight', { detail: on })) } },
    addItem,
    setItemContainer(id, container) {
      const entry = items.get(id)
      if (!entry) return
      if (container) {
        customContainers.set(id, container)
        container.append(entry.btn)
      } else {
        customContainers.delete(id)
        place()
      }
    },
    registerSheet(s) { registered.push(s) },
    closeSheetsExcept(keep) {
      setTimeOpen(false)
      setMoreOpen(false)
      for (const r of registered) if (r !== keep) r.close()
    },
    closeSheets(): boolean {
      const was = !sheet.hidden || !more.hidden || registered.some((r) => r.isOpen())
      // Focus inside a sheet goes back to the bar button that opened it, not to the page.
      const owner = document.activeElement?.closest('.bar-sheet')?.id
      setTimeOpen(false)
      setMoreOpen(false)
      for (const r of registered) r.close()
      if (owner) bar.querySelector<HTMLElement>(`[aria-controls="${owner}"]`)?.focus({ preventScroll: true })
      return was
    },
    sheetOpen: () => !sheet.hidden || !more.hidden || registered.some((r) => r.isOpen()),
    timeStep(dir) {
      setTimeOpen(true)
      fromSlider = true
      const step = unit()
      const next = Math.max(Number(slider.min), Math.min(Number(slider.max), Number(slider.value) + dir * (step / (rangeMode === 'day' ? MIN_MS : HOUR_MS))))
      slider.value = String(next)
      c.setTime(new Date(anchor + sliderMs()), false)
      fromSlider = false
    },
    reanchor() { anchor = c.getTime().getTime(); refresh() },
  }
}
