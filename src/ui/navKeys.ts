/**
 * Which way Left or Right steps the navigator, or null when the press is not the navigator's. Pure: main.ts and the pill pass the
 * key and whether it was pressed in a field of its own. The journey slider sits inside the pill: its arrows move the slider
 * (the range input's own step), never to the next viewpoint, which ended the flight the visitor was scrubbing.
 */
export interface NavKey { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; /** Pressed in an input (the journey slider). */ inInput: boolean }

export function navArrowStep(e: NavKey): 'next' | 'prev' | null {
  if (e.inInput || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null
  return e.key === 'ArrowRight' ? 'next' : e.key === 'ArrowLeft' ? 'prev' : null
}
