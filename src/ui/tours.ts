import './tours.css'
import './loadProgress.css'
import { ArrivalDwell } from '../journey/dwell'
import { MOMENTS, type Moment } from '../moments'

/** What the tour buttons need from the renderer; main.ts implements it. */
export interface TourHost {
  /** Sets the moment's time and takes the camera there (smoothly unless `instant`). */
  play(m: Moment, instant?: boolean): void
  /** Back to the clock: the time is the present again and follows it (the camera stays). */
  backToNow(): void
  /** Whether the clock follows the present; the Back to now chip shows whenever it does not. */
  isLive(): boolean
  /** Why this moment cannot be shown now (its data did not load), or null. The card says so in place of the caption. */
  unavailable?(m: Moment): string | null
  /** How far this moment's data has got while it loads (text and 0..1, or null for no figure yet), or null when nothing is loading for it. */
  progress?(m: Moment): { text: string; fraction: number | null } | null
  /** Exact journey arrival, independent of previous slider state. */
  arrived?(m: Moment): boolean
  /** Tries the moment again after its data did not load. */
  retry?(m: Moment): void
  /** Stop was pressed: cancel anything still waiting to move the camera. Never moves it. */
  stop?(): void
  /** Called when the visitor grabs the Moon: they have taken over. */
  onGrab(cb: () => void): void
  /** A moment was chosen, by a button, the list, a ?moment= link or the browser's Back (null: back to the free view). */
  onSelect?(m: Moment | null): void
}

// URL parameters a moment replaces: it carries its own time, camera, look, lens, and ground/site start.
const OWN = ['t', 'view', 'lon', 'lat', 'dist', 'roll', 'pitch', 'fov', 'look', 'off', 'aim', 'pin', 'g', 'vp', 'flyt', 'back']

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}
function btn(cls: string, label: string, aria?: string): HTMLButtonElement {
  const b = el('button', cls, label)
  b.type = 'button'
  if (aria) b.setAttribute('aria-label', aria)
  return b
}

/**
 * The tour row at the bottom: one button per moment in MOMENTS, "Play all",
 * and above them the card for the moment on screen (title, caption, what to
 * look at, Back / Stop / Skip). The URL carries ?moment=<id>; opening one
 * starts it. Left and right arrows go to the previous and next moment.
 */
export function mountTours(root: HTMLElement, host: TourHost, initial: string | null, container: HTMLElement | null = null, listContainer: HTMLElement | null = null): { refresh(): void; syncNow(): void; demote(): void; stop(): void; /** Plays a moment by id as the visitor's choice (a history entry), like a button of the row. False when there is no such moment. */ open(id: string): boolean } {
  const wrap = el('div', 'tours')
  if (container) wrap.classList.add('in-viewpoints')
  wrap.setAttribute('role', 'region')
  wrap.setAttribute('aria-label', 'Tours')

  const card = el('div', 'tour-card')
  card.hidden = true
  const head = el('div', 'tour-head')
  const title = el('b', 'tour-title')
  const count = el('span', 'tour-count')
  head.append(title, count)
  const more = btn('tour-more', 'More', 'Show the description and controls')
  more.setAttribute('aria-expanded', 'false')
  more.addEventListener('click', () => { const open = card.classList.toggle('open'); more.textContent = open ? 'Less' : 'More'; more.setAttribute('aria-expanded', String(open)) })
  head.append(more)
  const cap = el('p', 'tour-cap')
  const watch = el('p', 'tour-watch')
  const watchLabel = el('span', '', 'Look at ')
  const watchText = el('span', 'tour-watch-text')
  watch.append(watchLabel, watchText)
  const ctl = el('div', 'tour-ctl')
  const prev = btn('', '‹ Back', 'Previous moment')
  const stop = btn('', 'Stop', 'Stop the tour')
  const skip = btn('', 'Next ›', 'Next moment')
  ctl.append(prev, stop, skip)
  // Loading: what has arrived so far (a line and a bar), or the retry after a failure. Drawn by render() from host.progress / host.unavailable.
  const prog = el('div', 'tour-progress')
  prog.hidden = true
  prog.setAttribute('role', 'status')
  const progText = el('span', 'tour-progress-text')
  const progBar = el('i', 'tour-progress-bar')
  const progFill = el('b')
  progBar.append(progFill)
  prog.append(progText, progBar)
  const retryBtn = btn('tour-retry', 'Retry', 'Try loading this view again')
  retryBtn.hidden = true
  retryBtn.addEventListener('click', () => { const m = MOMENTS[index]; if (m) host.retry?.(m) })
  const bar = el('div', 'tour-bar')
  const fill = el('i')
  bar.append(fill)
  const stale = el('div', 'tour-stale')
  const staleText = el('span', '', 'You moved the time, so this card no longer describes what you see.')
  const staleBtn = btn('', 'Back to the moment', 'Return to the moment this card describes')
  stale.append(staleText, staleBtn)
  stale.hidden = true
  card.append(head, stale, cap, prog, retryBtn, watch, ctl, bar)
  // In the navigator the pill's own live region (announce.ts) speaks; a second one here would say it twice.
  if (!container && listContainer === null) card.setAttribute('aria-live', 'polite')

  const row = el('div', 'tour-row')
  row.setAttribute('role', 'toolbar')
  row.setAttribute('aria-label', 'Cinematic journeys')
  const playAll = btn('play-all', 'Play all', 'Play every moment in turn')
  const chips = MOMENTS.map((m) => {
    const b = btn('chip', m.label)
    b.dataset.id = m.id
    b.addEventListener('click', () => select(MOMENTS.indexOf(m), { auto: false, push: true }))
    return b
  })
  // After Stop the sky keeps the moment's time; this puts the clock back.
  const nowBtn = btn('back-now', "Today's Moon", 'Set the time back to now')
  nowBtn.hidden = true
  nowBtn.addEventListener('click', () => { nowBtn.hidden = true; host.backToNow() })
  // In the navigator's sheet the list is the navigator's: this card keeps the caption, the loading line and Retry for the moment on screen.
  if (listContainer !== null || container) row.append(nowBtn)
  else row.append(nowBtn, playAll, ...chips)
  const tag = el('div', 'tour-archive-tag', 'Cinematic journeys')
  wrap.append(card, tag, row)
  ;(container ?? root).append(wrap)

  let index = -1
  let auto = false
  let timer = 0
  /** The visitor moved the clock after the moment set it: the card is greyed and offers the way back. */
  let demoted = false
  /** The hold has begun (the moment arrived): only then does the progress fill run. Selection resets it. */
  let fillRunning = false
  let fillDwellS = 0

  /** A moment chosen by the visitor is a history entry (Back steps through them); an autoplay advance or Stop replaces the entry. */
  const setUrl = (id: string | null, push = false) => {
    const u = new URL(location.href)
    if (id) {
      for (const k of OWN) u.searchParams.delete(k)
      u.searchParams.set('moment', id)
    } else u.searchParams.delete('moment')
    if (u.href === location.href) return
    if (push) history.pushState({ moon: id }, '', u)
    else history.replaceState({ moon: id }, '', u)
  }

  function render(): void {
    const m = MOMENTS[index]
    // In the navigator the pill names the place and its own row is the way back: a card that no longer describes the sky is not kept.
    card.hidden = !m || (demoted && !!container)
    card.classList.toggle('stale', demoted)
    stale.hidden = !demoted
    chips.forEach((c, i) => c.setAttribute('aria-pressed', String(i === index && !demoted)))
    playAll.setAttribute('aria-pressed', String(auto))
    playAll.textContent = auto ? 'Playing…' : 'Play all'
    if (!m) return
    title.textContent = m.title
    // The list counts places ("4 of 9"); a moment count of its own ("17 of 25") would disagree with it.
    count.textContent = container || listContainer !== null ? '' : `${index + 1} of ${MOMENTS.length}`
    cap.textContent = host.unavailable?.(m) ?? m.caption
    cap.hidden = demoted
    chips.forEach((c, i) => { c.classList.toggle('unavailable', !!host.unavailable?.(MOMENTS[i])) })
    watchText.textContent = m.watch
    watch.hidden = !!host.unavailable?.(m) || demoted
    const loading = host.progress?.(m) ?? null
    prog.hidden = !loading
    if (loading) {
      progText.textContent = loading.text
      progBar.classList.toggle('indeterminate', loading.fraction === null)
      progFill.style.width = loading.fraction === null ? '' : `${Math.round(loading.fraction * 100)}%`
    }
    retryBtn.hidden = !host.unavailable?.(m) || !host.retry
    prev.disabled = index <= 0
    skip.disabled = index >= MOMENTS.length - 1
    bar.hidden = !auto
    // The fill starts at ARRIVAL (the dwell's own start), not at selection: a long flight or a late load must not eat the bar.
    fill.style.animation = 'none'
    if (auto && fillRunning) {
      void fill.offsetWidth
      fill.style.animation = `tour-fill ${fillDwellS}s linear forwards`
    }
    if (!listContainer) chips[index].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }

  function select(i: number, o: { auto: boolean; instant?: boolean; push?: boolean }): void {
    clearTimeout(timer)
    nowBtn.hidden = true
    const was = index
    index = Math.max(0, Math.min(MOMENTS.length - 1, i))
    auto = o.auto
    demoted = false
    fillRunning = false
    const m = MOMENTS[index]
    host.play(m, o.instant)
    setUrl(m.id, !!o.push && (was !== index || new URL(location.href).searchParams.get('moment') !== m.id))
    host.onSelect?.(m)
    render()
    if (auto) {
      const dwell = new ArrivalDwell(m.dwellS * 1000)
      const advance = (): void => {
        if (!auto || MOMENTS[index].id !== m.id) return
        const done = dwell.step(performance.now(), host.arrived?.(m) ?? true)
        if (dwell.consumeStart()) { fillRunning = true; fillDwellS = m.dwellS; render() }
        if (!done) {
          timer = window.setTimeout(advance, 100)
          return
        }
        if (index >= MOMENTS.length - 1) { auto = false; render() } else select(index + 1, { auto: true })
      }
      timer = window.setTimeout(advance, 100)
    }
  }

  function halt(): void {
    host.stop?.()
    clearTimeout(timer)
    auto = false
    index = -1
    demoted = false
    setUrl(null)
    host.onSelect?.(null)
    render()
    syncNow()
  }

  /** The clock was moved by the visitor: what the card says about the sky no longer holds. */
  function demote(): void {
    if (index < 0 || demoted) return
    // A moment still waiting on its patch would otherwise go on to start its descent under a clock the visitor just moved.
    host.stop?.()
    clearTimeout(timer)
    auto = false
    demoted = true
    card.classList.add('open')
    more.textContent = 'Less'
    more.setAttribute('aria-expanded', 'true')
    render()
  }
  staleBtn.addEventListener('click', () => select(index, { auto: false, push: false }))

  // Back and Forward step through the moments the visitor chose; a URL without one is the free view (the camera stays).
  addEventListener('popstate', () => {
    const id = new URL(location.href).searchParams.get('moment')
    const i = id ? MOMENTS.findIndex((m) => m.id === id) : -1
    clearTimeout(timer)
    if (i >= 0) { select(i, { auto: false }); return }
    // Back to the free view: a moment still loading its patch is cancelled (the camera stays where it is).
    host.stop?.()
    auto = false
    index = -1
    demoted = false
    host.onSelect?.(null)
    render()
    syncNow()
  })

  playAll.addEventListener('click', () => (auto ? halt() : select(0, { auto: true })))
  stop.addEventListener('click', halt)
  prev.addEventListener('click', () => select(index - 1, { auto, push: !auto }))
  // Next moment; at the last one it ends a Play all instead of replaying it.
  function next(): void {
    if (index < MOMENTS.length - 1) select(index + 1, { auto, push: !auto })
    else if (auto) { clearTimeout(timer); auto = false; render() }
  }
  skip.addEventListener('click', next)
  // Grabbing the Moon ends the autoplay but keeps the card.
  host.onGrab(() => { if (auto) { clearTimeout(timer); auto = false; render() } })

  // Keep arrow navigation inside the focused tour UI. The camera also owns page-level arrow keys;
  // stopping here prevents a tour step and a camera spin from happening on the same press.
  const onTourKeydown = (e: KeyboardEvent): void => {
    if (index < 0 || e.altKey || e.ctrlKey || e.metaKey) return
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); next() }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation()
      if (index > 0) select(index - 1, { auto, push: !auto })
    }
  }
  wrap.addEventListener('keydown', onTourKeydown)
  listContainer?.addEventListener('keydown', onTourKeydown)

  const start = initial ? MOMENTS.findIndex((m) => m.id === initial) : -1
  if (start >= 0) select(start, { auto: false, instant: true })
  /** The chip follows the clock: it shows whenever the time is not live, whichever way the clock got there. */
  function syncNow(): void { nowBtn.hidden = !!container || index >= 0 || host.isLive() }
  syncNow()
  return { refresh: render, syncNow, demote, stop: halt, open: (id) => { const i = MOMENTS.findIndex((m) => m.id === id); if (i < 0) return false; select(i, { auto: false, push: true }); return true } }
}
