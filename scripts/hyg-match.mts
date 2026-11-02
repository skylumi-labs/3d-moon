// Which HYG release is shared-assets/asteroid-stars.json? Compares it with one HYG CSV (hygdata_vNN.csv, optionally .gz).
//   node --import tsx scripts/hyg-match.mts <hygdata_vNN.csv[.gz]>
// Prints the star counts and the share of shipped stars found at the same RA, Dec and magnitude (to the shipped rounding).
// A release that matches every star, with the same count to V 6.5, is the source; record it in DATA-LICENSES.md.
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

export const HYG_MAG_LIMIT = 6.5
type Star = readonly number[]

/** Parses a HYG CSV (columns id, ra in hours, dec, mag; quoted fields allowed) into [raDeg, decDeg, mag] to V <= limit, Sol excluded. */
export function hygStars(csv: string, limit = HYG_MAG_LIMIT): Array<[number, number, number]> {
  const lines = csv.split(/\r?\n/).filter(Boolean)
  const split = (l: string): string[] => l.split(',').map((c) => c.replace(/^"|"$/g, ''))
  const head = split(lines[0])
  const col = (n: string): number => { const i = head.indexOf(n); if (i < 0) throw new Error(`HYG CSV has no "${n}" column`); return i }
  const [id, ra, dec, mag] = ['id', 'ra', 'dec', 'mag'].map(col)
  const out: Array<[number, number, number]> = []
  for (const l of lines.slice(1)) {
    const c = split(l)
    const m = Number(c[mag])
    if (c[id] === '0' || !Number.isFinite(m) || m > limit) continue
    out.push([Number(c[ra]) * 15, Number(c[dec]), m])
  }
  return out
}

const key = (ra: number, dec: number, mag: number): string => `${ra.toFixed(3)}|${dec.toFixed(3)}|${mag.toFixed(2)}`

/** How many shipped stars a catalogue holds, matched on RA and Dec to 0.001 degree and magnitude to 0.01. */
export function matchHyg(shipped: readonly Star[], catalogue: ReadonlyArray<readonly [number, number, number]>): { shipped: number; catalogue: number; matched: number } {
  const have = new Set(catalogue.map(([r, d, m]) => key(r, d, m)))
  const matched = shipped.filter((s) => have.has(key(s[0], s[1], s[2]))).length
  return { shipped: shipped.length, catalogue: catalogue.length, matched }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (!file) throw new Error('usage: hyg-match.mts <hygdata_vNN.csv[.gz]>')
  const raw = readFileSync(file)
  const csv = (file.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8')
  const shipped = (JSON.parse(readFileSync(new URL('../shared-assets/asteroid-stars.json', import.meta.url), 'utf8')) as { stars: Star[] }).stars
  const r = matchHyg(shipped, hygStars(csv))
  console.log(JSON.stringify({ file, ...r, share: +(r.matched / r.shipped).toFixed(4) }))
}
