/**
 * Frame-spike attribution, behind ?perf=1 (zero cost otherwise: every entry point returns on a constant).
 *
 * `span(phase, fn)` times a synchronous phase and adds it to the frame in progress; `add(phase, ms)` records a time measured elsewhere
 * (a Worker round trip). `endFrame(now)` closes a frame: it keeps the frame's phase totals, and for a frame longer than SPIKE_MS it
 * keeps the breakdown, so "what was in the 60 ms frame" is answerable. Long tasks come from a PerformanceObserver; a JS heap drop
 * between two frames is counted as a GC (Chrome's `performance.memory`, coarse but free). `report()` is on `__moon.perf`.
 */
export const PERF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('perf') === '1'
export const SPIKE_MS = 24

export interface PhaseStat { n: number; totalMs: number; maxMs: number; p95Ms: number }
interface Spike { t: number; frameMs: number; phases: Record<string, number>; programs: number; gc: boolean }

const frame: Record<string, number> = {}
const totals = new Map<string, { n: number; total: number; max: number; samples: number[] }>()
const spikes: Spike[] = []
const longTasks: Array<{ t: number; ms: number }> = []
const frameDeltas: number[] = []
let lastNow = -1
let lastHeap = 0
let gcDrops = 0
let programsSeen = 0
let programsThisFrame = 0
let observing = false

const MAX_SAMPLES = 4000
const heap = (): number => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0

function note(phase: string, ms: number): void {
  frame[phase] = (frame[phase] ?? 0) + ms
  let s = totals.get(phase)
  if (!s) { s = { n: 0, total: 0, max: 0, samples: [] }; totals.set(phase, s) }
  s.n++; s.total += ms
  if (ms > s.max) s.max = ms
  if (s.samples.length < MAX_SAMPLES) s.samples.push(ms)
  else s.samples[s.n % MAX_SAMPLES] = ms
}

export function span<T>(phase: string, fn: () => T): T {
  if (!PERF) return fn()
  const t0 = performance.now()
  try { return fn() } finally { note(phase, performance.now() - t0) }
}

export function add(phase: string, ms: number): void {
  if (PERF) note(phase, ms)
}

/** Programs three holds after this frame's draw; a rise means a compile (and link) happened inside it. */
export function programCount(n: number): void {
  if (!PERF) return
  if (programsSeen && n > programsSeen) programsThisFrame += n - programsSeen
  programsSeen = n
}

export function endFrame(now: number): void {
  if (!PERF) return
  if (!observing) startObserver()
  if (lastNow >= 0) {
    const dt = now - lastNow
    if (frameDeltas.length < 20000) frameDeltas.push(dt)
    const h = heap()
    const gc = lastHeap > 0 && h < lastHeap - 1_000_000
    if (gc) gcDrops++
    lastHeap = h
    if (dt > SPIKE_MS) {
      spikes.push({ t: Math.round(now), frameMs: +dt.toFixed(1), phases: Object.fromEntries(Object.entries(frame).map(([k, v]) => [k, +v.toFixed(1)])), programs: programsThisFrame, gc })
      if (spikes.length > 400) spikes.shift()
    }
  }
  lastNow = now
  programsThisFrame = 0
  for (const k of Object.keys(frame)) delete frame[k]
}

function startObserver(): void {
  observing = true
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { longTasks.push({ t: Math.round(e.startTime), ms: +e.duration.toFixed(1) }); if (longTasks.length > 2000) longTasks.shift() }
    }).observe({ type: 'longtask', buffered: true })
  } catch { /* longtask unsupported */ }
}

const pct = (a: number[], q: number): number => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))] }

export function report(): { frames: number; frameP50: number; frameP95: number; frameMax: number; spikes: number; gcDrops: number; longTasks: number; longTaskMs: number; phases: Record<string, PhaseStat>; worstSpikes: Spike[]; spikeShare: Record<string, number> } {
  const phases: Record<string, PhaseStat> = {}
  for (const [k, s] of totals) phases[k] = { n: s.n, totalMs: +s.total.toFixed(1), maxMs: +s.max.toFixed(1), p95Ms: +pct(s.samples, 0.95).toFixed(1) }
  // Where the time of the spike frames went: summed phase ms over every kept spike (phases overlap nothing: they are disjoint spans).
  const spikeShare: Record<string, number> = {}
  for (const sp of spikes) for (const [k, v] of Object.entries(sp.phases)) spikeShare[k] = +((spikeShare[k] ?? 0) + v).toFixed(1)
  return {
    frames: frameDeltas.length, frameP50: +pct(frameDeltas, 0.5).toFixed(1), frameP95: +pct(frameDeltas, 0.95).toFixed(1), frameMax: +Math.max(0, ...frameDeltas).toFixed(1),
    spikes: spikes.length, gcDrops, longTasks: longTasks.length, longTaskMs: +longTasks.reduce((a, b) => a + b.ms, 0).toFixed(1),
    phases, worstSpikes: [...spikes].sort((a, b) => b.frameMs - a.frameMs).slice(0, 15), spikeShare,
  }
}

export function reset(): void {
  totals.clear(); spikes.length = 0; longTasks.length = 0; frameDeltas.length = 0; gcDrops = 0
}

if (PERF) Object.assign(globalThis, { __perf: { report, reset, longTasks } })
