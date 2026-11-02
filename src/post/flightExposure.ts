/**
 * `?flightexposure=coarse|full`: the exposure search of a scripted flight. Today a flight runs the FULL search (56 rows, relief lift, 13x13 refinement, about 8 to 10 ms) every 66 ms
 * or longer, and its memo never hits because the camera moves and the relief field bumps its version with every tile. `coarse` runs the 20-row search that user gestures use, corrected
 * by its own `CoarseGain` (one full search next to it every 250 ms), and reuses the last answer while the camera has barely moved. `full` (the default) is today's behaviour exactly.
 * Rest frames are never touched: a frame at rest always runs the full search.
 */
export type FlightExposureMode = 'coarse' | 'full'
export function parseFlightExposureMode(v: string | null): FlightExposureMode { return v === 'coarse' ? 'coarse' : 'full' }

/** A flight reuses its last search for up to this long while the camera has barely moved (ms). The gain is re-measured at the same pace (COARSE_GAIN_REFRESH_MS). */
export const FLIGHT_EXP_REUSE_MS = 250
/** "Barely moved": the same test as the flight's wanted-set reuse (`flightReuseWanted`): the view turned less than this share of the half-field, and the altitude changed less than 5 %. */
export const FLIGHT_EXP_TURN = 0.15
export const FLIGHT_EXP_ALT = 0.05

export interface ExposureView {
  /** The camera's back axis (the view looks along -back). */
  back: { x: number; y: number; z: number }
  tanHalf: number
  /** Height above the surface, Moon radii (distance from the centre minus 1). */
  alt: number
}

/** True when the camera of `cur` is close enough to the one `prev` was searched at for the old answer to stand. */
export function exposureViewMoveSmall(prev: ExposureView | null, cur: ExposureView): boolean {
  if (!prev) return false
  if (Math.abs(cur.tanHalf - prev.tanHalf) > 1e-6 * Math.max(1, Math.abs(prev.tanHalf))) return false
  const len = (v: ExposureView['back']): number => Math.hypot(v.x, v.y, v.z)
  const dot = cur.back.x * prev.back.x + cur.back.y * prev.back.y + cur.back.z * prev.back.z
  const angle = Math.acos(Math.max(-1, Math.min(1, dot / Math.max(1e-12, len(cur.back) * len(prev.back)))))
  return angle <= FLIGHT_EXP_TURN * cur.tanHalf && Math.abs(cur.alt - prev.alt) <= FLIGHT_EXP_ALT * Math.max(1e-9, Math.abs(prev.alt))
}

/**
 * Does this frame use the coarse flight search? Only in `coarse` mode, in a scripted flight (tween, cinematic flight, route flight, orbit journey) that is moving, on a frame that is not a capture,
 * not a declared exposure cut, and not owned by the ridge, ground mode or the Apollo descent.
 */
export function useCoarseFlightExposure(o: { mode: FlightExposureMode; flightLike: boolean; gestureOn: boolean; captureSession: boolean; cutFrames: number; ownsExposure: boolean; groundMode: boolean; coarseGainOn: boolean }): boolean {
  return o.mode === 'coarse' && o.coarseGainOn && o.flightLike && o.gestureOn && !o.captureSession && o.cutFrames === 0 && !o.ownsExposure && !o.groundMode
}

/** The reuse window: the existing one, or up to FLIGHT_EXP_REUSE_MS while the coarse flight search holds and the camera has barely moved. */
export function flightExposureWindowMs(baseMs: number, coarseFlight: boolean, moveSmall: boolean): number {
  return coarseFlight && moveSmall ? Math.max(baseMs, FLIGHT_EXP_REUSE_MS) : baseMs
}
