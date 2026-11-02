import './ground.css'

/**
 * The descent's playback controls (G2b): play and pause, the clock rate (the scrubber over the 16 minutes from the hand-over at 20 km to the
 * rest of the module is the shared journey slider, ui/journeyScrub.ts), a skip to ignition, the camera (an observer beside the module, or the commander's window), the origin labels, the
 * engine glow (modelled, off by default) and a way to take the camera. State is pushed in by main.ts; the controls only call hooks.
 */
export interface FlightUiHooks {
  toggle(): void
  rate(r: number | null): void
  skip(): void
  cam(mode: 'chase' | 'window'): void
  origin(): void
  plume(): void
  take(): void
}
export interface FlightUiState {
  active: boolean
  playing: boolean
  /** Fixed rate, or null for the default schedule. */
  rate: number | null
  t: number
  tMin: number
  tMax: number
  cam: 'chase' | 'window'
  origin: boolean
  plume: boolean
  ended: boolean
  blending: boolean
  /** Height above the ground, metres (the commander's window is offered only below WINDOW_MIN_ALT_M). */
  altM: number
}

/** The window view is a wall of grey from higher up. */
export const WINDOW_MIN_ALT_M = 3000
export const windowAvailable = (altM: number): boolean => altM < WINDOW_MIN_ALT_M


export function mountFlightUi(parent: HTMLElement, hooks: FlightUiHooks): { update(s: FlightUiState): void } {
  const row = document.createElement('div')
  row.className = 'ground-panel flight-panel'
  row.hidden = true
  const mk = (label: string, title: string, on: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.title = title
    b.addEventListener('click', on)
    return b
  }
  const play = mk('Pause', 'Play or pause the clock', hooks.toggle)
  const rates: Array<[string, number | null]> = [['Auto', null], ['×1', 1], ['×4', 4], ['×16', 16]]
  const rateBtns = rates.map(([label, r]) => { const b = mk(label, r === null ? 'Fast before ignition, true time from there' : `Run ${r} times faster than real time`, () => hooks.rate(r)); return b })
  const skip = mk('Skip to ignition', 'Jump to ten seconds before the descent engine lights, where true time starts', hooks.skip)
  const chase = mk('Beside the module', 'An observer 45 m south of the module, moving with it; before ignition it trails the module at about 80 m (a modelled camera, a framing choice)', () => hooks.cam('chase'))
  const win = mk('Commander’s window', 'The window-height eye, looking 41 degrees outboard and 41 degrees down through a 49 degree field. A modelled pose: no cabin is drawn', () => hooks.cam('window'))
  const windowTitle = win.title
  const origin = mk('Origin: off', 'Label what is measured, inferred or modelled', hooks.origin)
  const plume = mk('Engine glow: off', 'A modelled glow under the engine. The real exhaust was invisible in the film', hooks.plume)
  const take = mk('Take the camera', 'End the flight and look around yourself', hooks.take)
  const sep = document.createElement('span')
  sep.className = 'sep'
  const sep2 = sep.cloneNode() as HTMLElement
  row.append(play, ...rateBtns, skip, sep, chase, win, sep2, origin, plume, take)
  parent.append(row)
  let last = ''
  return {
    update(s: FlightUiState): void {
      row.hidden = !s.active
      if (!s.active) { last = ''; return }
      const key = JSON.stringify({ ...s, t: 0, altM: windowAvailable(s.altM) })
      if (key === last) return
      last = key
      play.textContent = s.ended ? 'Replay' : s.playing ? 'Pause' : 'Play'
      rateBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(rates[i][1] === s.rate)))
      chase.setAttribute('aria-pressed', String(s.cam === 'chase'))
      const winOk = windowAvailable(s.altM)
      win.disabled = !winOk
      win.title = winOk ? windowTitle : 'Available below 3 km'
      win.setAttribute('aria-pressed', String(s.cam === 'window'))
      origin.setAttribute('aria-pressed', String(s.origin))
      origin.textContent = s.origin ? 'Origin: labels' : 'Origin: off'
      plume.setAttribute('aria-pressed', String(s.plume))
      plume.textContent = s.plume ? 'Engine glow: on (modelled)' : 'Engine glow: off'
      skip.disabled = s.t >= -10
    },
  }
}
