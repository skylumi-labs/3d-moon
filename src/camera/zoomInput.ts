export interface WheelZoomInput { deltaY: number; deltaMode: number; ctrlKey: boolean }

/** Log-distance delta shared by canvas wheel input and browser trackpad pinch input. */
export function wheelZoomLogDelta(e: WheelZoomInput): number {
  const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
  return Math.max(-200, Math.min(200, dy)) * (e.ctrlKey ? 0.008 : 0.0012)
}

/** Safari reports pinch as an absolute gesture scale; convert each change to a zoom-in-positive log-distance delta. */
export function safariPinchLogDelta(previousScale: number, nextScale: number): number {
  if (!(previousScale > 0) || !(nextScale > 0)) return 0
  return Math.log(previousScale / nextScale)
}

/** Touch default prevention is limited to a real multi-touch gesture, leaving one-finger scrolling intact. */
export function shouldPreventTouchPageZoom(touchCount: number): boolean { return touchCount > 1 }
