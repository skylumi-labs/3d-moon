/**
 * Native start, before main.ts reads its parameters (main.ts awaits this only in a native build). The query the page starts with is,
 * in order: the launch link, the last saved view
 * (lifecycle.ts), else none. The result goes to window.__moonQuery, which main.ts reads when the page has no query of its own.
 */
import { viewQueryOnly } from './deepLink'
import { LOST_RELOADS_KEY } from '../quality/contextRecovery'
import { loadNativeHost, type NativeHost } from './host'

/**
 * Owner decision 2026-10-17: an app launch starts at Home. The saved view (lifecycle.ts) is no longer restored: restoring it relaunched straight
 * into the Apollo 17 ground view that had lost the GPU context (issue #206). A launch link the visitor tapped still opens its view, except
 * on the reload a context loss caused (`safeStart`): that one always comes up at Home, whatever the link was.
 */
export async function bootNative(_store: Pick<Storage, 'getItem' | 'removeItem'> = localStorage, load: () => Promise<NativeHost> = loadNativeHost, safeStart: () => boolean = () => safely(() => sessionStorage.getItem(LOST_RELOADS_KEY) !== null, false)): Promise<NativeHost> {
  const host = await load()
  if (!host.isNative()) return host
  if (safeStart()) return host
  const launch = await host.launchQuery().catch(() => null)
  // Every source passes the view allowlist (deepLink.ts VIEW_QUERY_PARAMS): a link is no more trusted than a stored query was.
  if (launch !== null) (window as { __moonQuery?: string }).__moonQuery = viewQueryOnly(launch)
  return host
}

/** Storage can throw (a private window, cleared site data): a failed read starts the app at its default, never fails the start. */
function safely<T>(read: () => T, fallback: T): T {
  try { return read() } catch { return fallback }
}
