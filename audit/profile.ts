// Profile metrics for a straight step across the terminator (WP4b): a brightness profile along a line perpendicular to the terminator, in grey levels.
// A synthetic edge is a function of the Sun's elevation only, so it shows as one large neighbour difference and one large second difference.

/** Largest absolute difference between neighbours. */
export function maxStepGrey(p: readonly number[]): number {
  let m = 0
  for (let i = 1; i < p.length; i++) m = Math.max(m, Math.abs(p[i] - p[i - 1]))
  return m
}

/** Largest absolute second difference p[i-1] - 2 p[i] + p[i+1]. */
export function secondDifferenceMax(p: readonly number[]): number {
  let m = 0
  for (let i = 1; i < p.length - 1; i++) m = Math.max(m, Math.abs(p[i - 1] - 2 * p[i] + p[i + 1]))
  return m
}
