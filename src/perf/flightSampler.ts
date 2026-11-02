/**
 * ?sampler=1: a frame recorder the owner runs in their own Chrome (the M5 cannot be measured on the GPU rig).
 * Imported lazily by main.ts only when `sampler=1` is in the URL. Nothing here runs at import time: no listener, timer,
 * observer or allocation exists until Record is pressed. Nothing is sent anywhere; the JSON is written only when the owner
 * clicks Save (Blob + a[download]). The file matches what the GPU rig's flight runs write, so
 * `node scripts/wp14-summary.mjs <file|dir> [drag|flights|auto]` reads it unchanged.
 */

/** [rAF timestamp, performance.now() in the post-draw task, __moon.frames, camera pos of the last drawn frame or null]. */
export type SampleRow = [number, number, number, number[] | null]
export interface PollRow { t: number; fr: number; [k: string]: unknown }
export interface SampleData { s: SampleRow[]; moves: Array<[number, number]>; polls: PollRow[]; lt: Array<[number, number]> }
export interface SampleFile {
  arm: string; moment: string; mode: 'drag' | 'flights'; viewport: [number, number, number]
  started: number | null; ended: number | null; wallMs: number
  data: SampleData
  gpu: { renderer: string | null; vendor: string | null }
  ua: string; dpr: number; displayHz: number | null; rateMix: Record<string, number>; replayDrag: boolean; note: string
}

/* The estimators live in frameStats.ts so the sampler and the production telemetry share one implementation. */
export { HZ_STEPS, quantile, estimateDisplayHz, rateMix } from './frameStats'
import { estimateDisplayHz, rateMix } from './frameStats'

/** rAF intervals (ms) of a sample list. */
export function rafIntervals(s: readonly SampleRow[]): number[] {
  const out: number[] = []
  for (let i = 1; i < s.length; i++) out.push(s[i]![0] - s[i - 1]![0])
  return out
}

/** Synthetic drag x offset (px) at t ms: the WP14 sinusoid (amplitude 120 px, period 1.5 s, run for 3 s). */
export function dragOffset(tMs: number, amp = 120, periodMs = 1500): number {
  return amp * Math.sin(2 * Math.PI * tMs / periodMs)
}

/** True while a journey is under way (the recording may stop when it ends). JourneyStatus: loading, travelling, arrived, cancelled, failed. */
export function journeyLive(status: string | undefined): boolean {
  return status === 'travelling' || status === 'loading'
}

export function sampleFileName(moment: string, mode: string, stamp: Date): string {
  const safe = (x: string): string => x.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'none'
  return `moon-sample-m5-${safe(moment)}-${safe(mode)}-${stamp.toISOString().replace(/[:.]/g, '-')}.json`
}

export interface BuildInput {
  moment: string; data: SampleData; started: number | null; ended: number | null; wallMs: number
  viewport: [number, number, number]; gpu: SampleFile['gpu']; ua: string; replayDrag: boolean; reportedHz: number | null
}
/** Pure: assemble the file. displayHz is measured from the rAF ticks; the app's own estimate is used only when the ticks are too few. */
export function buildSampleFile(i: BuildInput): SampleFile {
  const mode: SampleFile['mode'] = i.data.moves.length > 5 && i.moment === 'none' ? 'drag' : 'flights'
  const measured = estimateDisplayHz(rafIntervals(i.data.s))
  const hz = measured ?? (i.reportedHz && Number.isFinite(i.reportedHz) && i.reportedHz > 0 ? Math.round(i.reportedHz) : null)
  return {
    arm: 'm5', moment: i.moment, mode, viewport: i.viewport, started: i.started, ended: i.ended, wallMs: i.wallMs,
    data: i.data, gpu: i.gpu, ua: i.ua, dpr: i.viewport[2], displayHz: hz, rateMix: rateMix(rafIntervals(i.data.s)), replayDrag: i.replayDrag,
    note: 'frame JS time is the rAF-timestamp to post-draw-task gap (a proxy; frames the pacer holds draw later and are missed); input lag excludes GPU and present; the recorder own rAF loop keeps the page animating, which may hold an adaptive display at a higher rate. polls carry pcad/tier: the app paces motion to 60 Hz (tier 1) on faster displays, so judge presented % against pcad, not displayHz',
  }
}

interface MoonLike {
  frames: number
  camState?: () => { pos: number[] } | null
  journeyState?: () => { id?: string; status?: string; phase?: string; progress?: number; durationS?: number }
  residency?: () => { resident: number; inflight: number; bestLevelShare: number }
  perf?: Record<string, unknown>
}

const BTN_CSS = 'position:fixed;left:8px;bottom:calc(36px + env(safe-area-inset-bottom,0px));max-width:calc(100vw - 16px);flex-wrap:wrap;z-index:99998;display:flex;gap:6px;font:12px/1.2 system-ui,sans-serif;opacity:.55'
const B_CSS = 'font:inherit;padding:6px 9px;border-radius:6px;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.6);color:#fff;cursor:pointer'

interface Rec { data: SampleData; t0: number; started: number | null; ended: number | null; moment: string; stop: () => void; replay: boolean }

export function mountSampler(canvas: HTMLCanvasElement): void {
  const moon = (): MoonLike | undefined => (window as unknown as { __moon?: MoonLike }).__moon
  let rec: Rec | null = null
  let last: { data: SampleData; started: number | null; ended: number | null; moment: string; wallMs: number; replay: boolean } | null = null
  let replaying = false

  const root = document.createElement('div')
  root.style.cssText = BTN_CSS
  root.addEventListener('focusin', () => { root.style.opacity = '1' })
  root.addEventListener('focusout', () => { root.style.opacity = '.55' })
  root.addEventListener('pointerenter', () => { root.style.opacity = '1' })
  root.addEventListener('pointerleave', () => { root.style.opacity = '.55' })
  const mk = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.style.cssText = B_CSS
    b.addEventListener('click', onClick); root.appendChild(b); return b
  }
  const status = document.createElement('span')
  status.style.cssText = 'align-self:center;color:#fff;text-shadow:0 0 3px #000'
  status.setAttribute('aria-live', 'polite')
  const recBtn = mk('Record', () => { if (rec) stop(); else start(false) })
  const replayBtn = mk('Replay drag', () => { if (!rec) start(true); else if (!replaying) void replayDrag() })
  const saveBtn = mk('Save', save)
  saveBtn.disabled = true
  root.appendChild(status)
  document.body.appendChild(root)

  function setUi(): void {
    recBtn.textContent = rec ? 'Stop' : 'Record'
    saveBtn.disabled = !last
    replayBtn.disabled = replaying
  }

  function start(withReplay: boolean): void {
    const data: SampleData = { s: [], moves: [], polls: [], lt: [] }
    const mc = new MessageChannel()
    let lastFrames = -1
    let alive = true
    mc.port1.onmessage = (ev: MessageEvent<[number, number]>) => {
      const m = moon()
      if (!m || !alive) return
      let pos: number[] | null = null
      const fr = m.frames
      if (fr !== lastFrames && m.camState) { try { pos = m.camState()?.pos ?? null } catch { /* */ } lastFrames = fr }
      data.s.push([ev.data[0], ev.data[1], fr, pos])
    }
    let raf = 0
    const tick = (t: number): void => { if (!alive) return; mc.port2.postMessage([t, performance.now()]); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    const onMove = (e: PointerEvent): void => { if (e.buttons) data.moves.push([e.timeStamp, performance.now()]) }
    window.addEventListener('pointermove', onMove, true)
    let sawLive = false
    // Live state at Record, read once now, so a viewpoint pressed in the first poll interval still counts as a start.
    let prevLive: boolean | null = null
    try { const j0 = moon()?.journeyState?.(); prevLive = !!j0 && journeyLive(j0.status) && !!j0.id } catch { /* */ }
    const r: Rec = { data, t0: performance.now(), started: null, ended: null, moment: 'none', stop: () => { /* set below */ }, replay: withReplay }
    const poll = setInterval(() => {
      const m = moon()
      if (!m) return
      const o: PollRow = { t: performance.now(), fr: m.frames }
      try { const p = m.perf as Record<string, unknown>; o.scale = p.motionScale; o.dpr = p.motionDpr; o.held = p.held; o.holds = p.paceHolds; o.sm = p.smoothedMs; o.wcap = p.wallCap; o.tier = p.paceTier; o.inflight = p.inFlight; o.cls = p.class; o.hz = p.displayHz; o.pcad = p.paceCadenceHz } catch { /* */ }
      try {
        const j = m.journeyState?.()
        if (j) {
          o.j = [j.id, j.status, j.phase, j.progress, j.durationS]
          const live = journeyLive(j.status) && !!j.id
          // Only a journey that STARTS during the recording counts (not-live to live); one already live at Record is left alone, so a drag during it stays a drag.
          if (live && prevLive === false && !sawLive) { sawLive = true; r.started = o.t; r.moment = j.id as string }
          prevLive = live
          // That flight ending stops the recording, but never downloads: the owner presses Save.
          if (sawLive && !live) { r.ended = o.t; data.polls.push(o); stop(); return }
        }
      } catch { /* */ }
      try { const x = m.residency?.(); if (x) { o.res = [x.resident, x.inflight]; o.bls = x.bestLevelShare } } catch { /* */ }
      data.polls.push(o)
    }, 200)
    let po: PerformanceObserver | null = null
    try { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) data.lt.push([e.startTime, e.duration]) }); po.observe({ entryTypes: ['longtask'] }) } catch { po = null }
    r.stop = (): void => {
      alive = false; cancelAnimationFrame(raf); clearInterval(poll); window.removeEventListener('pointermove', onMove, true)
      po?.disconnect(); mc.port1.close(); mc.port2.close()
    }
    rec = r
    last = null
    setUi()
    status.textContent = withReplay ? 'recording, replaying drag' : 'recording'
    if (withReplay) void replayDrag()
  }

  function stop(): void {
    if (!rec) return
    const r = rec
    r.stop()
    rec = null
    last = { data: r.data, started: r.started, ended: r.ended, moment: r.moment, wallMs: performance.now() - r.t0, replay: r.replay }
    status.textContent = `stopped: ${last.data.s.length} frames, press Save to download`
    setUi()
  }

  async function replayDrag(): Promise<void> {
    replaying = true
    setUi()
    const rect = canvas.getBoundingClientRect()
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2
    const ev = (type: string, x: number, buttons: number): void => {
      canvas.dispatchEvent(new PointerEvent(type, { pointerId: 91, pointerType: 'mouse', isPrimary: true, button: 0, buttons, clientX: x, clientY: cy, bubbles: true, cancelable: true }))
    }
    ev('pointerdown', cx, 1)
    const t0 = performance.now()
    await new Promise<void>((done) => {
      const step = (): void => {
        const t = performance.now() - t0
        if (t >= 3000 || !rec) { done(); return }
        ev('pointermove', cx + dragOffset(t), 1)
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })
    // Hold still for 200 ms (the rig keeps inertia only if the last step was within 80 ms) so the camera stays where the drag ended instead of coasting. No events are sent in this tail, so the analysed drag window is unchanged.
    await new Promise<void>((done) => setTimeout(done, 200))
    ev('pointerup', cx, 0)
    replaying = false
    if (rec) stop()
    setUi()
  }

  function save(): void {
    if (!last) return
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
    let renderer: string | null = null, vendor: string | null = null
    try {
      const ext = gl?.getExtension('WEBGL_debug_renderer_info')
      if (gl && ext) { renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)); vendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) }
    } catch { /* */ }
    let reported: number | null = null
    try { const h = moon()?.perf?.displayHz; reported = typeof h === 'number' ? h : null } catch { /* */ }
    const file = buildSampleFile({
      moment: last.moment, data: last.data, started: last.started, ended: last.ended, wallMs: last.wallMs,
      viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio], gpu: { renderer, vendor }, ua: navigator.userAgent, replayDrag: last.replay, reportedHz: reported,
    })
    const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = sampleFileName(file.moment, file.mode, new Date())
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    status.textContent = `saved ${a.download}`
  }
}
