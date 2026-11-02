/* eslint-disable @typescript-eslint/no-explicit-any -- a debug harness reading the page's untyped __moon api */
// Holds the ridge lift-off at chosen progress values and saves a frame (UI hidden) plus the exposure state for each.
//   node --import tsx audit/journey-frames.mts --url <index.html> --out <dir> [--u 0.1,0.3,0.5]
import fs from 'node:fs'
import path from 'node:path'
import { launchBrowser } from './lib.mts'
const arg = (k: string, d = '') => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const URL_ = arg('url'); const OUT = arg('out', '.audit-out/jframes')
const us = arg('u', '0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9').split(',').map(Number)
const { browser, renderer } = await launchBrowser(false, process.platform !== "darwin")
console.log('renderer', renderer)
fs.mkdirSync(OUT, { recursive: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const p = await ctx.newPage()
  await p.addInitScript('window.__name = (f) => f')
  await p.goto(`${URL_}${URL_.includes('?') ? '&' : '?'}cb=${Date.now()}`, { timeout: 60000 })
  await p.waitForFunction(() => (window as any).__moon?.ready === true, null, { timeout: 90000 })
  await p.waitForTimeout(2000)
  await p.addStyleTag({ content: 'body.shot #ui, body.shot #err, body.shot #preview{visibility:hidden !important}' })
  const rows: any[] = []
  for (const u of us) {
    await p.evaluate((x) => (window as any).__moon.setJourney(x), u)
    await p.waitForTimeout(2500)
    await p.evaluate(() => document.body.classList.add('shot')); await p.waitForTimeout(300)
    const file = path.join(OUT, `u${u.toFixed(2)}.png`)
    fs.writeFileSync(file, await p.screenshot({ type: 'png' }))
    await p.evaluate(() => document.body.classList.remove('shot'))
    const ex = await p.evaluate(() => (window as any).__moon.exposureState?.())
    const js = await p.evaluate(() => { const j = (window as any).__moon.journeyState?.(); return j && { u: j.u, status: j.status, phase: j.phase } })
    const row = { u, white: ex?.white, raw: ex?.rawWhite, hits: ex?.searchHits, js }
    rows.push(row); console.log(JSON.stringify(row))
  }
  fs.writeFileSync(path.join(OUT, 'rows.json'), JSON.stringify(rows, null, 1))
  await ctx.close()
} finally { await browser.close() }
