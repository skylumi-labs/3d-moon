/* eslint-disable @typescript-eslint/no-explicit-any -- page-side probes read untyped window globals (__moon, __fl) */
// Limb / terminator flicker recorder (MOON-UX-REDESIGN section 1 determination test, section 5.1 acceptance).
// Drags the Moon for a fixed time at a fixed view and measures, per rendered frame, what the canvas drew:
//   limb   per-pixel temporal std along a 6 px ring at the limb, and the mean second difference (high-frequency change; smooth motion cancels)
//   disc   whole-disc mean grey: range over the run, and the largest frame-to-frame step
//   term   share of terminator-band pixels whose second difference exceeds 60/255
// Usage: node --import tsx audit/flicker.mts --url http://localhost:5190/moon/ --label base [--extra "still=1"] [--setup "__moon.setMarch(0)"]
//        [--size 1440x900] [--secs 10] [--phase full|quarter] [--out dir]
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { chromeArgs } from './env.mts'
import { CHROME } from './lib.mts'

const arg = (k: string, d: string): string => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d }
const url = arg('url', 'http://localhost:5190/moon/')
const label = arg('label', 'run')
const extra = arg('extra', '')
const setup = arg('setup', '')
const [VW, VH] = arg('size', '1440x900').split('x').map(Number)
const secs = Number(arg('secs', '10'))
const phase = arg('phase', 'quarter')
const dpr = Number(arg('dpr', '1'))
/** Drag amplitude, CSS px (3.5 x 30 deg / 600 px = 0.175 deg per px at the 4.5 radii view). */
const amp = Number(arg('amp', '60'))
const out = arg('out', '.flicker-out')
const when = arg('t', '2026-10-10T12:00:00Z')

const targetAngle = phase === 'full' ? 12 : 90

const PAGE = `
(() => {
  const w = window
  w.__name = (f) => f
  w.__fl = { frames: [], on: false, last: -1, W: 0, H: 0, R: 0, cx: 0, cy: 0 }
  const c2 = document.createElement('canvas'); const x2 = c2.getContext('2d', { willReadFrequently: true })
  const orig = w.requestAnimationFrame.bind(w)
  w.requestAnimationFrame = (cb) => orig((t) => {
    cb(t)
    const fl = w.__fl
    if (!fl.on) return
    const id = w.__moon.evidenceFrameId()
    if (id === fl.last) return
    fl.last = id
    const cv = document.getElementById('c')
    if (c2.width !== cv.width) { c2.width = cv.width; c2.height = cv.height }
    x2.drawImage(cv, 0, 0)
    const f = { t: performance.now(), data: null }
    const st = w.__moon.state()
    f.scale = st ? st.target[0] / st.canvas[0] : 0
    f.white = w.__moon.exposureState().white
    fl.frames.push(f)
    if (fl.R > 0) {
      const x0 = Math.max(0, Math.floor(fl.cx - fl.R - 8)), y0 = Math.max(0, Math.floor(fl.cy - fl.R - 8))
      const x1 = Math.min(cv.width, Math.ceil(fl.cx + fl.R + 8)), y1 = Math.min(cv.height, Math.ceil(fl.cy + fl.R + 8))
      const im = x2.getImageData(x0, y0, x1 - x0, y1 - y0)
      const g = new Uint8Array((x1 - x0) * (y1 - y0))
      for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (im.data[j] * 0.2126 + im.data[j + 1] * 0.7152 + im.data[j + 2] * 0.0722) | 0
      f.data = g; fl.box = [x0, y0, x1 - x0, y1 - y0]
    } else {
      const im = x2.getImageData(0, 0, cv.width, cv.height)
      f.full = im.data
    }
  })
})()
`


const run = async (): Promise<void> => {
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: chromeArgs({ platform: process.platform, gpu: false, extra: '' }) })
  try {
    const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: dpr })
    await ctx.addInitScript(PAGE)
    const page = await ctx.newPage()
    const logs: string[] = []
    page.on('pageerror', (e) => logs.push(String(e)))
    const q = `view=fly&lon=0&lat=0&dist=4.5&t=${encodeURIComponent(when)}&auto=0&start=earth&debug=0${extra ? '&' + extra : ''}`
    await page.goto(`${url}?${q}`)
    await page.waitForFunction(() => (window as any).__moon?.ready === true, null, { timeout: 120000 })
    await page.waitForTimeout(4000)
    // find the camera longitude whose phase angle (camera-Moon-Sun) is the target.
    const lon = await page.evaluate(async ({ target }) => {
      const m = (window as any).__moon
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const ang = (a: number[], b: number[]) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(a[0], a[1], a[2]) * Math.hypot(b[0], b[1], b[2]))))) * 180 / Math.PI
      let best = 0, bd = 1e9
      for (let L = -180; L < 180; L += 6) {
        m.setPose({ lon: L, lat: 0, dist: 4.5 }); await frame(); await frame()
        const s = m.state(); const d = Math.abs(ang(s.cam.pos, s.sunDir) - target)
        if (d < bd) { bd = d; best = L }
      }
      for (let L = best - 6; L <= best + 6; L += 1) {
        m.setPose({ lon: L, lat: 0, dist: 4.5 }); await frame(); await frame()
        const s = m.state(); const d = Math.abs(ang(s.cam.pos, s.sunDir) - target)
        if (d < bd) { bd = d; best = L }
      }
      m.setPose({ lon: best, lat: 0, dist: 4.5 }); await frame(); await frame()
      return { best, bd }
    }, { target: targetAngle })
    if (setup) await page.evaluate(setup)
    await page.waitForTimeout(3000)
    // settle at full resolution, then find the disc.
    const still = await page.screenshot({ type: 'png' })
    fs.writeFileSync(path.join(out, `${label}-still.png`), still)
    const geo = await page.evaluate(async () => {
      const m = (window as any).__moon
      await new Promise((r) => setTimeout(r, 1500))
      const fl = (window as any).__fl
      fl.on = true; fl.last = -1
      m.setPose({}); // markMoved through setPose
      await new Promise((r) => setTimeout(r, 400))
      fl.on = false
      const f = fl.frames.at(-1)
      const cv = document.getElementById('c') as HTMLCanvasElement
      const im = f.full
      const W = cv.width, H = cv.height
      // disc: grey > 6 anywhere (night side is ~0); fit radius from the lit extent along the row/col extremes via the camera's own projection instead.
      const s = m.state()
      const th = s.cam.tanHalf
      const dist = Math.hypot(s.cam.pos[0], s.cam.pos[1], s.cam.pos[2])
      const R = (H / 2) * (1 / Math.sqrt(dist * dist - 1)) / th
      fl.frames.length = 0
      fl.W = W; fl.H = H; fl.R = R; fl.cx = W / 2; fl.cy = H / 2
      return { W, H, R, canvasW: cv.width, aimOk: im.length > 0 }
    })
    // the drag
    await page.evaluate(() => { const fl = (window as any).__fl; fl.frames.length = 0; fl.last = -1; fl.on = true })
    const t0 = Date.now()
    const cx = VW / 2, cy = VH / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    let x = cx
    while ((Date.now() - t0) / 1000 < secs) {
      const t = (Date.now() - t0) / 1000
      x = cx + amp * Math.sin(2 * Math.PI * t / 6)
      await page.mouse.move(x, cy + amp / 6 * Math.sin(2 * Math.PI * t / 4))
      await page.waitForTimeout(8)
    }
    await page.mouse.up()
    await page.evaluate(() => { (window as any).__fl.on = false })
    const stats = await page.evaluate(({ canvasR }) => {
      const fl = (window as any).__fl
      const fr: Array<{ t: number; data: Uint8Array; scale: number; white: number }> = fl.frames.filter((f: any) => f.data)
      const [bx, by, bw, bh] = fl.box
      const R = fl.R, cx = fl.cx - bx, cy = fl.cy - by
      const ring: number[] = [], inner: number[] = []
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        const i = y * bw + x
        if (Math.abs(r - (R - 3)) <= 3) ring.push(i)
        if (r < R * 0.9) inner.push(i)
      }
      // Frames from the gesture only: at-rest frames (refine, the lead-in) are on another grid by design. A still run has none to drop.
      const moving = fr.filter((f) => f.scale < 0.999)
      if (moving.length > 20) { fr.length = 0; fr.push(...moving) }
      const n = fr.length
      // Limb profile: per angle, the radius where the profile falls to half the plateau 2.5 px inside, and the 20-80% width. The disc stays put on screen while the
      // camera orbits it, so ANY temporal change of these is the renderer's, not the picture's.
      const samp = (g: Uint8Array, x: number, y: number): number => {
        const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi
        const a = g[yi * bw + xi], b = g[yi * bw + xi + 1], c = g[(yi + 1) * bw + xi], d = g[(yi + 1) * bw + xi + 1]
        return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
      }
      const NA = 360
      const r50: number[][] = [], wid: number[][] = []
      const okAng: boolean[] = new Array(NA).fill(true)
      for (const f of fr) {
        const r5: number[] = new Array(NA).fill(NaN), w5: number[] = new Array(NA).fill(NaN)
        for (let a = 0; a < NA; a++) {
          const th = (a + 0.5) / NA * 2 * Math.PI, ct = Math.cos(th), st = Math.sin(th)
          const v = (r: number) => samp(f.data, cx + ct * r, cy + st * r)
          const P = v(R - 2.5)
          if (P < 25) { okAng[a] = false; continue }
          let rA = NaN, rB = NaN, rC = NaN
          for (let r = R - 3; r <= R + 4; r += 0.1) {
            const y = v(r) / P
            if (isNaN(rA) && y < 0.8) rA = r
            if (isNaN(rB) && y < 0.5) rB = r
            if (isNaN(rC) && y < 0.2) { rC = r; break }
          }
          r5[a] = rB; w5[a] = rC - rA
        }
        r50.push(r5); wid.push(w5)
      }
      let jit = 0, jitN = 0, d2r = 0, d2rN = 0
      const wmeans: number[] = []
      for (let a = 0; a < NA; a++) {
        if (!okAng[a]) continue
        let m = 0, k = 0
        for (let i = 0; i < n; i++) { const v = r50[i][a]; if (!isNaN(v)) { m += v; k++ } }
        if (k < n * 0.8) continue
        m /= k
        let v2 = 0; for (let i = 0; i < n; i++) { const v = r50[i][a]; if (!isNaN(v)) v2 += (v - m) ** 2 }
        jit += Math.sqrt(v2 / k); jitN++
        for (let i = 1; i < n - 1; i++) { const x0 = r50[i - 1][a], x1 = r50[i][a], x2 = r50[i + 1][a]; if (!isNaN(x0 + x1 + x2)) { d2r += Math.abs(x1 - (x0 + x2) / 2); d2rN++ } }
      }
      for (let i = 0; i < n; i++) { let m = 0, k = 0; for (let a = 0; a < NA; a++) if (okAng[a] && !isNaN(wid[i][a])) { m += wid[i][a]; k++ } wmeans.push(k ? m / k : NaN) }
      const wm = wmeans.reduce((a, b) => a + b, 0) / n
      const wStd = Math.sqrt(wmeans.reduce((a, b) => a + (b - wm) ** 2, 0) / n)
      // limb: per-pixel temporal std over the ring, averaged over ring pixels that are lit at the limb (mean > 10)
      let stdSum = 0, stdN = 0, d2Sum = 0, d2N = 0
      for (const i of ring) {
        let m = 0; for (const f of fr) m += f.data[i]; m /= n
        if (m < 10) continue
        let v = 0; for (const f of fr) v += (f.data[i] - m) ** 2
        stdSum += Math.sqrt(v / n); stdN++
        for (let k = 1; k < n - 1; k++) { d2Sum += Math.abs(fr[k].data[i] - (fr[k - 1].data[i] + fr[k + 1].data[i]) / 2); d2N++ }
      }
      // disc mean
      const means = fr.map((f) => { let s = 0; for (const i of inner) s += f.data[i]; return s / inner.length })
      const mm = means.reduce((a, b) => a + b, 0) / n
      let steps = 0; for (let k = 1; k < n; k++) steps = Math.max(steps, Math.abs(means[k] - means[k - 1]) / mm)
      // terminator band: pixels inside the disc whose temporal mean is 5..80
      let bandN = 0, flips = 0, tot = 0
      for (const i of inner) {
        let m = 0; for (const f of fr) m += f.data[i]; m /= n
        if (m < 5 || m > 80) continue
        bandN++
        for (let k = 1; k < n - 1; k++) { tot++; if (Math.abs(fr[k].data[i] - (fr[k - 1].data[i] + fr[k + 1].data[i]) / 2) > 60) flips++ }
      }
      const ts = fr.map((f) => f.t)
      const fps = (n - 1) / ((ts[n - 1] - ts[0]) / 1000)
      const scales = [...new Set(fr.map((f) => +f.scale.toFixed(3)))]
      const whites = fr.map((f) => f.white)
      return {
        limbR50JitterPx: jit / jitN, limbR50D2Px: d2r / d2rN, limbWidthMeanPx: wm, limbWidthStdPx: wStd, limbWidthMinMax: [Math.min(...wmeans), Math.max(...wmeans)], frames: n, fps, scales, ringPx: stdN, limbStd: stdSum / stdN, limbD2: d2Sum / d2N, discMeanRangePct: (Math.max(...means) - Math.min(...means)) / mm * 100,
        discMaxStepPct: steps * 100, bandPx: bandN, bandFlipPct: tot ? flips / tot * 100 : 0,
        whiteMin: Math.min(...whites), whiteMax: Math.max(...whites), canvasR,
      }
    }, { canvasR: geo.R })
    const res = { label, extra, setup, size: `${VW}x${VH}`, dpr, phase, lon, geo, stats, logs }
    fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify(res, null, 1))
    console.log(JSON.stringify(res))
  } finally {
    await browser.close()
  }
}
run().catch((e) => { console.error(e); process.exit(1) })
