/** Pinhole screen ray mapped to true azimuth and elevation, in radians. */
export function panoramaViewRay(ndcX: number, ndcY: number, aspect: number, tanHalfHorizontalFov: number, yaw: number, pitch: number): [number, number] {
  const x = ndcX * tanHalfHorizontalFov
  const y = ndcY * tanHalfHorizontalFov / aspect
  const length = Math.hypot(x, y, 1) || 1
  const rayX = x / length
  const rayY = y / length
  const rayZ = 1 / length
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const up = rayY * cp + rayZ * sp
  const north = rayZ * cp - rayY * sp
  const azimuth = yaw + Math.atan2(rayX, north)
  const elevation = Math.asin(Math.max(-1, Math.min(1, up)))
  return [azimuth, elevation]
}

const DEG = Math.PI / 180

/** Preserve the desktop landscape lens, while fitting a useful vertical sweep on portrait screens. */
export function defaultPanoramaHorizontalFov(aspect: number): number {
  return aspect >= 1 ? 86 * DEG : 2 * Math.atan(aspect * Math.tan(25 * DEG))
}

export function panoramaVerticalFov(horizontalFov: number, aspect: number): number {
  return 2 * Math.atan(Math.tan(horizontalFov / 2) / Math.max(0.01, aspect))
}

export function panoramaHorizontalFov(verticalFov: number, aspect: number): number {
  return 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(0.01, aspect))
}

/** Keeps landscape's established horizontal limits and bounds portrait zoom in vertical degrees. */
export function clampPanoramaHorizontalFov(horizontalFov: number, aspect: number): number {
  if (aspect >= 1) return Math.max(42 * DEG, Math.min(118 * DEG, horizontalFov))
  const verticalFov = panoramaVerticalFov(horizontalFov, aspect)
  return panoramaHorizontalFov(Math.max(20 * DEG, Math.min(85 * DEG, verticalFov)), aspect)
}

/** Drag deltas follow exact pinhole rays, including the narrower angular span near viewport edges. */
export function panPanoramaByProjectedRays(
  yaw: number,
  pitch: number,
  fromNdc: [number, number],
  toNdc: [number, number],
  aspect: number,
  tanHalfHorizontalFov: number,
): [number, number] {
  const [fromAz, fromEl] = panoramaViewRay(fromNdc[0], fromNdc[1], aspect, tanHalfHorizontalFov, yaw, pitch)
  const [toAz, toEl] = panoramaViewRay(toNdc[0], toNdc[1], aspect, tanHalfHorizontalFov, yaw, pitch)
  const azDelta = Math.atan2(Math.sin(fromAz - toAz), Math.cos(fromAz - toAz))
  return [yaw + azDelta, pitch + fromEl - toEl]
}
