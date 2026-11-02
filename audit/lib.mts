// Browser launch, frame recorder and contact sheets for the virtual-user gate.
// Not part of the app or its typecheck: run with tsx.
import { chromium, type Browser, type Page } from 'playwright-core'
import sharp, { type OverlayOptions } from 'sharp'
import fs from 'node:fs'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { verifyServedIdentity, detectServedMode, manifestBodyPolicy, MANIFEST_BODY_CAP, type AuditIdentity, type ServedIdentity, type ServedMode } from './identity.mts'
import { describeBrowser, isSoftwareRenderer, chromeArgs } from './env.mts'
import { emptyDense, type DenseSeries } from './render.mts'
import path from 'node:path'
import { summarizeVisibility, type VisibilityEvidence } from './visibility.mts'
import type { VisibilityCalibration } from '../src/post/visibility.ts'

interface MoonApi {
  setVisibilityCalibration?(calibration: VisibilityCalibration | null): void
  build?: { commit: string; dirty: boolean }
  ready?: boolean; patch?: unknown; cuts?: unknown[]
  state?(): { time: string; mode: string; cam: { pos: number[]; right: number[]; up: number[]; back: number[]; tanHalf: number }; canvas?: number[] }
  exposureState?(): { rawWhite: number; white: number }
  journeyState?(): NonNullable<Frame['journey']>
  auditBegin?(opts?: { metadata?: boolean }): { frameId: number; width: number; height: number; metadataBase64: string; offscreen: boolean; limbApplicable: boolean; expectedNight: boolean; calibration: VisibilityCalibration | null; ground: boolean }
  auditEnd?(): void
  evidenceFrameId?(): number
}
type MoonWindow = Window & { __moon?: MoonApi }
type LoggedPage = Page & { logs: string[] }
let configuredCalibration: VisibilityCalibration | null = null
export function configureCalibration(calibration: VisibilityCalibration | null): void { configuredCalibration = calibration }
let expectedIdentity: AuditIdentity | null = null
export const observedManifests: Record<string, string> = {}
export const identityErrors: string[] = []
let verifiedBaselineSha256: string | null = null
export function configureBaseline(sha256: string | null): void { verifiedBaselineSha256 = sha256 }
export const servedBuilds: ServedIdentity[] = []
/** How the audited page was served (from its entry HTML), per page opened. The report prints it. */
export const servedModes = new Set<ServedMode>()
let captureFormat: 'png' | 'jpeg' = 'jpeg'
/** Screenshot format of the per-frame capture. A calibrated run needs lossless pixels for G8 and always uses png. */
export function configureCapture(format: 'png' | 'jpeg'): void { captureFormat = format }
export function configureIdentity(identity: AuditIdentity): void { expectedIdentity = identity }
export const CHROME = process.env.MOON_AUDIT_CHROME ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium')
export const W0 = 240
export const H0 = 150
/** Recording rate the gates are specified for (>= 8 fps; the achieved rate is reported per scenario, rates are normalised by dt). */
export const FPS_DEFAULT = 8

export interface Frame {
  n: number
  t: number
  mean: number
  p99: number
  black: number
  /** Fraction of pixels with grey > 220 (near-white; the plan's white-out frames have mean ~170, p99 236). */
  white: number
  /** Mean abs grey diff to the previous frame, whole picture. */
  diff: number
  /** Same, excluding the UI rectangles of both frames (the picture under the overlays). */
  diffWorld: number
  gray: Uint8Array
  file: string
  dom: Probe
  st: State | null
  patch: boolean
  /** Number of page-declared cuts so far (`__moon.cuts`; 0 on builds without the log). */
  cuts: number
  /** The exposure controller's raw and drawn white point (`__moon.exposureState`), or null on builds without it. */
  expo: { raw: number; white: number } | null
  visibility?: VisibilityEvidence
  journey?: { generation: number; id: string; status: string; arrivalAt: number | null; orbitAngleDeg?: number; durationS?: number } | null
}
export interface Probe {
  text: string
  hudLines: number
  cardVisible: boolean
  barRatio: number
  pressed: string
  sliderVisible: boolean
  sliderP: number
  progress: string | null
  rects: Array<[number, number, number, number]>
  /** Class of each rect (same order): tour-card, tour-row, journey-scrub, ridge-card, ... */
  rectNames: string[]
  vw: number
  vh: number
}
export interface State {
  time: string
  mode: string
  pos: number[]
  right: number[]
  up: number[]
  back: number[]
  tanHalf: number
  cw: number
  ch: number
}

export interface Launched {
  browser: Browser
  renderer: string
  /** "chromium 141.0.7390.37 (/usr/bin/google-chrome), headless, linux, ANGLE gl-egl": what actually ran. */
  mode: string
  softwareRenderer: boolean
}

/**
 * Starts Chromium. `gpu` asks for the hardware path (ANGLE over EGL/GLES) and REFUSES to continue on a software rasteriser, so a run that is
 * meant to measure a GPU cannot quietly measure SwiftShader. Extra flags: env MOON_AUDIT_CHROME_ARGS. Chrome binary: env MOON_AUDIT_CHROME.
 */
export async function launchBrowser(forceBundled = false, gpu = false): Promise<Launched> {
  let browser: Browser | null = null
  let executable: string | null = null
  const args = chromeArgs({ platform: process.platform, gpu, extra: process.env.MOON_AUDIT_CHROME_ARGS ?? '' })
  if (!forceBundled && fs.existsSync(CHROME)) {
    try { browser = await chromium.launch({ executablePath: CHROME, headless: true, args }); executable = CHROME } catch (e) { console.log('real Chrome failed, falling back:', String(e).slice(0, 120)) }
  }
  if (!browser) browser = await chromium.launch({ headless: true, args })
  const pg = await browser.newPage()
  const renderer = await pg.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext | null
    if (!gl) return 'no webgl2'
    const x = gl.getExtension('WEBGL_debug_renderer_info')
    return x ? String(gl.getParameter(x.UNMASKED_RENDERER_WEBGL)) : 'unknown'
  })
  await pg.close()
  if (renderer === 'no webgl2' || renderer === 'unknown') { await browser.close(); throw new Error('Renderer identity/WebGL2 unavailable') }
  const softwareRenderer = isSoftwareRenderer(renderer)
  if (gpu && softwareRenderer) { await browser.close(); throw new Error(`--gpu was given but the renderer is a software rasteriser (${renderer}). Check the GPU driver, libegl1/libgl1 and MOON_AUDIT_CHROME_ARGS.`) }
  const mode = describeBrowser({ name: browser.browserType().name(), version: browser.version(), executable, platform: process.platform, args })
  return { browser, renderer, mode, softwareRenderer }
}

/**
 * Injected before the page's scripts: one sample per requestAnimationFrame (not while the audit holds the render loop for a capture),
 * the audit's render-rate channel. Cheap reads only; every one guarded, so a build without an API just records NaN/0.
 */
const SAMPLER = `(() => {
  const fresh = () => ({ t: [], frames: [], white: [], cam: [], slider: [], jkey: [], cuts: [] })
  window.__auditDense = fresh()
  window.__auditHeld = false
  const code = (s) => { let h = 0; for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) % 16; return h }
  const tick = (now) => {
    const S = window.__auditDense, m = window.__moon
    if (!window.__auditHeld && m && m.ready) {
      let white = NaN, cam = 0, jkey = 0, cuts = 0
      try { cuts = m.cuts.length } catch (e) {}
      try { white = m.exposureState().white } catch (e) {}
      try { const s = m.state().cam; cam = s.pos[0] * 1.1 + s.pos[1] * 2.3 + s.pos[2] * 3.7 + s.back[0] * 5.1 + s.back[1] * 7.3 + s.back[2] * 11.7 + s.right[0] * 13.1 + s.up[1] * 17.3 + s.tanHalf * 1000 } catch (e) {}
      try { const j = m.journeyState(); jkey = (j.generation || 0) * 16 + code(j.status) } catch (e) {}
      const sl = document.querySelector('input.js-range')
      S.t.push(now); S.frames.push(m.frames || 0); S.white.push(white); S.cam.push(cam)
      S.slider.push(sl ? Number(sl.value) / 1000 : 0); S.jkey.push(jkey); S.cuts.push(cuts)
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})()`

export interface OpenOpts { w?: number; h?: number; mobile?: boolean; query?: string; skip?: boolean; route?: (p: Page) => Promise<void> }
export async function openPage(browser: Browser, base: string, o: OpenOpts = {}): Promise<Page> {
  const ctx = await browser.newContext(o.mobile
    ? { viewport: { width: o.w ?? 390, height: o.h ?? 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: o.w ?? 1440, height: o.h ?? 900 } })
  const p = await ctx.newPage()
  const manifestReads: Promise<void>[] = []
  let resolveMode: (m: ServedMode) => void = () => undefined
  const modeP = new Promise<ServedMode>((r) => { resolveMode = r })
  p.on('response', response => {
    const url = new URL(response.url())
    if (!/(^|\/)(manifest|haase-tier\.manifest)\.json$/.test(url.pathname) || !response.ok()) return
    const task = (async () => {
      // The Content-Length rule bounds the read BEFORE it happens. A Vite dev server sends none (chunked): a development run reads the body and
      // checks the cap after, a release run refuses and names the supported way (a built bundle through `npm run preview`).
      manifestBodyPolicy(response.headers(), { development: expectedIdentity?.development ?? true, mode: await modeP })
      const body = await response.body()
      if (body.byteLength > MANIFEST_BODY_CAP) throw new Error('Served manifest exceeds 4 MiB cap')
      url.search = ''; const key = url.toString(), sha = createHash('sha256').update(body).digest('hex')
      if (observedManifests[key] && observedManifests[key] !== sha) throw new Error('Served manifest changed during audit')
      observedManifests[key] = sha
    })().catch(error => { identityErrors.push(String(error)) })
    manifestReads.push(task)
  })
  ;(p as LoggedPage).logs = []
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) (p as LoggedPage).logs.push(m.type() + ': ' + m.text().slice(0, 200)) })
  p.on('pageerror', (e) => (p as LoggedPage).logs.push('PAGEERR ' + e.message))
  // tsx/esbuild wraps named functions in __name(); the page has no such helper.
  await p.addInitScript('window.__name = (f) => f')
  await p.addInitScript(SAMPLER)
  if (o.route) await o.route(p)
  const sep = base.includes('?') ? '&' : '?'
  const url = `${base}${sep}cb=${Date.now()}${o.query ? '&' + o.query : ''}`
  try {
    for (let k = 0; k < 3; k++) { try { await p.goto(url, { timeout: 60000 }); break } catch (e) { if (k === 2) throw e; await p.waitForTimeout(3000) } }
    const served = detectServedMode(await p.evaluate(() => document.documentElement.outerHTML))
    servedModes.add(served)
    resolveMode(served)
  } finally { resolveMode('unknown') }
  await p.waitForFunction(() => (window as MoonWindow).__moon?.ready === true, null, { timeout: 90000 })
  await p.waitForTimeout(3000)
  if (o.skip !== false) {
    const sk = p.locator('button:has-text("Skip the lift-off")').first()
    if (await sk.isVisible().catch(() => false)) { await sk.click({ timeout: 4000 }); await p.waitForTimeout(5000) }
  }
  if (configuredCalibration) await p.evaluate(calibration => { const m = (window as MoonWindow).__moon; if (!m?.setVisibilityCalibration) throw new Error('Calibration API unavailable'); m.setVisibilityCalibration(calibration) }, configuredCalibration)
  await Promise.all(manifestReads)
  if (expectedIdentity) {
    const build = await p.evaluate(() => (window as MoonWindow).__moon?.build)
    if (!build && !expectedIdentity.development) throw new Error('Served build identity API missing')
    const src = await p.locator('script[type=module][src]').first().getAttribute('src')
    if (!src) throw new Error('Served entry bundle missing')
    const response = await p.request.get(new URL(src, p.url()).toString())
    if (!response.ok()) throw new Error('Cannot read served entry bundle')
    const body = await response.body()
    if (body.byteLength > 8 * 1024 * 1024) throw new Error('Entry bundle exceeds8MiB audit cap')
    const actual = { commit: build?.commit ?? 'unknown', dirty: build?.dirty ?? true, bundleSha256: createHash('sha256').update(body).digest('hex') }
    verifyServedIdentity(expectedIdentity, actual)
    servedBuilds.push(actual)
  }
  return p
}

const PROBE = () => {
  const vw = innerWidth, vh = innerHeight
  const vis = (e: Element | null): boolean => {
    if (!e) return false
    if ((e as HTMLElement).hidden) return false
    const r = e.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    let o = 1; let n: Element | null = e
    while (n && n !== document.body) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; o *= parseFloat(cs.opacity); n = n.parentElement }
    return o > 0.05
  }
  const texts: string[] = []
  for (const e of document.querySelectorAll('#ui *, #hud *')) {
    if (e.children.length || !(e as HTMLElement).innerText?.trim()) continue
    if (e.closest('#credit,.tour-row,.site-tools,[hidden]') || e.classList.contains('js-read') || e.classList.contains('js-label')) continue
    if (!vis(e)) continue
    texts.push((e as HTMLElement).innerText.trim().replace(/\s+/g, ' '))
  }
  const hud = document.getElementById('hud')
  let hudLines = 0
  if (hud && vis(hud)) for (const c of Array.from(hud.children)) if ((c as HTMLElement).innerText?.trim() && vis(c)) hudLines++
  const card = document.querySelector('.tour-card')
  const cardVisible = vis(card)
  let barRatio = 1
  const bar = document.querySelector('.tour-bar'); const fill = bar?.querySelector('i')
  if (bar && fill && vis(bar)) { const bw = bar.getBoundingClientRect().width; barRatio = bw ? fill.getBoundingClientRect().width / bw : 1 }
  const pressed = document.querySelector('.chip[aria-pressed="true"]')?.getAttribute('data-id') ?? ''
  const sl = document.querySelector('input.js-range') as HTMLInputElement | null
  const sliderVisible = vis(sl)
  const sliderP = sl ? (Number(sl.value) - Number(sl.min || 0)) / Math.max(1e-9, Number(sl.max || 1) - Number(sl.min || 0)) : 0
  const pe = document.querySelector('.tour-progress')
  const progress = pe && vis(pe) ? (pe as HTMLElement).innerText.trim() : null
  const rects: Array<[number, number, number, number]> = []
  const rectNames: string[] = []
  for (const e of document.querySelectorAll('.tour-card,.tour-row,.site-tools,.site-panel,.journey-scrub,.ridge-card,.flight-panel,.ground-panel,#hud,#credit')) {
    if (!vis(e)) continue
    const r = e.getBoundingClientRect(); rects.push([r.left / vw, r.top / vh, r.width / vw, r.height / vh]); rectNames.push((e as HTMLElement).id || e.className.toString().split(' ')[0])
  }
  const m = (window as MoonWindow).__moon
  let st: State | null = null
  try { const s = m?.state?.(); if (s) st = { time: s.time, mode: s.mode, pos: s.cam.pos, right: s.cam.right, up: s.cam.up, back: s.cam.back, tanHalf: s.cam.tanHalf, cw: s.canvas?.[0] ?? 0, ch: s.canvas?.[1] ?? 0 } } catch { /* */ }
  let cuts = 0
  try { cuts = (m?.cuts as unknown[] | undefined)?.length ?? 0 } catch { /* */ }
  let expo: { raw: number; white: number } | null = null
  try { const x = m?.exposureState?.(); if (x && Number.isFinite(x.rawWhite) && Number.isFinite(x.white)) expo = { raw: x.rawWhite, white: x.white } } catch { /* */ }
  return { cuts, expo, journey: m?.journeyState?.() ?? null, dom: { text: texts.join(' | ').slice(0, 400), hudLines, cardVisible, barRatio, pressed, sliderVisible, sliderP, progress, rects, rectNames, vw, vh }, st, patch: !!m?.patch }
}

export function recorder(p: Page, dir: string) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
  const frames: Frame[] = []
  const marks: Array<{ t: number; name: string }> = []
  /** The page's render-rate samples (one per requestAnimationFrame outside capture holds), on this recorder's clock. */
  const dense: DenseSeries = emptyDense()
  const t0 = Date.now()
  const now = () => (Date.now() - t0) / 1000
  const maskOf = (rects: Probe['rects']) => {
    const m = new Uint8Array(W0 * H0)
    for (const [x, y, w, h] of rects) for (let j = Math.max(0, Math.floor(y * H0)); j < Math.min(H0, Math.ceil((y + h) * H0)); j++) for (let i = Math.max(0, Math.floor(x * W0)); i < Math.min(W0, Math.ceil((x + w) * W0)); i++) m[j * W0 + i] = 1
    return m
  }
  let prevMask: Uint8Array | null = null
  /** Moves the page's samples into `dense`, mapping the page clock onto this recorder's (error: half a round trip). */
  async function drain(): Promise<void> {
    const r = await p.evaluate(() => {
      const w = window as Window & { __auditDense?: Record<string, number[]> }
      const S = w.__auditDense
      w.__auditDense = { t: [], frames: [], white: [], cam: [], slider: [], jkey: [], cuts: [] }
      return { S: S ?? null, pageNow: performance.now() }
    }).catch(() => null)
    if (!r?.S) return
    const at = now(), S = r.S
    for (let i = 0; i < S.t.length; i++) {
      if (at - (r.pageNow - S.t[i]) / 1000 < 0) continue // before this recorder started (page load, the lift-off skip)
      dense.t.push(+(at - (r.pageNow - S.t[i]) / 1000).toFixed(4)); dense.frames.push(S.frames[i]); dense.white.push(S.white[i])
      dense.cam.push(S.cam[i]); dense.slider.push(S.slider[i]); dense.jkey.push(S.jkey[i]); dense.cuts.push(S.cuts[i])
    }
  }
  async function cap(sec: number, fps = FPS_DEFAULT): Promise<void> {
    const end = Date.now() + sec * 1000
    const withMetadata = !!configuredCalibration
    while (Date.now() < end) {
      const ts = Date.now()
      const holdStart = now()
      const snapshot = await p.evaluate((wantMetadata) => {
        const m = (window as MoonWindow).__moon
        if (!m?.auditBegin) throw new Error('Required independent Moon metadata API missing')
        ;(window as Window & { __auditHeld?: boolean }).__auditHeld = true
        try { return m.auditBegin({ metadata: wantMetadata }) } catch (e) { (window as Window & { __auditHeld?: boolean }).__auditHeld = false; throw e }
      }, withMetadata)
      // The frame is frozen from here: this is its time, not the time the screenshot finished.
      const tFrame = +now().toFixed(2)
      let buf: Buffer, probe: ReturnType<typeof PROBE>
      try {
        probe = await p.evaluate(PROBE)
        buf = await p.screenshot(captureFormat === 'png' || withMetadata ? { type: 'png', timeout: 30000 } : { type: 'jpeg', quality: 85, timeout: 30000 })
        const frameId = await p.evaluate(() => (window as MoonWindow).__moon?.evidenceFrameId?.())
        if (frameId !== snapshot.frameId) throw new Error('Pixel/metadata frame identity changed during capture')
      } finally {
        await p.evaluate(() => { (window as Window & { __auditHeld?: boolean }).__auditHeld = false; (window as MoonWindow).__moon?.auditEnd?.() })
        dense.held.push([holdStart, +now().toFixed(4)])
      }
      if (!probe.st || !probe.expo) throw new Error('Required camera/exposure telemetry missing')
      const { metadataBase64, ...snap } = snapshot
      let visibility: VisibilityEvidence
      if (withMetadata) {
        const native = await sharp(buf).resize(snapshot.width, snapshot.height, { fit: 'fill' }).greyscale().raw().toBuffer()
        visibility = { ...snap, metadata: new Uint8Array(Buffer.from(metadataBase64, 'base64')),
          gray: new Uint8Array(native), bundleSha256: servedBuilds.at(-1)?.bundleSha256 ?? 'unknown', baselineEarthshineSha256: verifiedBaselineSha256, baselineVerified: !!verifiedBaselineSha256, excludes: probe.dom.rects, offscreen: snapshot.offscreen, skewMs: 0 }
        const evidenceFile = path.join(dir, `f${String(frames.length).padStart(4, '0')}.mask.gz`)
        await fs.promises.writeFile(evidenceFile, gzipSync(visibility.metadata, { level: 1 }))
        const metrics = summarizeVisibility(visibility)
        Object.assign(visibility, { metrics, metadataFile: evidenceFile, metadataSha256: createHash('sha256').update(fs.readFileSync(evidenceFile)).digest('hex') })
      } else {
        // No calibration: G8 can only answer "pending", which needs no native pixels. Evidence without bulk arrays keeps the capture fast and small.
        visibility = { ...snap, metadata: new Uint8Array(0), gray: new Uint8Array(0), bundleSha256: servedBuilds.at(-1)?.bundleSha256 ?? 'unknown', baselineEarthshineSha256: null, baselineVerified: false, excludes: probe.dom.rects, offscreen: snapshot.offscreen, skewMs: 0 }
      }
      const { data } = await sharp(buf).resize(W0, H0, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true })
      const n = frames.length
      const file = path.join(dir, `f${String(n).padStart(4, '0')}.${captureFormat === 'png' || withMetadata ? 'png' : 'jpg'}`)
      await fs.promises.writeFile(file, buf)
      let s = 0, bl = 0, wh = 0; const h = new Array(256).fill(0)
      for (const v of data) { s += v; h[v]++; if (v < 4) bl++; if (v > 220) wh++ }
      const N = data.length; let c = 0, p99 = 0
      for (let i = 0; i < 256; i++) { c += h[i]; if (c >= N * 0.99) { p99 = i; break } }
      let diff = 0, dw = 0, nw = 0
      const mask = maskOf(probe.dom.rects)
      if (frames.length) {
        const pr = frames[frames.length - 1].gray
        for (let i = 0; i < N; i++) { const d = Math.abs(pr[i] - data[i]); diff += d; if (!mask[i] && !(prevMask && prevMask[i])) { dw += d; nw++ } }
        diff /= N; dw = nw ? dw / nw : 0
      }
      prevMask = mask
      frames.push({ n, t: tFrame, mean: +(s / N).toFixed(1), p99, black: +(bl / N).toFixed(3), white: +(wh / N).toFixed(3), diff: +diff.toFixed(2), diffWorld: +dw.toFixed(2), gray: new Uint8Array(data), file, dom: probe.dom, st: probe.st, patch: probe.patch, cuts: probe.cuts, expo: probe.expo, visibility, journey: probe.journey })
      await drain()
      const el = Date.now() - ts
      if (el < 1000 / fps) await p.waitForTimeout(1000 / fps - el)
    }
  }
  return { frames, marks, dense, cap, drain, mark: (name: string) => marks.push({ t: +now().toFixed(2), name }), now }
}

export async function contactSheet(frames: Frame[], out: string): Promise<void> {
  if (!frames.length) return
  const K = Math.min(24, frames.length)
  const pick: Frame[] = []
  for (let i = 0; i < K; i++) pick.push(frames[Math.floor((i * (frames.length - 1)) / Math.max(1, K - 1))])
  const cols = 4, tw = 300, th = 188, rows = Math.ceil(pick.length / cols)
  const comps: OverlayOptions[] = []
  for (let i = 0; i < pick.length; i++) {
    const img = await sharp(pick[i].file).resize(tw, th, { fit: 'fill' }).toBuffer()
    const lbl = Buffer.from(`<svg width="${tw}" height="16"><rect width="100%" height="100%" fill="black" opacity=".7"/><text x="4" y="12" font-size="11" fill="yellow">t=${pick[i].t}s mean=${pick[i].mean} ${pick[i].dom.pressed}</text></svg>`)
    const left = (i % cols) * tw, top = Math.floor(i / cols) * th
    comps.push({ input: img, left, top }, { input: lbl, left, top })
  }
  await sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: '#222' } }).composite(comps).jpeg({ quality: 70 }).toFile(out)
}
