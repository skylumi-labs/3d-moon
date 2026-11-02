/**
 * The eclipse shadow model on the CPU. It is the reference the GLSL in
 * index.ts is written against (same formulas, same tables), used by the
 * exposure search and by scripts/eclipse.test.mts. Pure TypeScript, no
 * imports of three.js. Lengths in Moon radii, world frame, like the shaders.
 *
 * Model (all modelled, none measured on the night):
 *  - The Sun is two concentric uniform discs (solar.ts), so the share of it
 *    left uncovered by a round body is two circle-overlap areas.
 *  - The Earth's occulting disc reaches 60 km above the ground
 *    (ATMOSPHERE_TOP_KM). Light that passes lower is bent by the air and
 *    comes from the generated table (umbraTable.ts): a factor on unobstructed
 *    sunlight, per channel, against u = separation / (Earth radius - Sun
 *    radius, as angles), scaled to the real distance by the table's exponent.
 */
import { EARTH_R_KM, MOON_R_KM, SUN_R_KM } from '../glsl/common'
import { UMBRA_D0_KM, UMBRA_DIST_EXP, UMBRA_LOG2, UMBRA_N, UMBRA_U_MAX, SUN_TWO_DISC } from './umbraTable'

export type V3 = readonly [number, number, number]

/** Height of the atmosphere the table covers; the occulting disc adds it. */
export const OCCULT_TOP_KM = 60

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2])
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** Angle between two vectors, well conditioned at small angles. */
export function angleBetween(a: V3, b: V3): number {
  return Math.atan2(len(cross(a, b)), dot(a, b))
}

/** Overlap area of two discs of radii r1, r2 whose centres are d apart (planar). */
export function discOverlap(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0
  const rm = Math.min(r1, r2)
  if (d <= Math.abs(r1 - r2)) return Math.PI * rm * rm
  const a1 = Math.acos(Math.max(-1, Math.min(1, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1))))
  const a2 = Math.acos(Math.max(-1, Math.min(1, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2))))
  return r1 * r1 * (a1 - Math.sin(a1) * Math.cos(a1)) + r2 * r2 * (a2 - Math.sin(a2) * Math.cos(a2))
}

/**
 * Share of the limb-darkened Sun, per channel, left uncovered by a disc of
 * angular radius occR whose centre is sep from the Sun's centre; theta is the
 * Sun's angular radius.
 */
export function sunUncovered(theta: number, occR: number, sep: number, discs = SUN_TWO_DISC): [number, number, number] {
  const k = discs.k
  const full1 = Math.PI * theta * theta, full2 = Math.PI * k * k * theta * theta
  const open1 = Math.max(0, full1 - discOverlap(theta, occR, sep))
  const open2 = Math.max(0, full2 - discOverlap(k * theta, occR, sep))
  return [0, 1, 2].map((c) => (discs.a[c] * open1 + discs.c[c] * open2) / (discs.a[c] * full1 + discs.c[c] * full2)) as [number, number, number]
}

/** The table's refracted irradiance, per channel, at Moon distance dKm and normalised separation u. */
export function refractedFactor(u: number, dKm: number): [number, number, number] {
  if (u >= UMBRA_U_MAX) return [0, 0, 0]
  const x = (Math.max(u, 0) / UMBRA_U_MAX) * (UMBRA_N - 1)
  const i = Math.min(Math.floor(x), UMBRA_N - 2), t = x - i
  return [0, 1, 2].map((c) => {
    const l = UMBRA_LOG2[i][c] * (1 - t) + UMBRA_LOG2[i + 1][c] * t
    const k = UMBRA_DIST_EXP[i][c] * (1 - t) + UMBRA_DIST_EXP[i + 1][c] * t
    return 2 ** l * (dKm / UMBRA_D0_KM) ** k
  }) as [number, number, number]
}

export interface EarthShadow {
  /** Direct sunlight past the Earth and its 60 km of air, share of unobstructed, per channel. */
  direct: [number, number, number]
  /** Sunlight bent through the air into the shadow, share of unobstructed, per channel. */
  refracted: [number, number, number]
  /** Separation over (Earth radius - Sun radius): 1 is the umbra's edge. */
  u: number
}

/** A point p on or near the Moon (Moon radii); sunPos and earthPos are the Sun's and Earth's centres from the Moon's centre. */
export function earthShadowOnMoonParts(p: V3, sunPos: V3, earthPos: V3): EarthShadow {
  const sv = sub(sunPos, p), ev = sub(earthPos, p)
  const dSun = len(sv) * MOON_R_KM, dE = len(ev) * MOON_R_KM
  const theta = Math.asin(SUN_R_KM / dSun)
  const rho0 = Math.asin(EARTH_R_KM / dE)
  const rhoA = Math.asin((EARTH_R_KM + OCCULT_TOP_KM) / dE)
  const sep = angleBetween(sv, ev)
  const u = sep / (rho0 - theta)
  // Beyond both the penumbra and the table nothing changes: exactly 1.
  if (sep >= rhoA + theta && u >= UMBRA_U_MAX) return { direct: [1, 1, 1], refracted: [0, 0, 0], u }
  return { direct: sunUncovered(theta, rhoA, sep), refracted: refractedFactor(u, dE), u }
}

export function earthShadowOnMoon(p: V3, sunPos: V3, earthPos: V3): [number, number, number] {
  const s = earthShadowOnMoonParts(p, sunPos, earthPos)
  return [0, 1, 2].map((c) => s.direct[c] + s.refracted[c]) as [number, number, number]
}

/** The Moon (no air) on a point p near the Earth (Moon radii): share of the Sun left, per channel. */
export function moonShadowOnEarth(p: V3, sunPos: V3, moonPos: V3): [number, number, number] {
  const sv = sub(sunPos, p), mv = sub(moonPos, p)
  const theta = Math.asin(SUN_R_KM / (len(sv) * MOON_R_KM))
  const rhoM = Math.asin(1 / len(mv))
  const sep = angleBetween(sv, mv)
  if (sep >= rhoM + theta) return [1, 1, 1]
  return sunUncovered(theta, rhoM, sep)
}

export const luminance = (c: V3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
