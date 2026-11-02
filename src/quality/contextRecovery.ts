/**
 * WebGL context loss: what the page does after it, as pure decisions (issue #206). main.ts executes them.
 *
 * Android WebView on a PowerVR phone lost the context in the Apollo 17 ground view and the soft recovery never finished (a white canvas
 * until force-stop). Three rules follow:
 *  1. Whatever the page was holding is re-created at a LOWER ceiling (quality.contextLost() already lowered it; recovery uses that figure,
 *     never the class profile's).
 *  2. In the native app the soft path (re-create maps, tiles and baked horizon in place) is only for a loss while nothing with its own GPU
 *     resources is on screen (no ground view, no site patch). Otherwise, or on a second loss, the page reloads the viewer state at the lowered
 *     ceiling. The website always tries the soft path first, as main did (the ground/patch rule was measured on the Android WebView only).
 *  3. Nothing waits forever: a restore that never arrives, or a soft recovery that never finishes, ends in a reload; a reload loop ends
 *     in a message that says what to do.
 */

/**
 * The lowered ceiling survives a reload in sessionStorage (this tab's session only; nothing is kept across visits). It is written only right
 * before a reload the loss caused (prepareLossReload): a loss that recovers in place keeps the lowering in memory only, as main did.
 */
export const LOST_CEILING_KEY = 'moon.lostCeiling'
/** Expiry for the degraded ceiling, stored alongside it as an epoch timestamp. */
export const LOST_CEILING_EXPIRES_KEY = 'moon.lostCeilingExpires'
/** A carried ceiling is useful only for the recovery session immediately after a loss. */
export const LOST_CEILING_TTL_MS = 10 * 60_000
/** What the page held at the last loss (JSON), for a device pass. */
export const LOSS_INFO_KEY = 'moon.lossInfo'
/** Reloads this session that a context loss caused. */
export const LOST_RELOADS_KEY = 'moon.lostReloads'

/** After the loss, how long to wait for `webglcontextrestored` before asking the browser to restore (ms). */
export const RESTORE_NUDGE_MS = 2500
/** After the loss, how long to wait in total before the page reloads (ms). */
export const RESTORE_GIVE_UP_MS = 7000
/** How long a soft recovery may take before it is abandoned for a reload (ms). */
export const SOFT_RECOVERY_MS = 12000
/** Reloads a session may spend on context loss before the page stops reloading and says so. */
export const MAX_LOSS_RELOADS = 2
/** Visible foreground time after recovery before the reload budget is forgiven. */
export const HEALTHY_RESET_MS = 60_000
export const HEALTHY_FRAME_MAX_AGE_MS = 1_000

export type RecoveryPlan = 'soft' | 'reload'

export interface LossContext {
  /** Losses this session, counting this one (quality.contextLosses). */
  losses: number
  groundActive: boolean
  patchLoaded: boolean
  /** The native shell (nativeHost): only there does a ground view or a site patch force a reload. */
  native: boolean
}

/** What to do when the context comes back. */
export function planAfterRestore(c: LossContext): RecoveryPlan {
  if (c.losses > 1) return 'reload'
  if (c.native && (c.groundActive || c.patchLoaded)) return 'reload'
  return 'soft'
}

export type WatchdogAction = 'wait' | 'nudge' | 'reload'

/**
 * One poll while the context is lost: `sinceLossMs` is the time since the loss, `nudged` whether restoreContext() was already asked, `hidden`
 * document.hidden. A hidden page never reloads (a background tab may not get its context back until it is shown): the reload waits for visibility.
 */
export function lostWatchdog(sinceLossMs: number, nudged: boolean, hidden = false): WatchdogAction {
  if (sinceLossMs >= RESTORE_GIVE_UP_MS) return hidden ? 'wait' : 'reload'
  if (sinceLossMs >= RESTORE_NUDGE_MS && !nudged) return 'nudge'
  return 'wait'
}

/** Whether a soft recovery that started `elapsedMs` ago has run out of time. */
export const softRecoveryExpired = (elapsedMs: number): boolean => elapsedMs >= SOFT_RECOVERY_MS

export type ReloadDecision = { reload: true; count: number } | { reload: false; count: number }

/**
 * Whether the page may reload for a context loss, given the reloads already spent (a stored string, or null). `storageOk` false (sessionStorage
 * throws): the count cannot survive the reload, so the budget counts as spent; an uncounted reload could loop forever.
 */
export function reloadDecision(stored: string | null, storageOk = true): ReloadDecision {
  if (!storageOk) return { reload: false, count: MAX_LOSS_RELOADS }
  const n = Number(stored)
  const count = Number.isInteger(n) && n >= 0 ? n : 0
  return count >= MAX_LOSS_RELOADS ? { reload: false, count } : { reload: true, count: count + 1 }
}

/** sessionStorage as prepareLossReload uses it: either call may throw (storage blocked or full). */
export interface LossStore { getItem(k: string): string | null; setItem(k: string, v: string): void }

/**
 * Everything a loss reload writes, in order, right before `location.reload()`: the reload count, then the lowered ceiling. 'give-up' when the
 * budget is spent or the store cannot be read or written (then nothing may reload: show the message). The ceiling is stored only on 'reload'.
 */
export function prepareLossReload(store: LossStore | null, ceilingBytes: number, now = Date.now()): 'reload' | 'give-up' {
  let stored: string | null
  try {
    if (!store) throw new Error('no storage')
    stored = store.getItem(LOST_RELOADS_KEY)
  } catch {
    return 'give-up'
  }
  const d = reloadDecision(stored)
  if (!d.reload) return 'give-up'
  try {
    store!.setItem(LOST_RELOADS_KEY, String(d.count))
    store!.setItem(LOST_CEILING_KEY, String(ceilingBytes))
    store!.setItem(LOST_CEILING_EXPIRES_KEY, String(now + LOST_CEILING_TTL_MS))
  } catch {
    return 'give-up'
  }
  return 'reload'
}

/** The ceiling a start uses: the profile's, lowered by a stored post-loss ceiling when that is a valid positive number. */
export function startCeiling(profileCeiling: number, stored: string | null, expires: string | null = null, now = Date.now()): number {
  const expiry = Number(expires)
  if (!Number.isFinite(expiry) || expiry <= now) return profileCeiling
  const n = Number(stored)
  if (stored === null || !Number.isFinite(n) || n <= 0) return profileCeiling
  return Math.min(profileCeiling, n)
}

/** A recovery may proceed only for the current loss and after the GL context is live again. */
export function recoveryIsCurrent(currentGeneration: number, recoveryGeneration: number, contextLost: boolean, glLost: boolean): boolean {
  return contextLost && currentGeneration === recoveryGeneration && !glLost
}

/** Whether the currently healthy foreground render has satisfied the reload-budget reset window. */
export function healthyResetDue(
  recoveredAt: number,
  now: number,
  lastSuccessfulFrameAt: number | null,
  visible: boolean,
  contextLost: boolean,
  intentionalIdle: boolean,
  maxFrameGapMs = HEALTHY_FRAME_MAX_AGE_MS,
): boolean {
  const renderingHealthy = intentionalIdle || (
    lastSuccessfulFrameAt !== null &&
    Number.isFinite(lastSuccessfulFrameAt) &&
    lastSuccessfulFrameAt >= recoveredAt &&
    now - lastSuccessfulFrameAt <= maxFrameGapMs
  )
  return !contextLost && visible && renderingHealthy && now - recoveredAt >= HEALTHY_RESET_MS
}

/**
 * The healthy window at a completed foreground frame (issue #254). The window starts at the first such frame; a gap since the previous
 * one longer than `maxFrameGapMs` is a stall, and the window starts again at this frame instead of being completed by it (a frame
 * 60 s after the timer fired used to clear the reload count at once). An intentional idle sleep is not a stall: the loop's wake
 * stamps `prevFrameAt` (main.ts wakeLoop), so the gap counts from the wake.
 */
export function healthyFrameWindow(
  recoveredAt: number | null,
  prevFrameAt: number | null,
  now: number,
  maxFrameGapMs = HEALTHY_FRAME_MAX_AGE_MS,
): { recoveredAt: number; restarted: boolean } {
  if (recoveredAt === null) return { recoveredAt: now, restarted: false }
  if (prevFrameAt !== null && now - prevFrameAt > maxFrameGapMs) return { recoveredAt: now, restarted: true }
  return { recoveredAt, restarted: false }
}

/** The ceiling to carry across a reload: the lowered one, finite and at least 64 MB (a ledger that was nearly empty must not starve the next start). */
export function ceilingToStore(current: number, ledgerTotal: number): number {
  const lowered = Number.isFinite(current) ? current : Math.round(ledgerTotal * 0.7)
  return Math.max(64 * 1048576, lowered)
}

/**
 * Resident patch bytes for a site on this class. Android native phones get 64 MB (issue #206, round 3: with the patch rasters in the ledger the
 * Apollo 17 eye level held 93 MB of patch under the earlier 96 MB cap, the largest category after the tiles); a lowered ceiling halves it.
 * Undefined: the layer's own default.
 */
export const NATIVE_ANDROID_PATCH_BYTES = 64 * 1048576
export function patchBudget(profileCap: number | undefined, nativePhoneAndroid: boolean, lowered: boolean): number | undefined {
  const MB = 1048576
  const base = profileCap ?? (nativePhoneAndroid ? NATIVE_ANDROID_PATCH_BYTES : undefined)
  if (base === undefined) return lowered ? 96 * MB : undefined
  return lowered ? Math.max(48 * MB, Math.round(base / 2)) : base
}

/**
 * Whether the Moon pass's Sun-keyed tile shadow cache (22 MB on a phone: 48 layers of 256^2 half floats plus its fade table) is released while the
 * ground view is open and rebuilt when it closes. The ground pass never reads it (groundShader.ts has no cache read), and on an Android phone in the
 * app it was the fourth-largest line at the Apollo 17 eye level where the WebView lost its context (issue #206). The website keeps it.
 */
export function parkTileShadowsInGround(cls: string, nativeShell: boolean): boolean {
  return nativeShell && cls === 'phone-android'
}

/**
 * The rest-frame pixel ratio cap while the ground view is open, or undefined for none. Android phones in the app rest at DPR 2 elsewhere; on the
 * ground that canvas (824x1830 on a 412x915 phone) costs a 17 MB scene target plus 12 MB of crossfade pair, so the ground view rests at 1.5
 * (issue #206). Gestures already run at the class's close-up cap (1.25), so only the still picture changes.
 */
export function groundRestDprCap(cls: string, nativeShell: boolean): number | undefined {
  return nativeShell && cls === 'phone-android' ? 1.5 : undefined
}
