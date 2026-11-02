// A pick's new date is carried along its move (src/journey/ephemCarry.ts): owner report 2026-10-29, "whenever I tap on a location, the moon
// jumps to some other place and only starts journeying then". The rig job tap-jump.mjs measured the Sun turning 108 deg
// over the Moon in the first frame of a pick from the fly-around orbit, 54 deg from a running flight. These checks would have failed then.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { Quaternion, Vector3 } from 'three'
import { ephemerisAt, type Ephemeris } from '../src/ephemeris.ts'
import { MOMENTS } from '../src/moments.ts'
import { AIM_RELEASE_MS, AimRelease } from '../src/camera/aimRelease.ts'
import { CameraRig } from '../src/camera/rig.ts'
import { CARRY_MAX_MS, CARRY_MIN_MS, CARRY_STEP_CEIL_MS, CARRY_STEP_MAX_MS, ECLIPSE_FREE_SEP_DEG, EphemCarry, blendEphemeris, carryWeight, slerpDir } from '../src/journey/ephemCarry.ts'
import { earthShadowOnMoonParts } from '../src/lighting/shadowMath.ts'
import { turnEphemeris } from '../src/camera/moonTurn.ts'

const DEG = 180 / Math.PI
const body = (e: Ephemeris, v: Vector3): Vector3 => new Vector3(v.dot(e.moonX), v.dot(e.moonY), v.dot(e.moonZ))
const angle = (a: Vector3, b: Vector3): number => Math.acos(Math.max(-1, Math.min(1, a.clone().normalize().dot(b.clone().normalize())))) * DEG

// The rig's orbit-copernicus case: the fly-around at "now" (2026-10-29) to Copernicus (2026-10-20T19:00Z).
const a = ephemerisAt(new Date('2026-10-29T15:35:06Z'))
const b = ephemerisAt(new Date('2026-10-20T19:00:00Z'))
const sunJump = angle(body(a, a.sunDir), body(b, b.sunDir))
assert.ok(sunJump > 90, `the two dates light the Moon from very different sides (${sunJump.toFixed(1)} deg)`)

{
  // The ends are the ephemerides themselves; the blend's own frame is consistent (unit, orthogonal axes; world and body directions agree).
  assert.equal(blendEphemeris(a, b, 0), a)
  assert.equal(blendEphemeris(a, b, 1), b)
  const m = blendEphemeris(a, b, 0.5)
  for (const v of [m.moonX, m.moonY, m.moonZ, m.sunDir, m.earthDir]) assert.ok(Math.abs(v.length() - 1) < 1e-9, 'unit vectors')
  assert.ok(Math.abs(m.moonX.dot(m.moonY)) < 1e-9 && Math.abs(m.moonY.dot(m.moonZ)) < 1e-9, 'orthogonal Moon axes')
  assert.ok(Math.abs(new Vector3().crossVectors(m.moonX, m.moonY).dot(m.moonZ) - 1) < 1e-9, 'right-handed Moon axes')
  const sb = body(m, m.sunDir)
  assert.ok(Math.abs(Math.atan2(sb.y, sb.x) * DEG - m.subSolar.lon) < 1e-6, 'subSolar matches the blended Sun')
  assert.equal(m.date.getTime(), b.date.getTime(), 'the blend carries the place\'s date (the clock is not interpolated)')
  // Halfway in weight is halfway along the great circle, in the body frame.
  assert.ok(Math.abs(angle(body(a, a.sunDir), sb) - sunJump / 2) < 1e-6, 'the Sun moves on a great circle in the body frame')
}

{
  // A carry over a 2 s fly-to drawn at 60 Hz: no step is a jump. The first frame shows the old sky; every step is under 3x the mean step
  // (the smoothstep's peak speed is 1.5x the mean); the Moon's turn in the sky (the stars) is smooth too; the last frame is the place's.
  const ms = 2000
  const carry = new EphemCarry(a, b, 1000, ms)
  let shown: Ephemeris = b
  const first = carry.step(1000, shown)
  assert.ok(first && !first.done)
  shown = first.e
  assert.ok(angle(body(shown, shown.sunDir), body(a, a.sunDir)) < 1e-6, 'frame 1 is the sky that was on screen')
  const steps: number[] = [], turns: number[] = []
  let prev = shown
  for (let t = 1000 + 1000 / 60; ; t += 1000 / 60) {
    const c = carry.step(t, shown)
    assert.ok(c, 'the carry is not mistaken for an override')
    shown = c.e
    steps.push(angle(body(prev, prev.sunDir), body(shown, shown.sunDir)))
    turns.push(angle(prev.moonZ, shown.moonZ) + angle(prev.moonX, shown.moonX))
    prev = shown
    if (c.done) break
  }
  assert.equal(shown, b, 'the carry ends exactly on the place\'s ephemeris')
  const mean = sunJump / steps.length
  const worst = Math.max(...steps)
  assert.ok(worst < 3 * mean, `largest Sun step ${worst.toFixed(3)} deg against a mean ${mean.toFixed(3)} deg`)
  assert.ok(worst < sunJump / 20, 'no single frame carries a visible share of the change')
  const turnMean = turns.reduce((s, x) => s + x, 0) / turns.length
  assert.ok(Math.max(...turns) < 3 * turnMean + 1e-9, 'the stars turn smoothly')
}

{
  // Other code that sets the date (a scrub, the Time sheet, Home) ends the carry where it put it; a live tick retargets instead.
  const carry = new EphemCarry(a, b, 0, 1000)
  const s1 = carry.step(100, b)
  assert.ok(s1)
  const other = ephemerisAt(new Date('2027-01-01T00:00:00Z'))
  assert.equal(carry.step(200, other), null, 'a date set by other code ends the carry')
  const live = new EphemCarry(a, b, 0, 1000)
  const l1 = live.step(100, b)
  assert.ok(l1)
  const ticked = ephemerisAt(new Date(b.date.getTime() + 60_000))
  live.retarget(ticked)
  const l2 = live.step(200, ticked)
  assert.ok(l2 && !l2.done, 'a live tick keeps the carry going')
  let cur = l2.e, end: Ephemeris | null = null
  for (let t = 200 + 1000 / 60; t < 3000 && !end; t += 1000 / 60) { const c = live.step(t, cur); assert.ok(c); cur = c.e; if (c.done) end = c.e }
  assert.equal(end, ticked, 'and it ends on the ticked ephemeris')
}

{
  // A stall (shader compile, a return from the background): the next frame moves the light by at most one 30 Hz step of the carry, not a jump.
  const ms = 2000
  const carry = new EphemCarry(a, b, 0, ms)
  let shown: Ephemeris = b
  for (let t = 0; t <= 500; t += 1000 / 60) { const c = carry.step(t, shown); assert.ok(c); shown = c.e }
  const before = shown
  const c = carry.step(500 + 5000, shown)
  assert.ok(c && !c.done, 'a 5 s stall does not end the carry')
  const step = angle(body(before, before.sunDir), body(c.e, c.e.sunDir))
  // After 60 Hz frames the cap is two frames, at most one 30 Hz frame.
  const peak = sunJump * 1.5 * CARRY_STEP_MAX_MS / ms
  assert.ok(step <= peak + 1e-9, `Sun step after a stall ${step.toFixed(2)} deg, at most ${peak.toFixed(2)}`)
}

{
  // One clock with the camera (review 2026-10-29: a 1 s stall at 35 % of a 2 s approach left the blend unfinished at the hand-over to the flight,
  // which then sampled its route with it: 289 km / 8.5 deg on the hand-over frame). Driven by the fly-to's progress, the carry is the place's
  // ephemeris exactly when the fly-to ends, wherever a stall falls; between frames the light moves as far as the camera's own progress does.
  for (const stallAt of [0.05, 0.35, 0.6, 0.9, 0.99]) {
    const ms = 2000
    const carry = new EphemCarry(a, b, 0, ms)
    let shown: Ephemeris = b, t = 0, stalled = false, last: { e: Ephemeris; done: boolean } | null = null, firstPast = -1
    for (let n = 0; n < 1000; n++) {
      if (firstPast < 0 && t >= ms) firstPast = t
      const c = carry.step(t, shown, Math.min(1, t / ms))
      assert.ok(c); shown = c.e; last = c
      if (c.done) break
      assert.ok(t < ms, `stall at ${stallAt}: still carrying at t ${t.toFixed(0)} ms, after the fly-to ended`)
      t += !stalled && t / ms >= stallAt ? (stalled = true, 1000) : 1000 / 60
    }
    assert.ok(last?.done && last.e === b, `stall at ${stallAt}: the carry is complete when the fly-to ends (t ${t.toFixed(0)} ms)`)
    // On the fly-to's clock, not its own: complete on the first frame at or after the fly-to's end (review: the own clock ends ~1 s later).
    assert.equal(t, firstPast, `stall at ${stallAt}: complete on the first frame past the fly-to's end (${firstPast.toFixed(0)} ms), not at ${t.toFixed(0)} ms`)
  }
  {
    // A re-pick of the place being approached (the same carousel card or pin again, "fly there again", the tiles' re-plan): a new fly-to rides
    // the carry from progress 0. It must go on from the weight on screen (review 2026-10-29: w fell from ~0.4 to 0 in one frame, Sun 37.9 deg).
    const ms = 3000
    const re = new EphemCarry(a, b, 0, ms)
    let shown: Ephemeris = b, prev: Ephemeris = b
    for (let t = 0; t <= 1200; t += 1000 / 60) { const c = re.step(t, shown, t / ms); assert.ok(c); prev = shown; shown = c.e }
    const before = angle(body(prev, prev.sunDir), body(shown, shown.sunDir))
    re.retarget(b); re.newDriver()
    const t1 = 1200 + 1000 / 60, ms2 = 2500
    const c = re.step(t1, b, 0)
    assert.ok(c && !c.done)
    const atRepick = angle(body(shown, shown.sunDir), body(c.e, c.e.sunDir))
    assert.ok(atRepick <= 2 * before + 1e-6, `no step on a re-pick: ${atRepick.toFixed(3)} deg against ${before.toFixed(3)} the frame before`)
    // Without newDriver (the progress going back alone) it is the same: the drop is detected.
    const re2 = new EphemCarry(a, b, 0, ms)
    let s2: Ephemeris = b
    for (let t = 0; t <= 1200; t += 1000 / 60) { const d = re2.step(t, s2, t / ms); assert.ok(d); s2 = d.e }
    const d2 = re2.step(t1, s2, 0)
    assert.ok(d2 && angle(body(s2, s2.sunDir), body(d2.e, d2.e.sunDir)) <= 2 * before + 1e-6, 'a driver whose progress goes back resumes too')
    // And it still ends exactly on the place when the new fly-to does, never replaying the sweep (the Sun moves monotonically toward the place).
    let cur = c.e, end: { e: Ephemeris; done: boolean } | null = null, toPlace = angle(body(cur, cur.sunDir), body(b, b.sunDir))
    for (let t = t1 + 1000 / 60; t <= t1 + ms2 + 1; t += 1000 / 60) {
      const s = re.step(t, cur, Math.min(1, (t - t1) / ms2)); assert.ok(s); cur = s.e; end = s
      const left = angle(body(cur, cur.sunDir), body(b, b.sunDir))
      assert.ok(left <= toPlace + 1e-6, 'the light never turns back'); toPlace = left
    }
    assert.ok(end?.done && end.e === b, 'complete when the new fly-to ends')
  }
  // The fly-to cancelled at 40 % (a grab): the own clock takes the rest from the weight on screen, with no step at the switch.
  const carry = new EphemCarry(a, b, 0, 2000)
  let shown: Ephemeris = b, prev: Ephemeris = b
  for (let t = 0; t <= 800; t += 1000 / 60) { const c = carry.step(t, shown, t / 2000); assert.ok(c); prev = shown; shown = c.e }
  const before = angle(body(prev, prev.sunDir), body(shown, shown.sunDir))
  const c = carry.step(800 + 1000 / 60, shown)
  assert.ok(c && !c.done)
  const atSwitch = angle(body(shown, shown.sunDir), body(c.e, c.e.sunDir))
  assert.ok(atSwitch <= 2 * before + 1e-6, `no step when the fly-to is cancelled: ${atSwitch.toFixed(3)} deg against ${before.toFixed(3)} the frame before`)
  let s2: Ephemeris = c.e, done = false
  for (let t = 800 + 2000 / 60; t < 5000 && !done; t += 1000 / 60) { const d = carry.step(t, s2); assert.ok(d); s2 = d.e; done = d.done }
  assert.ok(done && s2 === b, 'and it still ends on the place')
}

{
  // Repeated stalls on the own clock (review 2026-10-29: four 5 s gaps grew the Sun's steps to 2, 8, 15, 20 deg): stalls never feed the cadence.
  const ms = 2000
  const carry = new EphemCarry(a, b, 0, ms)
  let shown: Ephemeris = b, t = 0
  for (; t <= 300; t += 1000 / 60) { const c = carry.step(t, shown); assert.ok(c); shown = c.e }
  const steps: number[] = []
  for (let i = 0; i < 4; i++) {
    t += 5000
    const c = carry.step(t, shown)
    assert.ok(c && !c.done)
    steps.push(angle(body(shown, shown.sunDir), body(c.e, c.e.sunDir)))
    shown = c.e
  }
  const peak = sunJump * 1.5 * CARRY_STEP_MAX_MS / ms
  for (const x of steps) assert.ok(x <= peak + 1e-9, `Sun steps after repeated stalls ${steps.map((y) => y.toFixed(2)).join(', ')} deg, each at most ${peak.toFixed(2)}`)
}

{
  // A slow phone drawing 100 ms frames is not slowed: the carry ends within a frame or two of its length.
  const carry = new EphemCarry(a, b, 0, 2000)
  let shown: Ephemeris = b, endAt = -1
  for (let t = 0; t < 4000 && endAt < 0; t += 100) { const c = carry.step(t, shown); assert.ok(c); shown = c.e; if (c.done) endAt = t }
  assert.ok(endAt > 0 && endAt <= 2200, `a 10 Hz carry of 2 s ends at ${endAt} ms`)
  assert.ok(CARRY_STEP_CEIL_MS >= 200)
}

{
  assert.equal(carryWeight(0, 0, 0), 1, 'no length: at once')
  assert.equal(carryWeight(-5, 0, 100), 0)
  assert.equal(carryWeight(50, 0, 100), 0.5)
  assert.ok(CARRY_MIN_MS > 0 && CARRY_MAX_MS > CARRY_MIN_MS)
  const opp = slerpDir(new Vector3(1, 0, 0), new Vector3(-1, 0, 0), 0.5)
  assert.ok(Math.abs(opp.length() - 1) < 1e-9 && Math.abs(opp.x) < 1e-9, 'opposite directions still blend on a great circle')
}

{
  // The wiring: every pick that sets a place's date (playMoment, approachSite) hands the sky on screen to the carry, and the frame loop steps it.
  const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  for (const fn of ['function playMoment(', 'function approachSite(']) {
    const start = main.indexOf(fn)
    assert.ok(start >= 0, fn)
    const end = main.indexOf('\nfunction ', start + fn.length)
    const src = main.slice(start, end)
    const setAt = src.indexOf('ephem = clockSet(time')
    assert.ok(setAt > 0, `${fn} sets the place's ephemeris`)
    // The sky on screen is the drawn frame's (last.ephem): a carry step the pacer has not drawn is not on screen (see the settle case below).
    assert.ok(src.lastIndexOf('const shownBefore = last?.ephem ?? ephem', setAt) >= 0, `${fn} keeps the sky on screen before setting the place's`)
    assert.ok((src.match(/carryDate\(shownBefore, instant\)/g) ?? []).length >= 1, `${fn} carries the date along its move`)
  }
  const pm = main.slice(main.indexOf('function playMoment('), main.indexOf('\nfunction ', main.indexOf('function playMoment(') + 10))
  // Every exit after the date is set (descent, site view, flight, fly-to, the end) starts the carry first (review 2026-10-29: a count with slack let
  // one call site go; now each exit is checked where it is).
  const lines = pm.slice(pm.indexOf('ephem = clockSet(time')).split('\n')
  const CALL = 'carryDate(shownBefore, instant)'
  const prevCode = (i: number, back = 1): string => { let k = i; for (let n = 0; n < back; n++) do k--; while (k >= 0 && !lines[k].trim()); return k >= 0 ? lines[k].trim() : '' }
  let exits = 0
  lines.forEach((l, i) => {
    const t = l.trim()
    if (/^(startDescent|startSiteView)\(/.test(t)) assert.equal(lines[i + 1].trim(), CALL, `the carry starts right after ${t}`)
    if (t === 'return') { exits++; assert.ok(prevCode(i) === CALL || (prevCode(i) === 'markMoved()' && prevCode(i, 2) === CALL), `the exit at "${prevCode(i)}" starts the carry first`) }
    // One-line early returns: only the archived powered descent, which no visitor moment starts and which moves no camera.
    if (/\) return$/.test(t)) assert.equal(t, "if (cam.at === 'descent') return", `no other early return skips the carry: ${t}`)
  })
  assert.equal(exits, 3, 'the descent, the site view and the flight exits (each checked above)')
  const end = lines.findIndex((l) => l === '}')
  assert.ok(prevCode(end) === 'markMoved()' && prevCode(end, 2) === CALL, 'the fly-to path (the end of playMoment) starts the carry')
  assert.equal((lines.join('\n').match(/carryDate\(shownBefore, instant\)/g) ?? []).length, 4, 'four exits, four calls')
  assert.match(main, /const c = ephemCarry\.step\(now, ephem, progress\)/, 'the frame loop steps the carry')
  assert.match(main, /tweenProgress\(d, now\)/, 'on the fly-to\'s own progress')
  assert.match(main, /carryDriver = tween/, 'the carry rides on the fly-to the pick started')
  assert.match(main, /ephemCarry\?\.retarget\(ephem\)/, 'a live tick retargets the carry')
  assert.match(main, /ephemCarry\.retarget\(ephem\); if \(tween\) \{ ephemCarry\.newDriver\(\); carryDriver = tween \}/, 'a re-pick of the same place rides the new fly-to from the weight on screen')
  // The aim release (B6): built from the rig's aim on screen, and the frame loop applies what it hands out.
  const rel = main.slice(main.indexOf('function releaseAim('), main.indexOf('\n}\n', main.indexOf('function releaseAim(')))
  assert.match(rel, /aimRelease = new AimRelease\(rig\.aimShiftX, rig\.aimShift, now\)/, 'releaseAim starts from the aim on screen')
  assert.match(main, /const a = aimRelease\.step\(now, rig\.aimShiftX, rig\.aimShift\)\n\s+if \(!a \|\| a\.done\) aimRelease = null\n\s+if \(a\) \{ rig\.aimShiftX = a\.x; rig\.aimShift = a\.y;/, 'the frame loop applies the eased aim')
  assert.ok((main.match(/releaseAim\(instant, now\)/g) ?? []).length >= 2, 'startDescent and startSiteView release the aim')
}

{
  // A hand turn followed by a carried date keeps the first drawn camera and body frame continuous: clockSet leaves the pose in place,
  // and the carry's zero-weight sample is the already-shown turned ephemeris.
  const turned = turnEphemeris(a, new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 40 * Math.PI / 180))
  const rig = new CameraRig()
  rig.setPose({ lon: 37, lat: -18, dist: 5, roll: 0, pitch: 0 })
  const camera = rig.camera(a, 1.6, 1000)
  rig.keepWorldPosition(turned, camera, 1016)
  const afterTurn = rig.camera(turned, 1.6, 1016)
  assert.ok(afterTurn.pos.distanceTo(camera.pos) < 1e-9, 'a Moon turn keeps the world camera position')
  assert.ok(afterTurn.up.distanceTo(camera.up) < 1e-9, 'a Moon turn keeps the world camera orientation')
  const carry = new EphemCarry(turned, b, 2000, 2000)
  const first = carry.step(2000, b, 0)
  assert.ok(first && first.e.moonX.distanceTo(turned.moonX) < 1e-9, 'the first carried frame uses the turned axes that were already on screen')
  const firstCamera = rig.camera(first!.e, 1.6, 2016)
  assert.ok(firstCamera.pos.distanceTo(afterTurn.pos) < 1e-9, 'clockSet plus the carry has no first-frame camera jump')
  assert.ok(firstCamera.up.distanceTo(afterTurn.up) < 1e-9, 'clockSet plus the carry has no first-frame orientation jump')
}

{
  // The solar-eclipse moment pick sets its own date and starts the date carry before the camera move.
  const eclipse = MOMENTS.find((m) => m.id === 'solar-eclipse')!
  assert.ok(eclipse, 'the solar-eclipse moment exists')
  const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const start = main.indexOf('function playMoment(')
  const playMomentEnd = main.indexOf('\nfunction ', start + 'function playMoment('.length)
  const playMoment = main.slice(start, playMomentEnd)
  assert.match(playMoment, /const momentTime = m\.time\(\)/, 'the selected moment supplies the pick date')
  assert.ok(playMoment.indexOf('carryDate(shownBefore, instant)') > playMoment.indexOf('ephem = clockSet(time, instant || !DATE_CARRY || STILL)'), 'the selected moment starts carrying from the shown sky after setting its ephemeris')
  assert.match(main, /const clockSet = \(d: Date, settleCamera = true\)[\s\S]*?if \(camera && settleCamera\) rig\.settle/, 'a carried date change leaves the rig pose alone on its first frame')
  assert.match(main, /ephem = clockSet\(d, !DATE_CARRY \|\| STILL\)[\s\S]*?carryDate\(shownBefore, false\)/, 'Home defers settling while its date carry runs')
  assert.match(playMoment, /beginDateChange\(momentTime, PICK_FADE_HOLD_MS, true\)/, 'moment picks use the journey date transition')

  const approachMs = 2400
  const carry = new EphemCarry(a, b, 0, approachMs)
  const first = carry.step(0, b, 0)
  const middle = carry.step(approachMs / 2, b, 0.5)
  const end = carry.step(approachMs, b, 1)
  assert.ok(first && middle && end?.done, 'the date carry eases its Sun direction over the fly-in and finishes at the target time')
  assert.ok(angle(body(first.e, first.e.sunDir), body(a, a.sunDir)) < 1e-6)
  assert.ok(angle(body(middle.e, middle.e.sunDir), body(a, a.sunDir)) > 1, 'the Sun has visibly begun to move during the approach')
  assert.equal(end.e, b, 'the cached shadow input ends at the selected moment ephemeris')
}
{
  // The layout aim: a pick that centres the subject eases it from the one on screen (rig: 37 px desktop, 70 device px phone on frame 1 before).
  const r = new AimRelease(0.02, 0.0925, 100)
  assert.deepEqual(r.at(100), { x: 0.02, y: 0.0925, done: false }, 'frame 1 keeps the aim on screen')
  let prev = r.at(100).y, worst = 0
  for (let t = 100; t <= 100 + AIM_RELEASE_MS; t += 1000 / 60) { const y = r.at(t).y; worst = Math.max(worst, prev - y); prev = y }
  assert.ok(worst < 0.0925 * 1.6 / (AIM_RELEASE_MS / (1000 / 60)), 'no aim step is more than the smoothstep peak rate')
  assert.deepEqual(r.at(100 + AIM_RELEASE_MS), { x: 0, y: 0, done: true })
  // Interrupted (review 2026-10-29): a grab at 300 ms settles the rig to the drawn view and zeroes the aim; the release must not put it back.
  const rel = new AimRelease(0.02, 0.0925, 0)
  let ax = 0.02, ay = 0.0925
  for (let t = 0; t <= 300; t += 1000 / 60) { const a = rel.step(t, ax, ay); assert.ok(a); ax = a.x; ay = a.y }
  ax = 0; ay = 0 // rig.settle() in stopMoments
  assert.equal(rel.step(316, ax, ay), null, 'a camera takeover ends the release')
  const mainSrc = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(mainSrc, /aimRelease\.step\(now, rig\.aimShiftX, rig\.aimShift\)/, 'the frame loop hands the release the rig\'s aim')
  const stop = mainSrc.slice(mainSrc.indexOf('function stopMoments('), mainSrc.indexOf('\nfunction ', mainSrc.indexOf('function stopMoments(') + 10))
  assert.match(stop, /aimRelease = null/, 'stopMoments ends the release')
  // No pick path drops the aim to 0 before its move except as a cut (instant): playMoment, startDescent, startSiteView.
  const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  for (const fn of ['function playMoment(', 'function startDescent(', 'function startSiteView(']) {
    const start = main.indexOf(fn)
    // The function's own body: up to the next top-level statement (the debug API after playMoment has its own cuts).
    const end = main.slice(start + fn.length).search(/\n(function |Object\.assign|const |let )/) + start + fn.length
    const src = main.slice(start, end)
    for (const line of src.split('\n')) {
      if (/rig\.aimShift(X)? = (rig\.aimShiftX = )?0\b/.test(line)) assert.match(line, /instant/, `${fn} zeroes the aim only on a cut: ${line.trim()}`)
    }
  }
}
{
  // A pick that takes over a running carry (rig 2026-10-29, phone flight-earthrise: a Tycho flight's carry still running when Earthrise was
  // tapped): the carry steps `ephem` on every loop pass, also on one the phone's pacer does not draw. Settling the rig to the drawn camera (world
  // space) against that newer ephemeris put the camera into a newer body frame than the picture: the surface moved by one carry step of the
  // Moon's orientation, 1.18 deg of longitude (a 1.7 % position step) on the pick's first frame. Settled against the drawn frame's own ephemeris,
  // the body-frame pose is the one on screen.
  const home = ephemerisAt(new Date('2026-10-29T22:40:00Z'))
  const place = ephemerisAt(new Date('2026-11-12T03:00:00Z'))
  const drawn = blendEphemeris(home, place, 0.40), undrawn = blendEphemeris(home, place, 0.43)
  const rig = new CameraRig()
  rig.mode = 'fly'
  const pose = { lon: -13.6, lat: -35.4, dist: 2.15, roll: -31, pitch: 11 }
  rig.pose = { ...pose }
  const aspect = 412 / 915
  const cam = rig.camera(drawn, aspect, 1000)
  const posBody = (e: Ephemeris, p: Vector3): Vector3 => body(e, p.clone()).normalize()
  const onScreen = posBody(drawn, cam.pos)
  const settledAt = (e: Ephemeris): number => {
    const r = new CameraRig(); r.mode = 'fly'; r.settle(e, aspect, 1000, cam)
    // The next frame draws with the newer sky either way: where is the camera over the surface, against the picture on screen?
    return angle(posBody(undrawn, r.camera(undrawn, aspect, 1000).pos), onScreen)
  }
  const wrong = settledAt(undrawn), right = settledAt(drawn)
  assert.ok(wrong > 0.5, `settling against the undrawn carry step moves the camera over the surface (${wrong.toFixed(3)} deg): the bug this guards`)
  assert.ok(right < 1e-6, `settled against the drawn frame's ephemeris the camera stays over the same ground (${right.toExponential(2)} deg)`)
  // Wiring: the frame on screen keeps its ephemeris, and the settles to it use that one (dropping either fails here).
  const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(main, /\n {2}last = \{ cam, ephem, exposure, w, h, cw, ch \}\n/, 'the render keeps the ephemeris the frame was drawn with')
  const stop = main.slice(main.indexOf('function stopMoments('), main.indexOf('\n}\n', main.indexOf('function stopMoments(')))
  assert.match(stop, /rig\.settle\(last\?\.ephem \?\? ephem, canvasAspect\(\), performance\.now\(\), last\?\.cam\)/, 'stopMoments settles to the drawn camera in the drawn body frame')
  assert.ok(!/rig\.settle\(ephem, canvasAspect\(\), performance\.now\(\), last\?\.cam\)/.test(main), 'no settle to last.cam against the current ephemeris')
  const take = main.slice(main.indexOf('function takeCurrentScriptCamera('), main.indexOf('\n}\n', main.indexOf('function takeCurrentScriptCamera(')))
  assert.match(take, /e: last\.ephem/, 'takeCurrentScriptCamera settles a ridge view to the drawn frame in its body frame')
  const eg = main.slice(main.indexOf('function enterGround('), main.indexOf('\n}\n', main.indexOf('function enterGround(')))
  assert.match(eg, /const ephemOnScreen = !frameCam && last \? last\.ephem : ephem/, 'enterGround hands the drawn camera over in its own body frame')
  assert.match(eg, /g\.enter\(ephemOnScreen, cam\)/)
}
{
  // The Home dip (rig 2026-10-31, launch-shot pullback): Home from Copernicus (2026-10-20T19:00Z) to now (2026-10-30T12:00Z). The Sun and the Earth,
  // each on its own great circle, passed 0.38 deg apart at weight 0.53 (the real sky's closest that month: 4.56 deg), and two frames of the Home
  // flight drew a total lunar eclipse over the whole near side (luma 23 and 40 against 159). The carried sky never lines them up closer than
  // ECLIPSE_FREE_SEP_DEG, and no point of the Moon is in the Earth's shadow, while the Earth still moves smoothly.
  const R = 1737.4
  const pos = (e: Ephemeris, v: Vector3, km: number): [number, number, number] => { const u = v.clone().multiplyScalar(km / R); return [u.x, u.y, u.z] }
  const checkCarry = (from: Ephemeris, to: Ephemeris, label: string): { minSep: number; maxSep: number } => {
    let minSep = 180, maxSep = 0, prev: Vector3 | null = null, prevSun: Vector3 | null = null, lastStep = -1, maxStep = 0, maxSunStep = 0, maxJerk = 0
    for (let i = 1; i < 2000; i++) {
      const e = blendEphemeris(from, to, i / 2000)
      const sep = angle(e.sunDir, e.earthDir)
      minSep = Math.min(minSep, sep); maxSep = Math.max(maxSep, sep)
      // The sub-Earth point and the near side's limb toward the Sun: the whole Earth-facing disc.
      const toward = e.sunDir.clone().addScaledVector(e.earthDir, -e.sunDir.dot(e.earthDir))
      for (const p of [e.earthDir.clone(), toward.lengthSq() > 1e-12 ? toward.normalize() : e.earthDir.clone()]) {
        const sh = earthShadowOnMoonParts([p.x, p.y, p.z], pos(e, e.sunDir, e.sunKm.length()), pos(e, e.earthDir, e.earthKm.length()))
        assert.deepEqual(sh.direct, [1, 1, 1], `${label}: no lunar eclipse in the carried sky at w ${(i / 2000).toFixed(4)}`)
      }
      const eb = body(e, e.earthDir), sb = body(e, e.sunDir)
      if (prev && prevSun) {
        const d = angle(prev, eb)
        maxStep = Math.max(maxStep, d); maxSunStep = Math.max(maxSunStep, angle(prevSun, sb))
        if (lastStep >= 0) maxJerk = Math.max(maxJerk, Math.abs(d - lastStep))
        lastStep = d
      }
      prev = eb; prevSun = sb
    }
    // The Earth eases round the Sun line: never faster than the light moves, and no kink (a step never differs from the last by a tenth of the Sun's).
    assert.ok(maxStep < maxSunStep, `${label}: the Earth moves no faster than the Sun (${maxStep.toFixed(4)} vs ${maxSunStep.toFixed(4)} deg per step)`)
    assert.ok(maxJerk < 0.1 * maxSunStep, `${label}: the Earth's sidestep is smooth (step change ${maxJerk.toFixed(5)} deg)`)
    return { minSep, maxSep }
  }
  const copernicus = ephemerisAt(new Date('2026-10-20T19:00:00Z')), homeNow = ephemerisAt(new Date('2026-10-30T12:00:00Z'))
  const { minSep } = checkCarry(copernicus, homeNow, 'Home pull-back')
  assert.ok(minSep > ECLIPSE_FREE_SEP_DEG - 0.01, `Home carry: the Sun and the Earth stay ${ECLIPSE_FREE_SEP_DEG} deg apart (${minSep.toFixed(3)})`)
  checkCarry(homeNow, copernicus, 'back to Copernicus')
  // Either side of a new Moon (2026-11-09): the Earth is not carried across the anti-Sun line either (the Moon's shadow on the Earth).
  const beforeNew = ephemerisAt(new Date('2026-11-05T00:00:00Z')), afterNew = ephemerisAt(new Date('2026-11-14T00:00:00Z'))
  const across = checkCarry(beforeNew, afterNew, 'across new Moon')
  assert.ok(across.maxSep < 180 - ECLIPSE_FREE_SEP_DEG + 0.01, `across new Moon: the Earth stays off the anti-Sun line (${across.maxSep.toFixed(3)})`)
  // A carry to a real eclipse still arrives in it: the floor follows the ends' own separation.
  const eclipse = ephemerisAt(new Date('2026-03-03T11:33:00Z'))
  const real = angle(eclipse.sunDir, eclipse.earthDir)
  assert.ok(real < 1, `2026-03-03 is a total lunar eclipse (${real.toFixed(2)} deg)`)
  const near = blendEphemeris(ephemerisAt(new Date('2026-02-24T12:00:00Z')), eclipse, 0.999)
  assert.ok(angle(near.sunDir, near.earthDir) < real + 0.5, 'the carry into a real eclipse reaches it')
}
console.log('date-carry: ok')
