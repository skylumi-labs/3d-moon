/**
 * Event payload builders: pure functions from measured values to the flat property bags sent to PostHog. No SDK, no DOM.
 * Every number is measured; a value that could not be measured is null (shown as N/A in queries), never filled in.
 * Nothing here takes a URL, a query string or free text: ids are sanitised, poses are rounded to 1 degree.
 */
import type { FracSummary, WindowSummary } from '../perf/frameStats'
import { coarsePose } from './config'
import type { ResumeInfo } from '../loop/resume'

export type Props = Record<string, string | number | boolean | null>

/** A moment/phase id reduced to [a-z0-9_-], 40 characters at most. */
export function safeId(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  const s = v.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40)
  return s || null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const r1 = (v: unknown): number | null => { const n = num(v); return n === null ? null : Math.round(n * 10) / 10 }

// ---- Bucketed identifiers (R3). Nothing below sends a raw measurement: each value is one of a fixed set of labels.

/** Bytes to a 64 MB step label: `mb_192` is 192 to under 256 MB; `mb_1024plus` at 1 GB and over; `none` for no ceiling (Infinity or null from the snapshot); null if unknown. */
export function mbBucket(bytes: unknown, noneIsInfinite = false): string | null {
  if (bytes === null && noneIsInfinite) return 'none'
  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes < 0) return null
  if (bytes === Infinity) return 'none'
  const step = Math.floor(bytes / 1048576 / 64) * 64
  return step >= 1024 ? 'mb_1024plus' : `mb_${step}`
}

/** Time since the page started, as a label: s0_10, s10_30, s30_60, m1_5, m5_15, m15plus. */
export function elapsedBucket(ms: unknown): string | null {
  const n = num(ms)
  if (n === null || n < 0) return null
  const s = n / 1000
  return s < 10 ? 's0_10' : s < 30 ? 's10_30' : s < 60 ? 's30_60' : s < 300 ? 'm1_5' : s < 900 ? 'm5_15' : 'm15plus'
}

/** A count of shader programs as a label: p0_15, p15_30, p30_60, p60plus. */
export function programsBucket(n: unknown): string | null {
  const v = num(n)
  if (v === null || v < 0) return null
  return v < 15 ? 'p0_15' : v < 30 ? 'p15_30' : v < 60 ? 'p30_60' : 'p60plus'
}

/** GPU ledger high-water and the class ceiling (R3). The snapshot reports an infinite ceiling as null, which is `none`. */
export function memProps(highWaterBytes: unknown, ceilingBytes: unknown): Props {
  return { ledger_high_bucket: mbBucket(highWaterBytes), ceiling_bucket: mbBucket(ceilingBytes, true) }
}

/** Adaptive tile cache (W3-M5): the size reached as a multiple of the start (x1, x1_25, x1_5, x1_75, x2plus) and the last shrink reason from a fixed list. Labels only. */
export function cacheProps(size: unknown, start: unknown, reason: unknown): Props {
  const sz = typeof size === 'number' && typeof start === 'number' && start > 0 && Number.isFinite(size) ? size / start : null
  const bucket = sz === null ? null : sz < 1.25 ? 'x1' : sz < 1.5 ? 'x1_25' : sz < 1.75 ? 'x1_5' : sz < 2 ? 'x1_75' : 'x2plus'
  const why = reason === 'shed' || reason === 'context_loss' || reason === 'slow_frames' || reason === 'crash_marker' ? reason : null
  return { cache_size_bucket: bucket, cache_shrink_reason: why }
}

/** Frame statistics as event properties (shared by flight_perf and drag_perf). */
export function statProps(s: WindowSummary): Props {
  return {
    frames_drawn: s.drawn, wall_ms: s.wallMs,
    frame_p50_ms: s.p50, frame_p95_ms: s.p95, frame_p99_ms: s.p99, max_gap_ms: s.maxGapMs,
    gaps_25: s.g25, gaps_50: s.g50, gaps_100: s.g100,
    slot_missed: s.slotMiss, slot_gaps_2: s.slot2, slot_gaps_4: s.slot4,
    presented_pct: s.presentedPct, pauses: s.pauses, truncated: s.truncated,
  }
}

/**
 * The motion render fraction of the window (WP9, O6): f = render width / canvas width over the drawn motion frames, from the same per-frame values as
 * `__moon.perf.motionF` (FracWindow in perf/frameStats.ts). `gpuSource` is `__moon.perf.source` at the end, sent as `query` (the disjoint timer query,
 * which the phone pacer's GPU veto reads) or `wall` (`fence`: no timer query on the device, or forced with `?gpusource=fence`; `none`: the timer is
 * switched off, `?gputimer=0` or `?passes=1`; either way the pacer steps on wall gaps alone). `phoneLevel` is `__moon.perf.phone.level` at
 * the end (0: target f at 60 fps, 1: target f at 30 fps, 2: floor f at 30 fps); null without the phone pacer. Unmeasured is null, never 0.
 */
export interface MotionFMeta { f?: FracSummary | null; gpuSource?: unknown; phoneLevel?: unknown }

export function motionFProps(m: MotionFMeta | undefined): Props {
  const f = m?.f && m.f.frames > 0 ? m.f : null
  const src = m?.gpuSource
  const lvl = m?.phoneLevel
  return {
    motion_f_p10: f ? num(f.p10) : null, motion_f_p50: f ? num(f.p50) : null, motion_f_under_035_share: f ? num(f.underShare) : null,
    motion_f_source: src === 'query' ? 'query' : src === 'fence' || src === 'none' || src === 'wall' ? 'wall' : null,
    phone_tier: lvl === 0 || lvl === 1 || lvl === 2 ? lvl : null,
  }
}

export interface FlightMeta {
  momentId: unknown; kind: string; durationMs: number; completed: boolean
  start: { lat: unknown; lon: unknown } | null; end: { lat: unknown; lon: unknown } | null; endDist: unknown
  scaleChanges: unknown; peakInflight: unknown; exposureMode: unknown; scaleMode: unknown; wantMult: unknown
  motion?: MotionFMeta
}

export function buildFlightPerf(m: FlightMeta, s: WindowSummary, extra: Props = {}): Props {
  const a = m.start ? coarsePose(m.start.lat, m.start.lon) : null
  const b = m.end ? coarsePose(m.end.lat, m.end.lon) : null
  const ed = num(m.endDist)
  return {
    moment_id: safeId(m.momentId), kind: safeId(m.kind), duration_ms: Math.round(m.durationMs), completed: m.completed,
    ...statProps(s),
    scale_changes: num(m.scaleChanges), peak_tiles_inflight: num(m.peakInflight),
    exposure_mode: safeId(m.exposureMode), scale_mode: safeId(m.scaleMode), tile_want_mult: r1(m.wantMult),
    from_lat: a?.lat ?? null, from_lon: a?.lon ?? null, to_lat: b?.lat ?? null, to_lon: b?.lon ?? null, to_dist_radii: ed === null ? null : Math.round(ed * 100) / 100,
    ...motionFProps(m.motion),
    ...extra,
  }
}

export interface DragMeta { kind: 'drag' | 'pinch'; durationMs: number; startLatencyMs: number | null; nearTerminator: boolean | null; scaleChanges: unknown; peakInflight: unknown; motion?: MotionFMeta }

export function buildDragPerf(m: DragMeta, s: WindowSummary, extra: Props = {}): Props {
  return {
    kind: m.kind, duration_ms: Math.round(m.durationMs), start_latency_ms: r1(m.startLatencyMs), near_terminator: m.nearTerminator,
    ...statProps(s), scale_changes: num(m.scaleChanges), peak_tiles_inflight: num(m.peakInflight),
    ...motionFProps(m.motion),
    ...extra,
  }
}

export interface StallMeta { gapMs: number; phase: unknown; momentId: unknown; inflight: unknown; longTaskMs: number | null; longTaskName: string | null }
export function buildStall(m: StallMeta): Props {
  return {
    gap_ms: Math.round(m.gapMs), phase: safeId(m.phase), moment_id: safeId(m.momentId), tiles_inflight: num(m.inflight),
    long_task_ms: m.longTaskMs === null ? null : Math.round(m.longTaskMs), long_task_kind: safeId(m.longTaskName),
  }
}

export interface LoadMeta {
  firstFrameMs: unknown; heightsMs: unknown; earthMs: unknown; tilesReadyMs: unknown; intro: boolean; splashMs?: unknown
}
export function buildLoad(m: LoadMeta, extra: Props = {}): Props {
  return {
    first_frame_ms: r1(m.firstFrameMs), heights_ready_ms: r1(m.heightsMs), earth_ready_ms: r1(m.earthMs), tiles_ready_ms: r1(m.tilesReadyMs),
    splash_ms: r1(m.splashMs), intro: m.intro,
    ...extra,
  }
}

export interface DegradedMeta { what: string; from: unknown; to: unknown; phase: unknown; momentId: unknown }
export function buildDegraded(m: DegradedMeta): Props {
  const f = (v: unknown): string | number | null => (typeof v === 'number' && Number.isFinite(v) ? v : safeId(v))
  return { what: safeId(m.what), from: f(m.from), to: f(m.to), phase: safeId(m.phase), moment_id: safeId(m.momentId) }
}

export function buildContext(kind: 'lost' | 'restored', count: unknown): Props { return { event: kind, count: num(count) } }

/**
 * A page that looked blank after being shown again (loop/resume.ts). Counts, flags and labels only: the hidden spell and the frame age are bucketed,
 * the distance and the white point rounded, the reasons a fixed list joined with '+'.
 */
export function buildResumeBlank(info: ResumeInfo, reasons: readonly string[], loopErrors: unknown): Props {
  const age = num(info.lastFrameAgeMs)
  const white = num(info.exposureWhite)
  return {
    reasons: reasons.map((r) => safeId(r)).filter(Boolean).join('+').slice(0, 70) || null,
    context_losses: num(info.contextLosses), context_restores: num(info.contextRestores),
    context_lost: info.contextLost, gl_lost: info.glLost,
    hidden_bucket: elapsedBucket(info.hiddenMs),
    cam_dist_radii: r1(info.camDist), moon_on_screen: info.moonOnScreen,
    exposure_white: white === null ? null : Number(white.toPrecision(2)), exposure_hdr: r1(info.exposureHdr),
    loop_running: info.loopRunning, idle_sleeping: info.idleSleeping,
    last_frame_age_bucket: age === null ? null : age < 1000 ? 'ms0_1000' : age < 5000 ? 's1_5' : age < 30_000 ? 's5_30' : 's30plus',
    loop_errors: num(loopErrors),
  }
}

// ---- Usage events (what people do). Fixed property lists; ids are viewpoint/site/panorama ids from the app's own lists, every other value an enum label.

const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null)

export const USAGE_NAMES = ['viewpoint_open', 'flight_end', 'ground_enter', 'ground_exit', 'panorama_open', 'time_change', 'share', 'credits_open', 'quality_change', 'first_interaction'] as const
export const VIEWPOINT_SOURCES = ['list', 'pin', 'hotspot', 'next', 'prev', 'link'] as const
export const TIME_KINDS = ['now', 'preset', 'scrub'] as const
export const SHARE_KINDS = ['link', 'native'] as const
export const QUALITY_VALUES = ['auto', 'high', 'battery'] as const
export const INTERACTION_KINDS = ['drag', 'pinch', 'tap', 'key'] as const
export const GROUND_MODES = ['eye', 'walk'] as const

/** A duration as a label: d0_2, d2_5, d5_10, d10_20, d20_40, d40plus (seconds). null when unknown. */
export function durationBucket(ms: unknown): string | null {
  const n = num(ms)
  if (n === null || n < 0) return null
  const s = n / 1000
  return s < 2 ? 'd0_2' : s < 5 ? 'd2_5' : s < 10 ? 'd5_10' : s < 20 ? 'd10_20' : s < 40 ? 'd20_40' : 'd40plus'
}

/** A short wait as a label: ms0_1000, s1_3, s3_10, s10_30, s30plus. */
export function readyBucket(ms: unknown): string | null {
  const n = num(ms)
  if (n === null || n < 0) return null
  return n < 1000 ? 'ms0_1000' : n < 3000 ? 's1_3' : n < 10_000 ? 's3_10' : n < 30_000 ? 's10_30' : 's30plus'
}

export const buildViewpointOpen = (id: unknown, source: unknown): Props => ({ id: safeId(id), source: oneOf(source, VIEWPOINT_SOURCES) })
export const buildFlightEnd = (id: unknown, completed: boolean, durationMs: unknown): Props => ({ id: safeId(id), outcome: completed ? 'completed' : 'interrupted', duration_bucket: durationBucket(durationMs) })
/** ground_enter and ground_exit: the landing-site id and how the visitor moves (eye: the glide/fly camera, walk: on foot). */
export const buildGround = (site: unknown, mode: unknown): Props => ({ site: safeId(site), mode: oneOf(mode, GROUND_MODES) })
export const buildPanoramaOpen = (id: unknown): Props => ({ id: safeId(id) })
/** The kind only: no date, no time. */
export const buildTimeChange = (kind: unknown): Props => ({ kind: oneOf(kind, TIME_KINDS) })
export const buildShare = (kind: unknown): Props => ({ kind: oneOf(kind, SHARE_KINDS) })
export const buildCreditsOpen = (): Props => ({})
export const buildQualityChange = (to: unknown): Props => ({ to: oneOf(to, QUALITY_VALUES) })
export const buildFirstInteraction = (kind: unknown, msSinceReady: unknown): Props => ({ kind: oneOf(kind, INTERACTION_KINDS), since_ready_bucket: readyBucket(msSinceReady) })

/** The payload for a `moon:usage` window event from the viewer (src/usage.ts), or null for a name that is not one of the hook's. */
export function buildUsage(d: Record<string, unknown>): { name: string; props: Props } | null {
  switch (d.name) {
    case 'viewpoint_open': return { name: 'viewpoint_open', props: buildViewpointOpen(d.id, d.source) }
    case 'ground_enter': return { name: 'ground_enter', props: buildGround(d.site, d.mode) }
    case 'ground_exit': return { name: 'ground_exit', props: buildGround(d.site, d.mode) }
    case 'panorama_open': return { name: 'panorama_open', props: buildPanoramaOpen(d.id) }
    case 'time_change': return { name: 'time_change', props: buildTimeChange(d.kind) }
    case 'share': return { name: 'share', props: buildShare(d.kind) }
    case 'credits_open': return { name: 'credits_open', props: buildCreditsOpen() }
    case 'quality_change': return { name: 'quality_change', props: buildQualityChange(d.to) }
    default: return null
  }
}

/** True when no property carries a URL, a query string or a long free-text value (used by the tests and a runtime guard before capture). */
export function payloadIsClean(p: Record<string, unknown>): boolean {
  for (const v of Object.values(p)) {
    if (v === null || typeof v === 'number' || typeof v === 'boolean') continue
    if (typeof v !== 'string') return false
    if (v.length > 80 || /[?&=]|https?:|\/\//.test(v)) return false
  }
  return true
}

/** Rate limiter: at most `max` passes per page load. */
export function makeLimiter(max: number): () => boolean {
  let n = 0
  return () => (n < max ? (n++, true) : false)
}
