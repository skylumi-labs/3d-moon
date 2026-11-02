import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { tablerIcon, TABLER_STROKE, type TablerName } from '../src/ui/tablerIcons.ts'

assert.equal(TABLER_STROKE, 1.8, 'SkyLumi stroke')
const names: TablerName[] = ['home', 'clock', 'upload', 'adjustmentsHorizontal', 'dots', 'mountain', 'chevronLeft', 'chevronRight', 'chevronDown', 'handMove', 'plus', 'minus', 'arrowBackUp', 'list', 'rotateClockwise', 'orbit']
for (const n of names) {
  const svg = tablerIcon(n, 22)
  assert.match(svg, /viewBox="0 0 24 24" width="22" height="22"/, n)
  assert.match(svg, /stroke-width="1.8"/, n)
  assert.match(svg, /<path d="[^"]+"\/>/, n)
}
assert.match(tablerIcon('chevronDown', 14), /width="14" height="14"/)
const notices = readFileSync(new URL('../public/THIRD-PARTY-NOTICES.txt', import.meta.url), 'utf8')
assert.match(notices, /Tabler Icons 3\.46\.0[\s\S]*Copyright \(c\) 2020-2026 Paweł Kuna/, 'Tabler Icons 3.46.0 licence is in the notices')
console.log('tabler-icons: ok')
