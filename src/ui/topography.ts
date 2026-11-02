import './topography.css'
import type { BarApi } from './bar'
import { elevationRangeLabels, ELEVATION_RAMP } from '../topography/elevation'
import { tablerIcon } from './tablerIcons'

export interface TopographyApi {
  isOn(): boolean
  setOn(on: boolean): void
  setRange(rangeM: number): void
}

const ICON = tablerIcon('mountain')

/** Adds the elevation switch to More on phones and a compact metre legend while it is active. */
export function mountTopography(root: HTMLElement, bar: BarApi, onChange: (on: boolean) => void, initiallyOn = false, initialRangeM = 250): TopographyApi {
  const legend = document.createElement('aside')
  legend.className = 'topography-legend'
  legend.hidden = true
  legend.setAttribute('aria-label', 'Relative lunar elevation legend')
  const title = document.createElement('strong')
  title.textContent = 'Relative elevation'
  const ramp = document.createElement('div')
  ramp.className = 'topography-ramp'
  ramp.setAttribute('aria-hidden', 'true')
  ramp.style.background = `linear-gradient(90deg, ${ELEVATION_RAMP.map(({ at, hex }) => `${hex} ${at * 100}%`).join(', ')})`
  const labels = document.createElement('div')
  labels.className = 'topography-labels'
  const low = document.createElement('span')
  const mid = document.createElement('span')
  mid.textContent = 'local reference'
  const high = document.createElement('span')
  labels.append(low, mid, high)
  const note = document.createElement('small')
  note.textContent = 'Colour shows height above or below a broad local average.'
  legend.append(title, ramp, labels, note)
  root.append(legend)

  let on = initiallyOn
  let rangeM = Number.NaN
  const button = bar.addItem({ id: 'topography', label: 'Relief', ariaLabel: 'Relative elevation colours', icon: ICON, order: 52, overflow: true, onClick: () => setOn(!on) })
  const setRange = (value: number): void => {
    const safe = Number.isFinite(value) ? Math.max(1, value) : 250
    if (Number.isFinite(rangeM) && Math.round(safe) === Math.round(rangeM)) return
    rangeM = safe
    ;[low.textContent, high.textContent] = elevationRangeLabels(rangeM)
  }
  const setOn = (value: boolean): void => {
    on = value
    button.setAttribute('aria-pressed', String(on))
    legend.hidden = !on
    onChange(on)
  }
  setRange(initialRangeM)
  setOn(on)
  return { isOn: () => on, setOn, setRange }
}
