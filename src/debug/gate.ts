/**
 * Debug mode: `?debug=1`, the viewer's existing gate (it also shows the text overlays, the quality readout and the resolution map).
 * Never in a capture (`?still=1`, what captures and films use): a capture shows nothing but the picture. Kept apart from the registry so
 * the entry chunk can ask the question without loading the registry.
 */
export function debugEnabled(search: string): boolean {
  const q = new URLSearchParams(search)
  return q.get('debug') === '1' && q.get('still') !== '1'
}
