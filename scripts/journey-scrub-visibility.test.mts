import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ENDING_MS, nextEndingUntil, scrubHandleShown, scrubVisibility } from '../src/ui/journeyScrubVisibility'

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

// The ridge keeps its own controls; every other journey shows the slider.
assert.equal(scrubHandleShown('ridge'), false)
for (const id of ['cinematic', 'orbit', 'descent', 'flight']) assert.equal(scrubHandleShown(id), true, id)

const v = (handleId: string | null, animating: boolean, endingUntil: number, now: number) => scrubVisibility({ handleId, animating, endingUntil, now })
assert.equal(v('cinematic', true, 0, 0).mode, 'live')
assert.equal(v('ridge', false, 0, 0).mode, 'hidden')
// Lead-in with no live handle (approach tween, flight blending, waiting for its clock): shown, locked at 0.
assert.deepEqual(v(null, true, 0, 0), { mode: 'locked', lockedAt: 0 })
// After the natural end: held at the end for ENDING_MS, then gone.
assert.deepEqual(v(null, false, 3000, 2999), { mode: 'ending', lockedAt: 1 })
assert.equal(v(null, false, 3000, 3000).mode, 'hidden')
// Idle (a plain fly-to has no live handle and does not animate): hidden.
assert.equal(v(null, false, 0, 10).mode, 'hidden')

// Lifecycle on a clock: lead-in -> flight -> natural end (3 s) -> gone; a cancel drops the ending at once.
{
  let until = 0
  const step = (handleId: string | null, animating: boolean, cancelled: boolean, now: number): string => {
    until = nextEndingUntil(until, { handleId, cancelled, now })
    return v(handleId, animating, until, now).mode
  }
  assert.equal(step(null, true, false, 0), 'locked')
  assert.equal(step('cinematic', true, false, 100), 'live')
  assert.equal(step('cinematic', true, false, 40000), 'live')
  assert.equal(step(null, false, false, 40016), 'ending')
  assert.equal(step(null, false, false, 40000 + ENDING_MS - 1), 'ending')
  assert.equal(step(null, false, false, 40000 + ENDING_MS + 1), 'hidden')
  // cancel during the ending
  step('orbit', true, false, 50000)
  assert.equal(step(null, false, false, 50016), 'ending')
  assert.equal(step(null, false, true, 50032), 'hidden')
  assert.equal(step(null, false, false, 50048), 'hidden')
  // the ridge never lingers
  step('cinematic', true, false, 60000)
  step('ridge', false, false, 60016)
  assert.equal(step(null, false, false, 60032), 'hidden')
}

// Wiring in main.ts: one reset, called from every entry point that replaces or ends a journey.
const main = read('../src/main.ts')
const body = (name: string): string => {
  const at = main.indexOf(`function ${name}(`)
  assert.ok(at >= 0, `${name} exists`)
  const next = main.indexOf('\nfunction ', at + 1)
  return main.slice(at, next < 0 ? undefined : next)
}
assert.match(main, /function resetScrubEnding\(\): void \{ scrubEndingUntil = 0; scrubCancelled = true \}/)
for (const fn of ['stopMoments', 'enterGround', 'leaveGround', 'startRouteFlight', 'goHome', 'playMoment']) {
  assert.match(body(fn), /resetScrubEnding\(\)/, `${fn} resets the slider's ending`)
}
// Ground mode and a route show clear it every frame, and the animating terms are the moment's own journeys (no plain tween).
assert.match(main, /if \(groundMode\?\.active \|\| routeFlight\) resetScrubEnding\(\)/)
assert.match(main, /const scrubAnimating = !!\(flight \|\| cinematicFlight \|\| orbitJourney \|\| descent\)/)
assert.match(main, /scrubPicked\.id !== 'tween'/)
// A moment's lead-in (the approach, Sharp's preparing beat) is live, not locked: its handle is picked before the plain tween's, and a drag
// past 0 starts the flight or orbit at the dragged progress (startLeadInAt), the approach landing where it was headed.
{
  const pick = body('pickHandle')
  assert.ok(pick.indexOf('leadInRunning()') > 0 && pick.indexOf('leadInRunning()') < pick.indexOf('if (tween)'), 'the lead-in comes before the plain tween')
  assert.ok(pick.indexOf('orbitJourney.t0 >= 0') < pick.indexOf('leadInRunning()'), 'a journey with its clock wins over its lead-in')
  assert.match(main, /const leadInHandle: JourneyHandle = \{\n\s+id: 'lead-in', leadIn: true,/)
  assert.match(main, /set: \(u, now\) => \{ if \(u > 0\) startLeadInAt\(u, now \?\? performance\.now\(\)\) \}/)
  const start = body('startLeadInAt')
  for (const re of [/tw\.t0 = now - tw\.plan\.ms/, /stepTween\(now\)/, /tween = null/, /joinHandOverAt = null/, /cin\.t0 = t0AtProgress\(now, u, cin\.definition\.seconds \* 1000\)/, /cin\.prep = undefined/, /orbit\.t0 = t0AtProgress\(now, u, ORBIT_SECONDS \* 1000\)/]) assert.match(start, re, String(re))
  assert.equal(scrubVisibility({ handleId: 'lead-in', animating: true, endingUntil: 0, now: 0 }).mode, 'live')
  // The stall guard never moves a flight's clock under a held slider (the frame would be drawn behind the finger).
  assert.match(body('stepCinematic'), /if \(flight\.pausedU == null && !scrub\.held\) \{ flight\.t0 \+= stallShift/)
}
assert.match(main, /scrubUi\?\.update\(scrubVis\)/)

// The DOM branch: locked and ending are shown, disabled, named for assistive tech, with no pause button.
const ui = read('../src/ui/journeyScrub.ts')
const locked = ui.slice(ui.indexOf("vis.mode === 'locked'"), ui.indexOf('wrap.classList.remove'))
for (const re of [/wrap\.hidden = false/, /input\.disabled = true/, /pauseB\.hidden = true/, /input\.setAttribute\('aria-label'/, /lastLabel = ''/, /js-ending/]) assert.match(locked, re, String(re))
assert.match(ui, /input\.disabled = false/)
// V9 "I can't go back" (Apollo 11 load): the slider replaces the list button, never Back, and Back stays before it.
{
  const css = read('../src/ui/navigator.css')
  const hidden = [...css.matchAll(/\.bar\.flying ([^{]*) \{ display: none; \}/g)].map((m) => m[1]).join(',')
  assert.match(hidden, /\.nav-list/, 'the list button gives way to the slider')
  assert.doesNotMatch(hidden, /\.nav-prev/, 'Back is never hidden by the slider')
  assert.match(css, /\.bar\.flying \.nav-prev \{ order: -1; \}/)
}
console.log('journey-scrub-visibility ok')
