/**
 * Production telemetry: Sentry errors plus small PostHog performance summaries.
 *
 * This module is loaded ONLY by a dynamic import from main.ts, after the first frame, and only when a build-time key exists. The two SDKs are
 * dynamic imports of their own, after the decision. Nothing in main.ts imports anything from src/telemetry statically (scripts/telemetry.test.mts checks it).
 *
 * Cost while recording a flight or drag: one rAF callback doing arithmetic on preallocated storage (FrameWindow.tick), and a 10 Hz timer. At rest: the 10 Hz
 * timer only. It never keeps the page animating at rest. Nothing is recorded per frame and nothing is sent per frame: one event per flight or drag, batched by posthog-js.
 */
import type { ResumeInfo } from '../loop/resume'
import { FracWindow, FrameWindow, type FracSource } from '../perf/frameStats'
import { introWanted } from '../intro/parse'
import { flightWantedScale } from '../moon/tiles/wanted'
import { activeSwitches, decideTelemetry, deviceClass, environmentFor, scrubUrl, scrubUrlProps, switchesLabel, type TelemetryKeys } from './config'
import { DEFAULT_POSTHOG_HOST } from '../build/telemetryHosts'
import { gpuFamilyFromRenderer, keyForStartupClass } from '../quality/deviceClassKey'
import type { Hints, QualityClass } from '../quality/startupClass'
import { buildFirstInteraction, buildFlightEnd, buildUsage, buildResumeBlank, buildContext, buildDegraded, buildDragPerf, buildFlightPerf, buildLoad, buildStall, elapsedBucket, makeLimiter, mbBucket, memProps, cacheProps, payloadIsClean, programsBucket, safeId, type MotionFMeta, type Props } from './events'

interface MoonApi {
  frames: number
  build?: { commit: string; dirty: boolean }
  surface?: string
  firstFrameAt?: number; heightsReadyAt?: number; earthReadyAt?: number; tilesReadyAt?: number
  perf?: Record<string, unknown>
  /** The viewer's running f record (the FracStats behind perf.motionF): read per tick as two plain fields, no snapshot. */
  motionFStats?: FracSource
  quality?: () => Record<string, unknown>
  journeyState?: () => Record<string, unknown>
  camState?: () => { pose: { lat: number; lon: number; dist: number } } | null
  tileStats?: () => { inflight?: number } | null
  shaderPrograms?: () => number | null
  memoryShed?: () => { count?: unknown; last?: unknown; overBytes?: unknown }
  cacheGrow?: () => { on?: unknown; size?: unknown; start?: unknown; lastShrink?: unknown }
}

interface Sink {
  capture(name: string, props: Props): void
  crumb(message: string, data?: Record<string, string | number | boolean | null>): void
  message(text: string): void
  register(props: Record<string, unknown>): void
}

const POLL_MS = 100
const STALL_MS = 250
const MIN_DRAG_MS = 300
const MAX_DRAG_MS = 60_000
const FLIGHT_IDLE_END_MS = 1500

const asNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The app version label: VITE_APP_VERSION when a shell build sets it, else the first 8 characters of the build sha (null when unknown). */
export function appVersion(release: string | undefined): string | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
  const v = env.VITE_APP_VERSION
  if (typeof v === 'string' && /^[A-Za-z0-9._+-]{1,24}$/.test(v)) return v
  return release ? release.slice(0, 8) : null
}

export function readKeys(): Partial<TelemetryKeys> {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
  return { sentryDsn: env.VITE_SENTRY_DSN || '', posthogKey: env.VITE_POSTHOG_KEY || '', posthogHost: env.VITE_POSTHOG_HOST || DEFAULT_POSTHOG_HOST }
}

/**
 * Called by main.ts after the first frame with the viewer's own api object (not the window debug surface, which does not exist in the native
 * shell, and a store binary must not carry it). Never throws.
 */
export function startTelemetry(canvas: HTMLCanvasElement, api?: unknown): void {
  try {
    const moon = api as MoonApi | undefined
    const native = moon?.surface === 'native-ios' || moon?.surface === 'native-android'
    const search = location.search || (window as unknown as { __moonQuery?: string }).__moonQuery || ''
    const keys = readKeys()
    const decision = decideTelemetry({ search, hostname: location.hostname, webdriver: navigator.webdriver === true, keys, native })
    if (!decision.on || !moon) return
    void load(canvas, moon, native, search, keys, decision.sentry, decision.posthog).catch(() => undefined)
  } catch { /* telemetry must never break the viewer */ }
}

async function load(canvas: HTMLCanvasElement, moon: MoonApi, native: boolean, search: string, keys: Partial<TelemetryKeys>, useSentry: boolean, usePosthog: boolean): Promise<void> {
  const env = environmentFor(location.pathname, native)
  const release = moon.build?.commit && moon.build.commit !== 'unknown' ? moon.build.commit : undefined
  const q = (): Record<string, unknown> => { try { return moon.quality?.() ?? {} } catch { return {} } }
  const hints = (q().hints ?? {}) as { renderer?: string; coarsePointer?: boolean; shortSide?: number }
  const cls = deviceClass(q().class, !!hints.coarsePointer, hints.shortSide ?? Math.min(innerWidth, innerHeight))
  const renderer = typeof hints.renderer === 'string' ? hints.renderer.slice(0, 120) : null
  const switches = activeSwitches(search)

  let sentry: typeof import('@sentry/browser') | null = null
  if (useSentry) {
    sentry = await import('@sentry/browser')
    sentry.init({
      dsn: keys.sentryDsn, release, environment: env,
      sampleRate: 1, tracesSampleRate: 0, sendDefaultPii: false, attachStacktrace: false,
      // No default integrations: they add console, DOM and fetch breadcrumbs and the request URL (with the camera pose in its query).
      defaultIntegrations: false,
      integrations: [sentry.globalHandlersIntegration(), sentry.linkedErrorsIntegration(), sentry.dedupeIntegration(), sentry.inboundFiltersIntegration(), sentry.functionToStringIntegration(), sentry.browserSessionIntegration()],
      beforeSend: (event) => {
        if (event.request) event.request = { url: scrubUrl(event.request.url ?? location.href) }
        else event.request = { url: scrubUrl(location.href) }
        delete event.user
        if (event.transaction) event.transaction = scrubUrl(event.transaction)
        return event
      },
      beforeBreadcrumb: (b) => {
        if (b.data) for (const k of Object.keys(b.data)) if (typeof b.data[k] === 'string') b.data[k] = scrubUrl(b.data[k] as string)
        return b
      },
    })
    sentry.setTag('renderer', renderer ?? 'unknown')
    sentry.setTag('tier', cls)
    sentry.setTag('dpr', String(Math.round(devicePixelRatio * 100) / 100))
  }

  let ph: (typeof import('posthog-js'))['default'] | null = null
  if (usePosthog) {
    ph = (await import('posthog-js')).default
    // Cookieless and anonymous: memory persistence (a new random id each load), no autocapture, no replay, no identify, no person profiles, IP not kept.
    // Typed loosely on purpose: a few of these keys differ between posthog-js minor versions and unknown keys are ignored.
    const cfg: Record<string, unknown> = {
      api_host: keys.posthogHost, persistence: 'memory', autocapture: false, capture_pageview: true, capture_pageleave: false,
      disable_session_recording: true, disable_surveys: true, capture_exceptions: false, capture_performance: false, disable_external_dependency_loading: true, capture_dead_clicks: false, capture_heatmaps: false, rageclick: false,
      person_profiles: 'never', ip: false, advanced_disable_flags: true, disable_web_experiments: true,
      sanitize_properties: (props: Record<string, unknown>) => { delete props.$raw_user_agent; return scrubUrlProps(props) },
      before_send: (ev: { properties?: Record<string, unknown> } | null) => { if (ev?.properties) { delete ev.properties.$raw_user_agent; scrubUrlProps(ev.properties) } return ev },
    }
    ph.init(keys.posthogKey as string, cfg as never)
  }

  const sink: Sink = {
    capture: (name, props) => {
      if (!ph) return
      // Every event carries how long the page has been open, as a label (performance.now() is milliseconds since navigation start).
      const full = { ...props, session_elapsed_bucket: elapsedBucket(performance.now()) }
      if (!payloadIsClean(full)) return
      try { ph.capture(name, full) } catch { /* */ }
    },
    crumb: (message, data) => { try { sentry?.addBreadcrumb({ category: 'moon', message, data, level: 'info' }) } catch { /* */ } },
    message: (text) => { try { sentry?.captureMessage(text, 'warning') } catch { /* */ } },
    register: (props) => { try { ph?.register(props) } catch { /* */ } },
  }

  // The same bucketing as the SkyLumi app (quality/deviceClassKey.ts): a GPU family label and `<device>_<family>_<tier>`, never the renderer string alone.
  const gpuFamily = gpuFamilyFromRenderer(renderer)
  let classKey: string | null = null
  try { classKey = keyForStartupClass(cls as QualityClass, hints as Hints).deviceClassKey } catch { /* an unknown class label has no key */ }

  const superProps = (hz: number | null, cadence: number | null): Record<string, unknown> => ({
    gpu_family: gpuFamily, device_class_key: classKey,
    surface: moon.surface === 'native-ios' || moon.surface === 'native-android' ? moon.surface : 'web',
    app_version: appVersion(release),
    build_sha: release ?? null, build_dirty: moon.build?.dirty ?? null, site: env, gpu_renderer: renderer, dpr: Math.round(devicePixelRatio * 100) / 100,
    viewport_w: innerWidth, viewport_h: innerHeight, device_class: cls, display_hz: hz, pace_cadence_hz: cadence, switches: switchesLabel(switches),
  })
  { const p = moon.perf; sink.register(superProps(asNum(p?.displayHz), asNum(p?.paceCadenceHz))) }

  attach(canvas, moon, sink, search)
}

interface FlightRun { t0: number; scale0: number; peakInflight: number; id: string; gen: unknown; kind: string; start: { lat: number; lon: number } | null; status: string; progress: number | null; lastDrawAt: number; lastFr: number }
interface DragRun { t0: number; scale0: number; peakInflight: number; pointers: number; maxPointers: number; lastMoveAt: number; firstMoveAt: number; latency: number | null; moved: boolean; fr0: number }

function attach(canvas: HTMLCanvasElement, moon: MoonApi, sink: Sink, search: string): void {
  const allowStall = makeLimiter(5)
  const allowDegraded = makeLimiter(10)
  const flightFw = new FrameWindow()
  const dragFw = new FrameWindow()
  const flightF = new FracWindow()
  const dragF = new FracWindow()
  let flight: FlightRun | null = null
  let drag: DragRun | null = null
  let raf = 0
  let lastTick = 0
  let lastPace: number | null = null
  let lastMode: unknown = null
  let lastClass: unknown = null
  let lastShed = 0
  let tickN = 0
  let registeredHz = false
  let loadSent = false
  let doneKey = ''
  const longTasks: Array<[number, number, string]> = []

  const stat = (p: Record<string, unknown> | undefined, k: string): number => asNum((p?.flightScale as Record<string, unknown> | undefined)?.[k]) ?? 0
  const inflightNow = (): number => { try { return asNum(moon.tileStats?.()?.inflight) ?? 0 } catch { return 0 } }
  const cadenceMs = (p: Record<string, unknown> | undefined): number => { const c = asNum(p?.paceCadenceHz); return c && c > 0 ? 1000 / c : 0 }
  const wantMult = flightWantedScale(search)
  /** Buckets for the GPU ledger's high-water, the class ceiling and the shader program count, read when the event is built. */
  const memExtra = (): Props => {
    let high: unknown = null, ceil: unknown = null, programs: unknown = null
    try { const q = moon.quality?.() as { ledger?: { highWater?: unknown }; ceilingBytes?: unknown } | undefined; high = q?.ledger?.highWater; ceil = q?.ceilingBytes } catch { /* */ }
    try { programs = moon.shaderPrograms?.() } catch { /* */ }
    let cache: Props = {}
    try { const c = moon.cacheGrow?.(); if (c && c.on === true) cache = cacheProps(c.size, c.start, c.lastShrink) } catch { /* */ }
    return { ...memProps(high, ceil), shader_programs_bucket: programsBucket(programs), ...cache }
  }
  /** The window's f statistics (after taking the last frames), the GPU timer source and the phone pacer's level, read at the end. */
  const motionMeta = (w: FracWindow, p: Record<string, unknown> | undefined): MotionFMeta => {
    w.follow(moon.motionFStats)
    return { f: w.summary(), gpuSource: p?.source, phoneLevel: (p?.phone as { level?: unknown } | null | undefined)?.level }
  }
  const phaseNow = (): string => (flight ? 'flight' : drag ? 'drag' : 'rest')
  const momentNow = (): string | null => (flight ? flight.id : null)

  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration < 50) continue
        if (longTasks.length >= 8) longTasks.shift()
        longTasks.push([e.startTime, e.duration, e.name])
        // A long task at rest (no window running to see it) is a stall too.
        if (e.duration >= STALL_MS && !flight && !drag && allowStall()) {
          sink.capture('stall', buildStall({ gapMs: e.duration, phase: 'rest', momentId: null, inflight: inflightNow(), longTaskMs: e.duration, longTaskName: e.name }))
        }
      }
    })
    po.observe({ entryTypes: ['longtask'] })
  } catch { /* longtask is not in every browser */ }

  function stallFromGap(gap: number, t: number): void {
    if (!allowStall()) return
    let best: [number, number, string] | null = null
    for (const lt of longTasks) if (lt[0] + lt[1] >= t - gap && lt[0] <= t && (!best || lt[1] > best[1])) best = lt
    sink.capture('stall', buildStall({ gapMs: gap, phase: phaseNow(), momentId: momentNow(), inflight: inflightNow(), longTaskMs: best ? best[1] : null, longTaskName: best ? best[2] : null }))
  }

  function loop(t: number): void {
    raf = 0
    const fr = moon.frames
    const gap = lastTick ? t - lastTick : 0
    lastTick = t
    if (gap >= STALL_MS && gap < 2000) stallFromGap(gap, t)
    if (flight) {
      flightF.follow(moon.motionFStats)
      if (fr !== flight.lastFr) { flight.lastFr = fr; flight.lastDrawAt = t }
      const idle = t - flight.lastDrawAt
      // A held tween (a pin's fly-to) keeps its journey 'travelling' after the camera stopped: no frame for 1.5 s ends the flight.
      if (idle >= FLIGHT_IDLE_END_MS) { doneKey = `${String(flight.gen)}:${flight.id}`; endFlight((flight.progress ?? 0) >= 0.999) }
      else flightFw.tick(t, fr, idle < 1000)
    }
    if (drag && t - drag.t0 > MAX_DRAG_MS) endDrag()
    if (drag) {
      dragFw.tick(t, fr, t - drag.lastMoveAt < 100)
      dragF.follow(moon.motionFStats)
      if (drag.latency === null && drag.moved && fr !== drag.fr0) drag.latency = Math.max(0, t - drag.firstMoveAt)
    }
    if (flight || drag) raf = requestAnimationFrame(loop)
    else lastTick = 0
  }
  const ensureLoop = (): void => { if (!raf) { lastTick = 0; raf = requestAnimationFrame(loop) } }

  function endFlight(completed: boolean): void {
    const f = flight
    if (!f) return
    flight = null
    const s = flightFw.summary()
    let end: { lat: number; lon: number; dist: number } | null = null
    try { end = moon.camState?.()?.pose ?? null } catch { /* */ }
    const p = moon.perf
    const fx = p?.flightExposure as Record<string, unknown> | undefined
    const fs = p?.flightScale as Record<string, unknown> | undefined
    sink.crumb('moment end', { id: f.id, completed, status: f.status })
    sink.capture('flight_end', buildFlightEnd(f.id, completed, Math.max(0, f.lastDrawAt - f.t0)))
    if (s.drawn >= 2) {
      sink.capture('flight_perf', buildFlightPerf({
        momentId: f.id, kind: f.kind, durationMs: Math.max(0, f.lastDrawAt - f.t0), completed, start: f.start, end, endDist: end?.dist,
        scaleChanges: stat(p, 'total') - f.scale0, peakInflight: f.peakInflight, exposureMode: fx?.mode, scaleMode: fs?.mode, wantMult, motion: motionMeta(flightF, p),
      }, s, memExtra()))
    }
  }

  function endDrag(): void {
    const d = drag
    if (!d) return
    drag = null
    const dur = performance.now() - d.t0
    if (!d.moved || dur < MIN_DRAG_MS) return
    const s = dragFw.summary()
    if (s.drawn < 2) return
    const p = moon.perf
    sink.capture('drag_perf', buildDragPerf({ kind: d.maxPointers >= 2 ? 'pinch' : 'drag', durationMs: dur, startLatencyMs: d.latency, nearTerminator: null, scaleChanges: stat(p, 'total') - d.scale0, peakInflight: d.peakInflight, motion: motionMeta(dragF, p) }, s, memExtra()))
  }

  canvas.addEventListener('pointerdown', () => {
    const t = performance.now()
    if (!drag) {
      const p = moon.perf
      dragFw.start(t, moon.frames, cadenceMs(p))
      dragF.start(moon.motionFStats)
      drag = { t0: t, scale0: stat(p, 'total'), peakInflight: 0, pointers: 0, maxPointers: 0, lastMoveAt: -1e9, firstMoveAt: 0, latency: null, moved: false, fr0: moon.frames }
    }
    drag.pointers++
    drag.maxPointers = Math.max(drag.maxPointers, drag.pointers)
    ensureLoop()
  }, { capture: true, passive: true })
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || (!e.buttons && e.pointerType === 'mouse')) return
    const t = performance.now()
    drag.lastMoveAt = t
    if (!drag.moved) { drag.moved = true; drag.firstMoveAt = t; drag.fr0 = moon.frames }
  }, { capture: true, passive: true })
  const up = (): void => { if (!drag) return; drag.pointers = Math.max(0, drag.pointers - 1); if (drag.pointers === 0) endDrag() }
  // On window, not the canvas: a release outside the canvas (failed pointer capture, an overlay) must still end the drag.
  window.addEventListener('pointerup', up, { capture: true, passive: true })
  window.addEventListener('pointercancel', up, { capture: true, passive: true })

  canvas.addEventListener('webglcontextlost', () => {
    sink.crumb('webgl context lost')
    sink.capture('webgl_context_lost', buildContext('lost', asNum(moon.quality?.().contextLosses)))
    sink.message('WebGL context lost')
  })
  canvas.addEventListener('webglcontextrestored', () => {
    sink.crumb('webgl context restored')
    sink.capture('webgl_context_restored', buildContext('restored', asNum(moon.quality?.().contextLosses)))
  })

  // main.ts judges a page shown again after a hidden spell (loop/resume.ts) and announces a blank-looking one; at most 3 per load.
  const allowResume = makeLimiter(3)
  window.addEventListener('moon:resumeblank', (ev) => {
    const d = (ev as CustomEvent<{ info?: unknown; reasons?: unknown; loopErrors?: unknown }>).detail
    if (!d || typeof d.info !== 'object' || d.info === null || !Array.isArray(d.reasons) || !allowResume()) return
    sink.crumb('resume blank', { reasons: d.reasons.join('+').slice(0, 70) })
    sink.capture('resume_blank', buildResumeBlank(d.info as ResumeInfo, d.reasons as string[], d.loopErrors))
  })

  // Usage events (src/usage.ts): the viewer dispatches `moon:usage` where an action is handled; each is built by a fixed builder in events.ts.
  // Same viewpoint within 2.5 s is one open (a nav step reports twice: when chosen and when the camera starts); scrubs at most one per 5 s; 200 per load.
  const allowUsage = makeLimiter(200)
  let lastOpen: { id: unknown; at: number } | null = null
  let lastScrub = -1e9
  window.addEventListener('moon:usage', (ev) => {
    const d = (ev as CustomEvent<Record<string, unknown>>).detail
    if (!d || typeof d !== 'object') return
    const built = buildUsage(d)
    if (!built) return
    const now = performance.now()
    if (built.name === 'viewpoint_open') {
      if (lastOpen && lastOpen.id === built.props.id && now - lastOpen.at < 2500) return
      lastOpen = { id: built.props.id, at: now }
    }
    if (built.name === 'time_change' && built.props.kind === 'scrub') { if (now - lastScrub < 5000) return; lastScrub = now }
    if (!allowUsage()) return
    sink.capture(built.name, built.props)
  })

  // The first thing the visitor does with the picture or the keyboard: one event per load, with how long after the viewer was ready.
  {
    let down: { x: number; y: number; pointers: number } | null = null
    let sent = false
    const fire = (kind: string): void => {
      if (sent) return
      sent = true
      window.removeEventListener('keydown', onKey, true)
      canvas.removeEventListener('pointerdown', onDown, true)
      canvas.removeEventListener('pointermove', onMove, true)
      canvas.removeEventListener('pointerup', onUp, true)
      const ready = asNum(moon.tilesReadyAt) ?? asNum(moon.firstFrameAt)
      sink.capture('first_interaction', buildFirstInteraction(kind, ready === null ? null : performance.now() - ready))
    }
    const onKey = (): void => fire('key')
    const onDown = (e: PointerEvent): void => { if (down) { fire('pinch'); return } down = { x: e.clientX, y: e.clientY, pointers: 1 } }
    const onMove = (e: PointerEvent): void => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) fire('drag') }
    const onUp = (): void => { if (down) fire('tap') }
    window.addEventListener('keydown', onKey, { capture: true, passive: true })
    canvas.addEventListener('pointerdown', onDown, { capture: true, passive: true })
    canvas.addEventListener('pointermove', onMove, { capture: true, passive: true })
    canvas.addEventListener('pointerup', onUp, { capture: true, passive: true })
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    if (flight) endFlight(false)
    endDrag()
  })

  function sendLoad(force: boolean): void {
    if (loadSent) return
    const ready = moon.tilesReadyAt !== undefined
    if (!ready && !force) return
    loadSent = true
    const q = new URLSearchParams(search)
    sink.capture('moon_load', buildLoad({
      firstFrameMs: moon.firstFrameAt, heightsMs: moon.heightsReadyAt, earthMs: moon.earthReadyAt, tilesReadyMs: moon.tilesReadyAt,
      intro: introWanted(q, false),
    }, memExtra()))
  }
  const loadDeadline = performance.now() + 15000

  setInterval(() => {
    tickN++
    // Journey: a flight window runs from 'travelling' to any other status.
    let js: Record<string, unknown> | null = null
    try { js = moon.journeyState?.() ?? null } catch { /* */ }
    const status = typeof js?.status === 'string' ? js.status : ''
    const id = safeId(js?.id)
    if (js && status === 'travelling' && id && (!flight || flight.gen !== js.generation || flight.id !== id) && doneKey !== `${String(js.generation)}:${id}`) {
      if (flight) endFlight(false)
      const t = performance.now()
      let pose: { lat: number; lon: number } | null = null
      try { pose = moon.camState?.()?.pose ?? null } catch { /* */ }
      const kind = js.descent != null ? 'descent' : js.ridge ? 'ridge' : id.startsWith('orbit') ? 'orbit' : 'flight'
      const p = moon.perf
      flightFw.start(t, moon.frames, cadenceMs(p))
      flightF.start(moon.motionFStats)
      flight = { t0: t, scale0: stat(p, 'total'), peakInflight: 0, id, gen: js.generation, kind, start: pose, status, progress: asNum(js.progress), lastDrawAt: t, lastFr: moon.frames }
      sink.crumb('moment start', { id, kind })
      ensureLoop()
    } else if (flight && (status !== 'travelling' || !js)) {
      flight.status = status
      endFlight(status === 'arrived')
    } else if (flight && js) flight.progress = asNum(js.progress)
    if (!js || status !== 'travelling') doneKey = ''
    if (js && js.mode !== lastMode) { if (lastMode !== null) sink.crumb('mode change', { from: String(lastMode), to: String(js.mode) }); lastMode = js.mode }
    if (flight || drag) {
      if (tickN % 3 === 0) { const n = inflightNow(); if (flight && n > flight.peakInflight) flight.peakInflight = n; if (drag && n > drag.peakInflight) drag.peakInflight = n }
    }
    if (tickN % 5 === 0) {
      const p = moon.perf
      const pace = asNum(p?.paceTier)
      if (pace !== null && lastPace !== null && pace > lastPace && allowDegraded()) {
        sink.capture('perf_degraded', buildDegraded({ what: 'pace_tier', from: lastPace, to: pace, phase: phaseNow(), momentId: momentNow() }))
        sink.crumb('pace tier up', { from: lastPace, to: pace })
      }
      if (pace !== null) lastPace = pace
      // Memory ceiling enforcement (R54): a shed is a degradation. from: how far over the ceiling the ledger was (bucketed), to: what was released.
      try {
        const ms = moon.memoryShed?.()
        const n = asNum(ms?.count) ?? 0
        if (n > lastShed) {
          lastShed = n
          const step = ms?.last === 'patch' || ms?.last === 'tiles' || ms?.last === 'patch+tiles' ? String(ms.last).replace('+', '_') : null
          if (allowDegraded()) sink.capture('perf_degraded', buildDegraded({ what: 'memory', from: mbBucket(asNum(ms?.overBytes) ?? 0), to: step, phase: phaseNow(), momentId: momentNow() }))
        }
      } catch { /* */ }
      const cl = p?.class
      if (lastClass !== null && cl !== lastClass && allowDegraded()) sink.capture('perf_degraded', buildDegraded({ what: 'class', from: lastClass, to: cl, phase: phaseNow(), momentId: momentNow() }))
      lastClass = cl
    }
    if (tickN % 20 === 0) {
      // Once the page has run a while: the measured display rate (the app's own estimate of the rAF cadence) as a super-property.
      const p = moon.perf
      const hz = asNum(p?.displayHz), cad = asNum(p?.paceCadenceHz)
      if (!registeredHz && hz !== null) { registeredHz = true; sink.register({ display_hz: hz, pace_cadence_hz: cad }) }
      sendLoad(performance.now() > loadDeadline)
    }
  }, POLL_MS)
}
