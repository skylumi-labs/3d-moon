/**
 * The shell's lifecycle, Back and links, wired to the viewer through the callbacks in ShellDeps (main.ts supplies them, so this file
 * holds the policy and no viewer state).
 *
 */
import { moonQueryOf } from './deepLink'
import { backAction } from './back'
import type { NativeHost, NetworkStatus } from './host'
import { LAST_VIEW_KEY, VIEW_SAVE_MS, viewToSave } from './lifecycle'

export interface ShellDeps {
  /** Background: stop the frame loop and abort the tile requests in flight. */
  onPause(): void
  /** Foreground: restart the loop, recover a lost context, redraw. */
  onResume(): void
  onNetwork(status: NetworkStatus): void
  /** A sheet, the notes or another overlay is open (read only). */
  overlayOpen(): boolean
  atHome(): boolean
  /** Closes the open overlay through the Escape path (the same keydown the desktop sends). */
  closeOverlay(): void
  goHome(): void
  /** The current view's query string, as Share would write it. */
  currentView(): string
  store: Pick<Storage, 'setItem'>
  /** A Moon link opened the running app: the viewer plays its moment or flies to its pose in place (main.ts applyLinkInPlace). */
  applyLink(query: string): void
}

/** Wires the shell to the viewer; returns the teardown. */
export function wireNativeShell(host: NativeHost, deps: ShellDeps): () => void {
  const offs = [
    host.onPause(() => deps.onPause()),
    host.onResume(() => {
      deps.onResume()
      void host.networkStatus().then(deps.onNetwork, () => undefined)
    }),
    host.onBackButton(() => {
      const action = backAction({ overlayOpen: deps.overlayOpen(), atHome: deps.atHome() })
      if (action === 'close') deps.closeOverlay()
      else if (action === 'home') deps.goHome()
      else host.exitApp()
    }),
    host.onAppUrl((url) => {
      const q = moonQueryOf(url)
      if (q !== null) deps.applyLink(q)
    }),
  ]
  // The view is saved only when it changes (viewToSave); a full store or a failed write just skips a save.
  let last: string | null = null
  const timer = setInterval(() => {
    const next = viewToSave(last, deps.currentView())
    if (next === null) return
    try { deps.store.setItem(LAST_VIEW_KEY, next); last = next } catch { /* storage full or blocked */ }
  }, VIEW_SAVE_MS)
  return () => { for (const off of offs) off(); clearInterval(timer) }
}
