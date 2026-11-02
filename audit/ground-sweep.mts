/* eslint-disable @typescript-eslint/no-explicit-any -- a debug harness reading the page's untyped __moon api */
// Ground-mode exposure sweep (audit 6): arrive at Apollo 17 once, then for each (mult, weight) and each camera preset, hold the view
// and measure the frame (UI hidden): mean grey of the lit picture, share of pixels above 240, and the drawn white point.
//   node --import tsx audit/ground-sweep.mts --url <index.html> --out <dir> [--grid 1,0.9;1.4,0.9] [--runs 1]
import fs from 'node:fs'
import path from 'node:path'
import { launchBrowser } from './lib.mts'
const arg = (k: string, d = '') => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const URL_ = arg('url'); const OUT = arg('out', '.audit-out/gsweep')
const grid = arg('grid', '1,0.35;1,0.9;1.4,0.9;2,0.9;1.4,1').split(';').map((g) => g.split(',').map(Number) as [number, number])
const presets = arg('presets', 'Window height,Footpad,Strut,Follow').split(',')
const { browser, renderer } = await launchBrowser(false, process.platform !== "darwin")
console.log('renderer', renderer)
fs.mkdirSync(OUT, { recursive: true })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
const p = await ctx.newPage()
await p.addInitScript('window.__name = (f) => f')
await p.goto(`${URL_}${URL_.includes('?') ? '&' : '?'}cb=${Date.now()}`, { timeout: 60000 })
await p.waitForFunction(() => (window as any).__moon?.ready === true, null, { timeout: 90000 })
await p.waitForTimeout(3000)
const sk = p.locator('button:has-text("Skip the lift-off")').first()
if (await sk.count().catch(() => 0)) { await sk.click({ timeout: 4000 }); await p.waitForTimeout(4000) }
await p.locator('.chip[data-id="land-lm"]').first().click({ timeout: 15000, noWaitAfter: true })
const t0 = Date.now()
while (Date.now() - t0 < 160000) {
  const n = await p.locator('.ground-panel button:visible').count().catch(() => 0)
  if (n > 0) break
  await p.waitForTimeout(500)
}
console.log('arrived after', ((Date.now() - t0) / 1000).toFixed(1), 's')
await p.waitForTimeout(3000)
await p.addStyleTag({ content: 'body.shot #ui, body.shot #err, body.shot #preview{visibility:hidden !important}' })
const stats = async (file: string) => {
  await p.evaluate(() => document.body.classList.add('shot')); await p.waitForTimeout(400)
  const buf = await p.screenshot({ type: 'png' })
  await p.evaluate(() => document.body.classList.remove('shot'))
  fs.writeFileSync(file, buf)
  return p.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
    const c = document.createElement('canvas'); c.width = 480; c.height = 270
    const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
    g.drawImage(img, 0, 0, 480, 270)
    const d = g.getImageData(0, 0, 480, 270).data
    const grey: number[] = []
    for (let i = 0; i < d.length; i += 4) grey.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])
    const lit = grey.filter((v) => v > 12)
    const sorted = [...lit].sort((a, b) => a - b)
    const q = (f: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] : 0)
    return { litShare: +(lit.length / grey.length).toFixed(3), litMean: +(lit.reduce((a, b) => a + b, 0) / Math.max(1, lit.length)).toFixed(1), p50: +q(0.5).toFixed(0), p99: +q(0.99).toFixed(0), white: +(grey.filter((v) => v > 240).length / grey.length).toFixed(4), mean: +(grey.reduce((a, b) => a + b, 0) / grey.length).toFixed(1) }
  }, buf.toString('base64'))
}
const rows: any[] = []
for (const [mult, weight] of grid) {
  await p.evaluate(([m, w]) => { const t = (window as any).__moon.exposureTune; t.groundMult = m; t.groundWeight = w }, [mult, weight])
  for (const label of presets) {
    try { await p.locator(`.ground-panel button:visible:has-text("${label}")`).first().click({ timeout: 5000 }) } catch { console.log('press failed', label); continue }
    await p.waitForTimeout(7500)
    const ex = await p.evaluate(() => (window as any).__moon.exposureState?.())
    const st = await stats(path.join(OUT, `m${mult}_w${weight}_${label.replace(/\W+/g, '')}.png`))
    const row = { mult, weight, label, drawn: ex?.white, raw: ex?.rawWhite, anchor: ex?.anchor ? [+ex.anchor.white.toFixed(4), +ex.anchor.flatWhite.toFixed(4)] : null, ...st }
    rows.push(row); console.log(JSON.stringify(row))
  }
}
fs.writeFileSync(path.join(OUT, 'rows.json'), JSON.stringify(rows, null, 1))
await ctx.close(); await browser.close()
