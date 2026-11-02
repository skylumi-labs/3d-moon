/* eslint-disable @typescript-eslint/no-explicit-any */
// The Sun button's turn, recorded: a frame about every 100 ms of the turn to the Sun and of the turn back, with the exposure's white point read
// per frame. The owner rule: a camera move is one continuous flight with no visible exposure pumping, so the white may not step.
// Usage: node --import tsx audit/sun-turn.mts [--url http://localhost:5190/moon/] [--out DIR] [--tag after] [--query 'k=v&...'] [--w 1280 --h 800 [--mobile 1]]
import fs from 'node:fs'
import { launchBrowser, openPage } from './lib.mts'
const arg = (k: string, d: string): string => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d }
const url = arg('url', 'http://localhost:5190/moon/'), out = arg('out', '.render-out/sun-turn'), tag = arg('tag', 'run')
const query = arg('query', 'debug=0&t=2026-10-18T00:00:00Z&auto=0&start=earth')
const W = Number(arg('w', '1280')), H = Number(arg('h', '800')), mobile = arg('mobile', '') === '1'
/** The steepest the white point may move, stops per second: the controller's own top rate is 3 (exposureControl.ts maxStopsPerS); more than that is a step, not a ramp. */
const MAX_RATE_STOPS_S = 4.5
/** Below this frame rate the machine, not the page, set the pace (the controller clamps a frame at 0.25 s): the run says so instead of passing or failing. */
const MIN_FPS = 40
fs.mkdirSync(out, { recursive: true })
const { browser } = await launchBrowser(false, false)
let failed = false
try {
  const p = await openPage(browser, url, { w: W, h: H, mobile, query, skip: false })
  await p.waitForTimeout(6000)
  const press = (): Promise<void> => p.evaluate(() => { (document.querySelector('button[data-bar="sun"]') as HTMLElement).click() })
  // Warm-up: the first Sun in view compiles its shaders (seconds of stall). The measured turns are the second pair.
  await press(); await p.waitForTimeout(9000); await press(); await p.waitForTimeout(9000)
  // Per-frame white point read inside the page every animation frame (screenshots would slow the render loop and bend the measurement).
  await p.evaluate(() => {
    const w = window as any; w.__rec = []; w.__recOn = true
    const tick = (): void => { if (!w.__recOn) return; const m = w.__moon; w.__rec.push({ t: performance.now(), white: m.exposureState().white, frames: m.frames || 0 }); requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  for (const leg of ['to-sun', 'back']) {
    await p.evaluate(() => { (window as any).__rec.length = 0 })
    await press()
    await p.waitForTimeout(7000)
    const rec: Array<{ t: number; white: number }> = await p.evaluate(() => (window as any).__rec.slice())
    // The rate over a 150 ms window (two frames 7 ms apart say nothing about the exposure: the picture moves at 60 Hz, the eye reads tenths of a second).
    let worst = 0, worstAt = 0, gap = 0
    for (let i = 1; i < rec.length; i++) gap = Math.max(gap, (rec[i].t - rec[i - 1].t) / 1000)
    for (let i = 0, j = 0; i < rec.length; i++) {
      while (rec[i].t - rec[j].t > 150) j++
      if (rec[i].t - rec[j].t < 100) continue
      const r = Math.abs(Math.log2(rec[i].white / rec[j].white)) / ((rec[i].t - rec[j].t) / 1000)
      if (r > worst) { worst = r; worstAt = rec[i].t - rec[0].t }
    }
    const fps = rec.length / ((rec[rec.length - 1].t - rec[0].t) / 1000)
    const total = Math.abs(Math.log2(rec[rec.length - 1].white / rec[0].white))
    const slow = fps < MIN_FPS || gap > 0.25
    const bad = slow || worst > MAX_RATE_STOPS_S
    if (bad) failed = true
    console.log(`${slow ? 'INCONCLUSIVE (machine too slow, rerun)' : bad ? 'FAIL' : 'ok  '} ${leg}: ${rec.length} frames (${fps.toFixed(1)} fps, longest gap ${(gap * 1000).toFixed(0)} ms), white moved ${total.toFixed(1)} stops, steepest ${worst.toFixed(2)} stops/s at ${worstAt.toFixed(0)} ms (limit ${MAX_RATE_STOPS_S})`)
    // The sky above the Moon is what pumping shows in: its mean grey must never swell and fall back (the grey wash of a late exposure).
    fs.writeFileSync(`${out}/${tag}-${leg}-white.json`, JSON.stringify(rec.map((r) => [Math.round(r.t - rec[0].t), r.white])))
  }
  await p.evaluate(() => { (window as any).__recOn = false })
  // The frames, for looking at: the same two turns again, a screenshot every ~120 ms.
  for (const leg of ['to-sun', 'back']) {
    await press()
    const t0 = Date.now(); let n = 0
    while (Date.now() - t0 < 6000) { fs.writeFileSync(`${out}/${tag}-${leg}-${String(n++).padStart(3, '0')}.jpg`, await p.screenshot({ type: 'jpeg', quality: 80 })); await p.waitForTimeout(60) }
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
