/** URL keys that name a view (a shared link, a pin, a moment, the archive's openings): such a link opens on its view, with no intro. */
export const VIEW_KEYS = ['view', 'look', 'start', 'moment', 'lon', 'lat', 'dist', 'roll', 'pin', 'off', 'g'] as const

/**
 * Whether this visit starts with the splash and the flyby (controller.ts). It is for a person opening the page itself:
 * `?intro=0` turns it off and `?intro=1` turns it on whatever else holds; otherwise a link that names a view opens on that
 * view, and an automated browser (the GPU rig, the audits, Playwright: navigator.webdriver) gets the page as before, so
 * every measurement that opens the bare page keeps measuring the same thing.
 */
export function introWanted(params: URLSearchParams, automated: boolean, afterLoss = false): boolean {
  // The reload a lost GPU context caused (issue #206) never puts the splash up, ?intro=1 included: the splash hid the page's own messages
  // ("Restoring…", "could not be restored") behind itself, and a second loss under it left the visitor on the splash with nothing said.
  if (afterLoss) return false
  const flag = params.get('intro')
  if (flag === '0') return false
  if (flag === '1') return true
  if (automated) return false
  return !VIEW_KEYS.some((k) => params.has(k))
}

/** URL keys that only name an open overlay: they must leave the address when the overlay closes, or a reload reopens it (review F15). */
export const OVERLAY_KEYS = ['panorama'] as const

/** `href` without the overlay keys; the same string when it carries none. */
export function stripOverlayParams(href: string): string {
  const u = new URL(href)
  let hit = false
  for (const k of OVERLAY_KEYS) if (u.searchParams.has(k)) { u.searchParams.delete(k); hit = true }
  return hit ? u.toString() : href
}

/** "812 KB" / "1.4 MB" for a count of bytes actually received (review F4: real bytes, never a made-up percentage). */
export function formatLoaded(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
/** The loading line's progress: bytes while every finished download reports its size; once one hides it (cross-origin without Timing-Allow-Origin), the file count, which stays true. */
export function loadedLabel(bytes: number, files: number, opaque: number): string {
  if (opaque > 0) return `${files} ${files === 1 ? 'file' : 'files'} loaded`
  return `${formatLoaded(bytes)} loaded`
}
