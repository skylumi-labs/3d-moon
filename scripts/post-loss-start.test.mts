// Issue #206: after a lost GPU context the reloaded app sat on the "The Moon in 3D" splash (a Pixel 10 Pro XL, still there at 20 s and 40 s).
// The splash hid the page's own messages; a second loss under it stopped the frame loop that ends the opening, so nothing ever took it down;
// and the start's baked horizon was sized from the class profile, not the lowered ceiling the reload was meant to use. These pin the fixes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LOST_RELOADS_KEY } from '../src/quality/contextRecovery.ts'
import { introWanted } from '../src/intro/parse.ts'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const controller = readFileSync(new URL('../src/intro/controller.ts', import.meta.url), 'utf8')
const boot = readFileSync(new URL('../src/native/boot.ts', import.meta.url), 'utf8')

// 1. The start knows it is a post-loss reload from the same key native/boot.ts reads, and then puts no splash up.
assert.equal(LOST_RELOADS_KEY, 'moon.lostReloads')
assert.match(main, /const AFTER_LOSS = \(\(\): boolean => \{ try \{ return sessionStorage\.getItem\(LOST_RELOADS_KEY\) !== null \}/)
assert.match(main, /introWanted\(params, navigator\.webdriver === true, AFTER_LOSS\)/)
assert.match(boot, /sessionStorage\.getItem\(LOST_RELOADS_KEY\) !== null/, 'boot and main read the same key')
assert.equal(introWanted(new URLSearchParams(''), false, true), false)

// 2. A loss takes the splash down and ends the opening before it says anything (the frame loop that would end it has stopped).
const lost = main.slice(main.indexOf("canvas.addEventListener('webglcontextlost'"))
assert.ok(lost.length > 0)
const abortAt = lost.indexOf('intro?.abort()'), msgAt = lost.indexOf("hud.message('The graphics context was lost")
assert.ok(abortAt > 0 && msgAt > abortAt, 'intro?.abort() runs before the message')
const abort = controller.slice(controller.indexOf('  abort(): void {'), controller.indexOf('  seek(u: number | null): void {'))
assert.match(abort, /this\.splash\?\.dispose\(\)/)
assert.match(abort, /this\.splash = null/, 'the pending poll sees another splash and stops')
assert.match(abort, /this\.finish\(\)/, 'finish() removes body.intro-on, which hides #ui')
assert.match(controller, /private finish\(\): void \{[\s\S]*?document\.body\.classList\.remove\('intro-on'\)/)

// 3. The start's baked horizon uses the ceiling in force (lowered after a loss), never the profile's.
assert.ok(!/configureBaked\([^)]*quality\.profile\.ceilingBytes/.test(main), 'no configureBaked from the profile ceiling')
console.log('post-loss-start: ok')
