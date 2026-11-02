/**
 * After a GPU reset in the native app (issue #206): never reload into a page that cannot get a WebGL context.
 *
 * On the Pixel 10 Pro XL (Imagination PowerVR) the Apollo 17 ground view reset the GPU (`GL_UNKNOWN_CONTEXT_RESET_KHR`). Chromium then
 * blocks WebGL for the origin for a while, so the reload the loss watchdog used to make came up on "This page needs WebGL2, and the browser
 * could not create a context", a dead end. In the app, the page now first asks for a throwaway WebGL2 context: only when one is granted does
 * it reload (at Home, native/boot.ts). Otherwise it shows a message with a Try again button that waits RETRY_WAIT_MS, asks again, and reloads
 * only when the context is granted. The website keeps its reload (a desktop browser shows its own prompt for a blocked page).
 *
 * Pure apart from the injected dependencies: scripts/gpu-reset-recovery.test.mts drives it with a fake clock and probe.
 */

/** How long Try again waits before it asks for a context again (ms): Chromium's block is not lifted by an immediate retry (on the Pixel 10 Pro XL it lifted about 100 s after the reset, one measurement). */
export const RETRY_WAIT_MS = 4000

export const RESET_MESSAGE = 'The graphics processor stopped responding, and Android has paused 3D graphics for this app. This can take a minute or two.'
export const BLOCKED_MESSAGE = '3D graphics are still paused. Try again in a minute, or close the app and open it again.'
export const RESTARTING_MESSAGE = 'Restarting at Home…'
export const RETRY_LABEL = 'Try again'
/** The first message when the app could not create its context at start (a reload after a reset, or 3D refused for another reason). */
export const START_MESSAGE = '3D graphics are not available to the app right now. This can follow a graphics processor reset and can take a minute or two to pass.'

/** What a loss that would reload does instead: reload, or show the retry card. Only the native app checks first. */
export function lossExit(native: boolean, contextAvailable: boolean): 'reload' | 'retry' {
  return native && !contextAvailable ? 'retry' : 'reload'
}

/** What the card shows: the message, the button label (null: no button) and whether the button is disabled (a wait in progress). */
export interface RetryView { message: string; button: string | null; busy: boolean }

export interface RetryDeps {
  /** True when a fresh WebGL2 context can be created now (probeWebGL2 in the page). */
  probe(): boolean
  /** Reload the viewer (at Home). Called at most once. */
  reload(): void
  /** Draw the card. */
  render(view: RetryView): void
  schedule(fn: () => void, ms: number): void
}

export type RetryPhase = 'idle' | 'shown' | 'waiting' | 'blocked' | 'reloading'

export interface RetryController {
  /** Shows the card with its first message (default RESET_MESSAGE): the context was just found unavailable. */
  show(message?: string): void
  /** The Try again button: ignored while waiting or reloading. */
  press(): void
  readonly phase: RetryPhase
  readonly tries: number
}

export function createRetry(deps: RetryDeps, waitMs = RETRY_WAIT_MS): RetryController {
  let phase: RetryPhase = 'idle'
  let tries = 0
  let first = RESET_MESSAGE
  const check = (): void => {
    tries++
    if (deps.probe()) {
      phase = 'reloading'
      deps.render({ message: RESTARTING_MESSAGE, button: null, busy: true })
      deps.reload()
      return
    }
    phase = 'blocked'
    deps.render({ message: BLOCKED_MESSAGE, button: RETRY_LABEL, busy: false })
  }
  return {
    show(message = RESET_MESSAGE): void {
      if (phase !== 'idle') return
      phase = 'shown'
      first = message
      deps.render({ message, button: RETRY_LABEL, busy: false })
    },
    press(): void {
      if (phase !== 'shown' && phase !== 'blocked') return
      phase = 'waiting'
      deps.render({ message: `${tries > 0 ? BLOCKED_MESSAGE : first}\nChecking again in ${Math.round(waitMs / 1000)} s…`, button: RETRY_LABEL, busy: true })
      deps.schedule(check, waitMs)
    },
    get phase() { return phase },
    get tries() { return tries },
  }
}

/** Minimal canvas surface the probe needs (a DOM canvas in the page, a fake in the test). */
export interface ProbeCanvas { getContext(kind: 'webgl2'): { isContextLost(): boolean; getExtension(name: string): unknown } | null }

/**
 * Whether a WebGL2 context can be created now: a throwaway canvas asks for one, checks that it is live, and gives it back at once
 * (WEBGL_lose_context) so the viewer's own context is not competing with it. Any throw counts as unavailable.
 */
export function probeWebGL2(make: () => ProbeCanvas): boolean {
  try {
    const gl = make().getContext('webgl2')
    if (!gl) return false
    const ok = !gl.isContextLost()
    try { (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext() } catch { /* releasing is a courtesy */ }
    return ok
  } catch {
    return false
  }
}
