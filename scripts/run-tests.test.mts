// The test runner's skip tally: markers are parsed, data skips stay allowed in CI, dependency skips fail CI only.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HEAVY, parseSkips, selectTier, slowest, summarise } from './run-tests-lib.mjs'
import { reportSkip } from './test-skip.mts'

const out = [
  'noise',
  'MOON_TEST_SKIP dependency polar-tiles.test: python3/numpy not available',
  'MOON_TEST_SKIP data tiles.test: MOON_TILES_DIR not set',
  'not a marker MOON_TEST_SKIP data x: y',
].join('\n')
const skips = parseSkips(out)
assert.deepEqual(skips.map((s) => s.kind), ['dependency', 'data'])
assert.equal(skips[0].test, 'polar-tiles.test')

let s = summarise(10, skips, false)
assert.equal(s.fail, false, 'a local run with a dependency skip passes but says so')
assert.ok(s.lines.some((l) => l.includes('SKIPPED (dependency) polar-tiles.test')))
s = summarise(10, skips, true)
assert.equal(s.fail, true, 'CI fails on a dependency skip')
s = summarise(10, skips.filter((k) => k.kind === 'data'), true)
assert.equal(s.fail, false, 'CI allows a data skip (no local tile set)')
assert.equal(summarise(3, [], true).fail, false)

// reportSkip prints exactly the line parseSkips reads.
const dir = mkdtempSync(join(tmpdir(), 'run-tests-'))
const f = join(dir, 'probe.mts')
writeFileSync(f, `import { reportSkip } from ${JSON.stringify(new URL('./test-skip.mts', import.meta.url).href)}\nreportSkip('probe.test', 'dependency', 'no numpy')\n`)
const r = spawnSync(process.execPath, ['--import', 'tsx', f], { encoding: 'utf8' })
assert.equal(r.status, 0, r.stderr)
assert.deepEqual(parseSkips(r.stdout), [{ kind: 'dependency', test: 'probe.test', reason: 'no numpy' }])
void reportSkip
console.log('run-tests.test: ok')

// TEST_TIER: fast skips exactly the HEAVY files; unset or any other value runs everything.
const names = ['a.test.mts', ...HEAVY, 'z.test.mts']
assert.deepEqual(selectTier(names, 'fast').run, ['a.test.mts', 'z.test.mts'])
assert.deepEqual(selectTier(names, 'fast').skipped, HEAVY)
assert.deepEqual(selectTier(names, undefined).run, names)
assert.deepEqual(selectTier(names, 'full').skipped, [])
assert.deepEqual(HEAVY, ['half-heights.test.mts', 'tc-detail.test.mts'])
assert.deepEqual(slowest([{ file: 'a', seconds: 1 }, { file: 'b', seconds: 9 }, { file: 'c', seconds: 5 }], 2).map((t) => t.file), ['b', 'c'])
