// Context-loss recovery decisions (issue #206): pure, no WebGL.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { HEALTHY_FRAME_MAX_AGE_MS, HEALTHY_RESET_MS, LOST_CEILING_EXPIRES_KEY, LOST_CEILING_TTL_MS, MAX_LOSS_RELOADS, RESTORE_GIVE_UP_MS, RESTORE_NUDGE_MS, SOFT_RECOVERY_MS, NATIVE_ANDROID_PATCH_BYTES, LOST_CEILING_KEY, LOST_RELOADS_KEY, ceilingToStore, groundRestDprCap, healthyFrameWindow, healthyResetDue, lostWatchdog, prepareLossReload, parkTileShadowsInGround, patchBudget, planAfterRestore, recoveryIsCurrent, reloadDecision, softRecoveryExpired, startCeiling } from '../src/quality/contextRecovery.ts'
import { CLASS_TABLE, profileFor, shellProfile } from '../src/quality/startupClass.ts'

const MB = 1048576
// Plan (native app): soft only for a first loss with nothing of its own on screen.
assert.equal(planAfterRestore({ losses: 1, groundActive: false, patchLoaded: false, native: true }), 'soft')
assert.equal(planAfterRestore({ losses: 1, groundActive: true, patchLoaded: true, native: true }), 'reload', 'the Apollo 17 ground view reloads in the app')
assert.equal(planAfterRestore({ losses: 1, groundActive: false, patchLoaded: true, native: true }), 'reload')
assert.equal(planAfterRestore({ losses: 2, groundActive: false, patchLoaded: false, native: true }), 'reload', 'a second loss never retries in place')
// Plan (website): a first loss always tries in place, as main did, even in the ground view or with a site patch.
assert.equal(planAfterRestore({ losses: 1, groundActive: true, patchLoaded: true, native: false }), 'soft', 'web ground view: in-place recovery')
assert.equal(planAfterRestore({ losses: 1, groundActive: false, patchLoaded: true, native: false }), 'soft', 'web site patch: in-place recovery')
assert.equal(planAfterRestore({ losses: 1, groundActive: false, patchLoaded: false, native: false }), 'soft')
{
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.ok(src.includes('patchLoaded: !!patch, native: !!nativeHost })'), 'main passes the native flag from nativeHost')
}
// Watchdog while hidden: no reload until the page is shown (the nudge still goes out).
assert.equal(lostWatchdog(RESTORE_GIVE_UP_MS, true, true), 'wait', 'a hidden page never reloads')
assert.equal(lostWatchdog(1e9, true, true), 'wait')
assert.equal(lostWatchdog(RESTORE_NUDGE_MS, false, true), 'nudge')
assert.equal(lostWatchdog(RESTORE_GIVE_UP_MS, true, false), 'reload', 'shown again: the next poll reloads')
// Storage unavailable: the reload budget counts as spent (an uncounted reload could loop).
assert.deepEqual(reloadDecision(null, false), { reload: false, count: MAX_LOSS_RELOADS })
assert.deepEqual(reloadDecision('0', false), { reload: false, count: MAX_LOSS_RELOADS })
{
  const mem = (): { getItem(k: string): string | null; setItem(k: string, v: string): void; m: Map<string, string> } => {
    const m = new Map<string, string>()
    return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) } }
  }
  const s1 = mem()
  const now = 1_000_000
  assert.equal(prepareLossReload(s1, 300 * MB, now), 'reload')
  assert.equal(s1.m.get(LOST_RELOADS_KEY), '1')
  assert.equal(s1.m.get(LOST_CEILING_KEY), String(300 * MB), 'the lowered ceiling is stored right before the reload')
  assert.equal(s1.m.get(LOST_CEILING_EXPIRES_KEY), String(now + LOST_CEILING_TTL_MS))
  assert.equal(prepareLossReload(s1, 250 * MB), 'reload')
  assert.equal(s1.m.get(LOST_RELOADS_KEY), '2')
  const before = s1.m.get(LOST_CEILING_KEY)
  assert.equal(prepareLossReload(s1, 200 * MB), 'give-up', 'MAX_LOSS_RELOADS spent')
  assert.equal(s1.m.get(LOST_CEILING_KEY), before, 'a give-up stores nothing new')
  assert.equal(prepareLossReload(null, 300 * MB), 'give-up', 'no sessionStorage at all')
  const throwing = { getItem: (): string | null => { throw new Error('SecurityError') }, setItem: (): void => { throw new Error('SecurityError') } }
  assert.equal(prepareLossReload(throwing, 300 * MB), 'give-up', 'a blocked store: no automatic reload')
  const readOnly = { m: new Map<string, string>(), getItem: (): string | null => null, setItem: (): void => { throw new Error('QuotaExceededError') } }
  assert.equal(prepareLossReload(readOnly, 300 * MB), 'give-up', 'a store that cannot be written: no automatic reload')
  // main.ts: the loss handler keeps the lowering in memory; only reloadAfterLoss writes the ceiling, then reloads.
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const lostAt = src.indexOf("canvas.addEventListener('webglcontextlost'")
  const lostEnd = src.indexOf("canvas.addEventListener('webglcontextrestored'")
  assert.ok(lostAt > 0 && lostEnd > lostAt)
  assert.ok(!src.slice(lostAt, lostEnd).includes('LOST_CEILING_KEY'), 'a transient loss never persists the lowered ceiling')
  assert.ok(src.includes("storeSet(LOST_CEILING_KEY, null)"), 'a healthy recovery clears the persisted ceiling')
  const fn = src.slice(src.indexOf('function reloadAfterLoss(): void {'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))
  assert.ok(body.includes('prepareLossReload(') && body.indexOf('prepareLossReload(') < body.indexOf('location.reload()'), 'the ceiling is written right before location.reload()')
  assert.ok(/softRecoveryExpired\(performance\.now\(\) - softStartedAt\)\) \{ if \(!document\.hidden\) reloadAfterLoss\(\)/.test(src), 'the watchdog never reloads a hidden page from an expired soft recovery')
  assert.ok(src.includes('lostWatchdog(performance.now() - lostAt, nudged, document.hidden)'), 'the watchdog passes document.hidden')
  assert.ok(src.includes('lossGeneration++'), 'each loss invalidates older recovery work')
  assert.ok(src.includes('lossGeneration++\n  softStartedAt = 0'), 'a new generation can start recovery while older async work drains')
  assert.ok(src.includes('recoveryIsCurrent(lossGeneration, generation, contextLost, gl.isContextLost())'), 'rebuilds require the current generation and a live context')
  assert.ok(src.includes('recoverContext(lossGeneration)'), 'both restore and foreground paths identify the active loss')
}

// Watchdog: wait, nudge once, then reload. Never waits past the give-up time.
assert.equal(lostWatchdog(0, false), 'wait')
assert.equal(lostWatchdog(RESTORE_NUDGE_MS - 1, false), 'wait')
assert.equal(lostWatchdog(RESTORE_NUDGE_MS, false), 'nudge')
assert.equal(lostWatchdog(RESTORE_NUDGE_MS + 100, true), 'wait', 'the nudge is asked once')
assert.equal(lostWatchdog(RESTORE_GIVE_UP_MS, true), 'reload')
assert.equal(lostWatchdog(RESTORE_GIVE_UP_MS, false), 'reload', 'a reload wins over a nudge that was never sent')
assert.equal(lostWatchdog(1e9, true), 'reload')
assert.ok(RESTORE_NUDGE_MS < RESTORE_GIVE_UP_MS)
assert.equal(softRecoveryExpired(SOFT_RECOVERY_MS - 1), false)
assert.equal(softRecoveryExpired(SOFT_RECOVERY_MS), true)

// Recovery is allowed only for the current loss generation and a confirmed live GL context.
assert.equal(recoveryIsCurrent(4, 4, true, false), true)
assert.equal(recoveryIsCurrent(5, 4, true, false), false, 'obsolete recovery results are ignored')
assert.equal(recoveryIsCurrent(4, 4, false, false), false, 'no active loss means there is nothing to recover')
assert.equal(recoveryIsCurrent(4, 4, true, true), false, 'a still-lost context is not restored')

// The reload budget clears only after a full visible foreground window with successful frames.
assert.equal(HEALTHY_RESET_MS, 60_000)
assert.equal(HEALTHY_FRAME_MAX_AGE_MS, 1_000)
assert.equal(healthyResetDue(100, 60_099, 60_000, true, false, false), false)
assert.equal(healthyResetDue(100, 60_100, 60_099, true, false, false), true)
assert.equal(healthyResetDue(100, 60_100, null, true, false, false), false, 'zero rendered frames cannot reset the budget')
assert.equal(healthyResetDue(100, 60_100, 50_000, true, false, false), false, 'a stopped render loop cannot reset the budget')
{
  // Lifecycle regression: last good frame at 58 s, render then stops, and the 60 s timer fires.
  const storage = new Map([[LOST_RELOADS_KEY, '2'], [LOST_CEILING_KEY, String(300 * MB)], [LOST_CEILING_EXPIRES_KEY, '999999']])
  const lastGoodFrameAt = 58_000
  const timerFiredAt = 60_000
  if (healthyResetDue(0, timerFiredAt, lastGoodFrameAt, true, false, false)) {
    storage.delete(LOST_RELOADS_KEY)
    storage.delete(LOST_CEILING_KEY)
    storage.delete(LOST_CEILING_EXPIRES_KEY)
  }
  assert.equal(storage.get(LOST_RELOADS_KEY), '2', 'a frame two seconds old cannot clear the reload count')
  assert.equal(storage.get(LOST_CEILING_KEY), String(300 * MB), 'a stopped renderer keeps the lowered ceiling')
  assert.equal(storage.get(LOST_CEILING_EXPIRES_KEY), '999999', 'a stopped renderer keeps the ceiling expiry')
}
{
  // A frame 500 ms before the deadline is still within the old 1 s freshness allowance, but it
  // cannot clear the recovery markers until a successful foreground frame arrives after the timer.
  const storage = new Map([[LOST_RELOADS_KEY, '2'], [LOST_CEILING_KEY, String(300 * MB)], [LOST_CEILING_EXPIRES_KEY, '999999']])
  const recoveredAt = 0
  const lastGoodFrameAt = 59_500
  const timerFiredAt = 60_000
  assert.equal(healthyResetDue(recoveredAt, timerFiredAt, lastGoodFrameAt, true, false, false), true, 'this reproduces the prior freshness check')
  // Timer firing alone records the wait; no storage is cleared before a post-timer successful frame.
  assert.equal(storage.get(LOST_RELOADS_KEY), '2')
  const postTimerFrameAt = 60_016
  if (healthyResetDue(recoveredAt, postTimerFrameAt, postTimerFrameAt, true, false, false) && postTimerFrameAt > timerFiredAt) {
    storage.delete(LOST_RELOADS_KEY)
    storage.delete(LOST_CEILING_KEY)
    storage.delete(LOST_CEILING_EXPIRES_KEY)
  }
  assert.equal(storage.has(LOST_RELOADS_KEY), false, 'a successful frame after the timer completes the reset')
  assert.equal(storage.has(LOST_CEILING_KEY), false)
  assert.equal(storage.has(LOST_CEILING_EXPIRES_KEY), false)
}
// Issue #254: a stall restarts the window instead of letting the next frame complete it.
assert.deepEqual(healthyFrameWindow(null, null, 5_000), { recoveredAt: 5_000, restarted: false }, 'the first frame opens the window')
assert.deepEqual(healthyFrameWindow(0, 59_000, 60_000), { recoveredAt: 0, restarted: false }, 'a gap at the allowance keeps the window')
assert.deepEqual(healthyFrameWindow(0, 59_000, 60_001), { recoveredAt: 60_001, restarted: true }, 'a gap past the allowance restarts it')
{
  // Lifecycle: the frame block and the 60 s timer of main.ts, in virtual time. Last frame at 59.5 s, timer at 60 s, next frame at 120 s.
  const storage = new Map([[LOST_RELOADS_KEY, '2'], [LOST_CEILING_KEY, String(300 * MB)], [LOST_CEILING_EXPIRES_KEY, '999999']])
  let recoveredAt: number | null = null, lastFrameAt: number | null = null, timerDue: number | null = null, timerFiredAt: number | null = null
  const finish = (): void => { storage.clear(); recoveredAt = null; timerFiredAt = null }
  const fireTimer = (now: number): void => {
    timerDue = null
    timerFiredAt = now
    if (!healthyResetDue(recoveredAt!, now, lastFrameAt, true, false, false)) { recoveredAt = null; timerFiredAt = null }
  }
  const frame = (now: number): void => {
    if (timerDue !== null && now >= timerDue) fireTimer(timerDue)
    if (storage.size === 0) return
    const w = healthyFrameWindow(recoveredAt, lastFrameAt, now)
    if (w.restarted) { timerDue = null; timerFiredAt = null }
    recoveredAt = w.recoveredAt
    lastFrameAt = now
    if (timerFiredAt !== null && lastFrameAt > timerFiredAt && healthyResetDue(recoveredAt, lastFrameAt, lastFrameAt, true, false, false)) finish()
    if (recoveredAt !== null && timerDue === null && storage.size > 0) timerDue = now + HEALTHY_RESET_MS
  }
  for (let t = 0; t <= 59_500; t += 500) frame(t)
  assert.equal(storage.get(LOST_RELOADS_KEY), '2', 'nothing clears before the window ends')
  frame(120_000)
  assert.equal(storage.get(LOST_RELOADS_KEY), '2', 'one frame after a 60 s stall cannot clear the reload count')
  assert.equal(storage.get(LOST_CEILING_KEY), String(300 * MB), 'nor the lowered ceiling')
  assert.equal(storage.get(LOST_CEILING_EXPIRES_KEY), '999999', 'nor the ceiling expiry')
  for (let t = 120_500; t < 180_000; t += 500) frame(t)
  assert.equal(storage.get(LOST_RELOADS_KEY), '2', 'the restarted window needs its own full 60 s')
  for (let t = 180_000; t <= 181_000; t += 500) frame(t)
  assert.equal(storage.size, 0, 'a full healthy window after the stall clears the recovery markers')
}
assert.equal(healthyResetDue(100, 60_100, null, true, false, true), true, 'intentional idle sleep counts as healthy')
assert.equal(healthyResetDue(100, 60_100, 60_099, false, false, false), false, 'background time cannot reset the budget')
assert.equal(healthyResetDue(100, 60_100, 60_099, true, true, false), false, 'a new loss cancels the healthy streak')
{
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(src, /if \(healthyRecoveryPending && !contextLost && !document\.hidden && !nativePaused\) \{\n {4}const frameAt = performance\.now\(\)/, 'only completed foreground frames advance recovery health')
  assert.match(src, /const w = healthyFrameWindow\(healthyRecoveryAt, healthyLastFrameAt, frameAt\)\n {4}if \(w\.restarted\) clearHealthyResetTimer\(\)\n {4}healthyRecoveryAt = w\.recoveredAt\n {4}healthyLastFrameAt = frameAt\n {4}if \(healthyResetTimerFiredAt !== null/, 'a stalled frame restarts the window before the completion check (issue #254)')
  assert.match(src, /function wakeLoop[\s\S]*?if \(healthyRecoveryPending && healthyLastFrameAt !== null\) healthyLastFrameAt = lastLoopAt\n {2}requestAnimationFrame\(frameLoop\)/, 'an intentional idle sleep is not a stall of the healthy window')
  assert.match(src, /function invalidateHealthyRecoveryWindow\(\): void \{\n {2}clearHealthyResetTimer\(\)\n {2}healthyRecoveryAt = null\n {2}healthyLastFrameAt = null\n\}/, 'failed rendering disarms and invalidates the healthy window')
  assert.match(src, /catch \(e\) \{ invalidateHealthyRecoveryWindow\(\); gpuTimer\.abort\(\); passTimer\.abort\(\); throw e \}/, 'a render exception invalidates the healthy window before it escapes')
  assert.match(src, /if \(buildOnly\) \{[\s\S]*?catch \(e\) \{ invalidateHealthyRecoveryWindow\(\); gpuTimer\.abort\(\); passTimer\.abort\(\); throw e \} finally \{ inRender = false \}/, 'a buildOnly render exception also disarms the healthy window')
  assert.match(src, /healthyResetTimerFiredAt = now[\s\S]*?if \(idleSleeping\) finishHealthyRecovery\(\)/, 'the timer waits for a later successful frame unless the loop is intentionally idle')
  assert.match(src, /healthyResetTimerFiredAt !== null && healthyLastFrameAt > healthyResetTimerFiredAt[\s\S]*?finishHealthyRecovery\(\)/, 'a post-timer successful foreground frame finishes recovery')
  assert.match(src, /if \(document\.hidden\) clearHealthyResetTimer\(\)\n {2}else if \(healthyRecoveryPending\) \{ healthyRecoveryAt = null; healthyLastFrameAt = null \}/, 'visibility changes require a new successful frame to restart the healthy window')
  assert.match(src, /onPause: \(\) => \{ nativePaused = true; clearHealthyResetTimer\(\); healthyRecoveryAt = null; healthyLastFrameAt = null;/, 'native idle time also restarts the healthy window')
}

// Reload budget: a loop ends.
assert.deepEqual(reloadDecision(null), { reload: true, count: 1 })
assert.deepEqual(reloadDecision('1'), { reload: true, count: 2 })
assert.deepEqual(reloadDecision(String(MAX_LOSS_RELOADS)), { reload: false, count: MAX_LOSS_RELOADS })
assert.deepEqual(reloadDecision('garbage'), { reload: true, count: 1 })
assert.deepEqual(reloadDecision('-3'), { reload: true, count: 1 })

// Stored ceiling: only ever lowers, ignores junk, leaves the website start alone when nothing is stored.
assert.equal(startCeiling(500 * MB, null), 500 * MB)
assert.equal(startCeiling(Infinity, null), Infinity, 'desktop with no loss is unchanged')
const futureExpiry = String(Date.now() + LOST_CEILING_TTL_MS)
assert.equal(startCeiling(500 * MB, String(300 * MB), futureExpiry), 300 * MB)
assert.equal(startCeiling(500 * MB, String(900 * MB), futureExpiry), 500 * MB, 'a stored value never raises the ceiling')
assert.equal(startCeiling(Infinity, String(300 * MB), futureExpiry), 300 * MB)
for (const bad of ['', 'x', '0', '-5', 'NaN', 'Infinity']) assert.equal(startCeiling(500 * MB, bad, futureExpiry), 500 * MB, `junk ${bad}`)
assert.equal(startCeiling(500 * MB, String(300 * MB), String(Date.now() - 1)), 500 * MB, 'an expired loss marker does not lower startup quality')
assert.equal(startCeiling(500 * MB, String(300 * MB), null), 500 * MB, 'a ceiling without an expiry is ignored')
assert.equal(ceilingToStore(350 * MB, 400 * MB), 350 * MB)
assert.equal(ceilingToStore(Infinity, 400 * MB), Math.round(400 * MB * 0.7))
assert.equal(ceilingToStore(10 * MB, 0), 64 * MB, 'a floor, so the next start is not starved')

// Patch budget: the iOS app keeps its class cap (the website ios class has none, as on main), native Android phones get 64 MB (round 3; was 96), every other class is untouched (website unchanged); a loss halves it.
assert.equal(patchBudget(shellProfile('ios', CLASS_TABLE.ios, true).patchResidentBytes, false, false), 96 * MB)
assert.equal(patchBudget(CLASS_TABLE.ios.patchResidentBytes, false, false), 48 * MB, 'iOS website: the R54 cap (?memcap=0 restores the layer default)')
assert.equal(patchBudget(undefined, true, false), 64 * MB)
assert.equal(NATIVE_ANDROID_PATCH_BYTES, 64 * MB)
assert.equal(patchBudget(undefined, false, false), undefined, 'the website and desktop keep the layer default (192 MB)')
assert.equal(patchBudget(undefined, false, true), 96 * MB, 'the helper halves any class after a loss; main.ts passes lowered only in the app')
assert.ok(mainSrcEarly().includes("patchBudget(quality.profile.patchResidentBytes, !!nativeHost && quality.detected.cls === 'phone-android', !!nativeHost && quality.contextLosses > 0)"), 'the website keeps the patch default after a loss (main)')
assert.equal(patchBudget(96 * MB, false, true), 48 * MB)
assert.equal(patchBudget(undefined, true, true), 48 * MB, 'half of 64 is 32: the 48 MB floor holds')
// Ground rest DPR: 1.5 in the Android app only.
assert.equal(groundRestDprCap('phone-android', true), 1.5)
assert.equal(groundRestDprCap('phone-android', false), undefined, 'website unchanged')
for (const c of ['desktop', 'tablet', 'ios']) assert.equal(groundRestDprCap(c, true), undefined, c)
assert.ok(mainSrcEarly().includes('const groundRest = (groundMode?.active || pendingLanding !== null) && quality.dprOverride === undefined ? groundRestDprCap(quality.detected.cls, !!nativeHost) : undefined'), 'main applies the cap on the ground and while a landing is pending')
function mainSrcEarly(): string { return readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8') }
// Native shell profile: TC off on phone-android (8 GB keeps it on the website); nothing else changes.
const android8 = profileFor('phone-android', { deviceMemory: 8 })
assert.equal(android8.tc, true, 'the website class keeps TC with 8 GB')
assert.equal(shellProfile('phone-android', android8, true).tc, false)
assert.equal(shellProfile('phone-android', android8, false), android8, 'the website profile is the same object')
assert.equal(shellProfile('tablet', CLASS_TABLE.tablet, true), CLASS_TABLE.tablet)
assert.equal(shellProfile('desktop', CLASS_TABLE.desktop, true), CLASS_TABLE.desktop)
assert.equal(shellProfile('ios', CLASS_TABLE.ios, false), CLASS_TABLE.ios, 'the iOS website profile is the same object')
// The tile shadow cache is released in the ground view only in the Android app.
assert.equal(parkTileShadowsInGround('phone-android', true), true)
assert.equal(parkTileShadowsInGround('phone-android', false), false, 'the website keeps it')
for (const c of ['desktop', 'tablet', 'ios', 'software']) assert.equal(parkTileShadowsInGround(c, true), false, c)
// ...and main.ts parks it on every way into the ground view and brings it back on every way out; the ground shader never reads it.
const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const enters = mainSrc.match(/\b(?:g|gm)\.enter\(ephem/g)?.length ?? 0
const parks = mainSrc.match(/\b(?:g|gm)\.enter\(ephem[^\n]*\n?[^\n]*parkShadowCache\(\)/g)?.length ?? 0
assert.ok(enters >= 2 && parks === enters, `every ground entry parks (${parks} of ${enters})`)
const leaves = mainSrc.match(/\b(?:g|gm)\.leave\(\)/g)?.length ?? 0
const unparks = mainSrc.match(/\b(?:g|gm)\.leave\(\)[;\s]*(?:\n\s*)?void unparkShadowCache\(\)/g)?.length ?? 0
assert.ok(leaves >= 3 && unparks === leaves, `every ground exit unparks (${unparks} of ${leaves})`)
const groundShader = readFileSync(new URL('../src/ground/groundShader.ts', import.meta.url), 'utf8')
assert.ok(!/uTileS\b|uShOn|uShFade/.test(groundShader), 'the ground shader has no tile shadow cache read')
console.log('context-recovery: ok')
