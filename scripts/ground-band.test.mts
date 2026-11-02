/**
 * R4 review B1/S3: the wide SLDEM band is blended into the fine level's edge ring, so the ground pass's max grid must hold it too.
 *
 * Model of the drawn surface (moonShader.ts patchGroundEN): mix(band, L2, smoothstep of the distance inside L2's rectangle over fadeFor(8 m)),
 * with the band 6 m ABOVE the NAC heights (two independent DTMs differ by metres). Eyes sit inside that ring with the origin offset from the
 * site point (uGOff != 0), the descent's reach is the coarsest level's (`coarseTexelM`, the tiles beyond it are not in the grid).
 *
 *  - Grid as the branch builds it now (frame = the band, extent = L2, band and L2 both added): the descent agrees with a dense march on every ray.
 *  - Grid as the branch built it before the fix (frame = the band, only L2 added): the same rays DO miss, so the scenario sees the bug.
 */
import assert from 'node:assert/strict'
import { SiteMax, type SiteLevel } from '../src/ground/siteMax.ts'
import { groundHitDescent, groundHitFixed, type GroundHit, type GroundInputs } from '../src/ground/groundHit.ts'
import { fadeFor } from '../src/moon/patch/levels.ts'

const R = 1737400
interface Lv extends SiteLevel { z: Float32Array }
function hash(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  return (hash(xi, yi, s) * (1 - sx) + hash(xi + 1, yi, s) * sx) * (1 - sy) + (hash(xi, yi + 1, s) * (1 - sx) + hash(xi + 1, yi + 1, s) * sx) * sy
}
const relief = (e: number, n: number, oct: number): number => {
  let h = -2000 + 700 * Math.max(0, vnoise(e / 2500 + 3, n / 2500 + 9, 1) - 0.3) * 2
  let amp = 40, f = 1 / 500
  for (let o = 0; o < oct; o++) { h += amp * (vnoise(e * f, n * f, 10 + o) - 0.5) * 2; amp *= 0.5; f *= 2.1 }
  return h
}
function synth(eastM: number, northM: number, w: number, h: number, texel: number, oct: number, bias: number): Lv {
  const z = new Float32Array(w * h)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) z[j * w + i] = relief(eastM + (i + 0.5) * texel, northM - (j + 0.5) * texel, oct) + bias
  return { eastM, northM, w, h, texelEastM: texel, texelNorthM: texel, z }
}
function bil(L: Lv, e: number, n: number): number {
  const x = (e - L.eastM) / L.texelEastM - 0.5, y = (L.northM - n) / L.texelNorthM - 0.5
  const ix = Math.max(0, Math.min(L.w - 2, Math.floor(x))), iy = Math.max(0, Math.min(L.h - 2, Math.floor(y)))
  const ax = Math.max(0, Math.min(1, x - ix)), ay = Math.max(0, Math.min(1, y - iy))
  const g = (a: number, b: number): number => L.z[b * L.w + a]
  return (g(ix, iy) * (1 - ax) + g(ix + 1, iy) * ax) * (1 - ay) + (g(ix, iy + 1) * (1 - ax) + g(ix + 1, iy + 1) * ax) * ay
}
const smooth = (t: number): number => { t = Math.max(0, Math.min(1, t)); return t * t * t * (t * (t * 6 - 15) + 10) }

const l2 = synth(-9000, 9000, 1125, 1125, 16, 7, 0)       // 18 km at 16 m (the fine level; coarser than the real 8 m only to keep the test quick)
const band = synth(-13000, 13000, 433, 433, 60, 5, 6)    // 26 km at 60 m, 6 m above the NAC
// ... and a ridge only the band has (a coregistration error or a block the NAC DTM lacks): 30 m high, 400 m wide, inside L2's edge ring, where the band still shows.
for (let j = 0; j < band.h; j++) for (let i = 0; i < band.w; i++) {
  const e = band.eastM + (i + 0.5) * 60, n = band.northM - (j + 0.5) * 60
  band.z[j * band.w + i] += 30 * Math.exp(-(((e + 8650) / 200) ** 2 + ((n - 300) / 1500) ** 2))
}
const surface = (e: number, n: number): number => {
  const edge = Math.min(e - l2.eastM, l2.eastM + l2.w * l2.texelEastM - e, l2.northM - n, n - (l2.northM - l2.h * l2.texelNorthM))
  const w = smooth(edge / fadeFor(8))
  const hb = bil(band, e, n)
  return w > 0 ? hb * (1 - w) + bil(l2, e, n) * w : hb
}

async function grid(withBand: boolean): Promise<SiteMax> {
  const fade = Math.max(fadeFor(band.texelEastM), fadeFor(band.texelEastM * 4))
  const sm = new SiteMax(band, fade, l2)
  if (withBand) await sm.addLevel(band, (i) => band.z[i])
  await sm.addLevel(l2, (i) => l2.z[i])
  return sm
}

function truth(i: GroundInputs): { hit: boolean; t: number } {
  let ta = 0.05
  for (let t = 0.05; t < 8000; t += Math.max(0.05, 0.002 * t)) {
    const x = [i.o[0] + i.d[0] * t, i.o[1] + i.d[1] * t, i.o[2] + i.d[2] * t]
    if (x[2] < i.z(x[0], x[1], t * i.tanPerPx)) {
      let a = ta, b = t
      for (let k = 0; k < 30; k++) { const m = 0.5 * (a + b); if (i.o[2] + i.d[2] * m < i.z(i.o[0] + i.d[0] * m, i.o[1] + i.d[1] * m, m * i.tanPerPx)) b = m; else a = m }
      return { hit: true, t: b }
    }
    ta = t
  }
  return { hit: false, t: 0 }
}

/** Eyes inside the ring (the offset origin: uGOff != 0), 24 yaws, pitches grazing the ground. */
function rays(sm: SiteMax): GroundInputs[] {
  const out: GroundInputs[] = []
  const eyes: [number, number][] = [[-6500, 300], [-7200, 900], [-7600, -400], [-6000, 1200], [2500, -8400], [8200, 2000]]
  for (const [ex, ey] of eyes) {
    const h0 = surface(ex, ey)
    const z = (e: number, n: number): number => surface(ex + e, ey + n) - h0 - (e * e + n * n) / (2 * R)
    for (let yaw = 0; yaw < 24; yaw++) for (const pitch of [-3, -1.5, -0.5, 0, 1]) {
      const ya = yaw * 15 * Math.PI / 180, cp = Math.cos(pitch * Math.PI / 180), sp = Math.sin(pitch * Math.PI / 180)
      for (const spread of [-0.01, 0, 0.01]) {
        const a = ya + spread
        out.push({ o: [0, 0, 1.7], d: [Math.sin(a) * cp, Math.cos(a) * cp, sp], tanPerPx: 0.0015, z, h0, R, off: [ex, ey], sm, coarseTexelM: band.texelEastM })
      }
    }
  }
  return out
}
const ok0 = (h: GroundHit, tr: { hit: boolean; t: number }): boolean => h.hit === tr.hit && (!h.hit || Math.abs(h.t - tr.t) <= Math.max(l2.texelEastM, 0.005 * tr.t))
function score(sm: SiteMax): { bad: number; n: number } {
  let bad = 0
  const inputs = rays(sm)
  for (const inp of inputs) {
    const a = groundHitDescent(inp), tr = truth(inp), fx = groundHitFixed(inp)
    // Both marches are heuristics (they overshoot thin rims): a ray counts as wrong only where the descent departs from the fixed march AND from the dense march.
    if (ok0(fx, tr) && !ok0(a, tr)) bad++
    continue
    const ok = (h: GroundHit): boolean => h.hit === tr.hit && (!h.hit || Math.abs(h.t - tr.t) <= Math.max(l2.texelEastM, 0.005 * tr.t))
    if (!ok(a)) bad++
  }
  return { bad, n: inputs.length }
}
const good = score(await grid(true))
const old = score(await grid(false))
console.log(`ground-band: rays ${good.n}; wrong with the band in the grid ${good.bad}; wrong with the band missing (the old grid) ${old.bad}`)
assert.ok(old.bad >= 5, 'the scenario must expose a grid without the band (otherwise it proves nothing)')
assert.ok(good.bad <= Math.ceil(good.n * 0.002), `the grid with the band must agree with a dense march (${good.bad} of ${good.n} wrong)`)
console.log('ground-band.test: ok')
