// The ground shader's text with the near field off (?near=off) is frozen (scripts/fixtures/ground-shader-default.json): the ?gsteps / ?gshadow measurement switches
// must not change a byte of it unless asked. Regenerate the fixture only for a deliberate shader change.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { groundFragment } from '../src/ground/groundShader.ts'

const gold = JSON.parse(fs.readFileSync(new URL('./fixtures/ground-shader-default.json', import.meta.url), 'utf8')) as Record<string, string>
for (const k of ['cover', 'shade', 'probe', 'metadata'] as const) {
  const now = groundFragment(k, 180, 4096, [{ h: true, r: true, fadeM: 40, shade: true }], false)
  assert.equal(now, gold[k], `ground ${k} shader text changed from the frozen near-off text`)
}
assert.ok(gold.shade.includes('i < 384'), 'default march is 384 steps')
console.log('ground-shader-default ok')
