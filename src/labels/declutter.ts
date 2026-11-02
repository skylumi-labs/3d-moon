import type { MoonLabel } from './data'

const DEG = Math.PI / 180
const R_KM = 1737.4

/** Ground span across the frame's short side at the camera's nadir, km (flat-ground approximation; exact enough to pick which labels to show). */
export function spanKm(dist: number, fovDeg: number): number {
  return 2 * Math.tan(fovDeg * DEG / 2) * Math.max(0, dist - 1) * R_KM
}

/**
 * Which labels the zoom allows. Natural features show while they are a readable share of the frame (a mare name over a whole
 * mare, a crater name over a crater, not over a sixth of the disc), landing sites by importance: crewed ones from far out,
 * robotic ones from nearer, crashes nearer still, and no label once the camera is on the spot (it would stand on the picture).
 */
export function zoomAllows(l: MoonLabel, dist: number, fovDeg: number, span = spanKm(dist, fovDeg)): boolean {
  if (dist < 1.004) return false
  switch (l.kind) {
    case 'mare': return !!l.sizeKm && l.sizeKm / span > 0.12 && l.sizeKm / span < 1.6
    case 'crater': return !!l.sizeKm && l.sizeKm / span > 0.05 && l.sizeKm / span < 1.6
    case 'range': return span < 2200 && span > 150
    case 'site': return l.status === 'crewed' ? span < 14000 : l.status === 'landed' ? span < 3200 : span < 1400
  }
}

/** Importance for the collision pass: lower wins. */
export function priority(l: MoonLabel): number {
  if (l.kind === 'site') return l.status === 'crewed' ? 0 : l.status === 'landed' ? 1 : 3
  if (l.kind === 'mare') return 2
  if (l.kind === 'crater') return 4 - Math.min(1, (l.sizeKm ?? 0) / 300)
  return 5
}

/** Small perspective changes keep labels visually attached to the near terrain without making them compete with it. */
export function labelDepthStyle(l: MoonLabel, cameraRadius: number, surfaceDistance: number, frameSpanKm: number): { scale: number; opacity: number } {
  const altitude = Math.max(0.025, cameraRadius - 1)
  const localAltitude = Math.max(0.025, surfaceDistance)
  const perspective = Math.sqrt(altitude / localAltitude)
  const scale = Math.max(0.88, Math.min(1.08, 0.94 + (perspective - 1) * 0.18))
  const sizeShare = l.sizeKm ? Math.min(1, l.sizeKm / Math.max(1, frameSpanKm)) : 0
  const prominence = l.kind === 'site' ? 0.08 : Math.min(0.13, Math.sqrt(sizeShare) * 0.13)
  const opacity = Math.max(0.58, Math.min(0.96, 0.72 + prominence + Math.max(-0.12, Math.min(0.12, (perspective - 1) * 0.16))))
  return { scale, opacity }
}

export type Box = [number, number, number, number]
const overlap = (a: Box, b: Box): boolean => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]

export interface LabelCandidate { id: string; x: number; y: number; w: number; h: number; rank: number }
export interface LabelPlacement { x: number; y: number; offsetX: number; offsetY: number }

/** Greedy collision placement: try the anchor first, then short, balanced offsets around it. */
export function placeLabelCandidates(items: LabelCandidate[], blocked: Box[] = [], bounds?: Box, maxPlaced = 100, maxCandidates = 320): Map<string, LabelPlacement> {
  const taken: Box[] = [...blocked]
  const out = new Map<string, LabelPlacement>()
  const candidates = [...items].sort((a, b) => a.rank - b.rank).slice(0, maxCandidates)
  for (const it of candidates) {
    if (out.size >= maxPlaced) break
    const dx = it.w / 2 + 10, dy = it.h + 5
    const offsets: Array<[number, number]> = [[0, 0], [0, -dy], [0, dy], [dx, 0], [-dx, 0], [dx, -dy], [-dx, -dy], [dx, dy], [-dx, dy]]
    for (const [ox, oy] of offsets) {
      const x = it.x + ox, y = it.y + oy
      const box: Box = [x - it.w / 2, y - it.h / 2, x + it.w / 2, y + it.h / 2]
      if (bounds && (box[0] < bounds[0] || box[1] < bounds[1] || box[2] > bounds[2] || box[3] > bounds[3])) continue
      if (taken.some((t) => overlap(box, t))) continue
      taken.push(box); out.set(it.id, { x, y, offsetX: ox, offsetY: oy }); break
    }
  }
  return out
}

/** Backwards-compatible set view for callers that need visibility only. */
export function placeLabels(items: LabelCandidate[], blocked: Box[] = []): Set<string> {
  const taken: Box[] = [...blocked]
  const out = new Set<string>()
  for (const it of [...items].sort((a, b) => a.rank - b.rank)) {
    const box: Box = [it.x - it.w / 2, it.y - it.h / 2, it.x + it.w / 2, it.y + it.h / 2]
    if (taken.some((t) => overlap(box, t))) continue
    taken.push(box); out.add(it.id)
  }
  return out
}
