/**
 * The offline line: when the data host (tiles, manifest) cannot be reached and the browser says it is offline, one calm sentence says what
 * the visitor is looking at. It claims only what is true: the globe on screen is the bundled 4k map, and detail is not loading. It is never
 * shown for a failure while the browser reports a connection (that is a slow or broken host, which the existing retry captions cover).
 */
export const OFFLINE_TEXT = 'Offline: showing the built-in Moon. Detail returns when you are back online.'

export interface OfflineInputs {
  /** The viewer streams tiles at all (a build or page with no tile base has nothing to lose). */
  hasTileBase: boolean
  /** navigator.onLine !== false. */
  online: boolean
  /** The tile streamer's load failed (tilesState === 'failed'). */
  tilesFailed: boolean
  /** The first manifest request failed (after its own retries). */
  manifestFailed: boolean
}

/** Whether the offline line shows. */
export function offlineNoteVisible(s: OfflineInputs): boolean {
  return s.hasTileBase && !s.online && (s.tilesFailed || s.manifestFailed)
}
