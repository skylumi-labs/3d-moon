/**
 * The navigator's Left and Right (src/ui/navKeys.ts). The journey slider sits in the pill, so its arrows used to bubble to the pill and
 * step to the next viewpoint, which ended the flight being scrubbed: in an input they belong to the input.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { navArrowStep } from '../src/ui/navKeys.ts'

const k = (key: string, more: Partial<Parameters<typeof navArrowStep>[0]> = {}) =>
  navArrowStep({ key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, inInput: false, ...more })

assert.equal(k('ArrowRight'), 'next')
assert.equal(k('ArrowLeft'), 'prev')
assert.equal(k('ArrowUp'), null)
assert.equal(k('Enter'), null)
for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) assert.equal(k('ArrowRight', { [mod]: true }), null, mod)
assert.equal(k('ArrowRight', { inInput: true }), null, 'the slider keeps its arrows')
assert.equal(k('ArrowLeft', { inInput: true }), null, 'the slider keeps its arrows')

// The wiring: the pill's handler asks navArrowStep with the press's target, and the slider (in the pill) steps itself while taking the flexible row space.
const nav = readFileSync(new URL('../src/ui/navigator.ts', import.meta.url), 'utf8')
assert.match(nav, /navArrowStep\(\{[^}]*inInput: e\.target instanceof HTMLInputElement/)
assert.match(nav, /pill\.append\(sliderSlot/, 'the slider is inside the pill (why the guard is needed)')
const navCss = readFileSync(new URL('../src/ui/navigator.css', import.meta.url), 'utf8')
assert.match(navCss, /\.nav-slider:has\(\.journey-scrub:not\(\[hidden\]\)\) \{ display: flex; flex: 4 1 0;/, 'the journey slider keeps the row flexible')
// Return gets its own reserved slot; both arrows remain available while it shows, and continue to step.
assert.doesNotMatch(nav, /prevB\.hidden\s*=|nextB\.hidden\s*=/, 'Return does not hide either arrow')
assert.match(nav, /if \(!step\) return/, 'arrow keys are not suppressed when Return is available')
assert.doesNotMatch(nav, /if \(prevB\.hidden && \(act === prevB \|\| act === nextB\)\)/, 'no focus handoff from arrows that remain visible')
assert.doesNotMatch(nav, /prevB\.disabled = v\.canReturn/, 'Return does not disable the previous arrow')
const ui = readFileSync(new URL('../src/ui/journeyScrub.ts', import.meta.url), 'utf8')
assert.match(ui, /addEventListener\('keydown'[\s\S]*scrubKeyTarget\(e\.key, scrub\.progress\(\), scrub\.current\.durationS\)[\s\S]*e\.preventDefault\(\)/)
// The page's camera keys never take a press made in an input (main.ts and camera/controls.ts).
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.match(main, /window\.addEventListener\('keydown', \(e\) => \{\n\s+if \(e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey \|\| e\.target instanceof HTMLInputElement/)
// ‹ on the ground (owner complaint 10, 2026-10-23): the button and the Left key both go through `back()`, which asks viewpointList's prevMoveFrom with the host's
// onGround; a 'step' move is a go, an 'orbit' move runs the climb with the pill kept on the entry's first step. › stays nextPos. The flight again is its own chip.
assert.match(nav, /function back\(\): void \{\n\s+const m = prevMoveFrom\(entries, state\.pos, host\.onGround\?\.\(\) \?\? false\)/, '‹ asks prevMoveFrom with the ground state')
assert.match(nav, /if \(m\.kind === 'step'\) \{ go\(m\.pos, false, false, 'prev'\); return \}\n\s+opened\(m\.action, 'prev'\)\n\s+state = navArrive\(state, m\.pos\)\n\s+if \(ready\) host\.run\(m\.action\)/, 'an orbit move keeps the pill on the first step and runs the climb')
assert.match(nav, /prevB\.addEventListener\('click', back\)/, 'the ‹ button')
assert.match(nav, /if \(step === 'prev'\) \{ back\(\); return \}\n\s+const p = nextPos\(entries, state\.pos\)/, 'the Left key; Right stays nextPos')
assert.ok(!/prevPos\(entries, state\.pos\)/.test(nav), 'no path left that flies to the entry before from the ground')
assert.match(nav, /if \(host\.onGround\?\.\(\)\) \{\n\s+const r = el\('button', 'nav-subview nav-replay', 'Fly there again'\)/, 'the replay chip shows on the ground only')
assert.match(nav, /const ground = host\.onGround\?\.\(\) \?\? false\n\s+const sig = `[^`]*\$\{ground\}`/, 'the ground state is in the render signature, so the periodic update redraws on landing and on the climb')
assert.match(nav, /const key = `\$\{state\.pos\?\.entry \?\? -1\}\|\$\{entries\.length\}\|\$\{ground\}`/, 'and in the list key, so the chip is built after landing and removed after the climb')
assert.match(nav, /host\.run\(step\.action, resume \? \{ resume: true \} : replay \? \{ replay: true \} : undefined\)/, 'Return never carries replay; the chip does')
assert.match(main, /onGround: onApollo17Ground,/, 'main.ts tells the navigator when the visitor is on the Apollo 17 ground')
console.log('nav-keys ok')

// The pill's loading line carries the share once the size is known (owner walkthrough 2026-10-31: "Loading the photograph" with nothing moving for 33 s).
{
  const { progressLine } = await import('../src/net/load.ts')
  assert.equal(progressLine('Loading the photograph', null), 'Loading the photograph')
  assert.equal(progressLine('Loading the photograph', 0.426), 'Loading the photograph 42 %')
  assert.equal(progressLine('Loading the photograph', 1), 'Loading the photograph 99 %', 'never 100 % while the line still shows')
  assert.equal(progressLine('x', Number.NaN), 'x')
}
