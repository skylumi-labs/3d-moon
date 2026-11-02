/* eslint-disable @typescript-eslint/no-explicit-any -- a debug recorder reading the page's untyped __moon api */
// Real-speed landing recorder (audit 4): one Playwright video (1920x1080) per journey plus a 4 Hz state/white log.
//   node --import tsx audit/record.mts --url <index.html> --out <dir> [--only apollo17,apollo11,apollo17-25cm,land-lm,flight]
import fs from 'node:fs'
import path from 'node:path'
import { launchBrowser } from './lib.mts'
import { SETTLE_END_T } from '../src/descent/flight.ts'
const arg = (k: string, d = '') => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const URL_ = arg('url'); const OUT = arg('out', '.audit-out/rec'); const only = arg('only', 'apollo17,apollo11,apollo17-25cm,land-lm').split(',')
const { browser, renderer, mode } = await launchBrowser(false, process.platform !== "darwin")
console.log('renderer', renderer, '|', mode)
fs.mkdirSync(OUT, { recursive: true })
for (const id of only) {
  const dir = path.join(OUT, id); fs.mkdirSync(dir, { recursive: true })
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir, size: { width: 1920, height: 1080 } } })
  const t0 = Date.now(); const T = () => (Date.now() - t0) / 1000
  const p = await ctx.newPage()
  await p.addInitScript('window.__name = (f) => f')
  await p.addInitScript(`window.__gaps = []; window.__loaf = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__loaf.push({ at: Math.round(e.startTime), dur: Math.round(e.duration), block: Math.round(e.blockingDuration), scripts: e.scripts.map((s) => ({ inv: s.invoker, fn: s.sourceFunctionName, url: (s.sourceURL || '').split('/').pop(), dur: Math.round(s.duration), start: Math.round(s.startTime), exec: Math.round(s.executionStart), layout: Math.round(s.forcedStyleAndLayoutDuration), pause: Math.round(s.pauseDuration || 0) })) }) }).observe({ type: 'long-animation-frame', buffered: true }) } catch (e) {} (() => { let last = performance.now(); const tick = (now) => { if (now - last > 100) window.__gaps.push({ at: Math.round(now), gap: Math.round(now - last) }); last = now; requestAnimationFrame(tick) }; requestAnimationFrame(tick) })()`)
  const log: string[] = []; const events: Array<{ t: number; e: string }> = []
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.push(`${T().toFixed(1)} ${m.type()}: ${m.text().slice(0, 200)}`) })
  p.on('pageerror', (e) => log.push(`${T().toFixed(1)} PAGEERR ${e.message}`))
  await p.goto(`${URL_}${URL_.includes('?') ? '&' : '?'}cb=${Date.now()}`, { timeout: 60000 })
  await p.waitForFunction(() => (window as any).__moon?.ready === true, null, { timeout: 90000 })
  await p.waitForTimeout(3000)
  const sk = p.locator('button:has-text("Skip the lift-off")').first()
  if (await sk.count().catch(() => 0)) { await sk.click({ timeout: 4000 }); await p.waitForTimeout(5000) }
  const samples: any[] = []
  const sample = async () => {
    const s = await p.evaluate(() => { const m = (window as any).__moon; const dd = m?.descentDebug?.(); const js = m?.journeyState?.(); const ex = m?.exposureState?.(); const st = m?.state?.()
      return { dd, js: js && { status: js.status, phase: js.phase, mode: js.mode, progress: js.progress, held: js.held, patch: js.patch, descent: js.descent }, ex: ex && { raw: ex.rawWhite, white: ex.white }, pos: st?.cam?.pos,
        gp: [...document.querySelectorAll('.ground-panel button')].filter((b) => (b as HTMLElement).offsetParent).map((b) => (b as HTMLElement).innerText.trim()) } }).catch(() => null)
    samples.push({ t: +T().toFixed(2), ...s })
    return s
  }
  const tick = async (sec: number) => { const end = Date.now() + sec * 1000; while (Date.now() < end) { await sample(); await p.waitForTimeout(250) } }
  const chipId = id === 'flight' ? 'land-like-apollo17' : id
  await tick(2)
  events.push({ t: T(), e: 'click:' + chipId })
  await p.locator(`.chip[data-id="${chipId}"]`).first().click({ timeout: 15000, noWaitAfter: true })
  let arrivedAt = -1; const budget = Date.now() + 160000
  while (Date.now() < budget) {
    const s: any = await sample(); await p.waitForTimeout(250)
    const flightT = id === 'flight' ? await p.evaluate(() => (window as any).__moon?.flight?.info?.()?.t).catch(() => undefined) : undefined
    // The flight never "arrives": it runs on its own clock. Stop watching it a few hundred seconds before ignition (the fast-forward is ~45 s of picture) so "Skip to ignition" is pressed while it is still enabled (audit 4 and 5 pressed it past -10 s).
    const done = id === 'land-lm' ? (s?.gp?.length > 0) : id === 'flight' ? (typeof flightT === 'number' && flightT >= -250) : s?.js?.status === 'arrived'
    if (done && arrivedAt < 0) { arrivedAt = T(); events.push({ t: arrivedAt, e: 'arrived' }) }
    if (arrivedAt > 0 && T() > arrivedAt + (id === 'flight' ? 0 : 8)) break
  }
  if (id === 'land-lm') for (const label of ['Window height', 'Footpad', 'Strut', 'Follow', 'Origin']) {
    events.push({ t: T(), e: 'press:' + label })
    try { await p.locator(`.ground-panel button:visible:has-text("${label}")`).first().click({ timeout: 5000 }) } catch { log.push(`${T().toFixed(1)} press ${label} failed`) }
    await tick(6)
  }
  if (id === 'flight') {
    const skip = p.locator('.flight-panel button:visible:has-text("Skip to ignition")').first()
    const enabled = await skip.isEnabled({ timeout: 3000 }).catch(() => false)
    events.push({ t: T(), e: 'press:Skip to ignition' + (enabled ? '' : ' (DISABLED)') })
    if (enabled) { try { await skip.click({ timeout: 5000 }) } catch { log.push('press Skip to ignition failed') } } else log.push('Skip to ignition was disabled')
    // The flight runs on its own clock: ~12 min of true time from ignition to the end of the settle. Record all of it (audit 6 stopped 30 s after ignition), then 3 s more.
    const flightEnd = Date.now() + (SETTLE_END_T + 60) * 1000
    while (Date.now() < flightEnd) {
      const ft = await p.evaluate(() => (window as any).__moon?.flight?.info?.()?.t).catch(() => undefined)
      if (typeof ft === 'number' && ft >= SETTLE_END_T) break
      await tick(2)
    }
    events.push({ t: T(), e: 'flight-end' })
    await tick(3)
  }
  const gaps = await p.evaluate(() => (window as any).__gaps).catch(() => [])
  const trace = await p.evaluate(() => (window as any).__moon?.patchTrace?.()).catch(() => [])
  const slices = await p.evaluate(() => (window as any).__sliceTrace).catch(() => [])
  const loaf = await p.evaluate(() => (window as any).__loaf).catch(() => [])
  const perfNow = await p.evaluate(() => Math.round(performance.now())).catch(() => 0)
  fs.writeFileSync(path.join(dir, 'samples.json'), JSON.stringify({ id, events, samples, log, renderer, gaps, loaf, trace, slices, perfNowAtEnd: perfNow, pageSecondsAtEnd: T() }, null, 1))
  const v = p.video(); await ctx.close(); if (v) { const f = await v.path(); fs.renameSync(f, path.join(dir, `${id}.webm`)) }
  console.log(id, 'events', JSON.stringify(events), 'log', log.length)
}
await browser.close()
