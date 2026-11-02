// Issue #67: the bottom UI holds at 150% and 200% text size. The CSS rules that make it hold, each the same px as before at a
// 16 px root (scripts/a11y-text-size-shots.mjs is the browser check).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const css = (f: string): string => readFileSync(fileURLToPath(new URL(`../src/ui/${f}`, import.meta.url)), 'utf8')
const bar = css('bar.css'), nav = css('navigator.css'), pins = css('pins.css'), caption = css('caption.css')

// The time sheet: the clock time is never cut; the range buttons wrap under the date instead.
assert.match(bar, /\.bar-time \.bar-sheet-head \{ flex-wrap: wrap;/)
assert.match(bar, /\.bar-time \.bar-sheet-head button\.bar-when \{ min-width: min\(100%, 7em\); \}/)
// Sheet and caption widths follow the text size (32.5rem = 520 px, 26.25rem = 420 px, 45rem = 720 px, 28.75rem = 460 px at 16 px).
assert.match(bar, /\.bar-sheet \{\n {2}box-sizing: border-box; width: min\(32\.5rem, 100%\);/)
assert.match(bar, /width: min\(26\.25rem, 100%\);/)
assert.match(pins, /width: min\(45rem, 100%\);/)
assert.match(caption, /max-width: min\(28\.75rem, 100%\);/)
// The viewpoint caption wraps the count under the name before the name is cut (and is not there at all before a viewpoint); the filmstrip's cards widen with the text.
assert.match(nav, /\.nav-caption \{[^}]*flex-wrap: wrap;[^}]*gap: 0 8px;/)
assert.match(nav, /\.nav-caption\[hidden\] \{ display: none; \}/)
assert.match(nav, /width: var\(--card-w, max\(132px, 8\.25rem\)\)/)
assert.match(nav, /--card-w: clamp\(132px, 10\.5rem, 20vw\)/)
// No px widths left on the sheets that hold text.
assert.doesNotMatch(bar + pins, /width: min\((?:520|420|720)px/)
// The brand line wraps "(Credits)" under the address where it is wider than the screen (a 320 px phone at 200%) instead of running off it.
const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8')
assert.match(html, /#credit \{ position: absolute;[^}]*max-width: calc\(100vw - 24px\);[^}]*white-space: normal;/)
console.log('text-size-layout: ok')
