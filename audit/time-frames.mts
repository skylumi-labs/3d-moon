/* eslint-disable @typescript-eslint/no-explicit-any -- a debug harness reading the page's untyped __moon api */
// Sets the moment (ISO UTC) from the Earth view and saves a frame (UI hidden) plus the disc's mean/p99 and the sky's mean for each.
//   node --import tsx audit/time-frames.mts --url <index.html> --out <dir> --t 2026-09-30T23:36:00Z,2026-10-10T12:00:00Z
import fs from 'node:fs'
import path from 'node:path'
import { launchBrowser } from './lib.mts'
const arg = (k: string, d = '') => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const URL_ = arg('url'); const OUT = arg('out', '.audit-out/tframes')
const ts = arg('t').split(',').filter(Boolean)
const { browser, renderer } = await launchBrowser(false, process.platform !== 'darwin')
console.log('renderer', renderer)
fs.mkdirSync(OUT, { recursive: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const p = await ctx.newPage()
  await p.addInitScript('window.__name = (f) => f')
  await p.goto(`${URL_}${URL_.includes('?') ? '&' : '?'}cb=${Date.now()}`, { timeout: 60000 })
  await p.waitForFunction(() => (window as any).__moon?.ready === true, null, { timeout: 90000 })
  await p.waitForTimeout(2000)
  const sk = p.locator('button:has-text("Skip the lift-off")').first()
  if (await sk.count().catch(() => 0)) { await sk.click({ timeout: 4000 }); await p.waitForTimeout(2000) }
  await p.addStyleTag({ content: 'body.shot #ui, body.shot #err, body.shot #preview{visibility:hidden !important}' })
  const rows: any[] = []
  for (const t of ts) {
    await p.evaluate((x) => (window as any).__moon.setTime(x), t)
    await p.waitForTimeout(3500)
    await p.evaluate(() => document.body.classList.add('shot')); await p.waitForTimeout(300)
    const file = path.join(OUT, `${t.replace(/[^0-9]/g, '')}.png`)
    const buf = await p.screenshot({ type: 'png' })
    fs.writeFileSync(file, buf)
    await p.evaluate(() => document.body.classList.remove('shot'))
    const ex = await p.evaluate(() => (window as any).__moon.exposureState?.())
    const st = await p.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
      const c = document.createElement('canvas'); c.width = 320; c.height = 180
      const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
      g.drawImage(img, 0, 0, 320, 180)
      const d = g.getImageData(0, 0, 320, 180).data
      const grey: number[] = []
      for (let i = 0; i < d.length; i += 4) grey.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])
      const disc = grey.filter((v) => v > 10).sort((a, b) => a - b)
      const q = (f: number) => (disc.length ? disc[Math.min(disc.length - 1, Math.floor(f * disc.length))] : 0)
      return { discPx: disc.length, discMean: +(disc.reduce((a, b) => a + b, 0) / Math.max(1, disc.length)).toFixed(1), p10: q(0.1), p50: q(0.5), p99: q(0.99), white: +(disc.filter((v) => v > 240).length / Math.max(1, disc.length)).toFixed(3) }
    }, buf.toString('base64'))
    const row = { t, exposureWhite: ex?.white, ...st }
    rows.push(row); console.log(JSON.stringify(row))
  }
  fs.writeFileSync(path.join(OUT, 'rows.json'), JSON.stringify(rows, null, 1))
  await ctx.close()
} finally { await browser.close() }
