/* eslint-disable @typescript-eslint/no-explicit-any */
// Gate: no Moon view may go to a white disc. Renders the views the owner hit (a lit far side reached by a drag from the dark side, the full Moon,
// the full Moon close, a lit limb at a quarter) and fails when more than MAX_CLIPPED_LIT_SHARE of the lit pixels sit at white.
// Usage: node --import tsx audit/clip-check.mts [--url http://localhost:5190/moon/] [--tag after] [--out DIR]
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { launchBrowser, openPage } from './lib.mts'
import { MAX_CLIPPED_LIT_SHARE, clippedLitShare } from './clip.mts'
const arg = (k: string, d: string): string => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d }
const url = arg('url', 'http://localhost:5190/moon/'), tag = arg('tag', 'run'), out = arg('out', '.clip-out')
const VIEWS: Array<{ name: string; t: string; pose: any; from?: any }> = [
  { name: 'far-side-after-drag', t: '2026-10-10T12:00:00Z', from: { lon: 0, lat: 0, dist: 3 }, pose: { lon: 180, lat: 0, dist: 3 } },
  { name: 'full-moon', t: '2026-10-26T12:00:00Z', pose: { lon: 0, lat: 0, dist: 4.5 } },
  { name: 'full-moon-close', t: '2026-10-26T12:00:00Z', pose: { lon: 0, lat: 10, dist: 1.6 } },
  { name: 'lit-limb-quarter', t: '2026-10-18T00:00:00Z', pose: { lon: 60, lat: 0, dist: 2.5 } },
  { name: 'full-moon-far', t: '2026-10-26T12:00:00Z', pose: { lon: 0, lat: 0, dist: 12 } },
  { name: 'quarter-far', t: '2026-10-18T00:00:00Z', pose: { lon: 0, lat: 0, dist: 12 } },
  { name: 'subsolar-close', t: '2026-10-10T12:00:00Z', pose: { lon: -120, lat: 10, dist: 1.4 } },
]
// Two viewports: a desktop window and a phone. Only the canvas is measured: the bar, captions and labels (white glyphs) are hidden first.
const PAGES: Array<{ label: string; w: number; h: number; mobile: boolean }> = [
  { label: 'desktop', w: 1280, h: 800, mobile: false },
  { label: 'phone', w: 390, h: 844, mobile: true },
]
fs.mkdirSync(out, { recursive: true })
const { browser } = await launchBrowser(false, false)
let failed = 0
try {
  for (const pg of PAGES) {
    const p = await openPage(browser, url, { w: pg.w, h: pg.h, mobile: pg.mobile, query: 'debug=0&view=fly&lon=0&lat=0&dist=4.5&t=2026-10-10T12:00:00Z&auto=0&start=earth', skip: false })
    await p.addStyleTag({ content: 'body *{visibility:hidden !important} canvas{visibility:visible !important}' })
    await p.waitForTimeout(5000)
    for (const v of VIEWS) {
      await p.evaluate(([t, pose, from]) => { const m = (window as any).__moon; m.setTime(t); m.setPose(from ?? pose) }, [v.t, v.pose, v.from ?? null] as any)
      await p.waitForTimeout(3500)
      if (v.from) await p.evaluate((pose) => (window as any).__moon.setPose(pose), v.pose)
      await p.waitForTimeout(4500)
      const file = path.join(out, `${tag}-${pg.label}-${v.name}.png`)
      fs.writeFileSync(file, await p.screenshot({ type: 'png' }))
      const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
      const r = clippedLitShare(data, info.channels)
      const bad = r.share > MAX_CLIPPED_LIT_SHARE
      if (bad) failed++
      console.log(`${bad ? 'FAIL' : 'ok  '} ${pg.label} ${v.name}: ${(100 * r.share).toFixed(1)}% of ${r.lit} lit px at white (limit ${100 * MAX_CLIPPED_LIT_SHARE}%)`)
    }
    await p.context().close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
