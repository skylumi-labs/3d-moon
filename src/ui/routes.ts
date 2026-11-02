import type { Ephemeris } from '../ephemeris'
import type { ViewCamera } from '../camera/pose'
import { ROUTES, type Route } from '../routes/routes'
import { projectPin, selenoUnit, routesCannotDraw } from './pinMath'

export interface RoutesHost { fly(r: Route): void }
export interface RoutesFrame { cam: ViewCamera; aspect: number; e: Ephemeris; dist: number; hidden: boolean; vw?: number; vh?: number }

const NS = 'http://www.w3.org/2000/svg'
/** The paths on the Moon: mission tracks are drawn over the picture, hidden while a move runs and far out. */
export function mountRoutes(root: HTMLElement, host: RoutesHost): { update(f: RoutesFrame): void; setActive(id: string | null): void } {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'moon-routes')
  svg.setAttribute('aria-label', 'Apollo paths')
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;overflow:hidden'
  root.append(svg)
  const els = new Map<string, { g: SVGGElement; shown: SVGPathElement[]; hit: SVGPathElement[]; label: SVGTextElement; marker?: SVGCircleElement }>()
  const descent = ROUTES.find((r) => r.id === 'a17-descent')
  const roverStart = descent?.segments.at(-1)?.at(-1)
  for (const r of ROUTES) {
    const g = document.createElementNS(NS, 'g')
    g.setAttribute('data-route', r.id)
    g.style.cursor = 'pointer'
    const label = document.createElementNS(NS, 'text')
    label.textContent = `${r.name}${r.estimated ? ' (modelled)' : ''} · tap the line to fly along it`
    label.setAttribute('fill', '#fff'); label.setAttribute('font-size', '12'); label.setAttribute('paint-order', 'stroke'); label.setAttribute('stroke', '#000'); label.setAttribute('stroke-width', '3')
    label.style.pointerEvents = 'none'
    g.append(label)
    const shown: SVGPathElement[] = [], hit: SVGPathElement[] = []
    let marker: SVGCircleElement | undefined
    if (r.id === 'a17-traverse') {
      // Keep one quiet landing marker where the rover traverse began, without exposing its route line.
      marker = document.createElementNS(NS, 'circle')
      marker.setAttribute('r', '5')
      marker.setAttribute('fill', '#7fd1ff')
      marker.setAttribute('stroke', '#fff')
      marker.setAttribute('stroke-width', '1.5')
      marker.style.pointerEvents = 'none'
      g.append(marker)
    }
    for (let i = 0; i < r.segments.length && r.id !== 'a17-traverse'; i++) {
      const line = document.createElementNS(NS, 'path')
      line.setAttribute('fill', 'none'); line.setAttribute('stroke', r.kind === 'descent' ? '#ffb454' : '#7fd1ff'); line.setAttribute('stroke-width', '2.5')
      line.setAttribute('stroke-linecap', 'round'); line.setAttribute('stroke-linejoin', 'round')
      if (r.estimated) line.setAttribute('stroke-dasharray', '7 5')
      line.style.filter = 'drop-shadow(0 0 2px #000)'
      const target = document.createElementNS(NS, 'path')
      target.setAttribute('fill', 'none'); target.setAttribute('stroke', 'transparent'); target.setAttribute('stroke-width', '22'); target.setAttribute('stroke-linecap', 'round')
      target.style.pointerEvents = 'stroke'
      target.addEventListener('click', (ev) => { ev.stopPropagation(); host.fly(r) })
      target.addEventListener('pointerdown', (ev) => ev.stopPropagation())
      g.append(line, target)
      shown.push(line); hit.push(target)
    }
    svg.append(g)
    els.set(r.id, { g, shown, hit, label, marker })
  }
  const textLengths = new WeakMap<SVGTextElement, number>()
  const textLength = (t: SVGTextElement): number => {
    return textLengths.get(t) ?? 250
  }
  // Measure static route captions during mount, before the per-frame DOM write phases begin.
  for (const { label } of els.values()) {
    const n = label.getComputedTextLength?.() || 0
    if (n > 0) textLengths.set(label, n)
  }
  let active: string | null = null
  return {
    setActive: (id) => { active = id },
    update(f) {
      const w = f.vw ?? window.innerWidth, h = f.vh ?? window.innerHeight
      if (routesCannotDraw(w, h, typeof document !== 'undefined' && document.hidden) || !Number.isFinite(f.aspect) || f.aspect <= 0) return
      const viewBox = `0 0 ${w} ${h}`
      if (svg.getAttribute('viewBox') !== viewBox) svg.setAttribute('viewBox', viewBox)
      const away = f.hidden || f.dist > 3.2
      for (const r of ROUTES) {
        const el = els.get(r.id) as NonNullable<ReturnType<typeof els.get>>
        el.g.style.display = away && active !== r.id ? 'none' : ''
        if (away && active !== r.id) continue
        if (r.id === 'a17-traverse') {
          el.label.style.display = 'none'
          if (el.marker && roverStart) {
            const p = projectPin(f.cam, f.aspect, selenoUnit(roverStart[0], roverStart[1], f.e), w, h)
            el.marker.style.display = p ? '' : 'none'
            if (p) { el.marker.setAttribute('cx', p.x.toFixed(1)); el.marker.setAttribute('cy', p.y.toFixed(1)) }
          }
          continue
        }
        let first: { x: number; y: number } | null = null
        r.segments.forEach((seg, k) => {
          let d = '', pen = false
          for (const [lon, lat] of seg) {
            const p = projectPin(f.cam, f.aspect, selenoUnit(lon, lat, f.e), w, h)
            if (!p) { pen = false; continue }
            if (!first) first = p
            d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`
            pen = true
          }
          el.shown[k].setAttribute('d', d); el.hit[k].setAttribute('d', d)
        })
        el.label.style.display = first && active !== r.id ? '' : 'none'
        if (first) { const fp = first as { x: number; y: number }; el.label.setAttribute('x', String(Math.max(8, Math.min(w - 8 - textLength(el.label), fp.x + 8)))); el.label.setAttribute('y', String(Math.min(h - 8, Math.max(16, fp.y + (r.kind === 'traverse' ? 26 : -12))))) }
      }
    },
  }
}
