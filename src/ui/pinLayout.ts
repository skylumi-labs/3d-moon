/** Where a pin and its label go: pure geometry, so "no pin is a bare dot" is a number a test can check (scripts/pins.test.mts). */
export type Box = [number, number, number, number]

/** The room a pin and its label take, tried with the label on the right and then on the left; a side that runs off the frame is not offered. */
export function pinBoxes(x: number, y: number, wText: number, vw: number): Array<{ left: boolean; box: Box }> {
  const out: Array<{ left: boolean; box: Box }> = []
  const right: Box = [x - 8, y - 10, x + wText, y + 10]
  if (right[2] <= vw - 4) out.push({ left: false, box: right })
  const left: Box = [x - wText, y - 10, x + 8, y + 10]
  if (left[0] >= 4) out.push({ left: true, box: left })
  return out
}

const overlaps = (a: Box, b: Box): boolean => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]

/**
 * Places pins in priority order. Each gets its label on the right, or on the left when the right edge has no room; a pin whose
 * label would overlap an earlier one is not shown at all (the Hotspots sheet still lists it). Never a dot without its label.
 */
export function placePins(pins: Array<{ id: string; x: number; y: number; wText: number }>, vw: number): Map<string, { left: boolean; box: Box } | null> {
  const taken: Box[] = []
  const out = new Map<string, { left: boolean; box: Box } | null>()
  for (const p of pins) {
    const fit = pinBoxes(p.x, p.y, p.wText, vw).find((b) => !taken.some((t) => overlaps(b.box, t))) ?? null
    if (fit) taken.push(fit.box)
    out.set(p.id, fit)
  }
  return out
}
