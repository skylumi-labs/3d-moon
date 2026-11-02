/** The HUD respects the notch and the home indicator under viewport-fit=cover (issue 199). */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const rule = (sel: string, from = 0): string => {
  const i = html.indexOf(`${sel} {`, from)
  assert.ok(i >= 0, `rule ${sel}`)
  return html.slice(i, html.indexOf('}', i))
}
assert.match(html, /viewport-fit=cover/)
for (const sel of ['#hud', '.hud-i', '.hud-notes']) assert.match(rule(sel), /env\(safe-area-inset-top/, `${sel} clears the top inset`)
assert.match(rule('#credit'), /left: calc\(12px \+ env\(safe-area-inset-left/, '#credit (the brand line) clears the left inset')
assert.match(rule('#credit'), /bottom: calc\(var\(--dock-top/, '#credit stands just above the dock (--dock-top)')
const small = html.indexOf('@media (max-width: 800px)')
for (const sel of ['#hud', '.hud-i', '.hud-notes']) assert.match(rule(sel, small), /env\(safe-area-inset-top/, `${sel} (narrow) clears the top inset`)
assert.doesNotMatch(html, /\.watermark/, 'the bottom watermark is gone (the brand line replaces it)')
assert.match(rule('#hud'), /z-index: \d/, 'the HUD stacks above the label search box (z-index 4 in .moon-labels)')
assert.match(rule('.hud-notes'), /100dvh/, '.hud-notes height uses dvh')
console.log('hud-safe-area.test: ok')
