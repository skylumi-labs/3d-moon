import './zoomTape.css'
import { FADE_IN, FADE_OUT, TAPE_MAX_OPACITY, ZoomFade, arcPlacement, arcPoint, floorMarkerPosition, formatReadingM, tapeLayoutChanged, tapeLog, tapePosition, tapeTicks, tickLabelCollidesWithReading } from './zoomScale'

/**
 * SkyLumi's zoom tape for the Moon: an arc on the left edge with a fixed reading bar across its middle and a
 * logarithmic scale of the camera's height above the surface sliding under it. Gold ink (SkyLumi's pick), edged in
 * dark contrast, dissolving at both ends. It fades in the moment the height changes and out a beat after it stops.
 * The ticks are two paths (major, minor), as in SkyLumi.
 */
const SVG_NS = 'http://www.w3.org/2000/svg'
const INK = 'rgb(255,204,128)'
const HALO = 'rgba(0,0,0,0.78)'
const MAJOR_PX = 13
const MINOR_PX = 6
const LABEL_GAP_PX = 7
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

export interface ZoomTapeApi {
  /** The camera's height above the surface, metres (null: none to show). Call every frame; it only reacts to a change, and wakes only when `canWake` (a visitor zoom gesture) is true. */
  update(heightM: number | null, floorM?: number | null, canWake?: boolean): void
  /** Fades the tape out now (a flight or a viewpoint move began). */
  hide(): void
  /** Pulse the closest marker and wake the tape after a zoom limit is reached. */
  pulse(): void
  readonly element: HTMLElement
  readonly fade: ZoomFade
}

export function mountZoomTape(parent: HTMLElement): ZoomTapeApi {
  const wrap = document.createElement('div')
  wrap.className = 'zoom-tape'
  wrap.setAttribute('aria-hidden', 'true')
  wrap.dataset.zoomTape = ''
  const svg = el('svg')
  const root = el('g', { 'data-zoom-arc': '' })
  root.style.opacity = '0'
  svg.append(root)
  wrap.append(svg)
  parent.append(wrap)

  const fade = new ZoomFade()
  const ticks = tapeTicks()
  const reduce = (): boolean => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }
  let place = { x: 0, top: 0, height: 0 }
  let shown = false
  let timer: ReturnType<typeof setTimeout> | 0 = 0
  let majorPath: SVGPathElement | null = null
  let minorPath: SVGPathElement | null = null
  let majorHalo: SVGPathElement | null = null
  let minorHalo: SVGPathElement | null = null
  let readout: SVGTextElement | null = null
  let floorMarker: SVGGElement | null = null
  let readingBar: SVGGElement | null = null
  let labels: (SVGTextElement | null)[] = []
  let lastLog = Number.NaN
  let lastFloor: number | null = null
  let laidLog = Number.NaN
  let drawnFor = ''

  const build = (): void => {
    root.replaceChildren()
    const { x, top, height } = place
    const id = `zt${Math.round(x)}${Math.round(height)}`
    const defs = el('defs')
    const grad = el('linearGradient', { id: `${id}-f`, gradientUnits: 'userSpaceOnUse', x1: 0, y1: top, x2: 0, y2: top + height })
    for (const [o, a] of [[0, 0], [0.22, 1], [0.78, 1], [1, 0]]) grad.append(el('stop', { offset: o, 'stop-color': '#fff', 'stop-opacity': a }))
    const maskLeft = x - height * 0.35, maskW = height * 0.35 + 120
    const mask = el('mask', { id: `${id}-m`, maskUnits: 'userSpaceOnUse', x: maskLeft, y: top - 20, width: maskW, height: height + 40 })
    mask.append(el('rect', { x: maskLeft, y: top - 20, width: maskW, height: height + 40, fill: `url(#${id}-f)` }))
    defs.append(grad, mask)
    const tape = el('g', { mask: `url(#${id}-m)` })
    const pts = Array.from({ length: 49 }, (_, i) => arcPoint(-0.04 + (i / 48) * 1.08, x, top, height))
    const arcD = `M${pts.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' L')}`
    tape.append(
      el('path', { d: arcD, fill: 'none', stroke: HALO, 'stroke-width': 4, 'stroke-linecap': 'round' }),
      el('path', { d: arcD, fill: 'none', stroke: INK, 'stroke-width': 1.75, 'stroke-linecap': 'round' }),
    )
    minorHalo = el('path', { fill: 'none', stroke: HALO, 'stroke-width': 4, 'stroke-linecap': 'round' })
    majorHalo = el('path', { fill: 'none', stroke: HALO, 'stroke-width': 4.5, 'stroke-linecap': 'round' })
    minorPath = el('path', { fill: 'none', stroke: INK, 'stroke-opacity': 0.8, 'stroke-width': 1.6, 'stroke-linecap': 'round' })
    majorPath = el('path', { fill: 'none', stroke: INK, 'stroke-width': 2, 'stroke-linecap': 'round' })
    tape.append(minorHalo, majorHalo, minorPath, majorPath)
    labels = ticks.map((t) => {
      if (!t.label) return null
      const l = el('text', { fill: INK, 'font-size': 12, 'font-family': FONT, 'dominant-baseline': 'middle', stroke: HALO, 'stroke-width': 3.5, 'stroke-linejoin': 'round', 'paint-order': 'stroke' })
      l.style.display = 'none'
      l.style.letterSpacing = '0.06em'
      l.style.fontVariantNumeric = 'tabular-nums'
      l.textContent = t.label
      tape.append(l)
      return l
    })
    const mid = arcPoint(0.5, x, top, height)
    floorMarker = el('g', { 'data-floor-marker': '' })
    floorMarker.style.display = 'none'
    floorMarker.append(
      el('line', { x1: 0, y1: 0, x2: 48, y2: 0, stroke: HALO, 'stroke-width': 5, 'stroke-linecap': 'round' }),
      el('line', { x1: 0, y1: 0, x2: 48, y2: 0, stroke: '#ffe2b1', 'stroke-width': 2, 'stroke-linecap': 'round' }),
      el('text', { x: -7, y: 0, fill: '#ffe2b1', 'font-size': 9, 'font-family': FONT, 'text-anchor': 'end', 'dominant-baseline': 'middle', stroke: HALO, 'stroke-width': 3.5, 'stroke-linejoin': 'round', 'paint-order': 'stroke' }),
    )
    floorMarker.lastElementChild!.textContent = 'closest'
    tape.append(floorMarker)
    const bar = el('g', { 'data-reading-bar': '' })
    readingBar = bar
    bar.append(
      el('line', { x1: mid.x - 14, y1: mid.y, x2: mid.x + MAJOR_PX + 44, y2: mid.y, stroke: HALO, 'stroke-width': 4, 'stroke-linecap': 'round' }),
      el('line', { x1: mid.x - 14, y1: mid.y, x2: mid.x + MAJOR_PX + 44, y2: mid.y, stroke: INK, 'stroke-width': 1.5, 'stroke-opacity': 0.75 }),
      el('line', { x1: mid.x - 4, y1: mid.y, x2: mid.x + MAJOR_PX + 4, y2: mid.y, stroke: HALO, 'stroke-width': 5, 'stroke-linecap': 'round' }),
      el('line', { x1: mid.x - 4, y1: mid.y, x2: mid.x + MAJOR_PX + 4, y2: mid.y, stroke: INK, 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
      el('path', { d: `M${mid.x - 9},${mid.y - 4.5} L${mid.x - 3},${mid.y} L${mid.x - 9},${mid.y + 4.5}`, fill: HALO, stroke: HALO, 'stroke-width': 3, 'stroke-linejoin': 'round' }),
      el('path', { d: `M${mid.x - 9},${mid.y - 4.5} L${mid.x - 3},${mid.y} L${mid.x - 9},${mid.y + 4.5}`, fill: INK }),
    )
    readout = el('text', { x: mid.x + 5, y: mid.y - 7, fill: INK, 'font-size': 18, 'font-weight': 600, 'font-family': FONT, stroke: HALO, 'stroke-width': 4.5, 'stroke-linejoin': 'round', 'paint-order': 'stroke' })
    readout.style.fontVariantNumeric = 'tabular-nums'
    bar.append(readout)
    root.append(defs, tape, bar)
  }

  const layout = (log: number, floorM: number | null): void => {
    if (!majorPath || !minorPath || !majorHalo || !minorHalo || !readout) return
    laidLog = log
    const { x, top, height } = place
    let major = '', minor = ''
    ticks.forEach((t, i) => {
      const u = tapePosition(t.m, log)
      const label = labels[i]
      if (u < -0.05 || u > 1.05) { if (label) label.style.display = 'none'; return }
      const p = arcPoint(u, x, top, height)
      const swell = 1 + 0.45 * Math.exp(-((u - 0.5) ** 2) / 0.006)
      const len = (t.major ? MAJOR_PX : MINOR_PX) * swell
      const seg = `M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${(p.x + p.nx * len).toFixed(1)} ${(p.y + p.ny * len).toFixed(1)}`
      if (t.major) major += seg
      else minor += seg
      if (label) {
        const near = Math.abs(u - 0.5)
        // A tick label that would print over the reading label is hidden; its tick stays.
        if (tickLabelCollidesWithReading(u, height)) { label.style.display = 'none'; return }
        label.style.display = ''
        label.setAttribute('x', (p.x + p.nx * (len + LABEL_GAP_PX)).toFixed(1))
        label.setAttribute('y', (p.y + p.ny * (len + LABEL_GAP_PX)).toFixed(1))
        label.style.opacity = near < 0.09 ? (0.15 + (near / 0.09) * 0.85).toFixed(2) : '1'
      }
    })
    majorPath.setAttribute('d', major)
    minorPath.setAttribute('d', minor)
    majorHalo.setAttribute('d', major)
    minorHalo.setAttribute('d', minor)
    if (floorMarker) {
      const u = floorMarkerPosition(floorM, log)
      if (u === null) floorMarker.style.display = 'none'
      else {
        const p = arcPoint(u, x, top, height)
        floorMarker.style.display = ''
        floorMarker.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${(Math.atan2(p.ny, p.nx) * 180 / Math.PI).toFixed(1)})`)
      }
    }
    const text = formatReadingM(10 ** log)
    if (readout.textContent !== text) readout.textContent = text
  }

  const setShown = (on: boolean): void => {
    if (shown === on) return
    shown = on
    root.style.transition = reduce() ? 'none' : on ? FADE_IN : FADE_OUT
    root.style.opacity = on ? String(TAPE_MAX_OPACITY) : '0'
  }
  const arm = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = 0
      const left = fade.remainingMs(performance.now())
      if (left > 0) arm()
      else setShown(false)
    }, fade.remainingMs(performance.now()) + 20)
  }

  const measure = (): void => {
    const h = wrap.clientHeight
    if (h === 0) return
    const p = arcPlacement(window.innerWidth, h)
    const key = `${p.x.toFixed(1)}|${p.top.toFixed(1)}|${p.height.toFixed(1)}`
    if (key === drawnFor) return
    drawnFor = key
    place = p
    build()
    if (!Number.isNaN(lastLog)) layout(lastLog, lastFloor)
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(wrap)
  window.addEventListener('resize', measure)
  measure()

  return {
    element: wrap,
    fade,
    hide() {
      fade.sleep()
      if (timer) { clearTimeout(timer); timer = 0 }
      setShown(false)
    },
    update(heightM, floorM, canWake = true) {
      const log = tapeLog(heightM)
      if (log === null) {
        lastFloor = null
        if (floorMarker) floorMarker.style.display = 'none'
        return
      }
      const woke = fade.observe(log, performance.now(), canWake)
      lastLog = log
      const needsLayout = tapeLayoutChanged(log, laidLog, floorM, lastFloor)
      lastFloor = floorM ?? null
      if (woke) {
        if (!drawnFor) measure()
        layout(log, lastFloor)
        setShown(true)
        arm()
      } else if (drawnFor && needsLayout) layout(log, lastFloor)
    },
    pulse() {
      const now = performance.now()
      fade.wake(now)
      if (!drawnFor) measure()
      if (!Number.isNaN(lastLog)) layout(lastLog, lastFloor)
      setShown(true)
      arm()
      if (!reduce()) {
        const target = floorMarker && floorMarker.style.display !== 'none' ? floorMarker : readingBar
        if (target) {
          target.classList.remove('pulse')
          void target.getBoundingClientRect()
          target.classList.add('pulse')
          setTimeout(() => target.classList.remove('pulse'), 300)
        }
      }
    },
  }
}
