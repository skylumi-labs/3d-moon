// The low-end hint's decision: measured slow motion or repeated long stalls only, never at start-up, never on a smooth device,
// once per visit, not after a dismissal, not in a flight's opening seconds.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FLIGHT_GRACE_MS, LONG_TASK_WINDOW_MS, LOW_END_TEXT, MAX_GAP_MS, SUSTAIN_MOVE_MS, initialLowEnd, lowEndFrame, lowEndLongTask, lowEndShouldShow, lowEndHintDevice,
  lowEndStruggling, type LowEndState,
} from '../src/ui/lowEndHint.ts'

const WARM = 10000
/** Frames every `dt` ms from `t0` for `ms`, moving or not, flying or not. */
const run = (s: LowEndState, t0: number, ms: number, dt: number, moving = true, flying = false): LowEndState => {
  for (let t = t0; t <= t0 + ms; t += dt) s = lowEndFrame(s, moving, flying, t, WARM)
  return s
}

// A smooth device (60 fps, and a steady 30 fps) never struggles, however long it moves.
assert.ok(!lowEndStruggling(run(initialLowEnd, WARM, 120000, 16.7), WARM + 120000), '60 fps')
assert.ok(!lowEndStruggling(run(initialLowEnd, WARM, 120000, 33.3), WARM + 120000), '30 fps')
// A few hitches in smooth motion (one 120 ms frame a second) do not either.
{
  let s = initialLowEnd
  for (let t = WARM; t < WARM + 60000; t += 1000) { s = run(s, t, 880, 16); s = lowEndFrame(s, true, false, t + 1000, WARM) }
  assert.ok(!lowEndStruggling(s, WARM + 60000), 'occasional hitches')
}
// Sustained slow frames while moving (12 fps): struggling once enough motion is measured, not before.
{
  const s1 = run(initialLowEnd, WARM, SUSTAIN_MOVE_MS - 200, 80)
  assert.ok(!lowEndStruggling(s1, WARM + SUSTAIN_MOVE_MS), 'not yet enough motion')
  const s2 = run(initialLowEnd, WARM, SUSTAIN_MOVE_MS + 200, 80)
  assert.ok(lowEndStruggling(s2, WARM + SUSTAIN_MOVE_MS + 200), '12 fps sustained')
}
// Start-up does not count: slow frames before the warm-up end are ignored.
assert.ok(!lowEndStruggling(run(initialLowEnd, 0, WARM - 100, 80), WARM), 'warm-up')
// A still view does not count (the idle loop beats once a second), nor does a gap (tab hidden).
assert.ok(!lowEndStruggling(run(initialLowEnd, WARM, 60000, 1000, false), WARM + 60000), 'still')
{
  let s = initialLowEnd
  for (let t = WARM; t < WARM + 60000; t += MAX_GAP_MS + 1) s = lowEndFrame(s, true, false, t, WARM)
  assert.ok(!lowEndStruggling(s, WARM + 60000), 'gaps over MAX_GAP_MS are not frames')
}
// Long tasks over 200 ms: three while moving within 30 s; not while still, not short ones, not old ones.
{
  let s = run(initialLowEnd, WARM, 20000, 16.7)
  const t = WARM + 20000
  s = lowEndLongTask(s, t - 100, 250, WARM); s = lowEndLongTask(s, t - 50, 199, WARM); s = lowEndLongTask(s, t - 20, 260, WARM)
  assert.ok(!lowEndStruggling(s, t), 'two long tasks and a short one')
  s = lowEndLongTask(s, t, 300, WARM)
  assert.ok(lowEndStruggling(s, t), 'three long tasks while moving')
  assert.ok(!lowEndStruggling(s, t + LONG_TASK_WINDOW_MS + 1000), 'old stalls expire')
  const still = run(run(initialLowEnd, WARM, 5000, 16.7), WARM + 5100, 10000, 1000, false)
  let q = still
  for (const at of [WARM + 12000, WARM + 13000, WARM + 14000]) q = lowEndLongTask(q, at, 400, WARM)
  assert.ok(!lowEndStruggling(q, WARM + 14000), 'stalls while the view is still are not interaction')
  let w = run(initialLowEnd, 0, 5000, 16.7)
  for (const at of [1000, 2000, 3000]) w = lowEndLongTask(w, at, 400, WARM)
  assert.ok(!lowEndStruggling(w, 3000), 'stalls during the warm-up do not count')
}
// Showing: struggling, never twice, never after a dismissal, and not in a flight's opening seconds (it waits, then shows).
{
  const slow = run(initialLowEnd, WARM, 6000, 80)
  const t = WARM + 6000
  assert.ok(lowEndShouldShow(slow, t, false, false))
  assert.ok(!lowEndShouldShow(slow, t, true, false), 'dismissed before')
  assert.ok(!lowEndShouldShow(slow, t, false, true), 'once per visit')
  const flight = run(slow, t + 80, 3000, 80, true, true)
  assert.ok(!lowEndShouldShow(flight, t + 3080, false, false), 'not in a flight\'s opening seconds')
  const later = run(flight, t + 3160, FLIGHT_GRACE_MS, 80, true, true)
  assert.ok(lowEndShouldShow(later, t + 3160 + FLIGHT_GRACE_MS, false, false), 'after the grace, during the flight')
  assert.ok(!lowEndShouldShow(run(initialLowEnd, WARM, 60000, 16.7), WARM + 60000, false, false), 'smooth: never')
}
// Wording and wiring: honest, measured (no user-agent sniffing), dismissal in try/catch, announced, at the top (clear of the bottom controls).
assert.match(LOW_END_TEXT, /struggling to keep up.*laptop or desktop/)
assert.equal(lowEndHintDevice(true, 5), true, 'coarse pointer with touch is a phone or tablet')
assert.equal(lowEndHintDevice(true, 0), false, 'coarse pointer without touch is not enough')
assert.equal(lowEndHintDevice(false, 5), false, 'touchscreen laptops with a primary fine pointer do not get the hint')
const src = readFileSync(new URL('../src/ui/lowEndHint.ts', import.meta.url), 'utf8')
assert.doesNotMatch(src, /userAgent|navigator\.|deviceMemory|hardwareConcurrency/, 'no device guesses')
assert.match(src, /try \{ localStorage\.setItem/, 'dismissal is stored in try/catch')
assert.match(src, /try \{ dismissed = localStorage\.getItem/, 'read in try/catch')
assert.match(src, /announce\(\{ kind: 'hint'/, 'announced politely')
assert.match(src, /position:absolute;top:/, 'at the top of the screen, not over the bottom controls')
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.match(main, /lowEndHint\?\.tick\(visitorQuiet,/, 'fed by the visitor-facing quiet flag (still ground frames are not motion)')
assert.match(main, /lowEndHintDevice\(matchMedia\('\(pointer: coarse\)'\)\.matches, navigator\.maxTouchPoints\)/, 'mounted only on touch-first devices')
console.log('low-end-hint: ok')

// The hint leaves by itself after a few seconds (2026-10-26), long enough to read two short sentences.
{
  const { LOW_END_SHOW_MS } = await import('../src/ui/lowEndHint.ts')
  assert.ok(LOW_END_SHOW_MS >= 6000 && LOW_END_SHOW_MS <= 15000)
}
