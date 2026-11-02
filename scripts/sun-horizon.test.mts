// The Sun-keyed 4k horizon bake (src/moon/sunHorizon.ts, moonShader.ts sunBakeFragment / sbRead, tiles/SunHorizonBake.ts): codes round outward, the skip decision, the bins, memory, the CPU bound on a
// synthetic Moon, an emulation of the shader's quad ramp showing the skip changes no pixel, and the shader text (the legacy variants carry none of it; ?sunbake=0 leaves it out).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GH_AA_MAX_DEG, ghBuildPyramid, ghCertDeg, ghDir, ghHorizonDeg } from '../src/moon/globalHorizon.ts'
import { moonFragment, sunBakeFragment } from '../src/moon/moonShader.ts'
import {
  SB_BIN_EDGES, SB_BINS, SB_CERT_EXTRA_DEG, SB_MARGIN_DEG, SB_OFF_DEG, SB_Q_DEG, SB_SUN_TOL_RAD, SB_UNBUILT, SB_WIDTH,
  sbBinLods, sbBinOf, sbBuildOrder, sbBytes, sbCellCodes, sbCellRange, sbCertDeg, sbDecide, sbDecodeHi, sbDecodeLo, sbEncodeHi, sbEncodeLo, sbGridPoints, sbSunTangent, sunBakeOn,
} from '../src/moon/sunHorizon.ts'
import { SERVE_CATEGORIES, serveShares } from '../src/moon/shadowServe.ts'

// ---- Codes round outward: lo down, hi up; out of range is "no bound", never a wrong bound.
for (let v = -9.9; v <= 52; v += 0.0713) {
  assert.ok(sbDecodeHi(sbEncodeHi(v)) >= v, `hi of ${v}`)
  assert.ok(sbDecodeLo(sbEncodeLo(v)) <= v, `lo of ${v}`)
  assert.ok(sbEncodeHi(v) >= 2 && sbEncodeHi(v) <= 255 && sbEncodeLo(v) >= 1 && sbEncodeLo(v) <= 254)
}
assert.equal(sbEncodeLo(-30), 1, 'a lower bound below the code range is "none"')
assert.equal(sbDecodeLo(1), -Infinity)
assert.equal(sbEncodeHi(80), 255, 'an upper bound above the code range is "none"')
assert.equal(sbDecodeHi(255), Infinity)
assert.equal(sbDecodeHi(sbEncodeHi(SB_OFF_DEG - 5)), SB_OFF_DEG, 'an upper bound below the range is clamped UP (still a bound)')

// ---- The skip decision.
{
  const cert = sbCertDeg(1)
  assert.ok(Math.abs(cert - (GH_AA_MAX_DEG + GH_AA_MAX_DEG / 0.75 + SB_CERT_EXTRA_DEG)) < 1e-9, 'cert = ramp cap + quad partner term + slack')
  assert.ok(cert < ghCertDeg(1) - 2, `the bake needs about 5 deg where the envelope's certificate alone needs ${ghCertDeg(1).toFixed(2)}`)
  const lo = sbEncodeLo(2), hi = sbEncodeHi(6)
  assert.deepEqual(sbDecide(lo, hi, 6 + cert + 0.1, cert).skip, 1, 'the Sun clears hi: lit')
  assert.ok(sbDecide(lo, hi, 6 + cert + 0.1, cert).value >= 6, 'the returned value is the bound, not below the true horizon')
  assert.equal(sbDecide(lo, hi, 6 + cert - 0.1, cert).skip, 0, 'inside the certificate: march')
  assert.equal(sbDecide(lo, hi, 2 - cert - 0.1, cert).skip, -1, 'the Sun is below lo: shadowed')
  assert.ok(sbDecide(lo, hi, 2 - cert - 0.1, cert).value <= 2, 'the returned value is a lower bound')
  assert.equal(sbDecide(lo, hi, 4, cert).skip, 0, 'inside the range: march')
  assert.equal(sbDecide(SB_UNBUILT, SB_UNBUILT, 40, cert).skip, 0, 'unbuilt marches')
  assert.equal(sbDecide(1, 255, 40, cert).skip, 0, 'no bound either way marches')
  assert.equal(sbDecide(1, hi, 6 + cert + 1, cert).skip, 1, 'lit needs only hi')
  assert.equal(sbDecide(lo, 255, 2 - cert - 1, cert).skip, -1, 'dark needs only lo')
  assert.ok(sbCertDeg(0.5) > cert, 'a narrower ramp factor needs more clearance (the quad partner term grows)')
}

// ---- Bins: every lod up to the last edge is in exactly one bin; the sampled lods reach both edges.
{
  assert.equal(SB_BINS, 4)
  assert.equal(sbBinOf(0), 0); assert.equal(sbBinOf(1), 0); assert.equal(sbBinOf(1.0001), 1); assert.equal(sbBinOf(2), 1); assert.equal(sbBinOf(3.5), 2); assert.equal(sbBinOf(6.5), 3)
  assert.equal(sbBinOf(6.5001), -1, 'a coarser footprint marches live'); assert.equal(sbBinOf(Number.NaN), -1); assert.equal(sbBinOf(-1), -1)
  for (let b = 0; b < SB_BINS; b++) { const l = sbBinLods(b); assert.equal(l[0], SB_BIN_EDGES[b]); assert.equal(l[2], SB_BIN_EDGES[b + 1]) }
}

// ---- Memory.
assert.equal(sbBytes(SB_WIDTH.desktop), 16 << 20, 'desktop 16 MiB (2048 x 1024 cells x 4 bins x 2 bytes)')
assert.equal(sbBytes(SB_WIDTH.low), 4 << 20, 'low class 4 MiB')
assert.equal(sbGridPoints(3).length, 9)
assert.ok(sbGridPoints(3).every(([x, y]) => Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5), 'the grid stays inside the cell')
assert.deepEqual([sbGridPoints(3)[0], sbGridPoints(3)[8]], [[-0.5, -0.5], [0.5, 0.5]], 'and reaches its corners')

// ---- Build order: nearest the camera first, every block of every bin once.
{
  const o = sbBuildOrder(64, 32, [1, 0, 0], 16)
  assert.equal(o.length, 4 * 2 * SB_BINS)
  assert.equal(new Set(o.map((b) => `${b.bx},${b.by},${b.bin}`)).size, o.length)
  assert.ok([0, 1, 2, 3].includes(o[0].bin) && o[0].bin === 0, 'bins in order within a block')
}

// ---- Options.
assert.equal(sunBakeOn(''), true); assert.equal(sunBakeOn('?sunbake=0'), false); assert.equal(sunBakeOn('?sunbake=1'), true)
assert.ok(SB_SUN_TOL_RAD > 0 && SB_SUN_TOL_RAD < 0.001, 'a 0.05 deg tolerance')

// ---- CPU bound on a small smooth Moon: the live march at random positions and lods of a cell lies inside the cell's range once the margin is added.
const W = 256, H = 128
const base = new Float32Array(W * H)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const lon = (x + 0.5) / W * 2 * Math.PI, lat = (0.5 - (y + 0.5) / H) * Math.PI
  base[y * W + x] = Math.cos(lat) ** 2 * (2500 * Math.sin(3 * lon) * Math.cos(2 * lat) + 1800 * Math.sin(7 * lon + 1) * Math.sin(5 * lat) + 900 * Math.sin(11 * lon) * Math.cos(7 * lat + 2))
}
const pyr = ghBuildPyramid(base, W, H)
const sun: [number, number, number] = [Math.cos(0.1) * Math.cos(0.35), Math.cos(0.1) * Math.sin(0.35), Math.sin(0.1)]
const BW = 64, BH = 32
{
  let seed = 11
  const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  let n = 0, outside = 0
  for (let k = 0; k < 160; k++) {
    const i = Math.floor(rnd() * BW), j = 2 + Math.floor(rnd() * (BH - 4)), bin = Math.floor(rnd() * SB_BINS)
    const r = sbCellRange(pyr, sun, BW, BH, i, j, bin)
    assert.ok(r && r.lo <= r.hi)
    const [loC, hiC] = sbCellCodes(pyr, sun, BW, BH, i, j, bin)
    assert.ok(sbDecodeLo(loC) <= r.lo - SB_MARGIN_DEG + 1e-9 && sbDecodeHi(hiC) >= r.hi + SB_MARGIN_DEG - 1e-9, 'codes carry the margin and round outward')
    for (let m = 0; m < 6; m++) {
      const p = ghDir((i + rnd()) / BW, (j + rnd()) / BH)
      const t = sbSunTangent(p, sun)
      if (!t) continue
      const lod = SB_BIN_EDGES[bin] + rnd() * (SB_BIN_EDGES[bin + 1] - SB_BIN_EDGES[bin])
      const hz = ghHorizonDeg(pyr, p, t, lod)
      n++
      if (hz > sbDecodeHi(hiC) || hz < sbDecodeLo(loC)) outside++
    }
  }
  assert.ok(n > 700)
  assert.equal(outside, 0, `${outside} of ${n} live horizons leave the range plus margin on smooth terrain`)
}
assert.equal(sbSunTangent([0, 0, 1], [0, 0, 1]), null, 'the Sun at the zenith has no azimuth')

// ---- The skip changes no pixel: a patch of pixels, the legacy lit value (ramp width from the quad's true margins, as the shader's fwidth) against the value with skips applied.
{
  const cert = sbCertDeg(1)
  const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
  const SZ = 40, step = 0.9 // degrees per pixel
  const lod = 0.5, bin = sbBinOf(lod)
  const cells = new Map<number, [number, number]>()
  const px: Array<{ es: number; hz: number; codes: [number, number]; march: boolean }> = []
  const ramp = (m: number, w: number): number => smooth(-w, w, m)
  for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) {
    const lon = 20 + 90 - SZ * step / 2 + x * step, lat = 5 - SZ * step / 2 + y * step
    const u = ((lon + 180) / 360 % 1 + 1) % 1, v = (90 - lat) / 180
    const p = ghDir(u, v)
    const es = Math.asin(p[0] * sun[0] + p[1] * sun[1] + p[2] * sun[2]) * 180 / Math.PI
    const i = Math.min(BW - 1, Math.floor(u * BW)), j = Math.min(BH - 1, Math.floor(v * BH)), key = j * BW + i
    if (!cells.has(key)) cells.set(key, sbCellCodes(pyr, sun, BW, BH, i, j, bin))
    const t = sbSunTangent(p, sun)
    px.push({ es, hz: t ? ghHorizonDeg(pyr, p, t, lod) : -90, codes: cells.get(key)!, march: es > -10 && es < 38 && !!t })
  }
  let marching = 0, skipped = 0, worst = 0
  const wSun = 0.5
  for (let y = 0; y < SZ; y += 2) for (let x = 0; x < SZ; x += 2) {
    const q = [px[y * SZ + x], px[y * SZ + x + 1], px[(y + 1) * SZ + x], px[(y + 1) * SZ + x + 1]]
    const mTrue = q.map((a) => (a.march ? a.es - a.hz : 90))
    const mSkip = q.map((a, i) => {
      if (!a.march) return 90
      marching++
      const d = sbDecide(a.codes[0], a.codes[1], a.es, cert)
      if (d.skip === 0) return mTrue[i]
      skipped++
      return a.es - d.value
    })
    const fw = (m: number[], i: number): number => Math.abs(m[i ^ 1] - m[i]) + Math.abs(m[i ^ 2] - m[i])
    q.forEach((a, i) => {
      if (!a.march) return
      const legacy = ramp(mTrue[i], Math.max(wSun, Math.min(2, 0.75 * fw(mTrue, i))))
      const mine = ramp(mSkip[i], Math.max(wSun, Math.min(2, 0.75 * fw(mSkip, i))))
      worst = Math.max(worst, Math.abs(legacy - mine) * 255)
    })
  }
  assert.ok(marching > 300, `${marching} marching pixels`)
  assert.ok(skipped > 0.2 * marching, `the bake skipped ${skipped} of ${marching}`)
  assert.ok(worst <= 1, `skipping moved a pixel by ${worst.toFixed(2)} of 255`)
}

// ---- The shader text.
{
  const fixed = moonFragment(180, 4096, '', true, null, false, 0, false, undefined, false, false, true)
  const legacy = moonFragment(180, 4096, '', true, null, false, 0, false)
  assert.ok(fixed.includes('uniform highp sampler2D uSunBake') && fixed.includes('bool sbRead('), 'the fixed variant reads the bake')
  assert.ok(/if \(sLo - es > sbCert\(\)\)/.test(fixed) && /if \(es - sHi > sbCert\(\)\)/.test(fixed), 'lit and shadowed skips')
  assert.ok(!legacy.includes('sbRead') && !legacy.includes('uSunBake'), 'the legacy variant carries none of it')
  const noTiles = moonFragment(180, 4096, '', false, null, false, 0, false, undefined, false, false, true)
  assert.ok(noTiles.includes('bool sbRead('), 'the no-tile fixed variant reads it too')
  // Fragment-unit budget: the phone's detail variant (the heaviest) must stay within the 16 units every WebGL2 device has. The bake is the 16th: a further sampler needs one of these freed.
  const samplers = (src: string): number => (src.match(/^\s*uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?(?:u?sampler\w+)\s+\w+/gm) ?? []).length
  const detail = moonFragment(180, 4096, '', true, null, false, -3, true, undefined, true, false, true)
  assert.ok(samplers(detail) <= 16, `fixed detail variant uses ${samplers(detail)} samplers`)
  const hashes = JSON.parse(readFileSync(new URL('./fixtures/moon-shader-legacy-hashes.json', import.meta.url), 'utf8')) as Record<string, string>
  assert.ok(Object.keys(hashes).length >= 3, 'the legacy fixture is checked by global-horizon.test.mts')
  ;(globalThis as { location?: { search: string } }).location = { search: '?sunbake=0' }
  const off = moonFragment(180, 4096, '', true, null, false, 0, false, undefined, false, false, true)
  delete (globalThis as { location?: unknown }).location
  assert.ok(!off.includes('sbRead') && !off.includes('uSunBake'), '?sunbake=0 leaves it out')
  const bake = sunBakeFragment(180, 4096)
  assert.ok(bake.includes('horizonDeg(p, t, heightAt(uvOf(p), lods[l]), lods[l])') && bake.includes('uniform vec3 uS;') && bake.includes('uSbMargin'), 'the build pass runs the Moon pass\'s own march toward uS')
  assert.equal((bake.match(/uniform vec3 uS;/g) ?? []).length, 1)
  // serve debug: the two new categories count as exact
  assert.ok(SERVE_CATEGORIES.some((c) => c.key === 'bakeLit' && c.code === 15) && SERVE_CATEGORIES.some((c) => c.key === 'bakeDark' && c.code === 16))
  const sh = serveShares({ bakeLit: 3, bakeDark: 2, live: 5 })
  assert.equal(sh.exactShare, 0.5)
}
assert.ok(SB_Q_DEG === 0.25 && SB_BIN_EDGES.length === SB_BINS + 1)
console.log('sun-horizon tests passed')
