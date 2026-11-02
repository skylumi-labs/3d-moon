import './firstHotspots.css'
import type { Ephemeris } from '../ephemeris'
import type { ViewCamera } from '../camera/pose'
import type { Hotspot } from '../hotspots'
import { projectPinTo } from './pinMath'
import { layoutHotspots, needsMove, readRemembered, writeSeen, writeVisited, type Pt, type Rect, type StoreGetter } from './firstHotspots'

const DEG = Math.PI / 180
/** Closer than this the Moon fills the frame and a ring on its disc is no invitation (Home is 3.6). */
const MIN_DIST = 1.6
const STAGGER_MS = 150

export interface FirstHotspotsHost {
  list(): Hotspot[]
  /** The same call the viewpoint list makes (main.ts playPin). */
  select(h: Hotspot): void
  /** Screen rectangles to keep clear of (centre caption), besides the dock which the view reads itself. */
  extraBlocked(): Rect[]
  store: StoreGetter
  /** ?hotspots=1: remembers nothing and ignores what is remembered. */
  forced: boolean
}

export interface FirstHotspotsFrame {
  cam: ViewCamera
  aspect: number
  e: Ephemeris
  pose: { dist: number }
  /** Something owns the camera (a flight, ground mode, a tour). */
  hidden: boolean
  /** The splash has gone and the opening flight has landed at Home. */
  landed: boolean
}

export interface FirstHotspotsApi {
  /** Called from the frame loop only: no timer or rAF of its own, so a sleeping loop means no work here. */
  update(f: FirstHotspotsFrame): void
  /** A flight to a pin started (from a hotspot or the list): the first one's end sets the "seen" flag. */
  noteFlight(id: string): void
  /** Places again from the last frame given to update() (a resize, or the moment the intro lands) without waiting for a drawn frame; the caller requests one redraw. */
  place(): void
  /** Screen boxes of rings and labels placed in the last update, for other layers to keep clear. */
  boxes(): ReadonlyArray<Rect>
  /** True once mounted (for tests and the review hook). */
  readonly mounted: boolean
}

export function createFirstHotspots(root: HTMLElement, host: FirstHotspotsHost): FirstHotspotsApi {
  const remembered = host.forced ? { seen: false, visited: [] as string[] } : readRemembered(host.store)
  const visited = new Set<string>(remembered.visited)
  let layer: HTMLDivElement | null = null
  const items = new Map<string, { h: Hotspot; btn: HTMLButtonElement; label: HTMLSpanElement; x: number; y: number; on: boolean; withLabel: boolean; left: boolean; w: number }>()
  let flown = false
  let seenWritten = false
  let wasShown = false
  let startHas: boolean | null = null
  let placedBoxes: Rect[] = []
  const out = { x: 0, y: 0 }
  const pts: Pt[] = []
  const blocked: Rect[] = []
  let dockEl: HTMLElement | null = null
  const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null

  const mount = (): void => {
    layer = document.createElement('div')
    layer.className = 'first-hotspots'
    layer.setAttribute('role', 'group')
    layer.setAttribute('aria-label', 'Places to fly to')
    root.append(layer)
    let i = 0
    for (const h of host.list()) {
      if (h.pinned === false) continue
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'fh'
      btn.dataset.passDrag = ''
      btn.setAttribute('aria-label', `Fly to ${h.title}`)
      btn.style.setProperty('--fh-delay', `${i++ * STAGGER_MS}ms`)
      const ring = document.createElement('i')
      const label = document.createElement('span')
      label.className = 'fh-label'
      label.textContent = h.title
      btn.append(ring, label)
      btn.hidden = true
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation()
        visited.add(h.id)
        if (!host.forced) writeVisited(host.store, visited)
        btn.hidden = true
        host.select(h)
      })
      // The canvas below must not take a tap on a hotspot as a drag or a double tap.
      btn.addEventListener('pointerdown', (ev) => ev.stopPropagation())
      layer.append(btn)
      items.set(h.id, { h, btn, label, x: NaN, y: NaN, on: false, withLabel: true, left: false, w: 0 })
    }
    dockEl = root.querySelector<HTMLElement>('.dock')
  }

  const labelWidth = (it: { label: HTMLSpanElement; w: number }, text: string): number => {
    if (it.w > 0) return it.w
    let px = text.length * 9
    if (ctx) {
      const cs = getComputedStyle(it.label)
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const m = ctx.measureText(text.toUpperCase()).width + (parseFloat(cs.letterSpacing) || 0) * text.length
      if (m > 0) px = m
    }
    it.w = px
    return px
  }

  let lastFrame: FirstHotspotsFrame | null = null
  const remaining = (): boolean => { for (const [id] of items) if (!visited.has(id)) return true; return false }

  return {
    get mounted() { return layer !== null },
    boxes: () => placedBoxes,
    noteFlight(id) {
      flown = true
      // A flight started from the list visits the place too.
      if (items.has(id)) { visited.add(id); if (!host.forced) writeVisited(host.store, visited) }
    },
    place() { if (lastFrame) this.update(lastFrame) },
    update(f) {
      lastFrame = f
      // The first flight's end (the camera is the visitor's again) is when the first session counts as seen: a second load shows none.
      if (flown && !seenWritten && !f.hidden) { seenWritten = true; if (!host.forced) writeSeen(host.store) }
      if (!f.landed) { placedBoxes = []; return }
      if (layer === null) {
        // Decided once, from the list as it is when the intro has landed: no DOM at all for a visitor who has visited every place.
        if (startHas === null) startHas = host.list().some((h) => h.pinned !== false && !visited.has(h.id))
        if (!startHas) { placedBoxes = []; return }
      }
      if (!layer) mount()
      const lay = layer as HTMLDivElement
      const away = f.hidden || f.pose.dist < MIN_DIST
      if (away || !remaining()) {
        if (wasShown) { for (const it of items.values()) { it.btn.hidden = true; it.on = false } wasShown = false }
        placedBoxes = []
        return
      }
      const w = window.innerWidth, hgt = window.innerHeight
      pts.length = 0
      for (const [id, it] of items) {
        if (visited.has(id)) { it.btn.hidden = true; it.on = false; continue }
        const at = it.h.pin(f.e)
        const cl = Math.cos(at.lat * DEG), cn = cl * Math.cos(at.lon * DEG), ce = cl * Math.sin(at.lon * DEG), up = Math.sin(at.lat * DEG)
        const e = f.e
        const dx = e.moonX.x * cn + e.moonY.x * ce + e.moonZ.x * up
        const dy = e.moonX.y * cn + e.moonY.y * ce + e.moonZ.y * up
        const dz = e.moonX.z * cn + e.moonY.z * ce + e.moonZ.z * up
        if (!projectPinTo(out, f.cam, f.aspect, dx, dy, dz, w, hgt)) { it.btn.hidden = true; it.on = false; continue }
        pts.push({ id, x: out.x, y: out.y, labelW: labelWidth(it, it.h.title) })
      }
      blocked.length = 0
      const dr = dockEl?.getBoundingClientRect()
      if (dr && dr.height > 0) blocked.push([0, dr.top - 8, w, hgt])
      for (const r of host.extraBlocked()) blocked.push(r)
      const placed = layoutHotspots(pts, w, blocked)
      placedBoxes = []
      for (const it of items.values()) it.on = false
      for (const p of placed) {
        const it = items.get(p.id) as NonNullable<ReturnType<typeof items.get>>
        it.on = true
        if (needsMove(it.x, it.y, p.x, p.y)) {
          it.x = p.x; it.y = p.y
          it.btn.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`
        }
        if (it.btn.hidden) it.btn.hidden = false
        if (it.left !== p.left) { it.left = p.left; it.btn.classList.toggle('left', p.left) }
        if (it.withLabel !== p.label) { it.withLabel = p.label; it.btn.classList.toggle('nolabel', !p.label) }
        placedBoxes.push([p.x - 22, p.y - 22, p.x + 22, p.y + 22])
        if (p.label) { const lw = it.w + 8; placedBoxes.push(p.left ? [p.x - 20 - lw, p.y - 10, p.x - 20, p.y + 10] : [p.x + 20, p.y - 10, p.x + 20 + lw, p.y + 10]) }
      }
      for (const it of items.values()) if (!it.on) it.btn.hidden = true
      wasShown = true
      lay.hidden = false
    },
  }
}
