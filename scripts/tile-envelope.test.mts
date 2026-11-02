import assert from 'node:assert/strict'
import { GH_AA_MAX_DEG, GH_R_KM, TENV_DEFAULT, TENV_POINTS_5, TENV_STOP_DEG, TENV_N, envEncode, ghCertDeg, tenvBound, tenvBuildCpu, tenvCellSectors, tenvConfig, tenvHorizonDeg, tenvOn, sectorMaxima, sectorOfAzimuth, ENV_SECTORS, envTexelSectors, ghBuildPyramid, ghDir, ghTangent, ghUv, envDecode, type TenvConfig, type TenvHeightFn } from '../src/moon/globalHorizon.ts'

// ---- A synthetic ground (craters with rims, hills, small bumps) around lon 10, lat 20, the size of a level-0 tile (5 deg), as a height function of a body-frame direction.
const RAD = Math.PI / 180
let seed = 12345
const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
const LON0 = 10, LAT0 = 20, SPAN = 5
const craters = Array.from({ length: 60 }, () => ({ x: (rnd() - 0.5) * 420, y: (rnd() - 0.5) * 420, r: 0.4 + rnd() ** 3 * 9, rim: 0.03 + rnd() * 0.05 }))
const hills = Array.from({ length: 10 }, () => ({ x: (rnd() - 0.5) * 500, y: (rnd() - 0.5) * 500, r: 15 + rnd() * 50, h: 300 + rnd() * 1500 }))
const hf: TenvHeightFn = (dir) => {
  const [u, v] = ghUv(dir as [number, number, number])
  const lon = u * 360 - 180, lat = 90 - v * 180
  const x = GH_R_KM * Math.cos(LAT0 * RAD) * (lon - LON0) * RAD, y = GH_R_KM * (lat - LAT0) * RAD
  let h = 0
  for (const c of craters) {
    const d = Math.hypot(x - c.x, y - c.y) / c.r
    if (d < 1) h -= 1000 * c.r * 0.2 * (1 - d * d)
    h += 1000 * c.r * c.rim * Math.exp(-(((d - 1) / 0.18) ** 2))
  }
  for (const k of hills) h += k.h * Math.exp(-(((x - k.x) ** 2 + (y - k.y) ** 2) / (k.r * k.r)))
  return h + 12 * Math.sin(x * 9.1) * Math.cos(y * 7.3)
}
const dirAt = (fx: number, fy: number): [number, number, number] => ghDir((LON0 - 2.5 + 180 + fx * SPAN) / 360, (90 - (LAT0 + 2.5) + fy * SPAN) / 180)

// ---- The conservative-bound property: a pixel's live tile-march horizon, in any azimuth, at any point of a cell, is at or below that cell's bound (a skyline above TENV_STOP_DEG is
// "no bound" and marches live). Measured at the real cell size (N = 80 over a level-0 tile: 1.9 km) on a window of cells, against the CPU twin of the tile march.
const N = TENV_N.desktop, WIN = 8, I0 = 36, J0 = 36
function measure(cfg: TenvConfig, samples: number): { violations: number; worstExcess: number; slack: number; slackAllAz: number } {
  const cells = new Map<number, number[]>()
  for (let j = J0; j < J0 + WIN; j++) for (let i = I0; i < I0 + WIN; i++) cells.set(j * N + i, tenvCellSectors(hf, dirAt, N, i, j, cfg))
  let violations = 0, worstExcess = 0, slack = 0, slackAll = 0, bounded = 0
  for (let k = 0; k < samples; k++) {
    const fx = (I0 + WIN * rnd()) / N, fy = (J0 + WIN * rnd()) / N
    const p = dirAt(fx, fy)
    const az = rnd() * 2 * Math.PI
    const live = tenvHorizonDeg(hf, p, ghTangent(p, az))
    const v = cells.get(Math.floor(fy * N) * N + Math.floor(fx * N))!
    const sv = v[sectorOfAzimuth(az)]
    if (sv - cfg.margin > TENV_STOP_DEG) continue
    const b = envDecode(envEncode(sv))
    bounded++
    slackAll += envDecode(envEncode(Math.max(...v))) - live
    if (live > b) { violations++; worstExcess = Math.max(worstExcess, live - b) } else slack += b - live
  }
  return { violations, worstExcess, slack: bounded > violations ? slack / (bounded - violations) : 0, slackAllAz: bounded ? slackAll / bounded : 0 }
}
{
  const def = measure(TENV_DEFAULT, 1500)
  const sparse = measure({ az: 8, points: TENV_POINTS_5, margin: 0.5 }, 1500)
  console.log('tile envelope default (24 az, 9 points, 2.5 deg, 8 sectors):', JSON.stringify(def), ' the 4k envelope scheme (8 az, 0.5 deg):', JSON.stringify(sparse))
  assert.ok(def.violations <= 0.003 * 1500 && def.worstExcess < 0.5, `almost no live horizon exceeds its cell's sector bound (${def.violations} of 1500, worst excess ${def.worstExcess.toFixed(2)} deg)`)
  assert.ok(def.slack < 12, `and the bound is not vacuous: mean slack ${def.slack.toFixed(1)} deg`)
  assert.ok(def.slack < def.slackAllAz, `the sector bound is tighter than the max over every azimuth (${def.slack.toFixed(1)} against ${def.slackAllAz.toFixed(1)} deg mean slack)`)
  assert.ok(sparse.violations >= def.violations, 'the sparser scheme is never less often wrong')
  assert.ok(def.worstExcess < ghCertDeg(1) - GH_AA_MAX_DEG, 'a remaining excess is smaller than the certificate less the lit ramp')
}
// ---- Sectors: each takes the samples within the pad of its edges.
{
  const per = Array.from({ length: 24 }, (_, i) => (i === 3 ? 20 : 0))   // one peak at 45 deg (sector 1's lower edge)
  const sm = sectorMaxima(per)
  assert.equal(sm.length, ENV_SECTORS)
  assert.equal(sm[0], 20, 'a sample on the edge counts for both sectors it touches')
  assert.equal(sm[1], 20)
  assert.equal(sm[3], 0)
  assert.equal(sectorOfAzimuth(0), 0); assert.equal(sectorOfAzimuth(Math.PI / 4 + 1e-6), 1); assert.equal(sectorOfAzimuth(2 * Math.PI - 1e-6), 7); assert.equal(sectorOfAzimuth(-1e-6), 7)
  // a peak at 90 deg reaches sector 0 (edge 45, pad 11.25 -> up to 56.25 only): no
  const per2 = Array.from({ length: 24 }, (_, i) => (i === 6 ? 20 : 0))
  assert.equal(sectorMaxima(per2)[0], 0)
  assert.equal(sectorMaxima(per2)[1], 20); assert.equal(sectorMaxima(per2)[2], 20)
}

// ---- Bounds compose as horizonAt mixes: w = 0 the 4k bound, w = 1 the tile bound, between their mix, null when a needed part is missing.
{
  assert.equal(tenvBound(0, 4, null), 4)
  assert.equal(tenvBound(0, null, 9), null)
  assert.equal(tenvBound(1, null, 9), 9)
  assert.equal(tenvBound(1, 4, null), null)
  assert.equal(tenvBound(0.5, 4, 8), 6)
  assert.equal(tenvBound(0.5, null, 8), null)
  assert.equal(tenvBound(0.25, 4, null), null)
}
// ---- A skyline above the stop elevation is stored as "no bound".
{
  const steep: TenvHeightFn = (dir) => { const [u] = ghUv(dir as [number, number, number]); return u * 360 - 180 > LON0 ? 9000 : 0 }
  const codes = tenvBuildCpu(steep, dirAt, 8, { az: 8, points: TENV_POINTS_5, margin: 0.5 })
  assert.ok(codes.some((c) => c === 255), 'a cell beside a wall steeper than ' + TENV_STOP_DEG + ' deg is unbounded')
  assert.ok(codes.some((c) => c > 0 && c < 255 && envDecode(c) < TENV_STOP_DEG), 'and flat cells keep a bound')
}
// ---- The 4k envelope's sectored twin: a flat map has a low bound in every sector.
{
  const flat = ghBuildPyramid(new Float32Array(64 * 32), 64, 32)
  const sec = envTexelSectors(flat, 64, 32, 10, 16)
  assert.equal(sec.length, ENV_SECTORS)
  assert.ok(sec.every((v) => v < 2), 'flat ground: every sector bound is near the margin')
}
// ---- Switches.
assert.equal(tenvOn(''), true)
assert.equal(tenvOn('?tenv=0'), false)
assert.deepEqual(tenvConfig(''), TENV_DEFAULT)
assert.equal(tenvConfig('?tenvaz=8&tenvpts=5&tenvmargin=0.5').az, 8)
assert.equal(tenvConfig('?tenvaz=8&tenvpts=5&tenvmargin=0.5').points.length, 5)
assert.equal(tenvConfig('?tenvmargin=0').margin, 0)
assert.equal(tenvConfig('?tenvaz=2').az, TENV_DEFAULT.az, 'an out-of-range azimuth count falls back')
assert.ok(TENV_N.desktop > TENV_N.low)
console.log('tile envelope (bound property) passed')
