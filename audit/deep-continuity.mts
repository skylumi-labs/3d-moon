/* eslint-disable @typescript-eslint/no-explicit-any */
// One continuous descent over a deeper-level block, at a dwell SHORTER than the 250 ms fade, so a tile that pops (appears at full strength)
// shows as a one-frame jump instead of finishing before the screenshot. Per frame: the picture and a block-wise change measure against the
// previous frame, with the streamer's arrivals, so a jump can be matched to the tile that caused it.
//   node --import tsx audit/deep-continuity.mts --out DIR [--lon 23.47 --lat 0.67 --t ISO --steps 40 --dwell 110 --d0 1.12 --d1 1.0745 --pitch 0]
import fs from 'node:fs'
import sharp from 'sharp'
import { launchBrowser, openPage } from './lib.mts'
const arg = (k: string, d: string): string => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d }
const out = arg('out', '.cont-out'), lon = Number(arg('lon', '23.47')), lat = Number(arg('lat', '0.67')), n = Number(arg('steps', '40')), dwell = Number(arg('dwell', '110'))
const d0 = Number(arg('d0', '1.12')), d1 = Number(arg('d1', '1.0745')), pitch0 = Number(arg('pitch', '0')), pitch1 = Number(arg('pitch1', arg('pitch', '0')))
fs.mkdirSync(out, { recursive: true })
const { browser } = await launchBrowser(false, false)
try {
  const p = await openPage(browser, arg('url', 'http://localhost:5190/moon/'), { w: 1280, h: 800, query: `debug=0&view=fly&lon=${lon}&lat=${lat}&dist=3&t=${arg('t', '2026-10-24T12:00:00Z')}&auto=0&start=earth`, skip: false })
  await p.waitForTimeout(3000)
  await p.waitForFunction(() => !!(window as any).__moon.tiles, null, { timeout: 60000 })
  await p.waitForTimeout(1500)
  await p.evaluate(([d]) => (window as any).__moon.setFloorDist(d - 0.005), [Math.min(d0, d1)])
  // Park above the block and let the coarse tiles settle, so the descent is the only thing that changes.
  await p.evaluate(([la, lo, di, pi]) => (window as any).__moon.setPose({ lon: lo, lat: la, dist: di, pitch: pi }), [lat, lon, d0, pitch0] as any)
  await p.waitForTimeout(7000)
  let prev: Buffer | null = null
  const rows: string[] = []
  let last = 0
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1)
    const d = d0 * Math.pow(d1 / d0, u), pi = pitch0 + (pitch1 - pitch0) * u
    await p.evaluate(([la, lo, di, pit]) => (window as any).__moon.setPose({ lon: lo, lat: la, dist: di, pitch: pit }), [lat, lon, d, pi] as any)
    await p.waitForTimeout(dwell)
    const buf = await p.screenshot({ type: 'png' })
    fs.writeFileSync(`${out}/c-${String(i).padStart(3, '0')}.png`, buf)
    const raw = await sharp(buf).resize(320, 200).greyscale().raw().toBuffer()
    const st = await p.evaluate(() => { const m = (window as any).__moon; const t = m.tiles; return t ? { dist: m.state().pose.dist, up: t.stats.uploads, res: t.resident, lv: [...t.residentLevels()].sort((a: any, b: any) => b[0] - a[0]).map((x: any) => x.join(':')).join(' ') } : null })
    let maxBlock = 0, mean = 0
    if (prev) {
      // 16 x 10 blocks of 20 px: the largest block-mean change, and the whole-picture mean.
      const W = 320, H = 200, B = 20
      for (let by = 0; by < H / B; by++) for (let bx = 0; bx < W / B; bx++) {
        let s = 0
        for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) { const k = (by * B + y) * W + bx * B + x; s += Math.abs(raw[k] - prev[k]) }
        maxBlock = Math.max(maxBlock, s / (B * B))
      }
      let s = 0; for (let k = 0; k < raw.length; k++) s += Math.abs(raw[k] - prev[k]); mean = s / raw.length
    }
    prev = raw
    rows.push(`${i} d=${d.toFixed(4)} got=${(st as any)?.dist?.toFixed(4)} mean=${mean.toFixed(2)} maxBlock=${maxBlock.toFixed(2)} uploads=${st?.up}(+${(st?.up ?? 0) - last}) ${st?.lv ?? ''}`)
    last = st?.up ?? 0
    console.log(rows[rows.length - 1])
  }
  const tiles = await p.evaluate(() => { const t = (window as any).__moon.tiles; return t ? { stats: t.stats, deepest: t.deepest, capacity: t.capacity, colourCapacity: t.colourCapacity, pageW: t.pageW, pageH: t.pageH } : null })
  console.log(JSON.stringify(tiles))
  fs.writeFileSync(`${out}/log.txt`, rows.join('\n') + '\n' + JSON.stringify(tiles) + '\n')
  const logs = (p as any).logs as string[]; if (logs?.length) console.log(logs.slice(0, 8))
} finally { await browser.close() }
