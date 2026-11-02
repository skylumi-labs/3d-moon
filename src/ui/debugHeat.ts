import type { Ephemeris } from '../ephemeris'
import type { ViewCamera } from '../camera/pose'
import { REGIONS, bestTexelM, detailShare, finestRegionAt, heatColor } from '../coverage/coverage'
import { heatmapPixels, lonLatAt } from '../coverage/heatmap'

export interface HeatHost {
  /** A place with finer data than the global tiles was clicked: fly to it at the finest zoom its data supports. */
  /** Returns false when no picture of that size can be shown here (the region is declared, but no site patch is wired for it). */
  flyTo(lon: number, lat: number, siteId: string | null): boolean
}
export interface HeatFrame { cam: ViewCamera; aspect: number; e: Ephemeris }

const STOPS = [400, 100, 20, 5, 1, 0.5, 0.25]
const label = (m: number): string => (m >= 1 ? `${m} m` : `${m * 100} cm`)

/** ?debug=1: tints the Moon by the best photograph's ground size per pixel (green fine, red coarse), with a legend; a click on a tinted place flies there. */
export function mountDebugHeat(root: HTMLElement, canvas: HTMLCanvasElement, host: HeatHost): { update(f: HeatFrame): void; setOn(on: boolean): void; destroy(): void } {
  const layer = document.createElement('canvas')
  layer.id = 'debug-heat'
  layer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;image-rendering:auto;mix-blend-mode:normal'
  root.prepend(layer)
  const legend = document.createElement('div')
  legend.id = 'debug-heat-legend'
  legend.style.cssText = 'position:absolute;right:14px;top:14px;z-index:5;pointer-events:auto;font:0.75rem/1.4 ui-sans-serif,system-ui,sans-serif;color:#f1f4fb;background:rgba(10,12,18,.78);padding:8px 10px;border-radius:10px;max-width:210px'
  const bar = document.createElement('div')
  bar.style.cssText = 'height:10px;border-radius:5px;margin:6px 0 2px;background:linear-gradient(90deg,' + STOPS.map((m, i) => { const [r, g, b] = heatColor(detailShare(m)); return `rgb(${r},${g},${b}) ${Math.round(i / (STOPS.length - 1) * 100)}%` }).join(',') + ')'
  const ticks = document.createElement('div')
  ticks.style.cssText = 'display:flex;justify-content:space-between;font-size:0.625rem;opacity:.8'
  ticks.innerHTML = `<span>${label(STOPS[0])}</span><span>${label(STOPS[3])}</span><span>${label(STOPS[STOPS.length - 1])}</span>`
  const title = document.createElement('div')
  title.innerHTML = '<b>Photo resolution</b> (ground size of one pixel of the finest picture)'
  const readout = document.createElement('div')
  readout.style.cssText = 'margin-top:6px;opacity:.9'
  readout.textContent = 'Green: click to fly in.'
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.textContent = 'Hide map'
  toggle.style.cssText = 'margin-top:6px;font:inherit;color:inherit;background:rgba(255,255,255,.12);border:0;border-radius:6px;padding:3px 8px;cursor:pointer'
  legend.append(title, bar, ticks, readout, toggle)
  root.append(legend)
  let on = true
  const setOn = (v: boolean): void => { on = v; layer.style.display = v ? '' : 'none'; toggle.textContent = v ? 'Hide map' : 'Show map' }
  toggle.addEventListener('click', () => setOn(!on))
  let frame: HeatFrame | null = null
  let downX = 0, downY = 0
  canvas.addEventListener('pointerdown', (ev) => { downX = ev.clientX; downY = ev.clientY })
  canvas.addEventListener('pointerup', (ev) => {
    if (!on || !frame || Math.hypot(ev.clientX - downX, ev.clientY - downY) > 5) return
    const p = lonLatAt(frame.cam, frame.aspect, frame.e, (ev.clientX / window.innerWidth) * 2 - 1, 1 - (ev.clientY / window.innerHeight) * 2)
    if (!p) return
    const t = bestTexelM(p.lon, p.lat, { imagery: true })
    if (!(t < 399)) { readout.textContent = `${label(Math.round(t * 10) / 10)} here: the global picture. Green: click to fly in.`; return }
    const r = finestRegionAt(p.lon, p.lat)
    const flown = host.flyTo(p.lon, p.lat, r?.site ?? null)
    readout.textContent = flown ? `${label(t)} per pixel (${r?.id ?? 'n/a'}). Flying in.` : `${label(t)} per pixel (${r?.id ?? 'n/a'}): the data is declared, but no patch for it is wired in this build, so there is nothing finer to show yet.`
  })
  void REGIONS
  return {
    setOn,
    destroy() { layer.remove(); legend.remove(); frame = null },
    update(f) {
      frame = f
      if (!on) return
      const w = 160, h = Math.max(1, Math.round(w / f.aspect))
      if (layer.width !== w || layer.height !== h) { layer.width = w; layer.height = h }
      const ctx = layer.getContext('2d')
      if (!ctx) return
      ctx.putImageData(new ImageData(heatmapPixels(f.cam, f.aspect, f.e, w, h), w, h), 0, 0)
    },
  }
}
