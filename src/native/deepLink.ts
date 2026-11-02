/**
 * Links into and out of the app. A universal link https://skylumi.org/3d-moon/?... opens the shell through the
 * App plugin's appUrlOpen (or as the launch URL on a cold start). Its query string becomes window.__moonQuery, which main.ts reads
 * exactly as it reads a page's own query, so a link and a web visit go through the same parsing. Share builds only these links, never
 * a custom scheme, so a shared view opens in the app when it is installed and on the website otherwise.
 */

const MOON_HOST = 'skylumi.org'
const MOON_PATH = '/3d-moon/'
/** The page a shared view links to (the website's address, never the shell's capacitor:// origin). */
export const MOON_PAGE = `https://${MOON_HOST}${MOON_PATH}`

/** True for an https://skylumi.org/3d-moon/ link (the page itself or anything under it), with no credentials or other port. */
export function isMoonLink(url: string): boolean {
  let u: URL
  try { u = new URL(url) } catch { return false }
  return u.protocol === 'https:' && u.hostname === MOON_HOST && u.port === '' && u.username === '' && u.password === ''
    && (u.pathname === MOON_PATH.slice(0, -1) || u.pathname.startsWith(MOON_PATH))
}

/**
 * The parameters a native start keeps: the view state shareView.ts writes (its shareParams, plus `auto`) and `moment`, the archive
 * moment a link names. Nothing else reaches the viewer, so a link cannot switch on a developer tool or a tuning knob (?debug, ?perfhud,
 * ?sampler, ?still, ?march, ?dpr, ?class and the rest). Scripts/native-links.test.mts pins this list.
 */
export const VIEW_QUERY_PARAMS: readonly string[] = ['auto', 't', 'pin', 'g', 'vp', 'view', 'fov', 'lon', 'lat', 'dist', 'roll', 'pitch', 'look', 'off', 'aim', 'moment', 'labels', 'start']

/** A query string (with its leading '?', or '') holding only the VIEW_QUERY_PARAMS, in that list's order. */
export function viewQueryOnly(query: string): string {
  const src = new URLSearchParams(query)
  const kept = new URLSearchParams()
  for (const k of VIEW_QUERY_PARAMS) {
    const v = src.get(k)
    if (v !== null) kept.append(k, v)
  }
  const out = kept.toString()
  return out ? `?${out}` : ''
}

/** The view query of a Moon link (with its leading '?', or ''), or null when the URL is not one. */
export function moonQueryOf(url: string | null | undefined): string | null {
  if (!url || !isMoonLink(url)) return null
  return viewQueryOnly(new URL(url).search)
}

/** Throws unless the URL is a Moon link: what the share sheet may carry. */
export function assertShareUrl(url: string): void {
  if (!isMoonLink(url)) throw new Error(`Only https://${MOON_HOST}${MOON_PATH} links are shared`)
}

/**
 * What a link that opens the running app does: a moment is played, a pose flies there, and anything else
 * leaves the view alone. The flight is the same one a pin or a moment selection makes (main.ts applyLinkInPlace), so no page reload.
 */
export type LinkRoute = { kind: 'moment'; id: string } | { kind: 'pose' } | { kind: 'none' }

/**
 * The steps a warm link runs before its flight, in order (pure, tested): the panorama viewer closes first (its frame loop is paused while it is
 * open), then the ground view is left (the flight starts from the orbit), then the fly. A link that changes nothing has no steps.
 */
export type WarmStep = 'closePanorama' | 'leaveGround' | 'fly'
export function warmLinkSteps(route: LinkRoute['kind'], panoramaOpen: boolean, groundActive: boolean): WarmStep[] {
  if (route === 'none') return []
  const out: WarmStep[] = []
  if (panoramaOpen) out.push('closePanorama')
  if (groundActive) out.push('leaveGround')
  out.push('fly')
  return out
}

/** The routing decision, as a pure function. `moment` names a known archive moment; else a full pose (lon, lat and dist) or a landing site (`pin`) flies. */
export function linkRoute(query: string, isMoment: (id: string) => boolean): LinkRoute {
  const p = new URLSearchParams(query)
  const moment = p.get('moment')
  if (moment !== null && isMoment(moment)) return { kind: 'moment', id: moment }
  const pose = ['lon', 'lat', 'dist'].every((k) => p.get(k) !== null && Number.isFinite(Number(p.get(k))))
  if (pose || p.get('pin') !== null) return { kind: 'pose' }
  return { kind: 'none' }
}
