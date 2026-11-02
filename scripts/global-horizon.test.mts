import assert from 'node:assert/strict'
import { setFocusPull } from '../src/moon/tiles/focusPull.ts'
// The frozen shader text these checks guard is the switch-off one: the focus pull is on by default since 2026-10-31 and swaps the tile colour
// block (focus-pull.test.mts pins that variant and that everything after the colour block is the same text).
setFocusPull('?focuspull=0')
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  ENV_AZ, TENV_VIEW_EXTRA_DEG, ENV_BLOCK, ENV_LOD_MAX, ENV_LODS, ENV_MARGIN_DEG, ENV_UNBUILT, ENV_VIEW_CLEAR_DEG, ENV_WIDTH, GH_AA_MAX_DEG, GH_CERT_EXTRA_DEG, GhEnvelopeCpu, envBlockOrder, envBytes, envDecode, envDilate, envEncode,
  envSunLit, envViewVisible, ghBuildPyramid, ghCacheOn, ghCertDeg, ghDir, ghHorizonDeg, ghTangent, ghUv,
} from '../src/moon/globalHorizon.ts'
import { moonFragment, globalHorizonFragment, SHADOW_AA_MAX_DEG } from '../src/moon/moonShader.ts'
import { SERVE_CATEGORIES, VIS_CATEGORIES, serveShares } from '../src/moon/shadowServe.ts'

/** The legacy (fixedFallback = false) shader variants this work must leave byte-identical; the fixture was taken before the first edit. */
function legacyShaderHashes(): Record<string, string> {
  const h = (src: string): string => createHash('sha256').update(src).digest('hex')
  const variants: Record<string, string> = {
    'no-tiles': moonFragment(180, 4096, '', false),
    'tiles-0': moonFragment(180, 4096, '', true, null, false, 0, false),
    'tiles-m3': moonFragment(180, 4096, '', true, null, false, -3, false),
    'tiles-m3-detail': moonFragment(360, 23040, '', true, null, false, -3, true, undefined, true),
    baked: moonFragment(180, 4096, '', true, null, false, 0, false, undefined, false, true),
  }
  return Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, h(v)]))
}

// ---- Codes round outward; memory.
for (let v = -3; v <= 60; v += 0.0713) {
  assert.ok(envDecode(envEncode(v)) >= v, `code of ${v}`)
  assert.ok(envEncode(v) >= 1 && envEncode(v) <= 255)
}
assert.equal(envDecode(255), Infinity)
assert.equal(envBytes(ENV_WIDTH.desktop), 2 << 20, 'desktop envelope 2 MiB')
assert.equal(envBytes(ENV_WIDTH.low), 512 << 10, 'low-class envelope 0.5 MiB')
assert.ok(2 * envBytes(ENV_WIDTH.low) <= 6 << 20 && 2 * envBytes(ENV_WIDTH.desktop) <= 6 << 20, 'resident plus the raw build texture stays under 6 MiB')

// ---- Dilation: the 3x3 maximum, longitude wraps, latitude clamps, an unbuilt neighbour leaves it unbuilt.
{
  const w = 8, h = 4
  const raw = new Uint8Array(w * h).fill(10)
  raw[1 * w + 0] = 50
  const d = envDilate(raw, w, h)
  assert.equal(d[1 * w + 7], 50, 'wraps across longitude 180')
  assert.equal(d[0 * w + 1], 50)
  assert.equal(d[3 * w + 4], 10)
  raw[2 * w + 5] = ENV_UNBUILT
  const d2 = envDilate(raw, w, h)
  assert.equal(d2[1 * w + 4], ENV_UNBUILT, 'next to an unbuilt texel')
  assert.notEqual(d2[0 * w + 0], ENV_UNBUILT, 'far from it')
}

// ---- CPU reference: a small smooth Moon, a 32 x 16 envelope.
const W = 256, H = 128
const base = new Float32Array(W * H)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const lon = (x + 0.5) / W * 2 * Math.PI, lat = (0.5 - (y + 0.5) / H) * Math.PI
  // (scaled by cos^2 lat so the longitude terms vanish at the poles, where one degree of longitude is no distance)
  base[y * W + x] = Math.cos(lat) ** 2 * (2500 * Math.sin(3 * lon) * Math.cos(2 * lat) + 1800 * Math.sin(7 * lon + 1) * Math.sin(5 * lat) + 900 * Math.sin(11 * lon) * Math.cos(7 * lat + 2))
}
const pyr = ghBuildPyramid(base, W, H)
assert.equal(pyr.levels.length, 8)
const EW = 32, EH = 16
const env = new GhEnvelopeCpu(EW, EH)
assert.equal(env.lookup(0.3, 0.5, 1), null, 'nothing is served before the envelope is built')
for (let by = 0; by * ENV_BLOCK < EH; by++) for (let bx = 0; bx * ENV_BLOCK < EW; bx++) env.buildBlock(pyr, bx, by)
assert.equal(env.lookup(0.3, 0.5, 1), null, 'nothing is served before the dilate pass (finish) has run')
env.finish()
assert.notEqual(env.lookup(0.3, 0.5, 1), null)
assert.equal(env.lookup(0.3, 0.5, ENV_LOD_MAX + 0.1), null, 'a footprint coarser than the sampled lods marches live')
assert.equal(env.lookup(0.3, 0.5, Number.NaN), null)

// ---- The envelope contains the live march between its sample points on smooth terrain (the margin covers the gaps).
{
  let seed = 3
  const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  let viol = 0, worst = -Infinity
  const N = 400
  for (let k = 0; k < N; k++) {
    const u = rnd(), v = 0.04 + 0.92 * rnd(), lod = rnd() * ENV_LOD_MAX
    const e = env.lookup(u, v, lod)
    assert.notEqual(e, null)
    const p = ghDir(u, v)
    const hz = ghHorizonDeg(pyr, p, ghTangent(p, rnd() * 2 * Math.PI), lod)
    if (hz > e!) viol++
    worst = Math.max(worst, hz - e!)
  }
  assert.equal(viol, 0, `the live horizon exceeded the envelope ${viol} of ${N} times (worst ${worst.toFixed(3)} deg over)`)
  assert.ok(ghUv(ghDir(0.3, 0.6))[0] > 0)
  const p = ghDir(0.37, 0.41), t = ghTangent(p, 1.1)
  assert.ok(Math.abs(Math.hypot(...t) - 1) < 1e-5 && Math.abs(t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) < 1e-5, 'the tangent is horizontal and unit (to the shader\'s 1e-6 frame offset)')
}

// ---- The skips decide exactly: a skipped pixel has the lit value / visibility the live march gives.
{
  const ss = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
  const cert = ghCertDeg(1)
  let seed = 9
  const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  let skippedSun = 0, skippedView = 0, total = 0
  for (let k = 0; k < 600; k++) {
    const u = rnd(), v = 0.05 + 0.9 * rnd(), lod = rnd() * ENV_LOD_MAX
    const e = env.lookup(u, v, lod)!
    const p = ghDir(u, v)
    total++
    const elev = -5 + 50 * rnd()
    if (envSunLit(e, elev, cert)) {
      skippedSun++
      const live = ghHorizonDeg(pyr, p, ghTangent(p, rnd() * 2 * Math.PI), lod)
      for (const w of [0.267, 1, 2]) assert.equal(ss(-w, w, elev - live), 1, 'a skipped Sun pixel is fully lit for every edge width up to the cap')
    }
    if (envViewVisible(e, elev)) {
      skippedView++
      const live = ghHorizonDeg(pyr, p, ghTangent(p, rnd() * 2 * Math.PI), lod)
      assert.equal(ss(live - 0.5, live + 0.5, elev), 1, 'a skipped viewer test is exactly visible')
    }
  }
  assert.ok(skippedSun > 0.2 * total && skippedView > 0.2 * total, `most high-Sun pixels skip (${skippedSun}, ${skippedView} of ${total})`)
  assert.equal(envSunLit(5, 5 + cert, cert), false, 'the clearance is strict')
  assert.equal(envSunLit(5, 5 + cert + 0.01, cert), true)
  assert.equal(envViewVisible(5, 5 + ENV_VIEW_CLEAR_DEG + 1e-9), true)
  assert.equal(envViewVisible(5, 5 + ENV_VIEW_CLEAR_DEG - 0.01), false)
  // The certificate is the shader's: the AA cap, the partner pixel's edge width and a little for rounding.
  assert.equal(GH_AA_MAX_DEG, SHADOW_AA_MAX_DEG)
  assert.ok(Math.abs(cert - (2 + 2 / 0.75 + GH_CERT_EXTRA_DEG)) < 1e-9)
  assert.ok(ghCertDeg(0.5) > cert, 'a gesture frame with a narrower edge factor needs a larger clearance')
  assert.ok(ENV_MARGIN_DEG >= 0.5 && ENV_AZ === 8 && ENV_LODS.length === 4)
}

// ---- Build order: nearest the camera first, every block once.
{
  const order = envBlockOrder(2048, 1024, [1, 0, 0])
  assert.equal(order.length, 16 * 8)
  assert.equal(new Set(order.map((b) => `${b.bx},${b.by}`)).size, order.length)
  assert.ok([7, 8].includes(order[0].bx) && [3, 4].includes(order[0].by), 'first block is under the camera (lon 0, lat 0)')
  const far = envBlockOrder(2048, 1024, [-1, 0, 0])
  assert.ok(far[0].bx === 0 || far[0].bx === 15, 'from the far side the first block is at the longitude seam')
}
assert.equal(ghCacheOn('?ghcache=0'), false)
assert.equal(ghCacheOn(''), true)

// ---- Shaders: legacy source is byte-identical to the source before this work (hashes taken before the first edit); fixed carries the envelope.
{
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/moon-shader-legacy-hashes.json', import.meta.url), 'utf8')) as Record<string, string>
  assert.deepEqual(legacyShaderHashes(), fixture, 'legacy (fixedFallback = false) shader source is unchanged')
  const legacy = moonFragment(180, 4096, '', true, null, false, -3, false)
  assert.ok(!legacy.includes('uEnvTex') && !legacy.includes('ghOldHorizon') && !legacy.includes('envMax'))
  const fixed = moonFragment(180, 4096, '', true, null, false, -3, false, undefined, false, false, true)
  assert.ok(fixed.includes('uniform highp usampler2D uEnvTex'))
  assert.ok(fixed.includes('float horizonAtSun(vec3 p, vec3 t, float lod, float lodT) {') && fixed.includes('return horizonAtSun(p, t, lod, lodT);'), 'the Sun horizon reads the envelope-aware march')
  assert.ok(fixed.includes('if (w <= 0.0) return ghOldHorizon(p, t, uvp, lod);'), 'a pixel with no tile share is served by the envelope or the original march')
  assert.ok(fixed.includes('float hm = mix(em, (rcv ? rHi : hzNew), w);') && fixed.includes('if (ghSunElev(p) - hm > ghCert() + rE)'), 'a blended pixel runs the tile march and replaces only the 4k term by the envelope, when the blended horizon still clears the Sun')
  assert.ok(fixed.includes('hzOld = horizonDeg(p, t, heightAt(uvp, lod), lod);\n') && fixed.includes('    return mix(hzOld, hzNew, w);\n  }'), 'otherwise the 4k term is marched as legacy (the ring cache variant may re-march the tile term before this return)')
  assert.ok(fixed.includes('float hzOld = w < 1.0 ? horizonDeg(p, t, heightAt(uvp, lod), lod) : 0.0;'), 'horizonAt itself is unchanged (the viewer test calls it)')
  assert.ok(fixed.includes('if (ghSunElev(p) - em > ghCert())') && fixed.includes('!(lod <= 6.5)'), 'a skip needs the clearance; a coarse footprint marches live')
  assert.ok(fixed.includes('float envV = horizonBound(p, normalize(tv), lod0, lodT0);'), 'the viewer skip reads the combined bound: the 4k envelope where the old march is used, the tile envelope (and, between, their mix) elsewhere')
  assert.ok(fixed.includes(`if (elevV - envV >= ${ENV_VIEW_CLEAR_DEG.toFixed(1)} + (gTileMarch > 0.0 ? ${TENV_VIEW_EXTRA_DEG.toFixed(1)} : 0.0)) { vis = 1.0; } else {`), 'tile pixels need more clearance')
  assert.ok(fixed.includes('float hzV = horizonAt(p, normalize(tv), lod0, lodT0);'), 'every other pixel runs the original viewer march')
  assert.ok(!legacy.includes('envV') && !legacy.includes('hz0'))
  assert.ok(!fixed.includes('hz0'), 'sub-pixel tap reuse is off by default (an estimate, not a bound)')
  assert.ok(fixed.includes('hzs = length(tss) > 1e-4 ? horizonSun(ps, normalize(tss), lodS, lodST) : -90.0;'), 'every other tap marches as legacy')
  const fixedNoTiles = moonFragment(180, 4096, '', false, null, false, 0, false, undefined, false, false, true)
  assert.ok(fixedNoTiles.includes('return ghOldHorizon(p, t, uvOf(p), lod);') && fixedNoTiles.includes('return horizonAtSun(p, t, lod, lodT);'))
  assert.ok(fixedNoTiles.includes('float envV = envMax(uv, lod0, p, normalize(tv));'))
  // Not in the baked lane, not for a map that is not the whole globe, not in the unbounded edge-width modes.
  assert.ok(!moonFragment(180, 4096, '', true, null, false, 0, false, undefined, false, true, true).includes('uEnvTex'))
  assert.ok(!moonFragment(360, 23040, '', true, null, false, -3, false, undefined, false, false, true).includes('uEnvTex'))
  assert.ok(!moonFragment(180, 4096, '', true, null, false, 0, false, 'legacy', false, false, true).includes('uEnvTex'), 'the unbounded edge-width modes keep the live march')
  // The Moon pass and the build pass run the same march text.
  const build = globalHorizonFragment(180, 4096)
  const fn = build.slice(build.indexOf('float horizonDeg(vec3 p, vec3 t, float h0, float lod0) {'), build.indexOf('uniform float uGhMode;'))
  assert.ok(fn.includes('best = max(best, atan((hq - h0) * 0.001 - rq * omc, rq * s));'))
  assert.ok(fixed.includes(fn.trim()) && legacy.includes(fn.trim()), 'build pass and Moon pass share the old march verbatim')
  assert.ok(build.includes('const int STEPS = 32;') && fixed.includes('const int STEPS = 32;'))
  assert.ok(build.includes('cross(uK, p) + 1e-6') && fixed.includes('cross(uK, p) + 1e-6'), 'the build tangent frame is the Moon pass\'s')
  assert.ok(!/\buS\b/.test(build), 'the envelope does not depend on the Sun')
  // Fragment-unit budget: one sampler more than legacy, at most 16.
  const samplers = (src: string): number => (src.match(/^\s*uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?(?:u?sampler\w+)\s+\w+/gm) ?? []).length
  assert.equal(samplers(fixed), samplers(legacy) + 3, 'three samplers more than legacy: the 4k envelope, the per-tile envelope array and the Sun-keyed 4k bake')
  assert.ok(samplers(fixed) <= 16, `fixed tile variant uses ${samplers(fixed)} samplers`)
  // Serve categories.
  assert.equal(SERVE_CATEGORIES.find((c) => c.key === 'envelopeLit')?.code, 9)
  assert.deepEqual(VIS_CATEGORIES.map((c) => c.key), ['visNotNeeded', 'visSkipped', 'visMarched', 'visGated', 'visNoEnv'])
  assert.equal(serveShares({ envelopeLit: 3, liveGate: 1 }).exactShare, 0.75)
}

console.log('horizon envelope passed')

// ---- Debug builds: the serve view carries the "why not skipped" categories and the tile-share view.
{
  const g = globalThis as { location?: unknown }
  const saved = g.location
  g.location = { search: '?shadowdebug=serve' }
  try {
    const dbg = moonFragment(180, 4096, '', true, null, false, -3, false, undefined, false, false, true)
    assert.ok(dbg.includes('gServe = 11.0;') && dbg.includes('gServe = 9.0;') && dbg.includes('gServe = 12.0;') && dbg.includes('gServe = 13.0;') && dbg.includes('gServe = 14.0;') && !dbg.includes('gServe = 10.0;'))
    assert.ok(dbg.includes('wDebugColour(gTileMarch)') && dbg.includes('uDbg > 21.5 && uDbg < 22.5'))
    assert.ok(dbg.includes('gVis = (envV < 1.0e3 ? 2.0 : (gTileMarch > 0.0 ? 3.0 : 4.0));'))
    const noTiles = moonFragment(180, 4096, '', false, null, false, 0, false, undefined, false, false, true)
    assert.ok(!noTiles.includes('wDebugColour(gTileMarch)'), 'no gTileMarch without tiles')
  } finally { g.location = saved }
}
console.log('debug categories passed')
