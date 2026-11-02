/** R7: a flight stops on a finite deceleration, not the quintic's (time left)^2 creep (flights.ts flightEase). */
import assert from 'node:assert/strict'
import { FLIGHT_END_BRAKE, flightEase, getCinematicFlight, sampleCinematicFlight } from '../src/cinematics/flights.ts'
import { cameraPosition } from '../src/journey/path.ts'
import { joinLead } from '../src/journey/join.ts'
import { ephemerisAt } from '../src/ephemeris.ts'

// The flight ease: ends exact, monotone, starts like the quintic (the join's lead-in assumes it), stops on a finite deceleration.
{
  assert.equal(flightEase(0), 0); assert.ok(Math.abs(flightEase(1) - 1) < 1e-15)
  let prev = -1
  for (let i = 0; i <= 20000; i++) { const k = flightEase(i / 20000); assert.ok(k >= prev - 1e-15, `monotone at ${i / 20000}`); prev = k }
  const q = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)
  for (const u of [0.01, 0.1, 0.3, 0.5]) assert.ok(Math.abs(flightEase(u) - q(u)) <= 0.01 * q(u), `start shape kept at u=${u}`)
  const h = 1e-4, acc = (flightEase(1) - 2 * flightEase(1 - h) + flightEase(1 - 2 * h)) / (h * h)
  assert.ok(Math.abs(acc + FLIGHT_END_BRAKE) < 0.01, `stops on a finite deceleration (${acc.toFixed(3)})`)
  assert.ok((flightEase(1) - flightEase(1 - h)) / h < 1e-3, 'ends at rest')
}

// R7 (rig 2026-10-21): no position step in the last 0.5 s of a flight above 3x the median of the moving steps (60 fps, the rig's window
// [end - 0.5 s, end + 0.3 s] and moving cutoff 1e-8 radii). The quintic's tau^2 creep failed this with a perfectly smooth path (3.2x).
{
  const e = ephemerisAt(new Date('2026-10-20T19:00:00Z'))
  const med = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }
  for (const id of ['terminator-run', 'apollo8-earthrise', 'tycho-rim', 'copernicus-flyover']) {
    const f = getCinematicFlight(id)!
    for (const lag of [0, 0.05]) {
      const P: Array<ReturnType<typeof cameraPosition>> = []
      for (let t = f.seconds - 0.5 + lag; t <= f.seconds + 0.3 + lag; t += 1 / 60) P.push(cameraPosition(e, sampleCinematicFlight(f, Math.min(1, t / f.seconds), e, () => 1.0005, () => 0).pose))
      const d = P.slice(1).map((p, i) => p.distanceTo(P[i]))
      const moving = d.filter((x) => x > 1e-8)
      assert.ok(moving.length >= 4, `${id}: moving in the window`)
      const r = Math.max(...d) / med(moving)
      assert.ok(r < 2.6, `${id} (lag ${lag}): last-0.5 s step ratio ${r.toFixed(2)} (rig fails at 3)`)
    }
  }
}
// With the join's lead-in on top, total progress stays monotone for every flight length.
for (const seconds of [19, 30, 36, 70]) {
  let prev = -1
  for (let i = 0; i <= 4000; i++) { const u = i / 4000, k = flightEase(u) + joinLead(u, 1, seconds); assert.ok(k >= prev - 1e-12, `${seconds} s: monotone at u=${u}`); prev = k }
}
console.log('flight-end.test ok')
