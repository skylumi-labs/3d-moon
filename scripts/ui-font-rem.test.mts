// UI text must follow the OS/browser text size: no px font sizes in UI CSS, index.html styles or inline UI style strings.
// Canvas 2D `g.font` / `ctx.font` strings (rendering code) are out of scope.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const uiDir = 'src/ui'
const files = [
  'index.html',
  ...readdirSync(uiDir).filter((f) => f.endsWith('.css') || f.endsWith('.ts')).map((f) => join(uiDir, f)),
]
// font-size: Npx, or a font shorthand whose size token is Npx (before the /line-height).
const BAD = [/font-size\s*:\s*[^;}"'`]*\d(?:\.\d+)?px/g, /(?<![-\w])font\s*:\s*[^;}"'`]*?\d(?:\.\d+)?px\s*\//g]

const offenders: string[] = []
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (/\b(?:g|ctx)\.font\b/.test(line)) return
    for (const re of BAD) if (new RegExp(re.source).test(line)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`)
  })
}
assert.deepEqual(offenders, [], `px font sizes found (use rem/em/clamp):\n${offenders.join('\n')}`)

// The detector itself must catch the regressions it exists for.
assert.ok(BAD.some((re) => new RegExp(re.source).test('.a { font-size: 12px; }')))
assert.ok(BAD.some((re) => new RegExp(re.source).test('.a { font: italic 600 14px/1 serif; }')))
assert.ok(!BAD.some((re) => new RegExp(re.source).test('.a { font-size: 0.75rem; font: inherit; }')))
// (The flight pad's Orbit | Turn switch and its --tc-seg-* / --tc-dy sizes are gone, 2026-10-31: the pad holds no text in the rows.)
assert.ok(/#credit \.credit-close\s*\{[^}]*flex:\s*none/.test(readFileSync('index.html', 'utf8')), 'the credits Close button must not shrink below its label')
console.log(`ui-font-rem: ${files.length} files clean`)
