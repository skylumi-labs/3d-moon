/**
 * Relief-aware exposure (src/moon/tiles/relief.ts, src/post/exposure.ts):
 *   MOON_TILES_DIR=.tiles npx tsx scripts/relief.test.mts
 */
import { reportSkip } from './test-skip.mts'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { Vector3 } from 'three'
import { decodeHeightPlanes } from '../src/moon/tiles/codec.ts'
import { H_PX, H_SIZE, H_STEP_M, MOON_R_KM, heightPath, tileOf } from '../src/moon/tiles/grid.ts'
import { RELIEF_BINS, RELIEF_CELLS, RELIEF_RATIO_CAP, RELIEF_TILT_CAP_DEG, ReliefStore, buildRelief, reliefMu0, type ReliefField } from '../src/moon/tiles/relief.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { poseBasis } from '../src/camera/pose.ts'
import { searchFrame } from '../src/post/exposure.ts'

const DEG = Math.PI / 180
const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)

// 1. A plane that falls toward the east at 20 deg: the steepest slope facing east is tan 20, facing west is its negative, north 0.
{
  const dy = (Math.PI * MOON_R_KM / 180) * (5 / H_PX) * 1000   // metres per texel, level 0
  const lat = 0, ty = 17.5 // centre row of the tile band at the equator: lat = 90 - (ty + 0.5) * 5
  assert.equal(90 - (Math.floor(ty) + 0.5) * 5, 2.5)
  const h = new Float32Array(H_SIZE * H_SIZE)
  const dx = dy * Math.cos((2.5 * DEG))
  for (let j = 0; j < H_SIZE; j++) for (let i = 0; i < H_SIZE; i++) h[j * H_SIZE + i] = -Math.tan(20 * DEG) * i * dx
  const r = buildRelief(h, 0, 17)
  const cell = (b: number) => r[(5 * RELIEF_CELLS + 5) * RELIEF_BINS + b]
  near(cell(0), Math.tan(20 * DEG), 1e-3, 'facing east')
  near(cell(RELIEF_BINS / 2), -Math.tan(20 * DEG), 1e-3, 'facing west')
  near(cell(RELIEF_BINS / 4), 0, 1e-3, 'facing north')
  // Through the store: an interpolated azimuth between east and north-east lies between their values.
  const store = new ReliefStore()
  const t = tileOf(0, 2, 2.5)
  store.add(0, t.tx, t.ty, r)
  assert.equal(store.size, 1)
  near(store.facingTan(2, 2.5, 0)!, Math.tan(20 * DEG), 1e-3, 'store east')
  const mid = store.facingTan(2, 2.5, Math.PI / 8)!
  assert.ok(mid < Math.tan(20 * DEG) && mid > 0, `interpolated ${mid}`)
  assert.equal(store.facingTan(120, 60, 0), null, 'no tile, no answer')
  store.remove(0, t.tx, t.ty)
  assert.equal(store.facingTan(2, 2.5, 0), null)
  void lat
}

// 2. The brightening: a 20 deg slope under a 10 deg Sun is 2.9x flat ground (DESIGN-M2.md section 7).
{
  const mu = Math.sin(10 * DEG)
  near(reliefMu0(mu, Math.tan(20 * DEG)) / mu, Math.sin(30 * DEG) / Math.sin(10 * DEG), 1e-9, '2.9x')
  near(Math.sin(30 * DEG) / Math.sin(10 * DEG), 2.88, 0.01, 'the design number')
  // Capped: a 60 deg wall counts as the cap, so one steep face does not set the white point.
  near(reliefMu0(mu, Math.tan(60 * DEG)), Math.sin((10 + RELIEF_TILT_CAP_DEG) * DEG), 1e-9, 'cap')
  // Slopes facing away, flat ground and unlit ground keep their value.
  assert.equal(reliefMu0(mu, -0.3), mu)
  assert.equal(reliefMu0(mu, 0), mu)
  assert.equal(reliefMu0(-0.1, 0.5), -0.1)
  assert.ok(reliefMu0(0.98, Math.tan(30 * DEG)) <= 1)
  // The ratio is capped too: capping only the tilt left sin(e + 20 deg) / sin(e) = 7.5x at a 3 deg Sun, which sets the white
  // point for a rim a few pixels wide and darkens the rest of the frame.
  for (const e of [1, 2, 3, 4, 5, 8, 10, 15, 30]) {
    const m = Math.sin(e * DEG)
    const ratio = reliefMu0(m, Math.tan(60 * DEG)) / m
    assert.ok(ratio <= RELIEF_RATIO_CAP + 1e-9, `Sun ${e} deg: lift ${ratio}`)
  }
  near(reliefMu0(Math.sin(3 * DEG), Math.tan(60 * DEG)) / Math.sin(3 * DEG), RELIEF_RATIO_CAP, 1e-9, 'at 3 deg the cap binds (7.5x uncapped)')
}

// 3. The search: with a field that says "20 deg toward any Sun", the floor view's white point rises by about the
// design's factor; with no field, or a field with no tile, it is what it was; far views are not touched.
{
  const e = ephemerisAt(new Date('2026-10-20T22:34:00Z'))   // Sun ~10 deg over Copernicus
  const view = (dist: number, tanHalf = Math.tan(15 * DEG)) => {
    const b = poseBasis(e, { lon: -20.08, lat: 9.62, dist, roll: 0 })
    return { pos: b.back.clone().multiplyScalar(dist), right: b.right, up: b.up, back: b.back, tanHalf }
  }
  const twenty: ReliefField = { facingTan: () => Math.tan(20 * DEG) }
  const none: ReliefField = { facingTan: () => null }
  const floor = view(1.5), far = view(5)
  const canvasHeight = 720
  const base = searchFrame(floor, 16 / 9, e, null, 180)
  const lifted = searchFrame(floor, 16 / 9, e, null, 180, { field: twenty, canvasHeight })
  const nofield = searchFrame(floor, 16 / 9, e, null, 180, { field: none, canvasHeight })
  assert.deepEqual(nofield, base, 'no tile under the probe: unchanged')
  // The whole 30 deg frame spans Sun elevations of about 0 to 20 deg, and its brightest flat ground is the high-Sun side, where a tilt adds less.
  const wide = lifted.bestA / base.bestA
  assert.ok(wide > 1.4 && wide < 3.0, `wide frame: white point rises ${wide.toFixed(2)}x`)
  // A narrow view over the Sun-10 ground: the design's factor, tempered by the viewer term of lunar-Lambert (~2.5, not 2.9).
  const nv = view(1.5, 0.01)
  const nBase = searchFrame(nv, 16 / 9, e, null, 180)
  const nLift = searchFrame(nv, 16 / 9, e, null, 180, { field: twenty, canvasHeight })
  const ratio = nLift.bestA / nBase.bestA
  assert.ok(ratio > 2.1 && ratio < 3.0, `narrow floor view: white point rises ${ratio.toFixed(2)}x (design: 2.9x for the Sun term alone)`)
  console.log(`  floor view at Copernicus, Sun ~10 deg: white point x${ratio.toFixed(2)} narrow, x${wide.toFixed(2)} for the whole 30 deg frame`)
  const farBase = searchFrame(far, 16 / 9, e, null, 180)
  const farLift = searchFrame(far, 16 / 9, e, null, 180, { field: twenty, canvasHeight })
  assert.deepEqual(farLift, farBase, 'a view where the 4k map already covers a pixel exposes exactly as before')
  void Vector3
}

// 4. Real tiles: a real crater wall faces a low Sun steeply, and the field reads it.
const dir = process.env.MOON_TILES_DIR
if (dir && fs.existsSync(path.join(dir, 'manifest.json'))) {
  const { tx, ty } = tileOf(0, -20.08, 9.62)
  const q = decodeHeightPlanes(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(dir, heightPath(0, tx, ty))))))
  const h = new Float32Array(q.length)
  for (let i = 0; i < q.length; i++) h[i] = q[i] * H_STEP_M
  const r = buildRelief(h, 0, ty)
  let best = 0
  for (let c = 0; c < RELIEF_CELLS * RELIEF_CELLS; c++) for (let b = 0; b < RELIEF_BINS; b++) best = Math.max(best, r[c * RELIEF_BINS + b])
  console.log(`  Copernicus tile: steepest sun-facing slope over the tile ${(Math.atan(best) / DEG).toFixed(1)} deg`)
  assert.ok(best > Math.tan(15 * DEG) && best < Math.tan(80 * DEG), 'a crater tile has steep walls, none absurd')
  console.log('relief.test: real-tile check ran')
} else reportSkip('relief.test', 'data', 'MOON_TILES_DIR not set, the real-tile relief check did NOT run')
