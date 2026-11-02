// Keeps the three source lists in step: the Credits panel (src/ui/credits.ts), the data licences (DATA-LICENSES.md) and the software
// notices (public/THIRD-PARTY-NOTICES.txt), plus the per-file checksums of the shipped data (DATA-SHA256SUMS.txt).
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CREDIT_CATALOG } from '../src/ui/credits.ts'
import { APOLLO17_PANORAMAS } from '../src/ground/pano/manifest.ts'
import {
  CHECKSUM_FILE, NO_SOURCE_CREDIT_IDS, ROOT, SOFTWARE_CREDIT_IDS, checksumText, normaliseLicence, parseChecksums, parseDataLicenses,
  parseNotices, parseSoftwareCredit, rowFor, sha256File, trackedDataFiles,
} from './data-licenses-lib.mts'

const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')
const licences = read('DATA-LICENSES.md')
const rows = parseDataLicenses(licences)
const notices = parseNotices(read('public/THIRD-PARTY-NOTICES.txt'))
const byId = new Map(CREDIT_CATALOG.map((c) => [c.id, c]))

// The parsers on small inputs.
{
  const t = '| Credit id | Source | Credit line | Terms | Version / date | Files in this repository | Mirror |\n|---|---|---|---|---|---|---|\n'
    + '| `a` | s | c | t | v | `public/x/`, `data/y.json` (all but `z.json`) | `tiles/` |\n\nafter'
  const r = parseDataLicenses(t)
  assert.deepEqual(r.map((x) => [x.id, x.files]), [['a', ['public/x/', 'data/y.json']]], 'only backticked repository paths count as files')
  assert.equal(rowFor(r, 'public/x/q.webp')?.id, 'a')
  assert.equal(rowFor(r, 'public/xq.webp'), undefined, 'a folder entry matches only inside the folder')
  assert.deepEqual(parseSoftwareCredit('three.js (MIT), Tabler Icons by Paweł Kuna (MIT), posthog-js (Apache-2.0 and MIT)'),
    [{ name: 'three.js', licence: 'MIT' }, { name: 'Tabler Icons by Paweł Kuna', licence: 'MIT' }, { name: 'posthog-js', licence: 'Apache-2.0 and MIT' }])
  assert.equal(normaliseLicence('Apache License 2.0 and MIT'), 'Apache-2.0 and MIT')
  assert.deepEqual(parseNotices('x\n=====================\nFoo 1.0  (MIT)  https://a\n=====================\nbody\n').map((s) => s.licence), ['MIT'])
}

// Every Credits row is a data row, a software row or a note; every data row is a Credits row with the same credit line, word for word.
{
  const ids = CREDIT_CATALOG.map((c) => c.id as string)
  const dataIds = rows.map((r) => r.id)
  assert.equal(new Set(dataIds).size, dataIds.length, 'one DATA-LICENSES.md row per credit id')
  for (const id of ids) {
    const kinds = [dataIds.includes(id), SOFTWARE_CREDIT_IDS.includes(id), NO_SOURCE_CREDIT_IDS.includes(id)].filter(Boolean).length
    assert.equal(kinds, 1, `credit id ${id} must be exactly one of: a DATA-LICENSES.md row, a software id, a no-source id`)
  }
  for (const row of rows) {
    const c = byId.get(row.id as never)
    assert.ok(c, `DATA-LICENSES.md row ${row.id} has no Credits panel entry`)
    assert.equal(row.credit, c.credit, `DATA-LICENSES.md credit line for ${row.id} must equal src/ui/credits.ts`)
    assert.match(row.terms, /\]\(https:\/\//, `${row.id}: the terms cell links the terms`)
    assert.ok(row.version.length > 0 && row.source.length > 0, `${row.id}: source and version are stated`)
    for (const f of row.files) assert.ok(existsSync(join(ROOT, f)), `${row.id}: ${f} does not exist`)
  }
  for (const id of [...SOFTWARE_CREDIT_IDS, ...NO_SOURCE_CREDIT_IDS]) assert.ok(licences.includes(`\`${id}\``), `DATA-LICENSES.md names the non-data row ${id}`)
}

// Every data file the repository ships is covered by a row and has a checksum; the checksums are current.
{
  const files = trackedDataFiles()
  assert.ok(files.length > 50, 'the data file list is not empty')
  const uncovered = files.filter((f) => !rowFor(rows, f))
  assert.deepEqual(uncovered, [], `data files with no DATA-LICENSES.md row:\n${uncovered.join('\n')}`)
  const recorded = parseChecksums(read(CHECKSUM_FILE))
  const missing = files.filter((f) => !recorded.has(f))
  const stale = [...recorded.keys()].filter((f) => !files.includes(f))
  const changed = files.filter((f) => recorded.has(f) && recorded.get(f) !== sha256File(join(ROOT, f)))
  const fix = 'run node --import tsx scripts/data-licenses-lib.mts --write-checksums after checking the change is meant'
  assert.deepEqual({ missing, stale, changed }, { missing: [], stale: [], changed: [] }, `${CHECKSUM_FILE} is out of date (${fix})`)
  assert.equal(read(CHECKSUM_FILE), checksumText(files), `${CHECKSUM_FILE} is sorted and in sha256sum format`)
}

// The software credit and the notices file list the same components under the same licences, at the versions the build installs.
{
  const software = parseSoftwareCredit(byId.get('open-source')!.credit)
  assert.equal(software.length, notices.length, 'the open-source credit and THIRD-PARTY-NOTICES.txt list the same number of components')
  for (const s of software) {
    const key = s.name.split(' ')[0]
    const hits = notices.filter((n) => n.header.includes(key))
    assert.equal(hits.length, 1, `exactly one notices section names ${key}`)
    assert.equal(hits[0].licence, s.licence, `${s.name}: licence in the Credits panel and the notices file agree`)
  }
  const lock = JSON.parse(read('package-lock.json')).packages as Record<string, { version: string }>
  for (const [pkg, label] of [['three', 'three.js'], ['astronomy-engine', 'Astronomy Engine'], ['@sentry/browser', '@sentry/browser'], ['posthog-js', 'posthog-js']]) {
    const v = lock[`node_modules/${pkg}`]?.version
    assert.ok(v, `${pkg} is installed`)
    // The whole version, not a prefix of a longer one (1.438.2 must not pass on a header that says 1.438.21).
    const exact = new RegExp(`(^|[^0-9.])${v.replace(/\./g, '\\.')}($|[^0-9.])`)
    assert.ok(notices.some((n) => n.header.includes(label) && exact.test(n.header)), `THIRD-PARTY-NOTICES.txt names ${label} ${v}, the installed version`)
  }
  const draco = notices.find((n) => n.header.includes('Draco'))!
  assert.ok(draco.body.includes(`three.js r${lock['node_modules/three'].version.split('.')[1]}`), 'the Draco decoder is recorded as shipped in the installed three.js release')
  assert.ok(existsSync(join(ROOT, 'public/draco/LICENSE')))
}

// One HYG link everywhere; the share-alike terms are stated with it.
{
  const hyg = 'https://codeberg.org/astronexus/hyg'
  assert.ok(byId.get('hyg-stars')!.links.some((l) => l.href === hyg), 'Credits panel links the HYG repository')
  assert.ok(notices.some((n) => n.header.startsWith('HYG') && n.header.includes(hyg) && n.licence === 'CC BY-SA 4.0'), 'notices link the same HYG repository')
  assert.ok(rows.find((r) => r.id === 'hyg-stars')!.terms.includes(`(${hyg})`), 'DATA-LICENSES.md links the same HYG repository')
  const all = [JSON.stringify(CREDIT_CATALOG), read('public/THIRD-PARTY-NOTICES.txt'), licences].join('\n')
  assert.ok(!all.includes('github.com/astronexus'), 'no stale GitHub HYG link')
}

// The panorama ids in the licence table and the Credits panel are the ones the viewer loads.
{
  const row = rows.find((r) => r.id === 'apollo-17-panoramas')!
  for (const p of APOLLO17_PANORAMAS) {
    assert.ok(row.source.includes(`\`${p.imageId}\``), `DATA-LICENSES.md names panorama ${p.imageId}`)
    assert.ok(byId.get('apollo-17-panoramas')!.credit.includes(p.imageId), `Credits panel names panorama ${p.imageId}`)
    for (const tier of p.tiers) for (const t of tier.tiles) assert.ok(existsSync(join(ROOT, 'public', t.path)), `${t.path} ships`)
  }
}

// The table lists public-cleared sources only and names no restricted product.
{
  for (const word of ['IS' + 'RO', 'CN' + 'SA', 'Chandra' + 'yaan', 'Chang\'' + 'e', 'Change-', 'OH' + 'RC', 'internal-only data:']) assert.ok(!licences.includes(word), `DATA-LICENSES.md must not name ${word}`)
  assert.match(licences, /## Restricted sources are excluded/)
  assert.match(licences, /licence: 'internal-only'/)
  assert.ok(rows.find((r) => r.id === 'jaxa-tc')!.credit === 'ISAS/JAXA (modified)')
  assert.match(rows.find((r) => r.id === 'jaxa-tc')!.terms, /We thank the SELENE\(KAGUYA\) TC team and the SELENE Data Archive/)
}

console.log(`data-licenses ok (${rows.length} data rows, ${notices.length} notices sections)`)
