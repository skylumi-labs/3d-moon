import './newMoonNote.css'
import { getDock, trackCaptionBand } from './dock'
import { announce } from './announce'
import { OFFLINE_TEXT } from '../net/offlineState'

/** The offline line over the Home caption: the caption's own look (newMoonNote.css), no button. Announced politely once per appearance. */
export interface OfflineNoteApi { set(visible: boolean): void; readonly visible: boolean; readonly element: HTMLElement }

export function mountOfflineNote(root: HTMLElement): OfflineNoteApi {
  const el = document.createElement('div')
  el.className = 'caption newmoon-note offline-note'
  el.id = 'offline-note'
  el.setAttribute('role', 'status')
  const line = document.createElement('span')
  line.className = 'newmoon-line'
  line.textContent = OFFLINE_TEXT
  el.append(line)
  el.hidden = true
  const dock = getDock(root)
  dock.prepend(el)
  trackCaptionBand(dock, el)
  return {
    element: el,
    get visible() { return !el.hidden },
    set(visible) {
      if (visible === !el.hidden) return
      el.hidden = !visible
      if (visible) announce({ kind: 'hint', text: OFFLINE_TEXT })
    },
  }
}
