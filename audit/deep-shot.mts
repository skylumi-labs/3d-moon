/* eslint-disable @typescript-eslint/no-explicit-any */
// Oblique crater shot for the deeper-level path. node --import tsx audit/deep-shot.mts --out FILE [--url ...]
import fs from 'node:fs'
import { launchBrowser, openPage } from './lib.mts'
const arg = (k: string, d: string): string => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d }
const { browser } = await launchBrowser(false, false)
try {
  const p = await openPage(browser, arg('url', 'http://localhost:5190/moon/'), { w: 1280, h: 800, query: 'debug=0&view=fly&lon=' + arg('lon','-20.08') + '&lat=' + arg('lat','9.62') + '&dist=3&t=' + arg('t','2026-10-20T20:00:00Z') + '&auto=0&start=earth', skip: false })
  await p.waitForTimeout(5000)
  await p.evaluate(([LON, LAT, PITCH]) => { const m = (window as any).__moon; m.setPose({ lon: LON, lat: LAT, dist: 1.0, pitch: PITCH }) }, [Number(arg('lon', '-20.08')), Number(arg('lat', '9.62')), Number(arg('pitch', '0'))])
  await p.waitForTimeout(14000)
  console.log(JSON.stringify(await p.evaluate(() => { const s = (window as any).__moon.state(); return { pose: s.pose, mode: s.mode } })))
  const logs = (p as any).logs as string[]; if (logs?.length) console.log(logs.slice(0, 5))
  fs.writeFileSync(arg('out', 'deep.png'), await p.screenshot({ type: 'png' }))
} finally { await browser.close() }
