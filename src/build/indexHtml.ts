/**
 * Build-time fill-in for index.html (vite.config.ts runs it as a transformIndexHtml hook, on the dev server and in every build).
 *
 *   %MOON_TELEMETRY_CONNECT%  in the CSP connect-src: the telemetry hosts of the build's keys (telemetryHosts.ts), or nothing.
 *                             A build without keys ships a CSP that names no Sentry or PostHog host.
 *   %MOON_PAGE_TITLE%         the page title from src/branding.ts.
 *   %MOON_PRODUCT_NAME%       the product name; %MOON_SITE_URL% the public address (with its trailing slash); %MOON_SITE_ORIGIN% its origin
 *                             with a trailing slash. The launch head (title, Open Graph, JSON-LD, noscript) is written with these, so a fork
 *                             rebrands in src/branding.ts alone. Inside the JSON-LD block the values are JSON-escaped, elsewhere HTML-escaped.
 *
 * Pure (no Node or DOM), so scripts/csp-meta.test.mts checks the policy a build writes without running Vite.
 */
import { PAGE_TITLE, PRODUCT_NAME, SITE_URL } from '../branding'
import { telemetryConnectHosts } from './telemetryHosts'

export interface IndexHtmlEnv { VITE_SENTRY_DSN?: string; VITE_POSTHOG_KEY?: string; VITE_POSTHOG_HOST?: string }

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const SITE_ORIGIN = `${new URL(SITE_URL).origin}/`
const BRAND: ReadonlyArray<readonly [string, string]> = [
  ['%MOON_PAGE_TITLE%', PAGE_TITLE], ['%MOON_PRODUCT_NAME%', PRODUCT_NAME], ['%MOON_SITE_URL%', SITE_URL], ['%MOON_SITE_ORIGIN%', SITE_ORIGIN],
]
const jsonEscape = (s: string): string => JSON.stringify(s).slice(1, -1).replace(/</g, '\\u003c')
const fill = (text: string, esc: (s: string) => string): string => BRAND.reduce((t, [k, v]) => t.replaceAll(k, esc(v)), text)
const LD_JSON = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g

export function renderIndexHtml(html: string, env: IndexHtmlEnv): string {
  if (!html.includes(' %MOON_TELEMETRY_CONNECT%') || BRAND.some(([k]) => !html.includes(k))) throw new Error('index.html: a build placeholder is missing (src/build/indexHtml.ts)')
  const hosts = telemetryConnectHosts({ sentryDsn: env.VITE_SENTRY_DSN, posthogKey: env.VITE_POSTHOG_KEY, posthogHost: env.VITE_POSTHOG_HOST })
  const withHosts = html.replaceAll(' %MOON_TELEMETRY_CONNECT%', hosts.map((h) => ` ${h}`).join(''))
  const parts: string[] = []
  let last = 0
  for (const m of withHosts.matchAll(LD_JSON)) {
    parts.push(fill(withHosts.slice(last, m.index), escapeHtml), m[1], fill(m[2], jsonEscape), m[3])
    last = m.index + m[0].length
  }
  parts.push(fill(withHosts.slice(last), escapeHtml))
  return parts.join('')
}
