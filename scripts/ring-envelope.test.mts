import assert from 'node:assert/strict'
import { ENV_SLACK_DEG, quantizedField, REFINE_MIN_KM, deepNearDistances, liveHorizonRefinedDeg, sampleDeg, ENV_HALF, ENV_STEP_COARSE, ENV_UNBOUNDED, codeOfDeg, degOfCode, axisCandidates, bilinearField, footprintEnvelope, liveHorizonDeg, marchDistances, packBounds, toHalf, unpackBounds, type RingMarch } from '../src/moon/ringEnvelope.ts'

// Deterministic generator.
let seed = 12345
const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }

const W = 96
function terrain(kind: number): Float64Array {
  const g = new Float64Array(W * W)
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) g[j * W + i] = 40 * Math.sin(i / 7) * Math.cos(j / 9) + (rnd() - 0.5) * 20
  if (kind >= 1) for (let n = 0; n < 40; n++) g[Math.floor(rnd() * W) * W + Math.floor(rnd() * W)] += 80 + rnd() * 400 // lone one-texel spikes (narrower than a texel's cell)
  if (kind >= 2) for (let n = 0; n < 6; n++) { const j = Math.floor(rnd() * W); const i0 = Math.floor(rnd() * W); for (let i = i0; i < Math.min(W, i0 + 20); i++) g[j * W + i] += 150 } // thin ridges
  return g
}

// Level-2 texel (1.9 km): the first ~8 linear samples fall inside the origin's own cells, the tail samples reach 300 km (160 texels).
const texelKm = 1.9, rKm = 1737.4
const dKm = marchDistances()

// q at 10.3: the centre line 10 is at -0.3, the next at +0.7 (out of the cell).
assert.deepEqual(axisCandidates(10.3, 1).map((v) => Math.round(v * 1e6) / 1e6), [-0.5, -0.3, 0, 0.5])
// q on a centre line: the crossing is delta 0, already a candidate.
assert.deepEqual(axisCandidates(7, 1), [-0.5, 0, 0.5])
// A longitude scale above 1 widens the cell on q's lattice: two crossings can fall inside.
const wide = axisCandidates(10.5, 1.2).map((v) => Math.round(v * 1e6) / 1e6)
assert.deepEqual(wide, [-0.5, -0.416667, 0, 0.416667, 0.5], 'two crossings inside a widened cell')

let noSlackViolations = 0, latticeViolations = 0, violations = 0, trials = 0, tight = 0, bilinearMisses = 0, spreadMisses = 0
const gaps: number[] = []
for (let kind = 0; kind < 3; kind++) {
  for (let rep = 0; rep < 12; rep++) {
    const tg = terrain(kind)
    const f = quantizedField(tg, W, W)
    const phi = rnd() * 2 * Math.PI
    // far samples leave the 96-texel grid (clamped heights): keep the origin centred and the direction random; the clamp is part of the field.
    const m: RingMarch = { texelKm, ux: Math.cos(phi), uy: Math.sin(phi), dKm, rKm }
    for (let t = 0; t < 6; t++) {
      const px = 20 + Math.floor(rnd() * (W - 40)), py = 20 + Math.floor(rnd() * (W - 40))
      const e = footprintEnvelope(f, px, py, m)
      assert.ok(e.hi >= e.point - 1e-9 && e.lo <= e.point + 1e-9, 'the centre lies between its own bounds')
      assert.equal(e.hi, e.hiMain, 'no refinement pad on the plain set')
      gaps.push(e.hi - e.lo)
      const el = footprintEnvelope(f, px, py, m, true)
      const en = footprintEnvelope(f, px, py, m, false, [], false)
      const probe = (dx: number, dy: number): void => {
        const live = liveHorizonDeg(f, px, py, m, dx, dy)
        trials++
        if (live > en.hi + 1e-9 || live < en.lo - 1e-9) noSlackViolations++
        if (live > el.hi + 1e-9 || live < el.lo - 1e-9) latticeViolations++
        if (live > e.hi + 1e-9 || live < e.lo - 1e-9) violations++
        else if (live > e.hi - 0.2) tight++
      }
      for (let a = -20; a <= 20; a++) for (let b = -20; b <= 20; b++) probe(a / 40, b / 40) // dense lattice, 41 x 41
      for (let n = 0; n < 400; n++) probe((rnd() - 0.5) * ENV_HALF * 2, (rnd() - 0.5) * ENV_HALF * 2)
      // The same cell read the old way: a bilinear mix of the four surrounding texels' centre marches. Count where it is below the live march by more than 2 deg + the four-texel spread.
      const cs: number[] = [], pts: number[] = []
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) cs.push(liveHorizonDeg(f, px + ox, py + oy, m))
      const spread = Math.max(...cs) - Math.min(...cs)
      for (let n = 0; n < 200; n++) {
        const dx = rnd(), dy = rnd()
        const bil = (cs[0] * (1 - dx) + cs[1] * dx) * (1 - dy) + (cs[2] * (1 - dx) + cs[3] * dx) * dy
        const live = liveHorizonDeg(f, px + dx, py + dy, m)
        pts.push(live - bil)
        if (live - bil > 1) bilinearMisses++
        if (live - bil > 2 + spread) spreadMisses++
      }
    }
  }
}
assert.equal(violations, 0, `the footprint envelope holds for every probe (${violations} of ${trials} outside)`)
assert.ok(trials > 100000)
assert.ok(latticeViolations > 0, `a 3 x 3 lattice of marches without the crossings is NOT a bound (${latticeViolations} probes outside): the crossings are needed`)
assert.ok(noSlackViolations > 0, `with the 8-bit filter weights the exact-arithmetic bound is NOT enough (${noSlackViolations} probes outside): the filter margin is needed`)
assert.ok(tight > 0, 'the bound is touched (not vacuous)')
assert.ok(bilinearMisses > 0, `the old bilinear read of the centre marches is off by more than 1 deg on these terrains (${bilinearMisses} reads): the test has teeth`)
gaps.sort((a, b) => a - b)
console.log(`ring envelope: ${trials} probes, 0 outside; gap hi-lo median ${gaps[gaps.length >> 1].toFixed(2)} deg, p90 ${gaps[Math.floor(gaps.length * 0.9)].toFixed(2)}; old read off by >1 deg ${bilinearMisses}, past 2+spread ${spreadMisses}`)

// A single lone spike (one texel high) sitting 0.4 texel from the origin's sample line: the narrow case of the rig outlier.
{
  const g = new Float64Array(W * W)
  const f0 = bilinearField(g, W, W)
  g[48 * W + 53] = 300
  const f = bilinearField(g, W, W)
  const m: RingMarch = { texelKm, ux: 1, uy: 0, dKm: [0.25 * 8 * 5, ...dKm.slice(8)].slice(0, 64), rKm }
  void f0
  const e = footprintEnvelope(f, 48, 48, m)
  let worst = -90
  for (let a = -200; a <= 200; a++) for (let b = -200; b <= 200; b += 20) worst = Math.max(worst, liveHorizonDeg(f, 48, 48, m, a / 400, b / 400))
  assert.ok(worst <= e.hi + 1e-9, `spike: live max ${worst} within hi ${e.hi}`)
}

// Packing: rounded outward, 63 = unbounded, half-float rounding of the stored point.
{
  assert.equal(toHalf(0), 0)
  assert.ok(Math.abs(toHalf(12.3456) - 12.3456) < 0.01)
  for (let n = 0; n < 2000; n++) {
    const point = toHalf((rnd() - 0.3) * 60)
    const hi = point + rnd() * 8, lo = point - rnd() * 8
    const packed = packBounds(point, hi, lo)
    assert.ok(packed < 1024 && Number.isInteger(packed), 'packed value is an integer a half float holds exactly')
    const b = unpackBounds(point, packed)
    assert.ok(b !== null && b.hi >= hi && b.lo <= lo, 'bounds are rounded outward')
    assert.ok(b.hi - hi <= ENV_STEP_COARSE + ENV_SLACK_DEG + 1e-9 && lo - b.lo <= ENV_STEP_COARSE + ENV_SLACK_DEG + 1e-9, 'by at most one step plus the slack')
  }
  assert.equal(unpackBounds(10, packBounds(10, null, 5)), null)
  assert.equal(unpackBounds(10, packBounds(10, 10 + 17, 5)), null, 'too wide: unbounded')
  assert.equal(codeOfDeg(0), 0); assert.equal(codeOfDeg(3), 12); assert.equal(codeOfDeg(3.01), 13); assert.equal(degOfCode(30), 16.5); assert.equal(codeOfDeg(16.6), ENV_UNBOUNDED)
}
console.log('ring-envelope test ok')

// Shader contract: the build pass writes the bounds only for level-2 layers of the plain three-level set, and only when asked.
{
  const { shadowCacheFragment } = await import('../src/moon/moonShader.ts')
  const withEnv = shadowCacheFragment(180, 4096, 0, true)
  assert.ok(withEnv.includes('float ringEnvelopeCode(vec3 p, vec3 t, Tile tp, float hz)') && withEnv.includes('if (uShLevel == 2) code = ringEnvelopeCode(p, normalize(ts), tileAt(uv, 2), hz);'))
  assert.ok(withEnv.includes('fragColor = vec4(hz, code, 0.0, 1.0);'))
  assert.ok(withEnv.includes('float code = ENV_UNB;'), 'every other level, and every texel outside the band, is unbounded')
  const plain = shadowCacheFragment(180, 4096, 0)
  assert.ok(!plain.includes('ringEnvelopeCode') && plain.includes('fragColor = vec4(hz, 0.0, 0.0, 1.0);'), 'without the option the build pass is as before')
  const deepB = shadowCacheFragment(180, 4096, -3, true)
  assert.ok(deepB.includes('const int ENV_N = TM_N + TM_DNEAR;') && deepB.includes('float refPad = 0.40 + 1.50 * max(0.0, hz - mainC * 180.0 / PI);') && deepB.includes('if (k < TM_DNEAR) return TM_DNEAR0'), 'a deeper tile set adds its near samples and the refinement pad')
  assert.ok(withEnv.includes('float eps = 1.00 * 2.0 * max(qHi - qLo, oHi - oLo) / 256.0 / (d * 1000.0);'), 'the filter margin')
  assert.ok(withEnv.includes('const int ENV_N = TM_N;') && withEnv.includes('float refPad = 0.0;'))
  // The GLSL constants are the twin's.
  assert.ok(withEnv.includes('c * 0.25 : 3.00 + (c - 12.0) * 0.75') && withEnv.includes('1e-5'), 'step table')
  assert.ok(withEnv.includes('+ 1.50 + refPad - stored'), 'slack')
}
console.log('ring-envelope shader contract ok')

// The deeper-set variants: six near samples and the crest refinement. Main and near samples are inside the vertex model (proved by the probes above); the refinement's
// extra samples are covered by the pad (REFINE_PAD_*, measured on real ground: scripts/ring-envelope-real.mts when tiles exist), here on synthetic ground.
{
  const near = deepNearDistances()
  let outside = 0, outsideMain = 0, n = 0, worst = -99
  for (let kind = 0; kind < 3; kind++) for (let rep = 0; rep < 10; rep++) {
    const f = quantizedField(terrain(kind), W, W)
    const phi = rnd() * 2 * Math.PI
    const m: RingMarch = { texelKm, ux: Math.cos(phi), uy: Math.sin(phi), dKm, rKm }
    for (let t = 0; t < 5; t++) {
      const px = 20 + Math.floor(rnd() * (W - 40)), py = 20 + Math.floor(rnd() * (W - 40))
      const e = footprintEnvelope(f, px, py, m, false, near)
      assert.ok(e.hi >= e.hiMain && e.hiMain >= e.mainCentre - 1e-9)
      for (let i = 0; i < 160; i++) {
        const dx = rnd() - 0.5, dy = rnd() - 0.5
        const live = liveHorizonRefinedDeg(f, px, py, m, near, dx, dy)
        n++
        worst = Math.max(worst, live - e.hi)
        if (live > e.hi + 1e-9 || live < e.lo - 1e-9) outside++
        const mainLive = Math.max(liveHorizonDeg(f, px, py, m, dx, dy), ...near.map((d) => { const r = d / texelKm; return sampleDeg(f(px + dx + r * m.ux, py + dy + r * m.uy), f(px + dx, py + dy), d, rKm) }))
        if (mainLive > e.hiMain + 1e-9 || mainLive < e.lo - 1e-9) outsideMain++
      }
    }
  }
  assert.equal(outsideMain, 0, 'near and main samples are inside the cell bounds')
  assert.equal(outside, 0, `the refined horizon is inside the padded bounds (${outside} of ${n}; worst ${worst.toFixed(3)} deg over hi)`)
  assert.equal(REFINE_MIN_KM, 0.1)
  const { MARCH_REFINE_MIN_KM } = await import('../src/moon/moonShader.ts')
  assert.equal(REFINE_MIN_KM, MARCH_REFINE_MIN_KM, 'the twin refines from the same distance as the shader')
  console.log(`deep variant: ${n} probes, 0 outside the padded bounds (worst ${worst.toFixed(3)} deg below hi)`)
}
