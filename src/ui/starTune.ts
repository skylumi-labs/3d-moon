import { clampBoost } from '../sky/starBoost'

/**
 * The star brightness slider (0 = physical flux, 1 = brightest; the star catalogue is fixed, so this is brightness, not count), built into
 * the debug sheet. Shows the number so a setting can be reported.
 */
export function mountStarTune(container: HTMLElement, initial: number, onChange: (b: number) => void): void {
  const box = document.createElement('div')
  box.id = 'star-tune'
  box.className = 'debug-slider'
  const row = document.createElement('div')
  row.className = 'debug-slider-head'
  const title = document.createElement('label')
  title.textContent = 'Star brightness'
  title.htmlFor = 'star-tune-input'
  const val = document.createElement('span')
  val.className = 'debug-slider-value'
  row.append(title, val)
  const input = document.createElement('input')
  input.id = 'star-tune-input'
  input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.01'
  input.setAttribute('aria-label', 'Star brightness, 0 is physical')
  const note = document.createElement('div')
  note.className = 'debug-note'
  note.textContent = '0 physical, 1 brightest. Stars are always on.'
  const show = (b: number): void => { input.value = String(b); val.textContent = b.toFixed(2) }
  show(clampBoost(initial))
  input.addEventListener('input', () => { const b = clampBoost(Number(input.value)); val.textContent = b.toFixed(2); onChange(b) })
  box.append(row, input, note)
  container.append(box)
}
