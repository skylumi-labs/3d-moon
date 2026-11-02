/* eslint-disable @typescript-eslint/no-explicit-any */
// Rendering-quality stills (moon-render): fixed poses, one browser, one page. Prints per-shot clipping stats on the Moon disc.
// Usage: node --import tsx audit/render-qa.mts --url http://localhost:5190/moon/ --out DIR --tag before [--shots a,b] [--size 1280x800]
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { launchBrowser, openPage } from './lib.mts'
const arg = (k: string, d: string): string => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d }
const url = arg('url', 'http://localhost:5190/moon/'), out = arg('out', '.render-out'), tag = arg('tag', 'run')
const [W, H] = arg('size', '1280x800').split('x').map(Number)
const only = arg('shots', '').split(',').filter(Boolean)
// Each shot: query for the page, then page-side setup run after load.
const SHOTS: Record<string, { query: string; js?: string; wait?: number; crop?: [number, number, number, number] }> = {
  term: { query: 'view=fly&lon=-83&lat=0&dist=1.3&t=2026-10-10T12:00:00Z&auto=0', crop: [440, 300, 400, 250] },
  term_wide: { query: 'view=fly&lon=-60&lat=10&dist=2.2&t=2026-10-10T12:00:00Z&auto=0' },
  full: { query: 'view=fly&lon=0&lat=0&dist=4.5&t=2026-10-10T12:00:00Z&auto=0', js: `__moon.setTime('2026-10-26T12:00:00Z'); __moon.setPose({lon:0,lat:0,dist:4.5})` },
  fullclose: { query: 'view=fly&lon=0&lat=0&dist=1.6&t=2026-10-10T12:00:00Z&auto=0', js: `__moon.setTime('2026-10-26T12:00:00Z'); __moon.setPose({lon:0,lat:10,dist:1.6})` },
  fullnoon: { query: 'view=fly&lon=0&lat=0&dist=1.4&t=2026-10-10T12:00:00Z&auto=0', js: `__moon.setTime('2026-10-10T12:00:00Z'); __moon.setPose({lon:-120,lat:10,dist:1.4})` },
  sunfacing: { query: 'view=fly&lon=0&lat=0&dist=4.5&t=2026-10-10T12:00:00Z&auto=0', js: `__moon.setTime('2026-10-18T00:00:00Z'); __moon.setPose({lon:90,lat:0,dist:2.5}); __moon.lookToward('sun', false)` },
  sun: { query: 'view=fly&lon=0&lat=0&dist=4.5&t=2026-10-10T12:00:00Z&auto=0', js: `__moon.setTime('2026-10-18T00:00:00Z'); __moon.setPose({lon:0,lat:0,dist:4.5}); __moon.lookToward('sun', false)`, crop: [340, 200, 600, 400] },
  sunq: { query: 'view=fly&lon=0&lat=0&dist=4.5&t=2026-10-10T12:00:00Z&auto=0', js: `__moon.setTime('2026-10-18T00:00:00Z'); __moon.setPose({lon:0,lat:0,dist:4.5}); __moon.lookToward('sun', false)` },
  home: { query: 'start=earth&auto=0&t=2026-10-10T12:00:00Z' },
}
fs.mkdirSync(out, { recursive: true })
const { browser } = await launchBrowser(false, false)
try {
  for (const [name, s] of Object.entries(SHOTS)) {
    if (only.length && !only.includes(name)) continue
    const p = await openPage(browser, url, { w: W, h: H, query: 'debug=0&' + s.query, skip: false })
    if (s.js) await p.evaluate(s.js)
    await p.waitForTimeout(s.wait ?? 6000)
    const st = await p.evaluate(() => (window as any).__moon.exposureState?.())
    const file = path.join(out, `${tag}-${name}.png`)
    fs.writeFileSync(file, await p.screenshot({ type: 'png' }))
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
    let clip = 0, bright = 0
    for (let i = 0; i < data.length; i += info.channels) { const g = Math.max(data[i], data[i + 1], data[i + 2]); if (g >= 250) clip++; if (g > 40) bright++ }
    console.log(JSON.stringify({ name, white: st?.white, clippedPct: +(100 * clip / (info.width * info.height)).toFixed(2), litPct: +(100 * bright / (info.width * info.height)).toFixed(2) }))
    if (s.crop) await sharp(file).extract({ left: s.crop[0], top: s.crop[1], width: s.crop[2], height: s.crop[3] }).resize(s.crop[2] * 2, s.crop[3] * 2, { kernel: 'lanczos3' }).toFile(path.join(out, `${tag}-${name}-crop.png`))
    await p.context().close()
  }
} finally { await browser.close() }
