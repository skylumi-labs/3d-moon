export interface CaptureInitState {
  ready: boolean
  cancelled: boolean
}

/** A reserved capture pauses ordinary animation until initialization succeeds. */
export function captureIsInitializing(state: CaptureInitState | null): boolean {
  return !!state && !state.ready
}

/** Check after each resource wait so an end request during initialization is observed immediately. */
export function assertCaptureNotCancelled(state: CaptureInitState): void {
  if (state.cancelled) throw new Error('Capture initialization was cancelled')
}
