// Phone motion policy (quality/phoneSharp.ts): one render fraction f for every moving frame on touch classes, never under half the canvas,
// 30 fps before any resolution step; the f metric; the rest governor's recovery and floor (quality/dpr.ts).
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FracStats, PHONE_FLOOR_F, PHONE_PROBE_FRAMES, PHONE_PROBE_LEN, PHONE_SHARP_DEFAULT, PHONE_SLOW_FRAMES, PhonePacer,
  PHONE_PROBE_SLOW, PHONE_VETO_EXPIRE, DESKTOP_MOTION_MP, CAP_FLOOR_F, CAP_SNAP_F, capMotionF, motionMpFromSearch, motionPxCapFor, DESKTOP_FLOOR_F, DESKTOP_PARAMS, PHONE_PARAMS, resolveDesktopSharp, sharpParamsFor, phoneForcedF, phoneForcedHz, phoneMoment, phoneRestSample, phoneSharpFromSearch, phoneTargetF, resolvePhoneSharp, type ScriptedMotion,
} from '../src/quality/phoneSharp.ts'
import { renderDims } from '../src/quality/sharpMotion.ts'
import { PHONE_REST_FACTOR_MIN, REST_FACTOR_MIN, RestDprGovernor } from '../src/quality/dpr.ts'
import { CLASS_TABLE } from '../src/quality/startupClass.ts'
import { readFileSync } from 'node:fs'
import { CATMULL_MAX_MAG, catmullOn, upscaleMode } from '../src/post/upscale.ts'
import { starDotMode } from '../src/sky/starDots.ts'

test('on by default for the touch classes on the web only; ?phonesharp=0 and ?motion=sharp win', () => {
  assert.equal(PHONE_SHARP_DEFAULT, true)
  for (const c of ['ios', 'ipad', 'phone-android', 'tablet'] as const) assert.equal(resolvePhoneSharp(c, ''), true, c)
  for (const c of ['desktop', 'software'] as const) {
    assert.equal(resolvePhoneSharp(c, ''), false, c)
    assert.equal(resolvePhoneSharp(c, '?phonesharp=1'), false, `${c}: never, whatever the URL`)
  }
  assert.equal(resolvePhoneSharp('phone-android', '?phonesharp=0'), false)
  assert.equal(resolvePhoneSharp('phone-android', '', true), false, 'native shell keeps its own caps')
  assert.equal(resolvePhoneSharp('phone-android', '?motion=sharp'), false, 'the full-resolution policy is its own arm')
  assert.equal(resolvePhoneSharp('phone-android', '', false, false), false, 'the constant flips the default')
  assert.equal(resolvePhoneSharp('phone-android', '?phonesharp=1', false, false), true)
  assert.equal(phoneSharpFromSearch('?phonesharp=yes'), null)
})

test('target f: 1.25 rendered px per CSS px, within [0.5, 1]; f >= 0.5 for every rest ratio a phone class can choose', () => {
  assert.equal(phoneTargetF(2), 0.625)
  assert.equal(phoneTargetF(1.5), 1.25 / 1.5)
  assert.equal(phoneTargetF(1.25), 1)
  assert.equal(phoneTargetF(1), 1)
  assert.equal(phoneTargetF(3), 0.5, 'never under the floor')
  assert.equal(phoneTargetF(NaN), 1)
  for (let r = 0.5; r <= 4; r += 0.05) {
    const f = phoneTargetF(r)
    assert.ok(f >= PHONE_FLOOR_F && f <= 1, `${r}`)
    assert.ok(f * r >= Math.min(1.25, r) - 1e-9 || f === PHONE_FLOOR_F, `px per CSS px at ${r}`)
  }
  // Against the old stacking on phone-android (grid 0.35 x 1.5 / 2 far, 0.25 x 1.25 / 2 close): 0.26 and 0.16.
  const ph = CLASS_TABLE['phone-android']
  assert.ok(0.35 * ph.dprCap / ph.restDprCap! < 0.27 && 0.25 * ph.closeDprCap! / ph.restDprCap! < 0.16)
  assert.ok(phoneTargetF(ph.restDprCap!) / (0.35 * ph.dprCap / ph.restDprCap!) > 2.3, 'f more than doubles far out')
})

test('renderDims under phone: scale is f of the canvas (no motion/rest ratio on top); rest frames untouched', () => {
  const cw = 824, ch = 1830
  for (const f of [0.5, 0.625, 0.8]) {
    for (const motionDpr of [1.25, 1.5, 2]) {
      const d = renderDims('phone', { cw, ch, scale: f, gestureOn: true, motionDpr, restDpr: 2, gridIsOnlyScale: false })
      assert.equal(d.w, Math.round(cw * f)); assert.equal(d.h, Math.round(ch * f))
      assert.ok(d.w / cw >= PHONE_FLOOR_F - 1e-3)
    }
  }
  const rest = renderDims('phone', { cw, ch, scale: 1, gestureOn: false, motionDpr: 1.5, restDpr: 2, gridIsOnlyScale: false })
  assert.deepEqual([rest.w, rest.h], [cw, ch])
  // The default policy is untouched (the old stacking).
  const old = renderDims('default', { cw, ch, scale: 0.35, gestureOn: true, motionDpr: 1.5, restDpr: 2, gridIsOnlyScale: false })
  assert.equal(old.w, Math.round(cw * 0.35 * 0.75))
})

/** Feeds `n` gaps of `ms`. */
const feed = (p: PhonePacer, ms: number, n: number): void => { for (let i = 0; i < n; i++) p.observe(ms, 1000 / 60) }

test('pacer: 30 fps at the target f before any resolution step; the floor only when 30 fps is still over; never under the floor', () => {
  const p = new PhonePacer()
  assert.equal(p.hz, 60); assert.equal(p.f(2), 0.625)
  feed(p, 18, 50)
  assert.equal(p.level, 0, 'within tolerance: stays')
  for (let i = 0; i < 300; i++) p.observe(i % 3 === 0 ? 120 : 16.7, 1000 / 60)
  assert.equal(p.level, 0, 'isolated spikes (tile uploads, JS) never step')
  feed(p, 16.7, 12)
  feed(p, 30, PHONE_SLOW_FRAMES - 1)
  assert.equal(p.level, 0, 'a short run is not enough')
  feed(p, 30, 1)
  assert.equal(p.level, 1); assert.equal(p.hz, 30); assert.equal(p.f(2), 0.625, 'cadence first, resolution held')
  feed(p, 34, 100)
  assert.equal(p.level, 1, 'a steady 30 fps is healthy at the 30 tier')
  feed(p, 55, PHONE_SLOW_FRAMES)
  assert.equal(p.level, 2); assert.equal(p.hz, 30); assert.equal(p.f(2), PHONE_FLOOR_F)
  feed(p, 200, 500)
  assert.equal(p.level, 2); assert.equal(p.f(2), PHONE_FLOOR_F, 'never under the floor, however slow')
  assert.ok(p.f(1.25) >= PHONE_FLOOR_F)
})

test('pacer: probes the level above, backs off after a failed probe, keeps a successful one', () => {
  const p = new PhonePacer()
  feed(p, 30, PHONE_SLOW_FRAMES)
  assert.equal(p.level, 1)
  feed(p, 33.4, PHONE_PROBE_FRAMES - 1)
  assert.equal(p.level, 1)
  feed(p, 33.4, 1)
  assert.equal(p.level, 0, 'probe 60 fps'); assert.equal(p.probes, 1)
  feed(p, 30, 3)
  assert.equal(p.level, 1, 'failed probe: back to 30'); assert.equal(p.failedProbes, 1)
  feed(p, 33.4, PHONE_PROBE_FRAMES)
  assert.equal(p.level, 1, 'the next probe waits twice as long')
  feed(p, 33.4, PHONE_PROBE_FRAMES)
  assert.equal(p.level, 0)
  feed(p, 16.7, PHONE_PROBE_LEN + 400)
  assert.equal(p.level, 0, 'a healthy probe stays at 60')
})

test('pacer: a slow gap with the GPU well inside the period is the CPU\'s: vetoed, no step', () => {
  const p = new PhonePacer()
  for (let i = 0; i < 100; i++) p.observe(60, 1000 / 60, true, 10)
  assert.equal(p.level, 0); assert.ok(p.vetoed >= 100)
  for (let i = 0; i < PHONE_SLOW_FRAMES; i++) p.observe(60, 1000 / 60, true, 40)
  assert.equal(p.level, 2, 'GPU over the period: the floor')
})

test('pacer: forced f / hz (rig arms) ignore observations; parse', () => {
  const p = new PhonePacer(0.5, 30)
  feed(p, 200, 100)
  assert.equal(p.f(2), 0.5); assert.equal(p.hz, 30)
  assert.equal(phoneForcedF('?phonef=0.5'), 0.5)
  assert.equal(phoneForcedF('?phonef=2'), undefined)
  assert.equal(phoneForcedHz('?phonehz=30'), 30)
  assert.equal(phoneForcedHz('?phonehz=45'), undefined)
})

test('FracStats: min, p10, p50 over motion frames', () => {
  const s = new FracStats()
  assert.deepEqual(s.snapshot(), { frames: 0, min: null, p10: null, p50: null, last: 0 })
  for (let i = 0; i < 90; i++) s.add(0.625)
  for (let i = 0; i < 10; i++) s.add(0.5)
  s.add(NaN); s.add(0)
  const snap = s.snapshot()
  assert.equal(snap.frames, 100); assert.equal(snap.min, 0.5); assert.equal(snap.p10, 0.5); assert.equal(snap.p50, 0.63)
  s.reset(); assert.equal(s.snapshot().frames, 0)
})

test('rest governor: the original only lowers; the phone options recover after healthy frames and keep the floor', () => {
  const old = new RestDprGovernor(true)
  for (let i = 0; i < 40; i++) old.fold(300)
  assert.equal(old.factor, REST_FACTOR_MIN)
  for (let i = 0; i < 40; i++) assert.equal(old.fold(10), false)
  assert.equal(old.factor, REST_FACTOR_MIN, 'no recovery without the option')

  const g = new RestDprGovernor(true, { recover: true, factorMin: PHONE_REST_FACTOR_MIN })
  for (let i = 0; i < 40; i++) g.fold(300)
  assert.equal(g.factor, PHONE_REST_FACTOR_MIN, 'explicit floor')
  assert.ok(g.apply(2, 1.25) >= 1.5, 'rest ratio 2 never under 1.5')
  // A frame that would be over 70 ms one step finer does not count toward recovery.
  for (let i = 0; i < 10; i++) assert.equal(g.fold(60), false)
  let steps = 0
  for (let i = 0; i < 30; i++) if (g.fold(20)) steps++
  assert.equal(g.factor, 1, 'back to the full rest ratio')
  assert.ok(steps >= 1 && g.ups === steps)
  assert.equal(g.apply(2, 1.25), 2)
  const off = new RestDprGovernor(false, { recover: true })
  assert.equal(off.fold(500), false)
})

test('final pass and stars under the phone policy: Catmull-Rom at its magnification, native stars', () => {
  assert.equal(upscaleMode('', true), 'catmull')
  for (const f of [0.5, 0.625, 1.25 / 1.5]) assert.equal(catmullOn('catmull', 1 / f), 1, `f ${f}`)
  assert.ok(1 / PHONE_FLOOR_F <= CATMULL_MAX_MAG, 'the floor stays inside the Catmull-Rom range')
  assert.equal(starDotMode('', true), 'native')
  assert.equal(starDotMode('?stars=scene', true), 'scene', 'opt-out stands')
})

test('moments: a steady 30 fps from the first frame at the target f; slow frames at 30 go to the floor; recovers to the target', () => {
  const p = new PhonePacer()
  assert.equal(p.hzFor(true), 30); assert.equal(p.hzFor(false), 60); assert.equal(p.f(2), 0.625)
  for (let i = 0; i < 300; i++) p.observe(33.4, 1000 / 60, true)
  assert.equal(p.level, 0, 'a healthy moment changes nothing'); assert.equal(p.f(2), 0.625)
  for (let i = 0; i < PHONE_SLOW_FRAMES; i++) p.observe(60, 1000 / 60, true)
  assert.equal(p.level, 2); assert.equal(p.f(2), PHONE_FLOOR_F)
  for (let i = 0; i < PHONE_PROBE_FRAMES; i++) p.observe(33.4, 1000 / 60, true)
  assert.equal(p.level, 1); assert.equal(p.f(2), 0.625, 'back to the target at 30 fps')
  assert.equal(new PhonePacer(undefined, 60).hzFor(true), 60, '?phonehz= forces')
})

const NONE: ScriptedMotion = { tween: false, cinematic: false, orbit: false, intro: false, descent: false, flight: false, ridge: false, route: false, rigGlide: false, groundGlide: false }

test('every scripted camera state is a moment: an Apollo arrival (approach fly-to -> descent -> ground glide) stays at 30 fps throughout', () => {
  assert.equal(phoneMoment(NONE), false, 'a plain drag is not a moment')
  for (const k of Object.keys(NONE) as Array<keyof ScriptedMotion>) assert.equal(phoneMoment({ ...NONE, [k]: true }), true, k)
  const p = new PhonePacer()
  // The journey: the approach tween with its rig glide, then the descent (and its descent flight), then the ground camera's glide to eye level.
  const journey: ScriptedMotion[] = [
    { ...NONE, tween: true, rigGlide: true }, { ...NONE, rigGlide: true }, { ...NONE, descent: true }, { ...NONE, descent: true, flight: true },
    { ...NONE, flight: true }, { ...NONE, groundGlide: true }, { ...NONE, ridge: true }, { ...NONE, route: true },
  ]
  for (const st of journey) {
    assert.equal(p.hzFor(phoneMoment(st)), 30, JSON.stringify(st))
    for (let i = 0; i < 40; i++) p.observe(33.4, 1000 / 60, phoneMoment(st))
    assert.equal(p.level, 0); assert.equal(p.f(2), 0.625)
  }
  // The source reads every one of them (no state left out of the wiring).
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const line = src.split('\n').find((l) => l.startsWith('const phoneMomentActive'))!
  for (const k of Object.keys(NONE)) assert.match(line, new RegExp(`\\b${k}:`), k)
})

test('moments: failed probes at the floor back off (bounded, doubling) and count; a stable floor probes less and less', () => {
  const p = new PhonePacer()
  for (let i = 0; i < PHONE_SLOW_FRAMES; i++) p.observe(60, 1000 / 60, true)
  assert.equal(p.level, 2)
  // The target costs 60 ms a frame, the floor 33.3: every probe fails.
  const frame = (): void => p.observe(p.level === 2 ? 33.3 : 60, 1000 / 60, true)
  const probeAt: number[] = []
  let lastProbes = 0
  for (let i = 0; i < 6000; i++) { frame(); if (p.probes !== lastProbes) { probeAt.push(i); lastProbes = p.probes } }
  assert.ok(p.failedProbes >= 3 && p.failedProbes === p.probes, `every probe failed and was counted (${p.failedProbes}/${p.probes})`)
  const gaps = probeAt.slice(1).map((v, i) => v - probeAt[i])
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] >= gaps[i - 1], `backoff grows: ${gaps}`)
  assert.ok(gaps.at(-1)! <= 1440 + PHONE_PROBE_SLOW + 1, 'bounded')
  assert.equal(p.level, 2)
})

test('rest governor wiring: the phone policy prices the hand-back frame outside the FENCE_CLASS-only cache branch', () => {
  assert.equal(phoneRestSample({ phone: true, scale: 1, settleHeld: false, buildOnly: false, pending: false, capture: false }), true)
  for (const k of ['settleHeld', 'buildOnly', 'pending', 'capture'] as const) assert.equal(phoneRestSample({ phone: true, scale: 1, settleHeld: false, buildOnly: false, pending: false, capture: false, [k]: true }), false, k)
  assert.equal(phoneRestSample({ phone: true, scale: 0.7, settleHeld: false, buildOnly: false, pending: false, capture: false }), false)
  assert.equal(phoneRestSample({ phone: false, scale: 1, settleHeld: false, buildOnly: false, pending: false, capture: false }), false)
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const i = src.indexOf('if (phoneRestSample(')
  assert.ok(i > 0)
  assert.match(src.slice(i, i + 400), /restDrawAt = now/, 'the sample sets restDrawAt (what the loop-top sampler and restGovernor.fold read)')
  // Not inside the cache-first branch, whose guard has !FENCE_CLASS.
  const branch = src.lastIndexOf('if (scale === 1 && !settleHeld && RESTCACHE_ON', i)
  const elseIf = src.indexOf('} else if (restCatchUp) {', branch)
  assert.ok(branch > 0 && elseIf > branch && elseIf < i, 'after the cache-first branch closes')
  assert.match(src, /restDpr = restRatioAfterFold\(restGovernor\.fold\(restMs\), gestureOn, restDpr\)/)
})

test('veto expiry: a slow run the GPU timer keeps vetoing (Metal under-reads) is acted on after PHONE_VETO_EXPIRE frames', () => {
  const p = new PhonePacer(undefined, undefined, DESKTOP_PARAMS)
  let n = 0
  while (p.level === 0 && n < 500) { p.observe(50, 1000 / 60, false, 4); n++ }
  assert.equal(p.level, 1); assert.equal(p.vetoExpired, 1)
  assert.ok(n >= PHONE_VETO_EXPIRE && n <= PHONE_VETO_EXPIRE + 20, `${n}`)
  // A tile burst shorter than that never steps.
  const q = new PhonePacer(undefined, undefined, DESKTOP_PARAMS)
  for (let r = 0; r < 20; r++) { for (let i = 0; i < 40; i++) q.observe(50, 1000 / 60, false, 4); for (let i = 0; i < 40; i++) q.observe(16.7, 1000 / 60, false, 4) }
  assert.equal(q.level, 0); assert.equal(q.vetoExpired, 0)
})

test('desktop policy: on for the desktop class only, ?desktopsharp=0 and ?motion=sharp win; params by class', () => {
  assert.equal(resolveDesktopSharp('desktop', ''), true)
  assert.equal(resolveDesktopSharp('desktop', '?desktopsharp=0'), false)
  assert.equal(resolveDesktopSharp('desktop', '?motion=sharp'), false)
  assert.equal(resolveDesktopSharp('desktop', '', true), false)
  for (const c of ['software', 'phone-android', 'ios', 'ipad', 'tablet'] as const) assert.equal(resolveDesktopSharp(c, '?desktopsharp=1'), false, c)
  assert.equal(sharpParamsFor('desktop', ''), DESKTOP_PARAMS)
  assert.equal(sharpParamsFor('phone-android', ''), PHONE_PARAMS)
  assert.equal(sharpParamsFor('software', ''), null)
  assert.equal(sharpParamsFor('desktop', '?desktopsharp=0'), null)
  assert.equal(sharpParamsFor('phone-android', '?desktopsharp=0'), PHONE_PARAMS, 'the desktop switch leaves phones alone')
})

test('desktop ladder: f 1 at 60 -> f 0.75 at 60 -> f 0.75 at 30; never under 0.75; moments keep the gesture cadence', () => {
  const p = new PhonePacer(undefined, undefined, DESKTOP_PARAMS)
  for (const r of [1, 1.5, 2]) assert.equal(p.f(r), 1)
  assert.equal(p.hz, 60); assert.equal(p.hzFor(true), 60, 'desktop moments are not capped at 30')
  for (let i = 0; i < 200; i++) p.observe(16.7, 1000 / 60, true, 8)
  assert.equal(p.level, 0)
  feed(p, 30, PHONE_SLOW_FRAMES)
  assert.equal(p.level, 1); assert.equal(p.f(2), DESKTOP_FLOOR_F); assert.equal(p.hz, 60, 'resolution to the floor first, still 60 fps')
  feed(p, 30, PHONE_SLOW_FRAMES)
  assert.equal(p.level, 2); assert.equal(p.hz, 30); assert.equal(p.f(2), DESKTOP_FLOOR_F)
  feed(p, 300, 500)
  assert.equal(p.f(2), DESKTOP_FLOOR_F, 'never under the floor')
  // Probing back up: at 30 fps healthy frames bring back 60 at the floor, then f 1.
  const q = new PhonePacer(undefined, undefined, DESKTOP_PARAMS)
  feed(q, 30, PHONE_SLOW_FRAMES); assert.equal(q.level, 1)
  feed(q, 16.7, PHONE_PROBE_FRAMES + PHONE_PROBE_LEN)
  assert.equal(q.level, 0); assert.equal(q.f(2), 1)
  // At f 0.75 the magnification is 1.33: Catmull-Rom.
  assert.equal(catmullOn('catmull', 1 / DESKTOP_FLOOR_F), 1)
})

test('desktop motion pixel cap: 8 MP after the ladder; binds only where f 0.75 exceeds it; ?motionmp=0 no cap; phones and ?desktopsharp=0 untouched', () => {
  assert.equal(DESKTOP_MOTION_MP, 8)
  const cap = motionPxCapFor(DESKTOP_PARAMS, '')
  assert.equal(cap, 8e6)
  const px = (f: number, cw: number, ch: number): number => {
    const d = renderDims('phone', { cw, ch, scale: f, gestureOn: true, motionDpr: 2, restDpr: 2, gridIsOnlyScale: false })
    return d.w * d.h
  }
  // 5120x2880 (the owner's Mac): sqrt(8e6 / 14 745 600) = 0.736570 -> 3771 x 2121 = 7 998 291 px (the closed form fits after rounding).
  const mac = new PhonePacer(undefined, undefined, DESKTOP_PARAMS, cap)
  const fMac = mac.f(2, 5120, 2880)
  assert.equal(fMac, Math.sqrt(8e6 / (5120 * 2880)))
  assert.ok(Math.abs(fMac - 0.736570) < 1e-6, String(fMac))
  assert.equal(px(fMac, 5120, 2880), 3771 * 2121)
  assert.ok(px(fMac, 5120, 2880) <= 8e6)
  assert.equal(mac.capBound, true); assert.equal(mac.ladderF, 1)
  mac.noteFrame(); assert.equal(mac.cappedFrames, 1)
  // 5120x3200 (2560x1600@2): the closed form 0.698771 rounds to 3578 x 2236 = 8 000 408 > 8e6, so one long-side pixel less: 0.698771 - 1/5120 = 0.698576 -> 3577 x 2235.
  const big = new PhonePacer(undefined, undefined, DESKTOP_PARAMS, cap)
  const fBig = big.f(2, 5120, 3200)
  assert.equal(fBig, Math.sqrt(8e6 / (5120 * 3200)) - 1 / 5120)
  assert.ok(Math.abs(fBig - 0.698576) < 1e-6, String(fBig))
  assert.equal(px(fBig, 5120, 3200), 3577 * 2235)
  assert.ok(px(fBig, 5120, 3200) <= 8e6)
  assert.equal(big.capBound, true)
  // The cap applies after the ladder: at the floor level (0.75) the 5120x2880 frame is still capped (0.75 -> 8.29 MP > 8), the same f as level 0.
  feed(mac, 30, PHONE_SLOW_FRAMES); assert.equal(mac.level, 1)
  assert.equal(mac.f(2, 5120, 2880), fMac); assert.equal(mac.ladderF, DESKTOP_FLOOR_F)
  // f under 0.75 only where 0.75 exceeds the cap: canvas px x 0.5625 > 8e6.
  for (const [cw, ch] of [[5120, 2880], [5120, 3200]] as const) assert.ok(cw * ch * DESKTOP_FLOOR_F ** 2 > 8e6)
  // 2560x1440 and 1280x800 (and the 16:10 2560x1600@1): never capped, f 1 at level 0 and 0.75 at the floor.
  for (const [cw, ch] of [[2560, 1440], [1280, 800], [2560, 1600]] as const) {
    const p = new PhonePacer(undefined, undefined, DESKTOP_PARAMS, cap)
    assert.equal(p.f(2, cw, ch), 1, `${cw}x${ch}`); assert.equal(p.capBound, false)
    feed(p, 30, PHONE_SLOW_FRAMES)
    assert.equal(p.f(2, cw, ch), DESKTOP_FLOOR_F); assert.equal(p.capBound, false)
    p.noteFrame(); assert.equal(p.cappedFrames, 0)
  }
  // ?motionmp=0: no cap; ?motionmp=12 raises it (5120x2880 at f 1 = 14.7 MP > 12 -> sqrt(12e6 / 14 745 600)); junk = default.
  assert.equal(motionMpFromSearch('?motionmp=0'), 0)
  assert.equal(motionPxCapFor(DESKTOP_PARAMS, '?motionmp=0'), Infinity)
  const off = new PhonePacer(undefined, undefined, DESKTOP_PARAMS, motionPxCapFor(DESKTOP_PARAMS, '?motionmp=0'))
  assert.equal(off.f(2, 5120, 3200), 1); assert.equal(off.capBound, false)
  assert.equal(motionPxCapFor(DESKTOP_PARAMS, '?motionmp=12'), 12e6)
  assert.ok(Math.abs(capMotionF(1, 5120, 2880, 12e6) - Math.sqrt(12e6 / 14745600)) <= 1 / 5120 + 1e-12)
  for (const junk of ['?motionmp=-1', '?motionmp=abc', '?motionmp=']) assert.equal(motionPxCapFor(DESKTOP_PARAMS, junk), 8e6, junk)
  // Phones stay as #365: no cap whatever the URL; a forced ?phonef= is not capped.
  assert.equal(motionPxCapFor(PHONE_PARAMS, ''), Infinity)
  assert.equal(motionPxCapFor(PHONE_PARAMS, '?motionmp=1'), Infinity)
  assert.equal(new PhonePacer(0.9, undefined, DESKTOP_PARAMS, cap).f(2, 5120, 3200), 0.9)
  // ?desktopsharp=0: no policy (the grid ladders of main), so no cap either; without a canvas size f() is the ladder's (unchanged call shape).
  assert.equal(sharpParamsFor('desktop', '?desktopsharp=0&motionmp=4'), null)
  assert.equal(motionPxCapFor(sharpParamsFor('desktop', '?desktopsharp=0'), ''), Infinity)
  assert.equal(new PhonePacer(undefined, undefined, DESKTOP_PARAMS, cap).f(2), 1)
  // The helper alone: no lowering when the frame fits, an invalid cap means none.
  assert.equal(capMotionF(0.75, 2560, 1600, 8e6), 0.75)
  assert.equal(capMotionF(1, 5120, 3200, Infinity), 1)
  assert.equal(typeof capMotionF(1, 5120, 3200, 8e6), 'number', 'no allocation per call')
  // Snap: 3840x2160 (8.29 MP at f 1) would cap to 0.982; a capped f >= CAP_SNAP_F is not applied.
  assert.ok(Math.sqrt(8e6 / (3840 * 2160)) >= CAP_SNAP_F)
  assert.equal(capMotionF(1, 3840, 2160, 8e6), 1)
  const uhd = new PhonePacer(undefined, undefined, DESKTOP_PARAMS, cap)
  assert.equal(uhd.f(2, 3840, 2160), 1); assert.equal(uhd.capBound, false)
  // Floor: 7680x4320 caps to 0.491 by the closed form, held at CAP_FLOOR_F; a tiny ?motionmp= too.
  assert.ok(Math.sqrt(8e6 / (7680 * 4320)) < CAP_FLOOR_F)
  assert.equal(capMotionF(1, 7680, 4320, 8e6), CAP_FLOOR_F)
  assert.equal(capMotionF(1, 5120, 3200, motionPxCapFor(DESKTOP_PARAMS, '?motionmp=0.01')), CAP_FLOOR_F)
  const eightK = new PhonePacer(undefined, undefined, DESKTOP_PARAMS, cap)
  assert.equal(eightK.f(2, 7680, 4320), CAP_FLOOR_F); assert.equal(eightK.capBound, true)
  // ladderF follows the ladder on every call, also without a canvas size or a cap.
  const nc = new PhonePacer(undefined, undefined, DESKTOP_PARAMS)
  feed(nc, 30, PHONE_SLOW_FRAMES); nc.f(2); assert.equal(nc.ladderF, DESKTOP_FLOOR_F); assert.equal(nc.capBound, false)
})

test('veto expiry is desktop-only: phones keep #365 (a CPU-bound phone with the timer query stays at level 0)', () => {
  assert.equal(PHONE_PARAMS.vetoExpire, Infinity)
  assert.equal(DESKTOP_PARAMS.vetoExpire, PHONE_VETO_EXPIRE)
  // 25 ms gaps on a 60 Hz gesture, GPU 5-10 ms (vetoed): main stayed at level 0 forever.
  const p = new PhonePacer()
  for (let i = 0; i < 5000; i++) p.observe(25, 1000 / 60, false, 5 + (i % 6))
  assert.equal(p.level, 0); assert.equal(p.vetoExpired, 0); assert.equal(p.entries[1], 0); assert.ok(p.vetoed >= 4900)
  // The same run on desktop: the expiry steps 0 -> 1 -> 2 (both 60 fps levels are slow), never more (no step below the bottom), and the probes fail.
  const d = new PhonePacer(undefined, undefined, DESKTOP_PARAMS)
  for (let i = 0; i < 5000; i++) d.observe(25, 1000 / 60, false, 5 + (i % 6))
  assert.equal(d.vetoExpired, 2); assert.equal(d.level, 2); assert.equal(d.failedProbes, d.probes)
})

test('under-reading GPU timer (Metal): f does not pop 1 <-> 0.75 every probe; a probe of an expired level runs without the veto and fails, the backoff doubles', () => {
  // Level 0 (f 1) is truly slow (25 ms > 1.2 x 16.7) but the timer reads 4 ms (vetoed); level 1 (f 0.75) holds 60 fps.
  const p = new PhonePacer(undefined, undefined, DESKTOP_PARAMS)
  let changes = 0, last = p.level
  for (let i = 0; i < 6000; i++) {
    p.observe(p.level === 0 ? 25 : 16, 1000 / 60, false, 4)
    if (p.level !== last) { changes++; last = p.level }
  }
  // Old behaviour (reviewer sim): 44 f changes, 21 probes, 0 failed. Now: one expiry, then probes at 180, 360, 720, 1440, 1440, ... frames, each failing.
  assert.equal(p.vetoExpired, 1)
  assert.ok(p.failedProbes >= 4, `failed ${p.failedProbes}`)
  assert.equal(p.failedProbes, p.probes, 'every probe of the expired level fails')
  assert.ok(changes <= 2 * p.probes + 1 && changes <= 14, `changes ${changes}, probes ${p.probes}`)
  assert.equal(p.level, 1)
  // A probe that passes clears the flag: the device got faster (level 0 now 16 ms) and stays at f 1.
  for (let i = 0; i < 3000; i++) p.observe(16, 1000 / 60, false, 4)
  assert.equal(p.level, 0)
  const probes = p.probes
  for (let i = 0; i < 40; i++) p.observe(25, 1000 / 60, false, 4)
  assert.equal(p.level, 0, 'a short burst after a passed probe is vetoed again (the flag cleared)'); assert.equal(p.probes, probes)
})

test('desktop motion policy wiring in main.ts: params from the URL, the policy set, the cap passed to the pacer, f with the canvas size', () => {
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(src, /const SHARP_PARAMS = motionPolicy\(\) === 'default' \? sharpParamsFor\(quality\.detected\.cls, location\.search, !!nativeHost\) : null/)
  assert.match(src, /if \(SHARP_PARAMS\) setMotionPolicy\('phone'\)/)
  assert.match(src, /new PhonePacer\(phoneForcedF\(location\.search\), phoneForcedHz\(location\.search\), SHARP_PARAMS \?\? undefined, motionPxCapFor\(SHARP_PARAMS, location\.search\)\)/)
  assert.match(src, /const sharpF = \(\): number => phonePacer\.f\(restDpr, Math\.max\(64, Math\.round\(canvas\.clientWidth \* restDpr\)\), Math\.max\(64, Math\.round\(canvas\.clientHeight \* restDpr\)\)\)/)
  // Every f the policy draws goes through sharpF (the cap), none through the bare ladder.
  assert.equal((src.match(/phonePacer\.f\(restDpr\)/g) ?? []).length, 0)
  assert.match(src, /if \(phoneMotionOn\(\)\) \{ motionScale = sharpF\(\); phoneSeenSeq = wallDrawSeq \}/)
  assert.match(src, /scale = motionScale = sharpF\(\)\n/)
  assert.match(src, /motionF\.add\(w \/ cw\); if \(phoneMotionOn\(\)\) phonePacer\.noteFrame\(\)/)
  assert.match(src, /motionCap: phoneMotionOn\(\) && phonePacer\.params\.ladder === 'desktop' \?/)
})
