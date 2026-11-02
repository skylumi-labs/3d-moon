import assert from 'node:assert/strict'
import * as THREE from 'three'
import { GlobalHorizonCache } from '../src/moon/tiles/GlobalHorizonCache.ts'
import { globalHorizonFragment, moonFragment } from '../src/moon/moonShader.ts'
import { ENV_BLOCK, ENV_LODS, ENV_MARGIN_DEG, ENV_OFF_DEG, ENV_Q_DEG, envEncode, envHistogram, envProbePoint, envDecode, ENV_SECTOR_AZ, ENV_SECTORS, ENV_SECTOR_POINTS, ENV_FINE_LODS, envSectorBytes } from '../src/moon/globalHorizon.ts'

// The envelope's build draws into a render target and its shader also samples that target's texture in the dilate branch. Bound while drawing into it, WebGL rejects the draw
// as a feedback loop (the first rig run built nothing: 32 blocks in 4 ms, an envelope of zeros, no skip anywhere). The class must bind it only in the dilate pass.
// There is no headless WebGL here, so a recording renderer checks every draw's uniforms and target.
interface Draw { mode: number; raw: THREE.Texture | null; target: THREE.WebGLRenderTarget; scissor: THREE.Vector4; scissorTest: boolean; level: number }
function run(low: boolean): { draws: Draw[]; cache: GlobalHorizonCache; w: number } {
  let target: THREE.WebGLRenderTarget | null = null
  const draws: Draw[] = []
  const gl = { DRAW_FRAMEBUFFER: 36009, FRAMEBUFFER_COMPLETE: 36053, checkFramebufferStatus: () => 36053, finish: () => undefined }
  const renderer = {
    autoClear: true,
    getRenderTarget: () => target, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0, setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { target = t },
    getContext: () => gl,
    render: (scene: THREE.Scene) => {
      const m = (scene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial
      draws.push({ mode: m.uniforms.uGhMode.value, raw: m.uniforms.uEnvRaw.value, target: target!, scissor: target!.scissor.clone(), scissorTest: target!.scissorTest, level: 0 })
    },
    readRenderTargetPixels: () => undefined,
  } as unknown as THREE.WebGLRenderer
  const pass = {
    uK: { value: new THREE.Vector3(0, 0, 1) }, uX: { value: new THREE.Vector3(1, 0, 0) }, uY: { value: new THREE.Vector3(0, 1, 0) },
    uHeight: { value: null }, uHeightLevels: { value: 8 }, uHeightMix: { value: 1 }, uCamPos: { value: new THREE.Vector3(3.6, 0, 0) },
  }
  const cache = new GlobalHorizonCache(renderer, pass, 180, 4096, low)
  let now = 0
  for (let i = 0; i < 2000 && cache.stats.state !== 'ready'; i++) { cache.update({ now: (now += 16), frameMs: 16, allowed: true }) }
  return { draws, cache, w: cache.size.w }
}
for (const low of [true, false]) {
  const { draws, cache, w } = run(low)
  const h = w >> 1
  assert.equal(cache.stats.state, 'ready', 'the build finishes')
  assert.equal(cache.readOn, true)
  assert.equal(w, low ? 512 : 1024)
  const blocks = draws.filter((d) => d.mode === 0)
  const dil = draws.filter((d) => d.mode === 1)
  assert.equal(blocks.length, Math.ceil(w / ENV_BLOCK) * Math.ceil(h / ENV_BLOCK), 'one draw per block')
  assert.equal(dil.length, 1, 'one dilate pass')
  let area = 0
  const seen = new Set<string>()
  for (const d of blocks) {
    assert.ok(d.raw !== null && (d.raw as THREE.DataTexture).isDataTexture && (d.raw as THREE.DataTexture).internalFormat === 'RG32UI', 'while drawing into the raw texture, uEnvRaw holds the integer placeholder: never the raw texture (no feedback loop) and never null (three binds a FLOAT placeholder to a usampler2D, which WebGL rejects: the rig built nothing)')
    assert.notEqual((d.raw as THREE.Texture | null), d.target.texture)
    assert.equal(d.scissorTest, true)
    const s = d.scissor
    assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.z <= w && s.y + s.w <= h && s.z <= ENV_BLOCK && s.w <= ENV_BLOCK)
    area += s.z * s.w
    seen.add(`${s.x},${s.y}`)
  }
  assert.equal(area, w * h, 'the blocks tile the whole envelope')
  assert.equal(seen.size, blocks.length)
  assert.ok(blocks.every((d) => d.target === blocks[0].target), 'blocks go to the raw target')
  const d = dil[0]
  assert.ok(d.raw !== null && d.raw === blocks[0].target.texture, 'the dilate pass reads the raw texture')
  assert.notEqual(d.target, blocks[0].target, 'and writes another target')
  assert.notEqual(d.raw, d.target.texture)
  assert.equal(d.scissorTest, false)
  assert.equal(draws[draws.length - 1], d, 'dilate is last')
  assert.equal(cache.stats.gpuBytes, envSectorBytes(w), 'only the dilated texture stays resident (eight sector bytes a texel)')
  assert.ok(cache.stats.gpuBytes <= (low ? 1 << 20 : 4 << 20))
  // After it is ready it does nothing more; a disallowed frame turns the read off.
  const before = draws.length
  assert.equal(cache.update({ now: 1e6, frameMs: 16, allowed: true }), false)
  assert.equal(draws.length, before)
  cache.update({ now: 1e6 + 16, frameMs: 16, allowed: false })
  assert.equal(cache.readOn, false)
}

const fixedText = moonFragment(180, 4096, '', true, null, false, -3, false, undefined, false, false, true)
// ---- The build shader's constants are the CPU twin's (no GL here to run it): sample counts, lods, margin, code formula.
{
  const src = globalHorizonFragment(180, 4096)
  assert.ok(src.includes(`float lods[4] = float[4](${ENV_LODS.map((l) => l.toFixed(1)).join(', ')});`))
  assert.ok(src.includes(`for (int a = 0; a < ${ENV_SECTOR_AZ}; a++)`) && src.includes(`for (int d = 0; d < ${ENV_FINE_LODS}; d++)`) && src.includes(`for (int d = ${ENV_FINE_LODS}; d < ${ENV_LODS.length}; d++)`) && src.includes(`for (int k = 0; k < ${ENV_SECTOR_POINTS.length}; k++)`))
  assert.ok(src.includes('out uvec4 fragColor;') && src.includes(`uint codes[${ENV_SECTORS}];`) && src.includes('uniform highp usampler2D uEnvRaw;'), 'eight sector bytes packed in an RG32UI texel')
  const m = /codes\[s\] = uint\(clamp\(ceil\(\(m \+ ([\d.]+) - \((-?[\d.]+)\)\) \/ ([\d.]+)\) \+ 1\.0, 1\.0, 255\.0\)\);/.exec(src)
  assert.ok(m, 'code formula present')
  const [margin, off, q] = [Number(m![1]), Number(m![2]), Number(m![3])]
  assert.equal(margin, ENV_MARGIN_DEG); assert.equal(off, ENV_OFF_DEG); assert.equal(q, ENV_Q_DEG)
  for (let best = -3; best < 70; best += 0.137) {
    const glsl = Math.min(255, Math.max(1, Math.ceil((best + margin - off) / q) + 1))
    assert.equal(glsl, envEncode(best + ENV_MARGIN_DEG), `code of ${best}`)
    assert.ok(envDecode(glsl) >= best + ENV_MARGIN_DEG - 1e-9 || glsl === 255)
  }
  // The read in the Moon pass decodes the same way.
  assert.ok(/-2\.0 \+ \(c - 1\.0\) \* 0\.250/.test(fixedText), 'the read decodes with the same offset and step')
}
// ---- Probe helpers.
{
  const codes = new Uint8Array([0, 255, envEncode(1), envEncode(2), envEncode(3), envEncode(10)])
  const hh = envHistogram(codes)
  assert.equal(hh.unbuilt, 1); assert.equal(hh.unbounded, 1)
  assert.ok(hh.min! >= 1 && hh.max! >= 10 && hh.p50! >= 2)
  const w = 4, h = 2
  const c2 = new Uint8Array(w * h * ENV_SECTORS).fill(envEncode(3))
  const hit = envProbePoint(c2, w, h, 0.3, 0.4, 1, 20, 40, 1)
  assert.equal(hit.sunSkip, true); assert.equal(hit.viewSkip, true)
  assert.ok(hit.sunMargin! > 16 && hit.sunCert > 4.9)
  const miss = envProbePoint(c2, w, h, 0.3, 0.4, 1, 6, 3, 1)
  assert.equal(miss.sunSkip, false); assert.equal(miss.viewSkip, false)
  assert.equal(envProbePoint(new Uint8Array(w * h * ENV_SECTORS), w, h, 0.3, 0.4, 1, 60, 60, 1).env, null, 'an unbuilt envelope skips nothing')
  assert.equal(envProbePoint(c2, w, h, 0.3, 0.4, 7, 60, 60, 1).env, null, 'a footprint coarser than the sampled lods skips nothing')
  assert.equal(envProbePoint(c2, w, h, 0.3, 0.4, 1, 60, 60, 0.05).sunCert > 30, true, 'a tiny uTermAA makes the clearance large')
}
// ---- The Moon pass must never leave a usampler bound to a float texture (WebGL rejects the draw: the rig and SwiftShader showed "Mismatch between texture format and sampler type"): an envelope render
// target has no GL texture until it is first drawn into, and three binds a FLOAT placeholder for it, so the real texture is bound only once it is read.
{
  const fs = await import('node:fs')
  const src = fs.readFileSync(new URL('../src/moon/MoonPass.ts', import.meta.url), 'utf8')
  assert.ok(src.includes('this.uniforms.uEnvTex.value = texture && on ? texture : this.emptyEnv'), 'uEnvTex holds the integer placeholder until the envelope is read')
  assert.ok(src.includes('this.uniforms.uTileEnv.value = texture && on ? texture : this.emptyTileEnv'), 'uTileEnv holds the integer placeholder until the tile envelope is read')
}
console.log('horizon envelope cache passed')
