import { assertShareUrl } from './deepLink'
import type { HapticKind, NativeHost, NetworkStatus, Platform } from './host'

/** What the web host needs from the browser. Passed in, so a test runs the host without a browser. */
export interface WebEnv {
  /** The Web Share API, when the browser has it. */
  share?: (data: { url: string }) => Promise<void>
  /** The clipboard, the fallback for share on a browser without the Share API. */
  copy?: (text: string) => Promise<void>
  open: (url: string) => void
  /** Subscribes to tab visibility; the listener gets `hidden`. Returns the unsubscribe. */
  onVisibility: (listener: (hidden: boolean) => void) => () => void
  online: () => boolean
}

/** The browser implementation of NativeHost: the same interface, with the Web APIs. */
export function createWebHost(env: WebEnv = browserEnv()): NativeHost {
  const platform: Platform = 'web'
  return {
    isNative: () => false,
    platform: () => platform,
    async share(url: string): Promise<void> {
      assertShareUrl(url)
      if (env.share) {
        // The visitor cancelling the sheet is not an error.
        try { await env.share({ url }) } catch { /* cancelled */ }
      } else if (env.copy) await env.copy(url)
    },
    haptic: (_kind: HapticKind) => { /* no haptics on the web */ },
    async openExternal(url: string): Promise<void> {
      if (!/^https:\/\//.test(url)) throw new Error('Only https links open outside the viewer')
      env.open(url)
    },
    onResume: (listener) => env.onVisibility((hidden) => { if (!hidden) listener() }),
    onPause: (listener) => env.onVisibility((hidden) => { if (hidden) listener() }),
    async networkStatus(): Promise<NetworkStatus> {
      return { connected: env.online(), type: 'unknown' }
    },
    async launchQuery() { return null },
    onMemoryWarning: () => () => {},
    onAppUrl: () => () => {},
    onBackButton: () => () => {},
    // The browser's own Back navigates; a page cannot leave the site, so there is nothing to do here.
    exitApp: () => {},
  }
}

/** The real browser environment (the default). Not reached in tests. */
export function browserEnv(): WebEnv {
  return {
    share: typeof navigator !== 'undefined' && navigator.share ? (data) => navigator.share(data) : undefined,
    copy: typeof navigator !== 'undefined' && navigator.clipboard ? (text) => navigator.clipboard.writeText(text) : undefined,
    open: (url) => { window.open(url, '_blank', 'noopener') },
    onVisibility: (listener) => {
      const fn = () => listener(document.hidden)
      document.addEventListener('visibilitychange', fn)
      return () => document.removeEventListener('visibilitychange', fn)
    },
    online: () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
  }
}
