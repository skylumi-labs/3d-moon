// The skip protocol shared by scripts/*.test.mts and scripts/run-tests.mjs.
// A test that cannot run part of itself prints one marker line through reportSkip(); the runner collects the markers,
// prints a tally, and (CI=true) fails on any 'dependency' skip. 'data' skips need a local tile or patch set and stay
// allowed in CI (`MOON_TILES_DIR=$PWD/.tiles npm test` adds those checks).
export const SKIP_MARKER = 'MOON_TEST_SKIP'
export type SkipKind = 'dependency' | 'data'

export function reportSkip(test: string, kind: SkipKind, reason: string): void {
  console.log(`${SKIP_MARKER} ${kind} ${test}: ${reason}`)
}
