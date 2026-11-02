/**
 * The loop's rest state (R52, W2-M1): the gate, the wake rules, the caption's quiescence, the DOM lookup cache and the guard that every redraw request goes
 * through the one function that wakes a sleeping loop.
 *   npm test
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { HEARTBEAT_MS, IDLE_AFTER_MS, IdleGate, WAKE_EVENTS, beatDelay, idleOn, wakeAction } from '../src/loop/idle.ts'
import { resolvePace } from '../src/loop/paceMode.ts'
import { GROUND_STILL_MS, groundStill } from '../src/ground/groundStill.ts'
import { cachedQuery } from '../src/loop/domCache.ts'
import { LABELS } from '../src/labels/data.ts'
import { loadGazetteer } from '../src/labels/gazetteerTable.ts'
import { unitVector } from '../src/labels/spatial.ts'
import { highlightAnimating } from '../src/labels/highlightMotion.ts'
import { CentreCaption, type CamSample, type CaptionHost } from '../src/labels/centreCaptionCore.ts'

// ?idle=0 / off turn the sleep off; nothing else does.
assert.equal(idleOn(''), true)
assert.equal(idleOn('?idle=1'), true)
assert.equal(idleOn('?idle=0'), false)
assert.equal(idleOn('?idle=off'), false)
assert.equal(idleOn('?class=ios&idle=0'), false)
assert.equal(idleOn('?idle=maybe'), true)

// The gate sleeps only after IDLE_AFTER_MS of unbroken quiet, and any busy tick restarts the count.
{
  const g = new IdleGate()
  assert.equal(g.update(true, 1000), false)
  assert.equal(g.update(true, 1000 + IDLE_AFTER_MS - 1), false)
  assert.equal(g.update(true, 1000 + IDLE_AFTER_MS), true)
  assert.equal(g.update(false, 5000), false)
  assert.equal(g.update(true, 5016), false, 'the count restarted at the busy tick')
  assert.equal(g.update(true, 5016 + IDLE_AFTER_MS), true)
  g.reset()
  assert.equal(g.update(true, 9000), false, 'input resets the spell')
  assert.equal(g.update(true, 9000 + IDLE_AFTER_MS), true)
}

// Wake rules: a sleeping loop starts; a running one, a lost context and a paused shell are left alone.
assert.equal(wakeAction(false, false, false), 'run')
assert.equal(wakeAction(true, false, false), 'ignore')
assert.equal(wakeAction(false, true, false), 'ignore')
assert.equal(wakeAction(false, false, true), 'ignore')
for (const e of ['pointerdown', 'wheel', 'keydown', 'touchstart', 'resize', 'visibilitychange']) assert.ok(WAKE_EVENTS.includes(e), e)

// Simulation against the always-tick loop: random busy spells, redraw requests and inputs on a 60 Hz clock. A sleeping loop must (1) never sleep inside a busy
// spell or within IDLE_AFTER_MS of one, (2) tick on the very next vsync after a redraw request or an input, and (3) see a state with no wake call of its own
// (a "late" flag raised in the middle of a sleep) within one heartbeat plus a frame.
{
  let seed = 12345
  const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const gate = new IdleGate()
  let sleeping = false
  let nextBeat = 0
  let busyUntil = 0
  let lastBusyEnd = -1e9
  let pendingWake: number | null = null // time a wake was requested
  let late: number | null = null // time a silent state change happened
  let maxWakeLatency = 0, maxLateLatency = 0, sleeps = 0
  const FRAME = 1000 / 60
  for (let n = 0; n < 400000; n++) {
    const t = n * FRAME
    const roll = rnd()
    if (roll < 0.0004) { busyUntil = Math.max(busyUntil, t + rnd() * 6000); lastBusyEnd = busyUntil; if (sleeping) { sleeping = false; gate.reset(); pendingWake = t }} // a gesture, a fetch landing: a redraw request
    if (roll >= 0.0004 && roll < 0.0006) { // redraw request or input
      if (sleeping) { sleeping = false; gate.reset(); pendingWake = t }
    }
    if (roll >= 0.0006 && roll < 0.0007 && late === null) late = t // silent state
    if (sleeping && t >= nextBeat) { sleeping = false }
    if (sleeping) continue
    // a tick
    if (pendingWake !== null) { maxWakeLatency = Math.max(maxWakeLatency, t - pendingWake); pendingWake = null }
    if (late !== null) { maxLateLatency = Math.max(maxLateLatency, t - late); late = null }
    const busy = t < busyUntil
    if (gate.update(!busy, t)) {
      assert.ok(t - lastBusyEnd >= IDLE_AFTER_MS || lastBusyEnd < 0, `slept ${t - lastBusyEnd} ms after a busy spell`)
      sleeping = true; sleeps++
      nextBeat = t + HEARTBEAT_MS
    }
  }
  assert.ok(sleeps > 100, `the simulation slept (${sleeps})`)
  assert.ok(maxWakeLatency <= FRAME + 1e-6, `a wake ticks on the next vsync (${maxWakeLatency})`)
  assert.ok(maxLateLatency <= HEARTBEAT_MS + 2 * FRAME, `a silent change is seen within a heartbeat (${maxLateLatency})`)
}

// The caption machine is quiescent exactly when step() has nothing to do.
{
  const host: CaptionHost = { beginRead: () => false, pollRead: () => null, fallback: () => ({ lonDeg: NaN, latDeg: NaN, errKm: Infinity, fallback: true }), readable: () => false }
  const ctl = new CentreCaption(host)
  const CTX = { enabled: true, hidden: false, panorama: false, sheet: false, splash: false, dragging: false, usable: true }
  const cam = (dist: number): CamSample => ({ pos: [dist, 0, 0], back: [1, 0, 0], up: [0, 0, 1], tanHalf: 0.2, aspect: 1 })
  assert.equal(ctl.quiescent(0), true, 'no camera seen yet')
  ctl.sawCamera(cam(5), 0)
  ctl.step(16, CTX)
  assert.equal(ctl.quiescent(16), true, 'too wide to name: nothing to do')
  ctl.sawCamera(cam(1.1), 100)
  assert.equal(ctl.quiescent(116), false, 'a view that can be named has a timer running')
  for (let t = 116; t < 4000; t += 16) ctl.step(t, CTX)
  assert.equal(ctl.quiescent(4000), false, 'still working it out (CPU estimate unknown, hidden or arming)')
}

// A name that is up or leaving is never quiescent, even when the view has since become too wide to name anything.
{
  await loadGazetteer()
  const cop = LABELS.find((l) => l.name === 'Copernicus')!
  const RAD = Math.PI / 180
  const camAt = (spanKm: number): CamSample => {
    const tanHalf = 0.2679, dist = 1 + spanKm / (2 * tanHalf * 1737.4)
    const u = unitVector(cop.lat, cop.lon), la = cop.lat * RAD, lo = cop.lon * RAD
    return { pos: [u[0] * dist, u[1] * dist, u[2] * dist], back: [u[0], u[1], u[2]], up: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)], tanHalf, aspect: 1 }
  }
  const host: CaptionHost = { beginRead: () => false, pollRead: () => null, fallback: () => ({ lonDeg: cop.lon, latDeg: cop.lat, errKm: 0.001, fallback: false }), readable: () => false }
  const ctl = new CentreCaption(host)
  const CTX = { enabled: true, hidden: false, panorama: false, sheet: false, splash: false, dragging: false, usable: true }
  ctl.sawCamera(camAt(40), 0)
  let t = 0
  for (; t <= 2400; t += 16) ctl.step(t, CTX)
  assert.equal(ctl.current?.text, 'Copernicus')
  assert.equal(ctl.quiescent(t), false, 'a name is up')
  ctl.sawCamera(camAt(30000), t) // zoomed out past what can be named: the name starts to leave
  ctl.step(t, CTX)
  assert.equal(ctl.quiescent(t), false, 'the name is fading out')
  for (t += 16; t <= 4000; t += 16) ctl.step(t, CTX)
  assert.equal(ctl.quiescent(t), true, 'gone, and too wide to name')
}

// The cached lookup returns the same element until it leaves the document.
{
  let calls = 0
  let found: { isConnected: boolean } | null = { isConnected: true }
  const root = { querySelector: () => { calls++; return found } } as unknown as ParentNode
  const get = cachedQuery(root, '.dock')
  const a = get(), b = get(), c = get()
  assert.equal(calls, 1)
  assert.ok(a === b && b === c)
  const first = found!
  first.isConnected = false
  found = { isConnected: true }
  assert.ok(get() === found && get() !== first, 'a removed element is looked up again')
  assert.equal(calls, 2)
  found = null
  const miss = cachedQuery(root, '.nothing')
  assert.equal(miss(), null); assert.equal(miss(), null)
  assert.equal(calls, 4, 'a miss is not cached')
}

// Every redraw request goes through markDirty, the one function that wakes a sleeping loop.
{
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const assigns = src.split('\n').map((l, i) => [i + 1, l] as const).filter(([, l]) => /(^|[^.\w])dirty = true\b/.test(l))
  // The declaration, markDirty, and completeBand (it runs inside a drawn frame with a band sequence open, which keeps the loop awake).
  assert.equal(assigns.length, 3, `only the declaration, markDirty and completeBand set dirty (lines ${assigns.map(([i]) => i).join(', ')})`)
  assert.ok(assigns.some(([, l]) => l.includes('band.k++; dirty = true')))
  assert.match(src, /function markDirty\(\): void \{\n {2}dirty = true\n {2}if \(idleSleeping\) wakeLoop\(false\)/)
  // The two other places that restart the loop clear the sleep flag, so a heartbeat cannot start a second chain.
  assert.equal((src.match(/idleSleeping = false; loopRunning = true; requestAnimationFrame\(frameLoop\)/g) ?? []).length, 2)
}

// The live clock keeps its schedule: a sleeping loop wakes at the next tick's due time, never later than the heartbeat.
assert.equal(beatDelay(false, 0, 60_000), HEARTBEAT_MS)
assert.equal(beatDelay(true, 0, 60_000), HEARTBEAT_MS)
assert.equal(beatDelay(true, 59_700, 60_000), 301)
assert.equal(beatDelay(true, 60_500, 60_000), 1, 'already due: tick at once')

// What counts as "moving": loopQuiet must refuse to sleep for each of these (source scan of the real predicate in main.ts).
{
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const m = src.match(/function loopQuiet\(now: number, groundStillOk = false\): boolean \{([\s\S]*?)\n\}\n/)
  assert.ok(m, 'loopQuiet exists')
  const body = m![1]
  const need: Record<string, string[]> = {
    'idle orbit / auto-rotate': ['!rig.auto', '!orbitJourney', '!rig.gliding()', '!rig.dragging'],
    'intro and opening': ['!intro?.active', '!intro?.moving', "'intro-on'"],
    'moment flights, tours, routes, descents': ['!tween', '!flight', '!cinematicFlight', '!routeFlight', '!ridge', '!descent', 'journey.state', 'approachFor === null', '!pendingLanding'],
    'date fades, scrubs and anything still drawing': ['!dirty', '!fadeOnly', '!dateTransition', '!scrubGate.active(now)', '!bandState', '!restCatchUp', '!pendingFade', '!needsRefine', '!gestureOn'],
    'streaming after the last input': ["tilesState !== 'loading'", "patchState !== 'loading'", 'tiles?.inflight'],
    'ground mode and its near-field bake': ['!(groundMode?.active && !groundStillOk)', '!settle'],
    'a settled hover is quiet while highlight fades and sticky holds keep ticking': ['!highlightAnimating('],
  }
  assert.equal(highlightAnimating('tycho', 'tycho', 1, false), false, 'a resting hovered label is quiet')
  assert.equal(highlightAnimating('tycho', 'tycho', 0.5, false), true, 'a fade in remains animated')
  assert.equal(highlightAnimating(null, 'tycho', 0.5, false), true, 'a fade out remains animated')
  assert.equal(highlightAnimating('tycho', 'tycho', 1, true), true, 'a sticky highlight hold remains animated')
  for (const [what, tokens] of Object.entries(need)) for (const t of tokens) assert.ok(body.includes(t), `loopQuiet must check ${t} (${what})`)
  // The live clock is not a reason to stay awake: the sleep timer is aimed at its due time instead.
  assert.match(src, /beatDelay\(live, performance\.now\(\) - lastLiveTick, LIVE_TICK_MS\)/)
  // Ground mode is always awake, so its re-bake (a per-frame pass) can never be skipped; streaming arrivals wake a sleeper through markDirty.
  assert.match(src, /tiles\.onChange = \(\) => \{ markDirty\(\) \}/)
  assert.match(src, /groundMode\.onChange = markMoved/)
  // The idle orbit setting is read from ?auto=1 only, and the rig keeps moving when it is on.
  const rigSrc = readFileSync(new URL('../src/camera/rig.ts', import.meta.url), 'utf8')
  assert.match(rigSrc, /return q\.get\('auto'\) === '1' && !still/)
  // Rest to motion (`?settle=stepped`): the held full frame blocks only the draw; `dirty` stays pending and `needsRefine` keeps loopQuiet false, so the loop cannot sleep through the quiet spell.
  assert.match(src, /if \(plan\.held\) \{ settleHeld = true; settleHolds\+\+; scale = lastScale \}/)
  assert.match(src, /settleHeld = true; settleDeferred\+\+/)
  assert.match(src, /else if \(dirty && !paceHeld && !holdForPacing && !settleHeld &&/)
  // ... but the mid frame's crossfade is still redrawn (final-only) while it holds, and a deferred frame is never a plain unbanded submit while the band gate is shut (review items 1 and 2).
  assert.match(src, /else if \(settleHeld && !paceHeld && last && final\?\.refining\(\)\) \{/)
  assert.match(src, /settleHeld = true; settleDeferred\+\+; because\('settleDefer'\)/)
  // `?pace=rest`: gesture frames are never fenced (one in flight on motion frames is #96).
  assert.match(src, /if \(PACE_ON \|\| \(PACE_REST && !gestureOn\)\) \{/)
}

// `?pace=` resolution (audit): the production function main.ts calls, with the phone (fence) class and without. An explicit value beats the class
// fallback; `?settle=stepped` implies rest pacing wherever full pacing is not already on.
for (const fence of [false, true]) {
  assert.deepEqual(resolvePace('rest', fence, false), { on: false, rest: true }, `pace=rest is honoured (fence class ${fence}): gestures stay unfenced`)
  assert.deepEqual(resolvePace('off', fence, false), { on: false, rest: false }, `pace=off (fence ${fence})`)
  assert.deepEqual(resolvePace('on', fence, false), { on: true, rest: false })
  assert.deepEqual(resolvePace('all', fence, false), { on: true, rest: false })
  assert.deepEqual(resolvePace('off', fence, true), { on: false, rest: true }, 'stepped implies rest pacing even under pace=off')
  assert.deepEqual(resolvePace('rest', fence, true), { on: false, rest: true })
}
assert.deepEqual(resolvePace(null, false, false), { on: false, rest: false }, 'other non-fence classes (software, ...): nothing')
// Rest-to-motion defaults (2026-10-23): the desktop class paces REST frames by default; an explicit value still wins; a fence class is never the desktop class.
assert.deepEqual(resolvePace(null, false, false, true), { on: false, rest: true }, 'desktop default: rest pacing')
assert.deepEqual(resolvePace('off', false, false, true), { on: false, rest: false }, 'desktop ?pace=off opts out')
assert.deepEqual(resolvePace('on', false, false, true), { on: true, rest: false }, 'desktop ?pace=on is full pacing')
assert.deepEqual(resolvePace('all', false, false, true), { on: true, rest: false })
assert.deepEqual(resolvePace('rest', false, false, true), { on: false, rest: true })
assert.deepEqual(resolvePace(null, true, false, true), { on: true, rest: false }, 'a fence class keeps full pacing even if flagged desktop')
assert.deepEqual(resolvePace(null, true, false), { on: true, rest: false }, 'phone default: full pacing')
assert.deepEqual(resolvePace(null, false, true), { on: false, rest: true }, 'stepped on desktop: rest pacing')
assert.deepEqual(resolvePace(null, true, true), { on: true, rest: false }, 'stepped on a phone: full pacing already fences rest frames')
{
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(src, /const PACE_ON = resolvePace\(PACE_PARAM, FENCE_CLASS, params\.get\('settle'\) === 'stepped', DESKTOP_CLASS\)\.on/)
  assert.match(src, /const PACE_REST = resolvePace\(PACE_PARAM, FENCE_CLASS, SETTLE_STEPPED, DESKTOP_CLASS\)\.rest/)
  assert.match(src, /const DESKTOP_CLASS = quality\.detected\.cls === 'desktop'/)
  assert.match(src, /const WALL_MEMORY = wallMemoryFromSearch\(location\.search, DESKTOP_CLASS\)/)
  assert.match(src, /const MOTION_START_COST = params\.get\('motionstart'\) === 'cost' \|\| \(params\.get\('motionstart'\) === null && DESKTOP_CLASS\)/)
  // settle=stepped, pressyield, fadebatch=cost and mdpr stay opt-in.
  assert.match(src, /const SETTLE_STEPPED = params\.get\('settle'\) === 'stepped'/)
  assert.match(src, /const PRESS_YIELD = params\.get\('pressyield'\) === '1'/)
}

// Ground stillness for the brand line and the low-end hint (the render loop stays awake in ground mode; loopQuiet is unchanged for it): behaviour with the
// real GroundCamera. This is an INTENDED default-path change (audit #299): a still ground view lets the brand line fade in and stops counting as motion for the hint.
{
  const { Vector3 } = await import('three')
  const { GroundCamera } = await import('../src/ground/GroundCamera.ts')
  const { GroundStillness } = await import('../src/ground/groundStill.ts')
  assert.equal(groundStill(1000, 1000, -Infinity), false, 'input just now')
  assert.equal(groundStill(1000, -Infinity, 1000), false, 'camera moved just now')
  assert.equal(groundStill(1000 + GROUND_STILL_MS, 1000, 1000), false, 'exactly at the window is not yet still')
  assert.equal(groundStill(1000 + GROUND_STILL_MS + 1, 1000, 900), true, 'no input and no motion for the window')
  const st = new GroundStillness()
  const cam = new GroundCamera({ pos: new Vector3(0, 0, 1.7), headingDeg: 0, pitchDeg: 0, rollDeg: 0, tanHalf: 0.3 }, () => 0)
  cam.onInput = () => st.noteInput(now)
  let now = 0
  const tick = (dt = 16): boolean => { now += dt; return st.noteStep(now, cam.step(now, dt / 1000)) }
  cam.setMode('walk'); tick()
  for (let i = 0; i < 40; i++) tick()   // settle: the walking follow reaches eye height
  for (let i = 0; i < 40; i++) assert.equal(tick(), false, 'a settled camera reports no motion (follow under 1e-4 m is not motion)')
  assert.equal(st.still(now), true, 'untouched camera is still')
  cam.look(5, 0); tick()
  assert.equal(st.still(now), false, 'a drag is input and motion')
  for (let t = 0; t < GROUND_STILL_MS - 40; t += 16) tick()
  assert.equal(st.still(now), false, 'inside the window')
  for (let t = 0; t < 120; t += 16) tick()
  assert.equal(st.still(now), true, 'after the window with nothing moving')
  assert.equal(st.still(now, now - 10), false, 'a page-level pointer/key/wheel input counts too')
  cam.keys.fwd = 1; tick()
  assert.equal(st.still(now), false, 'held keys move the pose')
  cam.keys.fwd = 0
  for (let i = 0; i < 60; i++) tick()
  cam.glideTo({ ...cam.view, pos: cam.view.pos.clone().add(new Vector3(5, 0, 0)) }, now, 1000)
  for (let i = 0; i < 10; i++) tick()
  assert.equal(st.still(now), false, 'a glide is motion')
  // Flights, journeys and the rest of the strict conditions are NOT overridden by stillness: they stay in loopQuiet itself (pinned above), so the strict part cannot report quiet.
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(src, /const visitorQuiet = groundMode\?\.active \? loopQuiet\(now, groundStillness\.still\(now, lastUserInputAt\)\) : quiet/)
  assert.match(src, /brandFade\?\.tick\(visitorQuiet, now\)/)
  assert.match(src, /idleGate\.update\(quiet, now\)/, 'the idle sleep still uses the strict quiet flag')
}

console.log('idle-loop tests passed')
