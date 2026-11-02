// Re-evaluates G1 and G3 over a finished run's saved stats.json (no browser): tsx audit/regate.mts <run dir>
// Needs no pixels, so G2/G2b/G4 (which read the grey frames) keep the verdicts recorded by the run.
import fs from 'node:fs'
import path from 'node:path'
import { aggregate } from './verdict.mts'
import { g1, g3 } from './gates.mts'
import { readStats, statsFile } from './stats.mts'
import type { DenseSeries } from './render.mts'

const dir = path.resolve(process.argv[2] ?? '')
const rep = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'))
const scen = (r: { scenario: string }) => r.scenario
let changed = 0
for (const r of rep.results as Array<{ gate: string; scenario: string; pass: boolean | null; detail: string }>) {
  if (r.gate !== 'G1' && r.gate !== 'G3') continue
  const f = statsFile(path.join(dir, scen(r)))
  if (!f) throw new Error(`Missing required saved evidence: ${path.join(dir, scen(r), 'stats.ndjson')}`)
  const s = readStats(f)
  const df = path.join(dir, scen(r), 'dense.json')
  const dense: DenseSeries | undefined = fs.existsSync(df) ? JSON.parse(fs.readFileSync(df, 'utf8')) : undefined
  const n = r.gate === 'G1' ? g1(r.scenario, s.frames, s.marks, dense) : g3(r.scenario, s.frames, s.marks, /^chip-|^playall|^liftoff|^flight|^ground/.test(r.scenario), dense)
  if (n.pass !== r.pass || n.detail !== r.detail) changed++
  r.pass = n.pass; r.detail = n.detail
}
const gates = new Set<string>(rep.results.map((r: { gate: string }) => r.gate))
for (const g of gates) { const rs = rep.results.filter((r: { gate: string }) => r.gate === g); rep.verdict[g] = rs.some((r: { pass: boolean | null }) => r.pass === false) ? 'FAIL' : rs.some((r: { pass: boolean | null; detail: string }) => r.pass === null && /^unobservable/i.test(r.detail)) ? 'unobservable' : rs.every((r: { pass: boolean | null }) => r.pass === null) ? 'n/a' : 'pass' }
fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(rep, null, 1))
console.log(`re-gated ${dir}: ${changed} result(s) changed`, JSON.stringify(rep.verdict))


const summary = aggregate(rep.results, rep.meta.scenarios ?? [], rep.meta.scenarios ?? [])
process.exit(summary.exitCode)
