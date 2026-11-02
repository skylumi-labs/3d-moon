import './quality.css'
import { getDock } from './dock'
import type { BarApi, BarSheet } from './bar'
import { applyShadowMode } from '../quality/apply'
import {
  getQuality, isExplicit, onQualityChange, resetQuality, setQuality,
  type DetailMode, type MotionMode, type QualityPreset, type QualitySettings, type ShadowMode,
} from '../quality/settings'
import { QUALITY_CHOICES } from './qualityChoices'
import { tablerIcon } from './tablerIcons'
import { trackUsage } from '../usage'

const ICON = tablerIcon('adjustmentsHorizontal')

interface Row<T extends string | boolean> {
  key: 'shadows' | 'detail' | 'glow' | 'motion'
  label: string
  choices: ReadonlyArray<{ value: T; text: string }>
}

const SHADOW_NOTE: Record<ShadowMode, string> = {
  full: 'Traced live every frame. Sharpest, heaviest.',
  baked: 'Pre-computed, follows the Sun. Lighter on phones; Fast where it is not available yet.',
  fast: 'Approximate: one shadow sample per pixel, edges a little harder.',
  off: 'No crater shadows. Lit specks can show on the dark side near the day-night line.',
}
const DETAIL_NOTE: Record<DetailMode, string> = {
  full: 'All the fine surface texture, close up.',
  reduced: 'No extra fine surface texture. The map’s own resolution is what you see.',
}
const MOTION_NOTE: Record<MotionMode, string> = {
  smooth: 'Lighter shading while you move, full detail when you stop. Smoother on phones.',
  classic: 'Full shading while you move. Sharper in motion, can stutter on phones.',
}
const GLOW_NOTE = (on: boolean): string => on ? 'Light spreads softly around bright areas and the Sun.' : 'No bloom around bright areas or the Sun.'

const anyExplicit = (): boolean => isExplicit('shadows') || isExplicit('detail') || isExplicit('glow') || isExplicit('motion')

/** Mounts the Quality bar item and its sheet (on a phone the item lives in More): one choice, Battery saver, Balanced or Best. */
export function mountQualitySheet(root: HTMLElement, bar: BarApi): { isOpen(): boolean } {
  const sheet = document.createElement('div')
  sheet.className = 'bar-sheet quality-sheet'
  sheet.id = 'bar-quality'
  sheet.setAttribute('role', 'group')
  sheet.setAttribute('aria-label', 'Quality')
  sheet.hidden = true
  getDock(root).insertBefore(sheet, bar.element)

  const api: BarSheet = { isOpen: () => !sheet.hidden, close: () => setOpen(false) }
  const btn = bar.addItem({
    id: 'quality', label: 'Quality', ariaLabel: 'Quality settings', icon: ICON, order: 34, overflow: true,
    onClick: () => { const open = !!sheet.hidden; if (open) bar.closeSheetsExcept(api); setOpen(open) },
  })
  btn.setAttribute('aria-controls', 'bar-quality')
  btn.setAttribute('aria-expanded', 'false')
  bar.registerSheet(api)
  function setOpen(open: boolean): void {
    sheet.hidden = !open
    btn.setAttribute('aria-expanded', String(open))
    btn.setAttribute('aria-pressed', String(open))
    if (open) refresh()
  }

  const intro = document.createElement('p')
  intro.className = 'quality-intro'
  intro.textContent = 'How much of the Moon is drawn. Higher looks better and uses more power.'
  const wrap = document.createElement('div')
  wrap.className = 'quality-row'
  wrap.dataset.row = 'preset'
  const list = document.createElement('div')
  list.className = 'quality-choices'
  list.setAttribute('role', 'group')
  list.setAttribute('aria-label', 'Quality')
  const buttons = new Map<QualityPreset, HTMLButtonElement>()
  for (const c of QUALITY_CHOICES) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'quality-choice'
    b.dataset.value = c.value
    const t = document.createElement('b')
    t.textContent = c.title
    const s = document.createElement('small')
    s.textContent = c.line()
    b.append(t, s)
    b.addEventListener('click', () => { setQuality({ preset: c.value }); trackUsage('quality_change', { to: c.value }); refresh() })
    list.append(b)
    buttons.set(c.value, b)
  }
  wrap.append(list)
  const custom = document.createElement('button')
  custom.type = 'button'
  custom.className = 'quality-custom'
  custom.textContent = 'Custom debug settings are on. Tap to follow the choice above instead.'
  custom.addEventListener('click', () => { resetQuality(); refresh() })
  sheet.append(intro, wrap, custom)

  function refresh(): void {
    const q = getQuality()
    for (const [v, b] of buttons) b.setAttribute('aria-pressed', String(v === q.preset))
    custom.hidden = !anyExplicit()
  }
  onQualityChange((q) => { applyShadowMode(q.shadows); refresh() })
  refresh()
  return { isOpen: () => !sheet.hidden }
}

/**
 * The fine-grained rows (Shadows, Surface detail, Glow, Motion detail), for the debug sheet only: a visitor picks one of the three
 * presets instead. Each row keeps the markup the audits know (`.quality-row[data-row=...] button[data-value=...]`).
 */
export function mountQualityAdvanced(container: HTMLElement): { refresh(): void } {
  const rows: Array<{ key: Row<string>['key']; buttons: Map<string, HTMLButtonElement>; note: HTMLElement }> = []
  const build = <T extends string | boolean>(row: Row<T>): void => {
    const wrap = document.createElement('div')
    wrap.className = 'quality-row'
    wrap.dataset.row = row.key
    const head = document.createElement('div')
    head.className = 'quality-row-head'
    const label = document.createElement('span')
    label.className = 'quality-row-label'
    label.id = `quality-${row.key}-label`
    label.textContent = row.label
    const seg = document.createElement('div')
    seg.className = 'quality-seg'
    seg.setAttribute('role', 'group')
    seg.setAttribute('aria-labelledby', label.id)
    const note = document.createElement('p')
    note.className = 'quality-note'
    note.id = `quality-${row.key}-note`
    const buttons = new Map<string, HTMLButtonElement>()
    for (const c of row.choices) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = c.text
      b.dataset.value = String(c.value)
      b.setAttribute('aria-describedby', note.id)
      b.addEventListener('click', () => { setQuality({ [row.key]: c.value } as Partial<QualitySettings>); refresh() })
      seg.append(b)
      buttons.set(String(c.value), b)
    }
    head.append(label, seg)
    wrap.append(head, note)
    container.append(wrap)
    rows.push({ key: row.key, buttons, note })
  }
  build<ShadowMode>({ key: 'shadows', label: 'Shadows', choices: [{ value: 'full', text: 'Full' }, { value: 'fast', text: 'Fast' }, { value: 'off', text: 'Off' }] })
  build<DetailMode>({ key: 'detail', label: 'Surface detail', choices: [{ value: 'full', text: 'Full' }, { value: 'reduced', text: 'Reduced' }] })
  build<boolean>({ key: 'glow', label: 'Glow', choices: [{ value: true, text: 'On' }, { value: false, text: 'Off' }] })
  build<MotionMode>({ key: 'motion', label: 'Motion detail', choices: [{ value: 'smooth', text: 'Smooth' }, { value: 'classic', text: 'Classic' }] })
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.className = 'quality-reset'
  reset.textContent = 'Follow the preset'
  reset.title = 'Drop the Shadows, Surface detail, Glow and Motion choices; the preset decides again.'
  reset.addEventListener('click', () => { resetQuality(); refresh() })
  container.append(reset)

  function refresh(): void {
    const q = getQuality()
    for (const r of rows) {
      const cur = String(q[r.key])
      for (const [v, b] of r.buttons) b.setAttribute('aria-pressed', String(v === cur))
      if (r.key === 'shadows') r.note.textContent = SHADOW_NOTE[q.shadows]
      if (r.key === 'detail') r.note.textContent = DETAIL_NOTE[q.detail]
      if (r.key === 'motion') r.note.textContent = MOTION_NOTE[q.motion]
      if (r.key === 'glow') r.note.textContent = GLOW_NOTE(q.glow)
    }
    reset.disabled = !anyExplicit()
  }
  onQualityChange(refresh)
  refresh()
  return { refresh }
}
