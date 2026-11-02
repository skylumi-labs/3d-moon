import type { Pose } from '../camera/pose'

/**
 * The hand-over from a fly-to into a cinematic flight, made continuous when the flight's start has moved since the fly-to was planned.
 * The fly-to flies to the flight's start sampled when the pick was made; a flight whose start depends on the floor (Earthrise re-solves its
 * height and place against the loaded imagery's floor) starts somewhere else once finer tiles have lowered the floor during a long approach:
 * the rig measured a 17 % position step (lon 128.14 -> 118.81 deg, 1.148 -> 1.065 radii) on the first flight frame, with and without the date
 * carry (tap-jump.mjs, 2026-10-29). The gap between the pose on screen and the flight's first sample is carried as an offset that fades out
 * over JOIN_FIX_MS of the flight's own time, so the flight converges onto its own route instead of jumping to it. On the flight's progress, not
 * the wall clock: a flight held by the slider's pause stands still with its offset (review 2026-10-29: on the wall clock it drifted by what was
 * left of it), and a stalled frame does not spend it.
 */
export const JOIN_FIX_MS = 2000
/** A hand-over gap above this share of the distance is a planning error worth seeing (main.ts logs it; the rig job reports it), not noise. */
export const JOIN_GAP_REPORT = 0.01
/** Gaps below this (deg, or log-distance, or deg of lens) are drawing noise, not a jump: no offset. */
const JOIN_FIX_MIN = 1e-6

/** u0: the flight's progress at its first sample; spanU: the fade's length in progress (JOIN_FIX_MS over the flight's length). */
export interface JoinFix { dLon: number; dLat: number; dLogDist: number; dRoll: number; dPitch: number; dFov: number; u0: number; spanU: number }

const wrap = (d: number): number => ((d + 540) % 360) - 180

/** The offset from the flight's first sample (`to`, `toFov`) to the pose on screen (`from`, `fromFov`), or null when there is no gap. */
export function joinFixFor(from: Pose, fromFov: number, to: Pose, toFov: number, u0: number, spanU: number): JoinFix | null {
  const f: JoinFix = {
    dLon: wrap(from.lon - to.lon), dLat: from.lat - to.lat, dLogDist: Math.log(from.dist / to.dist),
    dRoll: wrap((from.roll ?? 0) - (to.roll ?? 0)), dPitch: (from.pitch ?? 0) - (to.pitch ?? 0), dFov: Math.log(fromFov / toFov), u0, spanU,
  }
  const gap = Math.max(Math.abs(f.dLon), Math.abs(f.dLat), Math.abs(f.dLogDist), Math.abs(f.dRoll), Math.abs(f.dPitch), Math.abs(f.dFov))
  return gap > JOIN_FIX_MIN ? f : null
}

/** The hand-over gap as a share of the distance (position only; small-angle: lon scaled by cos lat, lat, log distance). */
export function joinGap(f: JoinFix, lat: number): number {
  return Math.hypot(f.dLon * Math.cos(lat * Math.PI / 180) * Math.PI / 180, f.dLat * Math.PI / 180, f.dLogDist)
}

/** The flight's sample at progress `flightU` with what is left of the offset (smoothstep from all of it to none over spanU), and whether it is spent. */
export function applyJoinFix(f: JoinFix, pose: Pose, fovDeg: number, flightU: number): { pose: Pose; fovDeg: number; done: boolean } {
  const u = f.spanU > 0 ? Math.max(0, Math.min(1, (flightU - f.u0) / f.spanU)) : 1
  const w = 1 - u * u * (3 - 2 * u)
  return {
    pose: {
      ...pose,
      lon: wrap(pose.lon + f.dLon * w), lat: pose.lat + f.dLat * w, dist: pose.dist * Math.exp(f.dLogDist * w),
      roll: (pose.roll ?? 0) + f.dRoll * w, pitch: (pose.pitch ?? 0) + f.dPitch * w,
    },
    fovDeg: fovDeg * Math.exp(f.dFov * w),
    done: u >= 1,
  }
}
