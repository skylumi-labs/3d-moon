/**
 * The one interface the viewer uses for anything the shell provides. The website gets webHost.ts. A native
 * build injects its own host through the virtual module `virtual:moon-native-host` (nativeHostDefault.ts), which only the native
 * build (native/scripts/build.mts) resolves, so the web package has no Capacitor dependency and its bundle carries no shell code.
 * Nothing else in the viewer knows which host it has.
 */
import { createWebHost } from './webHost'

export type Platform = 'web' | 'ios' | 'android'
export type HapticKind = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection'
export interface NetworkStatus { connected: boolean; type: 'wifi' | 'cellular' | 'none' | 'unknown' }

export interface NativeHost {
  /** True only in the shell on iOS or Android (isNativeGate). A browser, even on a phone, is not the shell. */
  isNative(): boolean
  platform(): Platform
  /** Opens the system share sheet. Only https://skylumi.org/3d-moon/ links are shared (deepLink.ts). */
  share(url: string): Promise<void>
  haptic(kind: HapticKind): void
  /** Opens an https URL outside the viewer. */
  openExternal(url: string): Promise<void>
  /** Runs when the app comes to the foreground; returns the unsubscribe. */
  onResume(listener: () => void): () => void
  /** Runs when the app goes to the background; returns the unsubscribe. */
  onPause(listener: () => void): () => void
  networkStatus(): Promise<NetworkStatus>
  /** The query of the Moon link the app was launched with (a cold start), or null. */
  launchQuery(): Promise<string | null>
  /** Runs for each Moon link that opens the running app (appUrlOpen); returns the unsubscribe. */
  onAppUrl(listener: (url: string) => void): () => void
  /** Android Back. Once a listener is registered the shell no longer leaves the app on Back by itself; the listener decides. */
  onBackButton(listener: () => void): () => void
  /** Leaves the app (Android Back at Home with nothing open). */
  exitApp(): void
  /** The OS is short of memory (iOS didReceiveMemoryWarning, Android: onTrimMemory below API 34, a foreground getMemoryInfo poll from 34); returns the unsubscribe. */
  onMemoryWarning(listener: () => void): () => void
}

/**
 * The native gate, SkyLumi's rule (the native host applies it): Capacitor reports a native platform AND the platform is ios or android. A WebView user agent is
 * not proof of the shell, so the gate reads Capacitor, never the user agent.
 */
export function isNativeGate(input: { nativePlatform: boolean; platform: string }): boolean {
  return input.nativePlatform && (input.platform === 'ios' || input.platform === 'android')
}

/**
 * The host for this page. A native build (`VITE_NATIVE_BUILD=true`) tries the injected native host first and falls back to the web
 * host when it returns null (the gate is false: a native build opened in a browser, such as the dev server, is the web). The web
 * build drops this branch, so it never resolves the virtual module.
 */
export async function loadNativeHost(): Promise<NativeHost> {
  if (import.meta.env?.VITE_NATIVE_BUILD === 'true') {
    const { createNativeHost } = await import('virtual:moon-native-host')
    const native = await createNativeHost()
    if (native) return native
  }
  return createWebHost()
}
