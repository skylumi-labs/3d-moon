/**
 * Two defects already on main, pinned against the production source of src/main.ts (functions extracted through the TypeScript AST):
 *  1. (#369) A warm link that changes the held Sun without a `t` fades through `fadeFrame`, which did not mark the fade as a date transition. The new
 *     Sun's markMoved made the next frame `moving`, its gesture start ran `if (!dateTransition) final?.cancelDateTransition()` and dropped the fade
 *     before its first frame was drawn: the lighting cut. fadeFrame now marks it, so only a refine composite is dropped there.
 *  2. (#366) A date carry runs on its own clock (CARRY_MIN_MS at least) once the fly-to it rode on is dropped (a grab, Stop) or when there is none. It
 *     stepped `ephem` with markDirty only, so the resolution policy saw rest (motionActive false 100 ms after the camera stopped): the hand-back drew
 *     full-size frames and crossfaded the last motion frame's Sun under a Sun still moving. stepDateCarry now calls markMoved for every carry step.
 * tsx scripts/fade-carry-followup.test.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { ephemerisAt } from '../src/ephemeris.ts'
import { CARRY_MAX_MS, CARRY_MIN_MS, EphemCarry } from '../src/journey/ephemCarry.ts'
import { tweenProgress } from '../src/camera/tween.ts'
import { motionActive } from '../src/post/motionGrid.ts'

const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('main.ts', main, ts.ScriptTarget.ES2022, true)
const js = (code: string): string => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const fnDecl = (name: string): ts.FunctionDeclaration => {
  const d = ast.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name)
  assert.ok(d, `production ${name} exists`)
  return d
}
const getFunction = (name: string): string => js(fnDecl(name).getText(ast))

// 1. The link's lighting fade survives the gesture start its own markMoved causes.
{
  // The gesture start's guard, as the frame loop has it.
  let guard: string | null = null
  const visit = (n: ts.Node): void => {
    ts.forEachChild(n, visit)
    // The innermost if around the cancel (children are visited first).
    if (guard === null && ts.isIfStatement(n) && n.thenStatement.getText(ast).includes('cancelDateTransition')) guard = n.getText(ast)
  }
  visit(fnDecl('frameLoopBody'))
  assert.equal(guard, 'if (!dateTransition) final?.cancelDateTransition()', 'the gesture start drops a composite unless a date transition runs')
  const log: string[] = []
  const finalPass = { beginDateTransition: () => log.push('begin'), cancelDateTransition: () => log.push('cancel') }
  const ctx = { last: { w: 8, h: 8, exposure: {} }, final: finalPass, renderer: {}, targets: { get: () => ({}) }, time: new Date('2026-10-30T10:00:00Z'), performance: { now: () => 5000 } }
  const app = new Function('ctx', `let { last, final, renderer, targets, time, performance } = ctx; let dateTransition = null, dateHoldAt = -1e9, dateHoldFor = 300;
    ${getFunction('fadeFrame')} ${getFunction('dateHoldMs')}
    return { fadeFrame, dateHoldMs, gestureStart: () => { ${js(guard!)} }, transition: () => dateTransition, clear: () => { dateTransition = null } };`)(ctx) as {
    fadeFrame: (ms: number, hold: boolean) => void; dateHoldMs: (now: number) => number; gestureStart: () => void; transition: () => unknown; clear: () => void
  }
  // applyLinkInPlace without a `t`: fadeFrame(FADE_HOLD_MS, true), then the new held Sun and markMoved. The next frame is `moving` and starts a gesture.
  app.fadeFrame(300, true)
  assert.equal(app.dateHoldMs(5000), 300, 'a fly-to in the same event waits for the fade')
  app.gestureStart()
  assert.deepEqual(log, ['begin'], 'the lighting fade is not cancelled by the gesture start of its own picture change (a cut otherwise)')
  assert.ok(app.transition(), 'the fade counts as a date transition while it runs (rest, refine and catch-up guards)')
  // A refine composite (no date transition) is still dropped at a gesture start, as before.
  app.clear(); log.length = 0
  app.gestureStart()
  assert.deepEqual(log, ['cancel'], 'a refine composite is still dropped when a gesture starts')
}

// 2. A carry on its own clock is motion until it ends.
{
  const from = ephemerisAt(new Date('2026-10-20T19:00:00Z')), to = ephemerisAt(new Date('1969-07-20T20:17:00Z'))
  let perfNow = 0
  const ctx = { ephem: to, ephemCarry: null as EphemCarry | null, carryDriver: null as unknown, tween: null as unknown, tweenProgress, because: () => {}, markDirty: () => {}, performance: { now: () => perfNow } }
  const app = new Function('ctx', `let { ephem, ephemCarry, carryDriver, tween, tweenProgress, because, markDirty, performance } = ctx; let lastMoveAt = -1e9, needsRefine = false;
    ${getFunction('markMoved')} ${getFunction('stepDateCarry')}
    return { stepDateCarry, lastMoveAt: () => lastMoveAt, ephem: () => ephem, carry: () => ephemCarry, setTween: (t) => { tween = t },
      start: (c, d) => { ephemCarry = c; carryDriver = d; tween = d; ephem = c.target } };`)(ctx) as {
    stepDateCarry: (now: number) => void; lastMoveAt: () => number; ephem: () => typeof to; carry: () => EphemCarry | null; setTween: (t: unknown) => void
    start: (c: EphemCarry, d: unknown) => void
  }
  const run = (flyMs: number, cancelAt: number | null): { changedAfterMove: number; restFramesWhileMoving: number; endAt: number } => {
    const t0 = 1000
    const tw = { t0, plan: { ms: flyMs } }
    // carryDate's clock: the fly-to's remaining time, clamped to CARRY_MIN_MS..CARRY_MAX_MS.
    app.start(new EphemCarry(from, to, t0, Math.max(CARRY_MIN_MS, Math.min(CARRY_MAX_MS, flyMs))), tw)
    let prevSun = from.sunDir.clone(), changedAfterMove = 0, restFramesWhileMoving = 0, endAt = -1, moveEnd = t0 + flyMs
    for (let now = t0 + 16; now < t0 + 3000 && app.carry(); now += 16) {
      perfNow = now
      if (cancelAt !== null && now >= cancelAt && app.carry()) { app.setTween(null); moveEnd = Math.min(moveEnd, cancelAt) }
      else if (now >= t0 + flyMs) app.setTween(null)
      app.stepDateCarry(now)
      const sun = app.ephem().sunDir
      const changed = sun.angleTo(prevSun) > 1e-9
      prevSun = sun.clone()
      if (changed && now > moveEnd) changedAfterMove++
      // The frame loop's policy with the camera still (moved false, no drag): moving only while a recent markMoved holds it.
      if (changed && !motionActive(false, false, false, now - app.lastMoveAt())) restFramesWhileMoving++
      if (!app.carry()) endAt = now
    }
    return { changedAfterMove, restFramesWhileMoving, endAt }
  }
  // A 400 ms fly-to that runs to its end: the carry rides its progress and ends with it (CARRY_MIN_MS applies only to the own clock).
  const whole = run(400, null)
  assert.ok(whole.endAt >= 1400 && whole.endAt < 1416, `a carry on a fly-to that ends ends with it (ended at ${whole.endAt})`)
  assert.equal(whole.changedAfterMove, 0, 'and moves no light after it')
  // The same fly-to dropped at 200 ms (a grab, Stop): the carry goes on by its own clock, the light still moving after the camera stopped.
  const cut = run(400, 1200)
  assert.ok(cut.changedAfterMove > 5, `the carry outlives a cancelled fly-to (${cut.changedAfterMove} frames of light moving after it)`)
  assert.equal(cut.restFramesWhileMoving, 0, `every frame whose Sun moved counts as motion (${cut.restFramesWhileMoving} were drawn as rest frames: full size, the refine crossfade over a moving Sun)`)
}

console.log('fade-carry-followup: ok')
