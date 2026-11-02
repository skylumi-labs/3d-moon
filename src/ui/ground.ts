import './ground.css'
import { CAMERA_PRESETS } from '../ground/presets'

/**
 * Ground mode's buttons (G1): one row that appears over the Apollo 17 site. Off the ground it offers the way down
 * ("Ground view"); on it, the camera presets (each with its honest name), walking at eye level, the origin labels
 * and the way back up. The state is pushed in by main.ts; the buttons only call hooks.
 */
export interface GroundUiHooks {
  enter(): void
  leave(): void
  preset(id: string): void
  free(): void
  toggleWalk(): void
  toggleOrigin(): void
  toggleTilt(): void
}
export interface GroundUiState {
  /** Over the Apollo 17 site with its patch loaded: the way down is offered. */
  canEnter: boolean
  active: boolean
  lmReady: boolean
  preset: string | null
  walking: boolean
  origin: boolean
  /** The module is set at the crew's reported tilt (true) or the terrain-fitted one. */
  reportedTilt: boolean
}

const GLYPH: Record<string, string> = { follow: 'Fo', window: 'Wn', footpad: 'Fp', strut: 'St' }

/** Sets a button's label without dropping its glyph. */
const setText = (b: HTMLButtonElement, text: string): void => { const t = b.querySelector('.gp-text'); if (t) t.textContent = text; else b.textContent = text }

export function mountGroundUi(parent: HTMLElement, hooks: GroundUiHooks): { update(s: GroundUiState): void } {
  const row = document.createElement('div')
  row.className = 'ground-panel'
  row.hidden = true
  const mk = (label: string, title: string, on: () => void, glyph = ''): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    if (glyph) { const g = document.createElement('span'); g.className = 'gp-glyph'; g.setAttribute('aria-hidden', 'true'); g.textContent = glyph; b.append(g) }
    const t = document.createElement('span')
    t.className = 'gp-text'
    t.textContent = label
    b.append(t)
    b.title = title
    b.addEventListener('click', on)
    return b
  }
  const enter = mk('Ground view (G)', 'Leave the orbital camera for the lunar module’s own metre frame', hooks.enter, 'Gv')
  const leave = mk('Back up (Esc)', 'Return to the orbital view', hooks.leave, 'Up')
  const free = mk('Free look', 'Drag to look, wheel or W A S D to move', hooks.free, 'Fr')
  const presets = CAMERA_PRESETS.map((p) => {
    const short = p.id === 'follow' ? 'Follow' : p.id === 'window' ? 'Window height' : p.id === 'footpad' ? 'Footpad' : 'Strut'
    const b = mk(short, p.name, () => hooks.preset(p.id), GLYPH[p.id] ?? short.slice(0, 2))
    b.dataset.id = p.id
    return b
  })
  const walk = mk('Walk at eye level (V)', 'Stay 1.7 m above the ground and walk with W A S D', hooks.toggleWalk, 'Wk')
  const origin = mk('Origin: off', 'Label what each element is: measured, inferred, modelled or computed', hooks.toggleOrigin, 'Or')
  const tilt = mk('Tilt: reported', 'Set the module at the crew’s reported tilt, or at the tilt fitted to the terrain model under its pads', hooks.toggleTilt, 'Ti')
  const group = (cls: string, ...kids: HTMLElement[]): HTMLElement => { const g = document.createElement('div'); g.className = `gp-group ${cls}`; g.append(...kids); return g }
  const gCam = group('gp-cam', free, ...presets)
  const gMove = group('gp-move', walk)
  const gLabel = group('gp-label', origin, tilt)
  const gBack = group('gp-back', leave)
  row.append(enter, gCam, gMove, gLabel, gBack)
  parent.append(row)
  let last = ''
  return {
    update(s: GroundUiState): void {
      const key = JSON.stringify(s)
      if (key === last) return
      last = key
      row.hidden = !s.canEnter && !s.active
      enter.hidden = s.active
      for (const b of [leave, free, walk, origin, tilt, ...presets]) b.hidden = !s.active
      for (const g of [gCam, gMove, gLabel, gBack]) g.hidden = !s.active
      for (const b of presets) { b.disabled = !s.lmReady; b.setAttribute('aria-pressed', String(s.preset === b.dataset.id)) }
      free.setAttribute('aria-pressed', String(s.preset === null && !s.walking))
      walk.setAttribute('aria-pressed', String(s.walking))
      origin.setAttribute('aria-pressed', String(s.origin))
      setText(origin, s.origin ? 'Origin: labels' : 'Origin: off')
      tilt.disabled = !s.lmReady
      setText(tilt, s.reportedTilt ? 'Tilt: reported' : 'Tilt: terrain fit')
    },
  }
}
