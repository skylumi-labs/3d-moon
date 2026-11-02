// The tile pump (R44): a settled fetch admits the next queued job without waiting for a drawn frame, and at rest the uploads per frame follow the frame interval.
// Opt-in with `?pump=1`; absent is today (admission only inside update(), 4 uploads a frame at rest); `?uploads=N` pins the at-rest count. Real TileStreamer on a stub GL, as tile-cache.test.mts.
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import * as THREE from 'three'
import { TileStreamer } from '../src/moon/tiles/TileStreamer.ts'
import { encodeHeightPlanes } from '../src/moon/tiles/codec.ts'
import { H_SIZE, tileIndex, tileOf } from '../src/moon/tiles/grid.ts'
import { levelRow } from '../src/moon/tiles/levels.ts'
import { floorDist } from '../src/camera/pose.ts'
import { UPLOADS_AT_REST, UPLOADS_IN_FLIGHT, UPLOADS_AT_REST_MAX, foldRafGap, pumpOf, setPump, mayPump, uploadsThisFrame, type StreamView } from '../src/moon/tiles/wanted.ts'

// ------------------------------------------------------------------------------------------------------------ switch parsing and the upload budget
assert.equal(UPLOADS_AT_REST_MAX, 16)
assert.deepEqual(pumpOf(''), { pump: false, uploads: 0 }, 'off unless asked for')
assert.deepEqual(pumpOf('?pump=0'), { pump: false, uploads: 0 })
assert.deepEqual(pumpOf('?pump=1'), { pump: true, uploads: 0 })
assert.deepEqual(pumpOf('?pump=1&uploads=6'), { pump: true, uploads: 6 })
assert.deepEqual(pumpOf('?uploads=6'), { pump: false, uploads: 6 }, '?uploads=N works without the pump')
assert.equal(pumpOf('?uploads=0').uploads, 0, 'below 1 is ignored')
assert.equal(pumpOf('?uploads=17').uploads, 0, 'above the maximum is ignored')
assert.equal(pumpOf('?uploads=2.5').uploads, 0)
assert.equal(pumpOf('?uploads=abc').uploads, 0)

setPump('')
assert.equal(uploadsThisFrame({ frameMs: 400 }), UPLOADS_AT_REST, 'default (pump off): 4 whatever the frame interval')
setPump('?pump=1')
const rest = (frameMs?: number) => uploadsThisFrame({ frameMs })
assert.equal(rest(16), UPLOADS_AT_REST, 'a 60 Hz frame: exactly today')
assert.equal(rest(33), UPLOADS_AT_REST, 'a 30 Hz frame: still the floor (33/8 rounds to 4)')
assert.equal(rest(100), 13)
assert.equal(rest(400), UPLOADS_AT_REST_MAX, 'capped at 16')
assert.equal(rest(5000), UPLOADS_AT_REST_MAX, 'bounded')
assert.equal(rest(undefined), UPLOADS_AT_REST, 'no interval: today')
assert.equal(rest(NaN), UPLOADS_AT_REST)
assert.equal(uploadsThisFrame({ moving: true, frameMs: 400 }), 1, 'a moving gesture: one upload whatever the frame interval')
assert.equal(uploadsThisFrame({ flight: true, frameMs: 400 }), UPLOADS_IN_FLIGHT, 'a flight: unchanged')
setPump('?pump=1&uploads=6'); assert.equal(rest(400), 6); assert.equal(uploadsThisFrame({ moving: true, frameMs: 400 }), 1)
setPump('?uploads=6'); assert.equal(rest(16), 6, 'pump off, uploads pinned')
setPump('?pump=0&uploads=4')
for (const ms of [undefined, 16, 100, 400]) assert.equal(rest(ms), UPLOADS_AT_REST, `pump off: today's 4 at ${ms} ms`)
assert.equal(uploadsThisFrame({ moving: true, frameMs: 400 }), 1)
assert.equal(uploadsThisFrame({ flight: true, frameMs: 400 }), UPLOADS_IN_FLIGHT)
setPump('?pump=0'); assert.equal(rest(400), UPLOADS_AT_REST)

// The frame-cost signal is the rAF gap, fed on every tick: an idle 300 ms between draws on a 60 Hz rAF is eighteen 16.7 ms ticks, so it still uploads 4.
{
  setPump('?pump=1')
  let smoothed = 16
  for (let t = 0; t < 300; t += 1000 / 60) smoothed = foldRafGap(smoothed, 1000 / 60)
  assert.equal(uploadsThisFrame({ frameMs: smoothed }), UPLOADS_AT_REST, 'idle gap between draws on a 60 Hz rAF: 4 uploads')
  // A genuinely slow rAF (400 ms ticks) does scale up; a hidden-tab stall (> 1 s) is ignored.
  let slow = 16
  for (let i = 0; i < 20; i++) slow = foldRafGap(slow, 400)
  assert.ok(uploadsThisFrame({ frameMs: slow }) > UPLOADS_AT_REST)
  assert.equal(foldRafGap(16, 5000), 16)
  assert.equal(foldRafGap(16, 0), 16)
  assert.equal(foldRafGap(16, -3), 16)
}
setPump('?pump=1')
assert.equal(mayPump(null), false, 'no view yet: nothing to admit against')
assert.equal(mayPump({}), true)
assert.equal(mayPump({ flightReuse: false }), false, 'a frame-stepped capture admits on the frame only')
setPump(''); assert.equal(mayPump({}), false, 'default off'); setPump('')

// ---------------------------------------------------------------------------------------------------------------- a real TileStreamer on a stub GL
const glTarget: Record<string, unknown> = { createTexture: () => ({}), getExtension: () => null, getParameter: () => 1024, texSubImage3D: () => {} }
const gl = new Proxy(glTarget, { get: (t, k) => (k in t ? t[k as string] : typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) ? k.length : () => undefined) }) as unknown as WebGL2RenderingContext
const renderer = { getContext: () => gl, state: { bindTexture() {}, unbindTexture() {}, pixelStorei() {} } } as unknown as THREE.WebGLRenderer

const TX0 = tileOf(-3, 23.47, 0.67).tx, TY0 = tileOf(-3, 23.47, 0.67).ty
const block = new Set<number>()
for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) block.add(tileIndex(-3, TX0 + i, TY0 + j))
const man = {
  version: 1, tileDeg: 5, levels: 3,
  height: { px: 320, border: 1, stepM: 8, ppd: 64, texelKm: 0.4738 }, color: { px: 380, border: 1, ppd: 76, texelKm: 0.399 },
  present: ['0'.repeat(2592), '0'.repeat(648), '0'.repeat(162)],
  minQ: [[], [], []], maxQ: [[], [], []], source: 'test',
  deeper: [{ level: -3, tileDeg: 0.625, ppd: 512, texelKm: 0.0592, stepM: 1, present: Array.from({ length: 576 * 288 }, (_, i) => (block.has(i) ? '1' : '0')).join('') }],
}
const body = zlib.gzipSync(Buffer.from(encodeHeightPlanes(Int32Array.from({ length: H_SIZE * H_SIZE }, () => 5000))))
let hold: Array<() => void> = []
let holding = false
globalThis.fetch = (async (url: string) => {
  if (!/h\/-3\/(\d+)_(\d+)\.bin\.gz$/.test(String(url))) return { ok: false, status: 404 }
  if (holding) await new Promise<void>((r) => hold.push(r))
  return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) }
}) as unknown as typeof fetch
const Ctor = TileStreamer as unknown as new (r: THREE.WebGLRenderer, base: string, m: unknown, colourCap: number, heightCap: number) => TileStreamer

function viewOver(dist: number, lon: number, lat: number): StreamView {
  const d = Math.PI / 180, tanShortHalf = Math.tan(15 * d), asp = 390 / 844
  const dir = new THREE.Vector3(Math.cos(lat * d) * Math.cos(lon * d), Math.cos(lat * d) * Math.sin(lon * d), Math.sin(lat * d))
  const nadir = dir.clone().negate()
  const right = new THREE.Vector3().crossVectors(nadir, new THREE.Vector3(0, 0, 1)).normalize()
  const up = new THREE.Vector3().crossVectors(right, nadir).normalize()
  return { pos: dir.clone().multiplyScalar(dist), right, up, back: nadir.clone().negate(), tanHalf: tanShortHalf / asp, aspect: asp, tanPerPx: 2 * tanShortHalf / (390 * 3),
    moonX: new THREE.Vector3(1, 0, 0), moonY: new THREE.Vector3(0, 1, 0), moonZ: new THREE.Vector3(0, 0, 1) }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Uploads: 140 decoded tiles waiting, frames 400 ms apart (the measured loaded-device case).
async function uploadFrames(search: string, view: Partial<StreamView>, frames: number): Promise<number> {
  setPump(search)
  const t = new Ctor(renderer, '/t/', man, 2, 150)
  const ti = t as unknown as { wanted: () => Map<number, unknown>; ready: unknown[] }
  const none = new Map<number, unknown>()
  ti.wanted = () => none
  const pageW = t.pageW
  for (let k = 0; k < 140; k++) {
    // 140 distinct keys: nine rows of nine at -3, then the same grid shifted east for the rest.
    const x = TX0 - 4 + (k % 9) + 9 * Math.floor(k / 81), ty = TY0 - 4 + (Math.floor(k / 9) % 9), key = (levelRow(-3) + ty) * pageW + x
    ti.ready.push({ job: { key, level: -3, tx: x, ty, lastWanted: 0 }, heights: new Float32Array(H_SIZE * H_SIZE), mid: 0, relief: new Float32Array(1), color: [] })
  }
  const v = { ...viewOver(1.2, 23.47, 0.67), ...view }
  let now = 1000
  for (let f = 0; f < frames; f++) t.update(v, now += 400)
  const n = t.resident
  t.dispose(true)
  return n
}
assert.equal(await uploadFrames('?pump=1', { frameMs: 400 }, 9), 140, 'pump on, 400 ms frames: 140 ready tiles are up within 9 frames (16 a frame)')
assert.equal(await uploadFrames('?pump=1', { frameMs: 400 }, 5), 5 * UPLOADS_AT_REST_MAX, 'pump on: 16 a frame, no more')
assert.equal(await uploadFrames('', { frameMs: 400 }, 5), 5 * UPLOADS_AT_REST, 'default: today, 4 a frame')
assert.equal(await uploadFrames('?pump=1', { frameMs: 16 }, 5), 5 * UPLOADS_AT_REST, 'pump on at 60 Hz: unchanged from today')
assert.equal(await uploadFrames('?pump=1', { frameMs: 400, moving: true }, 5), 5, 'the gesture path: exactly one upload per moving frame')
assert.equal(await uploadFrames('', { frameMs: 400, moving: true }, 5), 5, 'the gesture path with the pump off: the same')
assert.equal(await uploadFrames('?pump=1', { frameMs: 400, flight: true }, 5), 5 * UPLOADS_IN_FLIGHT, 'a flight: unchanged')

// Admission: one update() queues more tiles than the in-flight cap; the rest must start as fetches settle, with no further update().
async function admitted(search: string, view: Partial<StreamView>): Promise<{ requested: number; wantedAtLeast: number }> {
  setPump(search)
  const t = new Ctor(renderer, '/t/', man, 48, 127)
  const v = { ...viewOver(floorDist(0.0592, 1170, 30), 23.47, 0.67), ...view }
  holding = true; hold = []
  t.update(v, 1000)
  const first = t.stats.requested
  assert.ok(first > 0, 'the first update starts fetches')
  holding = false
  for (const r of hold) r()
  hold = []
  // No more update() calls: only settled jobs can start the next ones.
  for (let i = 0; i < 200 && t.inflight > 0; i++) await sleep(2)
  await sleep(20)
  const out = { requested: t.stats.requested, wantedAtLeast: first }
  t.dispose(true)
  return out
}
const on = await admitted('?pump=1', {})
assert.ok(on.requested > on.wantedAtLeast, `pump on: queued tiles start as jobs settle (${on.wantedAtLeast} -> ${on.requested}) with no further frame`)
const off = await admitted('', {})
assert.equal(off.requested, off.wantedAtLeast, `pump off: nothing starts until the next update() (${off.requested})`)
const cap = await admitted('?pump=1', { flightReuse: false })
assert.equal(cap.requested, cap.wantedAtLeast, 'a frame-stepped capture never admits outside update()')
setPump('')
console.log('tile-pump: ok')
