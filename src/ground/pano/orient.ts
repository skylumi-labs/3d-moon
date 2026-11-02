import type { PanoramaProjection } from './manifest'

const DEG = Math.PI / 180

export interface PanoUv { u: number; v: number; inside: boolean }
export interface PanoColumnSamples { firstU: number; secondU: number; firstWeight: number; secondWeight: number }

function tiltAt(p: PanoramaProjection, azimuth: number): number {
  const t = p.elevationOffsetDeg
  return t.constant + t.cosAz * Math.cos(azimuth) + t.sinAz * Math.sin(azimuth)
}

/** Returns the registered image columns and blend weights for a true bearing. */
export function panoColumnSamples(p: PanoramaProjection, azimuthRad: number): PanoColumnSamples {
  const field = p.horizontalFovDeg * DEG
  const turn = (((azimuthRad - p.leftAzDeg * DEG) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const firstU = turn / field
  const overlap = field - 2 * Math.PI
  if (overlap <= 0 || turn >= overlap) return { firstU, secondU: firstU, firstWeight: 1, secondWeight: 0 }
  const t = turn / overlap
  const firstWeight = t * t * (3 - 2 * t)
  return {
    firstU,
    secondU: (turn + 2 * Math.PI) / field,
    firstWeight,
    secondWeight: 1 - firstWeight,
  }
}

/** Maps a world bearing and elevation to the registered photograph's pixel coordinates. */
export function directionToPanoUv(p: PanoramaProjection, azimuthRad: number, elevationRad: number, width: number, height: number): PanoUv {
  const field = p.horizontalFovDeg * DEG
  const { firstU: u } = panoColumnSamples(p, azimuthRad)
  const cameraElevation = elevationRad - tiltAt(p, azimuthRad) * DEG
  const rowAngle = cameraElevation / p.verticalScale
  const imageScale = height / width * field
  const v = p.centerRow - (p.kind === 'cylindrical' ? Math.tan(rowAngle) : rowAngle) / imageScale
  return { u, v, inside: u <= 1 && v >= 0 && v <= 1 }
}

/** Inverse of directionToPanoUv, useful for composing rays and checking registration. */
export function panoUvToDirection(p: PanoramaProjection, u: number, v: number, width: number, height: number): [number, number] {
  const azimuth = (p.leftAzDeg + u * p.horizontalFovDeg) * DEG
  const imageScale = height / width * p.horizontalFovDeg * DEG
  const row = (p.centerRow - v) * imageScale
  const cameraElevation = p.verticalScale * (p.kind === 'cylindrical' ? Math.atan(row) : row)
  return [azimuth, cameraElevation + tiltAt(p, azimuth) * DEG]
}
