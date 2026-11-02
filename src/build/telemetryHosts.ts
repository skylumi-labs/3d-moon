/**
 * The telemetry hosts a build talks to, derived from its keys. A leaf with no imports: vite.config.ts reads it through indexHtml.ts at build
 * time, and telemetry/boot.ts takes the PostHog default from here (src/telemetry itself stays lazy-only, scripts/telemetry.test.mts).
 */

/** PostHog's US ingest host, used when a build has a PostHog key and no VITE_POSTHOG_HOST. */
export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'

/**
 * The origins the page's CSP connect-src must allow for the build's keys: the PostHog host when there is a PostHog key, then the Sentry
 * ingest host of the DSN. No keys, no hosts. A DSN or host that is not an absolute https URL fails the build.
 */
export function telemetryConnectHosts(keys: { sentryDsn?: string; posthogKey?: string; posthogHost?: string }): string[] {
  const origin = (what: string, raw: string): string => {
    let u: URL
    try { u = new URL(raw) } catch { throw new Error(`telemetry: ${what} is not an absolute URL`) }
    if (u.protocol !== 'https:') throw new Error(`telemetry: ${what} must be https`)
    return u.origin
  }
  const hosts: string[] = []
  if (keys.posthogKey) hosts.push(origin('VITE_POSTHOG_HOST', keys.posthogHost || DEFAULT_POSTHOG_HOST))
  if (keys.sentryDsn) hosts.push(origin('VITE_SENTRY_DSN', keys.sentryDsn))
  return hosts
}
