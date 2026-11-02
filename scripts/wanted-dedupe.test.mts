// computeWanted samples the same tiles as the straightforward per-sample, per-level walk it replaced (the reference below, verbatim from
// before the per-level cache), including priority and keep scores, over varied views, presence patterns and the deepest levels.
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { computeWanted, rayPassStats, setWantShare, wantShareOf, effectiveFootprintKm, keepScore, EDGE_WANT, GLOBAL_TEXEL_KM, SAMPLES_X, SAMPLES_Y, WANT_TEXELS, ANISO_TILE, type StreamView, type Want } from '../src/moon/tiles/wanted.ts'
import { MOON_R_KM, H_TEXEL_KM, levelDeg, levelNx, levelNy, tileIndex, tileOf, pageWidth } from '../src/moon/tiles/grid.ts'
import { COARSEST_LEVEL, finestWanted, levelRow } from '../src/moon/tiles/levels.ts'
void ANISO_TILE

function computeWantedReference(v: StreamView, ctx: WantContext): Map<number, Want> {
  const out = new Map<number, Want>()
  const tanW = v.tanHalf * v.aspect
  const r = new THREE.Vector3(), m = new THREE.Vector3(), p = new THREE.Vector3(), tc = new THREE.Vector3()
  for (let j = 0; j < SAMPLES_Y; j++) for (let i = 0; i < SAMPLES_X; i++) {
    const sx = ((i + 0.5) / SAMPLES_X * 2 - 1) * tanW, sy = ((j + 0.5) / SAMPLES_Y * 2 - 1) * v.tanHalf
    r.copy(v.back).multiplyScalar(-1).addScaledVector(v.right, sx).addScaledVector(v.up, sy).normalize()
    const t = -v.pos.dot(r)
    if (t <= 0) continue
    m.copy(v.pos).addScaledVector(r, t)
    const b2 = m.lengthSq()
    if (b2 >= 1) continue
    p.copy(v.pos).addScaledVector(r, t - Math.sqrt(1 - b2))
    tc.copy(v.pos).sub(p)
    const range = tc.length()
    const mu = Math.max(0.15, p.dot(tc) / range)
    const fpKm = effectiveFootprintKm(range * MOON_R_KM * v.tanPerPx, mu, ctx.aniso)
    // The shader's gate: no tile is drawn at 0.9 global texels per pixel or more.
    if (fpKm / GLOBAL_TEXEL_KM >= 0.9) continue
    const lon = Math.atan2(p.dot(v.moonY), p.dot(v.moonX)) * 180 / Math.PI
    const lat = Math.asin(Math.max(-1, Math.min(1, p.dot(v.moonZ)))) * 180 / Math.PI
    const centre = Math.hypot(sx / tanW, sy / v.tanHalf)
    const finest = finestWanted(fpKm, H_TEXEL_KM, WANT_TEXELS, ctx.deepest)
    // The finest level that helps and every coarser one as its fallback (L2 always).
    for (let l = Math.min(finest, COARSEST_LEVEL); l <= COARSEST_LEVEL; l++) {
      const { tx, ty } = tileOf(l, lon, lat)
      const nx = levelNx(l), ny = levelNy(l), d = levelDeg(l)
      const fx = (((lon + 180) % 360 + 360) % 360) / d - tx, fy = (90 - lat) / d - ty
      const cols = [tx], rows = [ty]
      if (fx < EDGE_WANT) cols.push((tx + nx - 1) % nx); else if (fx > 1 - EDGE_WANT) cols.push((tx + 1) % nx)
      if (fy < EDGE_WANT && ty > 0) rows.push(ty - 1); else if (fy > 1 - EDGE_WANT && ty < ny - 1) rows.push(ty + 1)
      for (const cy of rows) for (const cx of cols) {
        if (!ctx.isPresent(l, tileIndex(l, cx, cy))) continue
        const key = ctx.keyOf(l, cx, cy)
        // Coarse first, then near the middle of the frame; a neighbour a little after its sample's own tile.
        const priority = (COARSEST_LEVEL - l) * 10 + centre + (cx === tx && cy === ty ? 0 : 0.3)
        const old = out.get(key)
        const keep = keepScore(centre, l)
        if (!old) out.set(key, { key, level: l, tx: cx, ty: cy, priority, keep })
        else { old.priority = Math.min(old.priority, priority); old.keep = Math.min(old.keep, keep) }
      }
    }
  }
  return out
}


function viewOver(dist: number, lon: number, lat: number, pitchDeg: number, spin: number): StreamView {
  const d = Math.PI / 180, w = 1280, h = 800
  const dir = new THREE.Vector3(Math.cos(lat * d) * Math.cos(lon * d), Math.cos(lat * d) * Math.sin(lon * d), Math.sin(lat * d))
  const nadir = dir.clone().negate()
  const right = new THREE.Vector3().crossVectors(nadir, new THREE.Vector3(0, 0, 1)).normalize()
  const up = new THREE.Vector3().crossVectors(right, nadir).normalize()
  const q = new THREE.Quaternion().setFromAxisAngle(right, pitchDeg * d)
  const fwd = nadir.clone().applyQuaternion(q)
  const tanH = Math.tan(15 * d)
  const v: StreamView = { pos: dir.clone().multiplyScalar(dist), right, up: up.applyQuaternion(q), back: fwd.clone().negate(), tanHalf: tanH, aspect: w / h, tanPerPx: 2 * tanH / h, moonX: new THREE.Vector3(1, 0, 0), moonY: new THREE.Vector3(0, 1, 0), moonZ: new THREE.Vector3(0, 0, 1) }
  const roll = new THREE.Quaternion().setFromAxisAngle(fwd, spin * d)
  v.right.applyQuaternion(roll); v.up.applyQuaternion(roll)
  return v
}
const pw = pageWidth(-4)
let seed = 11
const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
let compared = 0
for (const deepest of [0, -2, -4]) {
  for (const [dist, pitch] of [[60, 0], [60, 60], [400, 30], [3000, 0], [20, 75]]) {
    for (let k = 0; k < 3; k++) {
      const v = viewOver(1 + dist / MOON_R_KM, -180 + 360 * rnd(), -80 + 160 * rnd(), pitch, 360 * rnd())
      // A patchy presence pattern, deterministic per tile; level 2 always present.
      const present = (l: number, i: number): boolean => l === COARSEST_LEVEL || ((i * 2654435761 + l * 40503) >>> 0) % 7 !== 0
      const ctx = { deepest, isPresent: present, keyOf: (l: number, tx: number, ty: number) => (levelRow(l) + ty) * pw + tx }
      const a = computeWanted(v, ctx), b = computeWantedReference(v, ctx)
      assert.equal(a.size, b.size, `same tile count (deepest ${deepest}, dist ${dist}, pitch ${pitch})`)
      for (const [key, w] of b) {
        const x = a.get(key) as Want
        assert.ok(x, `tile ${key} wanted`)
        assert.deepEqual([x.level, x.tx, x.ty, x.priority, x.keep], [w.level, w.tx, w.ty, w.priority, w.keep], `tile ${key} scores`)
      }
      compared += b.size
    }
  }
}
assert.ok(compared > 500, `compared ${compared} wanted tiles`)

// ---- R57 (TM-6): the three streamers of one frame share one ray pass, and what they get is what separate passes give.
{
  assert.equal(wantShareOf(''), true); assert.equal(wantShareOf('?wantshare=0'), false); assert.equal(wantShareOf('?wantshare=1'), true)
  const present = (l: number, i: number): boolean => l === COARSEST_LEVEL || ((i * 2654435761 + l * 40503) >>> 0) % 7 !== 0
  // The tile, detail and TC streamers: different deepest level, different presence, same view.
  const streamers = [
    { deepest: -4, isPresent: present, keyOf: (l: number, tx: number, ty: number) => (levelRow(l) + ty) * pw + tx },
    { deepest: -2, isPresent: (l: number, i: number) => l < 0 && present(l, i), keyOf: (l: number, tx: number, ty: number) => (levelRow(l) + ty) * pw + tx },
    { deepest: -5, isPresent: (l: number, i: number) => l <= -3 && present(l, i), keyOf: (l: number, tx: number, ty: number) => (levelRow(l) + ty) * pw + tx },
  ]
  const same = (a: Map<number, Want>, b: Map<number, Want>, what: string): void => {
    assert.equal(a.size, b.size, `${what}: same tile count`)
    for (const [k, w] of b) assert.deepEqual({ ...a.get(k) }, { ...w }, `${what}: tile ${k}`)
    assert.deepEqual([...a.keys()], [...b.keys()], `${what}: same order`)
  }
  let tiles = 0
  for (const [dist, pitch, moving, flight] of [[60, 0, false, false], [60, 60, true, false], [400, 30, false, true], [20, 75, false, false]] as const) {
    const v = { ...viewOver(1 + dist / MOON_R_KM, -20 + 3 * dist, 9.7, pitch, 17), moving, flight }
    setWantShare('?wantshare=0')
    const p0 = rayPassStats.computed
    const old = streamers.map((c) => computeWanted(v, c))
    assert.equal(rayPassStats.computed - p0, 3, 'switch off: one ray pass per streamer, as before')
    setWantShare('')
    const c0 = rayPassStats.computed, s0 = rayPassStats.shared
    const fresh = streamers.map((c) => computeWanted(v, c))
    assert.equal(rayPassStats.computed - c0, 1, 'switch on: one ray pass for the three streamers')
    assert.equal(rayPassStats.shared - s0, 2, 'and two reuses')
    streamers.forEach((_, i) => { same(fresh[i], old[i], `streamer ${i}, dist ${dist}, pitch ${pitch}, moving ${moving}, flight ${flight}`); tiles += old[i].size })
  }
  assert.ok(tiles > 300, `compared ${tiles} wanted tiles`)
  // A pass is never reused for a different question: another view, the same view mutated in place, the stride, or the anisotropy each recompute.
  setWantShare('')
  const v = viewOver(1.02, 5, 40, 30, 3)
  const run = (view: StreamView, aniso?: number): number => { const c0 = rayPassStats.computed; computeWanted(view, { ...streamers[0], aniso }); return rayPassStats.computed - c0 }
  assert.equal(run(v), 1); assert.equal(run(v), 0, 'same inputs: reused')
  assert.equal(run({ ...v, moving: true }), 1, 'a gesture frame samples a quarter of the rays: its own pass')
  assert.equal(run(v), 1, 'and the rest-frame pass was replaced')
  v.pos.x += 1e-9
  assert.equal(run(v), 1, 'the same view object moved in place by the least amount: recomputed (exact keys)')
  assert.equal(run(v, 1), 1, 'another anisotropy: its own pass')
  assert.equal(run(v, 1), 0)
  // A stale pass can not leak through a different tile set either: the per-level walk is not part of the pass.
  const a = computeWanted(v, streamers[1]), b = computeWanted(v, streamers[2])
  assert.notDeepEqual([...a.keys()], [...b.keys()])
}
setWantShare('')
console.log(`wanted-dedupe ok (${compared} tiles)`)
