/**
 * The ground pass's max-mip terrain hit (R4) on the CPU: src/ground/groundHit.ts (the twin of `groundHit` in groundShader.ts) against the fixed-step
 * march it replaces (384 steps, `?hit=old`), over the patch's max grid (src/ground/siteMax.ts).
 *
 *   npx tsx scripts/ground-hit.test.mts                               (synthetic two-level site, always runs)
 *   MOON_PATCH_DIR=<dir with manifest.json, L1.h.f16x2.gz, L2.h.f16x2.gz> npx tsx scripts/ground-hit.test.mts   (adds the real Apollo 17 DTM levels)
 *
 * Checks, per site:
 *  1. The grid dominates the height the shader can show at every level, over a dense point set (the property skipping rests on).
 *  2. Over rays from an eye 1.7 m up in 12 directions and 3 pitches, the descent's hit is within one texel of the fixed march's (the finest level's,
 *     or 0.5 % of the distance where that is larger) for at least 99.9 % of rays on the real DTM (99 % on the noisier synthetic relief), hit and miss
 *     agreeing on all but 0.1 % (0.6 %). Every ray where they disagree is judged by a dense march: the descent may be the only wrong one at most 0.1 % of
 *     rays more often than the fixed march.
 *  2b. Every skip is sound: on one ray in 8, the ground under each stretch the descent skips is below the ray (the counts in 2 cannot see a descent
 *     that skips into the ground on a few rays).
 *  3. The descent does less work where it matters: samples per ray, and warp-coherent work (8 x 4 pixels run to their slowest ray).
 *  4. A control: with every bound 300 m too low the same rays FAIL check 2 (the grid is what makes the skipping exact).
 */
import { reportSkip } from './test-skip.mts'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { SM_CELL_M, SM_LEVELS, SM_OPEN, SiteMax, type SiteLevel } from '../src/ground/siteMax.ts'
import { groundHitDescent, groundHitFixed, type GroundHit, type GroundInputs } from '../src/ground/groundHit.ts'
import { fadeFor } from '../src/moon/patch/levels.ts'

const R = 1737400
interface Lv extends SiteLevel { z: Float32Array }

function half(h: number): number {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023
  return e === 0 ? s * m * 2 ** -24 : s * (1 + m / 1024) * 2 ** (e - 15)
}
function hash(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s)
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy
}
/** Relief at east/north metres: a valley floor with massifs, craters and boulders, from 8 km features down to a metre. */
function relief(e: number, n: number, octaves: number): number {
  let h = -2500 + 900 * Math.max(0, vnoise(e / 6000 + 3, n / 6000 + 9, 1) - 0.35) * 2.2
  let amp = 45, f = 1 / 900
  for (let o = 0; o < octaves; o++) { h += amp * (vnoise(e * f, n * f, 10 + o) - 0.5) * 2; amp *= 0.45; f *= 2.2 }
  for (let o = 0; o < 3; o++) {
    const cell = 700 / (o + 1)
    const ci = Math.floor(e / cell), cj = Math.floor(n / cell)
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const i = ci + di, j = cj + dj
      if (hash(i, j, 70 + o) > 0.5) continue
      const cx = (i + hash(i, j, 5 + o)) * cell, cy = (j + hash(i, j, 9 + o)) * cell
      const rad = cell * (0.15 + 0.25 * hash(i, j, 3 + o)), d = Math.hypot(e - cx, n - cy) / rad
      if (d < 1.4) h += 25 * (d < 1 ? -(1 - d * d) * 0.8 : Math.exp(-((d - 1) ** 2) * 18) * 0.6) * (1 + o)
    }
  }
  return h
}
/**
 * `relief` over a grid, the same doubles in the same order, only cheaper: an octave's four lattice hashes are kept while the texels stay in one lattice
 * cell, and each crater is added only to the texels within its reach (1.4 radii, under 0.56 of its cell, so inside the 3 x 3 cells `relief` visits),
 * crater by crater in the order `relief` adds them. The check after the sites compares it with `relief` itself.
 */
function synth(name: string, eastM: number, northM: number, w: number, h: number, texel: number, octaves: number): Lv {
  const acc = new Float64Array(w * h)
  const memo = Array.from({ length: octaves }, () => ({ xi: NaN, yi: NaN, a: 0, b: 0, c: 0, d: 0 }))
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const e = eastM + (i + 0.5) * texel, n = northM - (j + 0.5) * texel
    let v = -2500 + 900 * Math.max(0, vnoise(e / 6000 + 3, n / 6000 + 9, 1) - 0.35) * 2.2
    let amp = 45, f = 1 / 900
    for (let o = 0; o < octaves; o++) {
      const x = e * f, y = n * f, s = 10 + o, m = memo[o]
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi
      if (xi !== m.xi || yi !== m.yi) { m.xi = xi; m.yi = yi; m.a = hash(xi, yi, s); m.b = hash(xi + 1, yi, s); m.c = hash(xi, yi + 1, s); m.d = hash(xi + 1, yi + 1, s) }
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
      v += amp * (((m.a * (1 - sx) + m.b * sx) * (1 - sy) + (m.c * (1 - sx) + m.d * sx) * sy) - 0.5) * 2; amp *= 0.45; f *= 2.2
    }
    acc[j * w + i] = v
  }
  const e0 = eastM + 0.5 * texel, e1 = eastM + (w - 0.5) * texel, n0 = northM - 0.5 * texel, n1 = northM - (h - 0.5) * texel
  for (let o = 0; o < 3; o++) {
    const cell = 700 / (o + 1)
    for (let ci = Math.floor(e0 / cell) - 1; ci <= Math.floor(e1 / cell) + 1; ci++) for (let cj = Math.floor(n1 / cell) - 1; cj <= Math.floor(n0 / cell) + 1; cj++) {
      if (hash(ci, cj, 70 + o) > 0.5) continue
      const cx = (ci + hash(ci, cj, 5 + o)) * cell, cy = (cj + hash(ci, cj, 9 + o)) * cell
      const rad = cell * (0.15 + 0.25 * hash(ci, cj, 3 + o))
      const iA = Math.max(0, Math.floor((cx - 1.4 * rad - eastM) / texel - 0.5)), iB = Math.min(w - 1, Math.ceil((cx + 1.4 * rad - eastM) / texel - 0.5))
      const jA = Math.max(0, Math.floor((northM - cy - 1.4 * rad) / texel - 0.5)), jB = Math.min(h - 1, Math.ceil((northM - cy + 1.4 * rad) / texel - 0.5))
      for (let j = jA; j <= jB; j++) for (let i = iA; i <= iB; i++) {
        const e = eastM + (i + 0.5) * texel, n = northM - (j + 0.5) * texel
        // only the texels whose own 3 x 3 window holds this cell, as in `relief`
        if (Math.abs(Math.floor(e / cell) - ci) > 1 || Math.abs(Math.floor(n / cell) - cj) > 1) continue
        const d = Math.hypot(e - cx, n - cy) / rad
        if (d < 1.4) acc[j * w + i] += 25 * (d < 1 ? -(1 - d * d) * 0.8 : Math.exp(-((d - 1) ** 2) * 18) * 0.6) * (1 + o)
      }
    }
  }
  void name
  return { eastM, northM, w, h, texelEastM: texel, texelNorthM: texel, z: Float32Array.from(acc) }
}

const sites: { name: string; real?: boolean; l2: Lv; l1: Lv }[] = [{ name: 'synthetic', l2: synth('L2', -9000, 9000, 2250, 2250, 8, 8), l1: synth('L1', -2000, 2000, 2000, 2000, 2, 11) }]
// The fast `synth` is `relief`, texel for texel: every texel of a 160 x 160 window of each level, and texels spread over all of both.
for (const [L, oct] of [[sites[0].l2, 8], [sites[0].l1, 11]] as const) {
  const at = (i: number, j: number): void => {
    const want = Math.fround(relief(L.eastM + (i + 0.5) * L.texelEastM, L.northM - (j + 0.5) * L.texelNorthM, oct))
    assert.equal(L.z[j * L.w + i], want, `synth at texel ${i}, ${j} of the ${L.texelEastM} m level`)
  }
  for (let j = 900; j < 1060; j++) for (let i = 900; i < 1060; i++) at(i, j)
  for (let k = 0; k < 20000; k++) at(Math.floor(hash(k, 3, 3) * L.w), Math.floor(hash(k, 4, 4) * L.h))
}
const pdir = process.env.MOON_PATCH_DIR
if (pdir && fs.existsSync(path.join(pdir, 'manifest.json'))) {
  const man = JSON.parse(fs.readFileSync(path.join(pdir, 'manifest.json'), 'utf8'))
  const load = (name: string): Lv => {
    const l = man.levels.find((x: { name: string }) => x.name === name)
    const b = zlib.gunzipSync(fs.readFileSync(path.join(pdir, `${name}.h.f16x2.gz`)))
    const n = l.w * l.h
    const u = new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + n * 4))
    const z = new Float32Array(n)
    for (let i = 0; i < n; i++) z[i] = half(u[i]) + half(u[n + i]) + man.h0M
    return { eastM: l.eastM, northM: l.northM, w: l.w, h: l.h, texelEastM: l.texelEastM, texelNorthM: l.texelNorthM, z }
  }
  sites.push({ name: 'real Apollo 17 L2+L1', real: true, l2: load('L2'), l1: load('L1') })
} else reportSkip('ground-hit.test', 'data', 'MOON_PATCH_DIR not set: the real Apollo 17 run did NOT run, synthetic site only')

function bil(L: Lv, e: number, n: number): number {
  const x = (e - L.eastM) / L.texelEastM - 0.5, y = (L.northM - n) / L.texelNorthM - 0.5
  const ix = Math.max(0, Math.min(L.w - 2, Math.floor(x))), iy = Math.max(0, Math.min(L.h - 2, Math.floor(y)))
  const ax = Math.max(0, Math.min(1, x - ix)), ay = Math.max(0, Math.min(1, y - iy))
  // Indexed inline, not through a closure: under tsx every closure made per call costs a __name wrapper, which was most of this test's time.
  const z = L.z, k = iy * L.w + ix
  return (z[k] * (1 - ax) + z[k + 1] * ax) * (1 - ay) + (z[k + L.w] * (1 - ax) + z[k + L.w + 1] * ax) * ay
}
const smooth = (t: number): number => { t = Math.max(0, Math.min(1, t)); return t * t * t * (t * (t * 6 - 15) + 10) }
function fused(s: { l2: Lv; l1: Lv }, e: number, n: number): number {
  const L = s.l1
  const edge = Math.min(e - L.eastM, L.eastM + L.w * L.texelEastM - e, L.northM - n, n - (L.northM - L.h * L.texelNorthM))
  const w = smooth(edge / fadeFor(L.texelEastM))
  const h2 = bil(s.l2, e, n)
  return w > 0 ? h2 * (1 - w) + bil(L, e, n) * w : h2
}

/** A dense march: steps of 5 cm to 0.2 % of the distance, then bisection. */
function truth(i: GroundInputs): { hit: boolean; t: number } {
  let ta = 0.05
  for (let t = 0.05; t < 60000; t += Math.max(0.05, 0.002 * t)) {
    const x = [i.o[0] + i.d[0] * t, i.o[1] + i.d[1] * t, i.o[2] + i.d[2] * t]
    if (x[2] < i.z(x[0], x[1], t * i.tanPerPx)) {
      let a = ta, b = t
      for (let k = 0; k < 30; k++) { const m = 0.5 * (a + b); const y = [i.o[0] + i.d[0] * m, i.o[1] + i.d[1] * m, i.o[2] + i.d[2] * m]; if (y[2] < i.z(y[0], y[1], m * i.tanPerPx)) b = m; else a = m }
      return { hit: true, t: b }
    }
    ta = t
  }
  return { hit: false, t: 0 }
}

async function build(s: { l2: Lv; l1: Lv }): Promise<SiteMax> {
  const sm = new SiteMax(s.l2, fadeFor(s.l2.texelEastM))
  await sm.addLevel(s.l2, (i) => s.l2.z[i])
  await sm.addLevel(s.l1, (i) => s.l1.z[i])
  return sm
}

function rays(s: { l2: Lv; l1: Lv }, sm: SiteMax, control: boolean): { inputs: GroundInputs[]; gridW: number; gridH: number } {
  const h0 = fused(s, 0, 0)
  const z = (e: number, n: number): number => fused(s, e, n) - h0 - (e * e + n * n) / (2 * R)
  const inputs: GroundInputs[] = []
  const NX = 160, NY = 100, tanH = 0.36
  for (let yaw = 0; yaw < 12; yaw++) for (const pitch of [0, 4, -8]) {
    const ya = yaw * 30 * Math.PI / 180, cp = Math.cos(pitch * Math.PI / 180), sp = Math.sin(pitch * Math.PI / 180)
    const f0 = [Math.sin(ya), Math.cos(ya), 0], right = [Math.cos(ya), -Math.sin(ya), 0]
    const fwd = [f0[0] * cp, f0[1] * cp, sp], up = [-f0[0] * sp, -f0[1] * sp, cp]
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const px = ((i + 0.5) / NX * 2 - 1) * tanH * NX / NY, py = (1 - (j + 0.5) / NY * 2) * tanH
      const d = [fwd[0] + right[0] * px + up[0] * py, fwd[1] + right[1] * px + up[1] * py, fwd[2] + right[2] * px + up[2] * py]
      const l = Math.hypot(d[0], d[1], d[2])
      inputs.push({ o: [0, 0, 1.7], d: [d[0] / l, d[1] / l, d[2] / l], tanPerPx: 2 * tanH / NY, z, h0, R, off: [0, 0], sm, coarseTexelM: 8 })
    }
  }
  void control
  return { inputs, gridW: NX, gridH: NY }
}

const failures: string[] = []
const check = (ok: boolean, msg: string): void => { if (!ok) { failures.push(msg); console.log(`FAIL: ${msg}`) } }
for (const s of sites) {
  const sm = await build(s)
  // ---- 1. The grid dominates the heights ----
  {
    let n = 0, openCells = 0
    for (const v of sm.levels[0]) if (v >= SM_OPEN) openCells++
    let worst = -1e9
    for (let k = 0; k < 150000; k++) {
      const e = s.l2.eastM + s.l2.w * s.l2.texelEastM * hash(k, 1, 1), nn = s.l2.northM - s.l2.h * s.l2.texelNorthM * hash(k, 2, 2)
      const hh = fused(s, e, nn)
      for (let l = 0; l < SM_LEVELS; l++) {
        const b = sm.at(l, e, nn)
        worst = Math.max(worst, hh - b)
        assert.ok(hh <= b + 1e-3, `${s.name}: height ${hh.toFixed(2)} exceeds the level-${l} bound ${b} at ${e.toFixed(1)}, ${nn.toFixed(1)}`)
      }
      n++
    }
    console.log(`grid dominates: ${s.name}: ${n} points x ${SM_LEVELS} levels, worst margin ${(-worst).toFixed(2)} m; ${sm.w} x ${sm.h} cells of ${SM_CELL_M} m, ${(100 * openCells / (sm.w * sm.h)).toFixed(1)} % open (edge fade)`)
  }
  // ---- 2 and 3. The hit ----
  const run = (label: string, bias: number): { within: number; flips: number; n: number; warpOld: number; warpNew: number; samOld: number; samNew: number; cells: number } => {
    if (bias !== 0) for (const l of sm.levels) for (let i = 0; i < l.length; i++) if (l[i] < SM_OPEN) l[i] += bias
    const { inputs, gridW, gridH } = rays(s, sm, bias !== 0)
    const classes: number[][] = []
    const disputes: { inp: GroundInputs; a: GroundHit; b: GroundHit; tol: number }[] = []
    let within = 0, flips = 0, warpOld = 0, warpNew = 0, samOld = 0, samNew = 0, cells = 0, budgets = 0
    const per = gridW * gridH
    for (let p = 0; p < inputs.length; p += per) {
      const oc = new Float32Array(per), nc = new Float32Array(per)
      for (let k = 0; k < per; k++) {
        const inp = inputs[p + k]
        const a = groundHitFixed(inp), b = groundHitDescent(inp)
        samOld += a.samples; samNew += b.samples; cells += b.cells; if (b.budget) budgets++
        const cls = !a.hit ? 0 : a.t < 50 ? 1 : a.t < 500 ? 2 : a.t < 5000 ? 3 : 4
        const cc = (classes[cls] ??= [0, 0, 0, 0]); cc[0]++; cc[1] += a.samples; cc[2] += b.samples; cc[3] += b.cells
        oc[k] = a.samples; nc[k] = b.samples + 0.1 * b.cells
        if (a.hit !== b.hit) { flips++; if (process.env.FLIPS && flips < 40) console.log('flip', a.hit ? 'fixed hit' : 'fixed miss', 't', a.t.toFixed(1), 'descent', b.hit ? 'hit t ' + b.t.toFixed(1) : 'miss', 'dz', inp.d[2].toFixed(4), 'samples', a.samples, b.samples) }
        const px = inp.o[0] + inp.d[0] * a.t, py = inp.o[1] + inp.d[1] * a.t
        const inL1 = px > s.l1.eastM && px < s.l1.eastM + s.l1.w * s.l1.texelEastM && py < s.l1.northM && py > s.l1.northM - s.l1.h * s.l1.texelNorthM
        const tol = Math.max(inL1 ? s.l1.texelEastM : s.l2.texelEastM, 0.005 * a.t)
        if (a.hit === b.hit && (!a.hit || Math.abs(a.t - b.t) <= tol)) within++
        else if (bias === 0) disputes.push({ inp, a, b, tol })
      }
      for (let by = 0; by < gridH; by += 4) for (let bx = 0; bx < gridW; bx += 8) {
        let mo = 0, mn = 0
        for (let y = by; y < by + 4; y++) for (let x = bx; x < bx + 8; x++) { mo = Math.max(mo, oc[y * gridW + x]); mn = Math.max(mn, nc[y * gridW + x]) }
        warpOld += mo; warpNew += mn
      }
    }
    const n = inputs.length
    // Where the two disagree, who is right? A dense march (steps of 5 cm to 0.2 % of the distance) is the truth.
    let descentRight = 0, fixedRight = 0, neither = 0
    for (const d of disputes) {
      const tr = truth(d.inp)
      const ok = (h: GroundHit): boolean => h.hit === tr.hit && (!h.hit || Math.abs(h.t - tr.t) <= Math.max(d.tol, 0.005 * tr.t))
      const x = ok(d.b), y = ok(d.a)
      if (x && !y) descentRight++; else if (y && !x) fixedRight++; else if (!x && !y) neither++
    }
    if (bias === 0) {
      // Review S3: where the two disagree the descent must not be the one that is wrong, and no ray may need the budget fallback. Every disputed ray
      // is judged. Both marches are heuristics and each is the only wrong one on about 0.4 % of synthetic rays, so the bound is relative: the descent
      // may be the only wrong one at most 0.1 % of rays more often than the fixed march is. (It was absolute on the first 400 disputes, under a bound
      // of 576: it could not fail.)
      check(fixedRight <= descentRight + Math.ceil(n * 0.001), `${s.name}: the descent is wrong where the fixed march is right on ${fixedRight} of ${n} rays, the other way round on ${descentRight}`)
      check(budgets === 0, `${s.name}: ${budgets} rays ran out of the descent's iterations`)
    }
    if (disputes.length) console.log(`  disputed rays (${disputes.length}) against a dense march (all of them): descent right ${descentRight}, fixed march right ${fixedRight}, neither ${neither}`)
    console.log(`${label}: ${n} rays, descent within one texel of the fixed march: ${(100 * within / n).toFixed(3)} % (hit/miss flips ${flips}); height samples per ray ${(samOld / n).toFixed(1)} -> ${(samNew / n).toFixed(1)} (+ ${(cells / n).toFixed(1)} cell reads); warp-coherent work x${(warpNew / warpOld).toFixed(2)} (a cell read counts 0.1 of a height sample)`)
    if (process.env.CLASSES && bias === 0) classes.forEach((c, k) => console.log(`   ${['sky', 'hit<50m', 'hit<500m', 'hit<5km', 'hit>5km'][k]}: ${(100 * c[0] / n).toFixed(1)} % of rays, samples/ray old ${(c[1] / c[0]).toFixed(1)} new ${(c[2] / c[0]).toFixed(1)} + ${(c[3] / c[0]).toFixed(1)} cells`))
    if (bias !== 0) for (const l of sm.levels) for (let i = 0; i < l.length; i++) if (l[i] < SM_OPEN) l[i] -= bias
    return { within, flips, n, warpOld, warpNew, samOld, samNew, cells }
  }
  // ---- 2b. Every skip is sound: wherever the descent skips a cell, the ground under that stretch of the ray is below it (the grid's bound plus
  // the margin is what licenses the skip; the counts in 2 hide a descent that skips into the ground on a few rays). One ray in 8, 8 points a skip.
  {
    const { inputs } = rays(s, sm, false)
    let skips = 0, bad = 0, worst = -1e9, first = ''
    for (let k = 0; k < inputs.length; k += 8) {
      const inp = inputs[k]
      groundHitDescent(inp, undefined, (t0, t1) => {
        skips++
        for (let q = 0; q <= 8; q++) {
          const t = t0 + (t1 - t0) * (q / 8), e = inp.o[0] + inp.d[0] * t, n = inp.o[1] + inp.d[1] * t
          const under = inp.z(e, n, t * inp.tanPerPx) - (inp.o[2] + inp.d[2] * t)
          if (under > worst) worst = under
          if (under > 0 && bad++ === 0) first = `ray ${k} at t ${t.toFixed(1)} m: ground ${under.toFixed(2)} m above the ray`
        }
      })
    }
    console.log(`skips sound: ${s.name}: ${skips} skips on ${Math.ceil(inputs.length / 8)} rays, ground at most ${worst.toFixed(2)} m from the ray (negative: below it)`)
    check(bad === 0, `${s.name}: the descent skipped into the ground at ${bad} points (first: ${first})`)
  }
  const r = run(s.name, 0)
  // Both marches are heuristics (a clearance step can overshoot a thin rim): on the real DTM they agree to 99.9 %; on the noisier synthetic relief,
  // where each is wrong about as often as the other against a dense march (the line above), to 99 %.
  const need = s.real ? 0.999 : 0.99
  check(r.within / r.n >= need, `${s.name}: ${(100 * r.within / r.n).toFixed(3)} % within one texel (need ${100 * need} %)`)
  check(r.flips / r.n <= (s.real ? 0.001 : 0.006), `${s.name}: hit/miss flips ${r.flips} of ${r.n}`)
  check(r.warpNew < r.warpOld, `${s.name}: the descent does less warp-coherent work`)
  // ---- 4. Control ----
  const c = run(`${s.name} control (every bound 300 m too low)`, -300)
  check(c.within / c.n < need - 0.01 || c.within / c.n < r.within / r.n - 0.01, `the control must fail, or the grid proves nothing (it scored ${(100 * c.within / c.n).toFixed(3)} %, against ${(100 * r.within / r.n).toFixed(3)} % with the right bounds)`)
}
assert.equal(failures.length, 0, failures.join('; '))
console.log('ground-hit.test: ok')
