import assert from 'node:assert/strict'
import { QUALITY_CHOICES } from '../src/ui/qualityChoices.ts'
import { PRESET_DEFAULTS } from '../src/quality/settings.ts'

// One clear choice in plain words, in order of power use, each with one line about what it changes.
assert.deepEqual(QUALITY_CHOICES.map((c) => c.title), ['Battery saver', 'Balanced', 'Best'])
assert.deepEqual(QUALITY_CHOICES.map((c) => c.value), ['battery', 'auto', 'high'])
for (const c of QUALITY_CHOICES) {
  const line = c.line()
  assert.ok(line.length > 30 && line.length < 220, `${c.title}: one short line`)
  assert.match(line, /shadow/i, `${c.title}: says what it does to shadows`)
}
// The words follow the presets: only Battery trades shadows (Fast) and surface texture (Reduced).
assert.equal(PRESET_DEFAULTS.battery.shadows, 'fast')
assert.equal(PRESET_DEFAULTS.battery.detail, 'reduced')
assert.match(QUALITY_CHOICES[0].line(), /approximate/)
assert.match(QUALITY_CHOICES[0].line(), /surface texture is left out/)
for (const p of ['auto', 'high'] as const) { assert.equal(PRESET_DEFAULTS[p].shadows, 'full'); assert.equal(PRESET_DEFAULTS[p].detail, 'full') }
assert.match(QUALITY_CHOICES[1].line(), /Full crater shadows/)
assert.match(QUALITY_CHOICES[2].line(), /Full crater shadows/)
console.log('quality-choices: ok')
