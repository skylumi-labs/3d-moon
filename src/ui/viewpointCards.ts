// The filmstrip of the viewpoints list: each card is a still of what is there, the name and a few words. Pure helpers, no DOM, so a test can import them.

/** A few words on what is there, by entry id (the list's own `caption` is the longer line under the current card). */
const SHORT: Readonly<Record<string, string>> = {
  'pin-earth': 'The Moon as seen from Earth',
  'fly-around': 'One turn round the Moon',
  'pin-earthrise': 'The Earth over the far-side limb',
  'solar-eclipse': 'The Sun, the Moon, then its shadow',
  'pin-tycho': 'Rays across the near side',
  'pin-copernicus': 'Terraced walls, flown over',
  'sunrise-terminator': 'Long shadows at lunar dawn',
  'pin-apollo11': 'Tranquility Base',
  'pin-apollo17': 'Challenger and three panoramas',
}
export const SHORT_MAX = 40

/** The card's line: the table's, else the first sentence of the caption cut to fit. */
export function shortLine(id: string, caption: string): string {
  const s = SHORT[id]
  if (s) return s
  const first = (/^.*?[.!?](?=\s|$)/.exec(caption.trim())?.[0] ?? caption).trim().replace(/[.!?]$/, '')
  return first.length <= SHORT_MAX ? first : `${first.slice(0, SHORT_MAX - 1).trimEnd()}…`
}

/**
 * Where the stills live: next to the tiles (`.../moon/tiles/` -> `.../moon/thumbs/`). With no tile base (a dev or artifact build) they are
 * `./thumbs/`, which simply is not there and leaves the cards on their gradient.
 */
export function thumbBase(tilesBase: string | undefined | null): string {
  const b = (tilesBase ?? '').trim()
  if (!b) return './thumbs/'
  const withSlash = b.endsWith('/') ? b : `${b}/`
  return /tiles\/$/.test(withSlash) ? withSlash.replace(/tiles\/$/, 'thumbs/') : `${withSlash}thumbs/`
}

/** The card image: 240 x 160 at 1x, 480 x 320 at 2x. */
export function thumbSrc(base: string, id: string): { src: string; srcset: string } {
  const enc = encodeURIComponent(id)
  return { src: `${base}${enc}@1x.webp`, srcset: `${base}${enc}@1x.webp 1x, ${base}${enc}@2x.webp 2x` }
}

// ---- Drag-to-scroll on the filmstrip (owner review 2026-10-23, #6: a mouse drag on the strip moved nothing; the strip is a native scroller, which only the wheel, a finger and the keys move).

/** A mouse press that travels this far sideways is a drag of the strip, not a tap on a card; the click that follows it is swallowed. */
export const STRIP_DRAG_PX = 6

export interface StripDrag {
  /** Where the press landed and what the strip's scrollLeft was then. */
  readonly x0: number
  readonly scroll0: number
  /** Past the threshold: the strip follows the pointer and the click at the end is not a card tap. */
  readonly dragging: boolean
}

export const stripDragStart = (clientX: number, scrollLeft: number): StripDrag => ({ x0: clientX, scroll0: scrollLeft, dragging: false })

/** The pointer moved to `clientX`: the strip's new scrollLeft once the press is a drag (null before that, so a tap with a tremor stays a tap), and the state. */
export function stripDragMove(d: StripDrag, clientX: number): { drag: StripDrag; scrollLeft: number | null } {
  const dx = clientX - d.x0
  const dragging = d.dragging || Math.abs(dx) >= STRIP_DRAG_PX
  return { drag: { ...d, dragging }, scrollLeft: dragging ? d.scroll0 - dx : null }
}

/** Whether the strip takes the press at all: the primary mouse (or pen) button. A finger pans the native scroller itself (touch-action: pan-x). */
export const stripDragTakes = (pointerType: string, button: number): boolean => pointerType !== 'touch' && button === 0
