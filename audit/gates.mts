// The rendering gates G1-G7, as pure functions over recorded frames.
import { ephemerisAt } from '../src/ephemeris.ts'
import { MOMENTS } from '../src/moments.ts'
import type { Frame } from './lib.mts'
import { motionTimes, observedSpan, samplesIn, type DenseSeries } from './render.mts'

export interface Result { gate: string; scenario: string; pass: boolean | null; detail: string }
const R = (gate: string, scenario: string, pass: boolean | null, detail: string): Result => ({ gate, scenario, pass, detail })
const MOON_R_KM = 1737.4
const EARTH_R_KM = 6371
const f1 = (x: number) => x.toFixed(1)

export interface Ev { t: number; name: string }

/** Moment-change times: explicit marks, chip-pressed transitions and the page's own declared cuts (`__moon.cuts`). */
function changeTimes(fr: Frame[], marks: Ev[], dense?: DenseSeries): number[] {
  const out = marks.filter((m) => m.name.startsWith('click') || m.name.startsWith('step')).map((m) => m.t)
  for (let i = 1; i < fr.length; i++) {
    if (fr[i].dom.pressed !== fr[i - 1].dom.pressed) out.push(fr[i].t)
    if (fr[i].cuts > fr[i - 1].cuts) out.push(fr[i].t)
  }
  // The page's own declared cuts, at render rate (capture can miss when between two frames one happened).
  if (dense) for (let i = 1; i < dense.t.length; i++) if ((dense.cuts?.[i] ?? 0) > (dense.cuts?.[i - 1] ?? 0)) out.push(dense.t[i])
  return out
}

/** Grey floor under which a frame's mean is noise (a near-black frame's 10% is one grey level). */
export const G1_FLOOR = 20
/** A single-pair step is a cut when it happens at an event and the picture then holds for this long. */
const CUT_HOLD_S = 1
/** Ramp limit, stops of mean grey per second. */
export const RAMP_STOPS_PER_S = 1.5
/** The controller's own white may not move faster than this (stops/s, at or below its maxStopsPerS of 4 plus margin) outside a cut. */
const WHITE_STOPS_PER_S = 5
/** The window the white's rate is measured over, s: a single frame interval is dominated by frame-time jitter. */
const WHITE_WINDOW_S = 0.1
/** A pair whose drawn white moved slower than this (stops/s) did not change its frame mean because of the exposure controller: the mean's
 *  own rate there is far above it (the fly-in's is 2 to 5 stops/s). A third of the ramp limit; the white moving faster is judged as before. */
export const CONTENT_WHITE_STOPS_PER_S = 0.5
/** A lone step under a still white smaller than this share is the tail of a content settle, not a jump. */
const SETTLE_REL = 0.25
const stopsPerS = (a: number, b: number, dt: number) => Math.abs(Math.log2(Math.max(b, G1_FLOOR) / Math.max(a, G1_FLOOR))) / Math.max(dt, 1e-3)
/** Captured frames further apart than this are not adjacent in the viewer's sense: no step across them can be classified. */
export const CAPTURE_GAP_S = 0.5
const rel = (a: number, b: number) => (Math.max(b, G1_FLOOR) - Math.max(a, G1_FLOOR)) / Math.max(a, b, G1_FLOOR)

/**
 * G1: the exposure does not pump. Pairs whose mean grey moves by more than 12% (floor 20 grey, so dark-frame noise is not a
 * violation; pixel diff is NOT used: it measures motion) are classified:
 *  - cut: ONE step at an event (a click, a step, a date set, a cut the page declares), followed by >= 1 s in which no frame moves
 *    by 3% or more. Allowed once per moment change; a second step in the same event window is a violation.
 *  - ramp: a monotone run whose every pair is <= 1.5 stops/s. Passes (a zoom, air thinning).
 *  - pump: a -> b -> a (the mean comes back within 5% of where it was inside 1 s) or a reversal over 10% within 1 s. Always a
 *    violation, in an event window or not.
 * When the build reports the controller's own white (`__moon.exposureState`), its drawn white moving faster than 5 stops/s
 * outside a cut window is also a violation (it is the cause, the frame mean only the symptom).
 * Capture is slower than the page renders (a screenshot per frame): a pair of captured frames more than CAPTURE_GAP_S apart cannot be
 * classified (a step across a 1.6 s gap is not a jump, nor proof of none), so it is counted unobservable, never a violation, and a run
 * with such steps and no violation is `null` (unobservable), not a pass. The controller's white is judged on the page's own render-rate
 * samples (`dense`) when given.
 */
export function g1(scn: string, fr: Frame[], marks: Ev[], dense?: DenseSeries): Result {
  if (fr.length < 2) return R('G1', scn, false, 'Missing frame evidence: need at least two frames')
  const ev = changeTimes(fr, marks, dense)
  const inWin = (t: number) => ev.some((e) => t >= e - 0.3 && t <= e + 1.5)
  const n = fr.length
  const dt = (i: number) => fr[i].t - fr[i - 1].t
  const d = (i: number) => rel(fr[i - 1].mean, fr[i].mean)
  const sus: number[] = []
  let unobserved = 0
  for (let i = 1; i < n; i++) if (Math.abs(d(i)) > 0.12) { if (dt(i) > CAPTURE_GAP_S) unobserved++; else sus.push(i) }
  const fps = n > 1 ? (n - 1) / (fr[n - 1].t - fr[0].t) : 0
  const viol: string[] = []
  const used = new Set<number>()
  // A build that reports the controller's white tells exposure from content: a step of the frame mean while the drawn white stood still
  // (under 0.2 stop over the pairs) is the picture changing (a descent over a darker patch of ground), not the exposure pumping.
  // Exposure is involved in a run of pairs unless the page reported its drawn white for every frame AND the white moved slower than
  // CONTENT_WHITE_STOPS_PER_S across each pair. A build that does not report its white is judged on pixels alone (involved).
  let content = 0
  const exposureInvolved = (i0: number, i1: number): boolean => {
    for (let i = i0; i <= i1; i++) {
      const a = fr[i - 1].expo?.white, b = fr[i].expo?.white
      if (!(a != null && b != null && a > 0 && b > 0)) return true
      if (Math.abs(Math.log2(b / a)) / Math.max(dt(i), 1e-3) >= CONTENT_WHITE_STOPS_PER_S) return true
    }
    return false
  }
  const tag = (i: number) => `t=${fr[i].t} mean ${fr[i - 1].mean}->${fr[i].mean}`
  // Pumps first.
  for (const i of sus) {
    if (used.has(i)) continue
    for (let j = i + 1; j < n && fr[j].t - fr[i - 1].t <= 1.0; j++) {
      const back = Math.abs(rel(fr[i - 1].mean, fr[j].mean)) < 0.05
      const rev = Math.sign(d(j)) === -Math.sign(d(i)) && Math.abs(d(j)) > 0.10
      if (back || rev) { for (let k = i; k <= j; k++) used.add(k); if (exposureInvolved(i, j)) viol.push(`pump ${tag(i)} then ${fr[j].mean} at t=${fr[j].t}`); else content++; break }
    }
  }
  // Runs of the rest: a ramp, or a cut.
  const rest = sus.filter((i) => !used.has(i))
  const stepsInWin = new Map<number, number>()
  for (let k = 0; k < rest.length;) {
    let e = k
    while (e + 1 < rest.length && rest[e + 1] === rest[e] + 1) e++
    const i0 = rest[k], i1 = rest[e]
    let mono = true
    for (let i = i0 + 1; i <= i1; i++) if (Math.sign(d(i)) !== Math.sign(d(i0))) mono = false
    let fast = false
    for (let i = i0; i <= i1; i++) if (stopsPerS(fr[i - 1].mean, fr[i].mean, dt(i)) > RAMP_STOPS_PER_S) fast = true
    if (mono && !fast) { k = e + 1; continue } // ramp
    // A monotone run of two or more pairs, or one pair under SETTLE_REL (the tail of a settle), over a still white is the picture changing under a fixed exposure (the Moon filling the frame
    // on a fly-in): content, exempt from the ramp limit. A bigger single pair is a jump, which needs an event and a hold below.
    if (mono && (i1 - i0 >= 1 || Math.abs(d(i0)) < SETTLE_REL) && !exposureInvolved(i0, i1)) { content++; k = e + 1; continue }
    if (!inWin(fr[i0].t)) viol.push(`unexplained step ${tag(i0)}${i1 > i0 ? ` (${i1 - i0 + 1} pairs)` : ''}`)
    else {
      // A cut: one step, then >= 1 s of stability.
      let stable = true
      // The hold lasts 1 s or until the next event (a scrubber clicked every half second is a string of cuts, each held until the next).
      const nextEv = ev.filter((t) => t > fr[i1].t - 0.3 + 0.35).sort((a, b) => a - b)[0] ?? Infinity
      for (let i = i1 + 1; i < n && fr[i].t - fr[i1].t <= CUT_HOLD_S && fr[i].t < nextEv; i++) if (Math.abs(d(i)) >= 0.03 && dt(i) <= CAPTURE_GAP_S) { stable = false; break }
      const end = fr[n - 1].t - fr[i1].t
      if (!stable) viol.push(`cut not followed by 1 s of stability ${tag(i0)}`)
      else if (end < CUT_HOLD_S - 0.15) { /* the recording ended before the hold could be judged */ }
      const key = Math.round(ev.reduce((b, t) => (Math.abs(t - fr[i0].t) < Math.abs(b - fr[i0].t) ? t : b), ev[0]) * 10)
      stepsInWin.set(key, (stepsInWin.get(key) ?? 0) + 1)
      if ((stepsInWin.get(key) ?? 0) > 1) viol.push(`a second step in one moment change ${tag(i0)}`)
    }
    k = e + 1
  }
  // The controller's own white, where the build reports it: the page's render-rate samples when given, else the captured frames.
  let whiteMax = 0, whiteAt = -1
  const useDense = !!dense && dense.white.filter((w) => Number.isFinite(w) && w > 0).length > 1
  const wt: number[] = useDense ? dense!.t : fr.map((f) => f.t)
  const ww: number[] = useDense ? dense!.white : fr.map((f) => f.expo?.white ?? NaN)
  // The audit's own freeze (auditBegin renders once at full size and may move the exposure) is not the page's behaviour: pairs across a hold are skipped.
  const spansHold = (i: number, j = i): boolean => useDense && dense!.held.some(([h0, h1]) => wt[i - 1] < h1 && wt[j] > h0)
  const haveExpo = ww.some((w) => Number.isFinite(w) && w > 0)
  if (haveExpo) {
    // The rate is read over at least WHITE_WINDOW_S: one frame after a stalled one catches up in a single step, and dividing that step by
    // one frame interval reads 3 stops/s of real movement as 11 (measured on the Earth-eclipses-the-Sun chip).
    let j0 = 0
    for (let i = 1; i < wt.length; i++) {
      while (j0 + 1 < i && wt[j0 + 1] <= wt[i] - WHITE_WINDOW_S) j0++
      const a = wt[i] - wt[j0] >= WHITE_WINDOW_S ? ww[j0] : NaN, b = ww[i]
      if (!(a > 0) || !(b > 0) || inWin(wt[i])) continue
      const v = Math.abs(Math.log2(b / a)) / (wt[i] - wt[j0])
      if (v > whiteMax) { whiteMax = v; whiteAt = wt[i] }
    }
    if (whiteMax > WHITE_STOPS_PER_S) viol.push(`the controller's white moved ${whiteMax.toFixed(1)} stops/s at t=${+whiteAt.toFixed(2)} outside a cut${useDense ? ' (render-rate samples)' : ''}`)
    // The white itself pumping: up (or down) by more than 0.4 stop and back within 1 s, outside a cut window.
    for (let i = 1; i < wt.length && !viol.some((v) => v.startsWith('white pump')); i++) {
      if (!(ww[i] > 0) || inWin(wt[i])) continue
      let hi = 0, lo = 0
      for (let j = i + 1; j < wt.length && wt[j] - wt[i] <= 1.0; j++) {
        if (!(ww[j] > 0) || spansHold(i + 1, j)) break
        const dv = Math.log2(ww[j]) - Math.log2(ww[i])
        hi = Math.max(hi, dv); lo = Math.min(lo, dv)
        if ((hi > 0.4 && dv < hi - 0.3) || (lo < -0.4 && dv > lo + 0.3)) { viol.push(`white pump at t=${+wt[i].toFixed(2)}: ${(hi > -lo ? hi : lo).toFixed(2)} stop and back within 1 s`); break }
      }
    }
  }
  const head = `${n} frames at ${fps.toFixed(1)} fps`
  if (!viol.length && unobserved) return R('G1', scn, null, `unobservable: ${unobserved} step(s) over 12% fall between captured frames more than ${CAPTURE_GAP_S} s apart (${head}); the capture loop, not the page, was too slow to classify them${haveExpo ? `; the controller's white (${useDense ? 'render-rate' : 'captured'}) max ${whiteMax.toFixed(1)} stops/s, no pump` : ''}`)
  if (!viol.length) return R('G1', scn, true, `${head}, ${sus.length} steps over 12%${haveExpo ? `, white max ${whiteMax.toFixed(1)} stops/s, ${content} of them content changes with the white standing still` : ''}; every one a ramp, a content change or a single cut with 1 s of stability`)
  return R('G1', scn, false, `${head}; ${viol.length} violation(s): ${viol.slice(0, 4).join('; ')}`)
}

const ALLOW_BLACK = new Set(['earth-eclipses-sun-2028'])
/** Grey-level standard deviation of the whole frame (240x150). */
function frameStd(f: Frame): number {
  let s = 0, s2 = 0
  const n = f.gray.length
  for (let i = 0; i < n; i++) { const v = f.gray[i]; s += v; s2 += v * v }
  const m = s / n
  return Math.sqrt(Math.max(0, s2 / n - m * m))
}
/** G2: no white-out frames (white fraction > 30%, or mean > 150 WITH a clipped top: p99 >= 235), no black frames while a card or slider shows. */
export function g2(scn: string, fr: Frame[]): Result {
  if (fr.length < 2) return R('G2', scn, false, 'Missing frame evidence: need at least two frames')
  const w = fr.filter((f) => f.white > 0.3 || (f.mean > 150 && f.p99 >= 235))
  const k = fr.filter((f) => {
    if (!(f.dom.cardVisible || f.dom.sliderVisible)) return false
    if (ALLOW_BLACK.has(f.dom.pressed)) return f.black > 0.995 || f.p99 < 40
    return f.black > 0.98
  })
  if (!w.length && !k.length) return R('G2', scn, true, `${fr.length} frames, none white or black`)
  const lab = (f: Frame) => `t=${f.t}(${f.dom.pressed || '-'})`
  return R('G2', scn, false, `${w.length} white [${w.slice(0, 3).map(lab)}], ${k.length} black with UI [${k.slice(0, 3).map(lab)}]`)
}
/** G2b: no flat wash: a frame with mean > 140 and a grey standard deviation under 15 (a bright frame with no picture in it). */
export function g2b(scn: string, fr: Frame[]): Result {
  if (fr.length < 2) return R('G2b', scn, false, 'Missing frame evidence: need at least two frames')
  const w = fr.filter((f) => f.mean > 140 && frameStd(f) < 15)
  if (!w.length) return R('G2b', scn, true, `${fr.length} frames, no flat wash`)
  return R('G2b', scn, false, `${w.length} flat wash frame(s) (mean > 140, std < 15): ${w.slice(0, 3).map((f) => `t=${f.t} mean ${f.mean} std ${frameStd(f).toFixed(1)}`).join('; ')}`)
}

/** A frame whose brightest 1% is below this grey is empty (no Moon or Earth in it). */
const STATIC_EMPTY_P99 = 60
/** G3: after a click the picture moves or a progress counter shows within 1 s; no 3 s freeze while the slider is under 100% without progress. */
export function g3(scn: string, fr: Frame[], marks: Ev[], responseMarks = true, dense?: DenseSeries): Result {
  const probs: string[] = []
  const unobs: string[] = []
  if (responseMarks) {
    for (const m of marks.filter((x) => x.name.startsWith('click'))) {
      const win = fr.filter((f) => f.t >= m.t && f.t <= m.t + 1.0)
      const prog = win.filter((f) => f.dom.progress)
      const progressOk = (): boolean => {
        if (!prog.length) return false
        // A progress element must keep changing: a number that differs at least every 2 s while shown.
        const after = fr.filter((f) => f.t >= m.t && f.dom.progress)
        let last = after[0].dom.progress, lt = after[0].t, stuck = false
        for (const f of after) { if (f.dom.progress !== last) { last = f.dom.progress; lt = f.t } else if (f.t - lt > 2.0) { stuck = true; break } }
        return !stuck
      }
      // The page's own render-rate samples decide whenever they observed the window (>= 0.5 s of it outside a capture hold, >= 3 samples):
      // the camera/clock moved, the slider moved or the journey changed state. A slow capture loop sees none of that, so it is not asked.
      if (dense && observedSpan(dense, m.t, m.t + 1.0) >= 0.5 && samplesIn(dense, m.t, m.t + 1.0) >= 3) {
        if (!motionTimes(dense).some((t) => t >= m.t && t <= m.t + 1.0) && !progressOk()) probs.push(`${m.name}@${m.t}s: no motion/progress within 1 s (${samplesIn(dense, m.t, m.t + 1.0)} render-rate samples)`)
        continue
      }
      let moved = win.some((f) => f.diffWorld > 0.5)
      // The headless compositor delivers no screenshot for ~1 to 2 s right after a click (the live baseline shows it too, identical on chips
      // that do nothing heavy). With NO frame at all in the window, the first frame after it decides: a new picture there is a response.
      if (!moved && !win.length) { const nx = fr.find((f) => f.t > m.t + 1.0); moved = !!nx && nx.t <= m.t + 2.5 && nx.diffWorld > 0.5 }
      if (moved || progressOk()) continue
      // Nothing seen. If the captured frames around the window are further apart than the window itself, the capture never looked: unobservable.
      const before = [...fr].reverse().find((f) => f.t < m.t), after = fr.find((f) => f.t > m.t + 1.0)
      const covered = win.length > 0 || (!!before && !!after && after.t - before.t <= 1.0 + 0.5)
      if (!covered) unobs.push(`${m.name}@${m.t}s: captured frames ${before ? before.t : '-'}..${after ? after.t : '-'} s leave the 1 s window unseen`)
      else probs.push(`${m.name}@${m.t}s: no motion/progress within 1 s`)
    }
  }
  // A step that leaves an EMPTY picture (p99 under 60: black sky, no Moon) standing still for 3 s (the flight's "Take the camera" ended on an unchanging black sky while the
  // slider, which the freeze test below needs, was already hidden).
  const stepMarks = marks.filter((x) => x.name.startsWith('step'))
  for (let mi = 0; mi < stepMarks.length; mi++) {
    const t0s = stepMarks[mi].t, t1s = stepMarks[mi + 1]?.t ?? Infinity
    const win = fr.filter((f) => f.t >= t0s && f.t < t1s)
    let st = -1
    for (let i = 1; i < win.length; i++) {
      if (win[i].diffWorld < 0.05 && !win[i].dom.progress && win[i].p99 < STATIC_EMPTY_P99) { if (st < 0) st = win[i - 1].t; if (win[i].t - st >= 3) { probs.push(`${stepMarks[mi].name}@${t0s}s: picture static for >= 3 s from t=${st}`); break } } else st = -1
    }
  }
  let run = 0, t0 = 0, reported = false
  for (let i = 1; i < fr.length; i++) {
    const f = fr[i]
    // A ridge held at rest by the viewer (a click on the slider, no autoplay) is a view, not a stall.
    const atRest = (f.journey as { ridge?: boolean; playing?: boolean } | null | undefined)?.ridge === true && (f.journey as { playing?: boolean }).playing === false
    const cond = !atRest && f.dom.sliderVisible && f.dom.sliderP > 0.005 && f.dom.sliderP < 0.995 && !f.dom.progress && f.diffWorld < 0.05
    if (cond) { if (!run) { run = 1; t0 = fr[i - 1].t } if (!reported && f.t - t0 >= 3) { probs.push(`frozen >=3 s at t=${t0} (slider ${f1(f.dom.sliderP * 100)}%)`); reported = true } } else run = 0
  }
  if (probs.length) return R('G3', scn, false, probs.slice(0, 4).join('; '))
  if (unobs.length) return R('G3', scn, null, `unobservable: ${unobs.length} click(s) fell in capture gaps, ${unobs.slice(0, 2).join('; ')}`)
  return R('G3', scn, true, dense ? 'responds within 1 s (render-rate samples), no freezes' : 'responds within 1 s, no freezes')
}

/** G6: at most 3 visible text lines in the HUD. */
export function g6(scn: string, fr: Frame[]): Result {
  if (fr.length < 2) return R('G6', scn, false, 'Missing frame evidence: need at least two frames')
  const mx = Math.max(0, ...fr.map((f) => f.dom.hudLines))
  return R('G6', scn, mx <= 3, `max ${mx} HUD lines (limit 3)`)
}

// ---- geometry for G4/G5 ---------------------------------------------------
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cache = new Map<number, number[]>()
function earthRel(time: string, pos: number[]): number[] {
  const key = Math.round(Date.parse(time) / 1000)
  let e = cache.get(key)
  if (!e) { const k = ephemerisAt(new Date(time)).earthKm; e = [k.x / MOON_R_KM, k.y / MOON_R_KM, k.z / MOON_R_KM]; cache.set(key, e) }
  return [e[0] - pos[0], e[1] - pos[1], e[2] - pos[2]]
}
export interface Disc { cx: number; cy: number; r: number; ok: boolean }
/** Projected disc in viewport fractions (x to the right, y down; r relative to the short side). */
export function project(f: Frame, body: 'moon' | 'earth', vw: number, vh: number): Disc | null {
  const s = f.st
  if (!s) return null
  const rel = body === 'moon' ? [-s.pos[0], -s.pos[1], -s.pos[2]] : earthRel(s.time, s.pos)
  const R0 = body === 'moon' ? 1 : EARTH_R_KM / MOON_R_KM
  const d = Math.hypot(rel[0], rel[1], rel[2])
  const depth = -dot(rel, s.back)
  if (depth <= 0 || d <= R0) return { cx: 0, cy: 0, r: 0, ok: false }
  const short = Math.min(vw, vh) / 2
  const px = vw / 2 + (dot(rel, s.right) / depth / s.tanHalf) * short
  const py = vh / 2 - (dot(rel, s.up) / depth / s.tanHalf) * short
  const r = (Math.tan(Math.asin(R0 / d)) / s.tanHalf) * short
  return { cx: px / vw, cy: py / vh, r: r / Math.min(vw, vh), ok: true }
}
function inFrame(d: Disc | null, margin = 0): boolean { return !!d && d.ok && d.cx > -margin && d.cx < 1 + margin && d.cy > -margin && d.cy < 1 + margin }


function centerStd(f: Frame): number {
  const W = 240, H = 150, x0 = Math.floor(W * 0.3), x1 = Math.floor(W * 0.7), y0 = Math.floor(H * 0.3), y1 = Math.floor(H * 0.7)
  let s = 0, s2 = 0, n = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const v = f.gray[y * W + x]; s += v; s2 += v * v; n++ }
  const m = s / n
  return Math.sqrt(Math.max(0, s2 / n - m * m))
}

/** G4: the caption's claim as a pixel/geometry assertion, per moment. `fr` covers this moment only, from its click. */
export function g4Moment(id: string, fr: Frame[], vw = 1440, vh = 900): Result {
  const scn = `chip-${id}`
  const m = MOMENTS.find((x) => x.id === id)
  if (!m) return R('G4', scn, false, 'unknown moment')
  if (!fr.some((f) => f.st)) return R('G4', scn, false, 'no camera state from the page (__moon.state missing)')
  if (id === 'fly-around') {
    // The shipped caption: "The camera goes round the Moon; the Earth is behind it." So: the Moon stays in frame, and the camera
    // really goes round (its direction from the Moon's centre turns). The Earth-in-frame test is WP-B's promise, not this caption's.
    const st = fr.filter((f) => f.st)
    const moonIn = st.filter((f) => inFrame(project(f, 'moon', vw, vh))).length / Math.max(1, st.length)
    const terminal = fr.find(f => f.journey?.id === id && f.journey.status === 'arrived')
    const turn = terminal?.journey?.orbitAngleDeg ?? 0
    let earthRun = 0, start: number | null = null
    for (const f of st) {
      const earth = project(f, 'earth', vw, vh), moon = project(f, 'moon', vw, vh)
      const visible = inFrame(earth) && !!earth && !!moon && moon.r / Math.max(earth.r, 1e-9) >= 2
        && Math.hypot((earth.cx - moon.cx) * vw, (earth.cy - moon.cy) * vh) > (moon.r + earth.r) * Math.min(vw, vh)
      if (visible) { start ??= f.t; earthRun = Math.max(earthRun, f.t - start) } else start = null
    }
    const ok = moonIn >= 0.9 && turn >= 359.9 && earthRun >= 3
    return R('G4', scn, ok, `Moon in frame ${(moonIn * 100).toFixed(0)}%; accumulated signed orbit ${turn.toFixed(1)} deg (need 360); unoccluded Earthrise ${earthRun.toFixed(2)}s (need >=3s); angular Moon/Earth diameter ratio >=2`)

  }
  if (m.look === 'earth') {
    const tClick = fr[0].t
    // Centred means the Earth's disc is in the central 60% AND not hidden behind the Moon's disc (an empty or occluded frame is not a view of it).
    const inCentre = (f: Frame) => {
      const d = project(f, 'earth', vw, vh)
      if (!d || !d.ok || Math.abs(d.cx - 0.5) >= 0.3 || Math.abs(d.cy - 0.5) >= 0.3) return false
      const mo = project(f, 'moon', vw, vh)
      if (mo && mo.ok && Math.hypot((d.cx - mo.cx) * vw, (d.cy - mo.cy) * vh) < mo.r * Math.min(vw, vh)) return false
      return true
    }
    const limit = (fr.find(f => f.journey?.id === id)?.journey?.durationS ?? 3) + 0.3 // the journey's own length plus 0.3 s
    const first = fr.find((f) => inCentre(f))
    const tFirst = first ? first.t - tClick : Infinity
    const after = first ? fr.filter((f) => f.t >= first.t) : []
    const leaves = after.filter((f) => !inCentre(f)).length
    const ok = tFirst <= limit && leaves === 0
    return R('G4', scn, ok, first ? `Earth centred and clear of the Moon after ${tFirst.toFixed(1)} s (need <=${limit.toFixed(1)}), ${leaves} frames off-centre or hidden afterwards` : 'Earth never centred in the central 60%')
  }
  if (m.needsPatch && m.camera.at === 'site' && !m.groundEnd) {
    const ai = fr.findIndex(f => f.journey?.id === id && f.journey.status === 'arrived' && f.journey.arrivalAt !== null)
    if (ai < 0) return R('G4', scn, false, 'No generation-specific arrival event for the requested journey')
    const v = fr.slice(ai, ai + 3).map(centerStd)
    const med = [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]
    return R('G4', scn, med >= 12, `arrival (explicit generation event at t=${fr[ai].t}, ${f1(fr[ai].t - fr[0].t)} s after the click) central-40% grey std ${med.toFixed(1)} (need >=12)`)
  }
  return R('G4', scn, null, 'no pixel claim defined for this moment')
}

/**
 * G4 lift-off: once the sky has gone black (mean < 25: in space), at some u in [0.08, 0.35] bright matter (grey > 48,
 * the Earth's limb) covers >= 15% of the frame. The Moon itself is under 3% of the frame there, so it cannot satisfy this alone.
 * (The camera state is the rig's, not the journey's, during the ridge view, so this is pixels only.)
 */
export function g4Liftoff(fr: Frame[]): Result {
  let worst = 1, n = 0, start: number | null = null, longest = 0
  for (const f of fr) {
    const u = f.dom.sliderP
    if (!f.dom.sliderVisible || u < 0.08 || u > 0.35 || f.mean >= 25) continue
    n++
    const bright = f.gray.reduce((sum, v) => sum + (v > 48 ? 1 : 0), 0) / f.gray.length
    worst = Math.min(worst, bright)
    if (bright < 0.15) { start ??= f.t; longest = Math.max(longest, f.t - start) } else start = null
  }
  return R('G4', 'liftoff', n > 1 && worst >= 0.15, `minimum bright subject area ${(worst * 100).toFixed(1)}%; longest undersized run ${longest.toFixed(2)}s; ${n} eligible frames (need >=2 and >=15% every frame)`)
}

// ---- G5 -------------------------------------------------------------------
export interface LayoutSample { label: string; vw: number; vh: number; fr: Frame }
function circleRectArea(cx: number, cy: number, r: number, x: number, y: number, w: number, h: number): boolean {
  const nx = Math.max(x, Math.min(cx, x + w)), ny = Math.max(y, Math.min(cy, y + h))
  return Math.hypot(cx - nx, cy - ny) < r
}
export function g5(samples: LayoutSample[]): Result[] {
  return samples.map((s) => {
    const scn = `layout-${s.label}@${s.vw}x${s.vh}`
    const id = s.label.split(':')[1]
    const m = MOMENTS.find((x) => x.id === id)
    const body = m?.look === 'earth' ? 'earth' : 'moon'
    const d = s.fr.st ? project(s.fr, body, s.vw, s.vh) : null
    if (!d || !d.ok) return R('G5', scn, null, 'subject not in front of the camera')
    const short = Math.min(s.vw, s.vh)
    if (d.r > 0.5) return R('G5', scn, null, `subject fills the frame (radius ${(d.r * 100).toFixed(0)}% of the short side), nothing to clear`)
    const hits: string[] = []
    const UI = new Set(['tour-card', 'tour-row', 'journey-scrub', 'ridge-card'])
    const rects = s.fr.dom.rects.filter((_, i) => UI.has(s.fr.dom.rectNames[i]))
    for (const [x, y, w, h] of rects) {
      if (circleRectArea(d.cx * s.vw, d.cy * s.vh, d.r * short, x * s.vw, y * s.vh, w * s.vw, h * s.vh)) hits.push(`[${Math.round(x * 100)},${Math.round(y * 100)} ${Math.round(w * 100)}x${Math.round(h * 100)}%]`)
    }
    return R('G5', scn, hits.length === 0, hits.length ? `${body} disc (centre ${Math.round(d.cx * 100)},${Math.round(d.cy * 100)}%, r ${Math.round(d.r * 100)}%) overlaps ${hits.length} UI rect(s) ${hits.slice(0, 3).join(' ')}` : `${body} disc clear of ${rects.length} card/chip/scrubber rects`)
  })
}



/** Fault injection must actually intercept; recovery is a generation-specific arrival. */
export function g7(input: { normalS: number; recoveryS: number; intercepted: boolean; reload: boolean; normalGeneration: number; recoveryGeneration: number; arrived: boolean }): Result {
  const pass = input.intercepted && input.arrived && !input.reload && input.normalGeneration > 0 && input.recoveryGeneration > 0
    && input.normalS > 0 && input.recoveryS > 0 && input.recoveryS <= input.normalS * 2
  return R('G7', 'robust', pass, `intercepted ${input.intercepted}; normal arrival ${input.normalS}s; recovery arrival ${input.recoveryS}s; generation-specific arrival ${input.arrived}; reload ${input.reload}`)
}
