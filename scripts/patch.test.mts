/**
 * The site patches (Apollo 11 and 17): floor, zoom law, HUD wording, and, when a built patch is at
 * $MOON_PATCH_DIR (default ./.patch), its manifest and detail bytes.
 *   npm test
 */
import { reportSkip } from './test-skip.mts'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { SITE_CONE, SITE_FLAT, SITE_PITCH_MAX, PITCH_MAX, angularDistance, siteAltR, siteFloorDist, siteFloorGround, siteGround, zoomDist, type SiteFloor } from '../src/camera/pose.ts'
import { PatchLayer, TIER_EFFECTIVE_TEXEL_M, fadeFor, fittedSize, levelMatrix, upsample2x } from '../src/moon/patch/PatchLayer.ts'
import { PATCH_SITES } from '../src/moon/patch/sites.ts'
import { patchLightLine } from '../src/hud.ts'
import { CameraRig } from '../src/camera/rig.ts'
import { altitudeText, patchResolutionLine } from '../src/hud.ts'
import { MOMENTS } from '../src/moments.ts'

const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)
const R_KM = 1737.4

// 1. The floor at one texel per pixel: 0.5 m over 1200 px at a 30 deg field is 1,119 m.
const altR = siteAltR(0.5, 1200)
near(altR * R_KM * 1000, 1119.6, 0.5, 'floor altitude, m')
near(siteAltR(0.5, 5000) * R_KM * 1000, 1119.6, 0.5, 'canvas size capped')
assert.ok(siteAltR(0.5, 780) < altR, 'a smaller canvas goes lower')

// 2. The site's funnel: flat near the site, a steep cone after, never below the ground.
const site: SiteFloor = { lon: 23.473, lat: 0.6741, groundR: -1.928 / R_KM, altR }
near(siteGround(site, 23.473, 0.6741), site.groundR, 1e-12, 'ground at the site')
near(siteGround(site, 23.473, 20), 0, 1e-15, 'no ground offset far away')
near(siteFloorDist(site, 23.473, 0.6741), 1 + site.groundR + altR, 1e-12, 'floor over the site')
const dLat = (SITE_FLAT * 0.5 * 180) / Math.PI
near(siteFloorDist(site, 23.473, 0.6741 + dLat), siteFloorDist(site, 23.473, 0.6741), 1e-9, 'flat inside SITE_FLAT')
const far = siteFloorDist(site, 23.473, 0.6741 + 20)
assert.ok(far > 1.45, `the funnel is above the global floor by 20 deg (${far})`)
near(angularDistance(0, 0, 90, 0), Math.PI / 2, 1e-12, 'angular distance')
assert.ok(SITE_CONE >= 1)

// 3. The rig: the site lowers the floor only near the site, and the altitude law counts from the ground.
{
  const rig = new CameraRig()
  rig.setFloor(1.45)
  rig.site = site
  assert.equal(rig.floorAt(23.473, 0.6741) < 1, true)
  assert.equal(rig.floorAt(100, 40), 1.45)
  rig.setPose({ lon: 23.473, lat: 0.6741, dist: 0.5 })
  near(rig.pose.dist, 1 + site.groundR + altR, 1e-12, 'clamped to the site floor')
  rig.mode = 'fly'
  const g = rig.groundAt(23.473, 0.6741)
  const before = rig.pose.dist
  rig.zoom(2, 0)
  near(rig.pose.dist - 1 - g, 2 * (before - 1 - g), 1e-9, 'zoom out doubles the altitude above the ground')
  // Dragging away lifts the camera to the funnel.
  const r2 = new CameraRig()
  r2.setFloor(1.45)
  r2.site = site
  r2.setPose({ lon: 23.473, lat: 0.6741, dist: 0.9, pitch: 0 })
  r2.mode = 'fly'
  r2.orbit(0, -400, 800, 0)
  assert.ok(r2.pose.dist >= r2.floorAt(r2.pose.lon, r2.pose.lat) - 1e-12)
  // Without a site nothing changed: zoomDist and floorAt are the global ones.
  assert.equal(zoomDist(2, 0.5), zoomDist(2, 0.5, 0))
  const r3 = new CameraRig()
  r3.setFloor(1.45)
  assert.equal(r3.floorAt(23.473, 0.6741), 1.45)
}

// 4. What the HUD says: nothing until a pixel is a few metres, then the data's own numbers.
assert.equal(patchResolutionLine(null), null)
assert.equal(patchResolutionLine({ pxM: 100, imageM: 0.5, heightM: 2 }), null)
assert.match(patchResolutionLine({ pxM: 0.5, imageM: 0.5, heightM: 2 }) ?? '', /Data resolution reached \(photograph at 0.5 m per pixel, heights on a 2 m grid\)/)
assert.match(patchResolutionLine({ pxM: 0.3, imageM: 0.5, heightM: 2 }) ?? '', /Magnified past the data/)
assert.equal(altitudeText(1.12, true), '1,120 m above the ground')
assert.equal(altitudeText(950, false), '950 km up')

// 5. The tours exist and need both data sets and their own patch.
{
  const m = MOMENTS.find((x) => x.id === 'apollo11')
  assert.ok(m && m.needsPatch === 'a11' && m.needsTiles && m.camera.at === 'site')
  assert.equal(m.time().toISOString(), '2011-01-22T19:00:00.000Z')
  const m17 = MOMENTS.find((x) => x.id === 'apollo17')
  assert.ok(m17 && m17.needsPatch === 'a17' && m17.needsTiles && m17.camera.at === 'site')
  assert.equal(m17.time().toISOString(), '2011-01-23T06:00:00.000Z') // 14 deg Sun, lower than the photographs' 25 deg: side light on the massifs
  assert.ok(m17.caption.includes('0.6 m') && m17.caption.includes('2 m') && m17.caption.includes('NASA/GSFC/Arizona State University'))
}

// 5b. A level too big for a phone's texture limit is scaled to fit, aspect kept.
assert.deepEqual(fittedSize(3012, 4940, 16384), { w: 3012, h: 4940 })
{
  const f = fittedSize(3012, 4940, 4096)
  assert.equal(f.h, 4096)
  assert.ok(f.w <= 4096 && Math.abs(f.w / f.h - 3012 / 4940) < 1e-3, `${f.w}x${f.h}`)
  assert.deepEqual(fittedSize(4096, 4096, 4096), { w: 4096, h: 4096 })
}

// 5c. The HUD names the photograph's light: a mosaic always, a single photograph only when the sky's Sun is another.
{
  const base = { pxM: 1, imageM: 0.6, heightM: 2 }
  const a17 = PATCH_SITES.a17, a11 = PATCH_SITES.a11
  const line = patchLightLine({ ...base, photoTime: a17.photoTime, mosaic: a17.mosaic, simulated: new Date(a17.photoTime) }) ?? ''
  assert.match(line, /6 photographs, 28 Jul 2010 to 11 May 2011/)
  assert.match(line, /only the 22 Jan 2011, 05:50 UTC pass is named/)
  assert.doesNotMatch(line, /not that pass/)
  assert.match(patchLightLine({ ...base, photoTime: a17.photoTime, mosaic: a17.mosaic, simulated: new Date('2026-01-01T00:00:00Z') }) ?? '', /not that pass/)
  assert.equal(patchLightLine({ ...base, photoTime: a11.photoTime, simulated: new Date(a11.photoTime) }), null)
  assert.match(patchLightLine({ ...base, photoTime: a11.photoTime, simulated: new Date('2026-01-01T00:00:00Z') }) ?? '', /Photograph taken 22 Jan 2011, 19:00 UTC/)
  assert.equal(patchLightLine(null), null)
}

// 5d. Two-part heights (heightFormat 'f16x2': a half float and its half float remainder) keep sub-half-metre detail
// that one half float rounds away (spacing 1 m from 1024 to 2048 m), and the loader hands both to the texture.
{
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer)
  const toHalf = (v: number): number => { // round to nearest, finite normal values only (all this test uses)
    f32[0] = v
    const x = u32[0], sign = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff
    if (e <= 0) return e < -10 ? sign : sign | (((m | 0x800000) >> (1 - e)) + 0x1000 >> 13)
    return sign | (((e << 10) | (m >> 13)) + ((m & 0x1000) >> 12))
  }
  const halfVal = (h: number): number => { const e = (h >> 10) & 31, m = h & 1023; const v = e === 0 ? m * 2 ** -24 : (1 + m / 1024) * 2 ** (e - 15); return h & 0x8000 ? -v : v }
  const vals = [1100.3, 1500.71, 1800.123, -1500.4, 0.25, 1023.6]
  const hi = Uint16Array.from(vals.map(toHalf)), lo = Uint16Array.from(vals.map((v, i) => toHalf(v - halfVal(hi[i]))))
  const bytes = new Uint8Array(vals.length * 4)
  bytes.set(new Uint8Array(hi.buffer), 0); bytes.set(new Uint8Array(lo.buffer), vals.length * 2)
  const manifest = { version: 1, site: { name: 't', lat: 0, lon: 0, groundM: 0 }, h0M: 0, light: { time: '2011-01-22T00:00:00Z', sunElevationDeg: 10, sunEastFromNorthDeg: 0 }, credit: 'x',
    levels: [{ name: 'L2', w: 3, h: 2, texelM: 8, eastM: 0, northM: 0, texelEastM: 8, texelNorthM: 8, heights: 'h.gz', heightFormat: 'f16x2', detail: 'd.gz' }] }
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    const f = String(url).slice(String(url).lastIndexOf('/') + 1)
    if (f === 'manifest.json') return new Response(JSON.stringify(manifest))
    if (f === 'h.gz') return new Response(bytes)
    return new Response(new Uint8Array(6).fill(128))
  }) as typeof fetch
  try {
    const layer = await PatchLayer.create('http://x/', { terrainCellM: 8, initialDemand: { altitudeKm: 5, metresPerPixel: 8, zoomedIn: true } })
    const rg = layer.heights.L2.image.data as Uint16Array
    assert.equal(rg.length, vals.length * 2, 'two channels per texel')
    for (let i = 0; i < vals.length; i++) {
      const sum = halfVal(rg[2 * i]) + halfVal(rg[2 * i + 1])
      near(sum, vals[i], 2e-3, `two-part height ${vals[i]}`)
      if (Math.abs(vals[i]) > 1024) assert.ok(Math.abs(halfVal(rg[2 * i]) - vals[i]) > 0.1 || i === 5, `one half float alone is off by more than 0.1 m at ${vals[i]}`)
    }
    // the terrain grid reads the sum too
    assert.ok(layer.terrain, 'terrain grid built from two-part heights')
  } finally {
    globalThis.fetch = realFetch
  }
}

// 6. Built patches (each site's directory under $MOON_PATCH_DIR, default .patch; skipped without one).
const root = path.resolve(process.env.MOON_PATCH_DIR ?? '.patch')
for (const site of Object.values(PATCH_SITES)) {
  const dir = path.join(root, site.id)
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
    reportSkip('patch.test', 'data', `${site.id} data half skipped (no ${dir}/manifest.json)`)
    continue
  }
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  assert.equal(man.levels.map((l: { name: string }) => l.name).join(), 'L2,L1,L0')
  // The site table agrees with the manifest.
  near(man.site.lon, site.lon, 1e-9, `${site.id} lon`)
  near(man.site.lat, site.lat, 1e-9, `${site.id} lat`)
  assert.equal(man.site.groundM, site.groundM)
  assert.equal(new Date(man.light.time).getTime(), new Date(site.photoTime).getTime(), `${site.id} photo time`)
  near(man.levels[2].texelM, site.imageTexelM, 1e-6, `${site.id} finest image texel`)
  near(man.levels[1].texelM, site.heightTexelM, 1e-6, `${site.id} finest height texel`)
  for (const l of man.levels) {
    const d = zlib.gunzipSync(fs.readFileSync(path.join(dir, l.detail)))
    assert.equal(d.length, l.w * l.h, `${site.id} ${l.name} detail size`)
    let inRange = 0
    for (const b of d) if (b >= 1) inRange++
    assert.equal(inRange, d.length, `${site.id} ${l.name}: no zero bytes (0 is never written)`)
    // The centre of the ratio image is ordinary ground: the median byte sits at 128 +- 6 (ratio 0.9 to 1.1).
    const sorted = Uint8Array.from(d.subarray(0, Math.min(d.length, 4_000_000))).sort()
    const med = sorted[sorted.length >> 1]
    assert.ok(Math.abs(med - 128) <= 6, `${site.id} ${l.name} median byte ${med}`)
    if (l.heights) {
      const h = zlib.gunzipSync(fs.readFileSync(path.join(dir, l.heights)))
      assert.equal(h.length, l.w * l.h * (l.heightFormat === 'f16x2' ? 4 : 2), `${site.id} ${l.name} heights size`)
    }
  }
  // The levels nest: L0 inside L1 inside L2 (metres east and north of the site).
  const [l2, l1, l0] = man.levels
  // (Apollo 11's L2 drops the last 3 of 2,111 columns to make whole 8 m texels: 10 m of slack)
  const tol = 10
  const inside = (a: typeof l0, b: typeof l0) => a.eastM >= b.eastM - tol && a.eastM + a.w * a.texelEastM <= b.eastM + b.w * b.texelEastM + tol && a.northM <= b.northM + tol && a.northM - a.h * a.texelNorthM >= b.northM - b.h * b.texelNorthM - tol
  assert.ok(inside(l0, l1) && inside(l1, l2), `${site.id} levels nest`)
  // The site is at the centre of L0 and L1's rows.
  near(l0.eastM + (l0.w / 2) * l0.texelEastM, 0, 1, 'L0 centred east')
  near(l0.northM - (l0.h / 2) * l0.texelNorthM, 0, 1, 'L0 centred north')

  // Load it as the page does (files instead of fetch), with the terrain grid.
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    const file = path.join(dir, String(url).slice(String(url).lastIndexOf('/') + 1))
    return fs.existsSync(file) ? new Response(fs.readFileSync(file)) : new Response('no', { status: 404 })
  }) as typeof fetch
  try {
    const layer = await PatchLayer.create('http://x/', { terrainCellM: 128, tier: false })
    assert.equal(layer.levels.length, 3)
    assert.equal(layer.finest.name, 'L0')
    assert.equal(layer.finestHeights.name, 'L1')
    near(layer.groundR * R_KM * 1000, site.groundM, 1e-6, 'groundR')
    // A phone whose textures stop at 4096: every level fits, the heights stay finite, the texel grows by the scale.
    const small = await PatchLayer.create('http://x/', { maxTexture: 4096, tier: false })
    for (const l of small.levels) assert.ok(l.w <= 4096 && l.h <= 4096, `${site.id} ${l.name} ${l.w}x${l.h} fits 4096`)
    for (const [i, l] of small.levels.entries()) near(l.eastM + l.w * l.texelEastM, layer.levels[i].eastM + layer.levels[i].w * layer.levels[i].texelEastM, 1e-6, `${l.name} keeps its extent`)
    const t = small.heights.L2.image.data as Uint16Array
    assert.equal(t.length, small.level('L2').w * small.level('L2').h * (small.level('L2').heightFormat === 'f16x2' ? 2 : 1))
    if (site.terrainFollow) {
      const terr = layer.terrain
      assert.ok(terr, 'terrain grid built')
      const fl: SiteFloor = { lon: site.lon, lat: site.lat, groundR: layer.groundR, altR: siteAltR(site.imageTexelM, 1200), terrain: terr }
      // Never under the terrain: at every L2 texel the floor is above that texel's height plus one texel per pixel.
      const lv = layer.level('L2')
      const h = new Uint16Array(zlib.gunzipSync(fs.readFileSync(path.join(dir, lv.heights))).buffer.slice(0))
      const half = (b: number): number => { const e = (b >> 10) & 31, m = b & 1023; const v = e === 0 ? m * 2 ** -24 : (1 + m / 1024) * 2 ** (e - 15); return b & 0x8000 ? -v : v }
      let worst = Infinity, n = 0, lowest = Infinity
      for (let y = 0; y < lv.h; y += 3) for (let x = 0; x < lv.w; x += 3) {
        const east = lv.eastM + (x + 0.5) * lv.texelEastM, north = lv.northM - (y + 0.5) * lv.texelNorthM
        const lat = site.lat + north / (R_KM * 1000) * 180 / Math.PI
        const lon = site.lon + east / (R_KM * 1000 * Math.cos(site.lat * Math.PI / 180)) * 180 / Math.PI
        const terrainM = half(h[y * lv.w + x]) + (lv.heightFormat === 'f16x2' ? half(h[lv.w * lv.h + y * lv.w + x]) : 0) + man.h0M
        const clearM = (siteFloorDist(fl, lon, lat) - 1) * R_KM * 1000 - terrainM
        worst = Math.min(worst, clearM)
        lowest = Math.min(lowest, terrainM)
        n++
      }
      console.log(`patch.test: ${site.id} floor clearance over ${n} L2 texels: minimum ${worst.toFixed(0)} m above the texel (altitude at one texel per pixel ${(fl.altR * R_KM * 1000).toFixed(0)} m), terrain ${lowest.toFixed(0)} m and up`)
      assert.ok(worst >= 0, `the floor is under the terrain by ${-worst} m`)
      // The altitude reads from the ground below: over the highest ground it is not the site's ground.
      const g = siteGround(fl, site.lon, site.lat)
      near(g * R_KM * 1000, site.groundM, 60, 'ground at the site from the grid (within the 128 m mean)')
      assert.ok(siteFloorGround(fl, site.lon, site.lat) >= g - 1e-9)
      // Tilt to the horizon is allowed near the site only.
      assert.ok(SITE_PITCH_MAX > PITCH_MAX)
    }
    // Float32 heights (a GPU that filters float textures): the two half float parts summed into one raster, same values.
    if (site.terrainFollow) {
      const f = await PatchLayer.create('http://x/', { tier: false, floatLinear: true })
      const fd = f.heights.L1.image.data as Float32Array, hd = layer.heights.L1.image.data as Uint16Array
      assert.ok(fd instanceof Float32Array, 'L1 is one float32 raster')
      assert.equal(fd.length, f.level('L1').w * f.level('L1').h)
      const half = (b: number): number => { const e = (b >> 10) & 31, m = b & 1023; const v = e === 0 ? m * 2 ** -24 : (1 + m / 1024) * 2 ** (e - 15); return b & 0x8000 ? -v : v }
      for (const i of [0, 1234567, 8000000, fd.length - 1]) near(fd[i], half(hd[2 * i]) + half(hd[2 * i + 1]), 1e-3, `float32 sum at ${i}`)
    }
    // The optional 25 cm tier (Apollo 17 only, when its manifest sits beside the patch's): two more levels, the DTM then the image.
    const hasTier = fs.existsSync(path.join(dir, 'haase-tier.manifest.json'))
    if (hasTier) {
      const t2 = await PatchLayer.create('http://x/', { tier: true })
      assert.deepEqual(t2.levels.map((l) => l.name), ['L2', 'L1', 'L0', 'L-1h', 'L-1'])
      assert.equal(t2.finest.name, 'L-1')
      assert.equal(t2.finestHeights.name, 'L-1h')
      // The floor is set from an effective 0.4 m (native pixels are 27 by 56 cm), not the 0.25 m texel.
      assert.equal(t2.finest.floorTexelM, TIER_EFFECTIVE_TEXEL_M)
      assert.equal(TIER_EFFECTIVE_TEXEL_M, 0.4)
      near(t2.finestHeights.sourceTexelM ?? 0, 1.5, 1e-9, 'the DTM says its own 1.5 m grid')
      near(t2.finestHeights.texelM, 0.75, 1e-9, 'drawn at 0.75 m (bicubic 2x)')
      assert.equal(t2.finestHeights.w, 2040)
      assert.ok(t2.manifest.tier && t2.manifest.tier.light.inferred === true, 'its Sun is labelled inferred')
      assert.equal(t2.tierNear(site.lon, site.lat, 1700), true, 'the lander is near the tier')
      assert.equal(t2.tierNear(site.lon + 0.2, site.lat, 1700), false, 'and ground 6 km east of it is not')
      // The tier nests inside L0 (shifted frame already applied), heights inside the image's neighbourhood.
      const [, , g0] = t2.levels
      const tl = t2.level('L-1')
      assert.ok(tl.eastM >= g0.eastM && tl.eastM + tl.w * tl.texelEastM <= g0.eastM + g0.w * g0.texelEastM && tl.northM <= g0.northM && tl.northM - tl.h * tl.texelNorthM >= g0.northM - g0.h * g0.texelNorthM, 'the tier lies inside L0')
      // The rotated grid: metres to texels through the inverse of the axis vectors. A point one texel along x lands on column 1, row 0 (to 1e-6).
      const M = levelMatrix(tl), [ax, ay] = tl.axisEastPerTexelM as [number, number], [bx, by] = tl.axisSouthPerTexelM as [number, number]
      near(M[0] * ax + M[1] * ay, 1, 1e-9, 'x step -> column 1'); near(M[2] * ax + M[3] * ay, 0, 1e-9, 'x step -> row 0')
      near(M[0] * bx + M[1] * by, 0, 1e-9, 'y step -> column 0'); near(M[2] * bx + M[3] * by, 1, 1e-9, 'y step -> row 1')
      assert.ok(Math.abs(ay) > 0 && Math.abs(bx) > 0, 'the tier grid is really rotated (0.011 deg)')
      // A base level is the identity (column = east / texel, row = -north / texel).
      const bm = levelMatrix(t2.level('L1'))
      near(bm[0], 1 / t2.level('L1').texelEastM, 1e-12, 'base x'); near(bm[3], -1 / t2.level('L1').texelNorthM, 1e-12, 'base y'); assert.equal(bm[1] + bm[2], 0)
      // A phone: the image resamples to 4096, and its axis vectors grow so the extent stays.
      const t3 = await PatchLayer.create('http://x/', { maxTexture: 4096, tier: true })
      const s3 = t3.level('L-1')
      assert.ok(s3.w <= 4096 && s3.h <= 4096)
      near(s3.axisEastPerTexelM![0] * s3.w, tl.axisEastPerTexelM![0] * tl.w, 1e-6, 'tier extent kept after the resample')
    }
  } finally {
    globalThis.fetch = realFetch
  }
}

// The tier's DTM smoothing: a bicubic (Catmull-Rom) 2x resample. A linear ramp stays a linear ramp, a constant a constant, and the
// original samples' neighbourhood is reproduced (the value at a texel centre's midpoint sits between its neighbours).
{
  const w = 8, h = 6, ramp = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ramp[y * w + x] = 3 * x + 5 * y + 7
  const up = upsample2x(ramp, w, h)
  assert.equal(up.length, 4 * w * h)
  // Output texel (X, Y) centre sits at coarse coordinate (X + 0.5) / 2 - 0.5 (interior, away from the clamped border).
  for (let Y = 4; Y < 2 * h - 4; Y++) for (let X = 4; X < 2 * w - 4; X++) near(up[Y * 2 * w + X], 3 * ((X + 0.5) / 2 - 0.5) + 5 * ((Y + 0.5) / 2 - 0.5) + 7, 1e-4, `ramp at ${X},${Y}`)
  const step = new Float32Array(w * h).map((_, i) => ((i % w) >= 4 ? 10 : 0))
  const us = upsample2x(step, w, h)
  // Bicubic overshoots a step a little (Catmull-Rom), but never by more than 15% of it, and stays monotone away from the step's own texels.
  let mx = -Infinity, mn = Infinity
  for (const v of us) { mx = Math.max(mx, v); mn = Math.min(mn, v) }
  assert.ok(mx <= 11.5 && mn >= -1.5 && mx > 10.05, `step overshoot ${mn}..${mx}`)
}
assert.equal(fadeFor(8), 1596); assert.ok(fadeFor(8) >= 4 * 399, 'the outermost level fades over several global texels'); assert.equal(fadeFor(2), 800); assert.equal(fadeFor(0.6), 300); assert.equal(fadeFor(0.75), 300); assert.equal(fadeFor(0.25), 150)
console.log('patch.test: ok')
