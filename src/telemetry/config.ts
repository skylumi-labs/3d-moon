/**
 * Telemetry switches and scrubbing: pure, no imports, no SDK. Everything here is unit-tested (scripts/telemetry.test.mts).
 */

export interface TelemetryKeys { sentryDsn: string; posthogKey: string; posthogHost: string }

export interface DecisionInput {
  /** The page query string (location.search, or the artifact preview's window.__moonQuery). */
  search: string
  hostname: string
  /** navigator.webdriver: true on the GPU rig and any automated browser. */
  webdriver: boolean
  keys: Partial<TelemetryKeys>
  /** The native shell (iOS or Android app): the page is served from capacitor://localhost or https://localhost, which is the app itself, not local work. */
  native?: boolean
}
export interface Decision { on: boolean; reason: string; sentry: boolean; posthog: boolean }

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$|\.localhost$|\.test$/

/** Whether telemetry may run on this page, and why not. Off without keys, with ?telemetry=0, on a local host, in an automated browser and for ?sampler=1 recordings (unless ?telemetry=1). */
export function decideTelemetry(i: DecisionInput): Decision {
  const q = new URLSearchParams(i.search)
  const sentry = !!i.keys.sentryDsn
  const posthog = !!i.keys.posthogKey
  const off = (reason: string): Decision => ({ on: false, reason, sentry: false, posthog: false })
  if (!sentry && !posthog) return off('no keys')
  if (q.get('telemetry') === '0') return off('?telemetry=0')
  if (!i.native && LOCAL_HOST.test(i.hostname)) return off('local host')
  if (i.webdriver) return off('automated browser')
  if (q.get('sampler') === '1' && q.get('telemetry') !== '1') return off('?sampler=1 recording')
  return { on: true, reason: 'on', sentry, posthog }
}

/** Switches that change performance and may be sent as a super-property. Names only from this list; values must be short and plain. */
export const PERF_SWITCHES = [
  'bands', 'bandms', 'coarsegain', 'fastfirst', 'fixedshare', 'flightexposure', 'flightscale', 'gpusource', 'gputimer', 'motiongrid', 'motionlite',
  'motionscale', 'nextprefetch', 'noearth', 'nosun', 'pace', 'pacelight', 'paceold', 'preexpose', 'pshcache', 'relief', 'restbudget', 'restcache',
  'shcache', 'shmotion', 'shprobe', 'targetcache', 'termaa', 'tier', 'wall', 'stars', 'tc', 'dpr', 'restdpr', 'class', 'passes', 'intro', 'focuspull',
] as const

const SHORT_VALUE = /^[a-z0-9.-]{0,12}$/i

/** Only the known perf switches that are set, with plain short values. Never the camera pose, a date or any free text from the query. */
export function activeSwitches(search: string): Record<string, string> {
  const out: Record<string, string> = {}
  const q = new URLSearchParams(search)
  for (const name of PERF_SWITCHES) {
    const v = q.get(name)
    if (v !== null && SHORT_VALUE.test(v)) out[name] = v
  }
  return out
}

/** Keeps only the path: a URL with its query and fragment removed (the query holds the camera pose and dates). */
export function scrubUrl(url: string): string {
  if (typeof url !== 'string' || !url) return ''
  const cut = url.search(/[?#]/)
  return cut < 0 ? url : url.slice(0, cut)
}

/** Latitude and longitude rounded to 1 degree. null for anything not finite (never invented). */
export function coarsePose(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { lat: Math.round(lat), lon: Math.round(lon) }
}

/** 'native' in the app shells, 'site' for the published site (/3d-moon/ base) and 'preview' for the bucket preview and anything else. */
export function environmentFor(pathname: string, native = false): 'site' | 'preview' | 'native' {
  if (native) return 'native'
  return /^\/3d-moon(\/|$)/.test(pathname) ? 'site' : 'preview'
}

/** The active switches as one plain string for a super-property ("bands:off,tier:1"). */
export function switchesLabel(sw: Record<string, string>): string {
  return Object.keys(sw).sort().map((k) => `${k}:${sw[k]}`).join(',')
}

/** Removes URL query strings and fragments from every string value whose key mentions a url, href or referrer (PostHog adds $current_url, $referrer and friends to each event). Mutates and returns props. */
export function scrubUrlProps(props: Record<string, unknown>): Record<string, unknown> {
  for (const k of Object.keys(props)) {
    const v = props[k]
    if (typeof v === 'string' && /url|referrer|href/i.test(k)) props[k] = scrubUrl(v)
    else if (v && typeof v === 'object' && !Array.isArray(v)) scrubUrlProps(v as Record<string, unknown>)
  }
  return props
}

/** Device class for slicing: the app's own startup class when known, else a coarse pointer/width guess. */
export function deviceClass(cls: unknown, coarsePointer: boolean, shortSide: number): string {
  if (typeof cls === 'string' && cls) return cls
  if (coarsePointer) return shortSide >= 700 ? 'tablet' : 'phone'
  return 'desktop'
}
