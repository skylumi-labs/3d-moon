/**
 * One gate for the runtime data-base overrides (?tiles=, ?patch=, ?midpatch=, ?horizons=, ?tc=).
 *
 * Without it a link such as `.../moon/index.html?tiles=https://other.example/t/&patch=...` renders someone else's terrain and imagery
 * under the viewer's title, credits and watermark. The bucket cannot send a CSP header, so the viewer checks the origin itself.
 *
 * A production build accepts an override only when it resolves to
 *   - a base under one of the build's data origins (VITE_MOON_DATA_ORIGINS, comma-separated base URLs such as
 *     https://storage.googleapis.com/<bucket>/; an origin-relative entry such as /<bucket>/ resolves against the page; empty by default),
 *   - a loopback host (localhost, 127.0.0.1, [::1]) on any port, which is what the dev server and the GPU rig use, or
 *   - the build's own configured base (the value of VITE_MOON_* the build baked in).
 * Anything else is refused (the layer stays off) and a warning names the parameter. The dev server accepts any base.
 * The publish scripts set VITE_MOON_DATA_ORIGINS to the project bucket; a build without it allows loopback and its own bases only.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The build's data origins: VITE_MOON_DATA_ORIGINS split on commas and whitespace, blanks dropped. */
export function parseDataOrigins(raw: string | undefined): string[] {
  return (raw ?? '').split(/[\s,]+/).filter(Boolean)
}
const BUILD_DATA_ORIGINS: readonly string[] = parseDataOrigins(import.meta.env?.VITE_MOON_DATA_ORIGINS as string | undefined)

export interface DataBaseEnv {
  /** The page's origin and hostname; defaults to `location`. Absent (Node) means no page, so only absolute URLs can pass. */
  origin?: string
  hostname?: string
  /** True on the dev server, where any base is allowed. */
  dev?: boolean
  /** Bases an override may fall under besides loopback and the configured base; defaults to the build's VITE_MOON_DATA_ORIGINS. */
  origins?: readonly string[]
}

function pageEnv(): { origin: string; hostname: string } | null {
  const l = (globalThis as { location?: { origin?: string; hostname?: string } }).location
  return l?.origin && l.hostname !== undefined ? { origin: l.origin, hostname: l.hostname } : null
}

/** Is this override base allowed? `configured` is the build's own base for the same layer ('' when none). */
export function dataBaseAllowed(raw: string, configured = '', env: DataBaseEnv = {}): boolean {
  const dev = env.dev ?? Boolean(import.meta.env?.DEV)
  if (dev) return true
  const page = env.origin !== undefined ? { origin: env.origin, hostname: env.hostname ?? '' } : pageEnv()
  let url: URL
  try { url = new URL(raw, page?.origin) } catch { return false }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (url.username || url.password) return false
  if (LOOPBACK.has(url.hostname)) return url.protocol === 'http:' || url.protocol === 'https:'
  // An origin-relative path resolves against the page, so with the page on the bucket origin /<bucket>/... is the same thing as the absolute URL.
  return [...(env.origins ?? BUILD_DATA_ORIGINS), ...(configured ? [configured] : [])].some((base) => under(url, base, page?.origin))
}

/** Is `url` on `base`'s origin and inside its path? An unparsable base allows nothing. */
function under(url: URL, base: string, pageOrigin: string | undefined): boolean {
  try {
    const b = new URL(base, pageOrigin)
    return url.origin === b.origin && url.pathname.startsWith(b.pathname.endsWith('/') ? b.pathname : `${b.pathname}/`)
  } catch { return false }
}

/**
 * Resolve a data base from an optional `?name=` override and the build default. Returns null for off ('', 'off', '0') or a refused override.
 * A refused override does NOT fall back to the default: the visitor asked for something else, so the layer stays off and a warning says why.
 */
export function resolveDataBase(name: string, override: string | null, configured: string, env: DataBaseEnv = {}): string | null {
  const raw = override === null ? configured : override
  if (raw === '' || raw === 'off' || raw === '0') return null
  if (override !== null && !dataBaseAllowed(override, configured, env)) {
    console.warn(`?${name}= ignored: ${JSON.stringify(override)} is not an allowed data origin (the build's data origins, localhost or the build's own base)`)
    return null
  }
  return raw.endsWith('/') ? raw : `${raw}/`
}
