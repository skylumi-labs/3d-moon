/* eslint-disable @typescript-eslint/no-explicit-any */
// Fly-in over a deeper-level block: frames at a steady camera glide, plus a per-frame change measure (pop-in shows as a spike).
// node --import tsx audit/deep-fly.mts --out DIR --lon 23.47 --lat 0.67 --t 2026-10-24T12:00:00Z [--frames 12]
import fs from 'node:fs'
import sharp from 'sharp'
import { launchBrowser, openPage } from './lib.mts'
const arg = (k: string, d: string): string => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d }
const out = arg('out', '.fly-out'), lon = Number(arg('lon', '23.47')), lat = Number(arg('lat', '0.67')), n = Number(arg('frames', '12'))
fs.mkdirSync(out, { recursive: true })
const { browser } = await launchBrowser(false, false)
try {
  const p = await openPage(browser, arg('url', 'http://localhost:5190/moon/'), { w: 1280, h: 800, query: `debug=0&view=fly&lon=${lon}&lat=${lat}&dist=3&t=${arg('t', '2026-10-24T12:00:00Z')}&auto=0&start=earth`, skip: false })
  await p.waitForTimeout(4000)
  const d0 = Number(arg('d0', '1.3')), d1 = Number(arg('d1', '1.0'))
  let prev: Buffer | null = null
  const diffs: number[] = []
  for (let i = 0; i < n; i++) {
    const d = d0 * Math.pow(d1 / d0, i / (n - 1))
    await p.evaluate(([la, lo, di]) => (window as any).__moon.setPose({ lon: lo, lat: la, dist: di, pitch: 0 }), [lat, lon, d] as any)
    await p.waitForTimeout(i === 0 ? 9000 : 1800)
    const buf = await p.screenshot({ type: 'png' })
    fs.writeFileSync(`${out}/fly-${String(i).padStart(2, '0')}.png`, buf)
    const raw = await sharp(buf).resize(160, 100).greyscale().raw().toBuffer()
    if (prev) { let s = 0; for (let k = 0; k < raw.length; k++) s += Math.abs(raw[k] - prev[k]); diffs.push(+(s / raw.length).toFixed(2)) }
    prev = raw
    const st = await p.evaluate(() => (window as any).__moon.state()?.pose.dist)
    console.log(i, 'asked', d.toFixed(4), 'dist', Number(st).toFixed(4), diffs[diffs.length - 1] ?? '')
  }
  const logs = (p as any).logs as string[]; if (logs?.length) console.log(logs.slice(0, 5))
} finally { await browser.close() }
