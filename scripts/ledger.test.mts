// The GPU ledger (src/quality/ledger.ts): arithmetic, release, and that every allocation site in src/ reports to it.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { GpuLedger, glarePyramidBytes, textureBytes } from '../src/quality/ledger.ts'
import { GpuGroup, trackGpu } from '../src/quality/track.ts'
import { ledger } from '../src/quality/ledger.ts'

// ---- arithmetic against the SPEC section 1.1 figures
assert.equal(textureBytes(4096, 2048, 4, { mips: true }), Math.round(4096 * 2048 * 4 * 4 / 3), 'global colour map ~44.7 MB')
assert.ok(Math.abs(textureBytes(4096, 2048, 4, { mips: true }) / 1048576 - 42.67) < 0.1)
// the TC page table is ~18.6 MB (2304 x 2016 RGBA8)
assert.ok(Math.abs(2304 * 2016 * 4 / 1048576 - 17.7) < 1.1)
// a scene target at 1080p is 8.3 MB RGBA16F
assert.ok(Math.abs(1920 * 1080 * 8 / 1e6 - 16.6) < 0.1)
assert.ok(glarePyramidBytes(1920, 1080, 7, 8) > 0)

// ---- ledger behaviour
const l = new GpuLedger()
assert.equal(l.total(), 0)
l.set('tiles', 'a', 100)
l.set('tiles', 'b', 50)
l.set('maps', 'c', 25)
assert.equal(l.total(), 175)
assert.deepEqual({ t: l.byCategory().tiles, m: l.byCategory().maps }, { t: 150, m: 25 })
l.set('tiles', 'a', 10)
assert.equal(l.total(), 85, 'set replaces under the same key')
assert.equal(l.highWater, 175, 'the high-water mark survives a release')
assert.deepEqual(l.highWaterTop(), [{ key: 'tiles:a', bytes: 100 }, { key: 'tiles:b', bytes: 50 }, { key: 'maps:c', bytes: 25 }], 'the lines at the high-water mark, not the current ones')
assert.deepEqual(l.highWaterTop(1), [{ key: 'tiles:a', bytes: 100 }])
l.release('tiles', 'b')
l.release('tiles', 'nope')
assert.equal(l.total(), 35)
l.releasePrefix('tiles', 'a')
assert.equal(l.total(), 25)
let seen = -1
const off = l.onChange((t) => { seen = t })
l.set('lm', 'x', 5)
assert.equal(seen, 30)
off()
l.clear()
assert.equal(l.total(), 0)
assert.throws(() => l.set('tiles', 'bad', -1))
assert.throws(() => l.set('tiles', 'bad', NaN))

// ---- helpers: a disposable releases its line; a group releases together
const listeners: Array<() => void> = []
const fake = { addEventListener: (_t: 'dispose', fn: () => void) => { listeners.push(fn) } }
const before = ledger.total()
trackGpu('targets', 'rt', 1000, fake)
assert.equal(ledger.total(), before + 1000)
listeners[0]()
assert.equal(ledger.total(), before)
const g = new GpuGroup('tc')
g.add('array', 300)
g.add('page-table', 200)
assert.equal(ledger.total(), before + 500)
g.releaseAll()
assert.equal(ledger.total(), before)

// ---- every allocation site reports. One row per file; a new site in a new file fails until it is added here (and reports).
const SRC = join(import.meta.dirname, '..', 'src')
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [] })
const ALLOC = /texStorage2D|texStorage3D|new THREE\.DataTexture|new THREE\.Data3DTexture|new THREE\.DataArrayTexture|new THREE\.WebGLRenderTarget|new THREE\.DepthTexture|new THREE\.TextureLoader|new THREE\.CanvasTexture|new THREE\.Texture\(|PMREMGenerator\(|gl\.createTexture|gl\.createRenderbuffer/
/** file -> a string the file must contain at its reporting call (one per allocation site). */
const REPORTS: Record<string, string[]> = {
  'moon/baked/HorizonStream.ts': ["trackGpu('baked', 'horizon-array'"],
  'moon/maps.ts': ["trackGpu('maps', 'global-colour'", "trackGpu('maps', 'global-height'"],
  'post/targets.ts': ["trackGpu('targets'"],
  'post/final.ts': ["trackGpu('crossfade'"],
  'sky/starDots.ts': ["trackGpu('targets', `stardots-"],
  'net/compileTarget.ts': ["trackGpu('targets', 'compile-key'"],
  'moon/tiles/TileStreamer.ts': ["gpuLedger.add('heights-array'", "gpuLedger.add('colour-array'", "gpuLedger.add('page-table'", "gpuLedger.add('bound-grid'", 'gpuLedger.releaseAll()'],
  'moon/tiles/ShadowCache.ts': ["ledger.set('tiles', this.ledgerKey", "ledger.release('tiles', this.ledgerKey"],
  // Dev/rig readback of the integer envelopes (on demand, transient): one RGBA8 target, reported while it exists.
  'moon/tiles/envReadback.ts': ["ledger.set('tiles', 'env-readback'", "ledger.release('tiles', 'env-readback'"],
  // The SwiftShader/GPU-rig functional test page (envelope-test.html): never part of the app, its textures live for one test run.
  'moon/dev/envelopeTest.ts': [],
  'moon/tiles/GlobalHorizonCache.ts': ["ledger.set('tiles', this.ledgerKey", "ledger.release('tiles', this.ledgerKey"],
  'moon/tiles/SunHorizonBake.ts': ["ledger.set('tiles', this.ledgerKey", "ledger.release('tiles', this.ledgerKey"],
  'moon/patch/PatchShadowCache.ts': ["ledger.set('patch', this.ledgerKey", "ledger.release('patch', this.ledgerKey"],
  'moon/tiles/DetailStreamer.ts': ["gpuLedger.add('array'", "gpuLedger.add('page-table'", 'gpuLedger.releaseAll()'],
  'moon/tiles/TcStreamer.ts': ["gpuLedger.add('array'", "gpuLedger.add('page-table'", 'gpuLedger.releaseAll()'],
  'moon/MoonPass.ts': ["trackGpu('targets', 'moon-hit'"],
  'moon/coarseHorizon.ts': ["trackGpu('tiles', 'coarse-horizon'"],
  'moon/patch/PatchLayer.ts': ["trackGpu('patch'"],
  'ground/LunarModule.ts': ["trackGpu('lm', 'shadow-target'", "ledger.set('lm', `sun-shadow-map-est#", "trackGpu('lm', 'pmrem-env'", "trackGpu('lm', 'crinkle-normal'"],
  'ground/pano/tileComposer.ts': ["trackGpu('pano'"],
  'ground/GroundPass.ts': ["trackGpu('probe'"],
  'earth/EarthPass.ts': ["trackGpu('earth'"],
  'earth/atmosphereTextures.ts': ["trackGpu('earth'"],
  // Pure CPU-side raw upload helper: the texture it fills is already counted by its owner (PatchLayer.ownTexture).
  'moon/patch/sliceUpload.ts': [],
}
const found = new Set<string>()
for (const f of walk(SRC)) {
  const rel = relative(SRC, f).split('\\').join('/')
  if (rel.startsWith('quality/')) continue
  const text = readFileSync(f, 'utf8').split('\n').filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln)).join('\n')
  if (!ALLOC.test(text)) continue
  found.add(rel)
  assert.ok(rel in REPORTS, `${rel} allocates GPU memory but is not in the ledger table (scripts/ledger.test.mts): report it with trackGpu/GpuGroup and add the file`)
  const src = readFileSync(f, 'utf8')
  for (const needle of REPORTS[rel]) assert.ok(src.includes(needle), `${rel}: allocation site must report: ${needle}`)
}
for (const rel of Object.keys(REPORTS)) if (rel !== 'moon/patch/sliceUpload.ts') assert.ok(found.has(rel), `${rel} is in the table but no longer allocates: remove the row`)
console.log('ledger.test: ok')
