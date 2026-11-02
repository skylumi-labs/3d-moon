/**
 * The centre caption: picker, terrain-aware hit, pause controller, presented-scene publishing and row clearance.
 *   npm test
 */
import assert from 'node:assert/strict'
import { LABELS, type MoonLabel } from '../src/labels/data.ts'
import { classOf, texelRay, fallbackHit, fitScore, labelById, pickCentre, radiusRad, raySphereV, GATE, HYST, MIN_SCORE, type CentreHit, type HeightSource } from '../src/labels/centrePick.ts'
import {
  CentreCaption as LiveCaption, FADE_OUT_MS, MOTION_PICK_MS, RECHECK_MS, hitOfRead, withOcclusion, MIN_SHOW_MS, STILL_MS as LIVE_STILL_MS, MAX_SPAN_KM, ZOOM_FRAC, centreDir, differs, sampleSpanKm,
  type CamSample, type CaptionCtx, type CaptionHost, type ReadResult,
} from '../src/labels/centreCaptionCore.ts'
import { PresentedScene } from '../src/labels/centreScene.ts'
import { MIN_CAPTION_W, RowClearance, naturalWidth, placeCaption, transitionMovesRow, type ClearanceInput, type Rect } from '../src/ui/centreCaptionLayout.ts'
import { unitVector } from '../src/labels/spatial.ts'
import { reliefShare } from '../src/camera/pose.ts'
import { CameraRig } from '../src/camera/rig.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { toMoonSample } from '../src/labels/centreSample.ts'
import { readFileSync } from 'node:fs'
import { VIEWPOINT_FEATURES } from '../src/labels/centreViewpoints.ts'
import { VIEWPOINT_ENTRIES } from '../src/viewpointList.ts'
import { isFlyKey } from '../src/camera/controls.ts'
import { AsyncTexelRead, type ReadGl } from '../src/ground/asyncRead.ts'
import { loadGazetteer } from '../src/labels/gazetteerTable.ts'
import { LockHold, HOLD_MS } from '../src/labels/lockLabelCore.ts'
import { homePose } from '../src/camera/pose.ts'
// The Gazetteer table is a lazy chunk in the app; these checks read it loaded.
await loadGazetteer()
/**
 * The controller's mechanics (reads, retries, fades, retention) were written against a 2 s pause; they run at that pause here (the constructor's `stillMs`).
 * The live pause (LIVE_STILL_MS, 0.5 s + the lock label's 0.3 s hold) has its own tests below ("Owner feedback 2026-10-31").
 */
const STILL_MS = 2000
class CentreCaption extends LiveCaption { constructor(host: CaptionHost) { super(host, { stillMs: STILL_MS }) } }

const RAD = Math.PI / 180
const R_KM = 1737.4
const TAN15 = Math.tan(15 * RAD)
const near = (a: number, b: number, tol: number, msg: string): void => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)
const byName = (n: string): MoonLabel => { const l = LABELS.find((x) => x.name === n); assert.ok(l, n); return l }
const kmToLon = (km: number, latDeg: number): number => km / R_KM / RAD / Math.cos(latDeg * RAD)

/** A camera straight above (lon, lat) whose short-side span is `spanKm`, in Moon coordinates (the shape main publishes). */
function camOver(lon: number, lat: number, spanKm: number, aspect = 1.5): CamSample {
  const tanHalf = aspect >= 1 ? TAN15 : TAN15 / aspect
  const dist = 1 + spanKm / (2 * tanHalf * Math.min(1, aspect) * R_KM)
  const u = unitVector(lat, lon)
  const la = lat * RAD, lo = lon * RAD
  return { pos: [u[0] * dist, u[1] * dist, u[2] * dist], back: [u[0], u[1], u[2]], up: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)], tanHalf, aspect }
}
/** The rendered hit under the middle of a nadir camera: what the hit target holds there. */
function nadirRead(cam: CamSample): ReadResult {
  const dist = Math.hypot(...cam.pos)
  return { kind: 'hit', cam, rangeRadii: dist - 1, w: 1500, h: 1000 }
}
const exact = (l: { lon: number; lat: number }, errKm = 0.01): CentreHit => ({ lonDeg: l.lon, latDeg: l.lat, errKm, fallback: false })

// ---------------------------------------------------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------------------------------------------------
const copernicus = byName('Copernicus'), copA = byName('Copernicus A'), imbrium = byName('Mare Imbrium'), balmer = byName('Balmer')

{
  // Specificity follows the span: the big crater when the small one is not a readable share, the small one when it is.
  const far = pickCentre(exact(copA), 300)
  assert.equal(far.status, 'ok'); assert.equal(far.choice?.label.name, 'Copernicus'); assert.equal(far.choice?.mode, 'contain')
  const close = pickCentre(exact(copA), 40)
  assert.equal(close.choice?.label.name, 'Copernicus A')
  assert.equal(pickCentre(exact(copernicus), 40).choice?.label.name, 'Copernicus')
  // A mare, and the same place where a crater inside it is too small to name.
  assert.equal(pickCentre(exact({ lon: -15, lat: 30 }), 3000).choice?.label.name, 'Mare Imbrium')
  assert.equal(pickCentre(exact(imbrium), 3000).choice?.label.name, 'Mare Imbrium')
  assert.equal(pickCentre(exact({ lon: 68.564, lat: -18.691 }), 800).choice?.label.name, 'Balmer')
  assert.equal(balmer.kind, 'crater')
  // Landing sites are the pins' business, never named here.
  const a11 = LABELS.find((l) => l.kind === 'site')!
  assert.notEqual(pickCentre(exact(a11), 40).choice?.label.kind, 'site')
}

{
  // The index agrees with brute force over a grid at three spans and at feature centres: the highest fit score over EVERY feature (no cone), ties to the
  // smaller feature then the id, nothing below MIN_SCORE. Linear classes are never 'contain'.
  const feats = LABELS.filter((l) => l.kind !== 'site' && l.sizeKm)
  const brute = (hit: CentreHit, span: number): { id: string; mode: string } | null => {
    const u = unitVector(hit.latDeg, hit.lonDeg)
    let best: { l: MoonLabel; ang: number; sc: number } | null = null
    for (const l of feats) {
      if (l.sizeKm! / span < (l.kind === 'mare' ? 0.12 : 0.05)) continue
      const v = unitVector(l.lat, l.lon)
      const ang = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])))
      const sc = fitScore(l as { sizeKm: number }, ang * R_KM, span)
      if (!(sc > 0)) continue
      if (!best || sc > best.sc || (sc === best.sc && (l.sizeKm! < best.l.sizeKm! || (l.sizeKm === best.l.sizeKm && l.id < best.l.id)))) best = { l, ang, sc }
    }
    if (!best || best.sc < MIN_SCORE) return null
    return { id: best.l.id, mode: classOf(best.l) === 'disc' && best.ang <= radiusRad({ sizeKm: best.l.sizeKm! }) ? 'contain' : 'near' }
  }
  const points: Array<{ lon: number; lat: number }> = []
  for (let lon = -180; lon < 180; lon += 7.3) for (let lat = -85; lat <= 85; lat += 6.1) points.push({ lon, lat })
  for (let i = 0; i < feats.length; i += 25) points.push({ lon: feats[i].lon, lat: feats[i].lat })
  let ok = 0, none = 0, nearMode = 0
  let firstNone: { lon: number; lat: number } | null = null
  for (const span of [60, 600, 2200]) {
    for (const p of points) {
      const r = pickCentre(exact(p, 0), span)
      const b = brute(exact(p), span)
      if (r.status === 'uncertain') continue
      if (r.status === 'none') { assert.equal(b, null, `none at ${p.lon},${p.lat} span ${span}`); none++; if (span === 2200 && !firstNone) firstNone = p; continue }
      assert.deepEqual({ id: r.choice!.label.id, mode: r.choice!.mode }, b, `${p.lon},${p.lat} span ${span}`)
      ok++
      if (r.choice!.mode === 'near') nearMode++
      if (classOf(r.choice!.label) !== 'disc') assert.equal(r.choice!.mode, 'near')
    }
  }
  assert.ok(ok > 300 && none > 100 && nearMode > 10, `coverage ${ok}/${none}/${nearMode}`)
  // Highlands with nothing readable at this span: no name.
  assert.ok(firstNone, 'a point with no name exists')
  assert.equal(pickCentre(exact(firstNone!, 0), 2200).status, 'none')
}

{
  // A retained linear feature holds only inside its accept radius (entry x (1 + HYST)).
  const rr = byName('Rupes Recta')
  assert.equal(classOf(rr), 'linear')
  const span = 400
  const accept = 0.03 * span / R_KM * (1 + HYST)
  const at = (km: number): CentreHit => exact({ lon: rr.lon, lat: rr.lat - km / R_KM / RAD })
  assert.equal(pickCentre(at(0.9 * accept * R_KM), span, { id: rr.id, acceptRad: accept }).retainedHolds, true)
  assert.equal(pickCentre(at(1.4 * accept * R_KM), span, { id: rr.id, acceptRad: accept }).retainedHolds, false)
  assert.equal(classOf({ featureType: 'Something new' } as MoonLabel), 'unknown')
  assert.equal(classOf({} as MoonLabel), 'unknown')
}

// ---------------------------------------------------------------------------------------------------------------------
// Terrain: the CPU estimate and its error model
// ---------------------------------------------------------------------------------------------------------------------
const flat = (halfErrorM = 4, pending = false): HeightSource => ({ sampleM: () => 0, pending, halfErrorM })

{
  // The oblique regression: camera 0.046 radii up, 56 deg off nadir, 30 deg lens (span 42.83 km). sigma_h 2 km -> 3.47 km, 5 km -> 8.64 km.
  const dist = 1.046, pitch = 56 * RAD
  const pos: [number, number, number] = [dist, 0, 0]
  const dir: [number, number, number] = [-Math.cos(pitch), Math.sin(pitch), 0]
  near(2 * TAN15 * (dist - 1) * R_KM, 42.83, 0.05, 'regression span')
  const h2 = fallbackHit(pos, dir, flat(2000), 1)
  const h5 = fallbackHit(pos, dir, flat(5000), 1)
  near(h2.errKm, 3.47, 0.05, '2 km at the oblique ray')
  near(h5.errKm, 8.64, 0.1, '5 km at the oblique ray')
  assert.ok(h2.fallback && Number.isFinite(h2.tanElev!))
}

{
  // Integrated: a level-2 style source (10.66 km texels, the decode half-error) over Copernicus A at a steep ray passes the gate; a grazing ray does not.
  const texelKm = 10.66
  const bowl = (lon: number, lat: number): number => {
    const u = unitVector(lat, lon), v = unitVector(copernicus.lat, copernicus.lon)
    const km = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) * R_KM
    // Smooth at the texel scale: a shallow 0.3 km swell over 100 km, the part a 10 km grid can carry.
    return 300 * Math.exp(-((km / 100) ** 2)) + 0 * texelKm
  }
  const src: HeightSource = { sampleM: bowl, pending: false, halfErrorM: 4 }
  const cam = camOver(copA.lon, copA.lat, 40)
  const hit = fallbackHit(cam.pos, centreDir(cam), src, 1)
  assert.ok(Number.isFinite(hit.errKm) && hit.errKm < 0.1, `steep ray error ${hit.errKm}`)
  const r = pickCentre(hit, sampleSpanKm(cam))
  assert.equal(r.status, 'ok'); assert.equal(r.choice?.label.name, 'Copernicus A')
  // A grazing ray (5 deg above the horizon) multiplies the same sigma by 1/tan(5 deg): a hit 1 km inside a rim is refused.
  const pos: [number, number, number] = [1.0431, 0, 0]
  const dir: [number, number, number] = [-Math.sin(5 * RAD) * 0.99, Math.cos(5 * RAD), 0]
  const graze = fallbackHit(pos, dir, flat(500), 1)
  assert.ok(graze.errKm > 5, `grazing error ${graze.errKm}`)
  const rimHit: CentreHit = { lonDeg: copernicus.lon + kmToLon(radiusRad({ sizeKm: copernicus.sizeKm! }) * R_KM - 1, copernicus.lat), latDeg: copernicus.lat, errKm: graze.errKm, tanElev: graze.tanElev, reliefScale: 1, fallback: true }
  assert.equal(pickCentre(rimHit, 300).status, 'uncertain')
  // The same hit with a rendered position (one pixel of error) is accepted.
  assert.equal(pickCentre({ ...rimHit, errKm: 0.02, fallback: false }, 300).choice?.label.name, 'Copernicus')
}

{
  // A pending map is unknown, never height zero; the relief factor scales the height; non-convergence is unknown; no relief means the sphere is exact.
  const pos: [number, number, number] = [1.046, 0, 0]
  const dir: [number, number, number] = [-Math.cos(56 * RAD), Math.sin(56 * RAD), 0]
  assert.equal(fallbackHit(pos, dir, flat(4, true), 1).errKm, Infinity)
  assert.equal(pickCentre(fallbackHit(pos, dir, flat(4, true), 1), 300).status, 'uncertain')
  assert.ok(fallbackHit(pos, dir, flat(4, true), 0).errKm < 0.1)
  const hi = (m: number): HeightSource => ({ sampleM: () => m, pending: false, halfErrorM: 4 })
  const full = fallbackHit(pos, dir, hi(4000), 1), half = fallbackHit(pos, dir, hi(4000), 0.5), twoK = fallbackHit(pos, dir, hi(2000), 1), none = fallbackHit(pos, dir, hi(4000), 0)
  near(half.lonDeg, twoK.lonDeg, 1e-6, 'relief 0.5 equals half the height'); near(half.latDeg, twoK.latDeg, 1e-6, 'relief 0.5 lat')
  assert.ok(Math.abs(full.lonDeg - none.lonDeg) > 0.1, 'relief moves the hit')
  // reliefShare(dist) and the height mix compose into one factor.
  near(reliefShare(1.046) * 0.5, 0.5, 1e-9, 'reliefShare at 1.046 is 1')
  let n = 0
  const jitter: HeightSource = { sampleM: () => (n++ % 2 === 0 ? 9000 : 0), pending: false, halfErrorM: 4 }
  assert.equal(fallbackHit(pos, dir, jitter, 1).errKm, Infinity)
}

{
  // An unresolved crater against a finer reference. A 20 km crater is two texels: the retained map is flat across it, the true floor is 3 km down.
  const crater = LABELS.find((l) => l.kind === 'crater' && classOf(l) === 'disc' && l.sizeKm! > 18 && l.sizeKm! < 24 && Math.abs(l.lat) < 60)!
  const span = 100
  const radiusKm = crater.sizeKm! / 2
  const fine: HeightSource = {
    sampleM: (lon, lat) => {
      const u = unitVector(lat, lon), v = unitVector(crater.lat, crater.lon)
      const km = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) * R_KM
      return -3000 * Math.max(0, 1 - (km / radiusKm) ** 2)
    },
    pending: false, halfErrorM: 4,
  }
  // An oblique camera (elevation ~20 deg) looking at the crater floor from the west.
  const tgt = unitVector(crater.lat, crater.lon)
  const elev = 20 * RAD, alt = 0.05
  const east: [number, number, number] = [-Math.sin(crater.lon * RAD), Math.cos(crater.lon * RAD), 0]
  const ground = 0.6 * alt / Math.tan(elev)
  const pos: [number, number, number] = [tgt[0] * (1 + alt) - east[0] * ground, tgt[1] * (1 + alt) - east[1] * ground, tgt[2] * (1 + alt) - east[2] * ground]
  const toward = [tgt[0] - pos[0], tgt[1] - pos[1], tgt[2] - pos[2]], tl = Math.hypot(...toward)
  const dir: [number, number, number] = [toward[0] / tl, toward[1] / tl, toward[2] / tl]
  const coarse = fallbackHit(pos, dir, flat(4), 1)
  const truth = fallbackHit(pos, dir, fine, 1)
  const shift = Math.hypot(coarse.lonDeg - truth.lonDeg, coarse.latDeg - truth.latDeg) * RAD * R_KM
  assert.ok(shift > 2, `the unresolved floor moves the true hit by ${shift} km`)
  // The CPU estimate over a flat map must not be trusted inside this crater: its unresolved-relief error widens the certainty ring until it reaches where another feature wins.
  const nearRim: CentreHit = { ...coarse, lonDeg: crater.lon + kmToLon(radiusKm - 1.5, crater.lat), latDeg: crater.lat, tanElev: Math.tan(elev), reliefScale: 1 }
  assert.equal(pickCentre(nearRim, span).status, 'uncertain')
  // A rendered hit reads the drawn floor: one pixel of error, accepted.
  assert.equal(pickCentre({ lonDeg: nearRim.lonDeg, latDeg: nearRim.latDeg, errKm: 0.03, fallback: false }, span).choice?.label.id, crater.id)
}

// ---------------------------------------------------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------------------------------------------------
class FakeHost implements CaptionHost {
  canRead = true
  readableDevice = true
  pendingPolls = 0
  reads = 0
  fallbacks = 0
  cam: CamSample = camOver(copernicus.lon, copernicus.lat, 40)
  result: ReadResult | null | undefined
  fb: (s: CamSample) => CentreHit = (s) => ({ ...fallbackHit(s.pos, centreDir(s), flat(4), 1), errKm: 0.01 })
  predict?: (pos: readonly [number, number, number], dir: readonly [number, number, number]) => CentreHit | null
  readable(): boolean { return this.readableDevice }
  beginRead(): boolean { if (!this.canRead) return false; this.reads++; return true }
  pollRead(): ReadResult | null | undefined { if (this.pendingPolls > 0) { this.pendingPolls--; return undefined } return this.result === undefined ? nadirRead(this.cam) : this.result }
  fallback(s: CamSample): CentreHit { this.fallbacks++; return this.fb(s) }
}
const CTX: CaptionCtx = { enabled: true, hidden: false, panorama: false, sheet: false, splash: false, dragging: false, usable: true }
const setup = (cam: CamSample = camOver(copernicus.lon, copernicus.lat, 40)): { host: FakeHost; ctl: CentreCaption } => {
  const host = new FakeHost(); host.cam = cam
  const ctl = new CentreCaption(host)
  ctl.sawCamera(cam, 0)
  return { host, ctl }
}
/** Steps every 16 ms from `from` to `to` (inclusive) with `ctx`. */
const run = (ctl: CentreCaption, from: number, to: number, ctx: Partial<CaptionCtx> = {}): ReturnType<CentreCaption['step']> => {
  let v = ctl.step(from, { ...CTX, ...ctx })
  for (let t = from + 16; t <= to; t += 16) v = ctl.step(t, { ...CTX, ...ctx })
  return v
}
const pause = (ctl: CentreCaption, host: FakeHost, cam: CamSample, at: number): number => {
  host.cam = cam
  ctl.sawCamera(cam, at)
  const v = run(ctl, at, at + STILL_MS + 200)
  assert.ok(v.visible, `shown after the pause at ${at}`)
  return at + STILL_MS + 200
}

{
  // The lock tracks the presented centre during motion at a bounded cadence, replacing stale text and clearing a pick with no certain feature.
  assert.equal(MOTION_PICK_MS, 250)
  const next = byName('Tycho'), { host, ctl } = setup()
  assert.equal(ctl.step(0, { ...CTX, moving: true }).text, 'Copernicus')
  host.fb = () => exact(next, 0.01)
  const nextCam = camOver(next.lon, next.lat, 40)
  host.cam = nextCam; ctl.sawCamera(nextCam, 100)
  assert.equal(ctl.step(100, { ...CTX, moving: true }).text, 'Copernicus', 'motion picks are throttled')
  const changed = ctl.step(MOTION_PICK_MS, { ...CTX, moving: true })
  assert.equal(changed.text, 'Tycho'); assert.equal(changed.visible, true)
  host.fb = () => ({ lonDeg: NaN, latDeg: NaN, errKm: Infinity, fallback: true })
  ctl.sawCamera(nextCam, 500)
  const cleared = ctl.step(500, { ...CTX, moving: true })
  assert.equal(cleared.text, ''); assert.equal(cleared.visible, false); assert.equal(cleared.phase, 'hidden')
}

{
  // Port of the reported slow pan: the presented camera changes every frame, while each throttled pick still supports Copernicus.
  // Visibility stays continuous between picks and LockHold sees one commit for the whole pan.
  const { host, ctl } = setup()
  host.fb = () => exact(copernicus, 0.01)
  const hold = new LockHold()
  let commits = 0
  let lastCommit = -1
  for (let t = 0; t <= 2000; t += 16) {
    const cam = camOver(copernicus.lon + t / 2000 * 0.5, copernicus.lat, 40)
    host.cam = cam
    ctl.sawCamera(cam, t)
    const v = ctl.step(t, { ...CTX, moving: true, preserveMovingLock: true })
    assert.equal(v.visible, true, `lock remains visible between picks at ${t} ms`)
    const locked = hold.step({ id: v.visible ? v.id : null, moving: true, suppressed: false, now: t })
    if (locked.id && locked.since !== lastCommit) { commits++; lastCommit = locked.since }
  }
  assert.equal(commits, 1, 'the pan commits the same feature once')
  const stoppedCam = camOver(copernicus.lon + 0.5, copernicus.lat, 40)
  ctl.sawCamera(stoppedCam, 2016)
  const rest = ctl.step(2016, { ...CTX, moving: false, preserveMovingLock: true })
  const held = hold.step({ id: rest.visible ? rest.id : null, moving: false, suppressed: false, now: 2016 })
  assert.equal(rest.visible, true)
  assert.equal(held.since, lastCommit, 'stopping over the same feature keeps its existing commit')
}

{
  // Nothing before 2000 ms; the name on the pause; the read was started shortly before it (so it has landed) and is the hit used.
  const { ctl, host } = setup()
  assert.equal(run(ctl, 0, 1999).visible, false)
  assert.equal(host.reads, 1, 'the read starts READ_LEAD_MS before the deadline')
  const v = run(ctl, 2000, 2100)
  assert.equal(v.visible, true); assert.equal(v.text, 'Copernicus')
  assert.equal(host.fallbacks, 0, 'the rendered hit is used')
  // Motion at 1900 restarts the full 2 s.
  const m = setup()
  const moved = camOver(copernicus.lon + 0.3, copernicus.lat, 40)
  m.host.cam = moved
  run(m.ctl, 0, 1900)
  m.ctl.sawCamera(moved, 1900)
  assert.equal(run(m.ctl, 1916, 3899).visible, false)
  assert.equal(run(m.ctl, 3900, 4000).visible, true)
}

{
  // Reviewer override 1: A -> B -> unchanged B with no further render calls. The anchor is B; the name appears 2 s after B.
  const { ctl, host } = setup(camOver(copernicus.lon, copernicus.lat, 40))
  const b = camOver(copernicus.lon + 0.4, copernicus.lat, 40)
  host.cam = b
  run(ctl, 0, 100)
  ctl.sawCamera(b, 100)
  assert.equal(ctl.pauseEpoch, 2)
  assert.equal(run(ctl, 116, 2099).visible, false)
  assert.equal(run(ctl, 2100, 2200).visible, true)
  assert.equal(ctl.pauseEpoch, 2)
}

{
  // The anchor stays fixed between threshold crossings: slow drift accumulates and a crossing reseeds it.
  const base = camOver(copernicus.lon, copernicus.lat, 40)
  const { ctl } = setup(base)
  const dist = Math.hypot(...base.pos)
  const step = 1.7e-6
  const drift = (k: number): CamSample => ({ ...base, pos: [base.pos[0], base.pos[1] + k * step * 1, base.pos[2]] })
  assert.ok(differs(base, drift(3)) && !differs(base, drift(2)), `tolerance ${1e-4 * (dist - 1)}`)
  const epochs: number[] = []
  for (let k = 1; k <= 7; k++) { ctl.sawCamera(drift(k), k * 100); epochs.push(ctl.pauseEpoch) }
  // Crossings at k = 3 and k = 6 (the anchor moved to the sample that crossed): epoch 1 -> 2 -> 3.
  assert.deepEqual(epochs, [1, 1, 2, 2, 2, 3, 3])
  // A drift that keeps crossing never lets a name through.
  let v = ctl.step(0, CTX)
  for (let t = 800; t < 6000; t += 100) { ctl.sawCamera({ ...base, pos: [base.pos[0], base.pos[1] + (t / 100) * step, base.pos[2]] }, t); v = ctl.step(t, CTX) }
  assert.equal(v.visible, false)
  // Roll alone is motion.
  const rolled: CamSample = { ...base, up: [base.up[0] * Math.cos(RAD) + base.up[2] * Math.sin(RAD), base.up[1], base.up[2] * Math.cos(RAD) - base.up[0] * Math.sin(RAD)] }
  assert.ok(differs(base, rolled))
  assert.ok(differs(base, { ...base, tanHalf: base.tanHalf + 2e-4 }))
}

{
  // A paused cinematic flight, an arrival dwell, a held tween: the camera is the same every frame, whatever else says "moved".
  const cam = camOver(copernicus.lon, copernicus.lat, 40)
  const { ctl } = setup(cam)
  let v = ctl.step(0, CTX)
  for (let t = 16; t < 2300; t += 16) { ctl.sawCamera({ ...cam, pos: [...cam.pos] as CamSample['pos'] }, t); v = ctl.step(t, CTX) }
  assert.equal(v.visible, true)
}

{
  // Hidden tab resets; a Time scrub (same camera) does not; the More sheet suppresses without resetting; the panorama suppresses and the clock keeps counting.
  const { ctl, host } = setup()
  run(ctl, 0, 1500)
  ctl.step(1500, { ...CTX, hidden: true })
  assert.equal(run(ctl, 1516, 3499).visible, false, 'background time cannot satisfy the pause')
  assert.equal(run(ctl, 3500, 3600).visible, true)
  const t2 = setup()
  assert.equal(run(t2.ctl, 0, 2600, { sheet: true }).visible, false)
  assert.equal(run(t2.ctl, 2616, 2700, { sheet: false }).visible, true, 'the sheet did not reset the clock')
  const t3 = setup()
  run(t3.ctl, 0, 2200)
  const gone = run(t3.ctl, 2216, 2216 + FADE_OUT_MS + 16, { panorama: true })
  assert.equal(gone.visible, false); assert.equal(gone.phase, 'hidden')
  assert.equal(run(t3.ctl, 4000, 4100, { panorama: false }).visible, true, 'back at once, without a new 2 s wait')
  assert.equal(host.fallbacks, 0)
  // Splash, dragging, disabled, no usable interval.
  assert.equal(run(setup().ctl, 0, 3000, { splash: true }).visible, false)
  assert.equal(run(setup().ctl, 0, 3000, { enabled: false }).visible, false)
  assert.equal(run(setup().ctl, 0, 3000, { usable: false }).visible, false)
  assert.equal(run(setup().ctl, 0, 3000, { dragging: true }).visible, false)
}

{
  // Trigger (owner 2026-10-31): only frames whose short side spans at most MAX_SPAN_KM (900 km, a quarter of the Moon) on the ground; never Home (whole Moon,
  // ~2,400 km) or anything wider; off under 1.004. A portrait phone (aspect 0.45) measures its width, the short side.
  assert.equal(MAX_SPAN_KM, 900)
  const at = (span: number, aspect = 1.5): boolean => { const cam = camOver(copernicus.lon, copernicus.lat, span, aspect); const { ctl } = setup(cam); return run(ctl, 0, 2300).visible }
  for (const aspect of [1.5, 0.45]) {
    assert.equal(at(2400, aspect), false, `Home-like span, aspect ${aspect}`)
    assert.equal(at(MAX_SPAN_KM + 1, aspect), false, `just over 900 km, aspect ${aspect}`)
    assert.equal(at(MAX_SPAN_KM - 1, aspect), true, `just under 900 km, aspect ${aspect}`)
  }
  const low = camOver(copernicus.lon, copernicus.lat, 2.8)
  assert.ok(Math.hypot(...low.pos) < 1.004)
  assert.equal(run(setup(low).ctl, 0, 2300).visible, false)
  // The short side decides: a portrait window (aspect 0.5) has the same tan on its short side.
  near(sampleSpanKm(camOver(0, 0, 1000, 0.5)), 1000, 1e-6, 'short-side span')
}

/** A hit for Copernicus A that the gate rejects (3 km of error: the certainty ring reaches where Copernicus wins): only a rendered hit can name it. */
const AMBIGUOUS_A: CentreHit = { lonDeg: copA.lon, latDeg: copA.lat, errKm: 3, tanElev: 1, reliefScale: 1, fallback: true }
const setupA = (): { host: FakeHost; ctl: CentreCaption; cam: CamSample } => {
  const cam = camOver(copA.lon, copA.lat, 40)
  const { host, ctl } = setup(cam)
  host.cam = cam; host.fb = () => AMBIGUOUS_A
  return { host, ctl, cam }
}
/** Time from the camera coming to rest (t = 0) to the first visible frame. */
const firstVisible = (ctl: CentreCaption, to = 8000): number | null => {
  for (let t = 0; t <= to; t += 16) if (ctl.step(t, CTX).visible) return t
  return null
}

{
  // The name appears on the 2 s pause (give or take one frame) whatever the read does: slow, never landing, failing, refused, from another camera.
  const slow = setup(); slow.host.pendingPolls = 1e9
  const t1 = firstVisible(slow.ctl)!
  assert.ok(t1 >= 2000 && t1 <= 2000 + 16, `slow read: first visible frame at ${t1}`)
  const failing = setup(); failing.host.result = null
  assert.ok(firstVisible(failing.ctl)! <= 2016)
  const refused = setup(); refused.host.canRead = false
  assert.ok(firstVisible(refused.ctl)! <= 2016); assert.ok(refused.host.fallbacks >= 1)
  const other = setup(); other.host.result = nadirRead(camOver(copernicus.lon + 2, copernicus.lat, 40))
  assert.ok(firstVisible(other.ctl)! <= 2016); assert.equal(other.ctl.stats.readHits, 0, 'a hit from a different camera is not trusted')
  // A refinement stream (a new surface generation every 100 ms, as after a move) neither restarts the pause nor delays the name.
  const churn = setup(); let g = 1
  let seen: number | null = null
  for (let t = 0; t <= 3000 && seen === null; t += 16) { if (t % 100 === 0) churn.ctl.sawCamera(churn.host.cam, t, g++); if (churn.ctl.step(t, CTX).visible) seen = t }
  assert.ok(seen !== null && seen <= 2016, `generation churn: first visible frame at ${seen}`)
  assert.equal(churn.ctl.pauseEpoch, 1)
  // When the CPU estimate is NOT certain, only a rendered hit can name it: it appears when the read lands, and a read that never lands names nothing.
  const a = setupA()
  a.host.pendingPolls = 100 // ~1.6 s of frames at 16 ms
  const tA = firstVisible(a.ctl)!
  assert.ok(tA > 2000, `waits for the read (${tA})`)
  assert.equal(a.ctl.current?.text, 'Copernicus A')
  const never = setupA(); never.host.pendingPolls = 1e9
  assert.equal(firstVisible(never.ctl, 8000), null, 'an uncertain estimate is never shown without the read')
  assert.ok(never.ctl.stats.why.readTimeout >= 1)
  // A device that never shares the hit target is not asked: no read attempts, the CPU estimate every 500 ms at most.
  const phone = setupA(); phone.host.readableDevice = false; phone.host.fb = (s) => { void s; return AMBIGUOUS_A }
  firstVisible(phone.ctl, 10000)
  assert.equal(phone.host.reads, 0, 'no beginRead on a device that cannot read')
  assert.ok(phone.host.fallbacks <= 10000 / 500 + 2, `CPU picks are throttled (${phone.host.fallbacks})`)
  assert.equal(phone.ctl.stats.why.unreadable, 1)
}

{
  // Retention: a pan inside the old name's reach does not jump to a feature that is not at least 1 / RETAIN_SHARE times better; a zoom reconsiders; sub-threshold
  // zooms add up. (Zooming IN makes the 3 km Copernicus A a readable share of the frame; zooming out favours Copernicus, see FIT SCORING.)
  const { ctl, host } = setup(camOver(copernicus.lon, copernicus.lat, 40))
  let t = pause(ctl, host, camOver(copernicus.lon, copernicus.lat, 40), 0)
  assert.equal(ctl.current?.text, 'Copernicus')
  t = pause(ctl, host, camOver(copA.lon, copA.lat, 40), t + 100)
  assert.equal(ctl.current?.text, 'Copernicus', 'a pan at the same span keeps the name')
  t = pause(ctl, host, camOver(copA.lon, copA.lat, 40 / 1.1), t + 100)
  assert.equal(ctl.current?.text, 'Copernicus', '1.1x keeps it')
  t = pause(ctl, host, camOver(copA.lon, copA.lat, 40 / 1.3), t + 100)
  assert.equal(ctl.current?.text, 'Copernicus A', '1.3x reconsiders at the new span')
  assert.ok(Math.log(1.3) > Math.log(1 + ZOOM_FRAC))
  void t
  // Three sub-threshold zooms add up past the threshold (the baseline is the span the name was chosen at).
  const z = setup(camOver(copernicus.lon, copernicus.lat, 40))
  let tz = pause(z.ctl, z.host, camOver(copernicus.lon, copernicus.lat, 40), 0)
  const seen: string[] = []
  for (const k of [1.1, 1.21, 1.331]) { tz = pause(z.ctl, z.host, camOver(copA.lon, copA.lat, 40 / k), tz + 100); seen.push(z.ctl.current!.text) }
  assert.deepEqual(seen, ['Copernicus', 'Copernicus A', 'Copernicus A'])
  // Alternating border hits within the hysteresis never switch the name.
  const e = setup(camOver(copA.lon, copA.lat, 40))
  let te = pause(e.ctl, e.host, camOver(copA.lon, copA.lat, 40), 0)
  assert.equal(e.ctl.current?.text, 'Copernicus A')
  const rKm = radiusRad({ sizeKm: copA.sizeKm! }) * R_KM
  for (let i = 0; i < 6; i++) {
    const f = i % 2 === 0 ? 0.9 : 1.1
    te = pause(e.ctl, e.host, camOver(copA.lon + kmToLon(f * rKm, copA.lat), copA.lat, 40), te + 100)
    assert.equal(e.ctl.current?.text, 'Copernicus A', `border hit ${f}`)
  }
}

{
  // Fades: motion 100 ms into the fade-in reverses it; the fade-out finishes on the clock, with no transition event; a null pick fades out.
  const { ctl, host } = setup()
  run(ctl, 0, 2016)
  assert.equal(ctl.step(2016, CTX).visible, true)
  const moved = camOver(copernicus.lon + 0.5, copernicus.lat, 40)
  ctl.consumeDomDirty()
  ctl.sawCamera(moved, 2116)
  let v = ctl.step(2116, CTX)
  assert.equal(v.visible, false); assert.equal(v.phase, 'fadingOut'); assert.equal(v.occupied, true)
  assert.equal(ctl.consumeDomDirty(), true)
  assert.equal(ctl.step(2116 + FADE_OUT_MS - 1, CTX).phase, 'fadingOut')
  v = ctl.step(2116 + FADE_OUT_MS, CTX)
  assert.equal(v.phase, 'hidden'); assert.equal(v.occupied, false)
  // The same feature after the re-arm fades back in.
  host.cam = moved
  assert.equal(run(ctl, 2500, 2116 + STILL_MS + 100).visible, true)
  // A CPU-estimate name whose pick turns uncertain fades out after MIN_SHOW_MS (never two names at once).
  const f = setupA(); f.host.canRead = false; f.host.fb = () => ({ lonDeg: copA.lon, latDeg: copA.lat, errKm: 0.01, fallback: false })
  run(f.ctl, 0, 2100)
  assert.equal(f.ctl.step(2100, CTX).visible, true)
  f.host.fb = () => AMBIGUOUS_A
  assert.equal(run(f.ctl, 2116, 2000 + MIN_SHOW_MS - 100).visible, true, 'not replaced before MIN_SHOW_MS')
  assert.equal(run(f.ctl, 3600, 4200).visible, false)
}

// ---------------------------------------------------------------------------------------------------------------------
// Publishing: only the PRESENTED scene's camera reaches the controller (reviewer override 2)
// ---------------------------------------------------------------------------------------------------------------------
{
  /** Mirrors main.ts's render(): select the camera early, then return at the gates that present nothing. */
  const mk = (): { scene: PresentedScene; ctl: CentreCaption; host: FakeHost; frame: (o: { cam: CamSample; t: number; buildOnly?: boolean; band?: { k: number; n: number }; finalOnly?: boolean }) => void } => {
    const scene = new PresentedScene(), host = new FakeHost(), ctl = new CentreCaption(host)
    return {
      scene, ctl, host,
      frame: (o) => {
        const cont = !!o.band && o.band.k > 0
        scene.selected(cont || !!o.finalOnly || !!o.buildOnly, () => o.cam)
        if (o.buildOnly) return
        if (o.band && o.band.k < o.band.n - 1) return
        const on = scene.presented(!!o.finalOnly)
        if (on) ctl.sawCamera(on, o.t)
      },
    }
  }
  const A = camOver(copernicus.lon, copernicus.lat, 40), B = camOver(copernicus.lon + 0.6, copernicus.lat, 40), C = camOver(copernicus.lon - 0.6, copernicus.lat, 40)

  // buildOnly frames select other cameras and present nothing: the pause is not restarted.
  const b = mk(); b.host.cam = A
  b.frame({ cam: A, t: 0 })
  for (let t = 100; t < 3000; t += 100) { b.frame({ cam: t % 200 === 0 ? B : C, t, buildOnly: true }); b.ctl.step(t, CTX) }
  assert.equal(b.ctl.pauseEpoch, 1)
  assert.equal(b.ctl.step(3000, CTX).phase === 'hidden', false)
  assert.equal(run(b.ctl, 3016, 3100).visible, true)

  // Bands: the scene's camera is the first band's; unfinished bands present nothing; the last band presents that camera, not its own selection.
  const n = mk(); n.host.cam = A
  n.frame({ cam: A, t: 0 })
  n.frame({ cam: B, t: 100, band: { k: 0, n: 3 } })
  assert.equal(n.ctl.pauseEpoch, 1, 'an unfinished band 0 presents nothing')
  n.frame({ cam: C, t: 120, band: { k: 1, n: 3 } })
  assert.equal(n.ctl.pauseEpoch, 1)
  n.frame({ cam: C, t: 140, band: { k: 2, n: 3 } })
  assert.equal(n.ctl.pauseEpoch, 2, 'the finished scene was drawn with band 0\'s camera B')
  assert.equal(n.scene.current, B)
  // Final-only redraws keep the scene's snapshot even when the camera they select differs.
  n.frame({ cam: A, t: 200, finalOnly: true })
  assert.equal(n.scene.current, B); assert.equal(n.ctl.pauseEpoch, 2)
  n.host.cam = B
  assert.equal(run(n.ctl, 140, 2300).visible, true)

  // Hit target: only a whole frame that shared its hit owns it; a band does not overwrite it.
  const h = mk()
  h.frame({ cam: A, t: 0 }); h.scene.drewMoon(true, 1350, 900)
  assert.equal(h.scene.hit?.cam, A); assert.equal(h.scene.hit?.w, 1350); assert.equal(h.scene.hit?.h, 900)
  h.frame({ cam: B, t: 100, band: { k: 0, n: 2 } })
  assert.equal(h.scene.hit?.cam, A, 'an unfinished band presents nothing: the scene on screen is still A')
  // The refined (banded) scene is a new surface generation, even at the very same camera: the old hit is obsolete, never authoritative.
  h.frame({ cam: A, t: 120, band: { k: 1, n: 2 } })
  assert.equal(h.scene.current, B); assert.equal(h.scene.hit, null, 'a banded presentation has no hit of its own')
  // A final-only redraw presents no new scene: the hit of the scene it redraws stays.
  h.frame({ cam: C, t: 200 }); h.scene.drewMoon(true, 1350, 900)
  assert.equal(h.scene.hit?.cam, C)
  h.frame({ cam: A, t: 300, finalOnly: true })
  assert.equal(h.scene.hit?.cam, C, 'final-only keeps the previous hit')
  h.frame({ cam: B, t: 400 }); h.scene.drewMoon(false)
  assert.equal(h.scene.hit, null)
}

// ---------------------------------------------------------------------------------------------------------------------
// Review round 2
// ---------------------------------------------------------------------------------------------------------------------
{
  // 1. The read texel's own ray: an even-sized target has no centre texel, so the read is up to ~0.71 px off the screen centre. Real hit function:
  // a constant-radius surface; the old reconstruction (range applied to the screen-centre ray) is far off at a low elevation, the new one is within its bound.
  const dist = 1.1, pitch = 60 * RAD
  const dirC: [number, number, number] = [-Math.cos(pitch), Math.sin(pitch), 0]
  const cam: CamSample = { pos: [dist, 0, 0], back: [-dirC[0], -dirC[1], -dirC[2]], up: [0, 0, 1], tanHalf: TAN15, aspect: 1.5 }
  const r0 = 1.0005
  const w = 1350, h = 900, ix = w / 2, iy = h / 2
  const centre = raySphereV(cam.pos, dirC, r0)!
  // Range of the read texel's ray, from the real hit function (the sphere of radius r0 along that ray).
  const { dir } = (await import('../src/labels/centrePick.ts')).texelRay(cam, w, h, ix, iy)
  const hitPt = raySphereV(cam.pos, dir, r0)!
  const range = Math.hypot(hitPt[0] - cam.pos[0], hitPt[1] - cam.pos[1], hitPt[2] - cam.pos[2])
  const read = { kind: 'hit' as const, cam, rangeRadii: range, w, h, ix, iy }
  const got = hitOfRead(read)
  const toKm = (a: { lonDeg: number; latDeg: number }, p: readonly [number, number, number]): number => {
    const u = unitVector(a.latDeg, a.lonDeg), q = Math.hypot(...p)
    return Math.acos(Math.max(-1, Math.min(1, (u[0] * p[0] + u[1] * p[1] + u[2] * p[2]) / q))) * R_KM
  }
  const trueOff = toKm(got, centre)
  const oldPt: [number, number, number] = [cam.pos[0] + dirC[0] * range, cam.pos[1] + dirC[1] * range, cam.pos[2] + dirC[2] * range]
  const oldDisp = Math.hypot(oldPt[0] - centre[0], oldPt[1] - centre[1], oldPt[2] - centre[2]) * R_KM
  const oldReported = 0.5 * range * (2 * TAN15 / h) * R_KM
  assert.ok(oldDisp > oldReported, `the old reconstruction was off by ${oldDisp} km while reporting ${oldReported}`)
  assert.ok(trueOff <= got.errKm, `the new reconstruction is within its bound: ${trueOff} <= ${got.errKm}`)
  // The same texel read as an odd-sized target's exact centre has no offset term.
  assert.ok(hitOfRead({ ...read, ix: undefined, iy: undefined, rangeRadii: Math.hypot(centre[0] - 1.1, centre[1], centre[2]) }).errKm < got.errKm)
  // The bound grows toward grazing incidence.
  const flatCam: CamSample = { ...cam, pos: [dist, 0, 0] }
  assert.ok(hitOfRead({ ...read, cam: flatCam }).errKm > hitOfRead(nadirRead(camOver(0, 0, 100)) as typeof read).errKm)
}

{
  // 3. Boundaries between two answers: the Gazetteer regression (Almanon vs Catena Abulfeda at span 600). Walk from one to the other, find where the winner
  // changes by bisection, and check the gate there: 10 m from the boundary, an error of 0.05 km is uncertain (the ring reaches across), 0.1 m is certain.
  const al = byName('Almanon'), ca = byName('Catena Abulfeda')
  const at = (f: number): CentreHit => ({ lonDeg: al.lon + f * (ca.lon - al.lon), latDeg: al.lat + f * (ca.lat - al.lat), errKm: 0, fallback: false })
  const nameAt = (f: number): string | undefined => pickCentre(at(f), 600).choice?.label.name
  const n0 = nameAt(0), n1 = nameAt(1)
  assert.equal(n0, 'Almanon'); assert.equal(n1, 'Catena Abulfeda')
  let lo = 0, hi = 1
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (nameAt(m) === n0) lo = m; else hi = m }
  const kmPerF = Math.hypot((ca.lat - al.lat), (ca.lon - al.lon) * Math.cos(al.lat * RAD)) * RAD * R_KM
  const f10m = lo - 0.01 / kmPerF
  assert.equal(pickCentre({ ...at(f10m), errKm: 0.0001 }, 600).choice?.label.name, n0, '10 m inside with a tiny error: certain')
  const gated = pickCentre({ ...at(f10m), errKm: 0.05 }, 600)
  assert.equal(gated.status, 'uncertain', `a boundary closer than errKm / GATE makes the pick uncertain (got ${gated.choice?.label.name})`)
}

{
  // 4. A faded name is not resurrected: after Copernicus A fades and the re-arm finds only sky and an uncertain estimate, nothing is exposed, reserved or announced.
  const { ctl, host, cam } = setupA()
  run(ctl, 0, 2100)
  assert.equal(ctl.step(2116, CTX).text, 'Copernicus A')
  const moved = camOver(copA.lon + 0.01, copA.lat, 40)
  ctl.sawCamera(moved, 2200)
  const fading = ctl.step(2216, CTX)
  assert.equal(fading.text, 'Copernicus A'); assert.equal(fading.occupied, true); assert.equal(fading.visible, false)
  host.cam = moved; host.result = { kind: 'sky' }
  assert.notEqual(cam, moved)
  for (let t = 2232; t <= 2200 + STILL_MS + 3000; t += 16) {
    const v = ctl.step(t, CTX)
    if (t >= 2200 + FADE_OUT_MS) { assert.equal(v.text, '', `no stale text at ${t}`); assert.equal(v.occupied, false); assert.equal(v.visible, false) }
  }
  assert.ok(ctl.current, 'the retained record stays internal')
}

{
  // 1b. Grazing and silhouette cases are uncertain, never "certain with a small bound". dist 1.1, radius 1.0005, 1350 x 900, up [0,0,-1].
  const dist = 1.1, r0 = 1.0005, w = 1350, h = 900
  const camAt = (pitchDeg: number): CamSample => {
    const pitch = pitchDeg * RAD
    const d: [number, number, number] = [-Math.cos(pitch), Math.sin(pitch), 0]
    return { pos: [dist, 0, 0], back: [-d[0], -d[1], -d[2]], up: [0, 0, -1], tanHalf: TAN15, aspect: 1.5 }
  }
  const readOf = (cam: CamSample): Extract<ReadResult, { kind: 'hit' }> | null => {
    const { dir } = texelRay(cam, w, h, w / 2, h / 2)
    const pt = raySphereV(cam.pos, dir, r0)
    if (!pt) return null
    return { kind: 'hit', cam, rangeRadii: Math.hypot(pt[0] - cam.pos[0], pt[1] - cam.pos[1], pt[2] - cam.pos[2]), w, h, ix: w / 2, iy: h / 2 }
  }
  // The centre misses the sphere while the sampled texel still hits: found by scanning across tangency.
  let missCase: CamSample | null = null
  for (let pd = 65.40; pd < 65.50 && !missCase; pd += 0.0002) {
    const cam = camAt(pd)
    if (readOf(cam) && !raySphereV(cam.pos, centreDir(cam), r0)) missCase = cam
  }
  assert.ok(missCase, 'a pose where the centre misses and the texel hits exists')
  assert.equal(hitOfRead(readOf(missCase)!).errKm, Infinity, 'centre ray misses: uncertain')
  const tangent = camAt(65.441612)
  const rt = readOf(tangent)
  if (rt) assert.equal(hitOfRead(rt).errKm, Infinity, 'tangent ray: uncertain')
  // A near-tangent ray that still hits with the centre (elevation about 3 degrees) is uncertain too.
  let nearTangent: CamSample | null = null
  for (let pd = 65.0; pd < 65.44 && !nearTangent; pd += 0.0005) {
    const cam = camAt(pd), rd = readOf(cam)
    if (rd && raySphereV(cam.pos, centreDir(cam), r0) && hitOfRead({ ...rd, rangeRadii: rd.rangeRadii }).errKm === Infinity) nearTangent = cam
  }
  assert.ok(nearTangent, 'near the limb the hit is refused before the centre ray misses')
  // The 60 degree case keeps a finite, honest bound.
  assert.ok(Number.isFinite(hitOfRead(readOf(camAt(60))!).errKm))
}

{
  // 2. Surface generation through read completion (uncertain estimate: only a rendered hit names Copernicus A).
  const a = setupA()
  a.ctl.sawCamera(a.cam, 0, 1)
  a.host.pendingPolls = 1e9
  for (let t = 0; t <= 1800; t += 16) a.ctl.step(t, CTX)
  assert.equal(a.host.reads, 1)
  a.ctl.sawCamera(a.cam, 1800, 2) // a refined surface at the very same camera: the read in flight belongs to the old one
  assert.equal(a.ctl.pauseEpoch, 1, 'no restart: the camera did not move')
  a.host.pendingPolls = 0
  a.host.result = { ...nadirRead(a.cam), gen: 1 } // the old surface's result
  let v = run(a.ctl, 1816, 3000)
  assert.ok(a.host.reads >= 2, 'a fresh read starts for the new surface')
  assert.equal(v.visible, false, 'the stale result is never used')
  assert.equal(a.ctl.stats.readHits, 0)
  a.ctl.sawCamera(a.cam, 3000, 3) // the next refinement: reads start afresh (the retry budget is per surface)
  a.host.result = { ...nadirRead(a.cam), gen: 3 }
  v = run(a.ctl, 3016, 5000)
  assert.equal(v.visible, true); assert.equal(v.text, 'Copernicus A')

  // An accepted name survives a refinement that confirms it: visible the whole time, never fading, and it reads again.
  const b = setupA(); b.ctl.sawCamera(b.cam, 0, 1)
  run(b.ctl, 0, 2100)
  assert.equal(b.ctl.step(2116, CTX).visible, true)
  const readsBefore = b.host.reads
  b.ctl.sawCamera(b.cam, 2200, 2)
  b.host.result = { ...nadirRead(b.cam), gen: 2 }
  for (let t = 2216; t <= 4500; t += 16) { const x = b.ctl.step(t, CTX); assert.equal(x.visible, true, `no pop at ${t}`); assert.equal(x.text, 'Copernicus A') }
  assert.equal(b.host.reads, readsBefore + 1, 'revalidated by one fresh read')

  // One that the new surface does not confirm stays up while it waits for a read (at most CONFIRM_WAIT_MS), then leaves by the normal fade-out.
  const c = setupA(); c.ctl.sawCamera(c.cam, 0, 1)
  run(c.ctl, 0, 2100)
  c.ctl.sawCamera(c.cam, 2200, 2)
  c.host.result = { kind: 'sky', gen: 2 }
  let fadedAt = -1
  for (let t = 2216; t <= 6000; t += 16) {
    const x = c.ctl.step(t, CTX)
    if (x.phase === 'fadingOut' && fadedAt < 0) fadedAt = t
    if (fadedAt < 0) assert.equal(x.text, 'Copernicus A')
    else assert.ok(x.text === 'Copernicus A' || x.text === '', 'never a different name while fading')
  }
  assert.ok(fadedAt >= 2200 + 1500 && fadedAt <= 2200 + 1500 + RECHECK_MS + 100, `held for the confirmation wait, then faded (at ${fadedAt})`)
}

{
  // 3. A descendant transform transition leaves the clearance alone (once the compass needle, every 100 ms); only the measured elements'
  // geometry/visibility transitions count.
  assert.equal(transitionMovesRow(false, 'transform'), false, 'a descendant transform transition')
  assert.equal(transitionMovesRow(false, 'opacity'), false, 'an icon or item fade inside the pad')
  assert.equal(transitionMovesRow(true, 'background-color'), false)
  assert.equal(transitionMovesRow(true, 'transform'), true, 'the toggle travelling to its close slot')
  assert.equal(transitionMovesRow(true, 'bottom'), true, 'the pad lifting over a sheet')
  assert.equal(transitionMovesRow(true, 'opacity'), true, 'the pad fading under a sheet')
  const rects: Rect[] = [{ left: 700, top: 295, right: 868, bottom: 330 }]
  let reads = 0
  const measure = (): ClearanceInput => { reads++; return { viewportW: 915, insetL: 47, insetR: 47, pad: 12, rowTop: 300, rowBottom: 322, rects: [...rects], textW: 200, minW: MIN_CAPTION_W } }
  const rc = new RowClearance()
  rc.refresh(0, measure)
  const before = reads
  for (let t = 100; t < 6000; t += 16) {
    if (t % 100 < 16 && transitionMovesRow(false, 'transform')) rc.transition(t) // a descendant 80 ms transform transition
    rc.refresh(t, measure)
  }
  assert.equal(reads, before, 'a descendant transform transition costs no layout reads')
}

/** The longitude east of Copernicus A (its latitude, 40 km span, exact hits) where the fit-scoring winner stops being A: a real decision boundary. */
function copABoundaryLon(): number {
  const name = (lon: number): string | undefined => pickCentre({ lonDeg: lon, latDeg: copA.lat, errKm: 0, fallback: false }, 40).choice?.label.name
  let lo = copA.lon, hi = copA.lon + kmToLon(30, copA.lat)
  assert.equal(name(lo), 'Copernicus A'); assert.notEqual(name(hi), 'Copernicus A')
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (name(m) === 'Copernicus A') lo = m; else hi = m }
  return lo
}

// ---------------------------------------------------------------------------------------------------------------------
// Owner decisions after review
// ---------------------------------------------------------------------------------------------------------------------
/** A tilted camera over (lon, lat) at `dist`, pitched `pitchDeg` off nadir toward north (up is the pitched north). */
function tilted(lon: number, lat: number, dist: number, pitchDeg: number, aspect = 1.6): CamSample {
  const u = unitVector(lat, lon), la = lat * RAD, lo = lon * RAD
  const n: [number, number, number] = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)]
  const c = Math.cos(pitchDeg * RAD), sn = Math.sin(pitchDeg * RAD)
  const dir: [number, number, number] = [-c * u[0] + sn * n[0], -c * u[1] + sn * n[1], -c * u[2] + sn * n[2]]
  const up: [number, number, number] = [c * n[0] + sn * u[0], c * n[1] + sn * u[1], c * n[2] + sn * u[2]]
  return { pos: [u[0] * dist, u[1] * dist, u[2] * dist], back: [-dir[0], -dir[1], -dir[2]], up, tanHalf: aspect >= 1 ? TAN15 : TAN15 / aspect, aspect }
}
/** Plato left the viewpoint list (2026-10-20); the controller's rule for a viewpoint that names a feature is still checked with its ids. */
const PLATO_VIEWPOINT: readonly string[] = ['plato']
const centreHitOf = (cam: CamSample, r = 1): CentreHit => {
  const p = raySphereV(cam.pos, centreDir(cam), r)!
  const lonDeg = Math.atan2(p[1], p[0]) / RAD, latDeg = Math.asin(p[2] / Math.hypot(...p)) / RAD
  return { lonDeg, latDeg, errKm: 0.05, fallback: false }
}

{
  // 1. The owner's Copernicus fly view (dist 1.046285, pitch 56.47 deg): the centre is on the mare just south of the rim, yet Copernicus fills the top of the screen.
  // The shared link also carries an aim offset (`off`, `aim`) that this plain model of the pose leaves out, so the camera's latitude is moved (same
  // distance, same pitch) until the centre falls just south of the rim, as in the owner's screenshot.
  let cam = tilted(-19.7012, 4.32646, 1.046285, 56.47)
  for (let lat = 4.32646; lat > 0; lat -= 0.01) {
    cam = tilted(-19.7012, lat, 1.046285, 56.47)
    const h = centreHitOf(cam), u = unitVector(h.latDeg, h.lonDeg), v = unitVector(copernicus.lat, copernicus.lon)
    const gap = Math.acos(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) * R_KM - copernicus.sizeKm! / 2
    if (gap > 3) break
  }
  const hit = centreHitOf(cam)
  const span = sampleSpanKm(cam)
  const rimGapKm = (() => { const u = unitVector(hit.latDeg, hit.lonDeg), v = unitVector(copernicus.lat, copernicus.lon); return Math.acos(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) * R_KM - copernicus.sizeKm! / 2 })()
  assert.ok(rimGapKm > 0.5 && rimGapKm < 20, `the centre is just outside the rim (${rimGapKm} km)`)
  // Fit scoring (owner 2026-10-31): the exact centre is on Oceanus Procellarum, 2,600 km across in a frame of ~40 km; Copernicus, whose rim is a few km away,
  // is named on the ground alone, before any screen-space prominence.
  const plain = pickCentre(hit, span)
  assert.equal(plain.choice?.label.name, 'Copernicus', 'the rim next to the centre beats the ocean that contains it'); assert.equal(plain.choice?.mode, 'near')
  const seen = pickCentre(hit, span, null, cam)
  assert.equal(seen.status, 'ok'); assert.equal(seen.choice?.label.name, 'Copernicus')
  // Retained stays: the prominent name holds under small camera changes, and a retained mare gives way to it (a larger feature).
  const ret = { id: 'copernicus', acceptRad: 1e-6 }
  const cam2 = tilted(-19.7012, 4.2, 1.046285, 56.0)
  assert.equal(pickCentre(centreHitOf(cam2), span, ret, cam2).retainedHolds, true)
  const mare = pickCentre(hit, span, { id: 'oceanus-procellarum', acceptRad: 0.5 }, cam)
  assert.equal(mare.choice?.label.name, 'Copernicus'); assert.equal(mare.retainedHolds, false)
  // Through the controller: the first pause names Copernicus.
  const host = new FakeHost(); const ctl = new CentreCaption(host)
  host.cam = cam; host.result = { kind: 'hit', cam, rangeRadii: Math.hypot(...hitPoint(cam)), w: 1440, h: 900 }
  ctl.sawCamera(cam, 0)
  assert.equal(run(ctl, 0, 2300).text, 'Copernicus')
}
function hitPoint(cam: CamSample): [number, number, number] {
  const p = raySphereV(cam.pos, centreDir(cam), 1)!
  return [p[0] - cam.pos[0], p[1] - cam.pos[1], p[2] - cam.pos[2]]
}

{
  // A nadir view over the mare still says the mare; and over a grid of nadir views the prominence rule changes an answer only to a crater that really is prominent.
  assert.equal(pickCentre(centreHitOf(camOver(-15, 30, 3000)), 3000, null, camOver(-15, 30, 3000)).choice?.label.name, 'Mare Imbrium')
  assert.equal(pickCentre(exact(imbrium), 3000, null, camOver(imbrium.lon, imbrium.lat, 3000)).choice?.label.name, 'Mare Imbrium')
  let changed = 0, same = 0
  for (const span of [60, 600, 2200]) for (let lon = -170; lon < 180; lon += 9.7) for (let lat = -80; lat <= 80; lat += 8.3) {
    const cam = camOver(lon, lat, span)
    const a = pickCentre(exact({ lon, lat }, 0), span), b = pickCentre(exact({ lon, lat }, 0), span, null, cam)
    if (a.choice?.label.id === b.choice?.label.id && a.status === b.status) { same++; continue }
    changed++
    assert.equal(b.choice?.mode, 'prominent', `${lon},${lat} span ${span}`)
    assert.equal(b.choice?.label.kind, 'crater')
    if (a.choice) assert.ok(a.choice.mode === 'near' || a.choice.label.sizeKm! > b.choice!.label.sizeKm!, 'only a nearest guess or a larger feature gives way')
  }
  assert.ok(same > 500, `most views are unchanged (${same} same, ${changed} changed)`)
}

{
  // Two similar craters near the centre keep a stable pick: the retained one stays through small pans, and a fresh pick does not alternate with noise.
  const craters = LABELS.filter((l) => l.kind === 'crater' && classOf(l) === 'disc' && l.sizeKm! >= 40 && l.sizeKm! <= 120 && l.featureType === 'Crater, craters')
  let pair: [MoonLabel, MoonLabel] | null = null
  for (let i = 0; i < craters.length && !pair; i++) for (let j = i + 1; j < craters.length && !pair; j++) {
    const a = craters[i], b = craters[j]
    const ua = unitVector(a.lat, a.lon), ub = unitVector(b.lat, b.lon)
    const dKm = Math.acos(Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2]))) * R_KM
    const ra = a.sizeKm! / 2, rb = b.sizeKm! / 2
    if (Math.abs(a.sizeKm! - b.sizeKm!) < 0.15 * a.sizeKm! && dKm > ra + rb + 6 && dKm < ra + rb + 14 && Math.abs(a.lat) < 50) pair = [a, b]
  }
  assert.ok(pair, 'a pair of similar neighbouring craters exists')
  const [a, b] = pair
  const mid = (t: number): { lon: number; lat: number } => ({ lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t })
  const span = 3.2 * a.sizeKm!
  let retained: { id: string; acceptRad: number } | null = null
  const names: string[] = []
  // Pan back and forth across the midpoint in small steps; each pick sees the previous name.
  for (const t of [0.5, 0.52, 0.48, 0.55, 0.45, 0.5, 0.53, 0.47, 0.5]) {
    const m = mid(t), cam = camOver(m.lon, m.lat, span)
    const r = pickCentre(centreHitOf(cam), span, retained, cam)
    const id = r.retainedHolds && retained ? retained.id : r.choice?.label.id
    assert.ok(id, 'a name at the midpoint')
    names.push(id!)
    const lab = labelById(id!)!
    retained = { id: id!, acceptRad: (lab.sizeKm! / 2 / R_KM) * (1 + HYST) }
  }
  assert.equal(new Set(names).size, 1, `stable: ${names.join(', ')}`)
}

{
  // The owner's Copernicus fly view through the REAL pose path (the link's lon/lat/dist/roll/pitch, restoreTilt, the free orientation `off`, the aim shift, the
  // ephemeris of the link's `t`), on desktop, a portrait phone and a landscape phone. Phones cannot read the hit target, so this is the CPU-estimate path: with
  // the height map pending (unknown hit) and with a map loaded, the caption must say Copernicus, not the mare under the centre.
  const e = ephemerisAt(new Date('2026-10-20T18:15:11Z'))
  const ownerSample = (w: number, h: number, aim: number): CamSample => {
    const rig = new CameraRig(); rig.setFloor(1.0001)
    rig.setPose({ lon: -19.7012, lat: 4.32646, dist: 1.046285, roll: -0.6, pitch: 56.47 })
    rig.restoreTilt(56.47)
    rig.setFreeOrientation([-0.019276, -0.000773, 0.040057, 0.999011])
    rig.aimShift = aim
    assert.ok(Math.abs(rig.pose.dist - 1.046285) < 1e-6, 'the pose reached the link\'s distance')
    return toMoonSample(rig.camera(e, w / h, 0), e, w / h)
  }
  for (const [w, h] of [[1440, 900], [390, 844], [844, 390]]) for (const aim of [0, 0.1, 0.15]) {
    const cam = ownerSample(w, h, aim)
    const span = sampleSpanKm(cam)
    for (const src of [flat(4, true), flat(4, false)]) {
      const hit = fallbackHit(cam.pos, centreDir(cam), src, 1)
      assert.equal(pickCentre(hit, span, null, cam).choice?.label.name, 'Copernicus', `${w}x${h} aim ${aim} pending=${src.pending}`)
    }
    // The controller with no read at all (a phone class): the name appears on the pause, from the CPU estimate.
    const host = new FakeHost(); host.cam = cam; host.readableDevice = false
    host.fb = (s) => fallbackHit(s.pos, centreDir(s), flat(4, true), 1)
    const ctl = new CentreCaption(host)
    ctl.sawCamera(cam, 0)
    let first: number | null = null, text = ''
    for (let t = 0; t <= 3000 && first === null; t += 16) { const v = ctl.step(t, CTX); if (v.visible) { first = t; text = v.text } }
    assert.ok(first !== null && first <= 2016, `${w}x${h} aim ${aim}: first visible frame ${first}`)
    assert.equal(text, 'Copernicus'); assert.equal(host.reads, 0)
  }
}

{
  // 2. Owner 2026-10-31: arriving at a viewpoint or pin names its feature too, even though the pill names it (it used to stay quiet there). The viewpoint's
  // feature ids are an explicit list (never a name match), and the picker prefers them (PREFER_BOOST).
  const FC = ['copernicus']
  const a = setup(); a.host.cam = camOver(copernicus.lon, copernicus.lat, 40)
  const v = run(a.ctl, 0, STILL_MS + 100, { viewpointFeatures: FC })
  assert.equal(v.visible, true); assert.equal(v.text, 'Copernicus')
  // Another viewpoint's feature changes nothing; a viewpoint that becomes active under a shown name keeps it (no fade).
  assert.equal(run(setup().ctl, 0, STILL_MS + 100, { viewpointFeatures: ['tycho'] }).text, 'Copernicus')
  const c = setup(); run(c.ctl, 0, STILL_MS + 100)
  const kept = run(c.ctl, STILL_MS + 116, STILL_MS + 116 + FADE_OUT_MS + 32, { viewpointFeatures: FC })
  assert.equal(kept.visible, true); assert.equal(kept.text, 'Copernicus')
  // A different, better-fitting feature at the same place (Copernicus A under the Copernicus viewpoint at a 40 km span) is still named.
  const d = setup(camOver(copA.lon, copA.lat, 40)); d.host.cam = camOver(copA.lon, copA.lat, 40)
  assert.equal(run(d.ctl, 0, STILL_MS + 100, { viewpointFeatures: FC }).text, 'Copernicus A')
  // The preference: walking north from Copernicus at a 251 km span (1.27 radii), the first hit where another feature wins on its own is named Copernicus
  // while the Copernicus viewpoint is active.
  let flipped = false
  for (let km = 40; km <= 120 && !flipped; km += 2) {
    const h = exact({ lon: copernicus.lon, lat: copernicus.lat + km / R_KM / RAD }, 0.05)
    const plain = pickCentre(h, 251), pref = pickCentre(h, 251, null, null, FC)
    if (plain.status === 'ok' && plain.choice!.label.id !== 'copernicus') { flipped = true; assert.equal(pref.choice?.label.name, 'Copernicus', `${km} km north: ${plain.choice!.label.name}`) }
  }
  assert.ok(flipped, 'a hit where Copernicus wins only by the preference exists')
  // The map: every key is a real viewpoint entry, every id a real feature; the false matches a name comparison would make are NOT in it.
  const entryIds = new Set(VIEWPOINT_ENTRIES.map((e) => e.id))
  for (const [entry, ids] of Object.entries(VIEWPOINT_FEATURES)) { assert.ok(entryIds.has(entry), entry); for (const id of ids) assert.ok(labelById(id), id) }
  assert.ok(!('rille-run' in VIEWPOINT_FEATURES), 'Hadley Rille left the viewpoint list')
  const mons = LABELS.find((l) => l.name === 'Mons Hadley')!, rimae = LABELS.find((l) => /^Rimae? Plato$/.test(l.name) || l.name === 'Rimae Plato')
  assert.ok(mons && !['rima-hadley'].includes(mons.id), 'Mons Hadley is not Hadley Rille')
  assert.ok(!('pin-plato' in VIEWPOINT_FEATURES), 'Plato left the viewpoint list'); if (rimae) assert.ok(!PLATO_VIEWPOINT.includes(rimae.id), 'Rimae Plato is not Plato')
  // Fit scoring: Mons Hadley (26 km) inside the Mare Imbrium disc is named in a frame it fits; from far away the mare is.
  assert.equal(mons.id, 'mons-hadley')
  assert.equal(pickCentre(exact(mons), 30).choice?.label.name, 'Mons Hadley', 'a 30 km frame on Mons Hadley names it, not the 1,146 km mare')
  assert.equal(pickCentre(exact(mons), 800).choice?.label.name, 'Mare Imbrium')
  // The Plato viewpoint's preference names Plato on arrival, and without it Plato is named as well.
  const plato = LABELS.find((l) => l.id === 'plato')!
  const pc = camOver(plato.lon, plato.lat, 270)
  assert.equal(run(setup(pc).ctl, 0, STILL_MS + 100, { viewpointFeatures: PLATO_VIEWPOINT }).text, 'Plato')
  assert.equal(run(setup(pc).ctl, 0, STILL_MS + 100, { viewpointFeatures: null }).text, 'Plato')
}

{
  // Keyboard flight leaves the viewpoint: every free-flight key marks the navigator away through the shared hook (arrows and zoom keys already did in main).
  for (const key of ['w', 'W', 'a', 'A', 's', 'd', 'D', 'q', 'Q', 'e', 'E', 'r', 'R']) assert.equal(isFlyKey({ key }), true, key)
  for (const key of ['S', 'h', 'n', 't', 'i', '[', ']', 'ArrowLeft', 'Escape']) assert.equal(isFlyKey({ key }), false, key)
  const controls = readFileSync(new URL('../src/camera/controls.ts', import.meta.url), 'utf8')
  assert.match(controls, /if \(isFlyKey\(e\)\) hooks\.manual\?\.\(\)/)
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(main, /manual: \(\) => navApi\?\.away\(\)/)
  // With the navigator away the controller gets no viewpoint features, and the caption shows.
  assert.equal(run(setup().ctl, 0, 2300, { viewpointFeatures: null }).text, 'Copernicus')
}

{
  // Uncertainty never promotes to a larger container: 20 m inside Copernicus A's rim at a 40 km span, raising the hit error must not turn A into Copernicus.
  const cam = camOver(copA.lon, copA.lat, 40)
  const rKm = radiusRad({ sizeKm: copA.sizeKm! }) * R_KM
  const at = (errKm: number): CentreHit => ({ lonDeg: copA.lon + kmToLon(rKm - 0.02, copA.lat), latDeg: copA.lat, errKm, fallback: false })
  assert.equal(pickCentre(at(0.001), 40, null, cam).choice?.label.name, 'Copernicus A')
  for (const err of [0.003, 0.01, 0.05, 0.2]) {
    const r = pickCentre(at(err), 40, null, cam)
    assert.notEqual(r.choice?.label.name, 'Copernicus', `error ${err} km must not promote to the larger container`)
    // Fit scoring is continuous across a rim (RIM_SCORE), so a rim is no longer a decision boundary by itself: A is certain here, or refused, never Copernicus.
    assert.ok(r.status === 'uncertain' || r.choice?.label.name === 'Copernicus A', `error ${err}: ${r.status} ${r.choice?.label.name}`)
  }
  // Where the answer does change (the score boundary east of A, found by bisection), raising the error makes the pick uncertain, never Copernicus.
  const lonB = copABoundaryLon()
  const atB = (errKm: number): CentreHit => ({ lonDeg: lonB - kmToLon(0.02, copA.lat), latDeg: copA.lat, errKm, fallback: false })
  assert.equal(pickCentre(atB(0.001), 40, null, cam).choice?.label.name, 'Copernicus A')
  for (const err of [0.01, 0.05, 0.2]) assert.equal(pickCentre(atB(err), 40, null, cam).status, 'uncertain', `error ${err} at the boundary`)
  // A rejected NEAREST guess or a rejected larger feature may still give way to a prominent crater.
  const ownerLike = tilted(-19.7012, 3.8, 1.046285, 56.47)
  const h = centreHitOf(ownerLike)
  assert.equal(pickCentre({ ...h, errKm: 0.05 }, sampleSpanKm(ownerLike), null, ownerLike).choice?.label.name, 'Copernicus')
}

{
  // 3. Desktop 1440x900: with nothing in the way the name gets its whole natural width (no ellipsis), centred on the screen. A fractional measured width
  // is rounded up (a box a hair narrower than its text makes the ellipsis eat the last letters: "Oceanus Procellaru...").
  assert.ok(naturalWidth(150.4) >= 151.4); assert.equal(naturalWidth(150), 152)
  const base: ClearanceInput = { viewportW: 1440, insetL: 0, insetR: 0, pad: 18, rowTop: 770, rowBottom: 792, rects: [], textW: naturalWidth(150.4), minW: MIN_CAPTION_W }
  const p = placeCaption(base)!
  assert.ok(p.width >= 150.4, `not narrower than its text: ${p.width}`); assert.equal(p.width, naturalWidth(150.4))
  near(p.left, 720 - p.width / 2, 1e-9, 'centred on the screen')
  // The closed pad's toggle at the right corner, and the pill-wide dock: the row is not clamped to either.
  const withToggle = placeCaption({ ...base, rects: [{ left: 1384, top: 760, right: 1424, bottom: 800 }, { left: 520, top: 800, right: 920, bottom: 860 }] })!
  assert.equal(withToggle.width, base.textW)
  // A long name uses the whole safe interval, not a pill's width.
  const long = placeCaption({ ...base, textW: 2000 })!
  assert.equal(long.width, 1440 - 36)
}

{
  // Review: a read that cannot name anything must not block a certain CPU candidate. 20 m inside Copernicus A's rim the rendered pick is uncertain (a pixel
  // is wider than the margin) while the CPU estimate here is certain: the caption appears on the pause, and the read is tried again later.
  const lon = copABoundaryLon() - kmToLon(0.02, copA.lat)
  const cam = camOver(lon, copA.lat, 40)
  assert.equal(pickCentre(hitOfRead(nadirRead(cam) as Extract<ReadResult, { kind: 'hit' }>), 40, null, cam).status, 'uncertain', 'the rendered pick is uncertain here')
  const host = new FakeHost(); host.cam = cam
  host.fb = () => ({ lonDeg: lon, latDeg: copA.lat, errKm: 0.001, fallback: false })
  const ctl = new CentreCaption(host)
  ctl.sawCamera(cam, 0)
  const t = firstVisible(ctl, 8000)
  assert.ok(t !== null && t <= 2016, `appears on the pause (${t})`)
  assert.equal(ctl.current?.text, 'Copernicus A')
  assert.ok(host.fallbacks >= 1)
  assert.ok(ctl.stats.why.readNamedNothing >= 1, 'the empty read was dropped, not cached')
  for (let x = 8016; x <= 12000; x += 16) ctl.step(x, CTX)
  assert.ok(host.reads >= 2, `the read is tried again later (${host.reads})`)
}

{
  // Review: the confirmation of a CPU-estimate name stays pending independently of the CPU agreeing with it, keeps polling, and keeps the retry promise.
  const a = setup()
  a.host.pendingPolls = 1e9 // the first read never lands (it times out at 600 ms)
  for (let t = 0; t <= 2600; t += 16) a.ctl.step(t, CTX)
  assert.equal(a.ctl.current?.text, 'Copernicus')
  a.host.pendingPolls = 0 // later reads land at once
  for (let t = 2616; t <= 6500; t += 16) { const v = a.ctl.step(t, CTX); assert.equal(v.visible, true, `stays up at ${t}`) }
  assert.ok(a.ctl.stats.readHits >= 1, `a read that lands after 2.5 s is consumed (${a.ctl.stats.readHits})`)
  // A refused read is retried (the promise is kept) while the confirmation is pending.
  const b = setup(); b.host.canRead = false
  for (let t = 0; t <= 2600; t += 16) b.ctl.step(t, CTX)
  assert.equal(b.ctl.current?.text, 'Copernicus'); assert.equal(b.host.reads, 0)
  b.host.canRead = true
  for (let t = 2616; t <= 7000; t += 16) b.ctl.step(t, CTX)
  assert.ok(b.host.reads >= 1 && b.ctl.stats.readHits >= 1, `the refused read was retried and consumed (${b.host.reads}, ${b.ctl.stats.readHits})`)
}

{
  // Review: an unknown hit cannot promote past a smaller container, and a prominence-only pick made from one is provisional: a later certain hit inside a smaller
  // container replaces it (retention does not shield it), through the normal fade.
  const above = camOver(copA.lon, copA.lat, 40)
  const unknown: CentreHit = { lonDeg: copA.lon, latDeg: copA.lat, errKm: Infinity, fallback: true }
  const noName = pickCentre(unknown, 40, null, above)
  assert.notEqual(noName.choice?.label.name, 'Copernicus', 'the smaller container (A) is protected against an unknown hit')
  // A provisional prominence pick: the owner pose with the height map pending.
  const e = ephemerisAt(new Date('2026-10-20T18:15:11Z'))
  const rig = new CameraRig(); rig.setFloor(1.0001)
  rig.setPose({ lon: -19.7012, lat: 4.32646, dist: 1.046285, roll: -0.6, pitch: 56.47 }); rig.restoreTilt(56.47)
  rig.setFreeOrientation([-0.019276, -0.000773, 0.040057, 0.999011])
  const owner = toMoonSample(rig.camera(e, 1440 / 900, 0), e, 1440 / 900)
  const pending = fallbackHit(owner.pos, centreDir(owner), flat(4, true), 1)
  const first = pickCentre(pending, sampleSpanKm(owner), null, owner)
  assert.equal(first.choice?.label.name, 'Copernicus'); assert.equal(first.choice?.provisional, true)
  // Directly above A: the retained provisional Copernicus gives way to a certain hit inside A; a non-provisional one is kept (the old no-jump rule).
  const certainInA: CentreHit = { lonDeg: copA.lon, latDeg: copA.lat, errKm: 0.01, fallback: false }
  const acceptRad = radiusRad({ sizeKm: copernicus.sizeKm! }) * (1 + HYST)
  const shielded = pickCentre(certainInA, 40, { id: 'copernicus', acceptRad }, above)
  assert.equal(shielded.retainedHolds, true, 'a confirmed retained name still holds (no jump on a pan)')
  const provisional = pickCentre(certainInA, 40, { id: 'copernicus', acceptRad, provisional: true }, above)
  assert.equal(provisional.retainedHolds, false); assert.equal(provisional.choice?.label.name, 'Copernicus A')
  // Through the controller: the provisional name is replaced by the normal fade, then A fades in (never a pop).
  const host = new FakeHost(); host.cam = above
  host.fb = () => unknown
  host.readableDevice = true
  const ctl = new CentreCaption(host)
  ctl.sawCamera(above, 0)
  // (the estimate is unknown, the first read is slow) -- nothing may be named from an unknown hit above A
  host.pendingPolls = 1e9
  assert.equal(firstVisible(ctl, 3000), null)
  host.pendingPolls = 0
  const seen: string[] = []
  for (let t = 3016; t <= 9000; t += 16) { const v = ctl.step(t, CTX); if (v.text && !seen.includes(v.text)) seen.push(v.text) }
  assert.deepEqual(seen, ['Copernicus A'])
}

{
  // Occlusion: a rendered range SHORT of the independently predicted range (CPU height sample, same relief scale, same texel ray) means terrain in front of the
  // crater. Ordinary elevation and depressions move the hit along the ray but not short of the prediction. All with rendered hits at 2880 x 1800 (the real
  // off-centre texel), the owner pose, aim shift 0.15 (where the plain pick is the mare).
  const e = ephemerisAt(new Date('2026-10-20T18:15:11Z'))
  const rig = new CameraRig(); rig.setFloor(1.0001)
  rig.setPose({ lon: -19.7012, lat: 4.32646, dist: 1.046285, roll: -0.6, pitch: 56.47 }); rig.restoreTilt(56.47)
  rig.setFreeOrientation([-0.019276, -0.000773, 0.040057, 0.999011]); rig.aimShift = 0.15
  const cam = toMoonSample(rig.camera(e, 1440 / 900, 0), e, 1440 / 900)
  const span = sampleSpanKm(cam)
  const W = 2880, H = 1800, ix = W / 2, iy = H / 2
  const { dir } = texelRay(cam, W, H, ix, iy)
  const renderedAt = (hKm: number): Extract<ReadResult, { kind: 'hit' }> => {
    const pt = raySphereV(cam.pos, dir, 1 + hKm / R_KM)!
    return { kind: 'hit', cam, rangeRadii: Math.hypot(pt[0] - cam.pos[0], pt[1] - cam.pos[1], pt[2] - cam.pos[2]), w: W, h: H, ix, iy }
  }
  const predictFor = (hKm: number) => (pos: readonly [number, number, number], d: readonly [number, number, number]): CentreHit => fallbackHit(pos, d, { sampleM: () => hKm * 1000, pending: false, halfErrorM: 4 }, 1)
  const nameFor = (renderedKm: number, cpuKm: number | 'pending'): { name?: string; occluded?: number } => {
    const predict = cpuKm === 'pending' ? (pos: readonly [number, number, number], d: readonly [number, number, number]) => fallbackHit(pos, d, flat(4, true), 1) : predictFor(cpuKm)
    const hit = withOcclusion(hitOfRead(renderedAt(renderedKm)), predict)
    return { name: pickCentre(hit, span, null, cam).choice?.label.name, occluded: hit.occludedKm }
  }
  // Rendered and predicted agree (any ordinary elevation, even a depression whose hit lands 6 km farther along the ray): prominence stands.
  for (const km of [-3.5, -2, 0, 1]) { const r = nameFor(km, km); assert.equal(r.name, 'Copernicus', `surface at ${km} km`); assert.equal(r.occluded, undefined) }
  // Relief the retained map does not carry (1 km, about 2 km along the ray) is within the slack.
  assert.equal(nameFor(1, 0).name, 'Copernicus')
  // A pending height map gives no prediction and no test.
  assert.equal(nameFor(-3.5, 'pending').name, 'Copernicus')
  // A genuinely nearer obstruction (a 6 km ridge the map does not know): the rendered range is far short of the prediction, and prominence is skipped.
  const ridge = nameFor(6, 0)
  assert.ok((ridge.occluded ?? 0) > 0, 'obstruction detected'); assert.notEqual(ridge.name, 'Copernicus')
  // Through the controller (rendered hits are used first; the estimate here is unknown).
  const run1 = (renderedKm: number, cpuKm: number): string => {
    const host = new FakeHost(); host.cam = cam
    host.predict = predictFor(cpuKm)
    host.fb = () => ({ lonDeg: NaN, latDeg: NaN, errKm: Infinity, fallback: true })
    host.result = renderedAt(renderedKm)
    const ctl = new CentreCaption(host)
    ctl.sawCamera(cam, 0)
    for (let t = 0; t <= 2600; t += 16) ctl.step(t, CTX)
    return ctl.current?.text ?? ''
  }
  assert.equal(run1(-3.5, -3.5), 'Copernicus')
  assert.notEqual(run1(6, 0), 'Copernicus')
}

// ---------------------------------------------------------------------------------------------------------------------
// Clearance (reviewer override 4)
// ---------------------------------------------------------------------------------------------------------------------
{
  const base: ClearanceInput = { viewportW: 915, insetL: 47, insetR: 47, pad: 12, rowTop: 300, rowBottom: 322, rects: [], textW: 200, minW: MIN_CAPTION_W }
  // Landscape phone with notch insets: the row is limited to them, and the name stays centred on the screen when it fits.
  const p0 = placeCaption(base)!
  near(p0.left, 915 / 2 - 100, 1e-9, 'centred on the screen'); assert.equal(p0.width, 200)
  const wide = placeCaption({ ...base, textW: 2000 })!
  assert.ok(wide.left >= 47 && wide.left + wide.width <= 915 - 47, 'never under the notch insets')
  assert.equal(wide.width, 915 - 94)
  // The visible pad (not its zero-size anchor) and the transformed toggle carve the row; a pad at the right pushes nothing out of the centre.
  const pad: Rect = { left: 720, top: 150, right: 868, bottom: 330 }
  const p1 = placeCaption({ ...base, rects: [pad] })!
  near(p1.left, 915 / 2 - 100, 1e-9, 'still centred'); assert.ok(p1.left + p1.width <= pad.left - 8)
  // A pad in the middle of the row moves the name into the widest remaining interval, centred there.
  const mid: Rect = { left: 300, top: 290, right: 600, bottom: 340 }
  const p2 = placeCaption({ ...base, rects: [mid] })!
  assert.ok(p2.left >= 608 && p2.left + p2.width <= 868, `right interval ${p2.left}`)
  // A rect above the row (the popup open higher up) does not matter; one on the row does.
  assert.equal(placeCaption({ ...base, rects: [{ left: 0, top: 100, right: 915, bottom: 250 }] })!.width, 200)
  // No interval of MIN_CAPTION_W: suppressed.
  assert.equal(placeCaption({ ...base, rects: [{ left: 40, top: 290, right: 880, bottom: 340 }] }), null)
  assert.equal(placeCaption({ ...base, viewportW: 150, insetL: 47, insetR: 47 }), null)
  // Portrait phone: pad open at the right bottom, popup across the row.
  const portrait: ClearanceInput = { viewportW: 412, insetL: 0, insetR: 0, pad: 12, rowTop: 700, rowBottom: 722, rects: [{ left: 240, top: 560, right: 400, bottom: 740 }], textW: 260, minW: MIN_CAPTION_W }
  const p3 = placeCaption(portrait)!
  assert.deepEqual(p3, { left: 12, width: 220 }, 'the interval left of the open pad, text ellipsised to it')
  assert.equal(placeCaption({ ...portrait, rects: [{ left: 0, top: 690, right: 412, bottom: 730 }] }), null)
}

{
  // The tracker recomputes when told, even while the caption stays shown, and until transitions settle.
  const rects: Rect[] = []
  const measure = (): ClearanceInput => ({ viewportW: 915, insetL: 47, insetR: 47, pad: 12, rowTop: 300, rowBottom: 322, rects: [...rects], textW: 200, minW: MIN_CAPTION_W })
  const rc = new RowClearance()
  assert.equal(rc.refresh(0, measure), true)
  const centred = rc.placement!.left
  rects.push({ left: 400, top: 295, right: 520, bottom: 330 })
  assert.equal(rc.refresh(16, measure), false, 'nothing told: no work')
  rc.invalidate()
  assert.equal(rc.refresh(32, measure), true, 'a popup shown')
  assert.notEqual(rc.placement!.left, centred)
  rects[0] = { left: 150, top: 295, right: 700, bottom: 330 }
  rc.invalidate()
  assert.equal(rc.refresh(48, measure), true, 'popup content changed')
  rc.transition(100)
  rects[0] = { left: 150, top: 295, right: 640, bottom: 330 }
  assert.equal(rc.refresh(116, measure), true, 'a control in transition')
  assert.equal(rc.needsRefresh(300), true, 'still settling')
  rects[0] = { left: 150, top: 295, right: 600, bottom: 330 }
  assert.equal(rc.refresh(300, measure), true, 'the pad moved again without any event')
  assert.equal(rc.needsRefresh(100 + 450 + 1), false)
  rects.length = 0
  rc.invalidate()
  assert.equal(rc.refresh(700, measure), true, 'popup hidden')
  near(rc.placement!.left, centred, 1e-9, 'back to the centre')
  assert.equal(rc.refresh(716, measure), false)
  // Idle or moving: no layout reads at all until something tells it.
  let reads = 0
  const counted = (): ClearanceInput => { reads++; return measure() }
  for (let t = 800; t < 5000; t += 16) rc.refresh(t, counted)
  assert.equal(reads, 0)
  assert.equal(rc.input?.rowBottom, 322)
}

{
  // The element adds nothing to the dock's height (so --dock-top, --caption-h, the pad and the bar never move) and is plain text.
  const css = readFileSync(new URL('../src/ui/centreCaption.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(css, /\.centre-caption\s*\{[^}]*position:\s*absolute/)
  assert.match(css, /bottom:\s*calc\(100%\s*\+\s*8px\)/)
  assert.match(css, /text-shadow/)
  assert.match(css, /background:\s*none/); assert.match(css, /border:\s*0/); assert.match(css, /box-shadow:\s*none/)
  assert.doesNotMatch(css, /backdrop-filter|border-radius|::before|::after/)
  const dock = readFileSync(new URL('../src/ui/dock.ts', import.meta.url), 'utf8')
  assert.match(dock, /:scope > \.caption'/, 'the caption band sums only .caption children')
  const ui = readFileSync(new URL('../src/ui/centreCaption.ts', import.meta.url), 'utf8')
  assert.match(ui, /className = 'centre-caption'/)
  assert.doesNotMatch(ui, /className = 'caption/)
  assert.doesNotMatch(ui, /data-touch-controls/, 'measures the visible pad and toggle, not the zero-size anchor')
  assert.match(ui, /'\.touch-ctl-pad', '\.tc-toggle'/)
  assert.doesNotMatch(ui, /attributeFilter:[^\]]*'style'/, 'the stick rewrites style on every pointer move: not observed')
  assert.doesNotMatch(ui, /subtree: true[^}]*\}[^]*?'#hud'/, 'the HUD rewrites its text every frame: not observed')
  assert.doesNotMatch(ui.slice(ui.lastIndexOf('apply(view')), /getBoundingClientRect/, 'no layout read per frame in apply')
  // GATE is the plan's, and a hit as uncertain as the gate allows is refused.
  assert.equal(GATE, 0.25)
  assert.ok(labelById('copernicus'))
}

{
  // The async read takes the centre texel (x, y), not the origin, and never blocks (it polls with a zero timeout).
  const calls: string[] = []
  const gl = {
    PIXEL_PACK_BUFFER: 1, STREAM_READ: 2, RGBA: 3, FLOAT: 4, SYNC_GPU_COMMANDS_COMPLETE: 5, ALREADY_SIGNALED: 6, CONDITION_SATISFIED: 7,
    createBuffer: () => ({}), deleteBuffer: () => calls.push('deleteBuffer'), bindBuffer: () => undefined, bufferData: () => undefined,
    readPixels: (x: number, y: number, w: number, h: number) => calls.push(`readPixels ${x},${y} ${w}x${h}`),
    fenceSync: () => ({}), deleteSync: () => undefined, flush: () => undefined,
    clientWaitSync: (_s: unknown, _f: number, timeout: number) => { calls.push(`wait ${timeout}`); return 6 },
    getBufferSubData: (_t: number, _o: number, dst: Float32Array) => { dst[0] = 0.04; dst[1] = 1 },
  } as unknown as ReadGl
  const read = new AsyncTexelRead(), out = new Float32Array(4)
  assert.equal(read.begin(gl, 1, 1, 960, 540), true)
  assert.equal(read.begin(gl, 1, 1, 960, 540), false, 'one read at a time')
  assert.equal(read.poll(gl, out), true)
  assert.deepEqual(calls.filter((c) => c.startsWith('readPixels') || c.startsWith('wait')), ['readPixels 960,540 1x1', 'wait 0'])
  near(out[0], 0.04, 1e-6, 'range'); assert.equal(out[1], 1)
}

// ---------------------------------------------------------------------------------------------------------------------
// Timing after the user stops: the rig flags the tail of an input (coast, level); the clock starts at the last user input
// ---------------------------------------------------------------------------------------------------------------------
{
  const TAU = 350, V0 = 8 // deg/s at release; rig.ts: tau 0.35 s, inertia stops below 0.5 deg/s, then a 500 ms smootherstep level
  const D = V0 * TAU / 1000
  const stopAt = TAU * Math.log(V0 / 0.5), LEVEL_MS = 500, ROLL0 = 3
  const ss = (u: number): number => { const x = Math.max(0, Math.min(1, u)); return x * x * x * (x * (x * 6 - 15) + 10) }
  const lonAt = (t: number): number => t < 0 ? copernicus.lon - D + V0 * t / 1000 : copernicus.lon - D * Math.exp(-Math.min(t, stopAt) / TAU)
  const withRoll = (c: CamSample, deg: number): CamSample => {
    const th = deg * RAD, b = c.back, u = c.up
    const x: [number, number, number] = [b[1] * u[2] - b[2] * u[1], b[2] * u[0] - b[0] * u[2], b[0] * u[1] - b[1] * u[0]]
    return { ...c, up: [u[0] * Math.cos(th) + x[0] * Math.sin(th), u[1] * Math.cos(th) + x[1] * Math.sin(th), u[2] * Math.cos(th) + x[2] * Math.sin(th)] }
  }
  interface Frame { cam: CamSample; settling: boolean }
  /** The first time the name is visible, stepping every `dt` ms from -200 (the drag) to `end`; frames inside `hitch` are skipped; `inputs` are user input times. */
  const firstVisible = (frameAt: (t: number) => Frame, dt: number, end: number, opts: { hitch?: [number, number]; inputs?: number[]; live?: boolean } = {}): number | null => {
    const host = new FakeHost(), ctl = opts.live ? new LiveCaption(host) : new CentreCaption(host)
    for (let t = -200; t <= end; t += dt) {
      if (opts.hitch && t > opts.hitch[0] && t < opts.hitch[1]) continue
      const f = frameAt(t); host.cam = f.cam
      const inputAt = Math.max(-Infinity, ...(opts.inputs ?? []).filter((i) => i <= t))
      ctl.sawCamera(f.cam, t, 0, f.settling, inputAt)
      if (ctl.step(t, { ...CTX, dragging: t < 0 }).visible) return t
    }
    return null
  }
  /** Drag until 0 (not settling), release at 0 (input at 0), the coast to 0.5 deg/s, then the 500 ms level; settling throughout. */
  const real = (t: number): Frame => ({
    cam: withRoll(camOver(lonAt(t), copernicus.lat, 40), t < stopAt ? ROLL0 : ROLL0 * (1 - ss((t - stopAt) / LEVEL_MS))),
    settling: t >= 0 && t < stopAt + LEVEL_MS,
  })
  for (const dt of [8, 16, 50]) {
    const v = firstVisible(real, dt, 4000, { inputs: [0] })
    assert.ok(v !== null && v >= 1900 && v <= 2300, `coast + level at ${dt} ms frames: name at ${v}`)
  }
  const hitch = firstVisible(real, 16, 4000, { inputs: [0], hitch: [300, 550] })
  assert.ok(hitch !== null && hitch >= 1900 && hitch <= 2300, `a 250 ms hitch in the coast: name at ${hitch}`)
  const hitch2 = firstVisible(real, 16, 4000, { inputs: [0], hitch: [stopAt + 100, stopAt + 350] })
  assert.ok(hitch2 !== null && hitch2 >= 1900 && hitch2 <= 2300, `a 250 ms hitch in the level: name at ${hitch2}`)

  // Live pause (0.5 s): the deadline falls inside the coast, but nothing is picked while the tail still moves the camera; the name comes as the camera comes
  // to rest (review of #402: a mid-coast pick named a pose 0.1 frame short of where the camera stopped).
  for (const dt of [8, 16, 50]) {
    const v = firstVisible(real, dt, 4000, { inputs: [0], live: true })
    assert.ok(v !== null && v >= stopAt + LEVEL_MS - 50 && v <= stopAt + LEVEL_MS + 250, `live: coast + level at ${dt} ms frames: name at ${v} (tail ends ${stopAt + LEVEL_MS})`)
  }

  // Without the flag the same trace restarts through the tail (what the owner saw).
  const unflagged = firstVisible((t) => ({ ...real(t), settling: false }), 16, 6000, { inputs: [0] })
  assert.ok(unflagged !== null && unflagged >= stopAt + LEVEL_MS + 1900, `unflagged: name at ${unflagged}`)

  // New user input in the middle of the settle restarts the clock: a key at 500 ms puts the name 2 s after it.
  const keyed = firstVisible(real, 16, 5000, { inputs: [0, 500] })
  assert.ok(keyed !== null && keyed >= 2500 && keyed <= 2800, `input mid-settle: name at ${keyed}`)

  // A flight (not flagged): the name is due 2 s after the flight ENDS, as for a user (it ends at 1500 ms).
  const flight = firstVisible((t) => ({ cam: camOver(copernicus.lon - 0.7 * (1 - ss(t / 1500)), copernicus.lat, 40), settling: false }), 16, 6000)
  assert.ok(flight !== null && flight >= 3450 && flight <= 3800, `flight: name at ${flight}`)

  // A fresh slow drift from rest is real motion: nothing is shown while it lasts.
  const slow = firstVisible((t) => ({ cam: camOver(copernicus.lon + 0.3 * (Math.min(Math.max(t, 1000), 3000) - 1000) / 1000, copernicus.lat, 40), settling: false }), 16, 3000)
  assert.equal(slow, null, `slow drift: name at ${slow}`)
}

{
  // F5: on a 390 px phone the brand line (x 12..192) stands in the caption's row: the name keeps right of it, or is dropped when it cannot fit.
  const base: ClearanceInput = { viewportW: 390, insetL: 0, insetR: 0, pad: 12, rowTop: 770, rowBottom: 792, rects: [{ left: 12, top: 774, right: 192, bottom: 789 }], textW: 140, minW: MIN_CAPTION_W }
  const p = placeCaption(base)
  assert.ok(p && p.left >= 200 && p.left + p.width <= 378, `a 140 px name stands right of the brand line: ${JSON.stringify(p)}`)
  assert.equal(placeCaption({ ...base, rects: [{ left: 12, top: 774, right: 300, bottom: 789 }] }), null, 'no room beside a long brand line: the credit wins, the name is dropped')
  const src = readFileSync(new URL('../src/ui/centreCaption.ts', import.meta.url), 'utf8')
  assert.match(src, /ROW_SELECTORS = \[[^\]]*'#credit'/, 'the brand line is measured as a row obstacle')
  assert.match(src, /'#credit': \{ attributes: true, attributeFilter: \[[^\]]*'data-brand'/, 'and watched for its fade')
}

// ---------------------------------------------------------------------------------------------------------------------
// Owner feedback 2026-10-31 (phone walkthrough of cd2a4313): when, where and what the lock label names. Live timing (LIVE_STILL_MS), real rig poses,
// phone 412 x 915 portrait and desktop 1280 x 800.
// ---------------------------------------------------------------------------------------------------------------------
{
  const e = ephemerisAt(new Date('2026-10-20T19:00:00Z'))
  const SCREENS: Array<[number, number]> = [[412, 915], [1280, 800]]
  const poseCam = (p: { lon: number; lat: number; dist: number; pitch?: number; fov?: number }, w: number, h: number): CamSample => {
    const rig = new CameraRig(); rig.setFloor(1.0001)
    if (p.fov) rig.fovDeg = p.fov
    rig.setPose({ lon: p.lon, lat: p.lat, dist: p.dist, roll: 0, pitch: p.pitch ?? 0 }); rig.restoreTilt(p.pitch ?? 0)
    return toMoonSample(rig.camera(e, w / h, 0), e, w / h)
  }
  /** The live controller over a camera, with the rendered hit (a read) or only the CPU estimate (a phone that cannot read). */
  const liveRun = (cam: CamSample, to: number, read: boolean, ctx: Partial<CaptionCtx> = {}): { ctl: LiveCaption; v: ReturnType<LiveCaption['step']>; first: number | null } => {
    const host = new FakeHost(); host.cam = cam; host.readableDevice = read; host.canRead = read
    host.result = { kind: 'hit', cam, rangeRadii: Math.hypot(...hitPoint(cam)), w: 1000, h: 1000 }
    host.fb = (sm) => fallbackHit(sm.pos, centreDir(sm), flat(4), 1)
    const ctl = new LiveCaption(host)
    ctl.sawCamera(cam, 0)
    let v = ctl.step(0, { ...CTX, ...ctx }), first: number | null = null
    for (let t = 16; t <= to; t += 16) { v = ctl.step(t, { ...CTX, ...ctx }); if (v.visible && first === null) first = t }
    return { ctl, v, first }
  }
  const nameAt = (p: Parameters<typeof poseCam>[0], w: number, h: number, read = true): string => liveRun(poseCam(p, w, h), 3000, read).v.text

  // A pitch-0 (nadir) rig view gives the CPU estimate a finite error: sin(elevation) rounds past 1 there, which made the error NaN (an unknown hit) on every
  // phone looking straight down.
  for (const fov of [30, 50]) for (const [w, h] of SCREENS) {
    const cam = poseCam({ lon: copernicus.lon, lat: copernicus.lat, dist: 1.3, fov }, w, h)
    const hit = fallbackHit(cam.pos, centreDir(cam), flat(4), 1)
    assert.ok(Number.isFinite(hit.errKm) && hit.errKm < 0.1, `nadir CPU estimate ${fov} ${w}x${h}: ${hit.errKm}`)
  }
  // Home: the whole Moon from afar is never named, on either screen, with or without reads.
  for (const [w, h] of SCREENS) for (const read of [true, false]) {
    const cam = poseCam(homePose(e), w, h)
    assert.ok(sampleSpanKm(cam) > MAX_SPAN_KM, `Home span ${sampleSpanKm(cam)} km`)
    const r = liveRun(cam, 5000, read)
    assert.equal(r.first, null, `Home ${w}x${h} read=${read}: no label`)
  }
  // The 900 km rule at live timing: the distance where the short side spans 890 km is named, 910 km is not (phone and desktop alike).
  for (const [w, h] of SCREENS) {
    const distFor = (spanKm: number): number => 1 + spanKm / (2 * Math.tan(15 * RAD) * R_KM)
    assert.equal(nameAt({ lon: copernicus.lon, lat: copernicus.lat, dist: distFor(890) }, w, h), 'Copernicus', `890 km ${w}x${h}`)
    assert.equal(nameAt({ lon: copernicus.lon, lat: copernicus.lat, dist: distFor(910) }, w, h), '', `910 km ${w}x${h}`)
  }

  // Timing: due LIVE_STILL_MS (0.5 s) into the pause, typed by the lock label HOLD_MS (0.3 s) later: on screen 0.8 s after the camera stops, not before.
  assert.equal(LIVE_STILL_MS + HOLD_MS, 800)
  {
    const cam = poseCam({ lon: copernicus.lon, lat: copernicus.lat, dist: 1.27 }, 412, 915)
    const r = liveRun(cam, 2000, false)
    assert.ok(r.first !== null && r.first >= LIVE_STILL_MS && r.first <= LIVE_STILL_MS + 16, `due at 0.5 s (${r.first})`)
    // The lock label's hold over the controller's output, 16 ms frames, camera at rest.
    const host = new FakeHost(); host.cam = cam; host.readableDevice = false; host.fb = (sm) => fallbackHit(sm.pos, centreDir(sm), flat(4), 1)
    const ctl = new LiveCaption(host); ctl.sawCamera(cam, 0)
    const hold = new LockHold()
    let typedAt: number | null = null
    for (let t = 0; t <= 2000 && typedAt === null; t += 16) {
      const v = ctl.step(t, CTX)
      if (hold.step({ id: v.visible ? v.id : null, moving: false, suppressed: false, now: t }).id) typedAt = t
    }
    assert.ok(typedAt !== null && typedAt >= 800 && typedAt <= 816, `the lock label shows at 0.8 s (${typedAt})`)
    // Motion at 416 ms restarts the pause: nothing until 0.8 s after it.
    const m = new LiveCaption(host); m.sawCamera(cam, 0)
    const moved = poseCam({ lon: copernicus.lon + 0.2, lat: copernicus.lat, dist: 1.27 }, 412, 915)
    for (let t = 0; t <= 400; t += 16) m.step(t, CTX)
    m.sawCamera(moved, 416); host.cam = moved
    let firstM: number | null = null
    for (let t = 416; t <= 2000 && firstM === null; t += 16) if (m.step(t, CTX).visible) firstM = t
    assert.ok(firstM !== null && firstM >= 416 + LIVE_STILL_MS, `the pause restarted (${firstM})`)
  }

  // Copernicus at 1.25-1.3 radii (where cd2a4313 named Oceanus Procellarum): the viewpoint's own camera (pitch 16 from 5 deg south, 50 deg lens), nadir
  // views and the poses around them whose centre falls within 60 km of the crater's centre (its rim is at 48 km): Copernicus, with a read and without.
  {
    const cu = unitVector(copernicus.lat, copernicus.lon)
    let checked = 0
    for (const [w, h] of SCREENS) for (const dist of [1.25, 1.27, 1.3]) for (const fov of [30, 50]) for (const read of [true, false]) {
      assert.equal(nameAt({ lon: -20.08, lat: 4.62, dist, pitch: 16, fov }, w, h, read), 'Copernicus', `the viewpoint's camera at ${dist} ${w}x${h} fov ${fov} read=${read}`)
      assert.equal(nameAt({ lon: copernicus.lon, lat: copernicus.lat, dist, fov }, w, h, read), 'Copernicus', `nadir at ${dist} ${w}x${h} fov ${fov} read=${read}`)
      for (const pitch of [8, 16, 24]) for (let lat = 1; lat <= 10; lat += 1) for (const dlon of [-1, 0, 1]) {
        const p = { lon: copernicus.lon + dlon, lat, dist, pitch, fov }
        const cam = poseCam(p, w, h)
        const c = raySphereV(cam.pos, centreDir(cam), 1)!
        const dKm = Math.acos(Math.min(1, c[0] * cu[0] + c[1] * cu[1] + c[2] * cu[2])) * R_KM
        if (dKm > 60) {
          if (dKm < 140) assert.notEqual(nameAt(p, w, h, read), 'Oceanus Procellarum', `never the ocean that merely contains the point (${dKm.toFixed(0)} km off)`)
          continue
        }
        checked++
        assert.equal(nameAt(p, w, h, read), 'Copernicus', `${JSON.stringify(p)} ${w}x${h} read=${read}: centre ${dKm.toFixed(0)} km from Copernicus`)
      }
    }
    assert.ok(checked > 40, `poses checked: ${checked}`)
    // The scoring itself, at the 1.27 radii span (251 km): on the crater it scores 1, the ocean 0.12; 32 km beyond the rim the crater still wins.
    near(fitScore(copernicus as { sizeKm: number }, 0, 251), 1, 1e-9, 'Copernicus at its centre')
    const proc = byName('Oceanus Procellarum')
    assert.ok(fitScore(proc as { sizeKm: number }, 1075, 251) < MIN_SCORE, 'Oceanus Procellarum over Copernicus scores below MIN_SCORE')
    assert.ok(fitScore(copernicus as { sizeKm: number }, 48 + 32, 251) > 0.3)
  }

  // Mare Orientale (the owner had Fryxell, Hohmann Q, Il'in, Maunder and Kopff on screen): the feature at the centre, at a sensible scale.
  {
    const cases: Array<[string, { lon: number; lat: number; dist: number; pitch?: number }, string]> = [
      ['the basin centre, 326 km frame', { lon: -94.67, lat: -19.87, dist: 1.35 }, 'Mare Orientale'],
      ['the owner\'s frame (Fryxell to Kopff across, 344 km)', { lon: -95.7, lat: -18.5, dist: 1.37 }, 'Mare Orientale'],
      ['over Maunder, 140 km frame', { lon: -93.88, lat: -14.53, dist: 1.15 }, 'Maunder'],
      ['over Kopff, 140 km frame', { lon: -89.68, lat: -17.39, dist: 1.15 }, 'Kopff'],
      ['over Hohmann, 56 km frame', { lon: -94.26, lat: -17.92, dist: 1.06 }, 'Hohmann'],
      ['over Fryxell, 56 km frame', { lon: -101.65, lat: -21.25, dist: 1.06 }, 'Fryxell'],
      // cd2a4313 named nothing for these two (the centre just outside the mare's outline, or on the ring with no container).
      ['pitched 20 deg north toward Maunder, 344 km', { lon: -95.7, lat: -21.5, dist: 1.37, pitch: 20 }, 'Maunder'],
      ['inside Montes Rook, west of the mare, 372 km', { lon: -100.5, lat: -20, dist: 1.4 }, 'Mare Orientale'],
    ]
    for (const [what, p, want] of cases) for (const [w, h] of SCREENS) assert.equal(nameAt(p, w, h), want, `${what} ${w}x${h}`)
    // Small craters are not named from a frame they are a speck in: Hohmann (17 km) at the centre of a 326 km frame gives way to the mare.
    assert.equal(nameAt({ lon: -94.26, lat: -17.92, dist: 1.35 }, 1280, 800), 'Mare Orientale')
  }

  // Arriving at the Copernicus viewpoint (its pill names Copernicus) names it, on the viewpoint's own camera.
  for (const [w, h] of SCREENS) {
    const cam = poseCam({ lon: -20.08, lat: 4.62, dist: 1.3, pitch: 16, fov: 50 }, w, h)
    const r = liveRun(cam, 2000, w > h, { viewpointFeatures: VIEWPOINT_FEATURES['pin-copernicus'] })
    assert.equal(r.v.text, 'Copernicus', `viewpoint arrival ${w}x${h}`); assert.ok(r.first !== null && r.first <= LIVE_STILL_MS + 16)
  }
  // And the Tycho viewpoint.
  const tycho = byName('Tycho')
  for (const [w, h] of SCREENS) assert.equal(liveRun(poseCam({ lon: tycho.lon, lat: tycho.lat, dist: 1.2 }, w, h), 2000, true, { viewpointFeatures: VIEWPOINT_FEATURES['pin-tycho'] }).v.text, 'Tycho')
}

console.log('centre-caption tests passed')
