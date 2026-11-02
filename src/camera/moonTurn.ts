import { Matrix3, Quaternion, Vector3 } from 'three'
import type { Ephemeris } from '../ephemeris'
import type { Rotation } from './grab'

const INERTIA_TAU_S = 0.35
const INERTIA_STOP_RAD_S = 0.5 * Math.PI / 180
const INERTIA_MAX_RAD_S = 30 * Math.PI / 180
export const MOON_TURN_PITCH_MAX = 60 * Math.PI / 180

/** Apply a world-space turn to the Moon's body frame, leaving the Sun and Earth in their world positions. */
export function turnEphemeris(e: Ephemeris, turn: Quaternion): Ephemeris {
  const moonX = e.moonX.clone().applyQuaternion(turn).normalize()
  const moonY = e.moonY.clone().applyQuaternion(turn).normalize()
  const moonZ = e.moonZ.clone().applyQuaternion(turn).normalize()
  const moonToWorld = new Matrix3().set(
    moonX.x, moonY.x, moonZ.x,
    moonX.y, moonY.y, moonZ.y,
    moonX.z, moonY.z, moonZ.z,
  )
  const bodyPoint = (dir: Vector3) => ({
    lon: Math.atan2(dir.dot(moonY), dir.dot(moonX)) * 180 / Math.PI,
    lat: Math.asin(Math.max(-1, Math.min(1, dir.clone().normalize().dot(moonZ)))) * 180 / Math.PI,
  })
  return { ...e, moonX, moonY, moonZ, moonToWorld, subSolar: bodyPoint(e.sunDir), subEarth: bodyPoint(e.earthDir) }
}

/** Temporary Moon-body rotation: longitude spin plus a screen-horizontal tilt, with the rig's short release coast. */
export class MoonSurfaceTurn {
  readonly orientation = new Quaternion()
  pitch = 0
  yaw = 0
  private yawVelocity = 0
  private pitchVelocity = 0
  private lastAt = -Infinity
  private north = new Vector3(0, 0, 1)
  private screenRight = new Vector3(1, 0, 0)
  private pitchMin = -MOON_TURN_PITCH_MAX
  private pitchMax = MOON_TURN_PITCH_MAX
  /** The turn the earlier gestures left; each new gesture spins and tilts on top of it in its own camera basis (no snap when the view moved between drags). */
  readonly base = new Quaternion()

  private compose(): void {
    const yaw = new Quaternion().setFromAxisAngle(this.north, this.yaw)
    const pitch = new Quaternion().setFromAxisAngle(this.screenRight, this.pitch)
    this.orientation.copy(pitch).multiply(yaw).multiply(this.base).normalize()
  }

  /** The tilt range, but a turn that already sits outside it (a polar view tilts north past the limit) may only move back toward it, never further out. */
  private clampPitch(next: number): number {
    return Math.max(Math.min(this.pitchMin, this.pitch), Math.min(Math.max(this.pitchMax, this.pitch), next))
  }

  /** Start a new gesture: fold the current turn into the base. Pass the date's north turned by `base` (baseNorth) as the next gesture's north. */
  rebase(): void {
    this.base.copy(this.orientation)
    this.pitch = 0; this.yaw = 0
    this.yawVelocity = 0; this.pitchVelocity = 0
  }

  /** The date's north axis as the current base leaves it: the axis a new gesture spins about. */
  baseNorth(dateNorth: Vector3): Vector3 { return dateNorth.clone().applyQuaternion(this.base).normalize() }

  /** Decompose the inverse grab into longitude spin and screen-right pitch; roll is discarded. */
  drag(cameraTurn: Rotation, now: number, screenRight: Vector3, screenUp: Vector3, north: Vector3): boolean {
    if (cameraTurn.angle <= 0) { this.lastAt = now; return false }
    const bodyDelta = cameraTurn.axis.clone().multiplyScalar(-cameraTurn.angle)
    return this.dragBy(bodyDelta.dot(screenUp), bodyDelta.dot(screenRight), now, screenRight, north)
  }

  /**
   * Turn by a longitude spin about the date's north axis and a tilt about the screen's horizontal (the finger's sideways and vertical travel).
   * `pitchRange` bounds the turn's tilt so the north axis's own tilt toward or away from the viewer stays within MOON_TURN_PITCH_MAX.
   */
  dragBy(yawDelta: number, pitchDelta: number, now: number, screenRight: Vector3, north: Vector3, pitchRange: [number, number] = [-MOON_TURN_PITCH_MAX, MOON_TURN_PITCH_MAX]): boolean {
    this.screenRight.copy(screenRight).normalize()
    this.north.copy(north).normalize()
    this.pitchMin = pitchRange[0]; this.pitchMax = pitchRange[1]
    if (yawDelta === 0 && pitchDelta === 0) { this.lastAt = now; return false }
    this.yaw += yawDelta
    this.pitch = this.clampPitch(this.pitch + pitchDelta)
    this.compose()
    const dt = (now - this.lastAt) / 1000
    if (dt > 0.001 && dt < 0.1) {
      this.yawVelocity = 0.5 * this.yawVelocity + 0.5 * yawDelta / dt
      this.pitchVelocity = 0.5 * this.pitchVelocity + 0.5 * pitchDelta / dt
      const speed = Math.hypot(this.yawVelocity, this.pitchVelocity)
      if (speed > INERTIA_MAX_RAD_S) { this.yawVelocity *= INERTIA_MAX_RAD_S / speed; this.pitchVelocity *= INERTIA_MAX_RAD_S / speed }
    } else { this.yawVelocity = 0; this.pitchVelocity = 0 }
    this.lastAt = now
    return true
  }

  /** Advance release momentum on the same two axes; pitch remains inside the limb-safe range. */
  step(dtSeconds: number): boolean {
    const speed = Math.hypot(this.yawVelocity, this.pitchVelocity)
    const dt = Math.min(0.1, Math.max(0, dtSeconds))
    if (speed <= INERTIA_STOP_RAD_S || dt === 0) { this.yawVelocity = 0; this.pitchVelocity = 0; return false }
    this.yaw += this.yawVelocity * dt
    this.pitch = this.clampPitch(this.pitch + this.pitchVelocity * dt)
    this.compose()
    const decay = Math.exp(-dt / INERTIA_TAU_S)
    this.yawVelocity *= decay
    this.pitchVelocity *= decay
    return true
  }

  reset(): void {
    this.orientation.identity()
    this.base.identity()
    this.pitch = 0; this.yaw = 0
    this.pitchMin = -MOON_TURN_PITCH_MAX; this.pitchMax = MOON_TURN_PITCH_MAX
    this.yawVelocity = 0; this.pitchVelocity = 0
    this.lastAt = -Infinity
  }

  /** Stop release momentum while preserving the visitor's current body turn. */
  stopInertia(): void { this.yawVelocity = 0; this.pitchVelocity = 0 }

  /** Match CameraRig.release: a held, idle pointer is not a fling. */
  release(now: number): void { if (now - this.lastAt > 80) this.stopInertia() }
}
