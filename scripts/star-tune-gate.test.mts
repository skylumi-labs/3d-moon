import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Stars are always on for a visitor: no Stars button. The brightness slider is the owner's tool and lives only in the hidden debug sheet.
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.doesNotMatch(main, /id: 'stars'/, 'there is no Stars bar item')
assert.doesNotMatch(main, /mountStarTune/, 'main mounts no floating star slider')
const sheet = readFileSync(new URL('../src/ui/debugSheet.ts', import.meta.url), 'utf8')
assert.match(sheet, /mountStarTune\(/, 'the debug sheet carries the star brightness slider')
assert.match(main, /mountDebugSheet\(/, 'main mounts the debug sheet')
assert.match(main, /hud\.onSecretTap\(/, 'the Credits link opens it')
console.log('star-tune-gate: ok')
