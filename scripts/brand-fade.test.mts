// The brand line fade logic: hidden while moving, fades in after more than BRAND_STILL_MS of stillness, out again on input/motion, held by the popover or keyboard focus.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BRAND_STILL_MS, brandDueIn, brandInput, brandTick, initialBrandFade } from '../src/ui/brandFade.ts'

let s = initialBrandFade
assert.ok(!s.shown, 'hidden at start')
s = brandTick(s, false, false, 500)
assert.ok(!s.shown, 'hidden while the camera moves')
s = brandTick(s, true, false, 1000)
assert.ok(!s.shown, 'still, but not for long enough')
s = brandTick(s, true, false, 1000 + BRAND_STILL_MS)
assert.ok(!s.shown, 'exactly BRAND_STILL_MS is not yet more than 2 s')
s = brandTick(s, true, false, 1000 + BRAND_STILL_MS + 1)
assert.ok(s.shown, 'faded in after more than 2 s of stillness')
s = brandTick(s, true, false, 99999)
assert.ok(s.shown, 'stays visible while still')
s = brandTick(s, false, false, 100000)
assert.deepEqual(s, initialBrandFade, 'camera motion fades it out')
s = brandTick(s, true, false, 200000); s = brandTick(s, true, false, 200000 + BRAND_STILL_MS + 1)
assert.ok(s.shown)
assert.ok(!brandInput(s).shown && brandInput(s).quietSince < 0, 'input hides it and restarts the spell')
s = brandInput(s)
s = brandTick(s, false, true, 300000)
assert.ok(s.shown, 'an open popover (or keyboard focus) holds the line even while moving')
s = brandTick(s, false, true, 300000 + 10 * BRAND_STILL_MS)
assert.ok(s.shown, 'held however long')
s = brandTick(s, false, false, 300000 + 10 * BRAND_STILL_MS + 1)
assert.ok(!s.shown, 'releasing the hold while moving hides it')

// The fade-in is due on its own timer, independent of the frame loop (it idles at 2.5 s, beating once a second): the due time is exact.
{
  let d = brandTick(initialBrandFade, true, false, 5000)
  assert.equal(brandDueIn(initialBrandFade, 5000), null, 'no still spell, nothing due')
  assert.equal(brandDueIn(d, 5000), BRAND_STILL_MS + 1, 'due just past BRAND_STILL_MS after the first still tick')
  assert.equal(brandDueIn(d, 5000 + 1500), BRAND_STILL_MS + 1 - 1500, 'no 1 s heartbeat wait')
  assert.equal(brandDueIn(d, 5000 + BRAND_STILL_MS + 400), 0, 'overdue is due now')
  d = brandTick(d, true, false, 5000 + BRAND_STILL_MS + 1)
  assert.ok(d.shown, 'the timer callback shows the line on time')
  assert.equal(brandDueIn(d, 99999), null, 'in: nothing more to schedule')
  assert.equal(brandDueIn(brandInput(d), 99999), null, 'input restarts the spell (re-armed by the next tick)')
}

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
assert.match(html, /#credit\[data-brand='out'\] \.brand-text[^{]*\{[^}]*opacity: 0/, 'faded out is opacity 0')
assert.match(html, /#credit\[data-brand='out'\] \.credit-link \{[^}]*pointer-events: none/, 'a faded line takes no pointer events')
const ui = readFileSync(new URL('../src/ui/brandFade.ts', import.meta.url), 'utf8')
assert.match(ui, /setTimeout\(/, 'the fade runs on its own timer')
assert.match(ui, /clearTimeout\(/, 'activity cancels the pending timer')
assert.doesNotMatch(ui, /INPUTS = \[[^\]]*'pointermove'/, 'a mouse moving towards (Credits) does not hide the line')
assert.match(ui, /el\.contains\(e\.target\)/, 'a press on the line itself does not hide it')
assert.match(html, /--brand-max: 0\.5/, 'the ceiling is half transparent')
console.log('brand-fade: ok')
