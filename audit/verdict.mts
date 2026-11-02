/** Release verdicts are independent of the browser and fail closed. */
export interface AuditResult { gate: string; scenario: string; pass: boolean | null; detail: string }
/** `pins` is the visitor path (every hotspot from Home); `chips`, `playall`, `scrub` are the archive's (?archive=1). */
export const SCENARIOS = ['pins', 'chips', 'playall', 'liftoff', 'scrub', 'orbit', 'flight', 'ground', 'layout', 'robust', 'lunation'] as const
export const GATES = ['G1', 'G2', 'G2b', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'ERR'] as const
export function validateSelection(selected: string[], chips: string[] = [], knownChips: string[] = []): void {
  if (!selected.length || selected.some(s => !SCENARIOS.includes(s as typeof SCENARIOS[number]))) throw new Error('Unknown or empty scenario selection: ' + selected.join(','))
  if (new Set(selected).size !== selected.length) throw new Error('Duplicate scenario selection')
  if (chips.some(id => !knownChips.includes(id))) throw new Error('Unknown chip selection')
}
const REQUIRED: Record<string, string[]> = {
  chips: ['G1', 'G2', 'G2b', 'G3', 'G4', 'G6', 'G8'], playall: ['G1', 'G2', 'G2b', 'G3', 'G6', 'G8'],
  liftoff: ['G1', 'G2', 'G2b', 'G3', 'G4', 'G6', 'G8'], scrub: ['G1', 'G2', 'G2b', 'G3', 'G6', 'G8'],
  orbit: ['G1', 'G2', 'G2b', 'G3', 'G6', 'G8'], flight: ['G1', 'G2', 'G2b', 'G3', 'G6', 'G8'],
  ground: ['G1', 'G2', 'G2b', 'G3', 'G6', 'G8'], layout: ['G5', 'G6'], robust: ['G7'],
  lunation: ['G1', 'G2', 'G2b', 'G3', 'G6', 'G8'],
}
const scopeOf = (name: string): string => name.startsWith('chip-') ? 'chips' : name.startsWith('pin-') ? 'pins' : name.startsWith('layout-') ? 'layout' : name === 'time' ? 'orbit' : name
export function aggregate(results: AuditResult[], selected: string[], completed: string[]): { exitCode: number; missing: string[]; verdict: Record<string, string> } {
  const missing = selected.filter(s => !completed.includes(s))
  for (const scenario of selected) for (const gate of REQUIRED[scenario] ?? ['UNKNOWN'])
    if (!results.some(r => scopeOf(r.scenario) === scenario && r.gate === gate)) missing.push(`${scenario}:${gate}`)
  const verdict: Record<string, string> = {}
  for (const g of new Set([...GATES, ...results.map(r => r.gate)])) {
    const rs = results.filter(r => r.gate === g)
    verdict[g] = !rs.length ? 'not run' : rs.some(r => r.pass === false) ? 'FAIL' : rs.some(r => r.pass === null && /^unobservable/i.test(r.detail)) ? 'unobservable' : rs.every(r => r.pass === null) ? 'n/a' : 'pass'
  }
  // Unknown gates and explicit errors cannot disappear from the exit decision.
  const invalid = results.some(r => r.gate === 'ERR' || (r.pass === null && /^unobservable/i.test(r.detail)) || !GATES.includes(r.gate as typeof GATES[number]) || (r.pass !== true && r.pass !== false && r.pass !== null) || (r.pass === null && !r.detail.trim()))
  return { exitCode: !results.length || !selected.length || missing.length || invalid || results.some(r => r.pass === false) ? 1 : 0, missing, verdict }
}
export function cadence(frames: Array<{ t: number }>): { fps: number; maxGapS: number; count: number } {
  const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t)
  const span = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0
  return { count: frames.length, fps: span > 0 ? (frames.length - 1) / span : 0, maxGapS: gaps.length ? Math.max(...gaps) : Infinity }
}
