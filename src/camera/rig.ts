import { Quaternion, Vector3 } from 'three'
import type { Ephemeris } from '../ephemeris'
import { clampAlong, coneFloor, dollyPosition } from './dolly'
import {
  D_MIN, FLY_FOV_DEG, HOME_DIST, pickSphere, lonLatOfDir, PITCH_MAX, SITE_PITCH_MAX, angularDistance, type Pose, type ViewCamera, basisFromQuat, clampDist, flyTanHalf,
  poseBasis, poseFromView, SITE_CONE, quatFromBasis, reliefShare, siteFloorDist, siteGround, wrapLon, zoomDist, type SiteFloor, D_MAX,
} from './pose'
import { capGestureRotation, moonOffAxis, RECENTRE_RAD_PER_LN, recentreRotation, spinRadiansPerPixel, spinRotation, type Rotation } from './grab'
import { crossPole } from './pole'
import { forwardTangent, rightTangent, surfaceMove, tiltLimitDeg, viewHeadingDeg, wrapHeading } from './fly'

/**
 * The camera's state machine (moon-v1's fly object): the fly pose with its idle orbit, inertia and rubber band, a fly-to
 * glide, and a look offset. The dolly zoom out of the Earth view is gone (WP2): the Earth view is a pin.
 *
 * The look offset turns the camera away from the Moon's centre without
 * moving it: a rotation applied after "look at the Moon's centre", in that
 * view's own frame. lookToward(dir) aims it at a world direction (or a
 * function returning one, to follow a body while orbiting); lookAtMoon()
 * returns. For "Look at the Earth" and "Look at the Sun" buttons.
 */

/** The camera is always an orbit pose: the dolly zoom out of the Earth view is gone (the Earth view is a pin, see hotspots.ts). */
export type Mode = 'fly'

const LOOK_MS = 1400
/**
 * The idle orbit is OFF unless the URL asks for it (?auto=1). It used to be on by default and, 20 s after the last touch, turned the
 * camera 0.6 deg/s: the owner (4 Oct 2026) saw "the Moon slowly drifts off to the side. Shouldn't happen." A still camera stays still.
 */
export function idleOrbitOn(search: string | URLSearchParams, still: boolean): boolean {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search
  return q.get('auto') === '1' && !still
}
/** The idle orbit (when on) starts after this long without input, and is slow. */
const IDLE_MS = 20000
const ORBIT_DEG_PER_S = 0.6
/** Inertia: the release velocity decays with this time constant, and stops under the cutoff. */
const INERTIA_TAU_S = 0.35
const INERTIA_STOP_DEG_S = 0.5
/** Bound post-release motion both at ordinary altitude and relative to the visible ground field near the surface. */
const INERTIA_MAX_DEG_S = 30
/** One coalesced pointer sample cannot orbit the camera by more than this; smaller grabs still solve point-under-finger exactly. */
export const MAX_GESTURE_STEP_RAD = 8 * Math.PI / 180
/** The picture may go this far past the zoom limits (the distance shown is the clamped one times rubber), and springs back. */
const RUBBER_MAX = 1.08
const RUBBER_TAU_S = 0.0625
const RUBBER_HOLD_MS = 100

/** Quintic ease in and out. */
export const smootherstep = (x: number): number => {
  const t = Math.max(0, Math.min(1, x))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/** A fly-to from the camera's pose to another, run by the rig (Home, double-tap; the planner of WP2 drives pins through the same hooks). */
interface Glide {
  t0: number
  ms: number
  from: Pose
  to: Pose
  fov0: number
  fov1: number
  aim0: number
  aim1: number
  aimX0: number
  aimX1: number
}

/** Seconds a fly-to takes (journey/path.ts of the redesign, section 4.4): 1.5 s plus 0.35 s per octave of distance, 0.6 s per 90 deg of travel, 0.4 s per 90 deg of roll or tilt turn, within 1.5 to 3 s. */
export function flyDurationMs(from: Pose, to: Pose): number {
  const octaves = Math.abs(Math.log2(to.dist / from.dist))
  const travel = angularDistance(from.lon, from.lat, to.lon, to.lat) * 180 / Math.PI
  const turn = Math.abs((to.pitch ?? 0) - (from.pitch ?? 0)) + Math.abs(to.roll - from.roll)
  return Math.max(1500, Math.min(3000, 1500 + 350 * octaves + 600 * travel / 90 + 400 * turn / 90))
}

/** What the rig hands to whoever takes the camera over mid-move. */
export interface TakeOver {
  pose: Pose
  fovDeg: number
  aimShift: number
  aimShiftX: number
  /** Degrees per second the pose was turning (inertia or a fly-to's rate), and octaves per second of distance. */
  velocity: { lon: number; lat: number; octaves: number }
}

const smoothstep = (x: number): number => {
  const t = Math.max(0, Math.min(1, x))
  return t * t * (3 - 2 * t)
}

/** One end of a transition: where the camera looks from, and how. */
interface CamEnd {
  /** Look-at-the-Moon orientation: its back axis is the camera's direction from the centre. */
  qBase: Quaternion
  /** The orientation actually shown (qBase with the look offset). */
  qView: Quaternion
  dist: number
  tanHalf: number
}

export type LookTarget = Vector3 | ((cam: ViewCamera) => Vector3)
export interface LookBlendState {
  target: LookTarget | null
  blendW: number
  from: Quaternion
  t0: number
  ms: number
  running: boolean
  settledOffset: Quaternion | null
  /** The running turn's last target (continuousTarget); absent: the shorter arc from the turn's start. */
  ref?: Quaternion | null
}

const GESTURE_GAP_MS = 300

/**
 * A look turn of about 180 degrees toward a moving target (the Earth from a camera between the Moon and the Earth) flipped its direction on the frame
 * the turn passed 180 degrees: three's slerp re-picks the shorter arc on every call, and the view stepped 40-45 degrees in one frame mid-approach
 * (rig 2026-10-29, tap-jump.mjs flight-earthrise). The turn now keeps its side: the target quaternion is taken on the side of the PREVIOUS frame's
 * target (a target rebuilt from a matrix every frame can come back as -q for the same rotation, so a fixed sign is not enough), and the slerp
 * never re-picks the arc. The first target is taken on the shorter arc from the start of the turn.
 */
export function continuousTarget(target: Quaternion, prev: Quaternion | null, from: Quaternion): Quaternion {
  const ref = prev ?? from
  const d = target.x * ref.x + target.y * ref.y + target.z * ref.z + target.w * ref.w
  return d < 0 ? new Quaternion(-target.x, -target.y, -target.z, -target.w) : target.clone()
}
/** Slerp from `a` to `b` exactly as given (no shorter-arc re-pick). */
export function slerpAsGiven(a: Quaternion, b: Quaternion, t: number): Quaternion {
  const cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w
  if (cos > 1 - 1e-9) return b.clone().normalize()
  const theta = Math.acos(Math.max(-1, Math.min(1, cos)))
  const sin = Math.sin(theta)
  if (Math.abs(sin) < 1e-9) return a.clone()
  const ka = Math.sin((1 - t) * theta) / sin, kb = Math.sin(t * theta) / sin
  return new Quaternion(a.x * ka + b.x * kb, a.y * ka + b.y * kb, a.z * ka + b.z * kb, a.w * ka + b.w * kb).normalize()
}

/** After a drag the view eases its roll back to lunar-north-up over this long. */
export const LEVEL_MS = 500
/** The compass click turns the view back to north over this long, ms. */
export const NORTH_MS = 600
/** Within this many degrees of a pole there is no useful north-up (roll turns about the pole), so a drag there is left as it is. */
export const LEVEL_POLE_DEG = 15
/**
 * A roll beyond this is left as it is (deg). A drag over a pole leaves the picture about half a turn round; levelling that in LEVEL_MS was a sudden
 * half-turn of the whole Moon (owner: "the Moon suddenly flips"). The compass click turns it back smoothly (resetNorth).
 */
export const LEVEL_MAX_DEG = 90
/** Roll left over below this ends the levelling (deg). */
const LEVEL_DONE_DEG = 0.01
/** The Moon's body frame as an ephemeris: inertia and levelling turn the pose in the body frame, so they need no clock. */
const BODY = { moonX: new Vector3(1, 0, 0), moonY: new Vector3(0, 1, 0), moonZ: new Vector3(0, 0, 1) } as unknown as Ephemeris

export class CameraRig {
  /**
   * always 'fly': the navigator's Home is an orbit pose (homePose).
   */
  mode: Mode = 'fly'
  pose: Pose = { lon: 0, lat: 0, dist: HOME_DIST, roll: 0 }
  /** Idle orbit after IDLE_MS without input (off by default, see idleOrbitOn). */
  auto = false
  /**
   * Field across the short side while flying, deg. 30 for the ordinary fly
   * view; the tour buttons narrow it to fill the frame with the Earth,
   * which spans under 2 deg from the Moon.
   */
  fovDeg = FLY_FOV_DEG
  /**
   * Pitches the fly view so what it looks at sits this share of the half
   * height above the centre (0 = centred). The tours use it on phones so a
   * card over the lower half does not cover the subject.
   */
  aimShift = 0
  /** Sideways counterpart of aimShift (share of the half width the subject sits right of centre). */
  aimShiftX = 0
  /** Where the Earth view puts the Moon so no card or chip covers it (ui/layout.ts); null keeps it centred. */
  /**
   * Closest distance, Moon radii. D_MIN until the tiles are known; then
   * floorDist() of their data and the canvas (main.ts calls setFloor).
   */
  dMin = D_MIN
  /** A place with its own, lower floor (the site patch), or null. */
  site: SiteFloor | null = null
  /** Closest distance over a point from the finest height data the tiles hold there (coverage.ts deeperFloorAt), or null. */
  deepFloor: ((lon: number, lat: number) => number) | null = null
  /** The floor the finest height data under one point allows (no search around it), for the zoom dolly's continuous floor; null: the dolly reads `deepFloor`. */
  deepTexelFloor: ((lon: number, lat: number) => number) | null = null
  /** Real data floors found by earlier dolly steps (a direction and its floor): the continuous cone is anchored on them too, so a small fine region the camera has left is not forgotten. */
  private floorAnchors: Array<{ dir: Vector3; floor: number }> = []
  private anchorKey: { deep: unknown; texel: unknown; fov: number } = { deep: null, texel: null, fov: 0 }
  dragging = false
  /** Ground mode has the camera: the wheel, drag and idle orbit leave the pose alone. */
  frozen = false
  lastInputAt = -1e9
  /** Zoom attempts clamped at a limit, rate-limited so a held gesture is one feedback pulse. */
  limitHits = 0
  /** The last time the visitor's own zoom (wheel, pinch, + and -) acted, ms; the zoom tape shows only around it. */
  lastZoomInputAt = Number.NEGATIVE_INFINITY
  private lastLimitHitAt = -1e9
  /** Skip transitions and look turns (jump to their end). */
  instant = false
  private glide: Glide | null = null
  /** Drag velocity of the pose, deg per second, and when the last drag step landed. */
  private vel = { lon: 0, lat: 0 }
  private lastOrbitAt = -1e9
  /** Trackball release velocity: the turn of the camera about the Moon's centre, as an axis (body frame) times deg per second. */
  private spinVel = new Vector3()
  /** Roll levelling: a drag turned the view and has not been levelled yet; a twist of this gesture cancels it; the easing in progress. */
  private levelPending = false
  private gestureTwisted = false
  private level: { t0: number; roll0: number } | null = null
  private lastAspect = 1
  /** The visitor tilted the view (tilt()): the tilt is then felt at every distance, up to tiltLimit(). A scripted pose leaves it off (setPose, glideTo), so no authored view changes. */
  private tiltOwn = false
  /** An eased turn back to north (resetNorth): the heading it started from and how much of it is undone. */
  private northReset: { t0: number; h0: number; done: number } | null = null
  /** log of the rubber-band factor on the shown distance, and when the last zoom input came. */
  private overshoot = 0
  private lastZoomAt = -1e9
  private lastRecentreAt = -1e9
  private recentreOn = true
  private lookTarget: LookTarget | null = null
  /** The share of the look that points at the Earth, when the look is a blend (setLookBlend); 0 for every other look. */
  private lookBlendW = 0
  private lookFrom = new Quaternion()
  /** The running look turn's target as last taken (continuousTarget): the next frame's target is kept on its side. */
  private lookRef: Quaternion | null = null
  private lookT0 = -1e9
  /** The running turn's length, ms: LOOK_MS unless the caller asked for a longer one (the Sun, whose exposure needs the lead). */
  private lookMs = LOOK_MS
  /** A look turn was still running at the last step: one more frame shows its end. */
  private lookRunning = false

  /** A look turn (lookToward) is still running at `now`. */
  lookingAt(now: number): boolean { return now - this.lookT0 < this.lookMs }
  /**
   * The look turn starts `ms` later: the feel-clock backstop slips the move it belongs to (main.ts feelBackstop), whose clock it shares. `stepAt`: the frame the
   * move last advanced at; a turn still running (or not yet started) then slips, however long the gap, and a finished one is left alone.
   */
  shiftLookClock(ms: number, stepAt: number): void { if (ms > 0 && this.lookT0 > -1e8 && stepAt - this.lookT0 < this.lookMs) this.lookT0 += ms }
  /** The turn `lookToward` was last given is still the camera's look (cleared by Home, a settle, any other look): the truth for a button's pressed state. */
  looksAt(target: LookTarget): boolean { return this.lookTarget !== null && this.lookTarget === target }
  /** Seconds left of the running turn at `now` (0 when none). */
  lookRemainingS(now: number): number { return Math.max(0, this.lookT0 + this.lookMs - now) / 1000 }
  /** Length of the turn now running or last run, ms. */
  get lookDurationMs(): number { return this.lookMs }

  /** The camera for this frame. */
  camera(e: Ephemeris, aspect: number, now: number): ViewCamera {
    this.lastAspect = aspect
    return this.fromEnd(this.flyEnd(e, aspect, now))
  }

  /**
   * The look as a blend of directions: w 0 looks at the Moon's centre, 1 at `earth` (a body to follow), between them along the
   * mix of the two directions. The orientation is solved from that direction on every frame, so a move between two subjects
   * never slerps between two look-at orientations (the planner, journey/path.ts, drives w).
   */
  setLookBlend(w: number, earth: LookTarget): void {
    this.cancelLevel()
    this.settledOffset = null
    this.lookT0 = -1e9
    this.lookRunning = false
    this.lookBlendW = Math.max(0, Math.min(1, w))
    if (w <= 0) { this.lookTarget = null; return }
    this.lookTarget = (cam: ViewCamera): Vector3 => {
      const e = (typeof earth === 'function' ? earth(cam) : earth).clone().normalize()
      if (w >= 1) return e
      const m = cam.pos.clone().negate().normalize()
      const mix = m.multiplyScalar(1 - w).addScaledVector(e, w)
      return mix.lengthSq() < 1e-12 ? e : mix.normalize()
    }
  }

  private settledOffset: Quaternion | null = null
  /**
   * Set by settle(): the camera may sit below the floor it was handed (a scripted move froze it in a site's funnel). The exemption holds
   * only where the floor is no higher than it was at the settle point; the first pose whose floor is higher lifts the camera and ends it.
   */
  private settledFreeDistance = false
  private settledFloor = 0
  /** Cancel motion at the exact rendered pose/lens/orientation before free input. */
  settle(e: Ephemeris, aspect: number, now: number, rendered = this.camera(e, aspect, now)): void {
    this.cancelLevel()
    this.glide = null
    const p = rendered.pos.clone().normalize()
    this.pose = { lon: Math.atan2(p.dot(e.moonY), p.dot(e.moonX)) * 180 / Math.PI,
      lat: Math.asin(Math.max(-1, Math.min(1, p.dot(e.moonZ)))) * 180 / Math.PI,
      dist: rendered.pos.length(), roll: 0, pitch: 0 }
    const base = poseBasis(e, this.pose)
    const q = quatFromBasis(base.right, base.up, base.back)
    this.settledOffset = q.invert().multiply(quatFromBasis(rendered.right, rendered.up, rendered.back))
    this.settledFreeDistance = true
    this.settledFloor = this.floorAt(this.pose.lon, this.pose.lat)
    this.fovDeg = 2 * Math.atan(rendered.tanHalf * Math.min(1, aspect)) * 180 / Math.PI
    this.aimShift = this.aimShiftX = 0
    this.auto = false
    this.lookTarget = null; this.lookBlendW = 0; this.lookT0 = -1e9; this.lookRunning = false
    this.lastInputAt = now
  }

  /** Keep the world camera position while the Moon's body axes move under it, without changing scripted look/lens state. */
  keepWorldPosition(e: Ephemeris, camera: ViewCamera, now: number): void {
    const p = camera.pos.clone().normalize()
    this.pose.lon = Math.atan2(p.dot(e.moonY), p.dot(e.moonX)) * 180 / Math.PI
    this.pose.lat = Math.asin(Math.max(-1, Math.min(1, p.dot(e.moonZ)))) * 180 / Math.PI
    if (this.settledOffset) {
      // A free orientation (after a settle, e.g. a date change that ended a turn): rebuild the offset from the camera as rendered, without the aim and
      // the visitor's pitch, so it is not applied twice (review: turn, change the date, turn again rolled the view about 12 degrees per event).
      const tanHalf = camera.tanHalf
      const q = quatFromBasis(camera.right, camera.up, camera.back)
      if (this.aimShiftX) q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan(this.aimShiftX * tanHalf * this.lastAspect)).invert())
      if (this.aimShift) q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.atan(this.aimShift * tanHalf)).invert())
      const pe = this.effectivePitch()
      if (pe) q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -pe * Math.PI / 180))
      this.pose.roll = 0
      const b0 = poseBasis(e, { ...this.pose, roll: 0, pitch: 0 })
      this.settledOffset = quatFromBasis(b0.right, b0.up, b0.back).invert().multiply(q).normalize()
    } else {
      const base = poseBasis(e, this.pose)
      const up = camera.up.clone().addScaledVector(base.back, -camera.up.dot(base.back)).normalize()
      const north = poseBasis(e, { ...this.pose, roll: 0 }).up
      this.pose.roll = Math.atan2(up.dot(new Vector3().crossVectors(base.back, north)), up.dot(north)) * 180 / Math.PI
    }
    this.pose.dist = Math.max(camera.pos.length(), this.floorAt(this.pose.lon, this.pose.lat), 1 + this.groundAt(this.pose.lon, this.pose.lat) + 1e-7)
    this.endSettleExemption(this.pose.lon, this.pose.lat)
    this.settledFreeDistance = false
    this.settledFloor = 0
    this.lastInputAt = now
  }

  /** The closest distance over (lon, lat): the global floor, or the site's funnel where that is lower. */
  floorAt(lon: number, lat: number): number {
    let f = this.site ? Math.min(this.dMin, siteFloorDist(this.site, lon, lat)) : this.dMin
    if (this.deepFloor) f = Math.min(f, this.deepFloor(lon, lat))
    return f
  }

  /** Ends the settle exemption once the floor under (lon, lat) is higher than where the camera was settled: it then clamps like any other. */
  private endSettleExemption(lon: number, lat: number): void {
    if (this.settledFreeDistance && this.floorAt(lon, lat) > this.settledFloor + 1e-9) this.settledFreeDistance = false
  }

  /** The ground under (lon, lat) the altitude law counts from (0 without a site). */
  groundAt(lon: number, lat: number): number {
    return this.site ? siteGround(this.site, lon, lat) : 0
  }

  /** Sets the closest distance; a camera already closer is lifted to it. */
  setFloor(d: number): void {
    this.dMin = d
    this.endSettleExemption(this.pose.lon, this.pose.lat)
    if (!this.settledFreeDistance && this.pose.dist < this.floorAt(this.pose.lon, this.pose.lat)) this.pose.dist = this.floorAt(this.pose.lon, this.pose.lat)
  }

  /** A pose straight away (no transition): URL parameters and captures. */
  setPose(pose: Partial<Pose>, floorOverride?: number): void {
    this.cancelLevel()
    this.glide = null
    this.northReset = null
    this.tiltOwn = false
    this.pose = { ...this.pose, ...pose }
    this.pose.lat = Math.max(-89, Math.min(89, this.pose.lat))
    this.pose.lon = wrapLon(this.pose.lon)
    this.endSettleExemption(this.pose.lon, this.pose.lat)
    this.pose.dist = this.settledFreeDistance
      ? Math.max(1 + this.groundAt(this.pose.lon, this.pose.lat) + 1e-7, this.pose.dist)
      : floorOverride === undefined
        ? clampDist(this.pose.dist, this.floorAt(this.pose.lon, this.pose.lat))
        : Math.max(1 + this.groundAt(this.pose.lon, this.pose.lat) + 1e-7, floorOverride, this.pose.dist)
    this.dropIdlePitch()
    this.mode = 'fly'
  }

  /** Above the relief's reach the pitch has no effect (reliefShare); forget it, so zooming back in does not tilt the view unasked. */
  private dropIdlePitch(): void {
    if (this.tiltOwn) { this.pose.pitch = Math.min(this.pose.pitch ?? 0, this.tiltLimit()); if (!this.pose.pitch) this.tiltOwn = false }
    else if (this.pose.pitch && reliefShare(this.pose.dist) <= 0) this.pose.pitch = 0
  }

  /**
   * Drag: the ground under the pointer follows it. One CSS pixel turns the
   * Moon by the angle one pixel spans at the ground under the camera; the
   * drag is turned by the roll so it follows the pointer at any roll.
   */
  orbit(dxCss: number, dyCss: number, shortCss: number, now: number): void {
    if (this.mode !== 'fly' || this.frozen) return
    this.glide = null
    this.northReset = null
    const k = this.fovDeg / Math.max(1, shortCss) * (this.pose.dist - 1 - this.groundAt(this.pose.lon, this.pose.lat))
    const r = (this.pose.roll || 0) * Math.PI / 180
    const sx = dxCss, sy = -dyCss
    const east = sx * Math.cos(r) - sy * Math.sin(r)
    const north = sx * Math.sin(r) + sy * Math.cos(r)
    this.noteTurn(this.turnBy(-east * k, -north * k), now)
  }

  /** Release velocity: a running average of the last few steps, so one jittery event does not throw the Moon. */
  private noteTurn(dLon: { lon: number; lat: number }, now: number): void {
    const dt = (now - this.lastOrbitAt) / 1000
    if (dt > 0.001 && dt < 0.1) {
      this.vel.lon = this.vel.lon * 0.5 + (dLon.lon / dt) * 0.5
      this.vel.lat = this.vel.lat * 0.5 + (dLon.lat / dt) * 0.5
      const speed = Math.hypot(this.vel.lon * Math.cos(this.pose.lat * Math.PI / 180), this.vel.lat)
      const altitude = Math.max(0, this.pose.dist - 1 - this.groundAt(this.pose.lon, this.pose.lat))
      const maxSpeed = Math.min(INERTIA_MAX_DEG_S, 1.5 * this.fovDeg * altitude)
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed
        this.vel.lon *= scale
        this.vel.lat *= scale
      }
    } else { this.vel.lon = 0; this.vel.lat = 0 }
    this.lastOrbitAt = now
    this.lastInputAt = now
  }

  /** Release velocity of a trackball turn (a body-frame axis and angle over the time since the last one), averaged like noteTurn. */
  private noteSpin(axisBody: Vector3, angle: number, now: number): void {
    const dt = (now - this.lastOrbitAt) / 1000
    if (dt > 0.001 && dt < 0.1) {
      this.spinVel.multiplyScalar(0.5).addScaledVector(axisBody, (angle * 180 / Math.PI / dt) * 0.5)
      const altitude = Math.max(0, this.pose.dist - 1 - this.groundAt(this.pose.lon, this.pose.lat))
      const maxSpeed = Math.min(INERTIA_MAX_DEG_S, 1.5 * this.fovDeg * altitude)
      const speed = this.spinVel.length()
      if (speed > maxSpeed) this.spinVel.multiplyScalar(maxSpeed / speed)
    } else this.spinVel.set(0, 0, 0)
    this.vel.lon = 0; this.vel.lat = 0
    this.lastOrbitAt = now
    this.lastInputAt = now
  }

  /** The point of the Moon (unit, world) under a frame spot (NDC), or null over the sky. */
  pickMoon(nx: number, ny: number, e: Ephemeris, aspect: number, now: number): Vector3 | null {
    return pickSphere(this.camera(e, aspect, now), nx, ny, aspect)
  }

  /** Turns the camera about the Moon's centre by a world rotation, through turnBy (limits, floors and inertia all apply). */
  private rotateCamera(rot: Rotation, e: Ephemeris, now: number, kind: 'drag' | 'coast' | 'level' | 'move' = 'drag'): void {
    const basis = poseBasis(e, this.pose)
    const moved = basis.back.clone().applyAxisAngle(rot.axis, rot.angle).normalize()
    const movedUp = basis.up.clone().applyAxisAngle(rot.axis, rot.angle).normalize()
    // Use the rotated direction directly: treating a tangent angle as a longitude delta shrinks the turn by cos(latitude).
    const ll = lonLatOfDir(e, moved)
    // `lonLatOfDir` has already carried the endpoint through the pole.
    this.pose.lon = wrapLon(ll.lon)
    this.pose.lat = ll.lat
    // Longitude/latitude's north-up reference reverses at a pole. Find the roll
    // that represents the rotated camera-up vector in the new pose basis instead
    // of snapping the screen through a binary half turn.
    const northUp = poseBasis(e, { ...this.pose, roll: 0 }).up
    const rollSide = new Vector3().crossVectors(moved, northUp)
    const roll = Math.atan2(movedUp.dot(rollSide), movedUp.dot(northUp)) * 180 / Math.PI
    this.pose.roll = ((roll + 540) % 360) - 180
    this.endSettleExemption(this.pose.lon, this.pose.lat)
    if (!this.settledFreeDistance) this.pose.dist = Math.max(this.pose.dist, this.floorAt(this.pose.lon, this.pose.lat))
    if ((this.pose.pitch ?? 0) > this.pitchLimit()) this.pose.pitch = this.pitchLimit()
    if (kind === 'move') this.lastInputAt = now
    if (kind === 'drag') {
      this.northReset = null
      this.noteSpin(new Vector3(rot.axis.dot(e.moonX), rot.axis.dot(e.moonY), rot.axis.dot(e.moonZ)), rot.angle, now)
      this.levelPending = true
      this.level = null
    }
  }

  /**
   * A drag that starts over the sky: the camera turns about the Moon in the camera's own screen axes, so the swipe goes the way
   * the finger goes in every view (the pose's own axes ran sideways after a journey left a free orientation).
   */
  spin(dxCss: number, dyCss: number, shortCss: number, e: Ephemeris, aspect: number, now: number, gain = 1): void {
    if (this.mode !== 'fly' || this.frozen) return
    this.glide = null
    const radPerPx = spinRadiansPerPixel(this.pose.dist - 1 - this.groundAt(this.pose.lon, this.pose.lat), this.fovDeg, shortCss)
    const rot = spinRotation(this.camera(e, aspect, now), dxCss, dyCss, radPerPx * Math.max(0, gain))
    if (rot) { rot.angle = capGestureRotation(rot.angle, MAX_GESTURE_STEP_RAD); this.rotateCamera(rot, e, now) }
  }

  /**
   * A drag that starts on the Moon (Google Earth): the point under the finger stays under it. `from` and `to` are the finger's
   * frame spots (NDC) before and after the step. False when the grab cannot hold (the finger left the disc): the caller spins.
   *
   * The camera turns about the Moon's centre by the one shortest rotation that carries the point now under `to` onto the point
   * that was under `from` (a trackball). That is a rigid turn of the whole view, so the picture slides under the finger without
   * twisting about the line of sight, at any latitude and across either pole. (The old solver moved the pose's own longitude and
   * latitude and kept north up, which spins the picture by sin(latitude) times the longitude moved: the owner's "I drag to the
   * side and it turns".)
   */
  grab(from: { nx: number; ny: number }, to: { nx: number; ny: number }, e: Ephemeris, aspect: number, now: number): boolean {
    if (this.mode !== 'fly' || this.frozen) return false
    this.glide = null
    const rotation = this.grabRotation(from, to, e, aspect, now)
    if (!rotation) return false
    if (rotation.angle > 0) this.rotateCamera(rotation, e, now)
    return true
  }

  /** The world rotation a trackball grab would apply to the camera, without applying it. */
  grabRotation(from: { nx: number; ny: number }, to: { nx: number; ny: number }, e: Ephemeris, aspect: number, now: number): Rotation | null {
    if (this.mode !== 'fly' || this.frozen) return null
    const cam = this.camera(e, aspect, now)
    const P = pickSphere(cam, from.nx, from.ny, aspect)
    const Q = pickSphere(cam, to.nx, to.ny, aspect)
    if (!P || !Q) return null
    const axis = new Vector3().crossVectors(Q, P)
    const sin = axis.length(), cos = Q.dot(P)
    if (sin < 1e-12) return { axis: e.moonX.clone(), angle: 0 }
    const angle = capGestureRotation(Math.atan2(sin, cos), MAX_GESTURE_STEP_RAD)
    return { axis: axis.divideScalar(sin), angle }
  }

  /**
   * Two fingers twisting: the view rolls about the line of sight by `deg` (counter-clockwise on screen: the Moon follows the
   * fingers). With a free orientation (settledOffset, after a grabbed journey) the turn is written into that orientation about the
   * camera's own axis; the pose's roll alone would turn the base frame about a different axis than the one on screen.
   */
  twist(deg: number, e: Ephemeris, aspect: number, now: number): void {
    if (this.mode !== 'fly' || this.frozen) return
    this.glide = null
    this.cancelLevel()
    this.gestureTwisted = true
    if (this.settledOffset) {
      const cam = this.camera(e, aspect, now)
      this.rotateView({ axis: cam.back.clone(), angle: -deg * Math.PI / 180 }, e)
    } else {
      this.pose.roll = (((this.pose.roll || 0) - deg + 540) % 360) - 180
    }
    this.lastInputAt = now
  }

  /**
   * Heading: the view turns about the vertical at the camera (the line from the Moon's centre), `deg` degrees (positive: the picture
   * turns counter-clockwise on screen, like twist, so the compass heading grows). Tilt and position are unchanged: the camera
   * looks the same way relative to the ground it is over, and only which way that is changes.
   */
  turnHeading(deg: number, now: number, eased = false): void {
    if (this.mode !== 'fly' || this.frozen) return
    this.glide = null
    this.cancelLevel()
    if (!eased) this.northReset = null
    if (this.settledOffset) {
      const radial = this.camera(BODY, this.lastAspect, now).pos.normalize()
      this.rotateView({ axis: radial, angle: -deg * Math.PI / 180 }, BODY)
    } else {
      this.pose.roll = (((this.pose.roll || 0) - deg + 540) % 360) - 180
    }
    this.lastInputAt = now
  }

  /** The compass heading of the view now, deg clockwise from lunar north in (-180, 180]; 0 when north is up the screen. */
  headingDeg(e: Ephemeris, aspect: number, now: number): number {
    return wrapHeading(viewHeadingDeg(this.camera(e, aspect, now), e.moonZ))
  }

  /** Eases the view back to north-up (the compass click) over NORTH_MS; any drag, tilt, move or new pose cancels it. */
  resetNorth(e: Ephemeris, aspect: number, now: number): void {
    if (this.mode !== 'fly' || this.frozen) return
    this.glide = null
    this.cancelLevel()
    const h0 = this.headingDeg(e, aspect, now)
    this.northReset = Math.abs(h0) < 0.05 ? null : { t0: now, h0, done: 0 }
    this.lastInputAt = now
  }

  /**
   * Forward (positive `px`) or back along the view direction projected onto the surface: the camera flies over the ground at its
   * altitude (the distance from the Moon's centre does not change; only the floor can lift it), with the heading and tilt it had.
   * `px` is in the units of a drag (CSS px of the short side), so a step is the same share of the frame at any height.
   */
  moveForward(px: number, shortCss: number, e: Ephemeris, aspect: number, now: number): void {
    this.moveAlong(false, px, shortCss, e, aspect, now)
  }

  /** Strafe: the same move sideways (positive `px` to the right). */
  moveSideways(px: number, shortCss: number, e: Ephemeris, aspect: number, now: number): void {
    this.moveAlong(true, px, shortCss, e, aspect, now)
  }

  private moveAlong(sideways: boolean, px: number, shortCss: number, e: Ephemeris, aspect: number, now: number): void {
    if (this.mode !== 'fly' || this.frozen) return
    this.glide = null
    this.northReset = null
    const radPerPx = spinRadiansPerPixel(this.pose.dist - 1 - this.groundAt(this.pose.lon, this.pose.lat), this.fovDeg, shortCss)
    const cam = this.camera(e, aspect, now)
    const rot = surfaceMove(cam.pos, sideways ? rightTangent(cam) : forwardTangent(cam), Math.sign(px) * Math.min(Math.abs(px) * radPerPx, MAX_GESTURE_STEP_RAD))
    if (rot.angle !== 0) this.rotateCamera(rot, e, now, 'move')
  }

  /** A world rotation of the shown view, written into the free orientation (offset' = qBase^-1 R qBase offset). */
  private rotateView(rot: Rotation, e: Ephemeris): void {
    if (!this.settledOffset) return
    const b = poseBasis(e, this.pose)
    const qBase = quatFromBasis(b.right, b.up, b.back)
    const R = new Quaternion().setFromAxisAngle(rot.axis, rot.angle)
    this.settledOffset = qBase.clone().invert().multiply(R).multiply(qBase).multiply(this.settledOffset).normalize()
  }

  /**
   * Keeps the Moon in the picture while zooming out with a free orientation: the view turns toward it until its centre is
   * within `maxFrac` of the half frame of the middle. Only a free orientation (settledOffset) can drift off; a look at a body
   * is deliberate and stays.
   */
  private recentre(factor: number, e: Ephemeris, aspect: number, now: number, maxFrac = 0.5): void {
    if (!this.settledOffset) return
    const cam = this.camera(e, aspect, now)
    // Decided once per gesture (steps less than GESTURE_GAP_MS apart): a Moon whose centre starts outside the frame is a
    // deliberate look away (Look at Earth, then a touch settled it), so it is left alone.
    if (now - this.lastRecentreAt > GESTURE_GAP_MS) {
      const halfDiag = Math.atan(cam.tanHalf * Math.hypot(1, aspect))
      this.recentreOn = moonOffAxis(cam) <= halfDiag
    }
    this.lastRecentreAt = now
    if (!this.recentreOn) return
    // The turn per step is rate-limited, so a pinch unwinds a tilt gradually instead of snapping the view.
    const rot = recentreRotation(cam, maxFrac, aspect, RECENTRE_RAD_PER_LN * Math.log(factor))
    if (rot) this.rotateView(rot, e)
  }

  /** Turns the pose by (dLon, dLat) deg under the floor and latitude limits; returns the change actually made. */
  private turnBy(dLon: number, dLat: number): { lon: number; lat: number } {
    const lon0 = this.pose.lon, lat0 = this.pose.lat
    const crossed = crossPole(lon0, lat0, dLon, dLat, this.pose.roll)
    this.pose.lon = crossed.lon
    this.pose.lat = crossed.lat
    this.pose.roll = crossed.roll
    // Leaving the site lifts the floor (its funnel): keep the camera above it.
    this.endSettleExemption(this.pose.lon, this.pose.lat)
    if (!this.settledFreeDistance) this.pose.dist = Math.max(this.pose.dist, this.floorAt(this.pose.lon, this.pose.lat))
    if ((this.pose.pitch ?? 0) > this.pitchLimit()) this.pose.pitch = this.pitchLimit()
    const dl = wrapLon(this.pose.lon - lon0)
    return { lon: dl, lat: this.pose.lat - lat0 }
  }

  /** The drag ended: a fast release carries on and slows down (INERTIA_TAU_S), a held or slow one stops. */
  release(now: number): void {
    if (now - this.lastOrbitAt > 80) { this.vel.lon = 0; this.vel.lat = 0; this.spinVel.set(0, 0, 0) }
    // A twist of this gesture was the visitor's own roll: it stays.
    if (this.gestureTwisted) this.levelPending = false
    this.gestureTwisted = false
  }

  /** A cancelled gesture (pointercancel, lost capture, page hidden): no release velocity is trusted, so nothing coasts and nothing is left to level. */
  abandonGesture(): void {
    this.stopInertia()
    this.gestureTwisted = false
    this.cancelLevel()
  }

  /** Stops any inertia now (a finger came down on the Moon). */
  stopInertia(): void { this.vel.lon = 0; this.vel.lat = 0; this.spinVel.set(0, 0, 0) }

  /** A pose, a look or a hand takes the view: whatever levelling was pending or under way is dropped. */
  private cancelLevel(): void { this.levelPending = false; this.level = null }

  /** Levelling to lunar-north-up is allowed here: free orbiting of the Moon, not near a pole, not under a script or a free orientation. */
  private canLevel(): boolean {
    return this.mode === 'fly' && !this.frozen && !this.dragging && !this.glide
      && this.lookTarget === null && !this.lookRunning && this.settledOffset === null
      && Math.abs(this.pose.lat) <= 90 - LEVEL_POLE_DEG
      && this.effectivePitch() < 1 // tilted toward the horizon the roll is the heading: it stays
  }

  /** True while a roll levelling is under way or waiting for the coasting to end. */
  levelling(): boolean { return this.levelPending || this.level !== null }

  /** True while the camera only carries out the tail of a user's input: inertia coasting, or a roll levelling under way or pending. Not while dragging or in a fly-to. */
  settling(): boolean {
    if (this.dragging || this.glide) return false
    return this.levelling() || this.spinVel.length() > INERTIA_STOP_DEG_S || Math.abs(this.vel.lon) > INERTIA_STOP_DEG_S || Math.abs(this.vel.lat) > INERTIA_STOP_DEG_S
  }

  /** Whether a tilt does anything: at every distance now (in orbit it tilts toward the limb, within tiltLimit). */
  canTilt(): boolean { return this.mode === 'fly' && !this.frozen }

  /** The tilt shown, deg: the visitor's own is felt at every distance (up to tiltLimit); a scripted pose's only near the ground (reliefShare). */
  effectivePitch(): number {
    const p = this.pose.pitch ?? 0
    return this.tiltOwn ? Math.min(p, this.tiltLimit()) : p * reliefShare(this.pose.dist)
  }

  /** Whether the pose's pitch shows at all (for a share link: it is written only then). */
  tiltFelt(): boolean { return this.tiltOwn ? (this.pose.pitch ?? 0) > 0 : reliefShare(this.pose.dist) > 0 }

  /** A pitch from a share link or capture, felt at every distance like the visitor's own. */
  restoreTilt(pitchDeg: number): void {
    this.pose.pitch = Math.max(0, Math.min(this.pitchLimit(), pitchDeg))
    this.tiltOwn = this.pose.pitch > 0
  }

  /** The most the view may tilt at this distance: pitchLimit near the surface, the Moon's limb in orbit (fly.ts tiltLimitDeg). */
  tiltLimit(): number { return tiltLimitDeg(this.pose.dist, this.pitchLimit(), this.fovDeg, reliefShare(this.pose.dist)) }

  /**
   * Tilt: a vertical drag (CSS px) toward the horizon (down) or back to
   * straight down (up). One px turns the view by the angle one px spans. Works at every distance: in orbit the camera
   * tilts away from straight down, to at most tiltLimit (so the Moon stays in view).
   */
  tilt(dyCss: number, shortCss: number, now: number): void {
    if (this.mode !== 'fly' || this.frozen) return
    this.glide = null
    this.northReset = null
    if (!this.tiltOwn) { this.pose.pitch = (this.pose.pitch ?? 0) * reliefShare(this.pose.dist); this.tiltOwn = true }
    const k = this.fovDeg / Math.max(1, shortCss)
    this.pose.pitch = Math.max(0, Math.min(this.tiltLimit(), (this.pose.pitch ?? 0) + dyCss * k))
    if (this.pose.pitch === 0) this.tiltOwn = false
    this.lastInputAt = now
  }

  /** The largest tilt here: nearly to the horizon over a mountain site (within about 60 km of it), else PITCH_MAX. */
  pitchLimit(): number {
    const st = this.site
    return st?.terrain && angularDistance(this.pose.lon, this.pose.lat, st.lon, st.lat) < 0.035 ? SITE_PITCH_MAX : PITCH_MAX
  }

  /** Pinch and wheel: distance by a factor. Past a limit the pose stays on it and the picture stretches a little (rubber), then springs back. */
  zoom(factor: number, now: number): void {
    if (this.mode !== 'fly' || this.frozen) return
    this.glide = null
    const zoomed = zoomDist(this.pose.dist, factor, this.groundAt(this.pose.lon, this.pose.lat))
    const lo = this.floorAt(this.pose.lon, this.pose.lat)
    const limit = this.settledFreeDistance
      ? zoomed > this.pose.dist
        ? zoomed > Math.max(D_MAX, this.pose.dist)
        : zoomed < Math.min(this.pose.dist, lo)
      : zoomed !== clampDist(zoomed, lo)
    if (limit && now - this.lastLimitHitAt >= 150) {
      this.limitHits++
      this.lastLimitHitAt = now
    }
    if (this.settledFreeDistance) {
      // The far limit holds here too: without it a camera freed mid-journey zoomed out for ever, past the Moon's picture.
      // Already past the limit (settled from farther out): zooming in acts normally, zooming out stays put.
      const lowered = Math.max(Math.min(this.pose.dist, lo), zoomed)
      this.pose.dist = zoomed > this.pose.dist ? Math.min(zoomed, Math.max(D_MAX, this.pose.dist)) : lowered
    } else {
      const clamped = clampDist(zoomed, lo)
      // Past the far limit, or past a floor that is far enough out to see the stretch; the ground floors of a site stay hard.
      const pushing = zoomed !== clamped && (zoomed > clamped || lo > 1.2)
      if (pushing) this.overshoot = Math.max(-Math.log(RUBBER_MAX), Math.min(Math.log(RUBBER_MAX), this.overshoot + Math.log(zoomed / clamped)))
      else if (this.overshoot !== 0) {
        // Moving back inside the limits first unwinds the stretch, so the picture never jumps.
        const unwind = Math.log(Math.max(factor, 1 / factor))
        this.overshoot = this.overshoot > 0 ? Math.max(0, this.overshoot - unwind) : Math.min(0, this.overshoot + unwind)
      }
      this.pose.dist = clamped
    }
    this.lastZoomAt = now
    this.dropIdlePitch()
    this.lastInputAt = now
  }

  /**
   * Zoom (wheel, pinch, + and -, the keys) toward the centre of the view, never the cursor: the distance changes and nothing
   * else, so the Moon does not turn and the heading and roll stay as they are (owner, 10 Oct 2026: "should just zoom in where I
   * am"). The one exception is the free-orientation recentre when zooming out, which only moves a Moon that is off the frame.
   */
  zoomCentre(factor: number, e: Ephemeris, aspect: number, now: number): void {
    if (this.mode !== 'fly' || this.frozen) return
    this.lastZoomInputAt = now
    // A hand on the zoom stops any coasting: a drift after the zoom would carry the centre target away (wheel and pinch already do this).
    this.stopInertia()
    if (this.dollyCentre(factor, e, aspect, now)) return
    this.zoom(factor, now)
    if (factor > 1) this.recentre(factor, e, aspect, now)
  }

  /**
   * Zoom as a dolly along the centre ray (dolly.ts) of the camera AS RENDERED: the camera translates toward or away from the
   * ground point under the middle of the screen and keeps its rendered orientation, so that point stays exactly there. The
   * rendered orientation includes the pitch (faded or not), a free orientation (a shared link's `off`) and the layout aim shift;
   * the pose is re-solved from it, so nothing is applied twice. Limits clamp the step along the ray (the floor under the
   * destination, the far limit); no zoom ever turns radial because of them. Returns false (the caller zooms by distance, as it
   * always did) only where the centre ray misses the Moon (sky or limb), where the view looks straight down (the two are the
   * same), when a look at a body is on, or while the rubber band is stretched.
   */
  private dollyCentre(factor: number, e: Ephemeris, aspect: number, now: number): boolean {
    if (this.lookTarget || this.overshoot !== 0) return false
    const aim = this.aimShift !== 0 || this.aimShiftX !== 0
    if (!aim && !this.settledOffset && this.effectivePitch() < 0.01) return false
    const cam = this.camera(e, aspect, now)
    const fwd = cam.back.clone().negate()
    const dist = cam.pos.length()
    const newDist = zoomDist(dist, factor, this.groundAt(this.pose.lon, this.pose.lat))
    const groundOfDir = (d: Vector3): number => { const ll = lonLatOfDir(e, d); return this.groundAt(ll.lon, ll.lat) }
    const target = dollyPosition(cam.pos, fwd, newDist, groundOfDir)
    if (!target) return false
    // ONE floor for the camera and the dolly: the real one (`floorAt`, what the radial clamp obeys), so the dolly is never stricter than the rest
    // of the camera. That floor is a sampled search and can step, so, to keep the walk from tunnelling through a region it steps over, it is
    // also capped by a CONTINUOUS cone (dolly.ts coneFloor) anchored on real floor values found along this step and at earlier steps
    // (`floorAnchors`): the lowest of the two. The cone is at or above the true cone floor of the data and the true floor is 2-Lipschitz,
    // so the walk (strides of clearance / (1 + L)) cannot cross it; over constant-resolution coverage the real floor is below the cone
    // everywhere, so the floor used is exactly `floorAt`, with no bumps.
    const realFloor = (p: Vector3): number => { const ll = lonLatOfDir(e, p.clone().normalize()); return this.floorAt(ll.lon, ll.lat) }
    let floorAt = realFloor
    if (this.deepTexelFloor || this.deepFloor) {
      const SAMPLES = 48
      const sourceAt = (q: Vector3): number => {
        const ll = lonLatOfDir(e, q)
        return Math.min(this.deepTexelFloor ? this.deepTexelFloor(ll.lon, ll.lat) : Infinity, this.deepFloor ? this.deepFloor(ll.lon, ll.lat) : Infinity)
      }
      // The floor depends on the canvas size, the lens and the data: anchors belong to one set of those inputs (the floor functions, which the
      // app rebuilds on a resize or a new manifest, and the lens) and are dropped when it changes; the ones kept are RE-READ now, never reused as cached.
      const key = this.anchorKey
      if (key.deep !== this.deepFloor || key.texel !== this.deepTexelFloor || key.fov !== this.fovDeg) { this.floorAnchors = []; this.anchorKey = { deep: this.deepFloor, texel: this.deepTexelFloor, fov: this.fovDeg } }
      this.floorAnchors = this.floorAnchors.map((a) => ({ dir: a.dir, floor: sourceAt(a.dir) })).filter((a) => Number.isFinite(a.floor))
      const dirs: Vector3[] = this.floorAnchors.map((a) => a.dir), floors: number[] = this.floorAnchors.map((a) => a.floor)
      const found: Array<{ dir: Vector3; floor: number }> = []
      for (let j = 0; j <= SAMPLES; j++) {
        const q = cam.pos.clone().lerp(target, j / SAMPLES).normalize()
        const v = sourceAt(q)
        if (!Number.isFinite(v)) continue
        dirs.push(q); floors.push(v)
        if (j === 0 || j === SAMPLES) found.push({ dir: q, floor: v })
      }
      if (dirs.length) {
        const cone = coneFloor(dirs, floors, SITE_CONE)
        floorAt = (p: Vector3): number => Math.min(realFloor(p), cone(p))
      }
      for (const f of found) if (!this.floorAnchors.some((a) => a.dir.dot(f.dir) > 1 - 1e-14)) this.floorAnchors.push(f)
      if (this.floorAnchors.length > 16) { this.floorAnchors.sort((x, y) => x.floor - y.floor); this.floorAnchors.length = 16 }
    }
    // Limits along the ray: not past the far limit (or where the camera already is, if beyond it), not below the floor under each point.
    // A camera already at or below the floor is standing on it (clampAlong: leaves outward only).
    const far = Math.max(D_MAX, dist)
    // The far limit only bounds a zoom OUT. A zoom in moves toward the Moon, so counting it would make a camera standing exactly on D_MAX (the phone's
    // framed Home sits there) read as "standing on a limit, moving toward the surface" in clampAlong and block every zoom-in (owner, Android, 19,111 km).
    const clearance = (p: Vector3): number => { const d = p.length(); return factor > 1 ? Math.min(far - d, d - floorAt(p)) : d - floorAt(p) }
    const next = clampAlong(cam.pos, target, clearance)
    const achieved = next.distanceTo(cam.pos), requested = target.distanceTo(cam.pos)
    const truncated = achieved < 0.999 * requested
    const pulse = (): void => { if (now - this.lastLimitHitAt >= 150) { this.limitHits++; this.lastLimitHitAt = now } }
    // A zoom OUT is never blocked: a visitor can always back off. Where the dolly along the centre ray is cut short (the floor rises faster
    // than the camera climbs along it), the rest of the step is RADIAL: straight up from the Moon's centre, which keeps the orientation and
    // always gains clearance (the floor under the same point is constant). The centre target shifts slightly in that case only.
    const radialRest = (): boolean => {
      const d1 = this.pose.dist
      const d2 = Math.min(Math.max(d1, newDist), Math.max(D_MAX, d1))
      if (d2 > d1 + 1e-12) { this.pose.dist = d2; return true }
      return false
    }
    if (achieved < 1e-9) {
      // Blocked along the ray. A zoom out rises radially; a zoom in stays put and pulses the limit feedback.
      if (factor > 1) { if (!radialRest()) pulse() } else pulse()
      this.glide = null
      this.lastZoomAt = now
      this.lastInputAt = now
      return true
    }
    // A zoom in cut short by a limit (the floor, a ridge ahead) pulses the limit feedback; a zoom out finishes radially (below).
    if (truncated && factor <= 1) pulse()
    // The orientation as rendered, without the aim (flyEnd applies the aim on top of the pose).
    const qView = quatFromBasis(cam.right, cam.up, cam.back)
    const tanHalf = flyTanHalf(aspect, this.fovDeg)
    const qNoAim = qView.clone()
    if (this.aimShiftX) qNoAim.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan(this.aimShiftX * tanHalf * aspect)).invert())
    if (this.aimShift) qNoAim.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.atan(this.aimShift * tanHalf)).invert())
    const u = lonLatOfDir(e, next.clone().normalize())
    const place = { lon: wrapLon(u.lon), lat: Math.max(-89.9, Math.min(89.9, u.lat)), dist: next.length() }
    const nb = basisFromQuat(qNoAim)
    if (this.settledOffset) {
      // A free orientation: the pitch on top of it (the visitor's own tilt) is kept as it is felt now, the offset takes the rest.
      const pe = this.effectivePitch()
      const base = poseBasis(e, { ...place, roll: 0 })
      const limitHere = tiltLimitDeg(place.dist, this.pitchLimit(), this.fovDeg, reliefShare(place.dist))
      if (pe > limitHere - 1e-6) {
        // The tilt would be cut at the destination: carry the whole rendered orientation (pitch included) as the free one.
        this.pose = { ...this.pose, ...place, roll: 0, pitch: 0 }
        this.tiltOwn = false
        this.settledOffset = quatFromBasis(base.right, base.up, base.back).invert().multiply(qNoAim).normalize()
      } else {
        if (pe && !this.tiltOwn) { this.pose.pitch = pe; this.tiltOwn = true }
        const qNoPitch = pe ? qNoAim.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -pe * Math.PI / 180)) : qNoAim
        this.settledOffset = quatFromBasis(base.right, base.up, base.back).invert().multiply(qNoPitch).normalize()
        this.pose = { ...this.pose, ...place, roll: 0 }
      }
    } else {
      const solved = poseFromView(e, { pos: next, right: nb.right, up: nb.up, back: nb.back, tanHalf })
      const pitch = solved.pitch ?? 0
      const limitHere = tiltLimitDeg(place.dist, this.pitchLimit(), this.fovDeg, reliefShare(place.dist))
      if (pitch >= -1e-9 && pitch <= limitHere - 1e-6) {
        // The pitch is felt at every distance from here on (as the visitor's own tilt is): fading it would turn the view.
        this.pose = { ...place, roll: solved.roll, pitch: Math.max(0, pitch) }
        this.tiltOwn = pitch > 1e-9
      } else {
        // Beyond what a pose can say (backwards, or past the tilt limit): carry the orientation as a free one.
        const base = poseBasis(e, { ...place, roll: 0 })
        this.pose = { ...place, roll: 0, pitch: 0 }
        this.tiltOwn = false
        this.settledOffset = quatFromBasis(base.right, base.up, base.back).invert().multiply(qNoAim).normalize()
      }
    }
    if (truncated && factor > 1) radialRest()
    this.glide = null
    this.northReset = null
    this.lastZoomAt = now
    this.lastInputAt = now
    return true
  }

  /** The pose that centres the point of the Moon under a frame spot and halves the altitude, for a double tap; null over the sky. */
  doubleTapPose(nx: number, ny: number, e: Ephemeris, aspect: number, now: number): Pose | null {
    const P = pickSphere(this.camera(e, aspect, now), nx, ny, aspect)
    if (!P) return null
    const ll = lonLatOfDir(e, P)
    const dist = clampDist(zoomDist(this.pose.dist, 0.5, this.groundAt(ll.lon, ll.lat)), this.floorAt(ll.lon, ll.lat))
    return { ...this.pose, lon: wrapLon(ll.lon), lat: Math.max(-89, Math.min(89, ll.lat)), dist }
  }

  /**
   * A continuous fly-to from where the camera is to `to`: position along the great circle, distance and lens on log scales,
   * one quintic ease for all of it, 1.5 to 3 s (flyDurationMs). A gesture during it takes over from the camera as it is
   * (takeOver). `lens` and `aim` set the lens and the aim shifts the move ends with (the current ones when absent).
   */
  glideTo(to: Pose, now: number, lens?: { fovDeg?: number; aimShift?: number; aimShiftX?: number }, ms?: number): void {
    this.cancelLevel()
    this.northReset = null
    this.tiltOwn = false
    const end: Pose = { ...to, lat: Math.max(-89, Math.min(89, to.lat)), lon: wrapLon(to.lon), dist: clampDist(to.dist, this.floorAt(to.lon, to.lat)) }
    const from = { ...this.pose }
    // The short way round in longitude.
    end.lon = from.lon + wrapLon(end.lon - from.lon)
    this.stopInertia()
    if (this.instant) { this.setPose({ ...end, lon: wrapLon(end.lon) }); this.fovDeg = lens?.fovDeg ?? this.fovDeg; this.aimShift = lens?.aimShift ?? this.aimShift; this.aimShiftX = lens?.aimShiftX ?? this.aimShiftX; return }
    this.glide = {
      t0: now, ms: ms ?? flyDurationMs(from, end), from, to: end,
      fov0: this.fovDeg, fov1: lens?.fovDeg ?? this.fovDeg,
      aim0: this.aimShift, aim1: lens?.aimShift ?? this.aimShift,
      aimX0: this.aimShiftX, aimX1: lens?.aimShiftX ?? this.aimShiftX,
    }
    this.lastInputAt = now
  }

  /** Measurement only (`__moon.nav.rig`): the state a drag depends on. */
  /** Debug (camTrace): the look turn at `now`: progress, the offset it starts from, the one it ends on and the one shown (x, y, z, w). */
  lookDebug(e: Ephemeris, aspect: number, now: number): Record<string, unknown> {
    const b = poseBasis(e, this.pose)
    const qBase = quatFromBasis(b.right, b.up, b.back)
    const q = (v: Quaternion): number[] => [v.x, v.y, v.z, v.w]
    return { s: (now - this.lookT0) / this.lookMs, ms: this.lookMs, from: q(this.lookFrom), target: q(this.targetOffset(qBase, aspect)), shown: q(this.offsetFor(qBase, aspect, now)),
      kind: this.settledOffset ? 'settled' : this.lookTarget === null ? 'moon' : typeof this.lookTarget === 'function' ? 'body' : 'dir', w: this.lookBlendW }
  }

  debugState(): Record<string, unknown> {
    const q = this.settledOffset
    return {
      pose: { ...this.pose }, fovDeg: this.fovDeg, aimShift: this.aimShift, aimShiftX: this.aimShiftX, mode: this.mode,
      settledOffset: q ? [q.x, q.y, q.z, q.w] : null, lookTarget: this.lookTarget === null ? null : typeof this.lookTarget === 'function' ? 'body' : 'dir',
      lookBlendW: this.lookBlendW, lookRunning: this.lookRunning, overshoot: this.overshoot, instant: this.instant, vel: { ...this.vel },
    }
  }

  /** A fly-to (glideTo) is under way. */
  gliding(): boolean { return this.glide !== null }

  /**
   * The visitor (or another mover) takes the camera over: any fly-to and inertia stop where they are, and what the camera was
   * doing is returned so a new move can start from it without a jump or a stop. Never settles the camera into a free pose.
   */
  takeOver(now: number): TakeOver {
    this.cancelLevel()
    this.gestureTwisted = false
    const g = this.glide
    let velocity = { lon: this.vel.lon, lat: this.vel.lat, octaves: 0 }
    // A coasting trackball turn, as the longitude and latitude rates of the point under the camera.
    const spin = this.spinVel.length()
    if (!g && spin > 1e-9) {
      const h = 0.016
      const back = poseBasis(BODY, this.pose).back
      const next = lonLatOfDir(BODY, back.clone().applyAxisAngle(this.spinVel.clone().normalize(), spin * Math.PI / 180 * h))
      velocity = { lon: wrapLon(next.lon - this.pose.lon) / h, lat: (next.lat - this.pose.lat) / h, octaves: 0 }
    }
    if (g) {
      const h = 0.016
      const a = smootherstep((now - g.t0) / g.ms), b = smootherstep((now - g.t0 + h * 1000) / g.ms)
      velocity = {
        lon: (g.to.lon - g.from.lon) * (b - a) / h, lat: (g.to.lat - g.from.lat) * (b - a) / h,
        octaves: Math.log2(g.to.dist / g.from.dist) * (b - a) / h,
      }
    }
    this.glide = null
    // A fly-to that was running hands its speed on as inertia, which dies away over INERTIA_TAU_S: the move blends out instead of stopping dead.
    if (g) { this.vel.lon = velocity.lon; this.vel.lat = velocity.lat }
    this.lastInputAt = now
    return { pose: { ...this.pose }, fovDeg: this.fovDeg, aimShift: this.aimShift, aimShiftX: this.aimShiftX, velocity }
  }

  /** True while something other than free orbiting holds the camera: a look offset, a settled offset, a held dolly zoom or a mode other than 'fly'. */
  hasScriptState(): boolean {
    return this.lookTarget !== null || this.settledOffset !== null
  }

  /** A scripted look still controls the view while it is active or settling; a user-freed orientation does not. */
  hasActiveScriptState(now?: number): boolean {
    return this.lookTarget !== null || this.lookRunning || (now !== undefined && this.lookingAt(now))
  }

  /** Turns the view toward a world direction (or a body to follow). */
  lookToward(target: LookTarget, animate: boolean, now: number, e: Ephemeris, aspect: number, ms = LOOK_MS, holdMs = 0): void {
    this.cancelLevel()
    // The view on screen is the running turn's, at ITS length: measured before the new length is set (a re-plan mid-turn snapped the view by the change).
    this.lookFrom = this.currentOffset(e, aspect, now)
    this.lookMs = ms
    this.settledOffset = null
    this.lookBlendW = 0
    this.lookTarget = target
    this.lookT0 = animate && !this.instant ? now + Math.max(0, holdMs) : -1e9
    this.lookRef = null
  }

  /** Turns the view back to the Moon's centre. */
  lookAtMoon(animate: boolean, now: number, e: Ephemeris, aspect: number, ms = LOOK_MS, holdMs = 0): void {
    this.cancelLevel()
    // The view on screen is the running turn's, at ITS length: measured before the new length is set (a re-plan mid-turn snapped the view by the change).
    this.lookFrom = this.currentOffset(e, aspect, now)
    this.lookMs = ms
    this.settledOffset = null
    this.lookBlendW = 0
    this.lookTarget = null
    this.lookT0 = animate && !this.instant ? now + Math.max(0, holdMs) : -1e9
    this.lookRef = null
  }

  /** How much of the look points at the Earth (1: all of it), for a link that must reopen looking the same way. */
  get earthLook(): number { return this.lookTarget ? this.lookBlendW : 0 }

  snapshotLookBlend(): LookBlendState {
    return { target: this.lookTarget, blendW: this.lookBlendW, from: this.lookFrom.clone(), t0: this.lookT0, ms: this.lookMs, running: this.lookRunning, settledOffset: this.settledOffset?.clone() ?? null, ref: this.lookRef?.clone() ?? null }
  }

  restoreLookBlend(state: LookBlendState): void {
    this.lookTarget = state.target
    this.lookBlendW = state.blendW
    this.lookFrom.copy(state.from)
    this.lookT0 = state.t0
    this.lookMs = state.ms
    this.lookRunning = state.running
    this.settledOffset = state.settledOffset?.clone() ?? null
    this.lookRef = state.ref?.clone() ?? null
  }

  /** The free orientation a grab in mid-flight left (the turn from the pose's own view, as x, y, z, w), or null. */
  freeOrientation(): [number, number, number, number] | null {
    const q = this.settledOffset
    return q ? [q.x, q.y, q.z, q.w] : null
  }

  /** Restores a free orientation from a link (freeOrientation's numbers). */
  setFreeOrientation(q: [number, number, number, number]): void {
    this.cancelLevel()
    this.settledOffset = new Quaternion(q[0], q[1], q[2], q[3]).normalize()
    this.lookTarget = null; this.lookBlendW = 0; this.lookT0 = -1e9; this.lookRunning = false
  }

  /** Advances transitions, the idle orbit and look turns; true if the camera moved. */
  step(now: number, dt: number): boolean {
    // A frame can take longer than what is left of a look turn, so the turn
    // counts as motion until a step has seen it finished.
    const looking = now - this.lookT0 < this.lookMs
    let moved = looking || this.lookRunning
    this.lookRunning = looking
    if (this.mode === 'fly' && !this.frozen) {
      if (this.glide) {
        const g = this.glide
        const u = (now - g.t0) / g.ms
        const k = smootherstep(u)
        const lerp = (a: number, b: number): number => a + (b - a) * k
        this.pose = {
          lon: wrapLon(lerp(g.from.lon, g.to.lon)), lat: lerp(g.from.lat, g.to.lat),
          dist: Math.exp(lerp(Math.log(g.from.dist), Math.log(g.to.dist))),
          roll: lerp(g.from.roll, g.to.roll), pitch: lerp(g.from.pitch ?? 0, g.to.pitch ?? 0),
        }
        this.fovDeg = Math.exp(lerp(Math.log(g.fov0), Math.log(g.fov1)))
        this.aimShift = lerp(g.aim0, g.aim1)
        this.aimShiftX = lerp(g.aimX0, g.aimX1)
        if (u >= 1) this.glide = null
        this.lastInputAt = now
        moved = true
      } else if (!this.dragging && this.spinVel.length() > INERTIA_STOP_DEG_S) {
        // The coasting of a trackball drag is the same turn of the camera about the Moon's centre, slowing down: no twist of the picture.
        const speed = this.spinVel.length()
        this.rotateCamera({ axis: this.spinVel.clone().divideScalar(speed), angle: speed * dt * Math.PI / 180 }, BODY, now, 'coast')
        this.spinVel.multiplyScalar(Math.exp(-dt / INERTIA_TAU_S))
        if (this.spinVel.length() <= INERTIA_STOP_DEG_S) this.stopInertia()
        this.lastInputAt = now
        moved = true
      } else if (!this.dragging && (Math.abs(this.vel.lon) > INERTIA_STOP_DEG_S || Math.abs(this.vel.lat) > INERTIA_STOP_DEG_S)) {
        this.turnBy(this.vel.lon * dt, this.vel.lat * dt)
        const decay = Math.exp(-dt / INERTIA_TAU_S)
        this.vel.lon *= decay
        this.vel.lat *= decay
        if (Math.abs(this.vel.lon) <= INERTIA_STOP_DEG_S && Math.abs(this.vel.lat) <= INERTIA_STOP_DEG_S) this.stopInertia()
        this.lastInputAt = now
        moved = true
      } else if (this.auto && !this.dragging && now - this.lastInputAt > IDLE_MS) {
        this.pose.lon = wrapLon(this.pose.lon + dt * ORBIT_DEG_PER_S)
        moved = true
      }
      if (this.stepNorth(now)) moved = true
      if (this.stepLevel(now)) moved = true
      if (this.overshoot !== 0 && now - this.lastZoomAt > RUBBER_HOLD_MS) {
        this.overshoot *= Math.exp(-dt / RUBBER_TAU_S)
        if (Math.abs(this.overshoot) < 1e-4) this.overshoot = 0
        moved = true
      }
    }
    return moved
  }

  /**
   * Eases the roll back to lunar-north-up over LEVEL_MS once a drag and its coasting are over. The view turns about the line through the
   * Moon's centre and the point under the middle of the frame, so that point stays where it is (with a layout aim or a tilt too). True while moving.
   */
  private stepNorth(now: number): boolean {
    const r = this.northReset
    if (!r) return false
    const u = (now - r.t0) / NORTH_MS
    const target = r.h0 * smootherstep(u)
    this.turnHeading(-(target - r.done), now, true)
    r.done = target
    if (u >= 1) this.northReset = null
    return true
  }

  private stepLevel(now: number): boolean {
    const coasting = this.spinVel.length() > INERTIA_STOP_DEG_S || Math.abs(this.vel.lon) > INERTIA_STOP_DEG_S || Math.abs(this.vel.lat) > INERTIA_STOP_DEG_S
    if (this.levelPending && !this.dragging && !this.glide && !coasting) {
      this.levelPending = false
      const roll = ((this.pose.roll || 0) + 540) % 360 - 180
      if (this.canLevel() && Math.abs(roll) > LEVEL_DONE_DEG && Math.abs(roll) <= LEVEL_MAX_DEG) this.level = { t0: now, roll0: roll }
    }
    const lv = this.level
    if (!lv) return false
    if (!this.canLevel() || coasting) { this.level = null; return false }
    const u = (now - lv.t0) / LEVEL_MS
    const target = u >= 1 ? 0 : lv.roll0 * (1 - smootherstep(u))
    const roll = ((this.pose.roll || 0) + 540) % 360 - 180
    const beta = (target - roll) * Math.PI / 180
    if (Math.abs(beta) > 1e-12) {
      const cam = this.camera(BODY, this.lastAspect, now)
      const centre = pickSphere(cam, 0, 0, this.lastAspect) ?? cam.back
      this.rotateCamera({ axis: centre, angle: beta }, BODY, now, 'level')
    }
    if (u >= 1) this.level = null
    this.lastInputAt = now
    return true
  }

  private flyEnd(e: Ephemeris, aspect: number, now: number): CamEnd {
    const b = poseBasis(e, this.pose)
    const qBase = quatFromBasis(b.right, b.up, b.back)
    const tanHalf = flyTanHalf(aspect, this.fovDeg)
    const qView = qBase.clone().multiply(this.offsetFor(qBase, aspect, now))
    // Tilt toward the horizon (near the ground only): a turn about the camera's own right axis.
    const pitch = this.effectivePitch()
    if (pitch) qView.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch * Math.PI / 180))
    if (this.aimShift) qView.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.atan(this.aimShift * tanHalf)))
    if (this.aimShiftX) qView.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan(this.aimShiftX * tanHalf * aspect)))
    return { qBase, qView, dist: this.pose.dist * Math.exp(this.overshoot), tanHalf }
  }

  private fromEnd(c: CamEnd): ViewCamera {
    const base = basisFromQuat(c.qBase)
    const view = basisFromQuat(c.qView)
    return { pos: base.back.multiplyScalar(c.dist), right: view.right, up: view.up, back: view.back, tanHalf: c.tanHalf }
  }

  /** The look offset now, in the look-at view's frame, easing over LOOK_MS. */
  private offsetFor(qBase: Quaternion, aspect: number, now: number): Quaternion {
    const target = this.targetOffset(qBase, aspect)
    const s = (now - this.lookT0) / this.lookMs
    if (s >= 1) return target
    const t = continuousTarget(target, this.lookRef, this.lookFrom)
    this.lookRef = t
    return slerpAsGiven(this.lookFrom, t, smoothstep(s))
  }

  private targetOffset(qBase: Quaternion, aspect: number): Quaternion {
    if (this.settledOffset) return this.settledOffset.clone()
    if (!this.lookTarget) return new Quaternion()
    let dir: Vector3
    if (typeof this.lookTarget === 'function') {
      // A body to follow: its direction from where the camera is now.
      const b = basisFromQuat(qBase)
      const cam: ViewCamera = { pos: b.back.clone().multiplyScalar(this.pose.dist), ...b, tanHalf: flyTanHalf(aspect, this.fovDeg) }
      dir = this.lookTarget(cam).clone()
    } else {
      dir = this.lookTarget.clone()
    }
    // Into the look-at view's frame; then the turn that brings its forward
    // axis (-z) onto the target with its up kept as upright as possible.
    const local = dir.normalize().applyQuaternion(qBase.clone().invert())
    const back = local.negate()
    let up = new Vector3(0, 1, 0).addScaledVector(back, -back.y)
    if (up.length() < 1e-6) up = new Vector3(0, 0, 1).addScaledVector(back, -back.z)
    up.normalize()
    return quatFromBasis(new Vector3().crossVectors(up, back), up, back)
  }

  private currentOffset(e: Ephemeris, aspect: number, now: number): Quaternion {
    const b = poseBasis(e, this.pose)
    return this.offsetFor(quatFromBasis(b.right, b.up, b.back), aspect, now)
  }
}
