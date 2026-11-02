// Runs every scripts/*.test.mts, one after another, and stops at the first failure.
// A new test is a new file: nothing here or in package.json needs to change, so parallel PRs never conflict on a script line.
// The two excluded files need generated data and have their own scripts (test:mid-sample, test:wide-height).
// TEST_TIER=fast skips the HEAVY files (run-tests-lib.mjs); unset runs everything. Skips are reported, not hidden (see scripts/test-skip.mts); with CI=true a skip for a missing dependency fails the run.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSkips, selectTier, slowest, summarise } from './run-tests-lib.mjs'

const EXCLUDED = new Set(['mid-sample.test.mts', 'wide-height.test.mts'])
const dir = join(dirname(fileURLToPath(import.meta.url)))
const root = join(dir, '..')
const all = readdirSync(dir).filter((f) => f.endsWith('.test.mts') && !EXCLUDED.has(f)).sort()
const tier = process.env.TEST_TIER
const { run: files, skipped } = selectTier(all, tier)
for (const f of skipped) console.log(`run-tests: SKIPPED (TEST_TIER=${tier}) ${f}`)
if (files.length === 0) { console.error('run-tests: no scripts/*.test.mts found'); process.exit(1) }
const skips = []
const timings = []
for (const f of files) {
  const t0 = Date.now()
  const r = spawnSync(process.execPath, ['--import', 'tsx', join('scripts', f)], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const seconds = (Date.now() - t0) / 1000
  timings.push({ file: f, seconds })
  if (seconds > 2) console.log(`run-tests: ${f} ${seconds.toFixed(1)}s`)
  process.stdout.write(r.stdout ?? '')
  process.stderr.write(r.stderr ?? '')
  if (r.status !== 0) { console.error(`run-tests: ${f} failed (exit ${r.status ?? r.signal})`); process.exit(r.status || 1) }
  skips.push(...parseSkips(r.stdout))
}
console.log('run-tests: 10 slowest files')
for (const t of slowest(timings)) console.log(`run-tests:   ${t.seconds.toFixed(1)}s ${t.file}`)
const { lines, fail } = summarise(files.length, skips, process.env.CI === 'true')
for (const l of lines) (fail ? console.error : console.log)(l)
process.exit(fail ? 1 : 0)
