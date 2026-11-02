import assert from 'node:assert/strict'
import test from 'node:test'
import { moonCoverFragment, moonFragment, tileEnvelopeFragment } from '../src/moon/moonShader'

/**
 * Every uniform a Moon fragment variant reads is declared in that variant. The no-tiles variant (Home: tiles idle) is compiled only on a
 * GPU, so a uniform declared inside the tiles block and read in the common code (#309's rim cap, uTileTanPerPx) blacked the Moon at
 * Home without any test failing. Comments are stripped first; `uv*` locals are not uniforms.
 */
function undeclared(frag: string): string[] {
  const code = frag.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const declared = new Set<string>()
  for (const m of code.matchAll(/uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?\w+\s+(u[A-Z]\w*)/g)) declared.add(m[1])
  const used = new Set<string>()
  for (const m of code.matchAll(/\bu[A-Z]\w*/g)) used.add(m[0])
  return [...used].filter((u) => !declared.has(u)).sort()
}

const patch = [{ h: true, r: true, fadeM: 1596 }, { h: true, r: true, fadeM: 800, cache: true }]
const variants: Array<[string, string]> = [
  ['no tiles (Home)', moonFragment(360, 8192, '', false, null, false, 0, false, false, false, false)],
  ['no tiles, production margin', moonFragment(180, 4096, '', false, null, false, 0, false, 'margin', false, false)],
  ['tiles', moonFragment(360, 8192, '', true, null, false, -3, false, false, false, false)],
  ['tiles, production margin', moonFragment(180, 4096, '', true, null, false, -3, false, 'margin', false, false)],
  ['tiles + metadata', moonFragment(360, 8192, '', true, null, true, -3, false, false, false, false)],
  ['tiles + detail + tc', moonFragment(360, 8192, '', true, null, false, -3, true, 'margin', true, false)],
  ['tiles + patch', moonFragment(180, 4096, '', true, patch, false, -3, false, 'margin', false, false)],
  ['tiles + patch, baked', moonFragment(180, 4096, '', true, patch, false, -3, false, 'margin', false, true)],
  ['tiles, fixed policy (horizon envelopes)', moonFragment(180, 4096, '', true, null, false, 0, false, 'margin', false, false, true)],
  ['tiles + detail + tc, fixed policy', moonFragment(180, 4096, '', true, null, false, -3, true, 'margin', true, false, true)],
  ['no tiles, fixed policy', moonFragment(180, 4096, '', false, null, false, 0, false, 'margin', false, false, true)],
  ['tile envelope build', tileEnvelopeFragment(180, 4096, 0)],
  ['tile envelope build, deep', tileEnvelopeFragment(180, 4096, -3)],
  ['cover', moonCoverFragment(180, 4096)],
  ['cover + patch', moonCoverFragment(180, 4096, patch, -3)],
]
for (const [name, frag] of variants) {
  test(`moon fragment (${name}) declares every uniform it reads`, () => {
    assert.deepEqual(undeclared(frag), [], `${name}: used but not declared`)
  })
}
