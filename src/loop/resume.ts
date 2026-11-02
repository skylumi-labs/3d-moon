/**
 * Coming back to the page after it was hidden (Android Chrome: switching apps and returning): what the page looks like, as pure decisions.
 * An owner's report showed an entirely black canvas with the zoom tape at the far limit; nothing recorded why. main.ts gathers the figures once,
 * 1.5 s after the page is shown again (never per frame, no pixel readback), and sends one telemetry event when the picture looks blank.
 */

/** After pageshow / visibilitychange to visible, how long the page gets to draw before it is judged (ms). */
export const RESUME_CHECK_MS = 1500
/** A hidden spell shorter than this is not a resume worth judging (a notification shade, a quick app switch). */
export const RESUME_MIN_HIDDEN_MS = 1000
/** No frame drawn for this long while the loop is meant to be awake is a stalled loop. */
export const FRAME_STALE_MS = 1500
/** A white point (I/F) outside this range is not an exposure anyone chose: it blanks the picture (all black below, all white above). */
export const WHITE_MIN = 1e-6
export const WHITE_MAX = 1e3

export interface ResumeInfo {
  /** Context losses and soft restores this session (api.contextLosses / contextRestores). */
  contextLosses: number
  contextRestores: number
  /** The page's own flag: a loss it knows about and has not recovered from. */
  contextLost: boolean
  /** gl.isContextLost() now: true while `contextLost` is false is a loss whose event never reached the page. */
  glLost: boolean
  /** How long the page was hidden, ms (0 when unknown). */
  hiddenMs: number
  /** The camera's distance from the Moon's centre in radii, from the last drawn frame (null before the first). */
  camDist: number | null
  /** The Moon's disc touches the frame (null when no frame has been drawn). */
  moonOnScreen: boolean | null
  exposureWhite: number | null
  exposureHdr: number | null
  loopRunning: boolean
  /** The loop is asleep on purpose (src/loop/idle.ts); a sleeping loop draws nothing and is not stalled. */
  idleSleeping: boolean
  /** Age of the last drawn frame at the time of the check, ms (null: none yet). */
  lastFrameAgeMs: number | null
  /** The document is visible at the check. */
  visible: boolean
}

export type ResumeReason =
  | 'context-lost-unnoticed' | 'context-lost' | 'loop-stopped' | 'frame-stale' | 'moon-off-screen' | 'exposure-invalid'

export interface ResumeVerdict { blank: boolean; reasons: ResumeReason[] }

/**
 * Whether the Moon's disc reaches the frame: the angle from the view axis to the disc's nearest edge (centre angle minus its angular radius)
 * is inside the frame's half diagonal. `offAxisRad` is the angle to the Moon's centre, `dist` the camera's distance from it in radii.
 */
export function moonDiscOnScreen(offAxisRad: number, dist: number, tanHalf: number, aspect: number): boolean {
  if (![offAxisRad, dist, tanHalf, aspect].every(Number.isFinite) || dist <= 0 || tanHalf <= 0 || aspect <= 0) return false
  const discRad = dist <= 1 ? Math.PI / 2 : Math.asin(1 / dist)
  const halfDiag = Math.atan(tanHalf * Math.hypot(1, aspect))
  return offAxisRad - discRad <= halfDiag
}

/** Whether a white point / hdr pair is a usable exposure. */
export function exposureUsable(white: number | null, hdr: number | null): boolean {
  if (white === null) return true // no frame yet: nothing to judge
  if (!Number.isFinite(white) || white < WHITE_MIN || white > WHITE_MAX) return false
  return hdr === null || Number.isFinite(hdr)
}

/**
 * What a resume check found. `blank` means the picture is probably black (or frozen): the reasons say why. A hidden check, or a spell too short
 * to matter, is never blank. A page with no unexplained cause (the Moon in frame, a drawing loop, a usable exposure) is not blank.
 */
export function classifyResume(i: ResumeInfo): ResumeVerdict {
  const reasons: ResumeReason[] = []
  if (!i.visible || i.hiddenMs < RESUME_MIN_HIDDEN_MS) return { blank: false, reasons }
  if (i.glLost && !i.contextLost) reasons.push('context-lost-unnoticed')
  else if (i.contextLost) reasons.push('context-lost')
  if (!i.contextLost && !i.loopRunning && !i.idleSleeping) reasons.push('loop-stopped')
  else if (!i.contextLost && !i.idleSleeping && i.lastFrameAgeMs !== null && i.lastFrameAgeMs > FRAME_STALE_MS) reasons.push('frame-stale')
  if (i.moonOnScreen === false) reasons.push('moon-off-screen')
  if (!exposureUsable(i.exposureWhite, i.exposureHdr)) reasons.push('exposure-invalid')
  return { blank: reasons.length > 0, reasons }
}
