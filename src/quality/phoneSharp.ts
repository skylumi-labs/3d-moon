/**
 * Phone motion policy (`?phonesharp=1`, default on for the touch classes on the web; `?phonesharp=0` restores the old ladders).
 *
 * Owner on an Android phone (2026-10-29): "quality is horrible", blurry and blocky while the Moon moves. A moving phone frame was drawn at
 * `grid x motionDpr / restDpr` of the canvas width: 0.35 x 1.5 / 2 = 0.26 far out, 0.25 x 1.25 / 2 = 0.16 close in, i.e. 129 to 216 px across an
 * 824 px canvas, magnified 4 to 6x (reviewed). The metric this policy is judged by is the effective motion
 * render fraction f = render width / canvas width, not the frame rate.
 *
 * The policy: ONE number, f, for every moving frame (gesture, fly-to, cinematic flight, the Fly-around orbit, the intro); no DPR x grid stacking.
 * f starts at the target (PHONE_TARGET_PX_PER_CSS rendered px per CSS px, never under PHONE_FLOOR_F of the canvas). When frames run over budget the
 * cadence drops to a steady 30 fps FIRST, and only if 30 fps is still over budget does f drop to the floor; it never goes under the floor (a slow
 * phone then runs slower than 30, sharp). Tile uploads and shadow builds keep their ordinary per-frame budget in motion (nothing is deferred
 * wholesale, unlike `?motion=sharp`'s cutCost).
 * Moments (a cinematic flight, a fly-to, the Fly-around orbit) run at a steady 30 fps from their first frame (owner 2026-10-29: "a steady 30 fps on
 * phones during moments in exchange for a sharp picture is accepted"); gestures keep 60 fps until the pacer says otherwise.
 * Pure functions and one pacer; main.ts owns the wiring.
 */
import type { QualityClass } from './startupClass'

/** Flipped after the rig run (forced phone grid vs this policy at the same budget). `?phonesharp=0` is the opt-out. */
export const PHONE_SHARP_DEFAULT = true
/** Touch classes only; desktop and software are never touched whatever the URL says. */
export const PHONE_SHARP_CLASSES: readonly QualityClass[] = ['ios', 'ipad', 'phone-android', 'tablet']

/** The hard floor of f in motion (half the canvas width: 1 rendered px per CSS px at rest ratio 2). */
export const PHONE_FLOOR_F = 0.5
/** The aim: rendered px per CSS px in motion (1.25: f = 0.625 at rest ratio 2). */
export const PHONE_TARGET_PX_PER_CSS = 1.25

/** `?phonesharp=1|0`; null when absent or anything else. */
export function phoneSharpFromSearch(search: string): boolean | null {
  const v = new URLSearchParams(search).get('phonesharp')
  return v === '1' ? true : v === '0' ? false : null
}

/** Whether the policy runs: web, a touch class, not switched off. An explicit `?motion=sharp` wins (the full-resolution policy is its own arm). */
export function resolvePhoneSharp(cls: QualityClass, search: string, nativeShell = false, dflt = PHONE_SHARP_DEFAULT): boolean {
  if (nativeShell || !PHONE_SHARP_CLASSES.includes(cls)) return false
  if (new URLSearchParams(search).get('motion') === 'sharp') return false
  return phoneSharpFromSearch(search) ?? dflt
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** The target f for a canvas at `restDpr` (canvas px per CSS px): PHONE_TARGET_PX_PER_CSS / restDpr, within [floor, 1]. */
export function phoneTargetF(restDpr: number, floor = PHONE_FLOOR_F, pxPerCss = PHONE_TARGET_PX_PER_CSS): number {
  if (!(restDpr > 0) || !Number.isFinite(restDpr)) return 1
  return clamp(pxPerCss / restDpr, floor, 1)
}

/** `?phonef=0.5`: force f (0.1..1) for an A/B; undefined otherwise. Measurement only. */
export function phoneForcedF(search: string): number | undefined {
  const raw = new URLSearchParams(search).get('phonef')
  if (raw === null || raw.trim() === '') return undefined
  const v = Number(raw)
  return Number.isFinite(v) && v >= 0.1 && v <= 1 ? v : undefined
}
/** `?phonehz=30|60`: force the cadence tier for an A/B; undefined otherwise. */
export function phoneForcedHz(search: string): 30 | 60 | undefined {
  const v = new URLSearchParams(search).get('phonehz')
  return v === '30' ? 30 : v === '60' ? 60 : undefined
}

/** The scripted camera states main.ts reads; every one of them is a moment (30 fps under the policy). */
export interface ScriptedMotion {
  tween: boolean; cinematic: boolean; orbit: boolean; intro: boolean; descent: boolean; flight: boolean; ridge: boolean; route: boolean
  /** A rig fly-to (glideTo), or a ground-camera glide (eye level, a preset, the climb out). */
  rigGlide: boolean; groundGlide: boolean
}
/** True when any scripted camera move owns the frame: fly-tos, cinematic flights, the orbit, the intro, a descent, a descent flight, the ridge, a route flight, glides. */
export function phoneMoment(m: ScriptedMotion): boolean {
  return m.tween || m.cinematic || m.orbit || m.intro || m.descent || m.flight || m.ridge || m.route || m.rigGlide || m.groundGlide
}

/** Whether the hand-back's frame is a rest sample for the rest governor under the phone policy: a full-size frame actually drawn (not held, not a cache build), none pending, no capture. */
export function phoneRestSample(i: { phone: boolean; scale: number; settleHeld: boolean; buildOnly: boolean; pending: boolean; capture: boolean }): boolean {
  return i.phone && i.scale === 1 && !i.settleHeld && !i.buildOnly && !i.pending && !i.capture
}

// --- Pacing: target f at 60, then target f at 30, then the floor at 30 ---

/** A gap over this share of the tier period is slow; within HEALTHY it is healthy. */
export const PHONE_SLOW_TOL = 1.2
export const PHONE_HEALTHY_TOL = 1.1
/** Gaps over this are a pause, not a frame. */
export const PHONE_IGNORE_MS = 1500
/**
 * The step-down trigger. A wall gap alone is not evidence of GPU cost: a tile upload or JS spike makes isolated long gaps (measured 2026-10-29 on the L4: the
 * old flight ladder fell to grid 0.25 on Copernicus at 3.5 ms GPU p50). So a level steps down only when PHONE_SLOW_IN_WINDOW of the last PHONE_SLOW_WINDOW
 * drawn frames were slow, and a slow gap does not count while the GPU's own time (the disjoint timer query, when the device has it) is under
 * PHONE_GPU_VETO of the period: then the gap was the CPU's, and a lower cadence or resolution would not fix it.
 */
export const PHONE_SLOW_WINDOW = 12
export const PHONE_SLOW_IN_WINDOW = 8
export const PHONE_GPU_VETO = 0.75
/** Kept for the tests' arithmetic: frames of a fully slow run that step one level down. */
export const PHONE_SLOW_FRAMES = PHONE_SLOW_IN_WINDOW
/** Frames drawn on a lower level before the level above is probed; doubled after each failed probe, up to PHONE_PROBE_MAX. */
export const PHONE_PROBE_FRAMES = 180
export const PHONE_PROBE_MAX = 1440
/** A probe lasts this many frames; PHONE_PROBE_SLOW slow frames inside it send the pacer back down. */
export const PHONE_PROBE_LEN = 30
export const PHONE_PROBE_SLOW = 3

/**
 * Levels. Phone ladder: 0 target f at 60 fps, 1 target f at 30 fps, 2 floor f at 30 fps (cadence before resolution; moments always 30 fps).
 * Desktop ladder (`?desktopsharp`): 0 target f at 60, 1 floor f at 60, 2 floor f at 30 (a desktop keeps 60 fps unless consistently slow; f never under the
 * floor; moments run at the gesture cadence).
 */
export type PhoneLevel = 0 | 1 | 2

export interface SharpParams {
  ladder: 'phone' | 'desktop'
  /** f never goes under this. */
  floor: number
  /** The target f for a canvas at `restDpr`. */
  target: (restDpr: number) => number
  /** Moments (scripted moves) at a steady 30 fps from their first frame. */
  momentsAt30: boolean
  /** Drawn frames of a vetoed slow run before the veto expires (PHONE_VETO_EXPIRE on desktop); Infinity = never (phones: #365's veto, unchanged). */
  vetoExpire: number
}
export const PHONE_PARAMS: SharpParams = { ladder: 'phone', floor: PHONE_FLOOR_F, target: (r) => phoneTargetF(r), momentsAt30: true, vetoExpire: Infinity }

/** Desktop: the floor and the aim, fractions of the canvas (the canvas is at the rest DPR, so f 1 is a rest-size frame). */
export const DESKTOP_FLOOR_F = 0.75
export const DESKTOP_TARGET_F = 1
export const DESKTOP_PARAMS: SharpParams = { ladder: 'desktop', floor: DESKTOP_FLOOR_F, target: () => DESKTOP_TARGET_F, momentsAt30: false, vetoExpire: 60 }

/** `?desktopsharp=1|0`; null when absent or anything else. */
export function desktopSharpFromSearch(search: string): boolean | null {
  const v = new URLSearchParams(search).get('desktopsharp')
  return v === '1' ? true : v === '0' ? false : null
}
export const DESKTOP_SHARP_DEFAULT = true
/** Whether the desktop policy runs: the desktop class on the web, not switched off; an explicit `?motion=sharp` wins. */
export function resolveDesktopSharp(cls: QualityClass, search: string, nativeShell = false, dflt = DESKTOP_SHARP_DEFAULT): boolean {
  if (nativeShell || cls !== 'desktop') return false
  if (new URLSearchParams(search).get('motion') === 'sharp') return false
  return desktopSharpFromSearch(search) ?? dflt
}
/** The params for a class when either policy runs; null when neither does. */
export function sharpParamsFor(cls: QualityClass, search: string, nativeShell = false): SharpParams | null {
  if (resolvePhoneSharp(cls, search, nativeShell)) return PHONE_PARAMS
  if (resolveDesktopSharp(cls, search, nativeShell)) return DESKTOP_PARAMS
  return null
}

// --- The motion pixel cap (desktop): render px of a moving frame <= DESKTOP_MOTION_MP megapixels ---

/**
 * Owner decision O13 (2026-10-29, decided: "cap (a)", about 8 MP on very large desktop canvases, rest unaffected): on a very large canvas (the owner's Mac is 5120x2880) a moving frame keeps at most
 * DESKTOP_MOTION_MP megapixels of render pixels; `?motionmp=0` removes the cap. Why (L4 VMs, not the Mac's GPU): at f 0.75 on the 16 Mpx canvas of 2560x1600@2,
 * Copernicus ran at a frame gap p50 of 50 ms on one L4 VM, and at p50 33.4 / 33.4 ms (n=2, the 30 fps tier, GPU 27 ms) on another; the cap took the GPU
 * to 22 ms there (the experiments ledger, "Desktop motion policy", names both runs). The cap applies AFTER the f ladder: f = min(ladder f, the largest f whose rounded w x h fits the cap),
 * so f goes under the desktop floor 0.75 only on a canvas where f 0.75 already exceeds the cap (canvas > cap / 0.5625 = 14.2 Mpx at 8 MP).
 * Two bounds: a capped f of CAP_SNAP_F or more is not applied (a 3840x2160 canvas would move at 0.982 and pay a resample for 2% of the pixels: it stays at
 * the ladder's f, 8.3 MP), and the cap never takes f under CAP_FLOOR_F (7680x4320 -> 0.5, 8.3 MP; a tiny `?motionmp=` -> 0.5).
 * Desktop ladder only: phones keep #365's policy (their canvases are under the cap anyway). A forced `?phonef=` is not capped (measurement arm).
 */
export const DESKTOP_MOTION_MP = 8
/** A capped f at or over this is not applied (see above). */
export const CAP_SNAP_F = 0.95
/** The cap never takes f under this. */
export const CAP_FLOOR_F = 0.5

/** `?motionmp=<megapixels>`: 0 = no cap, a positive number sets it; null when absent or not a number >= 0. */
export function motionMpFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get('motionmp')
  if (raw === null || raw.trim() === '') return null
  const v = Number(raw)
  return Number.isFinite(v) && v >= 0 ? v : null
}

/** The render-pixel cap of a moving frame for these params: DESKTOP_MOTION_MP (or `?motionmp=`) x 1e6 on the desktop ladder; Infinity (no cap) otherwise or at 0. */
export function motionPxCapFor(params: SharpParams | null, search: string): number {
  if (!params || params.ladder !== 'desktop') return Infinity
  const mp = motionMpFromSearch(search) ?? DESKTOP_MOTION_MP
  return mp > 0 ? mp * 1e6 : Infinity
}

/** Render dims of f on a cw x ch canvas, as renderDims rounds them (quality/sharpMotion.ts, policy 'phone'). */
const fDims = (f: number, cw: number, ch: number): number => Math.max(64, Math.round(cw * f)) * Math.max(64, Math.round(ch * f))

/**
 * f after the pixel cap: min(f, the largest f whose rounded render size w x h is <= capPx), within [CAP_FLOOR_F, f]; f itself when that is CAP_SNAP_F or more.
 * The closed form sqrt(capPx / (cw x ch)) is stepped down by one long-side pixel until the rounded size fits (at most a few steps). The cap bound when the
 * result is under f. Returns a number (called 2-3 times per moving frame: no allocation).
 */
export function capMotionF(f: number, cw: number, ch: number, capPx: number): number {
  if (!(capPx > 0) || !Number.isFinite(capPx) || !(cw > 0) || !(ch > 0) || fDims(f, cw, ch) <= capPx) return f
  let c = Math.min(f, Math.sqrt(capPx / (cw * ch)))
  const step = 1 / Math.max(cw, ch)
  for (let i = 0; i < 8 && fDims(c, cw, ch) > capPx && c > step; i++) c -= step
  if (c >= CAP_SNAP_F) return f
  return Math.min(f, Math.max(CAP_FLOOR_F, c))
}

export const phoneLevelHz = (l: PhoneLevel, ladder: SharpParams['ladder'] = 'phone'): 30 | 60 => (ladder === 'desktop' ? l < 2 : l === 0) ? 60 : 30

/**
 * The veto expires (desktop ladder only, SharpParams.vetoExpire; phones keep #365's veto): a slow window that the GPU time keeps vetoing for this many drawn
 * frames in a row is acted on anyway. A GPU timer that under-reads (Metal, measured 5-7x under) must not pin a slow device at full size; a tile burst (the
 * case the veto is for) is shorter than this. A level whose veto expired probes later WITHOUT the veto (the timer is known to under-read there), so a probe
 * that is still slow fails and the backoff doubles instead of the pacer popping f 1 <-> 0.75 every probe.
 */
export const PHONE_VETO_EXPIRE = 60

export class PhonePacer {
  level: PhoneLevel = 0
  private readonly win = new Uint8Array(PHONE_SLOW_WINDOW)
  private winAt = 0
  private winSlow = 0
  /** Slow gaps the GPU time vetoed (perf). */
  vetoed = 0
  private onLevel = 0
  private probing = false
  private probeFrames = 0
  private probeSlow = 0
  private probeEvery = PHONE_PROBE_FRAMES
  /** Times each level was entered since the page loaded (perf). */
  readonly entries: [number, number, number] = [1, 0, 0]
  probes = 0
  failedProbes = 0

  private readonly rawWin = new Uint8Array(PHONE_SLOW_WINDOW)
  private rawAt = 0
  private rawSlow = 0
  private vetoedRun = 0
  /** Levels whose veto expired: their probes run without the veto until one passes. */
  private readonly noVeto = new Uint8Array(3)
  /** Steps down taken because a vetoed slow run outlasted the params' vetoExpire (perf; only real steps, never at the bottom level). */
  vetoExpired = 0

  /** Moving frames whose f the pixel cap lowered, and whether the last f() with a canvas size was capped (perf). */
  cappedFrames = 0
  capBound = false
  /** The ladder's f at the last f() call (perf). */
  ladderF = 1

  constructor(private readonly forcedF?: number, private readonly forcedHz?: 30 | 60, readonly params: SharpParams = PHONE_PARAMS, readonly pxCap = Infinity) {}

  private get ladderHz(): 30 | 60 { return phoneLevelHz(this.level, this.params.ladder) }
  /** The cadence a gesture frame runs at. */
  get hz(): 30 | 60 { return this.forcedHz ?? this.ladderHz }
  /** The cadence of this frame: on phones a moment (scripted camera move) is always 30 fps unless `?phonehz=` forces otherwise. */
  hzFor(moment: boolean): 30 | 60 { return this.forcedHz ?? (moment && this.params.momentsAt30 ? 30 : this.ladderHz) }
  /** The ladder's f for a canvas at `restDpr` (no pixel cap). */
  private ladderFFor(restDpr: number): number {
    const target = this.params.target(restDpr)
    const floorLevel = this.params.ladder === 'desktop' ? 1 : 2
    return this.level >= floorLevel ? Math.min(target, this.params.floor) : target
  }
  /** f for a canvas at `restDpr`; with the canvas size (`cw` x `ch` px) the pixel cap applies after the ladder (capMotionF). */
  f(restDpr: number, cw?: number, ch?: number): number {
    if (this.forcedF !== undefined) return this.forcedF
    const lf = this.ladderFFor(restDpr)
    this.ladderF = lf
    if (cw === undefined || ch === undefined || !Number.isFinite(this.pxCap)) { this.capBound = false; return lf }
    const c = capMotionF(lf, cw, ch, this.pxCap)
    this.capBound = c < lf
    return c
  }
  /** Counts one drawn moving frame for the cap's perf counter (main.ts calls it once per motion frame). */
  noteFrame(): void { if (this.capBound) this.cappedFrames++ }

  private go(l: PhoneLevel): void { this.level = l; this.entries[l]++; this.win.fill(0); this.winSlow = 0; this.rawWin.fill(0); this.rawSlow = 0; this.vetoedRun = 0; this.onLevel = 0 }
  /** Pushes one frame's verdict; true when the window holds enough slow frames to step. */
  private push(slow: boolean): boolean {
    this.winSlow += (slow ? 1 : 0) - this.win[this.winAt]
    this.win[this.winAt] = slow ? 1 : 0
    this.winAt = (this.winAt + 1) % PHONE_SLOW_WINDOW
    return this.winSlow >= PHONE_SLOW_IN_WINDOW
  }
  private slowGap(gapMs: number, periodMs: number, gpuMs?: number): boolean {
    const raw = gapMs > periodMs * PHONE_SLOW_TOL
    const expire = this.params.vetoExpire
    // Phones (expire Infinity): #365's veto exactly. Desktop: the raw (unvetoed) window, its own ring index; a vetoed slow run longer than `expire` counts.
    if (Number.isFinite(expire)) {
      this.rawSlow += (raw ? 1 : 0) - this.rawWin[this.rawAt]
      this.rawWin[this.rawAt] = raw ? 1 : 0
      this.rawAt = (this.rawAt + 1) % PHONE_SLOW_WINDOW
      if (this.rawSlow < PHONE_SLOW_IN_WINDOW) this.vetoedRun = 0
    }
    if (!raw) return false
    if (gpuMs !== undefined && gpuMs > 0 && Number.isFinite(gpuMs) && gpuMs <= PHONE_GPU_VETO * periodMs) {
      // A probe of a level whose veto already expired: the timer under-reads here, the slow gap counts.
      if (this.probing && this.noVeto[this.level]) return true
      if (Number.isFinite(expire) && this.level < 2 && this.rawSlow >= PHONE_SLOW_IN_WINDOW && ++this.vetoedRun >= expire) {
        // Act now: the slow window is full by the raw verdicts (push() then steps one level down).
        this.vetoedRun = 0; this.vetoExpired++; this.noVeto[this.level] = 1; this.win.fill(1); this.winSlow = PHONE_SLOW_WINDOW
        return true
      }
      this.vetoed++
      return false
    }
    return true
  }

  /**
   * `gapMs`: wall time between two drawn motion frames; `displayMs`: the display's interval. The state carries across gestures (a phone that needed
   * 30 fps in the last drag starts the next one there) and probes the level above every `probeEvery` frames.
   */
  observe(gapMs: number, displayMs?: number, momentIn = false, gpuMs?: number): void {
    if (this.forcedHz !== undefined || this.forcedF !== undefined) return
    if (!(gapMs > 0) || gapMs > PHONE_IGNORE_MS) return
    const moment = momentIn && this.params.momentsAt30
    // In a moment the cadence is already 30: its period is 30 fps, slow frames go straight to the floor, and only the floor probes (level 0 and 1 are
    // the same picture at 30 fps). Probes in a moment share the bounded probe and backoff below.
    const disp = displayMs && displayMs > 0 && Number.isFinite(displayMs) ? displayMs : 0
    const period = Math.max(moment ? 1000 / 30 : 1000 / this.ladderHz, disp)
    const isSlow = this.slowGap(gapMs, period, gpuMs)
    if (this.probing) {
      this.probeFrames++
      if (isSlow && ++this.probeSlow >= PHONE_PROBE_SLOW) {
        this.probing = false; this.failedProbes++
        this.probeEvery = Math.min(PHONE_PROBE_MAX, this.probeEvery * 2)
        this.go((this.level + 1) as PhoneLevel)
        return
      }
      if (this.probeFrames >= PHONE_PROBE_LEN) { this.probing = false; this.probeEvery = PHONE_PROBE_FRAMES; this.noVeto[this.level] = 0 }
      return
    }
    if (this.push(isSlow) && this.level < 2) { this.go(moment ? 2 : (this.level + 1) as PhoneLevel); return }
    if (moment && this.level < 2) return
    if (this.level > 0 && ++this.onLevel >= this.probeEvery) {
      this.go((this.level - 1) as PhoneLevel)
      this.probing = true; this.probeFrames = 0; this.probeSlow = 0; this.probes++
    }
  }
}

// --- The metric: f over motion frames ---

/** Running statistics of f over drawn motion frames (perf: `__moon.perf.motionF`). Fixed-bin histogram, 0.01 wide, for p10 / p50. */
export class FracStats {
  frames = 0
  min = Infinity
  last = 0
  private readonly bins = new Uint32Array(101)
  add(f: number): void {
    if (!Number.isFinite(f) || f <= 0) return
    const v = Math.min(1, f)
    this.frames++
    this.last = v
    if (v < this.min) this.min = v
    this.bins[Math.round(v * 100)]++
  }
  /** The q-quantile (0..1) of the recorded f, to 0.01; null with no frames. */
  quantile(q: number): number | null {
    if (this.frames === 0) return null
    const want = Math.max(1, Math.ceil(q * this.frames))
    let acc = 0
    for (let i = 0; i < this.bins.length; i++) { acc += this.bins[i]; if (acc >= want) return i / 100 }
    return 1
  }
  reset(): void { this.frames = 0; this.min = Infinity; this.last = 0; this.bins.fill(0) }
  snapshot(): { frames: number; min: number | null; p10: number | null; p50: number | null; last: number } {
    return { frames: this.frames, min: this.frames ? +this.min.toFixed(3) : null, p10: this.quantile(0.1), p50: this.quantile(0.5), last: +this.last.toFixed(3) }
  }
}
