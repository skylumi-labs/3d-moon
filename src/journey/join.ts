/**
 * The join between a fly-to and the flight or orbit it hands over to (A5, WP7b).
 * The flight's own ease starts from rest, so after the fly-to (which also ends at rest) the camera used to stand almost
 * still for seconds. Here the flight gets a short lead-in that starts at its mean speed, and the fly-to is planned to
 * end at that same pose rate (path.ts `endRate`, speed and direction), so position and velocity are continuous through the hand-over.
 */
import { wrapLon, type Pose } from '../camera/pose'

/** A pose rate: degrees of longitude and latitude and Moon radii of distance, each per second. */
export interface PoseRate { lon: number; lat: number; dist: number }

/** The lead-in's pay-back ends here (a share of the flight): the flight runs on its own ease from then on. */
export const JOIN_LEAD_SPAN = 0.5
/** Seconds the lead-in's speed takes to fall from the join's to nothing (capped at half the span on a short flight). */
export const JOIN_HOLD_SECONDS = 12
/** The pay-back starts this share of the hold in, when the lead is already falling and the flight's own ease has started to carry the camera. */
export const JOIN_PAYBACK_FROM = 0.6

/**
 * Extra progress added to the flight's eased progress during the lead-in, in mean speeds `lead` at u = 0. The flight's own ease starts from rest,
 * so the lead's speed is what keeps the camera moving after the fly-to: it holds near `lead` and falls smoothly to nothing over the hold
 * (`lead * (1 - smoothstep(u / hold))`, a plateau, not a decay from the first frame). Total progress must still end at the route's own, so a gentle
 * pay-back (a smooth bump, `lead * hold / 2` of progress) runs from JOIN_PAYBACK_FROM of the hold to JOIN_LEAD_SPAN, while the ease is faster than it.
 * The hold is TIME-based (seconds, capped at a share of a short flight). The old cubic decay from u = 0 with a pay-back from u = 0 left a 19 s
 * Earthrise at 0.35 of the join's speed within 3 s and a 70 s flight at 0.07 later on (rig R3 2026-10-21); this one keeps 0.83 through the first 3 s
 * and 0.46 at worst, for 19 to 70 s flights. Zero value, slope and curvature from u = JOIN_LEAD_SPAN on; total progress stays monotone for lead <= 1.
 */
export function joinLead(u: number, lead: number, seconds: number): number {
  if (lead === 0 || u >= JOIN_LEAD_SPAN) return 0
  const hold = Math.min(JOIN_LEAD_SPAN / 2, JOIN_HOLD_SECONDS / seconds)
  const x = Math.max(0, Math.min(1, u / hold))
  const given = hold * (x - x * x * x + x * x * x * x / 2)
  const p0 = hold * JOIN_PAYBACK_FROM
  const y = Math.max(0, (u - p0) / (JOIN_LEAD_SPAN - p0))
  return lead * (given - hold / 2 * y * y * y * (y * (y * 6 - 15) + 10))
}

/**
 * The orbit's lead-in (lifecycle.ts orbitAngleDeg): the earlier decaying shape, `lead * (1 - u/hold)^3` with a pay-back from u = 0 over 20 s.
 * The orbit's own pace is already up to speed within a second and then crawls across the sunset (1.5 deg/s); the plateau's larger pay-back
 * would push that stretch under the freeze floor, and this one keeps the fly-around's join (rig R3 1.08) as it was.
 */
export function joinLeadDecay(u: number, lead: number, seconds: number): number {
  const payback = Math.min(JOIN_LEAD_SPAN, 20 / seconds)
  if (lead === 0 || u >= payback) return 0
  const hold = Math.min(payback / 2, 10 / seconds)
  const x = Math.max(0, u)
  const given = x >= hold ? hold / 4 : hold / 4 * (1 - (1 - x / hold) ** 4)
  const y = x / payback
  return lead * (given - hold / 4 * y * y * y * (y * (y * 6 - 15) + 10))
}

/** The camera's pose rate at the start of a lead-in of mean-speed `lead`, from a pose sampler over progress (finite difference). */
export function leadStartRate(poseAt: (u: number) => Pose, seconds: number, lead = 1, du = 0.002): PoseRate {
  const a = poseAt(0), b = poseAt(du)
  const k = lead / du / seconds
  return { lon: wrapLon(b.lon - a.lon) * k, lat: (b.lat - a.lat) * k, dist: (b.dist - a.dist) * k }
}

/** The longest gap (ms) between the fly-to's last drawn frame and the first journey frame that still counts as "the next frame" for the back-dating below. */
export const JOIN_MAX_GAP_MS = 100
/** A frame longer than this (ms) is a stall (shader compile, tile upload, a hidden tab): the flight's clock does not run over it. */
export const STALL_MS = 250

/**
 * The clock start (ms) of the flight or orbit a fly-to hands over to. The fly-to's last frame already drew the pose at progress 0,
 * so starting the clock at the frame that first sees the journey (`now`) drew that pose a second time: one repeated frame at the join.
 * With the hand-over time (the frame the fly-to drew its last pose on, never after `now`) the first journey frame has advanced by the time since.
 * That credit is for the next frame only: when a stall sits between the two (rig 2026-10-21: a 4.5 s hitch on the first Earthrise frame started the flight
 * at u = 0.24, skipping the lead-in and the hidden-Earth start), the clock starts at `now` instead.
 */
export function journeyClockStart(now: number, handOverAt: number | null, startU: number, seconds: number): number {
  const at = handOverAt == null || now - handOverAt > JOIN_MAX_GAP_MS ? now : Math.min(now, handOverAt)
  return at - startU * seconds * 1000
}

/** Milliseconds a flight's clock start moves later for the gap since the previous frame: nothing for an ordinary frame, the whole gap for a stall. */
export function stallShift(prevNow: number | null, now: number): number {
  return prevNow != null && now - prevNow > STALL_MS ? now - prevNow : 0
}
