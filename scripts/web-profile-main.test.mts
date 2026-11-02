// The website's quality profile on every class equals main's (review, fix 5): the native-only changes (iOS ceiling, close DPR cap,
// patch cap, panorama width, one render size, the phone bounce without PMREM) never reach a web browser.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { CLASS_TABLE, QUALITY_CLASSES, profileFor, shellProfile, type ClassProfile, type QualityClass } from '../src/quality/startupClass.ts'

const MB = 1048576
// main's CLASS_TABLE (origin/main 266d6582, src/quality/startupClass.ts), copied verbatim.
const MAIN_DESKTOP: ClassProfile = { ceilingBytes: Infinity, ceilingEst: false, dprCap: 2, tiles: 128, tc: true, targetSets: 3, lmShadowRes: 2048, panoMax: 16384, motionFixedShare: 0, heightTiles: 256 }
const MAIN_TABLE: Record<QualityClass, ClassProfile> = {
  desktop: MAIN_DESKTOP,
  software: { ...MAIN_DESKTOP, ceilingBytes: 1024 * MB, ceilingEst: true, motionFixedShare: 0 },
  tablet: { ceilingBytes: 700 * MB, ceilingEst: true, dprCap: 2, tiles: 48, tc: true, targetSets: 3, lmShadowRes: 2048, panoMax: 8192 },
  'phone-android': { ceilingBytes: 500 * MB, ceilingEst: true, dprCap: 1.5, closeDprCap: 1.25, restDprCap: 2, tiles: 48, tc: false, targetSets: 2, lmShadowRes: 1024, panoMax: 8192, motionStart: 0.35, motionCaps: true },
  // R49 (owner decision 2026-10-18) is the one deliberate change to the website profile: the iPhone ceiling is 255 MB, and the iPad is its own class at main's old 400 MB.
  // R54 adds the patch cap on those two rows (quality/enforce.ts; ?memcap=0 removes it).
  ios: { ceilingBytes: 255 * MB, ceilingEst: true, dprCap: 1.5, tiles: 48, tc: false, targetSets: 2, lmShadowRes: 1024, panoMax: 8192, motionStart: 0.35, motionCaps: true, patchResidentBytes: 48 * MB },
  ipad: { ceilingBytes: 400 * MB, ceilingEst: true, dprCap: 1.5, tiles: 48, tc: false, targetSets: 2, lmShadowRes: 1024, panoMax: 8192, motionStart: 0.35, motionCaps: true, patchResidentBytes: 136 * MB },
}
const MEMORY = [undefined, 2, 4, 8, 16]
const webProfile = (c: QualityClass, deviceMemory: number | undefined): ClassProfile => shellProfile(c, profileFor(c, { deviceMemory }), false)

test('the website profile of every class equals main (frozen copy)', () => {
  assert.deepEqual(CLASS_TABLE, MAIN_TABLE)
  for (const c of QUALITY_CLASSES) for (const dm of MEMORY) {
    const want = c === 'phone-android' && dm !== undefined && dm >= 8 ? { ...MAIN_TABLE[c], tc: true } : MAIN_TABLE[c]
    assert.deepEqual(webProfile(c, dm), want, `${c} deviceMemory=${dm}`)
  }
})

test('the website profile of every class equals origin/main (git show), when origin/main is available', (t) => {
  const r = spawnSync('git', ['show', 'origin/main:src/quality/startupClass.ts'], { encoding: 'utf8' })
  if (r.status !== 0 || !r.stdout) {
    console.warn('web-profile-main: git comparison skipped (origin/main is unavailable); the frozen baseline comparison above still runs')
    t.skip('origin/main is not available in this checkout; frozen profile baseline remains checked')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'moon-main-class-'))
  try {
    const file = join(dir, 'startupClass.ts')
    writeFileSync(file, r.stdout)
    return import(pathToFileURL(file).href).then((m: { profileFor: typeof profileFor }) => {
      // origin/main carries R49 (iPhone 255 MB, the ipad class); R54 adds only the patch cap on the ios and ipad rows. Every other class must equal main.
      for (const c of QUALITY_CLASSES) for (const dm of MEMORY) {
        const mine = webProfile(c, dm), main = m.profileFor(c, { deviceMemory: dm })
        if (c === 'ios' || c === 'ipad') assert.deepEqual({ ...mine, patchResidentBytes: undefined }, { ...main, patchResidentBytes: undefined }, `${c} deviceMemory=${dm} vs origin/main but for the patch cap`)
        else assert.deepEqual(mine, main, `${c} deviceMemory=${dm} vs origin/main`)
      }
      for (const dm of MEMORY) assert.equal(webProfile('ios', dm).patchResidentBytes, 48 * MB, 'iPhone website patch cap (R54)')
    }).finally(() => rmSync(dir, { recursive: true, force: true }))
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e }
})

test('the iOS app gets its own values; the website none of them', () => {
  const app = shellProfile('ios', CLASS_TABLE.ios, true)
  assert.equal(app.ceilingBytes, 255 * MB)
  assert.equal(app.closeDprCap, 1.25)
  assert.equal(app.patchResidentBytes, 96 * MB)
  assert.equal(app.panoMax, 4096)
  assert.equal(app.targetSets, 1)
  for (const c of QUALITY_CLASSES) assert.equal(shellProfile(c, CLASS_TABLE[c], false), CLASS_TABLE[c], `${c}: the website profile is the same object`)
})

test('main.ts gates the phone bounce, the panorama class width and the post-loss patch halving to the native shell', () => {
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.ok(src.includes("groundMode.phone = !!nativeHost && (quality.detected.cls === 'ios' || quality.detected.cls === 'ipad' || quality.detected.cls === 'phone-android')"), 'web browsers keep the PMREM bounce')
  assert.ok(src.includes('classMaxWidth: nativeHost ? quality.profile.panoMax : undefined'), 'web panorama tier: main device rule only')
  assert.ok(src.includes('!!nativeHost && quality.contextLosses > 0)'), 'web patch budget unchanged after a loss')
  assert.ok(src.includes('initQuality({ gl: renderer.getContext() as WebGL2RenderingContext, search: location.search, nativeShell: !!nativeHost })'), 'the profile is the shell profile only with a native host')
})
