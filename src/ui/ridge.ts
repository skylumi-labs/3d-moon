import './ridge.css'

export interface RidgeUiHooks {
  lift(): void
  pause(): void
  skip(): void
}
export interface RidgeUiState {
  active: boolean
  playing: boolean
  u: number
  dateText: string
  moonText: string
  altKm: number
}

/**
 * The card over the ridge opening: where and when, what is real and what is drawn, and the way out (lift off, or skip
 * straight to the Earth view). Everything modelled says so.
 */
/** Distance from the Earth for the card: metres under 1 km, then two significant figures (an illustrative journey has no more). */
export function fmtHeight(altKm: number): string {
  if (altKm < 1) return `${Math.round(altKm * 1000)} m from the Earth`
  if (altKm < 10) return `${altKm.toFixed(1)} km from the Earth`
  const mag = Math.pow(10, Math.floor(Math.log10(altKm)) - 1)
  return `${(Math.round(altKm / mag) * mag).toLocaleString('en-GB')} km from the Earth`
}

export function mountRidgeUi(parent: HTMLElement, hooks: RidgeUiHooks): { update(s: RidgeUiState): void } {
  const card = document.createElement('div')
  card.className = 'ridge-card'
  card.hidden = true
  const title = document.createElement('div')
  title.innerHTML = '<b>The Moon behind a ridge</b>'
  const sub = document.createElement('div')
  sub.className = 'rc-sub'
  const note = document.createElement('div')
  note.className = 'rc-note'
  const row = document.createElement('div')
  row.className = 'rc-row'
  const mk = (label: string, cls: string, on: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    if (cls) b.className = cls
    b.addEventListener('click', on)
    return b
  }
  const lift = mk('Lift off', 'primary', hooks.lift)
  const pause = mk('Pause', '', hooks.pause)
  const skip = mk('Skip the lift-off', '', hooks.skip)
  row.append(lift, pause, skip)
  card.append(title, sub, note, row)
  parent.append(card)
  let last = ''
  return {
    update(s: RidgeUiState): void {
      if (card.hidden !== !s.active) card.hidden = !s.active
      if (!s.active) { last = ''; return }
      const started = s.u > 0.0005
      const key = JSON.stringify([s.playing, started, s.dateText, s.moonText, Math.round(s.altKm)])
      if (key === last) return
      last = key
      lift.hidden = started
      pause.hidden = !started
      pause.textContent = s.playing ? 'Pause' : 'Resume'
      sub.textContent = started
        ? `${s.dateText} · ${fmtHeight(s.altKm)}`
        : `${s.dateText} · ${s.moonText}`
      note.textContent = started
        ? 'Journey time-compressed and the sky clock paused at this time. The ridge and the sky are illustrative. The Moon\u2019s direction, distance and phase are computed; the air and the exposure are a modelled look.'
        : 'An evening in October 2026, not the present. The place, the time and the Moon are computed. The ridge and the sky are illustrative.'
    },
  }
}
