import './newMoonNote.css'
import { getDock, trackCaptionBand } from './dock'

/**
 * A small line over the Home caption when the Moon is almost dark: "New Moon: the Moon is almost dark tonight" and a button that
 * shows it lit. It is styled like the caption (same pool of shadow, same type), is not part of it, and goes at the first interaction
 * with the page or when the time changes (main.ts hides it). The button's work is the owner's `onShowLit`.
 */
export interface NewMoonNoteApi {
  show(): void
  hide(): void
  readonly visible: boolean
  readonly element: HTMLElement
}

export const NEW_MOON_TEXT = 'New Moon: the Moon is almost dark tonight'
export const NEW_MOON_BUTTON = 'Show it lit'
export const NEW_MOON_BUTTON_TITLE = 'Sets the time to the next evening (18:00 UTC) when the Moon is a crescent at least 15 % lit, and flies Home there'

export function mountNewMoonNote(root: HTMLElement, onShowLit: () => void): NewMoonNoteApi {
  const el = document.createElement('div')
  el.className = 'caption newmoon-note'
  el.id = 'newmoon-note'
  el.setAttribute('role', 'status')
  const line = document.createElement('span')
  line.className = 'newmoon-line'
  line.textContent = NEW_MOON_TEXT
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'caption-action'
  button.textContent = NEW_MOON_BUTTON
  button.title = NEW_MOON_BUTTON_TITLE
  button.addEventListener('click', (ev) => { ev.stopPropagation(); onShowLit() })
  button.addEventListener('pointerdown', (ev) => ev.stopPropagation())
  el.append(line, button)
  el.hidden = true
  const dock = getDock(root)
  dock.prepend(el)
  trackCaptionBand(dock, el)

  // Any interaction with the page dismisses the note, except one that starts on the note itself (its button must still get its click).
  const dismiss = (ev: Event): void => {
    if (el.hidden) return
    if (ev instanceof KeyboardEvent && (ev.key === 'Tab' || ev.key === 'Shift')) return // moving the focus to the button is not leaving
    if (ev.target instanceof Node && el.contains(ev.target)) return
    api.hide()
  }
  for (const type of ['pointerdown', 'wheel', 'keydown'] as const) document.addEventListener(type, dismiss, { capture: true, passive: true })

  const api: NewMoonNoteApi = {
    element: el,
    get visible() { return !el.hidden },
    show() { el.hidden = false },
    hide() { el.hidden = true },
  }
  return api
}
