// After a GPU reset in the app (issue #206): no reload into a page that cannot get a WebGL context. Pure, no WebGL.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BLOCKED_MESSAGE, RESET_MESSAGE, RESTARTING_MESSAGE, RETRY_LABEL, RETRY_WAIT_MS, START_MESSAGE, createRetry, lossExit, probeWebGL2, type RetryView } from '../src/quality/gpuReset.ts'

// The exit: only the app checks for a context first; the website keeps its reload.
assert.equal(lossExit(true, false), 'retry', 'app, context refused: the retry card, never a reload')
assert.equal(lossExit(true, true), 'reload', 'app, context granted: reload (at Home)')
assert.equal(lossExit(false, false), 'reload', 'website: unchanged')
assert.equal(lossExit(false, true), 'reload')

// The probe: a live context is available and is given back at once; null, a lost context or a throw is unavailable.
{
  let released = 0
  const live = { isContextLost: () => false, getExtension: (n: string) => (n === 'WEBGL_lose_context' ? { loseContext: () => { released++ } } : null) }
  assert.equal(probeWebGL2(() => ({ getContext: () => live })), true)
  assert.equal(released, 1, 'the probe gives its context back')
  assert.equal(probeWebGL2(() => ({ getContext: () => null })), false, 'refused (Chromium blocks WebGL after a reset)')
  assert.equal(probeWebGL2(() => ({ getContext: () => ({ isContextLost: () => true, getExtension: () => null }) })), false, 'born lost')
  assert.equal(probeWebGL2(() => { throw new Error('no canvas') }), false)
  assert.equal(probeWebGL2(() => ({ getContext: () => ({ isContextLost: () => false, getExtension: () => { throw new Error('x') } }) })), true, 'a failed release does not fail the probe')
}

// The card: show, Try again waits RETRY_WAIT_MS, asks again, reloads only once a context is granted.
function harness(answers: boolean[]) {
  const views: RetryView[] = []
  const timers: { fn: () => void; ms: number }[] = []
  let reloads = 0, probes = 0
  const ctl = createRetry({
    probe: () => { probes++; return answers.shift() ?? false },
    reload: () => { reloads++ },
    render: (v) => { views.push(v) },
    schedule: (fn, ms) => { timers.push({ fn, ms }) },
  })
  return { ctl, views, timers, get reloads() { return reloads }, get probes() { return probes } }
}
{
  const h = harness([false, true])
  h.ctl.show()
  assert.equal(h.ctl.phase, 'shown')
  assert.deepEqual(h.views.at(-1), { message: RESET_MESSAGE, button: RETRY_LABEL, busy: false })
  assert.equal(h.probes, 0, 'showing the card does not probe')
  h.ctl.press()
  assert.equal(h.ctl.phase, 'waiting')
  assert.equal(h.views.at(-1)!.busy, true, 'the button is disabled while it waits')
  assert.equal(h.timers.length, 1)
  assert.equal(h.timers[0].ms, RETRY_WAIT_MS, 'it waits before asking again')
  assert.ok(RETRY_WAIT_MS >= 2000, 'an immediate retry does not lift the block')
  h.ctl.press()
  assert.equal(h.timers.length, 1, 'a second press while waiting is ignored')
  h.timers[0].fn()
  assert.equal(h.ctl.phase, 'blocked')
  assert.equal(h.reloads, 0, 'still refused: no reload')
  assert.deepEqual(h.views.at(-1), { message: BLOCKED_MESSAGE, button: RETRY_LABEL, busy: false })
  h.ctl.press()
  assert.ok(h.views.at(-1)!.message.startsWith(BLOCKED_MESSAGE), 'the second wait keeps the blocked message')
  h.timers[1].fn()
  assert.equal(h.ctl.phase, 'reloading')
  assert.equal(h.reloads, 1, 'granted: one reload')
  assert.deepEqual(h.views.at(-1), { message: RESTARTING_MESSAGE, button: null, busy: true })
  h.ctl.press()
  assert.equal(h.timers.length, 2, 'no press after the reload started')
  assert.equal(h.ctl.tries, 2)
}
{
  const h = harness([])
  h.ctl.press()
  assert.equal(h.timers.length, 0, 'press before show does nothing')
  h.ctl.show(START_MESSAGE)
  h.ctl.show()
  assert.equal(h.views.length, 1, 'show is once')
  assert.equal(h.views[0].message, START_MESSAGE)
  h.ctl.press()
  assert.ok(h.views.at(-1)!.message.startsWith(START_MESSAGE))
}

// Wiring: main.ts probes before a loss reload and offers the card at a failed native start; index.html's fatal() leaves the card alone.
{
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const body = main.slice(main.indexOf('function reloadAfterLoss(): void {'), main.indexOf("canvas.addEventListener('webglcontextlost'"))
  const probeAt = body.indexOf("lossExit(!!nativeHost, probeWebGL2(() => document.createElement('canvas'))) === 'retry'")
  assert.ok(probeAt > 0, 'reloadAfterLoss asks for a context in the app')
  assert.ok(probeAt < body.indexOf('location.reload()'), 'before any reload')
  assert.ok(probeAt < body.indexOf('prepareLossReload('), 'before the reload budget is spent')
  assert.ok(main.includes('if (NATIVE_BUILD && showGpuRetry(reloadAtHome, START_MESSAGE)) throw err'), 'a failed native start shows the card')
  const guard = readFileSync(new URL('../public/boot-guard.js', import.meta.url), 'utf8')
  assert.ok(guard.includes('if (shown || window.__moonHoldErr || (m && m.ready)) return;'))
  const card = readFileSync(new URL('../src/ui/gpuResetCard.ts', import.meta.url), 'utf8')
  assert.ok(card.includes('__moonHoldErr = true'))
}
console.log('gpu-reset-recovery: ok')
