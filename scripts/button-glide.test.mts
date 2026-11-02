// The zoom and tilt buttons glide (src/ui/touchControlsLogic.ts EasedButton: a critically damped third-order follower, exact closed form):
// zero speed at the press, continuous speed, the tap total is the click amount, the hold rate is reached without a dip or an overshoot, the
// result does not depend on the frame rate; the Home frame follow does not eat a small zoom input (src/camera/homeFollow.ts); the wiring in main.ts.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  BUTTON_GLIDE_OMEGA_PER_S, BUTTON_HOLD_DELAY_S, EasedButton, TILT_CLICK_UNITS, TILT_HOLD_UNITS_PER_S, ZOOM_CLICK_OCTAVES, ZOOM_HOLD_OCTAVES_PER_S, glideStep,
  type GlideState,
} from '../src/ui/touchControlsLogic.ts'
import { homeFollowStep } from '../src/camera/homeFollow.ts'

interface Trace { t: number[]; x: number[]; v: number[] }
/** A press at t = 0 and a release at `holdS` (Infinity: never), sampled every 1/fps for `totalS`. */
function run(fps: number, click: number, rate: number, holdS: number, totalS: number): Trace {
  const b = new EasedButton()
  b.press(click)
  const tr: Trace = { t: [], x: [], v: [] }
  let x = 0, released = false
  const n = Math.round(totalS * fps)
  for (let i = 1; i <= n; i++) {
    if (!released && i / fps > holdS + 1e-9) { b.release(); released = true }
    const u = b.tick(1 / fps, rate)
    x += u
    tr.t.push(i / fps); tr.x.push(x); tr.v.push(b.speed)
  }
  return tr
}
const tap = (fps: number, click = ZOOM_CLICK_OCTAVES): Trace => run(fps, click, 1.2, 0, 3)
/** The instantaneous speed at each frame end (units per second). */
const speedAt = (tr: Trace): number[] => tr.v
const at = (tr: Trace, t: number): number => tr.x[Math.round(t / tr.t[0]) - 1]

test('the exact step does not depend on how the time is cut, for a fixed and for a moving target', () => {
  for (const c of [0, 1.2, -3]) {
    const s0: GlideState = { x: 0.1, v: 0.4, a: -0.7 }
    const one = glideStep(s0, 0.5, c, BUTTON_GLIDE_OMEGA_PER_S, 0.12)
    let s = s0, t = 0.5
    for (let i = 0; i < 12; i++) { s = glideStep(s, t, c, BUTTON_GLIDE_OMEGA_PER_S, 0.01); t += c * 0.01 }
    assert.ok(Math.abs(one.x - s.x) < 1e-12 && Math.abs(one.v - s.v) < 1e-12 && Math.abs(one.a - s.a) < 1e-10, `c=${c}: ${JSON.stringify(one)} vs ${JSON.stringify(s)}`)
    // Against a brute-force integration of the third-order equation (RK4, 20 microsecond steps).
    const w = BUTTON_GLIDE_OMEGA_PER_S
    let y = [s0.x, s0.v, s0.a]
    const f = (yy: number[], tt: number): number[] => [yy[1], yy[2], w ** 3 * (0.5 + c * tt - yy[0]) - 3 * w * w * yy[1] - 3 * w * yy[2]]
    const h = 2e-5
    for (let tt = 0; tt < 0.12 - 1e-12; tt += h) {
      const k1 = f(y, tt), k2 = f(y.map((q, i) => q + h / 2 * k1[i]), tt + h / 2), k3 = f(y.map((q, i) => q + h / 2 * k2[i]), tt + h / 2), k4 = f(y.map((q, i) => q + h * k3[i]), tt + h)
      y = y.map((q, i) => q + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]))
    }
    assert.ok(Math.abs(y[0] - one.x) < 1e-6 && Math.abs(y[1] - one.v) < 1e-5, `c=${c}: closed form ${one.x}, ${one.v} vs RK4 ${y[0]}, ${y[1]}`)
  }
})

test('a press starts at zero speed: no first-frame jump, at 30, 60 and 120 Hz', () => {
  const peak = Math.max(...speedAt(tap(1000)))
  assert.ok(peak > 4 * ZOOM_CLICK_OCTAVES && peak < 6 * ZOOM_CLICK_OCTAVES, `peak speed ${peak} octaves/s`)
  const b = new EasedButton()
  b.press(ZOOM_CLICK_OCTAVES)
  assert.equal(b.speed, 0, 'the speed is zero at the press')
  // The first frame's speed as a share of the peak speed (the old exponential ease: 1.0 at any rate), and the first frame's share of the click.
  const bounds: Record<number, [number, number]> = { 30: [0.42, 0.14], 60: [0.18, 0.05], 120: [0.07, 0.015] }
  for (const fps of [30, 60, 120]) {
    const tr = tap(fps)
    const first = tr.v[0]
    const [maxSpeed, maxShare] = bounds[fps]
    assert.ok(first / peak < maxSpeed, `${fps} Hz: first-frame speed ${(first / peak * 100).toFixed(1)} % of the peak`)
    assert.ok(tr.x[0] / ZOOM_CLICK_OCTAVES < maxShare, `${fps} Hz: the first frame took ${(tr.x[0] / ZOOM_CLICK_OCTAVES * 100).toFixed(1)} % of the click`)
  }
})

test('the speed is continuous: no frame changes it by more than a set share of the peak, and a tap is one rise and one fall', () => {
  const peak = Math.max(...speedAt(tap(1000)))
  const maxStep: Record<number, number> = { 30: 0.5, 60: 0.3, 120: 0.16 }
  for (const fps of [30, 60, 120]) {
    const v = speedAt(tap(fps))
    let worst = Math.abs(v[0] - 0)
    for (let i = 1; i < v.length; i++) worst = Math.max(worst, Math.abs(v[i] - v[i - 1]))
    assert.ok(worst / peak < maxStep[fps], `${fps} Hz: the largest speed change was ${(worst / peak * 100).toFixed(1)} % of the peak`)
    // One hump: rising to the maximum, then falling; no second rise.
    const top = v.indexOf(Math.max(...v))
    for (let i = 1; i <= top; i++) assert.ok(v[i] >= v[i - 1] - 1e-12, `${fps} Hz: speed fell at frame ${i} before the peak`)
    for (let i = top + 1; i < v.length; i++) assert.ok(v[i] <= v[i - 1] + 1e-12, `${fps} Hz: speed rose again at frame ${i}`)
  }
})

test('the tap total is the click amount, it lands at zero speed, and it settles in about a third of a second', () => {
  for (const [click, fps] of [[ZOOM_CLICK_OCTAVES, 30], [ZOOM_CLICK_OCTAVES, 60], [ZOOM_CLICK_OCTAVES, 120], [-ZOOM_CLICK_OCTAVES, 60], [TILT_CLICK_UNITS, 60], [-TILT_CLICK_UNITS, 144]] as const) {
    const tr = tap(fps, click)
    assert.ok(Math.abs(tr.x.at(-1)! - click) < 1e-9, `${click} at ${fps} Hz: delivered ${tr.x.at(-1)}`)
    const k = tr.x.findIndex((x) => Math.abs(x) >= 0.95 * Math.abs(click))
    const t95 = tr.t[k]
    assert.ok(t95 > 0.27 && t95 < 0.40, `${click} at ${fps} Hz: 95 % at ${t95} s`)
    // The last frames move by next to nothing (the speed ends at zero): no final snap bigger than a thousandth of the click.
    const lastMoves = tr.x.map((x, i) => Math.abs(x - (tr.x[i - 1] ?? 0))).filter((u) => u > 0)
    assert.ok(lastMoves.at(-1)! < 2e-3 * Math.abs(click), `${click} at ${fps} Hz: the last step was ${lastMoves.at(-1)}`)
  }
})

test('the result at a given time does not depend on the frame rate (tap, hold and release)', () => {
  for (const t of [0.1, 0.3, 0.5, 0.9, 1.2]) {
    const ref = at(run(240, ZOOM_CLICK_OCTAVES, ZOOM_HOLD_OCTAVES_PER_S, 0.9, 2), t)
    for (const fps of [30, 60, 120]) {
      const got = at(run(fps, ZOOM_CLICK_OCTAVES, ZOOM_HOLD_OCTAVES_PER_S, 0.9, 2), t)
      assert.ok(Math.abs(got - ref) < 1e-6, `t=${t} ${fps} Hz: ${got} vs ${ref}`)
    }
  }
})

test('a held button runs into its rate with no dip below it and no overshoot above it, and a release lands on the target', () => {
  for (const [click, rate, name] of [[ZOOM_CLICK_OCTAVES, ZOOM_HOLD_OCTAVES_PER_S, 'zoom'], [TILT_CLICK_UNITS, TILT_HOLD_UNITS_PER_S, 'tilt']] as const) {
    for (const fps of [30, 60, 120]) {
      const tr = run(fps, click, rate, 2, 4)
      const v = speedAt(tr)
      const top = v.indexOf(Math.max(...v))
      // After the click's own peak the speed never falls under 97 % of the held rate (the old ease fell to a quarter of it) ...
      for (let i = top; i < Math.round(2 * fps); i++) assert.ok(v[i] > 0.97 * rate, `${name} ${fps} Hz: speed ${v[i]} under the rate ${rate} at ${tr.t[i]} s`)
      // ... and it settles on the rate and never goes over it once the click's peak is behind.
      const settledFrom = Math.round(0.8 * fps)
      for (let i = settledFrom; i < Math.round(2 * fps); i++) assert.ok(v[i] <= rate * 1.001, `${name} ${fps} Hz: overshoot ${v[i]} at ${tr.t[i]} s`)
      assert.ok(Math.abs(v[Math.round(1.9 * fps)] - rate) < 0.01 * rate, `${name} ${fps} Hz: steady speed ${v[Math.round(1.9 * fps)]}`)
      // The speed has no jump anywhere (the peak of the click is the largest the speed gets, at the click's own scale).
      const peak = Math.max(...v)
      for (let i = 1; i < v.length; i++) assert.ok(Math.abs(v[i] - v[i - 1]) < 0.5 * peak, `${name} ${fps} Hz: jump at ${tr.t[i]} s`)
      // Released at 2 s: it stops on click + rate * (held time past the delay).
      assert.ok(Math.abs(tr.x.at(-1)! - (click + rate * (2 - BUTTON_HOLD_DELAY_S))) < 1e-6, `${name} ${fps} Hz: landed on ${tr.x.at(-1)}`)
      assert.ok(Math.abs(v.at(-1)!) < 1e-2 * rate)
    }
  }
})

test('a press shorter than the hold delay is a plain tap, longer adds only what was held past it', () => {
  for (const heldS of [0.05, 0.1, BUTTON_HOLD_DELAY_S - 1e-6]) {
    const tr = run(60, ZOOM_CLICK_OCTAVES, 1.2, heldS, 3)
    assert.ok(Math.abs(tr.x.at(-1)! - ZOOM_CLICK_OCTAVES) < 1e-9, `held ${heldS} s: ${tr.x.at(-1)}`)
  }
  const tr = run(120, ZOOM_CLICK_OCTAVES, 1.2, 0.2, 3)
  assert.ok(Math.abs(tr.x.at(-1)! - (ZOOM_CLICK_OCTAVES + 1.2 * (0.2 - BUTTON_HOLD_DELAY_S))) < 1.2 / 120, `held 0.2 s: ${tr.x.at(-1)}`)
})

test('two presses add up: the second one does not restart the first', () => {
  const b = new EasedButton()
  b.press(ZOOM_CLICK_OCTAVES); b.release()
  let x = 0, vPrev = 0, worst = 0
  for (let i = 1; i <= 240; i++) {
    if (i === 12) { b.press(ZOOM_CLICK_OCTAVES); b.release() }
    x += b.tick(1 / 60, 1.2)
    worst = Math.max(worst, Math.abs(b.speed - vPrev)); vPrev = b.speed
  }
  assert.ok(Math.abs(x - 2 * ZOOM_CLICK_OCTAVES) < 1e-9)
  assert.ok(worst < 1.5 * ZOOM_CLICK_OCTAVES, `speed jumped by ${worst}`)
})

test('the Home frame follow does not eat a small zoom input: a 1 % per frame zoom, a held + (1.4 % per frame) and a tap, at 30, 60 and 120 Hz', () => {
  const target = 3.6
  for (const fps of [30, 60, 120]) {
    for (const perFrame of [0.01, 0.014, 0.003]) {
      let st = { homeFrame: true, applied: Number.NaN }
      let dist = target
      let zoomed = 0
      for (let i = 0; i < 90; i++) {
        // The input of this frame (a button: a small first step), seen by the follow in the same frame.
        dist *= 1 - perFrame
        zoomed += Math.log(1 - perFrame)
        const r = homeFollowStep(st, dist, target, 1 / fps, true)
        st = { homeFrame: r.homeFrame, applied: r.applied }
        dist = r.dist
      }
      assert.equal(st.homeFrame, false, `${fps} Hz ${perFrame}: the Home frame ended`)
      assert.ok(Math.abs(Math.log(dist / target) - zoomed) < 1e-12, `${fps} Hz ${perFrame}: the follow pulled the zoom back (${dist})`)
    }
  }
  // Without the explicit end (the old per-frame 2 % gate alone), the same 1 % steps never trip the gate and the follow undoes them: the bug.
  let st = { homeFrame: true, applied: Number.NaN }
  let dist = target
  let at60 = 0
  for (let i = 0; i < 120; i++) { dist *= 0.99; const r = homeFollowStep(st, dist, target, 1 / 60, false); st = { homeFrame: r.homeFrame, applied: r.applied }; dist = r.dist; if (i === 59) at60 = dist }
  assert.equal(st.homeFrame, true, 'no zoom input flag: the gate does not trip on 1 % steps')
  assert.ok(dist > target * 0.85 && Math.abs(Math.log(dist / at60)) < 0.01, `...and the follow holds the held zoom at a standstill near the Home distance (${at60} then ${dist}, Home ${target})`)
  // The follow itself is unchanged: it eases the distance toward the target when nothing zooms, and a pose set from outside (> 2 % in a frame) still ends it.
  const a = homeFollowStep({ homeFrame: true, applied: Number.NaN }, 4, 3.6, 1 / 60, false)
  assert.ok(a.homeFrame && a.dist < 4 && a.dist > 3.6)
  const jumped = homeFollowStep({ homeFrame: true, applied: 3.6 }, 3.6 * 1.05, 3.6, 1 / 60, false)
  assert.equal(jumped.homeFrame, false)
})

test('wiring: the frame loop steps the buttons with its own timestamp, the Home frame ends on a zoom input, a script that starts inside the guard is taken', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const body = main.slice(main.indexOf('function frameLoopBody('))
  const stepAt = body.indexOf('touchControlsUi?.frame(now)')
  assert.ok(stepAt > 0, 'frameLoopBody steps the buttons with the frame timestamp')
  assert.ok(stepAt < body.indexOf('const ridgeMoved = stepRidge(now)'), 'before any script step reads the camera')
  assert.ok(stepAt < body.indexOf('const rigMoved = rig.step(now, dt)'), 'and before the rig steps')
  assert.match(main, /mountTouchControls\([\s\S]{0,2200}wake: markDirty,/, 'a press wakes the frame loop')
  assert.match(main, /const zoomInput = rig\.lastZoomInputAt !== homeZoomInputSeen/, 'stepLayout ends the Home frame on a zoom input')
  assert.match(main, /homeFollowStep\(\{ homeFrame, applied: homeDistApplied \}, rig\.pose\.dist, homeDistFor\(frameTarget\), dt, zoomInput\)/)
  assert.match(main, /homeDistApplied = NaN\n {2}homeZoomInputSeen = rig\.lastZoomInputAt/, 'goHome starts counting inputs from now')
  assert.match(main, /if \(now - lastTake > 500 \|\| tween \|\| descent \|\| cinematicFlight \|\| orbitJourney \|\| flight \|\| ridge\) \{ takeCurrentScriptCamera\(\); lastTake = now \}/, 'a running script is taken at every step, not only once per 500 ms')
  const rig = readFileSync(new URL('../src/camera/rig.ts', import.meta.url), 'utf8')
  assert.match(rig, /zoomCentre\([^)]*\): void \{\n {4}if \(this\.mode !== 'fly' \|\| this\.frozen\) return\n {4}this\.lastZoomInputAt = now/, 'every zoom input stamps lastZoomInputAt first')
  const ui = readFileSync(new URL('../src/ui/touchControls.ts', import.meta.url), 'utf8')
  assert.match(ui, /if \(hooks\.wake\) \{ glideSteps\.add\(step\); hooks\.wake\(\) \}/)
  assert.match(ui, /const step = \(n: number\): boolean => \{/, 'the halves are stepped with a given time')
  assert.ok(!/const step = \(\): boolean => \{\s*const n = performance\.now\(\)\s*const units = motion\.tick/.test(ui), 'the halves no longer time themselves inside their own callback')
})

// Review of #387: a released tap's glide tail took a fly-to started inside it over (camStep) and killed it on its
// first frame; a re-press while the glide ran reset the half's clock to the press time (a one-frame stall).
test('a scripted move stops the released glide tails; a re-press keeps the glide clock', () => {
  const b = new EasedButton()
  b.press(ZOOM_CLICK_OCTAVES); b.release()
  let moved = 0
  for (let i = 0; i < 6; i++) moved += b.tick(1 / 60, ZOOM_HOLD_OCTAVES_PER_S)
  assert.ok(moved > 0 && b.active, 'the tail is gliding')
  b.stop()
  assert.equal(b.active, false, 'stop() leaves it at rest')
  assert.equal(b.tick(1 / 60, ZOOM_HOLD_OCTAVES_PER_S), 0, 'and it applies nothing more')
  const ui = readFileSync(new URL('../src/ui/touchControls.ts', import.meta.url), 'utf8')
  assert.match(ui, /tails\.add\(\(\) => \{ if \(b\.dataset\.down !== undefined\) return; motion\.stop\(\); glideSteps\.delete\(step\); driven\.delete\(own\) \}\)/, 'a held half is never stopped; a released one stops and leaves the loop')
  assert.match(ui, /cancelGlides: \(\) => \{ for \(const f of tails\) f\(\) \}/)
  assert.match(ui, /if \(!glideSteps\.has\(step\) && !driven\.has\(own\)\) tPrev = performance\.now\(\)/, 'a re-press during the glide keeps its clock')
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const fly = main.slice(main.indexOf('function flyTo('), main.indexOf('\n}\n', main.indexOf('function flyTo(')))
  assert.match(fly, /^ {2}cancelButtonGlides\(\)$/m, 'every fly-to (Home, a pin, a label, a moment\'s approach) stops the tails first')
  assert.match(main, /function cancelButtonGlides\(\): void \{ touchControlsUi\?\.cancelGlides\(\) \}/)
})
