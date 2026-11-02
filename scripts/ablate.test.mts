// ?ablate= (dev builds only): parse, golden shader equality without the switch, one spliced piece per name, per-pass marks in main.ts.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { ABLATE, ABLATE_NAMES, parseAblate } from '../src/abl.ts'
import { moonFragment } from '../src/moon/moonShader.ts'

const read = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')

test('parse: dev builds only, known names only, nothing without the switch', () => {
  assert.equal(ABLATE.size, 0, 'no switch, no ablation (node has no location)')
  assert.equal(parseAblate('?ablate=shadows,glare', false).size, 0, 'a production build ignores the switch')
  assert.deepEqual([...parseAblate('?ablate=shadows,glare,bogus, detail', true)].sort(), ['detail', 'glare', 'shadows'])
  assert.equal(parseAblate('', true).size, 0)
  assert.equal(parseAblate('?abl=shadow0&ablok=1', true).size, 0, 'the older abl switch is a separate path')
  assert.equal(ABLATE_NAMES.length, 6)
})

type Args = [number, number, string, boolean, null, boolean, number, boolean]
const variants: Array<[string, Args]> = [
  ['global tiles+detail', [360, 23040, '', true, null, false, -3, true]],
  ['no tiles', [360, 23040, '', false, null, false, 0, false]],
  ['metadata', [360, 23040, '', true, null, true, -3, true]],
]
function build(args: Args, ablate?: ReadonlySet<string>): string {
  const [l, m, x, t, p, md, d, td] = args
  return ablate ? moonFragment(l, m, x, t, p, md, d, td, undefined, false, false, false, ablate) : moonFragment(l, m, x, t, p, md, d, td)
}

test('golden: an empty ablation set leaves the shader byte-identical to the default', () => {
  for (const [name, args] of variants) {
    const base = build(args)
    assert.equal(build(args, new Set()), base, name)
    assert.doesNotMatch(base, /ablate=/, name)
    assert.doesNotMatch(base, /albedo \* max\(mu0, 0\.0\) \* lit/, name)
  }
})

test('shading and detail each change only their own piece of the program', () => {
  const args = variants[0][1]
  const base = build(args)
  const shading = build(args, new Set(['shading']))
  assert.match(shading, /sun = albedo \* max\(mu0, 0\.0\) \* lit; es = vec3\(0\.0\);/)
  assert.equal(shading.replace(/ {2}\/\/ \?ablate=shading[^\n]*\n {2}sun = albedo[^\n]*\n/, ''), base, 'removing the spliced lines gives the default program')
  const detail = build(args, new Set(['detail']))
  assert.notEqual(detail, base)
  assert.ok(detail.length < base.length, 'the detail layers are gone from the program')
  assert.equal(build(args, new Set(['glare', 'coverage'])), base, 'names handled outside the program text leave it alone')
})

test('wiring: shadows/viewhz/coverage/glare switches, per-pass marks, perf exposure, dev-only registration', () => {
  const shader = read('../src/moon/moonShader.ts')
  assert.match(shader, /ABL\.has\('shadow0'\) \|\| ABLATE\.has\('shadows'\)/)
  assert.match(shader, /ABL\.has\('noviewhz'\) \|\| ABLATE\.has\('viewhz'\)/)
  assert.match(read('../src/moon/MoonPass.ts'), /ABLATE\.has\('coverage'\)/)
  assert.match(read('../src/abl.ts'), /ABLATE\.has\('glare'\)/)
  const main = read('../src/main.ts')
  for (const n of ['sun-visibility-cache', 'patch-shadow-cache', 'viewer-visibility', 'moon', 'glare', 'final'])
    assert.ok(main.includes(`passTimer.mark('${n}')`), n)
  assert.match(main, /glare\.run\(renderer, t, [^\n]*passTimer\.mark\(n\)/)
  assert.match(main, /ablate: \[\.\.\.ABLATE\]/)
  const glare = read('../src/post/glare.ts')
  assert.match(glare, /glare-down\$\{level\+\+\}/)
  assert.match(glare, /glare-up\$\{i\}/)
  assert.match(read('../src/debug/switches.ts'), /sw\(X, 'ablate'.*Dev builds only/)
})
