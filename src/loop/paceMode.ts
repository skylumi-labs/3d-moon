/**
 * `?pace=` resolution (rest to motion). `PACE_ON` is the hard backpressure that fences every frame (gestures included); `PACE_REST` fences REST frames
 * only. Precedence, first match wins: an explicit `off`, `on`/`all` or `rest` is honoured on every class (a fence-class phone with `?pace=rest` gets rest pacing,
 * not the class default); no value falls back to the class (fence class: on; desktop class: rest pacing, the default since the rest-to-motion measurements of 2026-10-23; every other class: off). `?settle=stepped` implies rest pacing wherever full pacing is not already on
 * (full pacing fences rest frames too, so it is a superset).
 */
export interface PaceMode { on: boolean; rest: boolean }
export function resolvePace(param: string | null, fenceClass: boolean, settleStepped: boolean, desktopClass = false): PaceMode {
  const on = param === 'off' ? false : param === 'on' || param === 'all' ? true : param === 'rest' ? false : fenceClass
  return { on, rest: !on && (param === 'rest' || settleStepped || (param === null && desktopClass && !fenceClass)) }
}
