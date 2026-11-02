/**
 * Functional test of the horizon envelope (4k map) on a synthetic height map: dev page `envelope-test.html`, driven by the envelope-test job under infra/
 * (a software-GL run: CORRECTNESS only, never timing). Writes the result to window.__envTest and the page.
 *
 *  1. BUILD: the real GlobalHorizonCache builds the sectored RG32UI envelope; EnvReadback converts it to bytes; for sampled texels the CPU twin (envTexelSectors, 3x3 dilate per
 *     sector) must give the same eight bytes (a quantisation step of difference is counted apart: float32 against float64 at a code boundary).
 *  2. READ: the Moon pass's own read text (envReadTestFragment) is run for rows of (position, lod, tangent): its sector must equal sectorOfAzimuth of the azimuth the row was made
 *     from, its raw code must equal the readback byte of that texel and sector, and its bound must decode that code.
 *  3. CONSERVATIVE: the bound against the live old-march horizon at arbitrary azimuths, positions and lods: exceedances counted and sized (there must be none).
 */
import * as THREE from 'three'
import { GlobalHorizonCache } from '../tiles/GlobalHorizonCache'
import { envReadTestFragment } from '../moonShader'
import { loadHeight } from '../maps'
import { FULLSCREEN_VERTEX, fullscreenTriangle } from '../../glsl/common'
import { ENV_FINE_GRID, ENV_LOD_MAX, ENV_SECTORS, ENV_SECTOR_AZ, ENV_SECTOR_PAD_DEG, envDecode, envEncode, envTexelSectors, ghBuildPyramid, ghDir, ghTangent, ghUv, sectorOfAzimuth, type GhPyramid } from '../globalHorizon'

const MAPW = 512, MAPH = 256
const q = new URLSearchParams(location.search)
const NSAMPLES = Number(q.get('n') ?? 60)
/** ?real=1: the app's own 4k LOLA height map (no CPU-twin comparison, which needs the synthetic pyramid); ?low=1: the phone-class 512 x 256 envelope; ?side=N: N x N read rows. */
const REAL = q.get('real') === '1'
const LOW = q.get('low') === '1'
const SIDE = Number(q.get('side') ?? 128)
/** Build block size (texels): small, so one SwiftShader draw stays well under the GPU process watchdog. */
const BLOCK = Number(q.get('block') ?? 32)
/** ?azs=16,32,48: the azimuth-sample counts to build and test, one after the other, on the same rows (the CPU twin compares the first). */
const AZS = (q.get('azs') ?? String(ENV_SECTOR_AZ)).split(',').map((x) => { const [a, g] = x.split(':'); return { az: Number(a), grid: Number(g ?? ENV_FINE_GRID) } })

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** Craters with raised rims, hills and a few walls on an equirect map, metres, within +-3000. */
function synthMap(): Float32Array {
  const r = rng(7)
  const h = new Float32Array(MAPW * MAPH)
  for (let k = 0; k < 140; k++) {
    const cx = r() * MAPW, cy = 20 + r() * (MAPH - 40), rad = 2 + r() * r() * 22, rim = 300 + r() * 2200, depth = rim * (0.6 + 0.8 * r())
    const reach = Math.ceil(rad * 1.6)
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const d = Math.hypot(dx, dy) / rad
      let v = 0
      if (d < 1) v = -depth * (1 - d * d) + rim * d ** 4
      else if (d < 1.6) v = rim * Math.max(0, 1 - (d - 1) / 0.6) ** 1.5
      const x = (((Math.round(cx) + dx) % MAPW) + MAPW) % MAPW, y = Math.min(MAPH - 1, Math.max(0, Math.round(cy) + dy))
      h[y * MAPW + x] += v
    }
  }
  for (let y = 0; y < MAPH; y++) for (let x = 0; x < MAPW; x++) {
    h[y * MAPW + x] += 500 * Math.sin(x * 0.045 + 1) * Math.cos(y * 0.07) + 300 * Math.sin(x * 0.19 + y * 0.11)
    h[y * MAPW + x] = Math.max(-3000, Math.min(3000, h[y * MAPW + x]))
  }
  return h
}

function halfRound(a: Float32Array): { data: Uint16Array; rounded: Float32Array } {
  const data = new Uint16Array(a.length), rounded = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) { data[i] = THREE.DataUtils.toHalfFloat(a[i]); rounded[i] = THREE.DataUtils.fromHalfFloat(data[i]) }
  return { data, rounded }
}

/** Waits until the GPU has finished everything queued (gl.finish is not a wait in Chrome): one block at a time keeps every GPU command short, under the GPU process watchdog. */
async function fence(gl: WebGL2RenderingContext): Promise<void> {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
  if (!sync) return
  gl.flush()
  for (let i = 0; i < 20000; i++) {
    const r = gl.clientWaitSync(sync, 0, 0)
    if (r === gl.ALREADY_SIGNALED || r === gl.CONDITION_SATISFIED || r === gl.WAIT_FAILED) break
    await new Promise((res) => setTimeout(res, 5))
  }
  gl.deleteSync(sync)
}

async function main(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { mapW: MAPW, mapH: MAPH, sectorAz: ENV_SECTOR_AZ, sectorPad: ENV_SECTOR_PAD_DEG }
  const canvas = document.createElement('canvas')
  canvas.width = 64; canvas.height = 64
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
  const gl = renderer.getContext() as WebGL2RenderingContext
  out.gl = { renderer: gl.getParameter(gl.RENDERER), floatTargets: !!gl.getExtension('EXT_color_buffer_float') }

  // ---- the height map: synthetic (as the app holds it: R16F with a mip chain, and the CPU twin's pyramid over exactly those values), or the real 4k map.
  let tex: THREE.Texture
  let nLevels: number
  let mapW = MAPW
  let pyr: GhPyramid | null = null
  if (REAL) {
    const hm = await loadHeight()
    tex = hm.texture; nLevels = hm.levels; mapW = hm.size[0]
    out.mapW = mapW; out.mapH = hm.size[1]
  } else {
    const base = synthMap()
    const pyr0 = ghBuildPyramid(base, MAPW, MAPH, true)
    const mips: Array<{ data: Uint16Array; width: number; height: number }> = []
    const levels: GhPyramid['levels'] = []
    for (const L of pyr0.levels) { const hr = halfRound(L.data); mips.push({ data: hr.data, width: L.w, height: L.h }); levels.push({ w: L.w, h: L.h, data: hr.rounded }) }
    pyr = { levels, wrap: true, texelKm: pyr0.texelKm }
    const t = new THREE.DataTexture(mips[0].data, MAPW, MAPH, THREE.RedFormat, THREE.HalfFloatType)
    t.internalFormat = 'R16F'
    t.mipmaps = mips as unknown as THREE.DataTexture['mipmaps']
    t.generateMipmaps = false
    t.minFilter = THREE.NearestMipmapNearestFilter
    t.magFilter = THREE.NearestFilter
    t.flipY = false
    t.unpackAlignment = 1
    t.needsUpdate = true
    tex = t; nLevels = mips.length
  }

  const K = new THREE.Vector3(0, 0, 1), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0)
  const pass: Record<string, THREE.IUniform> = {
    uK: { value: K }, uX: { value: X }, uY: { value: Y }, uHeight: { value: tex }, uHeightLevels: { value: nLevels }, uHeightMix: { value: 1 },
    uCamPos: { value: new THREE.Vector3(3.6, 0, 0) },
  }

  // ---- the read rows: random (position, azimuth, lod), the same for every variant.
  const side = SIDE
  const rows = side * side
  const data = new Float32Array(side * (2 * side) * 4)
  const rr = rng(23)
  const meta: Array<{ az: number; u: number; v: number; lod: number }> = []
  for (let k = 0; k < rows; k++) {
    const lat = Math.asin(2 * rr() - 1) * 0.97, lon = (rr() * 2 - 1) * Math.PI
    const p: [number, number, number] = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
    const az = rr() * 2 * Math.PI
    const lod = rr() * 7
    const t = ghTangent(p, az)
    const cx = k % side, cy = Math.floor(k / side)
    data.set([p[0], p[1], p[2], lod], ((2 * cy) * side + cx) * 4)
    data.set([t[0], t[1], t[2], 0], ((2 * cy + 1) * side + cx) * 4)
    const [u, v] = ghUv(p)
    meta.push({ az, u, v, lod })
  }
  const rowsTex = new THREE.DataTexture(data, side, 2 * side, THREE.RGBAFormat, THREE.FloatType)
  rowsTex.minFilter = rowsTex.magFilter = THREE.NearestFilter
  rowsTex.generateMipmaps = false
  rowsTex.needsUpdate = true
  const envUniform: THREE.IUniform = { value: null }
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERTEX, fragmentShader: envReadTestFragment(180, mapW),
    uniforms: { uK: pass.uK, uX: pass.uX, uY: pass.uY, uHeight: pass.uHeight, uHeightLevels: pass.uHeightLevels, uHeightMix: pass.uHeightMix, uEnvTex: envUniform, uEnvOn: { value: 1 }, uTermAA: { value: 1 }, uS: { value: new THREE.Vector3(1, 0, 0) }, uRows: { value: rowsTex } },
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  })
  const scene = new THREE.Scene()
  const mesh = new THREE.Mesh(fullscreenTriangle(), mat)
  mesh.frustumCulled = false
  scene.add(mesh)
  const rt = new THREE.WebGLRenderTarget(side, side, { format: THREE.RGBAFormat, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false })

  const variants: Record<string, unknown> = {}
  out.variants = variants
  for (const { az, grid } of AZS) {
    const v: Record<string, unknown> = { az, grid }
    variants[`${az}:${grid}`] = v
    console.log(`envtest variant az=${az} grid=${grid} start ${Math.round(performance.now())}`)
    // ---- 1. BUILD
    const t0 = performance.now()
    const cache = new GlobalHorizonCache(renderer, pass, 180, mapW, LOW, az, BLOCK, grid)
    const { w, h } = cache.size
    for (let i = 0; i < 4000 && cache.stats.state !== 'ready'; i++) { cache.update({ now: performance.now(), frameMs: 16, allowed: true }); await fence(gl) }
    console.log(`envtest variant az=${az} grid=${grid} built ${Math.round(performance.now())} state=${cache.stats.state}`)
    v.build = { state: cache.stats.state, w, h, ms: Math.round(performance.now() - t0), failed: cache.failed, glError: gl.getError() }
    if (cache.stats.state !== 'ready') continue
    const bytes = cache.readback()
    if (!bytes) { v.error = 'readback returned null'; continue }
    let nonzero = 0
    const perSectorNonzero = new Array<number>(ENV_SECTORS).fill(0)
    for (let t = 0; t < w * h; t++) for (let s = 0; s < ENV_SECTORS; s++) if (bytes[t * 8 + s] > 0) { nonzero++; perSectorNonzero[s]++ }
    v.nonzeroBytes = { total: nonzero, of: w * h * 8, perSector: perSectorNonzero }

    if (pyr && az === AZS[0].az && grid === AZS[0].grid) {
      const rawCache = new Map<number, Uint8Array>()
      const rawAt = (i: number, j: number): Uint8Array => {
        const key = j * w + i
        let r = rawCache.get(key)
        if (!r) { r = Uint8Array.from(envTexelSectors(pyr!, w, h, i, j, az, grid).map((x) => envEncode(x))); rawCache.set(key, r) }
        return r
      }
      const dil = (i: number, j: number): Uint8Array => {
        const m = new Uint8Array(ENV_SECTORS)
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const r = rawAt((i + dx + w) % w, Math.min(h - 1, Math.max(0, j + dy)))
          for (let s = 0; s < ENV_SECTORS; s++) m[s] = Math.max(m[s], r[s])
        }
        return m
      }
      const rnd = rng(11)
      let exact = 0, off1 = 0, worse = 0
      const mism: Array<Record<string, unknown>> = []
      const perm = new Map<string, number>()
      const spread = new Set<number>()
      for (let n = 0; n < NSAMPLES; n++) {
        const i = Math.floor(rnd() * w), j = Math.floor(rnd() * h)
        const cpu = dil(i, j)
        for (let s = 0; s < ENV_SECTORS; s++) {
          const g = bytes[(j * w + i) * 8 + s]
          spread.add(cpu[s])
          const d = Math.abs(g - cpu[s])
          if (d === 0) exact++
          else if (d === 1) off1++
          else {
            worse++
            for (let s2 = 0; s2 < ENV_SECTORS; s2++) if (s2 !== s && cpu[s2] === g) perm.set(`gpu sector ${s} = cpu sector ${s2}`, (perm.get(`gpu sector ${s} = cpu sector ${s2}`) ?? 0) + 1)
            if (mism.length < 12) mism.push({ i, j, s, gpu: g, cpu: cpu[s], cpuAll: Array.from(cpu), gpuAll: Array.from(bytes.subarray((j * w + i) * 8, (j * w + i) * 8 + 8)) })
          }
        }
      }
      v.buildCompare = { texels: NSAMPLES, bytes: NSAMPLES * ENV_SECTORS, exact, off1, worse, distinctCpuValues: spread.size, permutationHits: Object.fromEntries(perm), mismatches: mism }
    }

    // ---- 2. READ and 3. CONSERVATIVE
    envUniform.value = cache.texture
    renderer.setRenderTarget(rt)
    renderer.render(scene, new THREE.Camera())
    const px = new Float32Array(side * side * 4)
    renderer.readRenderTargetPixels(rt, 0, 0, side, side, px)
    renderer.setRenderTarget(null)
    v.readGlError = gl.getError()

    let secOk = 0, secBad = 0, codeOk = 0, codeBad = 0, boundOk = 0, boundBad = 0, noBound = 0, bounded = 0
    // gt3: a Sun skip (certificate over the envelope >= ~5 deg, the lit ramp <= 2 deg) is wrong by more than ~3 deg; gt01: the viewer skip (clear 0.6 over the envelope, ramp ends 0.5 over the live horizon) has 0.1 deg of slack.
    const exc = { gt0: 0, gt01: 0, gt025: 0, gt05: 0, gt1: 0, gt2: 0, gt3: 0, max: 0 }
    const examples: Array<Record<string, unknown>> = []
    const secBadEx: Array<Record<string, unknown>> = []
    const spacing = 360 / az
    const byOffset = new Array<number>(8).fill(0)
    for (let k = 0; k < rows; k++) {
      const m = meta[k]
      const bound = px[k * 4], live = px[k * 4 + 1], sec = px[k * 4 + 2], code = px[k * 4 + 3]
      const azDeg = m.az * 180 / Math.PI
      const nearEdge = Math.abs(((azDeg % 45) + 45) % 45) < 0.02 || Math.abs(((azDeg % 45) + 45) % 45 - 45) < 0.02
      const expSec = sectorOfAzimuth(m.az)
      if (!nearEdge) {
        if (sec === expSec) secOk++
        else { secBad++; if (secBadEx.length < 8) secBadEx.push({ azDeg, gpuSector: sec, cpuSector: expSec }) }
      }
      const i = ((Math.floor(m.u * w) % w) + w) % w, j = Math.min(h - 1, Math.max(0, Math.floor(m.v * h)))
      const expCode = bytes[(j * w + i) * 8 + expSec]
      if (!nearEdge) { if (code === expCode) codeOk++; else codeBad++ }
      const lodOk = m.lod <= ENV_LOD_MAX
      if (!lodOk || code < 1 || code > 254) { noBound++; if (bound < 1e3) boundBad++; continue }
      if (Math.abs(bound - envDecode(code)) < 1e-4) boundOk++; else boundBad++
      bounded++
      const e = live - bound
      if (e > 0) {
        exc.gt0++; if (e > 0.1) exc.gt01++; if (e > 0.25) exc.gt025++; if (e > 0.5) exc.gt05++; if (e > 1) exc.gt1++; if (e > 2) exc.gt2++; if (e > 3) exc.gt3++
        exc.max = Math.max(exc.max, e)
        byOffset[Math.min(7, Math.floor(((azDeg % spacing) + spacing) % spacing / spacing * 8))]++
        if (examples.length < 8) examples.push({ azDeg: +azDeg.toFixed(2), azOffFromSample: +(((azDeg % spacing) + spacing) % spacing).toFixed(2), u: +m.u.toFixed(4), v: +m.v.toFixed(4), lod: +m.lod.toFixed(2), bound, live: +live.toFixed(3), excess: +e.toFixed(3), sector: sec })
      }
    }
    v.readCompare = { rows, sectorOk: secOk, sectorBad: secBad, sectorBadExamples: secBadEx, codeOk, codeBad, boundDecodesCode: boundOk, boundWrong: boundBad, noBound }
    v.conservative = { bounded, exceed: exc, exceedByAzOffsetEighthsOfSpacing: byOffset, examples }
    console.log(`envtest variant az=${az} grid=${grid} done ${Math.round(performance.now())}`)
    cache.dispose()
  }
  return out
}

main().then((r) => { (window as unknown as Record<string, unknown>).__envTest = r; document.getElementById('out')!.textContent = JSON.stringify(r, null, 1) }, (e) => { (window as unknown as Record<string, unknown>).__envTest = { error: String(e), stack: (e as Error).stack }; document.getElementById('out')!.textContent = String(e) })
void ghDir
