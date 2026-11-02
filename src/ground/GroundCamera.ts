import { Vector3 } from 'three'
import { type GroundView, groundBasis } from './frame'
import { clampAngleRate, hermite1, hermitePos } from '../descent/arrival'

/**
 * The ground camera (G1): a float64 pose in the site frame (metres), driven by look and move input,
 * kept above the ground, or walking at eye level, and able to glide to another pose (an attached
 * camera, a tour's end) without a cut. Pure state: no rendering, no DOM. The ground's height comes
 * from a callback (the GPU probe in the app, a function in tests).
 */

export type MoveMode = 'fly' | 'walk'

/** The lowest the fly camera goes above the ground, metres. */
export const MIN_AGL_FLY = 0.5
/** Eye height of the walking camera, metres (a suited astronaut's eye is about 1.7 m). */
export const EYE_HEIGHT_M = 1.7
export const WALK_SPEED = 1.4
export const WALK_SPEED_FAST = 5
/** Pitch limits, deg above the horizon. */
const PITCH_LIM = 89.5
const smooth = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t) }
const wrap180 = (a: number): number => ((a + 540) % 360) - 180

export interface Glide {
  from: GroundView
  to: GroundView
  t0: number
  ms: number
  arcM: number
  done?: () => void
  /** Keeps the pitch on this point (site frame) during the glide, so a climb stays pointed at it. */
  lookAt?: Vector3
  /** The velocity (m/s, site frame) and pitch rate (deg/s) the glide leaves with: they follow Hermite curves that ease out to the end, so a descent's motion carries on. */
  v0?: Vector3
  pitchRate0?: number
}

export class GroundCamera {
  view: GroundView
  mode: MoveMode = 'fly'
  /** Where the ground is: the frame height (metres) of the ground at (east, north). */
  groundZ: (e: number, n: number) => number
  private glide: Glide | null = null
  /** Held move keys: forward, right, up (each -1, 0 or 1) and the fast modifier. */
  readonly keys = { fwd: 0, right: 0, up: 0, fast: false }
  /** True after the last step moved or turned the camera. */
  moved = false
  /** Called when the visitor turns or moves the camera (which ends any preset). */
  onInput: (() => void) | null = null

  constructor(view: GroundView, groundZ: (e: number, n: number) => number) {
    this.view = { ...view, pos: view.pos.clone() }
    this.groundZ = groundZ
  }

  get gliding(): boolean { return !!this.glide }

  /** Height above the ground under the camera, metres. */
  agl(): number { return this.view.pos.z - this.groundZ(this.view.pos.x, this.view.pos.y) }

  /** Drag: turn the view by degrees (positive dx turns right, positive dy looks down). */
  look(dxDeg: number, dyDeg: number): void {
    this.cancelGlide()
    this.onInput?.()
    this.view.headingDeg = wrap180(this.view.headingDeg + dxDeg)
    this.view.pitchDeg = Math.max(-PITCH_LIM, Math.min(PITCH_LIM, this.view.pitchDeg - dyDeg))
    this.view.rollDeg *= 0.0
    this.moved = true
  }

  /** Moves along the view's horizontal heading (forward, right) and straight up, metres. Kept above the ground. */
  move(fwd: number, right: number, up: number): void {
    this.cancelGlide()
    this.onInput?.()
    const h = this.view.headingDeg * Math.PI / 180
    const f = new Vector3(Math.sin(h), Math.cos(h), 0), r = new Vector3(Math.cos(h), -Math.sin(h), 0)
    this.view.pos.addScaledVector(f, fwd).addScaledVector(r, right)
    this.view.pos.z += up
    this.follow(1)
    this.moved = true
  }

  /** One wheel notch: along the line of sight (flying) or along the ground (walking), by a share of the height above the ground. */
  dolly(factor: number): void {
    this.cancelGlide()
    this.onInput?.()
    const step = (factor - 1) * Math.max(0.6, this.agl())
    if (this.mode === 'walk') { this.move(-step * 0.5, 0, 0); return }
    const b = groundBasis(this.view)
    this.view.pos.addScaledVector(b.back, step)
    this.follow(1)
    this.moved = true
  }

  setMode(mode: MoveMode): void {
    this.mode = mode
    if (mode === 'walk') this.follow(1)
    this.moved = true
  }

  /** Keeps the camera above the ground: at least MIN_AGL_FLY flying; at eye height walking (eased by `k`, 1 = at once). */
  follow(k: number): void {
    const p = this.view.pos
    const g = this.groundZ(p.x, p.y)
    if (this.mode === 'walk') p.z += (g + EYE_HEIGHT_M - p.z) * k
    else if (p.z < g + MIN_AGL_FLY) p.z = g + MIN_AGL_FLY
  }

  cancelGlide(): void { this.glide = null }

  /** Glides to `to` over `ms`, easing position, heading (by the short way), pitch, roll and the field (on a log scale). */
  glideTo(to: GroundView, now: number, ms?: number, done?: () => void, lookAt?: Vector3, v0?: Vector3, pitchRate0?: number): void {
    const from = { ...this.view, pos: this.view.pos.clone() }
    const target = { ...to, pos: to.pos.clone() }
    const horizontal = Math.hypot(target.pos.x - from.pos.x, target.pos.y - from.pos.y)
    this.glide = { from, to: target, t0: now, ms: ms ?? Math.max(1500, Math.min(6000, 1500 + 60 * Math.sqrt(horizontal))), arcM: horizontal > 15 && !v0 ? Math.min(60, 0.25 * horizontal) : 0, done, lookAt, v0: v0?.clone(), pitchRate0 }
    this.moved = true
  }

  /** The view a glide at progress k (0 to 1, already eased) shows. */
  static blend(a: GroundView, b: GroundView, k: number): GroundView {
    return {
      pos: a.pos.clone().lerp(b.pos, k),
      headingDeg: wrap180(a.headingDeg + wrap180(b.headingDeg - a.headingDeg) * k),
      pitchDeg: a.pitchDeg + (b.pitchDeg - a.pitchDeg) * k,
      rollDeg: a.rollDeg + (b.rollDeg - a.rollDeg) * k,
      tanHalf: Math.exp(Math.log(a.tanHalf) + (Math.log(b.tanHalf) - Math.log(a.tanHalf)) * k),
    }
  }

  /** Advances a glide and the held keys by `dt` seconds. Returns true if the camera changed. */
  step(now: number, dt: number): boolean {
    this.moved = false
    if (this.glide) {
      const g = this.glide
      const s = Math.max(0, Math.min(1, (now - g.t0) / g.ms))
      this.view = GroundCamera.blend(g.from, g.to, smooth(s))
      if (g.v0) {
        const q = hermitePos([g.from.pos.x, g.from.pos.y, g.from.pos.z], [g.to.pos.x, g.to.pos.y, g.to.pos.z], [g.v0.x, g.v0.y, g.v0.z], g.ms, s)
        this.view.pos.set(q[0], q[1], q[2])
        if (g.pitchRate0 !== undefined) this.view.pitchDeg = hermite1(g.from.pitchDeg, g.to.pitchDeg, clampAngleRate(g.pitchRate0, g.to.pitchDeg - g.from.pitchDeg, g.ms), g.ms, s)
      }
      if (g.arcM) this.view.pos.z += g.arcM * Math.sin(Math.PI * s) ** 2
      if (g.lookAt) {
        const d = g.lookAt.clone().sub(this.view.pos)
        this.view.pitchDeg = Math.max(-89, Math.min(this.view.pitchDeg, Math.atan2(d.z, Math.hypot(d.x, d.y)) * 180 / Math.PI))
      }
      if (s >= 1) { this.glide = null; g.done?.() }
      return true
    }
    const k = this.keys
    if (k.fwd || k.right || k.up) {
      const speed = this.mode === 'walk' ? (k.fast ? WALK_SPEED_FAST : WALK_SPEED) : Math.max(1.5, this.agl() * 0.8) * (k.fast ? 3 : 1)
      this.move(k.fwd * speed * dt, k.right * speed * dt, this.mode === 'fly' ? k.up * speed * dt : 0)
    }
    if (this.mode === 'walk') {
      const before = this.view.pos.z
      this.follow(Math.min(1, dt * 8))
      if (Math.abs(this.view.pos.z - before) > 1e-4) this.moved = true
    }
    return this.moved
  }
}
