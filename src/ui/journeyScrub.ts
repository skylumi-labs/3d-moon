import './journeyScrub.css'
import { JourneyScrub, type JourneyHandle, clamp01, scrubKeyTarget } from '../journey/scrub'
import { clock } from '../viewpointList'
import type { ScrubVisibility } from './journeyScrubVisibility'

/**
 * The one slider every journey shares: drag it to play the journey forward or backward as fast as you like;
 * let go and it runs on from there. Hidden when no journey is on (see journeyScrubVisibility for the lead-in and the ending). Works with a mouse, a pen and touch.
 */
export function mountJourneyScrub(parent: HTMLElement, scrub: JourneyScrub, onChange: () => void, show: (h: JourneyHandle) => boolean = () => true): { update(vis?: ScrubVisibility): void } {
  const wrap = document.createElement('div')
  wrap.className = 'journey-scrub'
  wrap.hidden = true
  wrap.setAttribute('role', 'group')
  const label = document.createElement('span')
  label.className = 'js-label'
  const input = document.createElement('input')
  input.type = 'range'
  input.min = '0'
  input.max = '1000'
  input.step = '1'
  input.value = '0'
  input.className = 'js-range'
  const readout = document.createElement('span')
  readout.className = 'js-read'
  // Pause and play, for a journey that can be held (a flight): beside the slider.
  const pauseB = document.createElement('button')
  pauseB.type = 'button'
  pauseB.className = 'js-pause'
  pauseB.hidden = true
  pauseB.addEventListener('click', () => { const h = scrub.current; if (h?.pause) { h.pause(!h.paused?.()); onChange() } })
  wrap.append(pauseB, label, input, readout)
  parent.prepend(wrap)

  const value = (): number => clamp01(Number(input.value) / 1000)
  /** The pointer that holds the slider: another finger lifting elsewhere does not let go of the journey. */
  let dragId: number | null = null
  input.addEventListener('pointerdown', (e) => {
    // Keep the drag on the slider even when the finger leaves it, and release on a window-level up/cancel as a fallback.
    try { input.setPointerCapture(e.pointerId) } catch { /* not every browser captures a range input */ }
    dragId = e.pointerId
    scrub.begin(value())
    onChange()
  })
  input.addEventListener('input', () => {
    // Taps arrive as input events without a pointerdown on us: hold for that event too.
    if (!scrub.held) { scrub.begin(value()); scrub.end() } else scrub.move(value())
    onChange()
  })
  // Keys step from where the journey is now (journey/scrub.ts scrubKeyTarget), in seconds, not the range's thousandths.
  input.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || !scrub.current) return
    const u = scrubKeyTarget(e.key, scrub.progress(), scrub.current.durationS)
    if (u === null) return
    e.preventDefault()
    input.value = String(Math.round(u * 1000))
    if (!scrub.held) { scrub.begin(u); scrub.end() } else scrub.move(u)
    onChange()
  })
  const release = (): void => { dragId = null; scrub.end(); onChange() }
  input.addEventListener('pointerup', release)
  input.addEventListener('pointercancel', release)
  input.addEventListener('blur', release)
  const windowUp = (e: PointerEvent): void => { if (scrub.held && (dragId === null || e.pointerId === dragId)) release() }
  window.addEventListener('pointerup', windowUp)
  window.addEventListener('pointercancel', windowUp)

  let lastLabel = ''
  return {
    update(vis?: ScrubVisibility): void {
      const h = scrub.current
      if (vis && (vis.mode === 'locked' || vis.mode === 'ending')) {
        // Lead-in (at 0) or the few seconds after a natural end (at the end): shown but not draggable, so nothing jumps when the live handle takes over.
        wrap.hidden = false
        wrap.classList.toggle('js-ending', vis.mode === 'ending')
        input.disabled = true
        pauseB.hidden = true
        input.setAttribute('aria-label', vis.mode === 'ending' ? 'The journey has finished' : 'The journey is about to start')
        lastLabel = ''
        input.value = String(vis.lockedAt * 1000)
        readout.textContent = `${vis.lockedAt * 100}%`
        return
      }
      wrap.classList.remove('js-ending')
      wrap.hidden = !h || (vis ? vis.mode !== 'live' : !show(h))
      if (!h || wrap.hidden) return
      input.disabled = false
      const canPause = !!h.pause
      if (pauseB.hidden === canPause) pauseB.hidden = !canPause
      if (canPause) {
        const paused = !!h.paused?.()
        const t = paused ? '\u25B6' : '\u275A\u275A'
        if (pauseB.textContent !== t) { pauseB.textContent = t; pauseB.setAttribute('aria-label', paused ? 'Play the flight' : 'Pause the flight') }
      }
      const text = h.label
      if (text !== lastLabel) { label.textContent = text; input.setAttribute('aria-label', `Position in the journey: ${text}`); lastLabel = text }
      const u = scrub.progress()
      if (!scrub.held) input.value = String(Math.round(u * 1000))
      const note = h.note?.() ?? ''
      readout.textContent = h.durationS ? `${clock(u * h.durationS)} of ${clock(h.durationS)}` : `${Math.round(u * 100)}%${note ? ` · ${note}` : ''}`
    },
  }
}
