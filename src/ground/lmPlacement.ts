import * as THREE from 'three'

/** Attitude of the placed module: heading of its front (deg clockwise from north), nose-up pitch, left-side-down roll, and the origin's height. */
export interface Placement {
  headingDeg: number
  pitchDeg: number
  rollDeg: number
  z: number
  /** Pad base height above the ground under it after placement, metres (all at least 0, the lowest 0). */
  clearanceM: number[]
}

const D = Math.PI / 180

/**
 * The rotation from model space to three's axes (east, up, south): heading about up, then pitch, then roll. The model's front
 * (the forward hatch and its porch and ladder) is +z; its up is +y. The front points at the bearing.
 */
export function attitudeQuat(p: Pick<Placement, 'headingDeg' | 'pitchDeg' | 'rollDeg'>): THREE.Quaternion {
  // Rotating +z about up by t gives (east, south) = (sin t, cos t); bearing B is (east, south) = (sin B, -cos B), so t = 180 - B.
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (180 - p.headingDeg) * D)
  // Nose up: a turn about the model's x that lifts +z.
  const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -p.pitchDeg * D)
  // Left side down: up leans toward the model's left (+x), a turn about z.
  const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -p.rollDeg * D)
  return yaw.multiply(pitch).multiply(roll)
}

/** A placement made before the ground could answer a probe (`groundZ` gives -1e6 then) sits a million metres down: it must be redone, not kept. */
export const PLACEMENT_INVALID_Z = -1e5

/**
 * Whether the module must be set on the ground again: finer heights arrived (the patch's revision changed), or the first placement was made
 * before any ground answered; never while a descent flight drives the pose (it was last set `flightAgoMs` ago).
 */
export function needsRefit(placedRev: number, rev: number, placedZ: number, flightAgoMs: number): boolean {
  if (flightAgoMs < 1000) return false
  return rev !== placedRev || placedZ < PLACEMENT_INVALID_Z
}

/** A pad base in frame metres (east, north, up) for a placement (origin at the frame's east 0, north 0, height z). */
export function padInFrame(pad: THREE.Vector3, p: Pick<Placement, 'headingDeg' | 'pitchDeg' | 'rollDeg' | 'z'>): THREE.Vector3 {
  const w = pad.clone().applyQuaternion(attitudeQuat(p))
  return new THREE.Vector3(w.x, -w.z, w.y + p.z)
}

/**
 * Sets the module on the ground: the attitude is the plane through the ground under its four pad bases (least
 * squares, iterated because the pads move with the attitude), and the height is the least that leaves no pad under
 * the ground. `ground(e, n)` is the frame height of the ground. The residual is left as clearance (a pad floating
 * a few centimetres is what a plane through four uneven points does; the real legs' struts compress unequally).
 */
export function fitPlacement(pads: THREE.Vector3[], headingDeg: number, ground: (e: number, n: number) => number, opts: { maxTiltDeg?: number; attitude?: { pitchDeg: number; rollDeg: number } } = {}): Placement {
  const maxTilt = opts.maxTiltDeg ?? 15
  let p = { headingDeg, pitchDeg: 0, rollDeg: 0, z: 0 }
  const H = headingDeg * D
  if (opts.attitude) p = { headingDeg, pitchDeg: opts.attitude.pitchDeg, rollDeg: opts.attitude.rollDeg, z: 0 }
  for (let it = 0; it < (opts.attitude ? 0 : 4); it++) {
    const pts = pads.map((pad) => padInFrame(pad, p))
    const g = pts.map((q) => ground(q.x, q.y))
    // Least squares plane z = a + b e + c n through (e, n, g).
    const n = pts.length
    let se = 0, sn = 0, sg = 0
    pts.forEach((q, i) => { se += q.x; sn += q.y; sg += g[i] })
    const me = se / n, mn = sn / n, mg = sg / n
    let see = 0, snn = 0, sen = 0, seg = 0, sng = 0
    pts.forEach((q, i) => { const de = q.x - me, dn = q.y - mn, dg = g[i] - mg; see += de * de; snn += dn * dn; sen += de * dn; seg += de * dg; sng += dn * dg })
    const det = see * snn - sen * sen
    const b = det > 1e-9 ? (seg * snn - sng * sen) / det : 0
    const c = det > 1e-9 ? (sng * see - seg * sen) / det : 0
    const slopeF = b * Math.sin(H) + c * Math.cos(H)
    const slopeR = b * Math.cos(H) - c * Math.sin(H)
    const clamp = (v: number): number => Math.max(-maxTilt, Math.min(maxTilt, v))
    p = { headingDeg, pitchDeg: clamp(Math.atan(slopeF) / D), rollDeg: clamp(Math.atan(slopeR) / D), z: 0 }
  }
  const pts0 = pads.map((pad) => padInFrame(pad, p))
  const gs = pts0.map((q) => ground(q.x, q.y))
  const z = Math.max(...pts0.map((q, i) => gs[i] - q.z))
  const clearanceM = pts0.map((q, i) => q.z + z - gs[i])
  return { ...p, z, clearanceM }
}

/** A pad within this height of the ground keeps sky from it (a contact disc is honest); above it the disc would be a second shadow from nothing. */
export const PAD_CONTACT_M = 0.02
/** The z given to a contact disc that is off: far below any ground, so the shader's smoothstep is 0 everywhere. */
export const PAD_DISC_OFF_Z = -1e4
export const padHasContact = (clearanceM: number): boolean => clearanceM < PAD_CONTACT_M
