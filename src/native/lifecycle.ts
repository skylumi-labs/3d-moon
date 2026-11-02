/**
 * The current view, kept across a process restart. iOS and Android can end the WebContent process in the
 * background, and only a page load recovers from that. The view's query is written to localStorage every few seconds while it
 * changes, and boot (native/boot.ts) starts from it, so the app resumes at the same view instead of at Home.
 */
export const LAST_VIEW_KEY = 'moon.lastView'
export const VIEW_SAVE_MS = 3000

/** A view's query string, as the viewer keeps it: '?' and parameters, bounded, no control characters. */
export function isViewQuery(q: string): boolean {
  return q.startsWith('?') && q.length > 1 && q.length <= 2000 && !/[\r\n\0]/.test(q)
}

/** What to write now: the current view when it differs from the last one written and is a valid query; null when nothing changes. */
export function viewToSave(last: string | null, current: string): string | null {
  if (current === last || !isViewQuery(current)) return null
  return current
}

/** What a start restores: the stored query when it is valid, else null (the app starts at its own default). */
export function viewToRestore(stored: string | null): string | null {
  return stored !== null && isViewQuery(stored) ? stored : null
}
