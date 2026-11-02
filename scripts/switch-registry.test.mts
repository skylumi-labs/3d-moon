// Every URL query parameter the viewer reads is in the switch registry (src/debug/switches.ts), and the registry is consistent.
// The scan is the guard: a new `params.get('x')` / `new URLSearchParams(location.search).get('x')` / `urlNumber('x')` that is not registered fails here.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { MOMENTS } from '../src/moments.ts'
import { GROUPS, MOMENT_IDS, SHARE_KEYS, SWITCHES, allDefaults, nonDefault, readSwitch, withSwitch } from '../src/debug/switches.ts'
import { debugEnabled } from '../src/debug/gate.ts'
import { DEV_SWITCHES } from '../src/debug/devSwitches.ts'
import { PERF_SWITCHES } from '../src/telemetry/config.ts'
import { VIEW_KEYS } from '../src/intro/parse.ts'
import { SHARED_EXTRA } from '../src/ui/firstHotspots.ts'
import { VIEW_QUERY_PARAMS } from '../src/native/deepLink.ts'

const SRC = new URL('../src/', import.meta.url).pathname
/** Registered in dev builds only (restricted data): their entries live in devSwitches.ts and are compiled out of production. */
const known = new Set([...SWITCHES, ...DEV_SWITCHES].map((s) => s.name))

/** Names read that are not switches. Empty on purpose: add one only with a reason. */
const NON_SWITCH: Record<string, string> = {
  // The envelope functional-test page (envelope-test.html, never part of the app): its own parameters.
  n: 'test page: CPU-twin sample count',
  real: 'test page: use the real 4k height map',
  low: 'test page: phone-class envelope',
  side: 'test page: read rows per side',
  block: 'test page: build block size',
  azs: 'test page: azimuth-sample variants',
}

/**
 * Reads whose name is a variable, not a literal. Each is a reader that takes its names from a list this test checks against the registry below.
 * Key: `<file under src/>:<identifier>`.
 */
const NON_LITERAL: Record<string, string> = {
  'main.ts:k': 'num(k) and readShare((k) => params.get(k)): the share keys (SHARE_KEYS) and lon/lat/dist/roll/journey are registered',
  'ui/firstHotspots.ts:k': 'isSharedLink: VIEW_KEYS and SHARED_EXTRA, both checked below',
  'intro/parse.ts:k': 'VIEW_KEYS.some((k) => params.has(k)): VIEW_KEYS is checked below',
  'quality/settings.ts:name': 'for (const name of [phonemotion, motionshader]): both registered',
  'quality/settings.ts:n': 'dropUrlParam: the names it removes are the quality parameters, registered',
  'telemetry/config.ts:name': 'activeSwitches over PERF_SWITCHES: checked below',
  'moon/moonShader.ts:name': 'dialValue(search, name, ...): the dial names are scanned at their urlNumber( call sites',
  'moon/baked/format.ts:k': 'tune(k, ...): the names are scanned at their tune( call sites',
  'native/deepLink.ts:k': 'viewQueryOnly / linkRoute over VIEW_QUERY_PARAMS and lon/lat/dist: checked below',
}

/** Files allowed to mention window.__moonQuery (the Artifact preview's query carrier). Their reads then go through a scanned URLSearchParams. */
// native/boot.ts and native/deepLink.ts write it (a launch link, filtered through viewQueryOnly to VIEW_QUERY_PARAMS, checked below).
const MOON_QUERY_FILES = new Set(['main.ts', 'telemetry/boot.ts', 'telemetry/config.ts', 'moon/tiles/wanted.ts', 'moon/tiles/fades.ts', 'moon/tiles/focusPull.ts', 'ground/nearField.ts', 'native/boot.ts', 'native/deepLink.ts'])

const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  if (n === '__tests__' || n === 'node_modules') return []
  return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|js|mjs)$/.test(n) ? [p] : []
})

const BAL = String.raw`(?:[^()]|\((?:[^()]|\([^()]*\))*\))*`
/** The scan. Exported shape: names read (literal), and identifiers read (non-literal), from one source text. */
export function scan(source: string): { literal: string[]; ident: string[]; viaHelper: string[]; moonQuery: boolean } {
  const aliases = [...source.matchAll(/\b(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:\w+\s*\?\s*)?new URLSearchParams\(/g)].map((m) => m[1])
  const recv = String.raw`(?:\bparams|\bsearchParams|\bq|\busp|${aliases.map((a) => String.raw`\b${a}`).join('|') || '\\bq'}|URLSearchParams\(${BAL}\))`
  const lit = new RegExp(String.raw`${recv}\s*\.\s*(?:get|has|getAll)\s*\(\s*(['"` + '`' + String.raw`])([^'"` + '`' + String.raw`]+)\1`, 'g')
  const idn = new RegExp(String.raw`${recv}\s*\.\s*(?:get|has|getAll)\s*\(\s*([A-Za-z_]\w*)\s*\)`, 'g')
  const helper = /\b(?:urlNumber|tune)\(\s*'([^']+)'|\bdialValue\([^,()]+(?:\([^()]*\))?[^,()]*,\s*'([^']+)'/g
  return {
    literal: [...source.matchAll(lit)].map((m) => m[2]),
    ident: [...source.matchAll(idn)].map((m) => m[1]),
    viaHelper: [...source.matchAll(helper)].map((m) => m[1] ?? m[2]),
    moonQuery: source.includes('__moonQuery'),
  }
}

// ---- the scan sees what it should (and would see an unregistered read)
assert.deepEqual(scan("new URLSearchParams(location.search).get('x1')").literal, ['x1'])
assert.deepEqual(scan("new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('x2')").literal, ['x2'])
assert.deepEqual(scan("params.has('x3'); q.getAll('x4'); u.searchParams.get('x5')").literal, ['x3', 'x4', 'x5'])
assert.deepEqual(scan("const usp2 = new URLSearchParams(s); usp2.get('x6')").literal, ['x6'])
assert.deepEqual(scan("const q = typeof location === 'undefined' ? null : new URLSearchParams(location.search); q.get('x7')").literal, ['x7'])
assert.deepEqual(scan("params.get(k)").ident, ['k'])
assert.deepEqual(scan("urlNumber('x8', 1, 2); tune('x9', 1, 2, 3)").viaHelper, ['x8', 'x9'])
assert.deepEqual(scan("dialValue(location.search, 'x10', 1, 2, 0, 1)").viaHelper, ['x10'])
assert.deepEqual(scan("items.get('more'); map.get('x11')").literal, [], 'a Map is not a URLSearchParams')

// ---- every read in src/ is registered
let seen = 0
const readNames = new Set<string>()
const unknown: string[] = [], badIdent: string[] = [], moonQueryFiles = new Set<string>()
for (const f of files(SRC)) {
  const rel = relative(SRC, f)
  if (rel === 'debug/switches.ts') continue // the registry's own helpers read by registered name
  const r = scan(readFileSync(f, 'utf8'))
  if (r.moonQuery) moonQueryFiles.add(rel)
  for (const n of [...r.literal, ...r.viaHelper]) {
    seen++
    readNames.add(n)
    if (!known.has(n) && !(n in NON_SWITCH)) unknown.push(`${rel}: ${n}`)
  }
  for (const id of r.ident) if (!(`${rel}:${id}` in NON_LITERAL)) badIdent.push(`${rel}: ${id}`)
}
assert.ok(seen > 150, `the scan found the reads (saw ${seen})`)
assert.deepEqual(unknown, [], 'register the switch in src/debug/switches.ts, or allow-list a non-switch name in NON_SWITCH with a reason')
assert.deepEqual(badIdent, [], 'a read by variable name: list it in NON_LITERAL with the list it iterates, and check that list against the registry')
assert.deepEqual([...moonQueryFiles].sort(), [...MOON_QUERY_FILES].sort(), 'a new window.__moonQuery user needs review: its reads must go through a scanned URLSearchParams')
for (const [k, why] of Object.entries(NON_SWITCH)) assert.ok(why.length > 10, `${k} has a reason`)

// ---- the lists behind the non-literal reads are registered
for (const n of [...PERF_SWITCHES, ...VIEW_KEYS, ...SHARED_EXTRA, ...SHARE_KEYS, ...VIEW_QUERY_PARAMS, 'phonemotion', 'motionshader', 'lon', 'lat', 'dist', 'roll', 'journey']) assert.ok(known.has(n), `${n} is registered`)

// ---- every registered switch is read somewhere (a stale entry is a lie): by a scanned read, or by a list the test checks above
const byList = new Set<string>([...PERF_SWITCHES, ...VIEW_KEYS, ...SHARED_EXTRA, ...SHARE_KEYS, 'phonemotion', 'motionshader', 'lon', 'lat', 'dist', 'roll', 'journey'])
assert.deepEqual([...SWITCHES, ...DEV_SWITCHES].map((s) => s.name).filter((n) => !readNames.has(n) && !byList.has(n)), [], 'registered but never read in src/')

// ---- the registry is consistent
const names = SWITCHES.map((s) => s.name)
assert.equal(new Set(names).size, names.length, 'unique names')
const stars = SWITCHES.find((s) => s.name === 'stars')!
assert.deepEqual(stars.values, ['native', 'scene', '0'])
assert.equal(stars.def, null, 'the star path follows the device class: native dots on desktop, scene sprites elsewhere')
assert.match(stars.effect, /native on the desktop class/)
for (const s of SWITCHES) {
  assert.ok(GROUPS.includes(s.group), `${s.name}: known group`)
  assert.ok(s.effect.length > 8, `${s.name}: has an effect line`)
  if (s.def !== null && s.values.length) assert.ok(s.values.includes(s.def), `${s.name}: the default is one of the values`)
  assert.equal(new Set(s.values).size, s.values.length, `${s.name}: values unique`)
}
for (const g of GROUPS) assert.ok(SWITCHES.some((s) => s.group === g), `${g} has switches`)
assert.deepEqual(DEV_SWITCHES.map((s) => s.name), ['internal'], 'only the internal-only coverage switch is dev-only')
assert.ok(DEV_SWITCHES.every((s) => s.restricted))
assert.ok(SWITCHES.every((s) => !s.restricted), 'a production-visible switch is never restricted')
// What ships in the production panel must not name the restricted data: no name, group or effect text in the production list says "internal".
for (const s of SWITCHES) assert.ok(!/internal/i.test(`${s.name} ${s.group} ${s.effect} ${s.values.join(' ')}`), `${s.name}: no mention of internal in production text`)

assert.deepEqual([...MOMENT_IDS], MOMENTS.map((m) => m.id), 'the moment buttons are the moments')

// ---- helpers
assert.equal(readSwitch('pump', '?pump=1'), '1')
assert.equal(readSwitch('pump', ''), '0')
assert.equal(readSwitch('pump', '?pump=zz'), '0', 'a value that is not offered acts as the default')
assert.equal(readSwitch('uploads', ''), null)
assert.equal(readSwitch('lon', '?lon=12.5'), '12.5', 'free-form values pass through')
assert.throws(() => readSwitch('nope', ''), /unregistered/)
const base = 'https://x.test/moon/index.html?debug=1&pump=1&shreach=300&lon=3&moment=surface#h'
assert.equal(withSwitch(base, 'pump', '0'), 'https://x.test/moon/index.html?debug=1&shreach=300&lon=3&moment=surface#h', 'the default removes the parameter')
assert.equal(withSwitch(base, 'prefeat', '1'), base.replace('#h', '&prefeat=1#h'))
assert.equal(allDefaults(base), 'https://x.test/moon/index.html?debug=1&lon=3&moment=surface#h', 'reset keeps the gate and the view')
assert.deepEqual(nonDefault(base), ['pump', 'shreach'])
// look: a, alt and old are modes and reset; sun, earth and 0..1 frame a shared link and stay
const lk = (v: string) => `https://x.test/m/?debug=1&look=${v}&pump=1`
assert.equal(allDefaults(lk('a')), 'https://x.test/m/?debug=1', 'look=a is reset')
assert.equal(allDefaults(lk('alt')), 'https://x.test/m/?debug=1')
assert.equal(allDefaults(lk('old')), 'https://x.test/m/?debug=1')
for (const v of ['sun', 'earth', '0.5']) assert.equal(allDefaults(lk(v)), `https://x.test/m/?debug=1&look=${v}`, `look=${v} is kept`)
assert.deepEqual(nonDefault(lk('a')), ['pump', 'look'], 'look=a counts as a changed setting')
assert.deepEqual(nonDefault(lk('sun')), ['pump'])
assert.equal(readSwitch('look', '?look=alt'), 'alt')
assert.equal(readSwitch('look', '?look=sun'), null, 'a framing value is not a mode')
// the opening, idle orbit and seed stay, so the B arm plays the same opening as the A arm
assert.equal(allDefaults('https://x.test/m/?debug=1&intro=0&auto=0&seed=7&pump=1'), 'https://x.test/m/?debug=1&intro=0&auto=0&seed=7')
assert.equal(debugEnabled(''), false)
assert.equal(debugEnabled('?debug=1'), true)
assert.equal(debugEnabled('?debug=0'), false)
assert.equal(debugEnabled('?debug=1&still=1'), false, 'never in a capture')
console.log(`switch registry: ${SWITCHES.length} switches, ${seen} reads scanned`)
