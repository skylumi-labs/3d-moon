/**
 * Focus pull, part B and C (off by default since 2026-11-01, `?focuspull=1` on): the optics and the visibility of the split-prism indicator. Pure numbers, no GL: the pass that draws it is
 * post/focusScreenPass.ts and the shader there is a transcription of this file's arithmetic (scripts/focus-screen.test.mts pins both).
 *
 * The indicator is a focusing screen of a Nikon F with a 55 mm f/1.2 Nikkor (the Apollo 15 camera), traced like real optics. A point on the screen collects
 * rays from the lens's exit pupil: a ray through the normalised pupil point q (|q| <= 1) meets the screen displaced by q / (2N) x delta, where delta is the
 * distance between the lens's image plane and the screen (thin-lens defocus). The split halves and the microprism faces each send only a small zone of the
 * pupil to the eye (centre N / Np along the wedge's direction, radius 2N x eyePupil/2 / fEye), so a half stays sharp and shifts; a zone that falls outside the
 * pupil goes dark (blackout). Nothing is drawn on the cross lines of a real screen: the owner's pick leaves them out.
 *
 * Loading turns a virtual focus ring off infinity: 1/d = err / dFar. err (0..1) is how much of the frame is still coarse and by how much; it is 0 when
 * nothing is loading, so the halves line up (the Moon is at infinity from orbit).
 */
export interface Camera { label: string; f: number; N: number; screenH: number; dFar: number }
/** The owner's pick: the Nikon F and the Nikkor 55 mm f/1.2; the focus ring runs from infinity to 1.0 m. */
export const NIKON: Camera = { label: 'Nikon F + Nikkor 55mm f/1.2', f: 55, N: 1.2, screenH: 24, dFar: 1.0 }
/** mm: the split spot's diameter and the microprism ring's width and pitch; Np, Nm the f-numbers the wedge and the prism are designed for; the eye pupil and eyepiece focal length. */
export const SCREEN = { splitD: 3, ringW: 1, Np: 5.6, Nm: 5.6, pitch: 0.15, eyePupil: 3, fEye: 60 } as const
/** The split line, turned 45 degrees. */
export const SPLIT_ANGLE = -Math.PI / 4

/** Radius of the pupil zone one wedge sends to the eye, in units of the exit pupil's radius: 2N x (eye pupil / 2) / eyepiece focal length. */
export function zoneRadius(cam: Camera = NIKON): number { return 2 * cam.N * (SCREEN.eyePupil / 2) / SCREEN.fEye }

/** Centres of the pupil zones: the two split halves (along the split line, opposite sides) and the four faces of a microprism pyramid. */
export function zoneCentres(cam: Camera = NIKON): { split: [number, number][]; prism: [number, number][] } {
  const ds = cam.N / SCREEN.Np, dm = cam.N / SCREEN.Nm
  const dx = Math.cos(SPLIT_ANGLE), dy = Math.sin(SPLIT_ANGLE)
  return { split: [[dx * ds, dy * ds], [-dx * ds, -dy * ds]], prism: [[dm, 0], [-dm, 0], [0, dm], [0, -dm]] }
}

/** Share (0..1) of a pupil zone of radius `r` centred at distance `d` from the pupil's centre that lies inside the unit pupil: 1 is fully lit, 0 is blackout. */
export function zoneShare(d: number, r: number): number {
  d = Math.abs(d)
  if (r <= 0) return d <= 1 ? 1 : 0
  if (d + r <= 1) return 1
  if (d >= 1 + r) return 0
  if (d + 1 <= r) return 1 / (r * r)
  const a = Math.acos(Math.max(-1, Math.min(1, (d * d + 1 - r * r) / (2 * d))))
  const b = Math.acos(Math.max(-1, Math.min(1, (d * d + r * r - 1) / (2 * d * r))))
  const area = a + r * r * b - 0.5 * Math.sqrt(Math.max(0, (-d + 1 + r) * (d + 1 - r) * (d - 1 + r) * (d + 1 + r)))
  return Math.max(0, Math.min(1, area / (Math.PI * r * r)))
}

/** The light a split half and a microprism face pass at this lens (1: all of the zone is inside the pupil). The Nikkor at f/1.2 against wedges designed for f/5.6 is the dark case. */
export function blackoutShare(cam: Camera = NIKON): { split: number; prism: number } {
  const z = zoneCentres(cam), r = zoneRadius(cam)
  return { split: zoneShare(Math.hypot(z.split[0][0], z.split[0][1]), r), prism: zoneShare(Math.hypot(z.prism[0][0], z.prism[0][1]), r) }
}

/** delta, mm: the thin-lens distance between the image plane and the screen when the lens is set for 1/d = err / dFar (err 0 is infinity: delta 0). */
export function deltaMm(err: number, cam: Camera = NIKON): number {
  const invD = Math.max(0, err) / cam.dFar
  if (invD <= 0) return 0
  const fm = cam.f / 1000
  return (cam.f * cam.f * invD / 1000) / (1 - fm * invD)
}
/** The focus distance in metres the err stands for (Infinity at 0). */
export function focusDistanceM(err: number, cam: Camera = NIKON): number { return err > 0 ? cam.dFar / err : Infinity }
/** Split half offset on the screen (mm) and the matte's blur disc diameter (mm) at this delta. */
export function splitOffsetMm(delta: number): number { return delta / SCREEN.Np }
export function matteBlurMm(delta: number, cam: Camera = NIKON): number { return delta / cam.N }

/** Canvas pixels per screen millimetre: the screen's 24 mm is the canvas SHORT side. */
export function pxPerMm(canvasW: number, canvasH: number, cam: Camera = NIKON): number { return Math.min(canvasW, canvasH) / cam.screenH }
/** Radii of the split spot and of the ring's outer edge, canvas px. */
export function splitRadiusPx(canvasW: number, canvasH: number): number { return SCREEN.splitD / 2 * pxPerMm(canvasW, canvasH) }
export function ringRadiusPx(canvasW: number, canvasH: number): number { return (SCREEN.splitD / 2 + SCREEN.ringW) * pxPerMm(canvasW, canvasH) }
/** Largest distance (mm) a sample is read from its own pixel inside the ring at err 1: the pupil point q of the farthest zone sample over 2N, times delta. Plus a margin for the bilinear tap. */
export function sampleReachMm(cam: Camera = NIKON): number {
  const z = zoneCentres(cam), r = zoneRadius(cam)
  const q = Math.max(...z.split.map((c) => Math.hypot(c[0], c[1])), ...z.prism.map((c) => Math.hypot(c[0], c[1]))) + r
  return Math.min(1, q) / (2 * cam.N) * deltaMm(1, cam)
}
/** The square of the framebuffer (side in px, even) that holds the ring and every sample read for it. */
export function copyRegionPx(canvasW: number, canvasH: number): number {
  const half = ringRadiusPx(canvasW, canvasH) + (sampleReachMm() + 0.5) * pxPerMm(canvasW, canvasH)
  return Math.ceil(half) * 2
}

// ---------------------------------------------------------------------------------------------------------------------------------- C. visibility

/** The share of the visible frame drawn coarser than wanted below which nothing is loading (the prototype's `loading` threshold). */
export const LOADING_SHARE = 0.002
/** Time constant of the fade in, s; the hold after loading ends, s; the time constant of the fade out, s. Owner 2026-10-30: fade in and out faster. */
export const FADE_IN_TAU = 0.025
export const HOLD_S = 0.1
export const FADE_OUT_TAU = 0.07
/** Below this opacity the pass is skipped. */
export const VISIBLE_MIN = 0.004
/** The split follows err through this lag, s: a measured share flickers by a ray or two, a focus ring does not. */
export const ERR_TAU = 0.05
/**
 * While anything loads the focus error starts here (0..1) and the measured share and lack fill the rest: a zoom from Home or a fly-in measures err about
 * 0.05 to 0.1 (rig run 41210991160: the split then moves a pixel or two and the indicator is invisible although it is drawn; owner 2026-10-31: "if I zoom
 * in, the tile loading, I would expect that the centre thing appear"). At 0.45 the split offset (splitOffsetMm) is about 8 px on a canvas 800 px on its short side.
 */
export const ERR_FLOOR = 0.45
/** The lack, per 640 px of canvas width, that is a full-size focus error (the prototype's `miss / 3`). */
export const FULL_LACK_PER_640 = 3

/**
 * err, 0..1, from what is loading: how much of the frame is still coarse (`coarse`, share 0..1) and how much detail that part lacks (`lackPer640`, blur
 * sigma in px at a 640 px wide canvas, the prototype's `miss`), mapped onto ERR_FLOOR..1, so the split reads as "loading" more than as "how much". Zero when nothing is loading.
 */
export function errOf(coarse: number, lackPer640: number): number {
  if (!(coarse > LOADING_SHARE)) return 0
  const raw = Math.min(1, Math.max(0, lackPer640) / FULL_LACK_PER_640) * Math.min(1, coarse * 4 + 0.35)
  return ERR_FLOOR + (1 - ERR_FLOOR) * raw
}

/**
 * The share of the wanted detail tiles (WAC ratio, Terrain Camera) still on their way above which the indicator also reads "loading". Close to the
 * surface the colour levels 0..2 are resident within moments and what sharpens is this detail (owner walkthrough 2026-10-31: "I never see the DSLR zoom
 * effect"). Indicator only: detail arrives by its own opacity fade, nothing is defocused for it.
 */
export const DETAIL_LOADING_SHARE = 0.1
/** What the indicator reads of a frame: the colour measure (coarse share, lack) and the detail share on its way. */
export interface IndicatorMeasure { coarse: number; lackPer640: number; detail?: number }
/** Is anything that sharpens the view loading: colour drawn coarser than wanted, or a real share of the detail tiles in flight. */
export function loadingOf(m: IndicatorMeasure | null): boolean {
  return !!m && (m.coarse > LOADING_SHARE || (m.detail ?? 0) > DETAIL_LOADING_SHARE)
}
/** err for the indicator: the colour's errOf, or while only detail loads ERR_FLOOR graded up by the detail share (a full want missing is halfway to 1). */
export function indicatorErr(m: IndicatorMeasure | null): number {
  if (!m) return 0
  const colour = errOf(m.coarse, m.lackPer640)
  const d = m.detail ?? 0
  const detail = d > DETAIL_LOADING_SHARE ? ERR_FLOOR + (1 - ERR_FLOOR) * 0.5 * Math.min(1, d) : 0
  return Math.max(colour, detail)
}

export interface FocusVisibility {
  /** 0..1 opacity of the indicator. */
  vis: number
  /** The lagged err the optics use, 0..1. */
  err: number
  /** Seconds of hold left after loading ended. */
  hold: number
  /** Loading was on in the last step (the hold starts when it goes off). */
  busy: boolean
}
export const newVisibility = (): FocusVisibility => ({ vis: 0, err: 0, hold: 0, busy: false })

/** Advance by `dt` seconds. `loading`: a visible tile is drawn coarser than wanted with its finer level in flight. Moving alone never shows it. */
export function stepVisibility(s: FocusVisibility, dt: number, loading: boolean, errTarget: number): FocusVisibility {
  dt = Math.max(0, Math.min(0.5, dt))
  let { vis, hold, busy } = s
  if (loading) {
    vis += (1 - vis) * (1 - Math.exp(-dt / FADE_IN_TAU))
    busy = true
    hold = 0
  } else {
    if (busy) { busy = false; hold = HOLD_S }
    if (hold > 0) hold = Math.max(0, hold - dt)
    else vis += (0 - vis) * (1 - Math.exp(-dt / FADE_OUT_TAU))
  }
  if (vis < VISIBLE_MIN && !loading && hold <= 0) vis = 0
  // During the hold the split stays where it was: with ERR_FLOOR a one-frame dip of the coarse share below LOADING_SHARE would otherwise pull the
  // split in by a visible step (a hunt). It closes with the fade out.
  const target = loading ? errTarget : hold > 0 ? s.err : 0
  const err = s.err + (target - s.err) * (1 - Math.exp(-dt / ERR_TAU))
  return { vis, err: err < 1e-4 ? 0 : err, hold, busy }
}
/** Is the pass worth drawing (and the app worth redrawing for)? */
export const visible = (s: FocusVisibility): boolean => s.vis >= VISIBLE_MIN

/** The err the optics see: the lagged err times the opacity (as the prototype's `err * vis`), clamped to 0..1. No hunt: the split follows the loading steadily. */
export function opticsErr(s: FocusVisibility): number {
  return Math.max(0, Math.min(1, s.err * s.vis))
}

/** `?focusmatte=traced`: the whole field gets the traced matte blur (what a real screen does), for the owner's comparison. Default: the app view, the frame outside the spot is as drawn. */
export function focusMatteTraced(search: string): boolean { return new URLSearchParams(search).get('focusmatte') === 'traced' }
