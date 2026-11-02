// Pure helpers for scripts/run-tests.mjs (kept apart so scripts/run-tests.test.mts can import them without running the suite).
const MARKER = /^MOON_TEST_SKIP (dependency|data) ([^:]+): (.*)$/

/** Skip markers found in one test file's output. */
export function parseSkips(output) {
  const skips = []
  for (const line of String(output).split(/\r?\n/)) {
    const m = MARKER.exec(line.trim())
    if (m) skips.push({ kind: m[1], test: m[2], reason: m[3] })
  }
  return skips
}

/** One line per skip plus a tally; `fail` is true when CI is on and any skip is for a missing dependency. */
export function summarise(fileCount, skips, ci) {
  const dep = skips.filter((s) => s.kind === 'dependency')
  const data = skips.filter((s) => s.kind === 'data')
  const lines = []
  if (skips.length > 0) {
    lines.push(`run-tests: ${skips.length} skip(s): ${dep.length} for a missing dependency, ${data.length} for missing local data`)
    for (const s of skips) lines.push(`run-tests:   SKIPPED (${s.kind}) ${s.test}: ${s.reason}`)
  }
  const fail = ci && dep.length > 0
  if (fail) lines.push(`run-tests: FAILED, CI=true and ${dep.length} test(s) skipped for a missing dependency; install it in .github/workflows/ci.yml`)
  lines.push(`run-tests: ${fileCount} test files ran, ${skips.length} skip(s) reported`)
  return { lines, fail }
}

/**
 * Files TEST_TIER=fast skips: the slow data/pipeline tests. PRs run the fast tier; the push to main runs everything.
 * tile-feather and ground-hit left the list once they took seconds, not minutes (same numbers, same assertions): PRs run them too.
 */
export const HEAVY = ['half-heights.test.mts', 'tc-detail.test.mts']

/** Splits the file list by tier: `fast` skips HEAVY, anything else (or unset) runs every file. */
export function selectTier(files, tier) {
  if (tier !== 'fast') return { run: files, skipped: [] }
  return { run: files.filter((f) => !HEAVY.includes(f)), skipped: files.filter((f) => HEAVY.includes(f)) }
}

/** The files that took over `minSeconds`, slowest first, at most `n`. */
export function slowest(timings, n = 10) {
  return [...timings].sort((a, b) => b.seconds - a.seconds).slice(0, n)
}
