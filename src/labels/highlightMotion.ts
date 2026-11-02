/** True while the highlight still has a transition or a sticky hold that needs frame ticks. */
export function highlightAnimating(wantId: string | null, shownId: string | null, strength: number, sticky: boolean): boolean {
  if (sticky) return true
  if (wantId !== null) return shownId !== wantId || strength < 1
  return shownId !== null && strength > 0
}

export type HighlightUniforms = readonly [number, number, number, number, number, number]
/** Deduplicate shader uniform writes and their redraw requests when a resting hover has not changed. */
export class HighlightGate {
  private last: HighlightUniforms | null = null
  constructor(private readonly eps = 1e-4) {}
  changed(value: HighlightUniforms): boolean {
    if (this.last && value.every((v, i) => Math.abs(v - this.last![i]) <= this.eps)) return false
    this.last = value
    return true
  }
  reset(): void { this.last = null }
}
