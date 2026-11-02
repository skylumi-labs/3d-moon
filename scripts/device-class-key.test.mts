// R5 / W1-A4 twin: the device-class key (src/quality/deviceClassKey.ts) is a copy of the SkyLumi app's src/lib/qualityTier.ts table.
// The ROWS below are byte-identical to the app's src/lib/__tests__/qualityTier.test.ts, and ROWS_SHA256 is the hash of their JSON in both files:
// edit a row (or the table) in one repo and not the other and one of the two tests fails.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { detectClass, type Hints } from '../src/quality/startupClass.ts'
import {
  GPU_FAMILIES, QUALITY_TIERS, deviceClassKey, gpuFamilyFromRenderer, keyForStartupClass, resolveQualityTier,
} from '../src/quality/deviceClassKey.ts'

/* BEGIN SHARED ROWS (byte-identical in 3d-moon scripts/device-class-key.test.mts) */
const ROWS = [
  { name: 'iphone 15', in: { isIosLike: true, coarsePointer: true, shortSideCssPx: 393, renderer: 'Apple GPU' }, out: ['phone', 'apple', 'T2', 'phone_apple_t2'] },
  { name: 'ipad pro', in: { isIosLike: true, coarsePointer: true, shortSideCssPx: 1024, renderer: 'Apple GPU' }, out: ['tablet', 'apple', 'T3', 'tablet_apple_t3'] },
  { name: 'ipad with trackpad (fine pointer)', in: { isIosLike: true, coarsePointer: false, shortSideCssPx: 1024, renderer: 'Apple GPU' }, out: ['tablet', 'apple', 'T3', 'tablet_apple_t3'] },
  { name: 'flagship android phone', in: { isIosLike: false, coarsePointer: true, shortSideCssPx: 412, deviceMemory: 8, hardwareConcurrency: 8, renderer: 'ANGLE (Google, Vulkan, Mali-G715)' }, out: ['phone', 'mali', 'T2', 'phone_mali_t2'] },
  { name: 'budget android phone', in: { isIosLike: false, coarsePointer: true, shortSideCssPx: 360, deviceMemory: 3, hardwareConcurrency: 8, renderer: 'Adreno (TM) 610' }, out: ['phone', 'adreno', 'T1', 'phone_adreno_t1'] },
  { name: 'weak android phone stays on the floor', in: { isIosLike: false, coarsePointer: true, shortSideCssPx: 360, deviceMemory: 2, hardwareConcurrency: 4, renderer: 'Mali-G52' }, out: ['phone', 'mali', 'T1', 'phone_mali_t1'] },
  { name: 'powervr phone', in: { isIosLike: false, coarsePointer: true, shortSideCssPx: 360, renderer: 'PowerVR Rogue GE8320' }, out: ['phone', 'powervr', 'T1', 'phone_powervr_t1'] },
  { name: 'mid android tablet', in: { isIosLike: false, coarsePointer: true, shortSideCssPx: 800, deviceMemory: 4, hardwareConcurrency: 8, renderer: 'Mali-G72' }, out: ['tablet', 'mali', 'T2', 'tablet_mali_t2'] },
  { name: 'flagship android tablet', in: { isIosLike: false, coarsePointer: true, shortSideCssPx: 800, deviceMemory: 8, hardwareConcurrency: 8, renderer: 'Adreno (TM) 740' }, out: ['tablet', 'adreno', 'T3', 'tablet_adreno_t3'] },
  { name: 'nvidia desktop', in: { isIosLike: false, coarsePointer: false, shortSideCssPx: 1080, deviceMemory: 8, hardwareConcurrency: 16, renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)' }, out: ['desktop', 'nvidia', 'T4', 'desktop_nvidia_t4'] },
  { name: 'amd desktop', in: { isIosLike: false, coarsePointer: false, shortSideCssPx: 1080, hardwareConcurrency: 12, renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' }, out: ['desktop', 'amd', 'T4', 'desktop_amd_t4'] },
  { name: 'mac desktop', in: { isIosLike: false, coarsePointer: false, shortSideCssPx: 1117, renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)' }, out: ['desktop', 'apple', 'T4', 'desktop_apple_t4'] },
  { name: 'intel laptop', in: { isIosLike: false, coarsePointer: false, shortSideCssPx: 900, deviceMemory: 8, hardwareConcurrency: 8, renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)' }, out: ['desktop', 'intel', 'T3', 'desktop_intel_t3'] },
  { name: 'desktop without a renderer string', in: { isIosLike: false, coarsePointer: false, shortSideCssPx: 1080 }, out: ['desktop', 'other', 'T3', 'desktop_other_t3'] },
  { name: 'desktop on SwiftShader', in: { isIosLike: false, coarsePointer: false, shortSideCssPx: 1080, deviceMemory: 8, hardwareConcurrency: 16, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)' }, out: ['desktop', 'swiftshader', 'T0', 'desktop_swiftshader_t0'] },
  { name: 'phone viewport on llvmpipe', in: { isIosLike: false, coarsePointer: true, shortSideCssPx: 412, renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' }, out: ['phone', 'swiftshader', 'T0', 'phone_swiftshader_t0'] },
  { name: 'desktop nvidia with saveData', in: { isIosLike: false, coarsePointer: false, shortSideCssPx: 1080, saveData: true, renderer: 'NVIDIA GeForce GTX 1060' }, out: ['desktop', 'nvidia', 'T3', 'desktop_nvidia_t3'] },
  { name: 'desktop nvidia on 2g with 2 cores', in: { isIosLike: false, coarsePointer: false, shortSideCssPx: 1080, effectiveType: '2g', hardwareConcurrency: 2, renderer: 'NVIDIA GeForce GTX 1060' }, out: ['desktop', 'nvidia', 'T2', 'desktop_nvidia_t2'] },
  { name: 'desktop nvidia on 3g is not demoted', in: { isIosLike: false, coarsePointer: false, shortSideCssPx: 1080, effectiveType: '3g', renderer: 'NVIDIA GeForce GTX 1060' }, out: ['desktop', 'nvidia', 'T4', 'desktop_nvidia_t4'] },
  { name: 'desktop nvidia after one context loss', in: { isIosLike: false, coarsePointer: false, shortSideCssPx: 1080, contextLosses: 1, renderer: 'NVIDIA GeForce GTX 1060' }, out: ['desktop', 'nvidia', 'T3', 'desktop_nvidia_t3'] },
  { name: 'desktop nvidia after five context losses (at most -2)', in: { isIosLike: false, coarsePointer: false, shortSideCssPx: 1080, contextLosses: 5, renderer: 'NVIDIA GeForce GTX 1060' }, out: ['desktop', 'nvidia', 'T2', 'desktop_nvidia_t2'] },
  { name: 'budget phone after losses never goes below T1', in: { isIosLike: false, coarsePointer: true, shortSideCssPx: 360, contextLosses: 2, saveData: true, renderer: 'Adreno (TM) 610' }, out: ['phone', 'adreno', 'T1', 'phone_adreno_t1'] },
  { name: 'unmeasured viewport on a coarse device is a phone', in: { isIosLike: false, coarsePointer: true, shortSideCssPx: Number.NaN, renderer: 'Mali-G52' }, out: ['phone', 'mali', 'T1', 'phone_mali_t1'] },
];
/* END SHARED ROWS */

/** sha256 of JSON.stringify(ROWS). The same constant sits in the app's twin test. */
const ROWS_SHA256 = '0691f1d833950b8374e7ca9ed2ed9a7388f0d24b5f633fd18763dda015fdb851'

assert.equal(createHash('sha256').update(JSON.stringify(ROWS)).digest('hex'), ROWS_SHA256, 'the rows are the shared rows (hash matches the app twin)')

for (const row of ROWS) {
  const r = resolveQualityTier(row.in)
  assert.deepEqual([r.deviceTier, r.gpuFamily, r.tier, r.deviceClassKey], row.out, row.name)
  assert.equal(deviceClassKey(row.in), row.out[3], row.name)
}

// ---- vocabulary and analytics-safe keys
assert.deepEqual([...GPU_FAMILIES], ['apple', 'adreno', 'mali', 'powervr', 'intel', 'nvidia', 'amd', 'swiftshader', 'other'])
assert.deepEqual([...QUALITY_TIERS], ['T0', 'T1', 'T2', 'T3', 'T4'])
for (const row of ROWS) assert.match(resolveQualityTier(row.in).deviceClassKey, /^[a-z][a-z0-9_]{0,63}$/, row.name)

// ---- renderer strings
const families: Array<[string | undefined | null, string]> = [
  [undefined, 'other'], [null, 'other'], ['', 'other'], ['Some Unknown GPU', 'other'],
  ['Apple GPU', 'apple'], ['Adreno (TM) 730', 'adreno'], ['Mali-G715', 'mali'], ['PowerVR Rogue', 'powervr'],
  ['Mesa Intel(R) UHD Graphics 620', 'intel'], ['NVIDIA GeForce RTX 3080', 'nvidia'], ['AMD Radeon Pro 5500M', 'amd'],
  ['Google SwiftShader', 'swiftshader'], ['llvmpipe (LLVM 15)', 'swiftshader'], ['Microsoft Basic Render Driver (software)', 'swiftshader'],
  ['ANGLE (Intel, SwiftShader driver)', 'swiftshader'], ['Pineapple Graphics', 'other'], ['Somalia GPU', 'other'],
]
for (const [renderer, family] of families) assert.equal(gpuFamilyFromRenderer(renderer), family, String(renderer))

// ---- charging is carried, not consulted
const iphoneIn = { isIosLike: true, coarsePointer: true, shortSideCssPx: 393, renderer: 'Apple GPU' }
assert.equal(resolveQualityTier({ ...iphoneIn, charging: false }).onBattery, true)
assert.equal(resolveQualityTier({ ...iphoneIn, charging: false }).tier, resolveQualityTier(iphoneIn).tier)

// ---- the Moon's startupClass rows map to the key (the hints are the ones quality-class.test.mts uses)
const base: Hints = { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130', platform: 'MacIntel', maxTouchPoints: 0, coarsePointer: false, shortSide: 1080, deviceMemory: 8, renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)' }
const pixel: Hints = { ua: 'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro XL) Chrome/140 Mobile', platform: 'Linux armv81', maxTouchPoints: 5, coarsePointer: true, shortSide: 412, deviceMemory: 8, renderer: 'ANGLE (Google, Vulkan, Mali-G715)' }
const iphone: Hints = { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605', platform: 'iPhone', maxTouchPoints: 5, coarsePointer: true, shortSide: 390, renderer: 'Apple GPU' }
const ipadAsMac: Hints = { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', platform: 'MacIntel', maxTouchPoints: 5, coarsePointer: true, shortSide: 834, renderer: 'Apple GPU' }
const androidTablet: Hints = { ...pixel, shortSide: 800, ua: pixel.ua.replace(' Mobile', ''), renderer: 'Mali-G72', deviceMemory: 4 }
const lowMemLaptop: Hints = { ...base, deviceMemory: 4, renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620)' }
const swiftshader: Hints = { ...base, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)' }
const startupRows: Array<[string, Hints, string]> = [
  ['desktop (Apple M3)', base, 'desktop_apple_t4'],
  ['phone-android (Pixel, 8 GB)', pixel, 'phone_mali_t1'],
  ['ios (iPhone)', iphone, 'phone_apple_t2'],
  ['ios (iPad reporting as a Mac)', ipadAsMac, 'tablet_apple_t3'],
  ['tablet (Android, 4 GB)', androidTablet, 'tablet_mali_t2'],
  ['tablet class (4 GB Intel laptop; the class decides the kind, not the pointer)', lowMemLaptop, 'tablet_intel_t2'],
  ['software (SwiftShader on a desktop UA)', swiftshader, 'desktop_swiftshader_t0'],
]
for (const [name, hints, key] of startupRows) {
  const cls = detectClass(hints).cls
  assert.equal(keyForStartupClass(cls, hints).deviceClassKey, key, `${name} (${cls})`)
}
assert.equal(keyForStartupClass('software', { ...base, renderer: undefined }).gpuFamily, 'swiftshader', '?class=software with no renderer string is still swiftshader')
assert.equal(keyForStartupClass(detectClass(iphone).cls, iphone).deviceTier, 'phone')
assert.equal(keyForStartupClass('ios', ipadAsMac).deviceTier, 'tablet', 'ios by short side')
assert.equal(keyForStartupClass('ipad', ipadAsMac).deviceClassKey, 'tablet_apple_t3', 'the ipad class is a tablet key')
// the same hints under each forced class keep to that class's kind
assert.deepEqual((['phone-android', 'tablet', 'desktop'] as const).map((c) => keyForStartupClass(c, pixel).deviceTier), ['phone', 'tablet', 'desktop'])

console.log('device-class-key: ok')
