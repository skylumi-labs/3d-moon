/**
 * Android Back. Capacitor 8 registers no Back handling of its own, so the shell would leave on the first press
 * unless a listener decides. The order is: close what is open (through the same Escape path the desktop uses), else fly Home, else leave.
 */
export type BackAction = 'close' | 'home' | 'exit'

export function backAction(state: { overlayOpen: boolean; atHome: boolean }): BackAction {
  if (state.overlayOpen) return 'close'
  if (!state.atHome) return 'home'
  return 'exit'
}

/** The overlays Back can close: the panorama viewer, the bar's sheets, the notes panel and the Credits panel. */
export interface OverlayFlags { panorama: boolean; sheet: boolean; notes: boolean; credits: boolean }

/**
 * Which overlay Back closes, and how. The panorama viewer has its own close (it listens on its own element, not the window). The sheets,
 * the notes and Credits close through the Escape keydown the desktop sends (the window listeners in ui/bar, hud and main). Null: nothing is open.
 */
export function openOverlay(f: OverlayFlags): 'panorama' | 'escape' | null {
  if (f.panorama) return 'panorama'
  if (f.sheet || f.notes || f.credits) return 'escape'
  return null
}
