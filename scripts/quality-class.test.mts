// Startup classes (SPEC 2.5) and the rung-0 guard: the desktop class is today's constants.
import assert from 'node:assert/strict'
import { CLASS_TABLE, classFromSearch, detectClass, fitLayers, isIos, isIpad, profileFor, shellProfile, NATIVE_IOS, type Hints } from '../src/quality/startupClass.ts'
import { TC_CAPACITY } from '../src/moon/tiles/tcDetail.ts'
import { heightCapacity, heightFloor, tcCapacity } from '../src/moon/tiles/capacity.ts'
import { LM_SHADOW_RES } from '../src/ground/lmShadow.ts'
import { GLARE_LEVELS, TargetCache } from '../src/post/targets.ts'
import { MOTION_STEPS } from '../src/post/motionGrid.ts'
import { ledger, targetSetBytes } from '../src/quality/ledger.ts'

const base: Hints = { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130', platform: 'MacIntel', maxTouchPoints: 0, coarsePointer: false, shortSide: 1080, deviceMemory: 8, renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)' }
const pixel: Hints = { ua: 'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro XL) Chrome/140 Mobile', platform: 'Linux armv81', maxTouchPoints: 5, coarsePointer: true, shortSide: 412, deviceMemory: 8, renderer: 'ANGLE (Google, Vulkan, Mali-G715)' }
const iphone: Hints = { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605', platform: 'iPhone', maxTouchPoints: 5, coarsePointer: true, shortSide: 390, renderer: 'Apple GPU' }
const ipadAsMac: Hints = { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', platform: 'MacIntel', maxTouchPoints: 5, coarsePointer: true, shortSide: 834 }
const androidTablet: Hints = { ...pixel, shortSide: 800, ua: pixel.ua.replace(' Mobile', '') }
const lowMemLaptop: Hints = { ...base, deviceMemory: 4, renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620)' }
const intelDesktop: Hints = { ...base, platform: 'Win32', ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)', deviceMemory: 8 }
const swiftshader: Hints = { ...base, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)' }

assert.equal(detectClass(base).cls, 'desktop')
assert.equal(detectClass(pixel).cls, 'phone-android')
assert.equal(detectClass(iphone).cls, 'ios')
assert.equal(detectClass(ipadAsMac).cls, 'ipad', 'an iPad that reports as a Mac is the iPad class (R49)')
assert.equal(detectClass({ ...ipadAsMac, ua: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Safari/605', platform: 'iPad' }).cls, 'ipad', 'an iPad user agent is the iPad class')
assert.equal(isIpad(iphone), false)
assert.equal(isIpad(base), false)
assert.equal(detectClass({ ...iphone, renderer: undefined, deviceMemory: 16, shortSide: 1200, coarsePointer: false }).cls, 'ios', 'iOS lands in ios even with desktop-looking capabilities')
assert.equal(isIos(base), false)
assert.equal(detectClass(androidTablet).cls, 'tablet')
assert.equal(detectClass(lowMemLaptop).cls, 'tablet', 'deviceMemory <= 4 is the old 48-layer rule')
assert.equal(detectClass(swiftshader).cls, 'software')
assert.equal(detectClass(swiftshader).cls, 'software', 'the renderer string wins over a desktop user agent')
const intel = detectClass(intelDesktop)
assert.equal(intel.cls, 'desktop', 'an Intel integrated desktop keeps its tiles')
assert.equal(intel.integrated, true)
assert.equal(detectClass(base).integrated, false)
assert.equal(detectClass(base, 'ios').cls, 'ios')
assert.equal(classFromSearch('?class=ios'), 'ios')
assert.equal(classFromSearch('?class=ipad'), 'ipad')
assert.equal(classFromSearch('?class=nonsense'), null)
assert.equal(profileFor('phone-android', { deviceMemory: 8 }).tc, true, 'phone-android with 8 GB keeps TC')
assert.equal(profileFor('phone-android', { deviceMemory: 4 }).tc, false)
assert.equal(profileFor('phone-android', {}).tc, false)

// ---- rung-0 guard: the desktop class is exactly today's constants
const d = CLASS_TABLE.desktop
assert.equal(d.tiles, 128, 'tileCapacity desktop')
assert.equal(d.dprCap, 2, 'DPR_MAX')
assert.equal(d.lmShadowRes, LM_SHADOW_RES, 'LM_SHADOW_RES stays 2048 at module level; the class says the same')
assert.equal(d.lmShadowRes, 2048)
assert.equal(d.tc, true)
assert.equal(TC_CAPACITY, 96)
assert.equal(d.targetSets, 3, 'TargetCache keeps 3 sizes')
assert.equal(d.ceilingBytes, Infinity, 'no ceiling on desktop')
assert.equal(GLARE_LEVELS, 7)
// today's 48-layer rule is the tablet / phone / ios tile count
for (const c of ['tablet', 'phone-android', 'ios', 'ipad'] as const) assert.equal(CLASS_TABLE[c].tiles, 48)
// software changes no content
for (const k of ['tiles', 'tc', 'heightTiles', 'tcTiles', 'targetSets', 'lmShadowRes', 'dprCap'] as const) assert.equal(CLASS_TABLE.software[k], d[k], `software keeps ${k}`)
// every non-desktop ceiling is flagged as an estimate
for (const c of ['tablet', 'phone-android', 'ios', 'ipad', 'software'] as const) assert.equal(CLASS_TABLE[c].ceilingEst, true)

// ---- the ios class (issue #66): DPR 1.5, motion grid 0.35, ledger-fitted tiles, no TC page table, no 16k pano, a stated ceiling.
// The website's ios row: 255 MB since R49 (owner decision 2026-10-18), 8192 pano, 2 render sizes; the iOS app's overrides (NATIVE_IOS) come from shellProfile.
{
  const web = CLASS_TABLE.ios
  assert.equal(web.dprCap, 1.5)
  assert.equal(web.motionStart, 0.35)
  assert.ok(MOTION_STEPS.includes(web.motionStart!), 'the start is a real motion-grid step')
  assert.equal(web.tc, false, 'no TC array and no 18 MB TC page table')
  assert.equal(web.ceilingBytes, 255 * 1048576, 'iPhone website ceiling 255 MB (R49)')
  assert.equal(web.panoMax, 8192, 'iOS website panorama: main value')
  assert.equal(web.targetSets, 2, 'iOS website render sizes: main value')
  assert.equal(web.closeDprCap, undefined, 'iOS website: no close cap (main)')
  assert.equal(web.patchResidentBytes, 48 * 1048576, 'iOS website: the R54 patch cap (scripts/memory-enforce.test.mts derives it)')
  assert.equal(shellProfile('ios', web, false), web)
  assert.deepEqual(shellProfile('ipad', CLASS_TABLE.ipad, true), { ...CLASS_TABLE.ipad, ...NATIVE_IOS }, 'the native shell treats an iPad like an iPhone, as before the split')
  assert.equal(shellProfile('ipad', CLASS_TABLE.ipad, false), CLASS_TABLE.ipad)
  const ios = shellProfile('ios', web, true)
  assert.equal(ios.panoMax, 4096, 'iOS app panorama: the compact tier (the chip reads this number)')
  // The ceiling is 0.85 of the 300 MB iOS kill line (SkyLumi, iPhone 15: 14 of 14 kills at 311 to 384 MB), not of the old 870 MB figure.
  assert.equal(ios.ceilingBytes, 255 * 1048576, 'iOS app ceiling: 300 MB kill line x 0.85')
  assert.ok(ios.ceilingBytes <= 0.85 * 300 * 1048576, 'at most 0.85 of the 300 MB kill line')
  assert.equal(ios.ceilingEst, true)
  assert.equal(ios.targetSets, 1, 'the iOS app holds one render size, not up to three')
  // The site-patch byte cap (PatchLayer maxResidentBytes): the iOS app stays under the layer's 192 MB default, the other classes keep it.
  assert.ok(ios.patchResidentBytes !== undefined && ios.patchResidentBytes < 192 * 1048576, 'iOS app patch residency is capped below the 192 MB default')
  assert.equal(CLASS_TABLE['phone-android'].patchResidentBytes, undefined)
  assert.equal(CLASS_TABLE.desktop.patchResidentBytes, undefined)
  assert.equal(CLASS_TABLE['phone-android'].motionStart, 0.35, 'phone-android starts at 0.35 too (S3)')
  assert.equal(CLASS_TABLE.desktop.motionStart, undefined, 'desktop keeps main.ts own pixel-count rule')
  // tiles come from the ledger: with the maps and targets already held, what is left under the ceiling fits fewer layers than the class asks
  assert.equal(fitLayers(ios.tiles, 8, 1.05 * 1048576, ios.ceilingBytes - 380 * 1048576 - 160 * 1048576), 8)
  assert.equal(fitLayers(ios.tiles, 8, 1.05 * 1048576, ios.ceilingBytes - 160 * 1048576), 48, 'with room it keeps the class count')
}

// ---- the ipad class (R49): its own row at the old iOS ceiling; and no other class's numbers moved
{
  const MB = 1048576
  const ipad = CLASS_TABLE.ipad
  assert.equal(ipad.ceilingBytes, 400 * MB, 'iPad keeps the 400 MB estimate until measured')
  assert.equal(ipad.ceilingEst, true)
  assert.deepEqual({ ...ipad, ceilingBytes: 0, patchResidentBytes: 0 }, { ...CLASS_TABLE.ios, ceilingBytes: 0, patchResidentBytes: 0 }, 'iPad differs from the iPhone row only in the ceiling and the patch cap that follows from it (R54)')
  assert.equal(fitLayers(ipad.tiles, 8, 1.05 * MB, ipad.ceilingBytes - 100 * MB - 160 * MB), 48)
  assert.equal(fitLayers(CLASS_TABLE.ios.tiles, 8, 1.05 * MB, CLASS_TABLE.ios.ceilingBytes - 100 * MB - 100 * MB), 48, 'the iPhone keeps 48 layers when 255 MB leaves room')
  // Every other class is byte-for-byte the row it had before R49 (copied from the table at 975a818; Infinity as the string 'Infinity').
  const before = {
    desktop: { ceilingBytes: 'Infinity', ceilingEst: false, dprCap: 2, tiles: 128, tc: true, targetSets: 3, lmShadowRes: 2048, panoMax: 16384, motionFixedShare: 0, heightTiles: 256 },
    software: { ceilingBytes: 1024 * MB, ceilingEst: true, dprCap: 2, tiles: 128, tc: true, targetSets: 3, lmShadowRes: 2048, panoMax: 16384, motionFixedShare: 0, heightTiles: 256 },
    tablet: { ceilingBytes: 700 * MB, ceilingEst: true, dprCap: 2, tiles: 48, tc: true, targetSets: 3, lmShadowRes: 2048, panoMax: 8192 },
    'phone-android': { ceilingBytes: 500 * MB, ceilingEst: true, dprCap: 1.5, closeDprCap: 1.25, restDprCap: 2, tiles: 48, tc: false, targetSets: 2, lmShadowRes: 1024, panoMax: 8192, motionStart: 0.35, motionCaps: true },
  } as const
  for (const [c, row] of Object.entries(before)) {
    const now = { ...CLASS_TABLE[c as keyof typeof CLASS_TABLE] } as Record<string, unknown>
    if (now.ceilingBytes === Infinity) now.ceilingBytes = 'Infinity'
    assert.deepEqual(now, row, `${c} row unchanged by the iPad split`)
  }
  assert.equal(detectClass(base).cls, 'desktop')
  assert.equal(detectClass(pixel).cls, 'phone-android')
  assert.equal(detectClass(androidTablet).cls, 'tablet')
  assert.equal(detectClass(lowMemLaptop).cls, 'tablet')
  assert.equal(detectClass(swiftshader).cls, 'software')
}

// ---- fitLayers: a phone never allocates past its ceiling
assert.equal(fitLayers(48, 8, 1.05 * 1048576, Infinity), 48)
assert.equal(fitLayers(48, 8, 1048576, 20 * 1048576), 20)
assert.equal(fitLayers(48, 8, 1048576, 2 * 1048576), 8, 'never below the minimum')
assert.equal(fitLayers(48, 8, 1048576, 1e12), 48)

// ---- the ledger agrees with TargetCache and targetSetBytes
{
  const before = ledger.byCategory().targets
  const cache = new TargetCache()
  cache.get(1920, 1080)
  assert.equal(ledger.byCategory().targets - before, targetSetBytes(1920, 1080), 'a 1080p set')
  const set = cache.get(1920, 1080)
  cache.metadata(set)
  assert.equal(ledger.byCategory().targets - before, targetSetBytes(1920, 1080, { metadata: true }), 'the metadata target is allocated on first use')
  cache.setDepth(true)
  assert.equal(ledger.byCategory().targets, before, 'setDepth disposes the sets and the ledger follows')
  cache.get(1280, 720)
  assert.equal(ledger.byCategory().targets - before, targetSetBytes(1280, 720, { depth: true }), 'ground mode adds the depth attachments')
  cache.maxSets = 1
  cache.get(640, 360)
  assert.equal(ledger.byCategory().targets - before, targetSetBytes(640, 360, { depth: true }), 'a cache of one set holds one set')
}
console.log('quality-class.test: ok')

// ---- cache sizes per class (cache-churn, STALL-DIAG-2026-10-13): the desktop holds the oblique fly working set with headroom, phones keep the old sizes
{
  const sizes = (c: keyof typeof CLASS_TABLE, search = '') => {
    const p = CLASS_TABLE[c]
    return { heights: heightCapacity(p.tiles, -3, 2048, heightFloor(search, p.heightTiles)), tc: tcCapacity(2048, search, p.tcTiles) }
  }
  assert.deepEqual(sizes('desktop'), { heights: 256, tc: 96 }, 'desktop: 256 heights layers; TC stays 96 (192 cost drag-ground on the rig)')
  assert.equal(CLASS_TABLE.desktop.tcTiles, undefined)
  assert.deepEqual(sizes('software'), { heights: 256, tc: 96 }, 'software follows the desktop (it changes no content)')
  for (const c of ['tablet', 'phone-android', 'ios'] as const) {
    assert.equal(CLASS_TABLE[c].heightTiles, undefined, `${c} has no heights floor`)
    assert.equal(CLASS_TABLE[c].tcTiles, undefined, `${c} has no TC size of its own`)
    assert.deepEqual(sizes(c), { heights: 142, tc: 96 }, `${c} keeps 142 heights and 96 TC layers`)
  }
  // the same-build A/B switches reproduce the old desktop exactly
  assert.deepEqual(sizes('desktop', '?heightcache=142&tccache=96'), { heights: 142, tc: 96 }, 'old desktop sizes by switch')
  assert.deepEqual(sizes('phone-android', '?heightcache=256&tccache=192'), { heights: 256, tc: 192 }, 'the switches act on any class')
  // a GPU with fewer array layers bounds both
  assert.equal(heightCapacity(128, -3, 200, heightFloor('', 256)), 200)
  assert.equal(tcCapacity(150, '', 192), 150)
}
