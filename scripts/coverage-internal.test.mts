// Owner decision 2026-10-17: ?internal=1 and restricted coverage rows exist only in the dev server. A production build holds the public set.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REGIONS, DEV_BUILD, addInternalRegions, addRegions, admitRegions, internalRequested, loadRemoteCoverage, parseCoverage, type CoverageRegion } from '../src/coverage/coverage.ts'
import { devRedirect } from '../src/moon/tiles/devRedirect.ts'
import { reportSkip } from './test-skip.mts'
import { scanDist, restrictedStrings, distNeedles } from './assert-dist-public.mjs'

const row = (id: string, licence: 'public' | 'internal-only', lon0: number): CoverageRegion => ({ id, site: 'zz', texelM: 1, imagery: true, height: true, lon0, lon1: lon0 + 1, lat0: 5, lat1: 6, licence, credit: licence === 'public' ? 'NASA/GSFC/Arizona State University' : 'SENTINEL-CREDIT-RESTRICTED', source: licence === 'public' ? 'test' : 'SENTINEL-SOURCE-RESTRICTED' })
const hosted = { regions: [row('pub-a', 'public', 10), row('int-a', 'internal-only', 20), row('int-b', 'internal-only', 30)] }

// The flag: only a dev build honours ?internal=1.
assert.equal(DEV_BUILD, false, 'node test runs are not a dev server')
assert.equal(internalRequested(false, '?internal=1'), false, 'production ignores ?internal=1')
assert.equal(internalRequested(true, '?internal=1'), true)
assert.equal(internalRequested(true, ''), false)
assert.equal(internalRequested(true, '?internal=0'), false)

// The hosted-file path drops restricted rows regardless of params.
const { regions } = parseCoverage(hosted)
assert.equal(regions.length, 3)
assert.deepEqual(admitRegions(regions, false).map((r) => r.id), ['pub-a'])
assert.equal(addRegions(regions), 1, 'only the public row is added')
assert.ok(REGIONS.every((r) => r.licence === 'public'), 'no restricted row reachable in REGIONS')
// ...even when a caller wants them: the flag-gated dev entry adds nothing without it.
assert.equal(addInternalRegions(regions), 0, 'no ?internal=1 in a non-dev run: nothing added')
assert.ok(REGIONS.every((r) => r.licence === 'public'))
// Dev with the flag keeps them.
assert.deepEqual(admitRegions(regions, true).map((r) => r.id), ['pub-a', 'int-a', 'int-b'])
assert.equal(addInternalRegions(regions, true), 3)
assert.ok(REGIONS.some((r) => r.id === 'int-a'), 'dev + flag: the restricted row loads')
for (const r of regions) { const i = REGIONS.findIndex((x) => x.id === r.id); if (i >= 0) REGIONS.splice(i, 1) }

// The fetching loader, with a hosted coverage.json that holds restricted rows.
{
  const real = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ regions: [row('pub-b', 'public', 40), row('int-c', 'internal-only', 50)] }), { status: 200 })) as typeof fetch
  try {
    assert.equal(await loadRemoteCoverage('https://example.invalid/moon/'), 1)
    assert.ok(!REGIONS.some((r) => r.id === 'int-c'), 'hosted restricted row dropped by the loader')
  } finally { globalThis.fetch = real }
}

// The dev redirect never sends the restricted file to the public bucket.
assert.equal(devRedirect('/moon/internal', '/coverage-internal.json', { MOON_REMOTE_BASE: 'https://x/moon/' }), null)
assert.equal(devRedirect('/moon/patch', '/a.json', { MOON_REMOTE_BASE: 'https://x/moon/' }), 'https://x/moon/patch/a.json')

// The bundled list carries nothing restricted.
const root = join(import.meta.dirname, '..')
const bundled = JSON.parse(readFileSync(join(root, 'src/coverage/regions.json'), 'utf8')) as { regions: CoverageRegion[] }
assert.ok(bundled.regions.every((r) => r.licence === 'public'), 'regions.json holds public rows only')

// The scanner finds what it should (self-test), then the real dist is scanned when a build exists.
{
  const d = mkdtempSync(join(tmpdir(), 'dist-scan-'))
  try {
    mkdirSync(join(d, 'assets'))
    writeFileSync(join(d, 'assets/a.js'), 'x="SENTINEL-CREDIT-RESTRICTED";fetch("/moon/internal/coverage-internal.json")')
    const f = d + '.json'; writeFileSync(f, JSON.stringify(hosted))
    const bad = scanDist(d, restrictedStrings([f]))
    assert.ok(bad.length >= 3, `scanner flags dev path and restricted credit: ${bad.join(' | ')}`)
    writeFileSync(join(d, 'assets/a.js'), 'x=1')
    assert.deepEqual(scanDist(d, restrictedStrings([f])), [])
  } finally { rmSync(d, { recursive: true, force: true }); rmSync(d + '.json', { force: true }) }
}
try {
  const bad = scanDist(join(root, 'dist'), distNeedles(root))
  assert.deepEqual(bad, [], 'dist carries no restricted coverage strings')
  console.log('dist scanned')
} catch (e) {
  if ((e as NodeJS.ErrnoException).code === 'ENOENT') reportSkip('coverage-internal dist scan', 'data', 'no dist/ (npm run build runs scripts/assert-dist-public.mjs)')
  else throw e
}
console.log('coverage-internal.test ok')
