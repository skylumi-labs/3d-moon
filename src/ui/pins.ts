import './pins.css'
import type { Ephemeris } from '../ephemeris'
import type { ViewCamera } from '../camera/pose'
import { angularDistance } from '../camera/pose'
import { type Hotspot, sunElevationDeg } from '../hotspots'
import { pinBoxes } from './pinLayout'
import { projectPin, selenoUnit } from './pinMath'
import { cachedQuery } from '../loop/domCache'

export { projectPin, selenoUnit }

const DEG = Math.PI / 180

export interface PinsHost {
  /** The hotspots to show (the ones whose data is there). */
  list(): Hotspot[]
  /** A pin or a row of the sheet was chosen. */
  select(h: Hotspot): void
  /** True for a pin whose data failed to load: it stays on the picture (the tap tries again), never fades or hides under the caption. */
  keep?(h: Hotspot): boolean
}

export interface PinsFrame {
  cam: ViewCamera
  aspect: number
  e: Ephemeris
  /** The camera's pose, for fading the pin whose own view the camera is at. */
  pose: { lon: number; lat: number; dist: number }
  /** A move is running, or ground mode, the flight or the ridge has the camera: the pins step aside. */
  hidden: boolean
}


/**
 * The pins on the Moon (labels anchored to selenographic points, hidden past the limb). A tap calls `host.select`. The list of the same
 * places for small screens is the navigator's (ui/navigator.ts).
 */
export function mountPins(root: HTMLElement, host: PinsHost): { update(f: PinsFrame): void; refresh(): void; /** The screen boxes (left, top, right, bottom) of the pins placed in the last update, dot and label: other layers keep clear of them. Empty while the layer is hidden (it has been since #124: the Labels layer and the navigator's list carry the places), so the Labels layer's one collision pass is the only one on screen. */ boxes(): Array<[number, number, number, number]> } {
  const layer = document.createElement('div')
  layer.className = 'pins'
  // Hidden since #124 (the places moved to the navigator's list and the Labels layer) and never shown again: update() then places nothing.
  layer.hidden = true
  layer.setAttribute('role', 'group')
  layer.setAttribute('aria-label', 'Places on the Moon')
  root.append(layer)
  const dockEl = cachedQuery(root, '.dock')

  const buttons = new Map<string, HTMLButtonElement>()
  let placed: Array<[number, number, number, number]> = []
  const refresh = (): void => {
    layer.replaceChildren()
    buttons.clear()
    for (const h of host.list()) {
      if (h.pinned !== false) {
        const pin = document.createElement('button')
        pin.type = 'button'
        pin.className = 'pin'
        pin.dataset.pin = h.id
        pin.dataset.passDrag = ''
        pin.setAttribute('aria-label', `${h.title}: fly there`)
        const dot = document.createElement('i')
        const label = document.createElement('span')
        label.textContent = h.label
        pin.append(dot, label)
        pin.hidden = true
        pin.addEventListener('click', (ev) => { ev.stopPropagation(); host.select(h) })
        // The canvas below must not take a tap on a pin as a drag or a double tap.
        pin.addEventListener('pointerdown', (ev) => ev.stopPropagation())
        layer.append(pin)
        buttons.set(h.id, pin)
      }
    }
  }
  refresh()

  const unit = selenoUnit
  // A label's real width, measured once per pin with the font it is drawn in (an estimate per character ran short and clipped "Apollo 17").
  const widths = new Map<string, number>()
  const ctx = document.createElement('canvas').getContext('2d')
  const textWidth = (id: string, pin: HTMLButtonElement, text: string): number => {
    const known = widths.get(id)
    if (known !== undefined) return known
    const span = pin.querySelector('span') as HTMLElement
    let px = text.length * 8.2
    if (ctx) {
      const cs = getComputedStyle(span)
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const m = ctx.measureText(text).width + (parseFloat(cs.letterSpacing) || 0) * text.length
      if (m > 0) px = m
    }
    widths.set(id, px)
    return px
  }

  return {
    refresh,
    boxes: () => placed,
    update(f) {
      const w = window.innerWidth, h = window.innerHeight
      layer.classList.toggle('away', f.hidden)
      placed = []
      if (f.hidden || layer.hidden) return
      // A label that would overlap an earlier pin's label hides its pin; one that runs off the right edge flips to the left. The list is in priority order.
      const taken: Array<[number, number, number, number]> = []
      // The caption, the bar and any open sheet stand over the picture: a pin label under them showed through the caption text (Earthrise on a phone).
      const dr = (dockEl() as HTMLElement | null)?.getBoundingClientRect() ?? new DOMRect()
      if (dr.height > 0) taken.push([0, dr.top - 8, w, h])
      // A kept pin (its photograph failed) takes its box first; the others fit around it.
      const ordered = host.list().slice().sort((x, y) => Number(!!host.keep?.(y)) - Number(!!host.keep?.(x)))
      for (const hs of ordered) {
        const pin = buttons.get(hs.id)
        if (!pin) continue
        const at = hs.pin(f.e)
        // The pin whose own view the camera is already at has nothing to offer: it fades out (within 5 % of its distance and 3 deg of it).
        const kept = !!host.keep?.(hs)
        const here = !kept && Math.abs(Math.log(f.pose.dist / hs.viewDist)) < 0.05 && angularDistance(f.pose.lon, f.pose.lat, at.lon, at.lat) < 3 * DEG
        const p = here ? null : projectPin(f.cam, f.aspect, unit(at.lon, at.lat, f.e), w, h)
        if (!p) { pin.hidden = true; continue }
        // A dot is never moved off its place: where the caption covers it (or it is off-screen) the caption's Try again chip is the way.
        const wText = textWidth(hs.id, pin, hs.label) + 32
        const boxes = pinBoxes(p.x, p.y, wText, w)
        const fit = boxes.find((b) => !taken.some((t) => b.box[0] < t[2] && b.box[2] > t[0] && b.box[1] < t[3] && b.box[3] > t[1]))
        // A pin is its label: when neither side has room (or it would sit on an earlier label) the pin is hidden, never a bare dot.
        // The Hotspots sheet still lists it.
        if (!fit) { pin.hidden = true; continue }
        const use = fit
        pin.hidden = true
        // A place the Sun is below the horizon of right now: dimmed, so a lit pin never promises a lit place.
        pin.classList.toggle('dark', sunElevationDeg(f.e, at.lon, at.lat) < 0)
        taken.push(use.box)
        placed.push(use.box)
        pin.classList.toggle('left', use.left)
        pin.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)${use.left ? ' translateX(calc(22px - 100%))' : ''}`
      }
    },
  }
}
