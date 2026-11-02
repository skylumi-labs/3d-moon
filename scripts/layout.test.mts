/**
 * Subject-aware layout: the Earth-view Moon stays clear of the cards and chip rows at the sizes that matter.
 *   tsx scripts/layout.test.mts
 */
import assert from 'node:assert/strict'
import { EARTH_VIEW_FILL, earthViewCamera } from '../src/camera/pose.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { CLEARANCE, easeFrame, safeRect, subjectFrame, type Occluder, type Rect } from '../src/ui/layout.ts'

const e = ephemerisAt(new Date('2026-10-20T19:00:00Z'))
const R = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom })

/** The Moon's disc on screen, from the real camera: centre and radius in px. */
function disc(vw: number, vh: number, frame?: Parameters<typeof earthViewCamera>[2]) {
  const aspect = vw / vh
  const cam = earthViewCamera(e, aspect, frame)
  const d = cam.pos.clone().negate()
  const z = d.dot(cam.back.clone().negate())
  const x = d.dot(cam.right) / (z * cam.tanHalf * aspect), y = d.dot(cam.up) / (z * cam.tanHalf)
  const cx = (x * 0.5 + 0.5) * vw, cy = (0.5 - y * 0.5) * vh
  // Angular radius -> px radius at the centre (tan of the angular radius over tanHalf, times half the height).
  const tanR = Math.tan(Math.asin(1 / cam.pos.length()))
  return { cx, cy, r: (tanR / cam.tanHalf) * (vh / 2) }
}
const hits = (c: { cx: number; cy: number; r: number }, r: Rect): boolean => {
  const nx = Math.max(r.left, Math.min(c.cx, r.right)), ny = Math.max(r.top, Math.min(c.cy, r.bottom))
  return Math.hypot(c.cx - nx, c.cy - ny) < c.r
}

// 1. The unframed camera reproduces the old fill, and the disc overlaps the 1440x900 left card (the bug).
{
  const d = disc(1440, 900)
  assert.ok(Math.abs(d.r * 2 / 900 - EARTH_VIEW_FILL) < 0.01, `old fill ${d.r * 2 / 900}`)
  assert.ok(hits(d, R(24, 250, 404, 650)), 'without a frame the disc runs under the card')
}

const SIZES: Array<[string, number, number, Occluder[]]> = [
  ['1440x900', 1440, 900, [{ rect: R(24, 250, 404, 650), side: 'left' }, { rect: R(300, 712, 1140, 880), side: 'bottom' }]],
  ['1920x1080', 1920, 1080, [{ rect: R(24, 300, 404, 780), side: 'left' }, { rect: R(400, 890, 1520, 1050), side: 'bottom' }, { rect: R(1516, 400, 1896, 700), side: 'right' }]],
  ['390x844', 390, 844, [{ rect: R(8, 640, 382, 690), side: 'bottom' }, { rect: R(8, 690, 382, 830), side: 'bottom' }, { rect: R(14, 12, 300, 70), side: 'top' }]],
]
for (const [name, vw, vh, occ] of SIZES) {
  const safe = safeRect(vw, vh, occ)
  const frame = subjectFrame(vw, vh, safe, EARTH_VIEW_FILL)
  const d = disc(vw, vh, frame)
  for (const o of occ) assert.ok(!hits(d, o.rect), `${name}: disc clear of ${o.side} occluder (disc ${JSON.stringify(d)})`)
  // The frame puts the centre where asked (the camera maths, not just the arithmetic).
  const cx = (safe.left + safe.right) / 2, cy = (safe.top + safe.bottom) / 2
  assert.ok(Math.abs(d.cx - cx) < 2 && Math.abs(d.cy - cy) < 2, `${name}: centre ${d.cx},${d.cy} vs ${cx},${cy}`)
  assert.ok(d.r * 2 >= Math.min(vw, vh) * 0.3 - 1, `${name}: still a real Moon`)
}

// 2. No occluder: the frame is the old one.
{
  const f = subjectFrame(1440, 900, safeRect(1440, 900, []), EARTH_VIEW_FILL)
  assert.deepEqual([f.nx, f.ny, f.fill], [0, 0, EARTH_VIEW_FILL])
}
// 3. A degenerate stack (bands swallowing the screen) falls back to the full viewport.
{
  const s = safeRect(400, 800, [{ rect: R(0, 0, 390, 780), side: 'left' }])
  assert.deepEqual(s, R(0, 0, 400, 800))
}
// 4. Clearance is kept on every side; empty rects are ignored.
{
  const s = safeRect(1000, 800, [{ rect: R(0, 0, 100, 100), side: 'left' }, { rect: R(0, 0, 0, 0), side: 'bottom' }])
  assert.equal(s.left, 100 + CLEARANCE)
  assert.equal(s.bottom, 800)
}
// 5. Easing converges exactly and never overshoots.
{
  let f = { nx: 0, ny: 0, fill: 0.85 }
  const t = { nx: 0.3, ny: -0.1, fill: 0.6 }
  for (let i = 0; i < 400; i++) { const n = easeFrame(f, t, 1 / 60); assert.ok(n.nx <= t.nx + 1e-9); f = n }
  assert.deepEqual(f, t)
}
console.log('layout.test ok')
