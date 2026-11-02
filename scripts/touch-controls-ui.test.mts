// touchControls: the hint names the right inputs, ?controls and the stored choice still decide the start state.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PAD_LABELS, TILT_WORDS, hintFor, sideControlStep, initiallyOpen, padChoice, padOpenFor } from '../src/ui/touchControlsLogic.ts'

assert.match(hintFor(false), /Shift-drag or right-drag to tilt/)
assert.match(hintFor(false), /scroll to zoom/)
assert.match(hintFor(false), /W and S fly forward and back/, 'the keys are documented')
assert.match(hintFor(false), /A and D sidestep/)
assert.doesNotMatch(hintFor(false), /finger/)
assert.match(hintFor(true), /Two-finger twist to rotate/)
assert.doesNotMatch(hintFor(true), /Shift|scroll/)

// No drag modes (owner 2026-10-31): the hint says what a drag on the Moon and on the sky does, and that the clock alone moves the light.
for (const coarse of [false, true]) {
  assert.match(hintFor(coarse), /drag the Moon to turn it or the sky to fly around it \(the shadows stay: only the clock moves the light\)/)
  assert.doesNotMatch(hintFor(coarse), /Orbit|Turn mode|look around/)
}
assert.doesNotMatch(JSON.stringify(PAD_LABELS), /Orbit|Turn|Drag mode/, 'no labels for a mode switch')
// The gesture hint is gone from the column (it lives in the Credits panel), and the one mode button is inside the pad, not in a second round-button row.
const ui = readFileSync(fileURLToPath(new URL('../src/ui/touchControls.ts', import.meta.url)), 'utf8')
assert.doesNotMatch(ui, /touch-ctl-hint/, 'no hint block under the controls')
assert.match(ui, /pad\.append\(tiltCap, sep\(\), zoomCap, sep\(\), flyStick\)/, 'the pad is one group: tilt pair | zoom | stick, with the bar\'s thin dividers')
assert.doesNotMatch(ui, /modeSwitch|radiogroup|dragMode|rotateClockwise/, 'no Orbit / Turn switch')
assert.doesNotMatch(ui, /controlStyle|ctl=/, 'one layout, no ?ctl= variants')
assert.match(ui, /iconSlot\.append\(toggle\)/, 'the controls toggle is the last icon of the bar')
// The tilt pair is back (owner review 2026-10-23, #11): Look up and Look down, a capsule like zoom (hold to repeat, Enter and Space), through hooks.tilt;
// always in the pad (owner decision 2026-10-24: nothing of the pad moves into More).
assert.match(ui, /const tiltCap = capsule\(PAD_LABELS\.tilt, tiltButton\(ICONS\.lookUp, BUTTON_LABELS\.lookUp, TILT_WORDS\.up, 1\), tiltButton\(ICONS\.lookDown, BUTTON_LABELS\.lookDown, TILT_WORDS\.down, -1\)\)/)
assert.match(ui, /hooks\.tilt\(axisUnits\('tilt', units, shortCss, fovDeg\)\.tiltPx\)/, 'a press is frame steps of the tilt axis')
assert.match(ui, /tilt\(px: number\): void/, 'the hook main.ts implements')
assert.doesNotMatch(ui, /matchMedia\(`\(max-width|modeInMore|tiltInRow|ROOMY_VIEWPORT_PX|TILT_VIEWPORT_PX|flightPadFitsRow/, 'no width exception moves a pad group into More')
assert.equal(PAD_LABELS.tilt, 'Look up or down')
assert.deepEqual(TILT_WORDS, { up: 'Look up', down: 'Look down' })
const tcss = readFileSync(fileURLToPath(new URL('../src/ui/touchControls.css', import.meta.url)), 'utf8')
assert.match(tcss, /\.tc-cap \.lbl \{ display: none; \}/, 'no words in the row')
assert.doesNotMatch(tcss, /\.bar-more \.touch-ctl-mode|\.bar-more \.tc-cap/, 'no pad group has a style in the More sheet')
// main.ts: in orbit the rig's tilt (its own limits); on the ground the view turns by the angle the px span, up for a positive px (look's dy is positive downward).
const mainTs = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8')
assert.match(mainTs, /tilt: \(px\) => camStep\(\(now\) => \{\n\s+const gm = groundMode\?\.active \? groundMode : null\n\s+if \(gm\) gm\.cam\.look\(0, -px \* 2 \* Math\.atan\(gm\.cam\.view\.tanHalf\) \* 180 \/ Math\.PI \/ Math\.max\(1, canvas\.clientHeight\)\)\n\s+else rig\.tilt\(px, /)


const up = sideControlStep('up', 800, 30)
const down = sideControlStep('down', 800, 30)
const ccw = sideControlStep('counterclockwise', 800, 30)
const cw = sideControlStep('clockwise', 800, 30)
assert.equal(up.tiltPx, 120, 'one up tap tilts toward the horizon (more pitch)')
assert.equal(down.tiltPx, -120, 'down is the opposite of up')
assert.equal(sideControlStep('forward', 800, 30).movePx, 120, 'forward is a positive move')
assert.equal(sideControlStep('back', 800, 30).movePx, -120)
assert.equal(sideControlStep('forward', 800, 30).tiltPx, 0)
assert.doesNotMatch(ui, /compass/i, 'the compass is gone')
assert.equal(ccw.rollDeg, 4.5, 'counter-clockwise follows the icon direction through CameraRig.twist')
assert.equal(cw.rollDeg, -4.5, 'clockwise is the opposite of counter-clockwise')
assert.match(readFileSync(fileURLToPath(new URL('../src/ui/labels.css', import.meta.url)), 'utf8'), /\.ml\s*\{[^}]*touch-action:\s*none/s,
  'draggable labels disable browser touch gestures so they do not cancel pointer drags or pinch zoom')

assert.equal(initiallyOpen('', null), false)
assert.equal(initiallyOpen('', '1'), true)
assert.equal(initiallyOpen('?controls=1', '0'), true)
assert.equal(initiallyOpen('?controls=0', '1'), false)
// The pad opens by itself on a desktop while manual navigation is on (owner review 2026-10-23, #11 and #12), unless the visitor said otherwise (?controls=, the remembered toggle); a phone starts closed.
assert.equal(padChoice('', null), null, 'no say of the visitor\'s')
assert.equal(padChoice('', '1'), true); assert.equal(padChoice('', '0'), false)
assert.equal(padChoice('?controls=1', '0'), true); assert.equal(padChoice('?controls=0', '1'), false)
assert.equal(padChoice('?controls=2', null), null, 'an unknown value is no choice')
assert.equal(padOpenFor(null, true, true), true, 'desktop, moving by hand: open')
assert.equal(padOpenFor(null, true, false), false, 'desktop, at a viewpoint: closed')
assert.equal(padOpenFor(null, false, true), false, 'a phone starts closed even while moving by hand')
assert.equal(padOpenFor(false, true, true), false, 'the visitor closed it: it stays closed')
assert.equal(padOpenFor(true, false, false), true, 'the visitor opened it: it stays open')
assert.match(ui, /barEl\?\.addEventListener\('barmanual', \(e\) => \{ manual = \(e as CustomEvent<boolean>\)\.detail; follow\(\) \}\)/, 'the bar tells the pad')
assert.match(ui, /const fine = window\.matchMedia\('\(hover: hover\) and \(pointer: fine\)'\)/, 'a desktop is a fine pointer that hovers')
assert.match(ui, /const desktop = \(\): boolean => fine\.matches/, 'and the pad always fits somewhere: its own row')
assert.match(ui, /toggle\.addEventListener\('click', \(\) => setOpen\(!open, true\)\)/, 'the toggle is the visitor\'s own choice (remembered)')
assert.match(ui, /<span class="lbl">Controls<\/span>/, 'the toggle has its word for the More sheet')
assert.match(tcss, /\.bar-more \.tc-toggle \.tc-ico\.close, \.bar-more \.tc-toggle\[aria-pressed='true'\] \.tc-ico\.open \{ display: none; \}/, 'one icon in the More sheet')

// The pad has its own row in the dock, so the dock-top the brand line stands at already clears it: no .pad-above rule is left.
assert.doesNotMatch(ui, /pad-above/)
const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8')
// F12/F14/F11 (layout polish): credits panel in rem, the card width capped, the filmstrip's scrollbar styled, the brand line's halo stronger.
assert.match(html, /\.credit-full \{\s*position: absolute;[^}]*width: min\(26rem, calc\(100vw - 24px\)\);[^}]*max-height: min\(72vh, 40rem\)/)
assert.doesNotMatch(html, /width: min\(340px, calc\(100vw - 24px\)\)/, 'no fixed 340 px credits panel')
const navcss = readFileSync(fileURLToPath(new URL('../src/ui/navigator.css', import.meta.url)), 'utf8')
assert.match(navcss, /\.viewpoints-list \{[^}]*scrollbar-width: thin;[^}]*scrollbar-color:/)
assert.match(html, /#credit \{ position: absolute;[^}]*text-shadow: 0 0 2px #000, 0 1px 3px #000, 0 0 10px/, 'a dark halo keeps the brand line readable on bright terrain')
console.log('touch-controls-ui: ok')
