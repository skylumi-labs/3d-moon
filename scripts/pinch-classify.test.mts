/**
 * A pinch zooms and never tilts; a clean two-finger parallel vertical drag still tilts (owner, 14 Oct 2026: "pinching still does
 * up and down"). The traces replay controls.ts's per-pointer-event loop: one finger moves per event, zoom first, then the
 * accumulated tilt.
 */
import assert from 'node:assert/strict'
import { newTwoFingerState, twoFingerStep } from '../src/camera/gesture.ts'

type P = { x: number; y: number }
interface Result { tilt: number; zoom: number; spreadRatio: number }

/** `frames` is a list of [A, B] positions; each frame is delivered as two events (A moves, then B), as a touch screen does. */
function replay(frames: Array<[P, P]>): Result {
  const st = newTwoFingerState()
  let prevA = frames[0]![0], prevB = frames[0]![1]
  let tilt = 0, zoom = 1
  const deliver = (a: P, b: P): void => {
    const r = twoFingerStep(prevA, prevB, a, b, st)
    zoom *= r.zoom; tilt += r.tilt
    prevA = a; prevB = b
  }
  for (let i = 1; i < frames.length; i++) {
    const [a, b] = frames[i]!
    deliver(a, prevB) // finger A reports first
    deliver(a, b)
  }
  const d = (a: P, b: P): number => Math.hypot(a.x - b.x, a.y - b.y)
  const first = frames[0]!, last = frames[frames.length - 1]!
  return { tilt, zoom, spreadRatio: d(first[0], first[1]) / d(last[0], last[1]) }
}

/** A pinch from spread s0 to s1 over n frames, centroid at (cx, cy) drifting `drift` px down, finger A taking `shareA` of the spread change. */
function pinch(s0: number, s1: number, n: number, drift: number, shareA = 0.5, angleDeg = 0, wobble = 0): Array<[P, P]> {
  const out: Array<[P, P]> = []
  const ang = angleDeg * Math.PI / 180
  for (let i = 0; i <= n; i++) {
    const u = i / n
    const s = s0 + (s1 - s0) * u
    const cy = 400 + drift * u + wobble * Math.sin(u * 9)
    const ds = s - s0
    // A and B sit on a line at `ang`; the spread change is shared unevenly, so the centroid also moves.
    const ax = 200 - (s0 / 2 + ds * shareA) * Math.cos(ang), ay = cy - (s0 / 2 + ds * shareA) * Math.sin(ang)
    const bx = 200 + (s0 / 2 + ds * (1 - shareA)) * Math.cos(ang), by = cy + (s0 / 2 + ds * (1 - shareA)) * Math.sin(ang)
    out.push([{ x: ax, y: ay }, { x: bx, y: by }])
  }
  return out
}

const cases: Array<[string, Array<[P, P]>]> = []
for (const [s0, s1] of [[160, 280], [280, 160], [200, 215], [215, 200], [120, 330]] as const) {
  for (const n of [8, 40, 160]) { // fast and slow
    for (const drift of [0, 15, -40, 40]) {
      for (const shareA of [0.5, 0.15, 0.85]) {
        for (const angle of [0, 35, 80]) cases.push([`${s0}->${s1} n=${n} drift=${drift} A=${shareA} angle=${angle}`, pinch(s0, s1, n, drift, shareA, angle, 2)])
      }
    }
  }
}
for (const [name, frames] of cases) {
  const r = replay(frames)
  assert.equal(r.tilt, 0, `a pinch never tilts: ${name} tilted ${r.tilt}`)
  // The zoom factors multiply to the start/end spread ratio, to within the dead band swallowed at the start.
  const tol = 0.01
  assert.ok(Math.abs(Math.log(r.zoom / r.spreadRatio)) <= tol, `a pinch zooms: ${name} zoom ${r.zoom} vs ${r.spreadRatio}`)
  assert.ok(r.zoom !== 1, `${name} did zoom`)
}

// A clean two-finger parallel drag tilts and does not zoom, wherever the fingers stand: horizontal, vertical or diagonal placement,
// slow or fast, with finger spread tremor, up or down.
for (const [ax, ay, bx, by] of [[100, 400, 260, 400], [200, 300, 200, 460], [100, 300, 210, 415], [300, 300, 190, 410]] as const) {
  for (const perFrame of [2, 5, 9, -5]) {
    const frames: Array<[P, P]> = []
    for (let i = 0; i <= 24; i++) frames.push([{ x: ax, y: ay + perFrame * i }, { x: bx + (i % 2) * 0.4, y: by + perFrame * i + (i % 3) * 0.3 }])
    const r = replay(frames)
    const total = Math.abs(perFrame) * 24
    assert.ok(Math.abs(r.tilt) > total * 0.4 && Math.sign(r.tilt) === Math.sign(perFrame), `a parallel drag tilts: placement ${ax},${ay}-${bx},${by} at ${perFrame}/frame gave ${r.tilt}`)
    assert.ok(Math.abs(Math.log(r.zoom)) < 0.01, `and does not zoom (${r.zoom})`)
  }
}

// Review traces: two fingers 160 px apart vertically or diagonally moving together 5 px per frame tilt (they gave zero).
{
  const v: Array<[P, P]> = [], d: Array<[P, P]> = []
  for (let i = 0; i <= 20; i++) {
    v.push([{ x: 200, y: 200 + 5 * i }, { x: 200, y: 360 + 5 * i }])
    d.push([{ x: 120, y: 200 + 5 * i }, { x: 120 + 113.137, y: 200 + 113.137 + 5 * i }])
  }
  for (const frames of [v, d]) {
    const r = replay(frames)
    assert.ok(r.tilt > 40, `constant paired spread tilts (${r.tilt})`)
    assert.equal(r.zoom, 1)
  }
}
// And a drifting pinch (spread 160 -> 164 px over 60 px of vertical travel) is a zoom, not 50 px of tilt.
{
  const frames: Array<[P, P]> = []
  for (let i = 0; i <= 30; i++) frames.push([{ x: 100 - 2 * i / 30, y: 300 + 60 * i / 30 }, { x: 260 + 2 * i / 30, y: 300 + 60 * i / 30 }])
  const r = replay(frames)
  assert.equal(r.tilt, 0, `a drifting pinch does not tilt (${r.tilt})`)
  assert.ok(Math.abs(Math.log(r.zoom / r.spreadRatio)) < 0.01 && r.zoom < 1, `it zooms (${r.zoom})`)
}

// A tilt that then turns into a pinch stops tilting and zooms from there on.
{
  const frames: Array<[P, P]> = []
  for (let i = 0; i <= 20; i++) frames.push([{ x: 100, y: 400 + 3 * i }, { x: 300, y: 400 + 3 * i }])
  for (let i = 1; i <= 20; i++) frames.push([{ x: 100 - 3 * i, y: 460 + 3 * i }, { x: 300 + 3 * i, y: 460 + 3 * i }])
  const st = newTwoFingerState()
  let tiltAfter = 0, zoomAfter = 1
  let prevA = frames[0]![0], prevB = frames[0]![1]
  frames.forEach((f, i) => {
    if (i === 0) return
    const r = twoFingerStep(prevA, prevB, f[0], f[1], st)
    if (i > 28) { tiltAfter += r.tilt; zoomAfter *= r.zoom }
    prevA = f[0]; prevB = f[1]
  })
  assert.equal(tiltAfter, 0, 'once the spread has moved it is a zoom and no longer tilts')
  assert.ok(zoomAfter < 0.9, `and it zooms (${zoomAfter})`)
}

console.log(`pinch-classify: ${cases.length} pinch traces ok`)

// Review trace: a roughly vertical placement, 160 px apart, drifting pinch: A moves (-8.5, +60), B (+8.5, +60) over 30
// paired frames; the spread goes 160 -> 164 px. It is a zoom: no tilt is applied while the classification is ambiguous.
{
  const A0 = { x: 185.191, y: 221.383 }, B0 = { x: 214.809, y: 378.617 }
  const frames: Array<[P, P]> = []
  for (let i = 0; i <= 30; i++) {
    const u = i / 30
    frames.push([{ x: A0.x - 8.5 * u, y: A0.y + 60 * u }, { x: B0.x + 8.5 * u, y: B0.y + 60 * u }])
  }
  const r = replay(frames)
  assert.ok(Math.abs(r.tilt) < 2, `the drifting vertical pinch tilts under 2 px (${r.tilt})`)
  assert.ok(r.zoom < 1 && Math.abs(Math.log(r.zoom / r.spreadRatio)) < 0.01, `and it zooms (${r.zoom})`)
}

// Review: a confirmed tilt is applied at once, follows a reversal immediately, and a pause leaves nothing owed.
{
  const st = newTwoFingerState()
  let a = { x: 100, y: 300 }, b = { x: 260, y: 300 }
  const stepBoth = (dy: number): number => {
    const na = { x: a.x, y: a.y + dy }, nb = { x: b.x, y: b.y + dy }
    let t = twoFingerStep(a, b, na, b, st).tilt; a = na
    t += twoFingerStep(a, b, a, nb, st).tilt; b = nb
    return t
  }
  // Owner 2026-10-31 ("zappy"): the travel while pending is not applied in one step; the tilt runs at the fingers' own speed from the start.
  let down = 0
  for (let i = 0; i < 20; i++) {
    const t = stepBoth(3) // 60 px down in all
    assert.ok(t === 0 || Math.abs(t - 3) < 1e-9, `step ${i}: the tilt is the fingers' step or nothing yet (${t} px)`)
    down += t
  }
  assert.ok(down >= 60 - 18 - 1e-9, `all but the start travel arrives (${down})`)
  for (let i = 0; i < 6; i++) {
    const t = stepBoth(-2)
    assert.ok(t <= 1e-9 && Math.abs(t + 2) < 1e-9, `reversal step ${i}: tilt follows the fingers back (${t})`)
  }
  for (let i = 0; i < 20; i++) assert.equal(stepBoth(0), 0, 'a pause tilts nothing and owes nothing')
}
