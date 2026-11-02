import './labels.css'
import type { Ephemeris } from '../ephemeris'
import type { ViewCamera } from '../camera/pose'
import { LABELS, type MoonLabel } from '../labels/data'
import { candidatesInSphericalCone, labelIndex } from '../labels/spatial'
import { gazetteerTable, loadGazetteer } from '../labels/gazetteerTable'
import { pickCentreGazetteer, pickGazetteer, gazRepickDue, GAZ_SPAN_KM } from '../labels/gazetteerPick'
import { CURATED, FAME, isCuratedName, type CuratedKind, type CuratedLabel, type Tier } from '../labels/curated'
import { centreFill, fillCells, fillCellAt, holdsCell, drawnBox, eligible, fillEligible, leavingLabelReleased, limbAlpha, placeOrReuse, placePosts, postLength, settleMoves, shownSlots, stepLives, thirds, CENTRE_FILL, GAP_PX, ICON_HALF_PX, type Box, type DropReason, type FillCell, type Life, type Placement, type PostCandidate, type Slot, type Verdict } from '../labels/postLayout'
import { motionThinActive, selectMotionCandidates, LABELS_MOTION_CAP_DESKTOP, LABELS_MOTION_CAP_PHONE, LABELS_MOTION_REST_MS, type MotionThinState } from '../labels/motionThin'
import { terminatorCircle, terminatorPoint, unitOf, lonLatOf, type V3 } from '../labels/terminator'
import { labelCardLines } from './labelCard'

/**
 * The Labels layer (owner 2026-10-17, design "Posts"). Each label stands on a thin
 * post that rises from its place along the surface normal, so the posts lean with the globe as it turns; the name hangs at
 * the post's tip, and the feature's icon (one colour for every kind) marks the place itself. Major names carry a line of
 * context. The layout (src/labels/postLayout.ts) decides which show and where; this file projects, measures and draws.
 * Off by default: the bar's Labels button (main.ts) turns it on.
 */

export type LabelKind = CuratedKind | 'terminator'
/** A drawn label: a curated row, or the live terminator point. */
export interface ShownLabel extends Omit<CuratedLabel, 'kind'> { kind: LabelKind }

export interface LabelsHost {
  /** A label was chosen: fly there. */
  select(l: ShownLabel): void
  /** A search result (the full Gazetteer) was chosen. */
  search(l: MoonLabel): void
  /** The pointer is on a label (light its area up), or left it (null). */
  highlight(l: ShownLabel | null): void
}

export interface LabelsFrame {
  cam: ViewCamera
  aspect: number
  vw?: number
  vh?: number
  e: Ephemeris
  dist: number
  fovDeg: number
  /** A ground view, a descent, a tour, the ridge or an orbit has the camera: the names step aside. */
  hidden: boolean
  /** The app's gesture or scripted camera motion state. */
  moving?: boolean
  /** Screen areas the labels must not cover (the caption, the bar, the pins). */
  blocked: Box[]
  /** Surface radius at a place (1 is the mean sphere), for the post's foot. */
  surfaceRadius?: (lon: number, lat: number) => number
}

const DEG = Math.PI / 180
const R_KM = 1737.4
const TERMINATOR_ID = 'terminator'
const GAZ_KIND = (t = ''): CuratedKind => /^(Mons|Promontorium)/.test(t) ? 'mountain' : /^(Rima|Vallis|Rupes|Catena|Dorsum|Dorsa)/.test(t) ? 'valley' : /^(Mare|Lacus|Sinus|Palus|Oceanus)/.test(t) ? 'mare' : 'crater'
const gazCache = new Map<string, ShownLabel>()
/** A Gazetteer feature as a minor label (name, place and size from the table; no line of context). */
function gazLabel(g: MoonLabel): ShownLabel {
  const id = `gaz:${g.id}`
  let l = gazCache.get(id)
  if (!l) {
    l = { id, name: g.name, kind: GAZ_KIND(g.featureType), tier: 3, lon: g.lon, lat: g.lat, sizeKm: g.sizeKm ?? 0, fact: '', source: g.source }
    gazCache.set(id, l)
  }
  return l
}
const TERMINATOR_FACT = 'Where day meets night: the longest shadows'
const NS = 'http://www.w3.org/2000/svg'

/** Icons, 16 px, drawn in the one label colour. Each has a dark halo under it so it reads on bright and dark ground alike. */
const ICON_PATHS: Record<LabelKind | 'impact', string> = {
  mare: 'M2.6 6.4q1.35-1.5 2.7 0t2.7 0 2.7 0 2.7 0M2.6 10.2q1.35-1.5 2.7 0t2.7 0 2.7 0 2.7 0',
  crater: 'M8 2.9a5.1 5.1 0 1 0 0.01 0zM4.9 7.2a3.4 3.4 0 0 1 4.2-2.6',
  mountain: 'M1.8 12.8 6.4 4.6l2.5 4.2 1.5-2.2 3.8 6.2z',
  valley: 'M2.8 3.6c3.6 1 .2 4.4 3.6 5.2s4.2-1.4 5.2.8-.7 2.8 1.6 3.2',
  point: 'M8 2.2 9.5 6.5 13.8 8 9.5 9.5 8 13.8 6.5 9.5 2.2 8 6.5 6.5z',
  mission: 'M5.3 4.4h5.4v3.8H5.3zM5.3 8.2 3.4 12.4M10.7 8.2l1.9 4.2M2.5 12.4h1.8M11.7 12.4h1.8M7.1 8.2l-.3 1.5h2.4l-.3-1.5',
  impact: 'M8 2.4v7.2M5.1 6.8 8 9.7l2.9-2.9M3.4 12.8h9.2',
  terminator: 'M8 2.9a5.1 5.1 0 1 0 0.01 0zM8 2.9v10.2',
}
const iconKey = (l: ShownLabel): keyof typeof ICON_PATHS => l.kind === 'mission' && (l.status === 'impact' || l.status === 'crashed') ? 'impact' : l.kind

const KIND_WORD: Record<LabelKind, string> = { mare: 'sea', crater: 'crater', mountain: 'mountain', valley: 'valley or scarp', point: 'point', mission: 'mission', terminator: 'day-night line' }
const STATUS_WORD = { crewed: 'crewed landing', landed: 'robotic landing', impact: 'impact', crashed: 'crashed' } as const

/** Type sizes by tier, rem (labels.css uses the same): the name, and the fact line of a major label. Measured at the page's root size. */
const NAME_REM: Record<Tier, number> = { 1: 0.875, 2: 0.78125, 3: 0.71875 }
const NAME_WEIGHT: Record<Tier, number> = { 1: 600, 2: 600, 3: 500 }
const FACT_REM = 0.71875
const META_REM = 0.6875
/** The widest a fact line may run, in multiples of its own font size. */
const FACT_MAX_EM = 20.5
const PAD_X = 3
const PAD_Y = 2

interface Measure { w: number; h: number; nameH: number; facts: string[] }
interface Entry {
  l: ShownLabel
  button: HTMLButtonElement
  facts: HTMLElement
  g: SVGGElement
  post: SVGPathElement
  icon: SVGGElement
  /** The drawn offset of the name box from the tip, eased toward the slot's. */
  off: { x: number; y: number } | null
  lf: number
  side: Slot['side']
  shownFacts: string
  /** Drawn in its compact form (the name alone). */
  compact: boolean
  /** The values last written to the DOM (labelfast): a frame writes only what differs. */
  c: Written
}
/** What an entry's elements currently hold, as the strings last written. */
interface Written { tf: string; op: string; gop: string; w: number; side: string; hov: boolean; tab: number; d: string; ix: string; iy: string; base: string }

/** `?labelfast=0` restores the write path from before R58 (every value written every frame, left at 0.1 px). On unless `=0`. */
export function labelFastFromSearch(search: string): boolean {
  return new URLSearchParams(search).get('labelfast') !== '0'
}

/** `?labelthin=0` keeps the complete set of names visible during camera motion. */
export function labelThinFromSearch(search: string): boolean {
  return new URLSearchParams(search).get('labelthin') !== '0'
}

/** `?labelspread=0` switches the grid-based region fill off (postLayout.ts `centreFill`). */
export function labelSpreadFromSearch(search: string): boolean {
  return new URLSearchParams(search).get('labelspread') !== '0'
}

/** Mounts the layer. `initiallyOn` from ?labels=1. `fast` (default: not `?labelfast=0`) writes only changed values, in device pixels, and reads no layout inside a frame. `spread` (default: not `?labelspread=0`) fills short cells over the Moon disc. */
export function mountLabels(root: HTMLElement, host: LabelsHost, initiallyOn = false, fast = labelFastFromSearch(typeof location === 'undefined' ? '' : location.search), thin = labelThinFromSearch(typeof location === 'undefined' ? '' : location.search), spread = labelSpreadFromSearch(typeof location === 'undefined' ? '' : location.search)): {
  update(f: LabelsFrame): void; prepareFrame(): void; isOn(): boolean; setOn(on: boolean): void; visibleIds(): string[]; onChange(cb: (on: boolean) => void): void; debug(): unknown; stats(): { stepMs: number; cand: number; place: number; dom: number; n: number; drawn: number }
} {
  const layer = document.createElement('div')
  layer.className = fast ? 'moon-labels ml-fast' : 'moon-labels'
  layer.setAttribute('role', 'group')
  layer.setAttribute('aria-label', 'Names on the Moon')
  const svg = document.createElementNS(NS, 'svg')
  svg.classList.add('ml-svg')
  svg.setAttribute('aria-hidden', 'true')
  const term = document.createElementNS(NS, 'path')
  term.classList.add('ml-term')
  const posts = document.createElementNS(NS, 'g')
  svg.append(term, posts)
  const names = document.createElement('div')
  names.className = 'ml-names'
  const card = document.createElement('div')
  card.className = 'ml-card'
  card.setAttribute('role', 'tooltip')
  card.id = 'ml-card'
  card.hidden = true
  layer.append(svg, names, card)
  root.append(layer)

  // ---- Measuring (once per label and state): the canvas font matches the CSS below.
  const ctx = document.createElement('canvas').getContext('2d')
  const family = getComputedStyle(root).fontFamily || 'ui-sans-serif, system-ui, sans-serif'
  const textW = (font: string, text: string, spacingEm = 0, px = 12): number => {
    if (!ctx) return text.length * px * 0.58
    ctx.font = font
    return ctx.measureText(text).width + spacingEm * px * text.length
  }
  const nameText = (l: ShownLabel): string => (l.kind === 'mare' ? l.name.toUpperCase() : l.name)
  const nameSpacing = (l: ShownLabel): number => (l.kind === 'mare' ? 0.1 : 0.01)
  let rootPx = 16
  const wrap = (text: string): string[] => {
    const FACT_PX = FACT_REM * rootPx, FACT_MAX_W = FACT_MAX_EM * FACT_PX
    const font = `500 ${FACT_PX}px ${family}`
    const words = text.split(/\s+/)
    const lines: string[] = []
    let cur = ''
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w
      if (cur && textW(font, t) > FACT_MAX_W) { lines.push(cur); cur = w } else cur = t
    }
    if (cur) lines.push(cur)
    // Balance two lines so the last is not a lone word.
    if (lines.length === 2) {
      for (;;) {
        const a = lines[0].split(' ')
        if (a.length < 2) break
        const moved = a.pop() as string
        const na = a.join(' '), nb = `${moved} ${lines[1]}`
        if (textW(font, nb) > FACT_MAX_W || textW(font, na) < textW(font, nb)) break
        lines[0] = na; lines[1] = nb
      }
    }
    return lines.slice(0, 2)
  }
  const measures = new Map<string, Measure>()
  const measure = (l: ShownLabel, withFact: boolean): Measure => {
    const key = `${l.id}|${withFact ? 1 : 0}|${rootPx}`
    const known = measures.get(key)
    if (known) return known
    const px = NAME_REM[l.tier] * rootPx, FACT_PX = FACT_REM * rootPx
    let w = textW(`${NAME_WEIGHT[l.tier]} ${px}px ${family}`, nameText(l), nameSpacing(l), px)
    if (l.year) w += 6 + textW(`500 ${META_REM * rootPx}px ${family}`, String(l.year))
    const facts = withFact && l.fact ? wrap(l.fact) : []
    for (const f of facts) w = Math.max(w, textW(`500 ${FACT_PX}px ${family}`, f))
    const nameH = Math.round(px * 1.35) + PAD_Y
    const m = { w: Math.ceil(w) + 2 * PAD_X + 2, h: nameH + Math.round(facts.length * FACT_PX * 1.32) + PAD_Y, nameH, facts }
    measures.set(key, m)
    return m
  }

  // ---- Entries (DOM made on first show, kept while on screen or fading).
  const entries = new Map<string, Entry>()
  const lastRender = new Map<string, { c: PostCandidate; meta: { l: ShownLabel; alpha: number; m: Measure; short: Measure } }>()
  let hoverId: string | null = null
  let focusId: string | null = null
  const make = (l: ShownLabel): Entry => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `ml t${l.tier} k-${l.kind}`
    b.dataset.label = l.id
    b.dataset.passDrag = ''
    const meta = l.kind === 'mission' ? `, ${l.year}, ${l.agency}, ${STATUS_WORD[l.status ?? 'landed']}` : l.sub ? `, ${l.sub}` : `, ${KIND_WORD[l.kind]}`
    b.setAttribute('aria-label', `${l.name}${meta}${l.fact ? `. ${l.fact}` : ''}. Fly there`)
    b.setAttribute('aria-describedby', 'ml-card')
    const row = document.createElement('span')
    row.className = 'ml-row'
    const name = document.createElement('span')
    name.className = 'ml-name'
    name.textContent = l.name
    row.append(name)
    if (l.year) {
      const y = document.createElement('span')
      y.className = 'ml-year'
      y.textContent = String(l.year)
      row.append(y)
    }
    const facts = document.createElement('span')
    facts.className = 'ml-facts'
    b.append(row, facts)
    const enter = (): void => { hoverId = l.id; showCard(l); host.highlight(l); kick() }
    const leave = (): void => { if (hoverId === l.id) { hoverId = null; card.hidden = true; host.highlight(null); kick() } }
    b.addEventListener('pointerenter', enter)
    b.addEventListener('pointerleave', leave)
    b.addEventListener('focus', enter)
    b.addEventListener('blur', leave)
    b.addEventListener('click', (ev) => { ev.stopPropagation(); focusId = l.id; card.hidden = true; hoverId = null; host.select(l) })
    names.append(b)
    const g = document.createElementNS(NS, 'g')
    g.classList.add('ml-g', `t${l.tier}`)
    g.dataset.label = l.id
    const post = document.createElementNS(NS, 'path')
    post.classList.add('ml-post')
    const icon = document.createElementNS(NS, 'g')
    icon.classList.add('ml-icon')
    const path = ICON_PATHS[iconKey(l)]
    icon.innerHTML = `<path class="ml-halo" d="${path}"/><path class="ml-stroke" d="${path}"/>${l.kind === 'terminator' ? '<path class="ml-fill" d="M8 2.9a5.1 5.1 0 0 0 0 10.2z"/>' : ''}`
    g.append(post, icon)
    posts.append(g)
    return { l, button: b, facts, g, post, icon, off: null, lf: 1, side: 'r', shownFacts: '', compact: false, c: { tf: '', op: '', gop: '', w: -1, side: '', hov: false, tab: 99, d: '', ix: '', iy: '', base: '' } }
  }
  const drop = (id: string): void => {
    const e = entries.get(id)
    if (!e) return
    if (document.activeElement === e.button) return
    e.button.remove(); e.g.remove(); entries.delete(id); lastRender.delete(id)
  }

  // The hover card: only details the visible label does not already show, plus the action.
  let cardSize: { w: number; h: number } | null = null
  let cardTf = ''
  const showCard = (l: ShownLabel): void => {
    const lines = labelCardLines(l, entries.get(l.id)?.compact ?? false)
    card.innerHTML = lines.map(({ kind, text }) => `<span>${kind === 'action' ? `<b>${esc(text)}</b>` : `<i>${esc(text)}</i>`}</span>`).join('')
    card.hidden = false
    card.dataset.for = l.id
    cardSize = null
    cardTf = ''
    // One layout read per hover (not per frame): the card's size is fixed until its text changes.
    if (fast) cardSize = { w: card.offsetWidth || 200, h: card.offsetHeight || 40 }
  }

  // ---- Clearing the flown-to pin: any input of the visitor's own on the Moon.
  const unfocus = (ev: Event): void => {
    if (ev.target instanceof Element && ev.target.closest('.ml, .ml-search')) return
    focusId = null
  }
  window.addEventListener('pointerdown', unfocus, true)
  window.addEventListener('wheel', unfocus, { capture: true, passive: true })

  // ---- Search (the full Gazetteer), kept from the earlier layer.
  const search = document.createElement('div')
  search.className = 'ml-search'
  search.setAttribute('role', 'search')
  const searchInput = document.createElement('input')
  searchInput.id = 'lunar-feature-search'
  searchInput.type = 'search'
  searchInput.autocomplete = 'off'
  searchInput.placeholder = 'Find a lunar feature'
  searchInput.setAttribute('aria-label', 'Find a lunar feature')
  searchInput.setAttribute('aria-controls', 'lunar-feature-results')
  searchInput.setAttribute('aria-expanded', 'false')
  const searchResults = document.createElement('div')
  searchResults.className = 'ml-search-results'
  searchResults.id = 'lunar-feature-results'
  searchResults.setAttribute('role', 'listbox')
  searchResults.hidden = true
  search.append(searchInput, searchResults)
  layer.append(search)
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLocaleLowerCase()
    searchResults.replaceChildren()
    if (query.length < 2) { searchResults.hidden = true; searchInput.setAttribute('aria-expanded', 'false'); return }
    // The Gazetteer's names load after the first frame; a search typed before then waits for them and runs again.
    if (!gazetteerTable()) void loadGazetteer().then(() => { if (searchInput.value.trim().toLocaleLowerCase() === query) searchInput.dispatchEvent(new Event('input')) }, () => undefined)
    const matches = LABELS.filter((l) => l.name.toLocaleLowerCase().includes(query)).slice(0, 8)
    for (const l of matches) {
      const result = document.createElement('button')
      result.type = 'button'
      result.className = 'ml-search-result'
      result.setAttribute('role', 'option')
      result.textContent = `${l.name} · ${l.kind === 'site' ? 'Landing site' : l.featureType?.replace(/,.*$/, '') ?? l.kind}`
      result.addEventListener('pointerdown', (ev) => ev.stopPropagation())
      result.addEventListener('click', (ev) => { ev.stopPropagation(); searchResults.hidden = true; searchInput.setAttribute('aria-expanded', 'false'); host.search(l) })
      searchResults.append(result)
    }
    searchResults.hidden = matches.length === 0
    searchInput.setAttribute('aria-expanded', String(!searchResults.hidden))
  })

  // ---- The frame loop: driven by main.ts after every drawn frame; between camera moves it runs itself while names fade or slide.
  const units = new Map<string, V3>(CURATED.map((l) => [l.id, unitOf(l.lon, l.lat)]))
  const lives = new Map<string, Life>()
  const MAIN_DRAWING_MS = 34
  let on = initiallyOn
  let lastFrame: LabelsFrame | null = null
  let lastAt = 0
  let lastUpdateAt = -Infinity
  let gazPick: { at: number; span: number; rows: ShownLabel[] } | null = null
  /** The region fill's Gazetteer pick (above GAZ_SPAN_KM, while one or more cells are short), on the same cadence as gazPick. */
  let centrePick: { at: number; span: number; rows: ShownLabel[] } | null = null
  let gazNeedsReconciliation = true
  let placementNeedsReconciliation = true
  let lastInputKey = ''
  let lastPlace: { at: number; placed: Map<string, Placement>; reused: boolean } | null = null
  let lastThinning: boolean | null = null
  const thinState: MotionThinState = { lastMovingAt: null }
  let lastPinKey = ''
  let selfFrame = 0
  let busy = false
  let shown: string[] = []
  const listeners: Array<(on: boolean) => void> = []
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const kick = (): void => {
    if (selfFrame || !lastFrame || !on) return
    selfFrame = -1
    // Queue after the current rAF callback so our next tick follows main.ts's frame loop, never interrupting its read/write phases.
    queueMicrotask(() => { if (selfFrame === -1) selfFrame = requestAnimationFrame(selfStep) })
  }
  const selfStep = (): void => {
    selfFrame = 0
    if (!lastFrame || !on) return
    const now = performance.now()
    if (now - lastUpdateAt > MAIN_DRAWING_MS && now - lastAt > 4) step(lastFrame, now)
    else if (busy) kick()
  }

  function step(f: LabelsFrame, now: number): void {
    const t0 = performance.now()
    stepInner(f, now)
    stepMs = performance.now() - t0
  }
  let stepMs = 0
  // ---- labelfast: what the frame needs from the page, read when it can change (a resize, the layer turning on), never inside a frame.
  let vw = 0, vh = 0, dpr = 1
  let searchRect: Box | null = null
  let metricsDirty = true
  const refreshMetrics = (): void => {
    metricsDirty = false
    vw = window.innerWidth; vh = window.innerHeight
    dpr = Math.max(1, window.devicePixelRatio || 1)
    // The page's root font size (the visitor's text size): every name is measured at it.
    rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const sb = searchInput.getBoundingClientRect()
    searchRect = sb.width > 0 ? [sb.left - 6, sb.top - 6, sb.right + 6, sb.bottom + 6] : null
    cardSize = null; cardTf = ''
    if (card && !card.hidden) cardSize = { w: card.offsetWidth || 200, h: card.offsetHeight || 40 }
  }
  const prepareFrame = (): void => { if (fast && metricsDirty) refreshMetrics() }
  window.addEventListener('resize', () => { metricsDirty = true })
  /** A coordinate on the device-pixel grid (labelfast), as the shortest string that holds it. */
  const px = (v: number): string => String(Math.round(Math.round(v * dpr) / dpr * 100) / 100)
  let awayNow: boolean | null = null
  let termD: string | null = null
  function stepInner(f: LabelsFrame, now: number): void {
    const tStep0 = performance.now()
    const dt = lastAt ? Math.max(0, Math.min(64, now - lastAt)) : 16
    lastAt = now
    if (!fast) layer.classList.toggle('away', f.hidden) // labelfast=0
    else if (awayNow !== f.hidden) { awayNow = f.hidden; layer.classList.toggle('away', f.hidden); search.inert = f.hidden }
    if (!fast) search.inert = f.hidden // labelfast=0
    if (f.hidden) { busy = false; return }
    const thinning = thin && motionThinActive(thinState, !!f.moving, now)
    if (fast && metricsDirty) refreshMetrics()
    const w = f.vw ?? (fast ? vw : window.innerWidth), h = f.vh ?? (fast ? vh : window.innerHeight) // labelfast=0 reads the window each frame
    const { cam, e } = f
    const inputKey = JSON.stringify([
      f.hidden, w, h, f.aspect, f.dist, f.fovDeg, f.blocked,
      cam.pos.x, cam.pos.y, cam.pos.z,
      cam.back.x, cam.back.y, cam.back.z,
      cam.right.x, cam.right.y, cam.right.z,
      cam.up.x, cam.up.y, cam.up.z, cam.tanHalf,
      e.moonX.x, e.moonX.y, e.moonX.z,
      e.moonY.x, e.moonY.y, e.moonY.z,
      e.moonZ.x, e.moonZ.y, e.moonZ.z,
      e.subSolar.lon, e.subSolar.lat,
    ])
    if (inputKey !== lastInputKey) {
      lastInputKey = inputKey
      gazNeedsReconciliation = true
      placementNeedsReconciliation = true
    }
    // The page's root font size (the visitor's text size): every name is measured at it.
    if (!fast) rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16 // labelfast=0
    const tanV = cam.tanHalf, tanH = cam.tanHalf * f.aspect
    // World direction of a Moon-fixed unit.
    const world = (u: V3): V3 => [
      e.moonX.x * u[0] + e.moonY.x * u[1] + e.moonZ.x * u[2],
      e.moonX.y * u[0] + e.moonY.y * u[1] + e.moonZ.y * u[2],
      e.moonX.z * u[0] + e.moonY.z * u[1] + e.moonZ.z * u[2],
    ]
    const project = (p: V3): { x: number; y: number; z: number } | null => {
      const vx = p[0] - cam.pos.x, vy = p[1] - cam.pos.y, vz = p[2] - cam.pos.z
      const z = -(vx * cam.back.x + vy * cam.back.y + vz * cam.back.z)
      if (z <= 1e-6) return null
      const nx = (vx * cam.right.x + vy * cam.right.y + vz * cam.right.z) / (z * tanH)
      const ny = (vx * cam.up.x + vy * cam.up.y + vz * cam.up.z) / (z * tanV)
      return { x: (nx + 1) / 2 * w, y: (1 - ny) / 2 * h, z }
    }
    const camLen = Math.hypot(cam.pos.x, cam.pos.y, cam.pos.z) || 1
    const spanKm = 2 * Math.tan(f.fovDeg * DEG / 2) * Math.max(0, f.dist - 1) * R_KM
    // The live terminator point: on the day-night line, nearest the point under the camera.
    const camMoon: V3 = [
      (cam.pos.x * e.moonX.x + cam.pos.y * e.moonX.y + cam.pos.z * e.moonX.z) / camLen,
      (cam.pos.x * e.moonY.x + cam.pos.y * e.moonY.y + cam.pos.z * e.moonY.z) / camLen,
      (cam.pos.x * e.moonZ.x + cam.pos.y * e.moonZ.y + cam.pos.z * e.moonZ.z) / camLen,
    ]
    const sun = unitOf(e.subSolar.lon, e.subSolar.lat)
    const tp = terminatorPoint(sun, camMoon)
    const tll = lonLatOf(tp)
    const termLabel: ShownLabel = { id: TERMINATOR_ID, name: 'Terminator', kind: 'terminator', tier: 1, lon: tll.lon, lat: tll.lat, sizeKm: 0, fact: TERMINATOR_FACT, source: 'Computed from the Sun’s direction for the moment shown' }
    units.set(TERMINATOR_ID, tp)
    // The line itself, faint: the visible half of its great circle.
    let d = ''
    let pen = false
    for (const p of terminatorCircle(sun, 180)) {
      const wp = world(p)
      const facing = (wp[0] * cam.pos.x + wp[1] * cam.pos.y + wp[2] * cam.pos.z) - 1
      const s = facing > 0.002 ? project(wp) : null
      if (!s) { pen = false; continue }
      d += fast ? `${pen ? 'L' : 'M'}${px(s.x)} ${px(s.y)}` : `${pen ? 'L' : 'M'}${s.x.toFixed(1)} ${s.y.toFixed(1)}`
      pen = true
    }
    if (!fast) term.setAttribute('d', d) // labelfast=0
    else if (d !== termD) { termD = d; term.setAttribute('d', d) }

    const candidates: PostCandidate[] = []
    const offered: PostCandidate[] = []
    const info = new Map<string, { l: ShownLabel; alpha: number; m: Measure; short: Measure }>()
    const rows: ShownLabel[] = [...CURATED, termLabel]
    // The Gazetteer contains thousands of names in the candidate cone; a pick over it is refreshed at most every 150 ms while moving,
    // or when the span changes by 15 %, and the cached rows are placed on the frames between.
    const gazSkip = (g: MoonLabel): boolean => isCuratedName(g.name)
    const gazShown = (id: string): boolean => lives.get(`gaz:${id}`)?.eligible === true
    const gazNear = (): { near: MoonLabel[]; at: (g: MoonLabel) => { x: number; y: number } | null } => {
      const horizon = Math.acos(Math.min(1, 1 / Math.max(1, f.dist)))
      const reach = Math.min(Math.PI, horizon + Math.atan(Math.hypot(tanH, tanV)) + 0.05) / DEG
      const index = labelIndex()
      const near = candidatesInSphericalCone(index.bins, camMoon[0], camMoon[1], camMoon[2], reach)
      // The row's point on screen, or null past the limb or behind the camera.
      const at = (g: MoonLabel): { x: number; y: number } | null => {
        const u = world(index.units.get(g.id) ?? unitOf(g.lon, g.lat))
        if (u[0] * (cam.pos.x - u[0]) + u[1] * (cam.pos.y - u[1]) + u[2] * (cam.pos.z - u[2]) <= 0) return null
        return project(u)
      }
      return { near, at }
    }
    // Close up, the curated set is sparse: below GAZ_SPAN_KM the Gazetteer's other names join as minor labels, as large as the
    // view makes readable (a newcomer from GAZ_SHARE of the span, kept to two thirds of that; lettered satellite craters only very close).
    if (spanKm < GAZ_SPAN_KM) {
      if (gazRepickDue(gazPick, now, spanKm)) {
        const { near, at } = gazNear()
        const inFrame = (g: MoonLabel): boolean => { const p = at(g); return !!p && p.x > -0.1 * w && p.x < 1.1 * w && p.y > -0.1 * h && p.y < 1.1 * h }
        gazPick = { at: now, span: spanKm, rows: pickGazetteer(near, spanKm, { skip: gazSkip, shown: gazShown, inFrame }).map(gazLabel) }
        gazNeedsReconciliation = false
      }
      if (gazPick) rows.push(...gazPick.rows)
    } else { gazPick = null; gazNeedsReconciliation = false }
    // Order within a tier: the major names by fame (curated.ts FAME), the line last; the others larger first, missions by outcome.
    const order = (l: ShownLabel): number => {
      const fame = FAME.indexOf(l.id)
      if (fame >= 0) return fame * 4
      if (l.kind === 'mission') return 120 + ['crewed', 'landed', 'impact', 'crashed'].indexOf(l.status ?? 'landed') * 15
      return 198 - Math.min(78, Math.round(l.sizeKm / 12))
    }
    /** Offers a row to the layout: projected, measured, pushed to `offered`. With `fillable`, a row the zoom alone keeps out is
     * still offered, marked `fill` (postLayout.ts centreFill: it joins only when the candidate's cell is short of names); with
     * `forceFill` (the centre pick's Gazetteer rows) it is a fill even where its tier would admit it, so the fill's gate holds. */
    const offer = (l: ShownLabel, fillable: boolean, forceFill = false): void => {
      let u = units.get(l.id)
      if (!u) { u = unitOf(l.lon, l.lat); units.set(l.id, u) }
      const r = Math.max(0.995, Math.min(1.006, f.surfaceRadius?.(l.lon, l.lat) ?? 1))
      const wu = world(u)
      const foot: V3 = [wu[0] * r, wu[1] * r, wu[2] * r]
      const tx = cam.pos.x - foot[0], ty = cam.pos.y - foot[1], tz = cam.pos.z - foot[2]
      const facing = (wu[0] * tx + wu[1] * ty + wu[2] * tz) / (Math.hypot(tx, ty, tz) || 1)
      const life = lives.get(l.id)
      const isShown = !!life && life.eligible
      const pinned = l.id === hoverId || l.id === focusId
      const byTier = eligible(l.tier, spanKm, facing, isShown)
      const fill = !pinned && fillable && (forceFill || !byTier) && fillEligible(l.tier, spanKm, facing, isShown)
      if (!pinned && !byTier && !fill) return
      if (pinned && facing <= 0) return
      const base = project(foot)
      if (!base) return
      const lift = project([foot[0] + wu[0] * 0.01, foot[1] + wu[1] * 0.01, foot[2] + wu[2] * 0.01])
      let dx = lift ? lift.x - base.x : 0, dy = lift ? lift.y - base.y : -1
      const len = Math.hypot(dx, dy)
      if (len < 1e-3) { dx = 0; dy = -1 } else { dx /= len; dy /= len }
      const sinLean = Math.sqrt(Math.max(0, 1 - facing * facing))
      // A major label shows its line of context when it fits, and its name alone when it does not (the line stays in the card).
      const full = measure(l, l.tier === 1 && l.kind !== 'terminator')
      const short = measure(l, false)
      offered.push({ id: l.id, tier: l.tier, order: order(l), base: { x: base.x, y: base.y }, dir: { x: dx, y: dy }, postPx: postLength(l.tier, sinLean), w: full.w, h: full.h, nameH: full.nameH, pinned, ...(full.facts.length ? { compact: { w: short.w, h: short.h } } : {}), ...(fill ? { fill: true } : {}) })
      info.set(l.id, { l, alpha: pinned ? 1 : limbAlpha(facing), m: full, short })
    }
    // The curated rows and the terminator are fillable (the Gazetteer's ordinary rows join in frame below GAZ_SPAN_KM anyway).
    for (const l of rows) offer(l, spread && !l.id.startsWith('gaz:'))
    const bounds: Box = [0, 0, w, h]
    const discR = Math.tan(Math.asin(Math.min(1, 1 / Math.max(1.0001, f.dist)))) / tanV * h / 2
    const cells = fillCells(bounds, { center: { x: w / 2, y: h / 2 }, radius: discR })
    const fillVerdict = (id: string): Verdict => (!lastPlace || !lastOfferedIds.has(id) ? 'new' : lastPlace.placed.has(id) ? 'placed' : 'dropped')
    const ordinary = offered.filter((c) => holdsCell(c) && fillVerdict(c.id) !== 'dropped')
    const occupied = new Set(ordinary.map((c) => fillCellAt(c.base, cells)?.id).filter((id): id is string => !!id))
    const shortCells = new Set(cells.filter((cell) => !occupied.has(cell.id)).map((cell) => cell.id))
    // Above GAZ_SPAN_KM, offer the largest Gazetteer feature in each short cell. Shown picks survive count recovery and
    // movement while their surface point stays on frame; cell growth gives the picker some room at boundaries.
    const pickShown = !!centrePick?.rows.some((l) => lives.get(l.id)?.eligible)
    const regionShort = spread && spanKm >= GAZ_SPAN_KM && fillEligible(3, spanKm, 1, pickShown) && (shortCells.size > 0 || pickShown)
    if (regionShort && gazRepickDue(centrePick, now, spanKm)) {
      const { near, at } = gazNear()
      centrePick = { at: now, span: spanKm, rows: pickCentreGazetteer(near, spanKm, CENTRE_FILL, { skip: gazSkip, shown: gazShown, shortCells, cellOf: (g, isShown) => { const p = at(g); if (!p || p.x < 0 || p.x > w || p.y < 0 || p.y > h) return null; return isShown ? `shown:${g.id}` : fillCellAt(p, cells)?.id ?? null } }).map(gazLabel) }
      gazNeedsReconciliation = false
    }
    // The ordinary pick takes over below GAZ_SPAN_KM. Above it, Gazetteer rows are forced through this region gate.
    if (regionShort && centrePick) for (const l of centrePick.rows) offer(l, true, true)
    candidates.push(...centreFill(offered, bounds, (id) => lives.get(id)?.eligible === true, fillVerdict, cells))
    // How many names the resting frame holds: one per ~15,000 px of Moon on screen (a far, small Moon carries only its best-known
    // names; the count grows as the camera comes closer, so zooming in never removes one).
    const moonPx = Math.min(Math.PI * discR * discR, w * h)
    const cap = Math.max(6, Math.floor(moonPx / 15000))
    const blocked = [...f.blocked]
    if (fast) { if (searchRect) blocked.push(searchRect) } else { // labelfast=0
      const sb = searchInput.getBoundingClientRect() // labelfast=0
      if (sb.width > 0) blocked.push([sb.left - 6, sb.top - 6, sb.right + 6, sb.bottom + 6]) // labelfast=0
    }
    const pinKey = `${hoverId ?? ''}|${focusId ?? ''}`
    if (pinKey !== lastPinKey) { lastPinKey = pinKey; lastPlace = null; placementNeedsReconciliation = true }
    const shownBefore = shownSlots(lives)
    const motionCap = w <= 700 ? LABELS_MOTION_CAP_PHONE : LABELS_MOTION_CAP_DESKTOP
    const eligibleIds = new Set(candidates.map((c) => c.id))
    const placedCandidates = thinning ? selectMotionCandidates(candidates, motionCap, shownBefore) : candidates
    if (thinning !== lastThinning) { lastThinning = thinning; lastPlace = null; placementNeedsReconciliation = true }
    const placementCap = thinning ? placedCandidates.length : cap
    const tCand = performance.now()
    // Where a name is drawn now: its box follows its tip (the camera moves the point; the box keeps the slot's offset from the tip).
    // A leaving name reserves the box it is drawn in, not the one it was placed in, and a reused layout holds only while the
    // boxes it placed still stand apart where their tips are now (owner 2026-10-22: four names overlapping at the limb).
    const candById = new Map(candidates.map((c) => [c.id, c]))
    const leaving: Box[] = []
    for (const [id, life] of lives) {
      if (life.target !== 0 || life.alpha <= 0 || !life.rect) continue
      const e = entries.get(id), c = candById.get(id) ?? lastRender.get(id)?.c, meta = lastRender.get(id)?.meta
      if (e?.off && c && meta) { const m = e.compact ? meta.short : meta.m; leaving.push(drawnBox(c, e.lf, e.off, m.w, m.h)) } else leaving.push(life.rect)
    }
    const drawnNow = (id: string, p: Placement): { rect: Box; icon: Box } | null => {
      const c = candById.get(id)
      if (!c) return null
      return { rect: drawnBox(c, p.slot.lf, { x: p.slot.rect[0] - p.slot.tip.x, y: p.slot.rect[1] - p.slot.tip.y }, p.slot.rect[2] - p.slot.rect[0], p.slot.rect[3] - p.slot.rect[1]), icon: [c.base.x - ICON_HALF_PX, c.base.y - ICON_HALF_PX, c.base.x + ICON_HALF_PX, c.base.y + ICON_HALF_PX] }
    }
    lastPlace = placeOrReuse(lastPlace, now, new Set(placedCandidates.map((c) => c.id)), () => { dropReasons.clear(); return placePosts(placedCandidates, shownBefore, leaving, blocked, [0, 0, w, h], placementCap, dropReasons) }, drawnNow, leaving)
    lastOfferedIds = new Set(placedCandidates.map((c) => c.id))
    if (!lastPlace.reused) placementNeedsReconciliation = false
    const placed = lastPlace.placed
    const tPlace = performance.now()
    debugSource = { spanKm, cap: placementCap, candidates: placedCandidates, placed, blocked, bounds: [0, 0, w, h], cells }
    const leavingBeforeStep = new Set([...lives].filter(([, life]) => life.target === 0 && life.alpha > 0 && life.rect).map(([id]) => id))
    const drawn = stepLives(lives, placed, now, dt, reduced, eligibleIds)
    if (leavingLabelReleased(leavingBeforeStep, lives)) {
      // The last placement may still exclude a label that was held out by a label that just stopped leaving.
      // Force one fresh layout on the next tick, then let the normal settled loop stop.
      lastPlace = null
      placementNeedsReconciliation = true
    }
    shown = drawn
    // Keep stepping while any placed name is still on its way in (waiting out the appear delay, or fading in) or any is leaving.
    busy = gazNeedsReconciliation || placementNeedsReconciliation || (thinning && !f.moving && now - (thinState.lastMovingAt ?? now) < LABELS_MOTION_REST_MS)
    for (const [id, life] of lives) if ((placed.has(id) && life.alpha < 1) || (!placed.has(id) && life.alpha > 0)) busy = true
    const k = reduced ? 1 : 1 - Math.exp(-dt / 70)
    const keep = new Set(drawn)
    const renderState = new Map<string, { c: PostCandidate; meta: { l: ShownLabel; alpha: number; m: Measure; short: Measure } }>()
    // Names ease to their slots over about 70 ms. First the eased position of every drawn name (fading ones included); a name whose
    // eased box would cross another drawn box jumps to its slot instead (postLayout.ts settleMoves), so no two names ever overlap.
    const eased = new Map<string, { lf: number; off: { x: number; y: number }; c: PostCandidate; w: number; h: number }>()
    const moving: Array<{ id: string; now: Box; at: Box | null }> = []
    for (const id of drawn) {
      const p = placed.get(id)
      const c = candidates.find((x) => x.id === id) ?? lastRender.get(id)?.c
      const meta = info.get(id) ?? lastRender.get(id)?.meta
      const e = entries.get(id)
      if (!c || !meta) continue
      const slot = p?.slot
      const m = (slot ? slot.key.startsWith('c') : e?.compact ?? false) ? meta.short : meta.m
      const lfTarget = slot ? slot.lf : e?.lf ?? 1
      const lf = e ? e.lf + (lfTarget - e.lf) * (e.off ? k : 1) : lfTarget
      const want = slot ? { x: slot.rect[0] - slot.tip.x, y: slot.rect[1] - slot.tip.y } : e?.off ?? { x: GAP_PX, y: -m.nameH / 2 }
      const off = e?.off ? { x: e.off.x + (want.x - e.off.x) * k, y: e.off.y + (want.y - e.off.y) * k } : { ...want }
      eased.set(id, { lf, off, c, w: m.w, h: m.h })
      moving.push({ id, now: drawnBox(c, lf, off, m.w, m.h), at: slot ? drawnBox(c, slot.lf, want, m.w, m.h) : null })
    }
    for (const id of settleMoves(moving)) {
      const s = (placed.get(id) as Placement).slot, ez = eased.get(id) as { lf: number; off: { x: number; y: number } }
      ez.lf = s.lf; ez.off = { x: s.rect[0] - s.tip.x, y: s.rect[1] - s.tip.y }
    }
    drawnBoxes = [...eased].map(([id, ez]) => ({ id, box: drawnBox(ez.c, ez.lf, ez.off, ez.w, ez.h), leaving: !placed.has(id) }))
    for (const id of drawn) {
      const life = lives.get(id) as Life
      const p = placed.get(id)
      const c = candidates.find((x) => x.id === id) ?? lastRender.get(id)?.c
      const meta = info.get(id) ?? lastRender.get(id)?.meta
      if (!c || !meta) continue
      renderState.set(id, { c, meta })
      let e = entries.get(id)
      if (!e) { e = make(meta.l); entries.set(id, e) }
      // The slot: where the layout put it now, or (fading out) where it last was.
      const slot = p?.slot
      // The compact form ('c' slots) draws the name alone; a label fading out keeps the form it had.
      if (slot) e.compact = slot.key.startsWith('c')
      const m = e.compact ? meta.short : meta.m
      const lfTarget = slot ? slot.lf : e.lf
      const want = slot ? { x: slot.rect[0] - slot.tip.x, y: slot.rect[1] - slot.tip.y } : e.off ?? { x: GAP_PX, y: -m.nameH / 2 }
      // The eased (or settled) position from the pass above.
      const ez = eased.get(id) as { lf: number; off: { x: number; y: number } }
      e.lf = ez.lf
      if (!e.off) e.off = { ...ez.off }
      else { e.off.x = ez.off.x; e.off.y = ez.off.y }
      const tip = { x: c.base.x + c.dir.x * c.postPx * e.lf, y: c.base.y + c.dir.y * c.postPx * e.lf }
      if (slot) e.side = slot.side
      if (Math.abs(want.x - e.off.x) > 0.3 || Math.abs(want.y - e.off.y) > 0.3 || Math.abs(lfTarget - e.lf) > 0.01 || (life.alpha > 0 && life.alpha < 1)) busy = true
      const rx = tip.x + e.off.x, ry = tip.y + e.off.y
      const alpha = life.alpha * meta.alpha
      const b = e.button
      const nameMidY = ry + m.nameH / 2
      let lx = tip.x, ly = tip.y
      if (e.side === 'r') { lx = rx; ly = nameMidY } else if (e.side === 'l') { lx = rx + m.w; ly = nameMidY } else if (e.side === 'a') { ly = ry + m.h } else { ly = ry }
      const hug = e.lf < 0.05
      const hov = id === hoverId
      const factKey = m.facts.join('\n')
      if (fast) {
        // Write only what changed, on the device-pixel grid. The browser restyles an element whose value was set again to the same string.
        const wr = e.c
        const tf = `translate3d(${px(rx)}px, ${px(ry)}px, 0)`
        if (tf !== wr.tf) { wr.tf = tf; b.style.transform = tf }
        const op = (Math.round(alpha * 255) / 255).toFixed(3)
        if (op !== wr.op) { wr.op = op; b.style.opacity = op }
        if (m.w !== wr.w) { wr.w = m.w; b.style.width = `${m.w}px` }
        if (e.side !== wr.side) { wr.side = e.side; b.dataset.side = e.side }
        if (hov !== wr.hov) { wr.hov = hov; b.classList.toggle('hover', hov); e.g.classList.toggle('hover', hov) }
        const tab = alpha > 0.5 ? 0 : -1
        if (tab !== wr.tab) { wr.tab = tab; b.tabIndex = tab }
        if (factKey !== e.shownFacts) { e.shownFacts = factKey; e.facts.replaceChildren(...m.facts.map((t) => { const s = document.createElement('span'); s.textContent = t; return s })) }
        const bx = px(c.base.x), by = px(c.base.y), tx = px(tip.x), ty = px(tip.y), qx = px(lx), qy = px(ly)
        const d = hug ? `M${px(c.base.x + Math.sign(lx - c.base.x) * ICON_HALF_PX)} ${by}L${qx} ${qy}` : `M${bx} ${by}L${tx} ${ty}L${qx} ${qy}`
        if (d !== wr.d) { wr.d = d; e.post.setAttribute('d', d) }
        const base = `${bx},${by}`
        if (base !== wr.base) { wr.base = base; e.g.dataset.base = base }
        const iconTransform = `translate(${px(c.base.x - 8)} ${px(c.base.y - 8)})`
        if (iconTransform !== wr.ix) { wr.ix = iconTransform; e.icon.setAttribute('transform', iconTransform) }
        if (op !== wr.gop) { wr.gop = op; e.g.style.opacity = op }
        if (hov && !card.hidden && cardSize) {
          const below = ry + m.h + 6 + cardSize.h < h - 90
          const cx = Math.max(8, Math.min(w - cardSize.w - 8, rx))
          const ctf = `translate3d(${px(cx)}px, ${px(below ? ry + m.h + 6 : ry - cardSize.h - 6)}px, 0)`
          if (ctf !== cardTf) { cardTf = ctf; card.style.transform = ctf }
        }
        continue
      }
      // labelfast=0: the write path as it was, every value every frame.
      b.style.transform = `translate(${rx.toFixed(1)}px, ${ry.toFixed(1)}px)`
      b.style.opacity = alpha.toFixed(3)
      b.style.width = `${m.w}px`
      b.dataset.side = e.side
      b.classList.toggle('hover', id === hoverId)
      b.tabIndex = alpha > 0.5 ? 0 : -1
      if (factKey !== e.shownFacts) { e.shownFacts = factKey; e.facts.replaceChildren(...m.facts.map((t) => { const s = document.createElement('span'); s.textContent = t; return s })) }
      // The post and its leader into the name row.
      const sx = hug ? c.base.x + Math.sign(lx - c.base.x) * ICON_HALF_PX : c.base.x, sy = hug ? c.base.y : c.base.y
      const pathD = hug ? `M${sx.toFixed(1)} ${sy.toFixed(1)}L${lx.toFixed(1)} ${ly.toFixed(1)}` : `M${c.base.x.toFixed(1)} ${c.base.y.toFixed(1)}L${tip.x.toFixed(1)} ${tip.y.toFixed(1)}L${lx.toFixed(1)} ${ly.toFixed(1)}`
      e.post.setAttribute('d', pathD)
      e.g.dataset.base = `${c.base.x.toFixed(1)},${c.base.y.toFixed(1)}`
      e.icon.setAttribute('transform', `translate(${(c.base.x - 8).toFixed(1)} ${(c.base.y - 8).toFixed(1)})`)
      e.g.style.opacity = alpha.toFixed(3)
      e.g.classList.toggle('hover', id === hoverId)
      if (id === hoverId && !card.hidden) {
        const cw = card.offsetWidth || 200, ch = card.offsetHeight || 40 // labelfast=0
        const below = ry + m.h + 6 + ch < h - 90
        const cx = Math.max(8, Math.min(w - cw - 8, rx))
        card.style.transform = `translate(${cx.toFixed(0)}px, ${(below ? ry + m.h + 6 : ry - ch - 6).toFixed(0)}px)`
      }
    }
    lastRender.clear()
    for (const [id, state] of renderState) lastRender.set(id, state)
    for (const id of [...entries.keys()]) if (!keep.has(id)) drop(id)
    const tEnd = performance.now()
    stepParts = { cand: tCand - tStep0, place: tPlace - tCand, dom: tEnd - tPlace, n: candidates.length, drawn: drawn.length }
    if (hoverId && !keep.has(hoverId)) { hoverId = null; card.hidden = true; host.highlight(null) }
    if (busy) kick()
  }

  let debugSource: { spanKm: number; cap: number; candidates: PostCandidate[]; placed: Map<string, Placement>; blocked: Box[]; bounds: Box; cells: FillCell[] } | null = null
  /** Why the last fresh layout dropped each candidate (kept through placement reuse). */
  const dropReasons = new Map<string, DropReason>()
  /** The ids the last layout was given (its verdict on a candidate: placed, dropped, or not seen yet). */
  let lastOfferedIds = new Set<string>()
  /** The boxes drawn this frame, eased and settled, fading names included (the rig's and the tests' overlap check). */
  let drawnBoxes: Array<{ id: string; box: Box; leaving: boolean }> = []
  let stepParts = { cand: 0, place: 0, dom: 0, n: 0, drawn: 0 }
  const api = {
    /** For the rig and scenario scripts: build diagnostics only when asked. `thirds` is retained; `grid` reports the new fill cells. */
    debug: () => {
      if (!debugSource) return null
      const { spanKm, cap, candidates, placed, blocked, bounds, cells } = debugSource
      const grid = cells.map((cell) => {
        const inCell = candidates.filter((c) => fillCellAt(c.base, cells)?.id === cell.id)
        return { id: cell.id, center: [Math.round(cell.center.x), Math.round(cell.center.y)], placed: inCell.filter((c) => placed.has(c.id) && !c.fill).map((c) => c.id), dropped: inCell.filter((c) => !placed.has(c.id) && !c.fill).map((c) => c.id), fills: inCell.filter((c) => c.fill).map((c) => c.id) }
      })
      return {
        span: Math.round(spanKm), cap, spread, stepMs: Math.round(stepMs * 10) / 10,
        thirds: thirds(candidates, new Set(placed.keys()), blocked, bounds),
        grid,
        candidates: candidates.map((c) => ({ id: c.id, tier: c.tier, fill: !!c.fill, base: [Math.round(c.base.x), Math.round(c.base.y)], placed: placed.has(c.id), why: placed.has(c.id) ? undefined : dropReasons.get(c.id), slot: placed.get(c.id)?.slot.key, rect: placed.get(c.id)?.slot.rect.map(Math.round), size: [Math.round(c.w), Math.round(c.h)] })),
        blocked: blocked.map((b) => b.map(Math.round)),
        drawn: drawnBoxes.map((d) => ({ id: d.id, box: d.box.map(Math.round), leaving: d.leaving })),
      }
    },
    stats: () => ({ stepMs, ...stepParts }),
    isOn: () => on,
    visibleIds: () => shown,
    onChange(cb: (v: boolean) => void) { listeners.push(cb) },
    setOn(v: boolean) {
      if (v === on) return
      on = v
      layer.hidden = !on
      if (!on) {
        for (const id of [...entries.keys()]) { const e = entries.get(id); if (e) { e.button.remove(); e.g.remove() } entries.delete(id) }
        lives.clear(); lastRender.clear(); shown = []; card.hidden = true; lastPlace = null; gazPick = null; centrePick = null
        if (hoverId) { hoverId = null; host.highlight(null) }
        focusId = null
      } else { lastAt = 0; metricsDirty = true; kick() }
      for (const cb of listeners) cb(on)
    },
    update(f: LabelsFrame) {
      lastFrame = f
      if (!on) return
      const now = performance.now()
      lastUpdateAt = now
      step(f, now)
    },
    prepareFrame,
  }
  layer.hidden = !on
  return api
}

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
