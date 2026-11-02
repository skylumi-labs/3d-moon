// Shared by data-licenses.test.mts and the checksum writer: parses DATA-LICENSES.md and public/THIRD-PARTY-NOTICES.txt, lists the
// data files the repository ships, and reads or writes DATA-SHA256SUMS.txt.
//   node --import tsx scripts/data-licenses-lib.mts --write-checksums   (after a deliberate change to a bundled data file)
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const CHECKSUM_FILE = 'DATA-SHA256SUMS.txt'
/** Folders whose files ship as data (bundled into the build or read by it). */
export const DATA_ROOTS = ['public/', 'shared-assets/', 'data/']
/** Shipped files that are software, not data: third-party decoders and fonts, the notices, and the project's own boot guard (index.html loads it before the module). */
export const SOFTWARE_FILES = /^public\/(draco\/|fonts\/|THIRD-PARTY-NOTICES\.txt$|boot-guard\.js$)/
/** Credit ids that name no data source: software (in the notices file) and the project's own notes. */
export const SOFTWARE_CREDIT_IDS = ['astronomy-engine', 'open-source']
export const NO_SOURCE_CREDIT_IDS = ['modelled-light', 'telemetry']

export interface DataRow { id: string; source: string; credit: string; terms: string; version: string; files: string[]; mirror: string }

const cells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const unquote = (s: string): string => s.replace(/^`|`$/g, '')

/** The rows of the one table in DATA-LICENSES.md. Repository paths are the backticked tokens under a data root or src/. */
export function parseDataLicenses(text: string): DataRow[] {
  const lines = text.split('\n')
  const head = lines.findIndex((l) => l.startsWith('| Credit id |'))
  if (head < 0) throw new Error('DATA-LICENSES.md: no table with a "Credit id" column')
  const names = cells(lines[head])
  const want = ['Credit id', 'Source', 'Credit line', 'Terms', 'Version / date', 'Files in this repository', 'Mirror']
  if (names.join('|') !== want.join('|')) throw new Error(`DATA-LICENSES.md: columns must be ${want.join(', ')}`)
  const rows: DataRow[] = []
  for (const line of lines.slice(head + 2)) {
    if (!line.startsWith('|')) break
    const c = cells(line)
    if (c.length !== want.length) throw new Error(`DATA-LICENSES.md: row has ${c.length} cells: ${line.slice(0, 60)}`)
    const files = [...c[5].matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((p) => [...DATA_ROOTS, 'src/'].some((r) => p.startsWith(r)))
    rows.push({ id: unquote(c[0]), source: c[1], credit: c[2], terms: c[3], version: c[4], files, mirror: c[6] })
  }
  return rows
}

/** The row that covers a file: the longest matching entry (a path ending in / is a folder). */
export function rowFor(rows: readonly DataRow[], file: string): DataRow | undefined {
  let best: { row: DataRow; len: number } | undefined
  for (const row of rows) for (const entry of row.files) {
    const hit = entry.endsWith('/') ? file.startsWith(entry) : file === entry
    if (hit && (!best || entry.length > best.len)) best = { row, len: entry.length }
  }
  return best?.row
}

export interface NoticeSection { header: string; licence: string; body: string }

/** Sections of THIRD-PARTY-NOTICES.txt: a header block between two rules of '='; the licence is the last parenthesis of its first line. */
export function parseNotices(text: string): NoticeSection[] {
  const parts = text.split(/^={20,}$/m)
  const out: NoticeSection[] = []
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const header = parts[i].trim()
    const parens = [...header.split('\n')[0].matchAll(/\(([^)]*)\)/g)].map((m) => m[1])
    out.push({ header, licence: normaliseLicence(parens.at(-1) ?? ''), body: parts[i + 1] })
  }
  return out
}

export const normaliseLicence = (s: string): string => s.replace(/Apache License,? (Version )?2\.0/g, 'Apache-2.0').trim()

/** "three.js (MIT), Tabler Icons by Paweł Kuna (MIT), ..." as name and licence pairs. */
export function parseSoftwareCredit(credit: string): Array<{ name: string; licence: string }> {
  return [...credit.matchAll(/([^,()]+?)\s*\(([^)]*)\)/g)].map((m) => ({ name: m[1].trim(), licence: normaliseLicence(m[2]) }))
}

export function trackedDataFiles(root = ROOT): string[] {
  return execFileSync('git', ['ls-files', '-z', ...DATA_ROOTS], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
    .split('\0').filter(Boolean).filter((p) => !SOFTWARE_FILES.test(p) && !p.endsWith('.md')).sort()
}

export const sha256File = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

/** `sha256sum` format, sorted by path, so `sha256sum -c DATA-SHA256SUMS.txt` checks it. */
export function checksumText(files: readonly string[], root = ROOT): string {
  return files.map((f) => `${sha256File(join(root, f))}  ${f}\n`).join('')
}

export function parseChecksums(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split('\n').filter(Boolean)) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line)
    if (!m) throw new Error(`${CHECKSUM_FILE}: bad line "${line}"`)
    out.set(m[2], m[1])
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--write-checksums')) {
  const files = trackedDataFiles()
  writeFileSync(join(ROOT, CHECKSUM_FILE), checksumText(files))
  console.log(`${CHECKSUM_FILE}: ${files.length} files`)
}
