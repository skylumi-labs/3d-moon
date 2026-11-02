/**
 * The "Target lock" centre caption (owner's style 2): corner brackets close in on the named feature, then its IAU name and data are typed in
 * capitals. Pure: no DOM. The centre caption's controller (centreCaptionCore.ts) still decides WHAT is named and WHEN; this decides how it is shown.
 *
 * Owner rule: only useful info. No status words ("TARGET LOCKED", "ACQUIRING", ...); a field with no data is left out, never a placeholder.
 */
import type { MoonLabel } from './data'
import type { CamSample } from './centreCaptionCore'
import type { V3 } from './centrePick'
import { MOON_R_KM as R_KM } from '../glsl/common'

/** `?labelstyle=classic` restores the plain caption above the dock; anything else (or nothing) is the lock style. */
export type LabelStyle = 'lock' | 'classic'
export const labelStyleOf = (search: string): LabelStyle => new URLSearchParams(search).get('labelstyle') === 'classic' ? 'classic' : 'lock'

/** The brackets' close-in, ms (the artboard's 420 ms transition). */
export const BRACKET_MS = 420
/** The name is typed at one character per step; the lines below at TYPE_LINE_CHARS per step (the artboard's 45 ms tick). */
export const TYPE_STEP_MS = 45
export const TYPE_LINE_CHARS = 3
/** Steps between the last letter of the name and the first of the lines below (the artboard's gap). */
export const TYPE_GAP_STEPS = 3
/** A new name is typed only once the controller has held it this long, with the camera at rest (motion thinning off). */
export const HOLD_MS = 300

export interface LockFields {
  /** The IAU name exactly as the Gazetteer spells it (the CSS sets capitals; the text stays exact for screen readers and copy). */
  name: string
  /** `LAT  9.62°N  LON 20.08°W`, or absent when the label has no finite position. */
  coords?: string
  /** `Crater  Ø 96 km`: the IAU type and the diameter, each left out when the source has none; absent when both are. */
  detail?: string
  /** The sentence announced once per settled feature. */
  spoken: string
}

const hemi = (v: number, pos: string, neg: string): string => (v < 0 ? neg : pos)
/** Longitude east-positive in (-180, 180]. */
export const wrapLon = (lon: number): number => { const w = ((lon + 180) % 360 + 360) % 360 - 180; return w === -180 ? 180 : w }
/** Hundredths, as the artboard shows; the width of a latitude is padded so the LON column holds still between names. */
export function formatCoords(lat: number, lon: number): string | undefined {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined
  const l = wrapLon(lon)
  const a = Math.abs(lat).toFixed(2), o = Math.abs(l).toFixed(2)
  return `LAT ${a.padStart(5)}°${hemi(Number(a) === 0 ? 0 : lat, 'N', 'S')}  LON ${o}°${hemi(Number(o) === 0 ? 0 : l, 'E', 'W')}`
}
/** The IAU feature type's singular ("Crater, craters" -> "Crater"; "Satellite Feature" as it stands). */
export function typeWord(featureType: string | undefined): string | undefined {
  const t = featureType?.split(',')[0].trim()
  return t ? t : undefined
}
/** Whole kilometres, with one decimal below 10 km (a 2.3 km crater is not "2"). Absent without a positive diameter. */
export function formatDiameter(km: number | undefined): string | undefined {
  if (typeof km !== 'number' || !Number.isFinite(km) || !(km > 0)) return undefined
  const v = km < 10 ? km.toFixed(1) : String(Math.round(km))
  return `Ø ${v} km`
}

export function lockFields(label: Pick<MoonLabel, 'name' | 'lat' | 'lon' | 'sizeKm' | 'featureType'>): LockFields {
  const coords = formatCoords(label.lat, label.lon)
  const type = typeWord(label.featureType)
  const dia = formatDiameter(label.sizeKm)
  const detail = [type, dia].filter(Boolean).join('  ') || undefined
  const spoken: string[] = [label.name]
  if (coords) {
    // The same rounding and hemisphere as the shown line (a latitude of -0.004 is 0.00 north there, and here).
    const l = wrapLon(label.lon), a = Math.abs(label.lat).toFixed(2), o = Math.abs(l).toFixed(2)
    spoken.push(`latitude ${a} degrees ${hemi(Number(a) === 0 ? 0 : label.lat, 'north', 'south')}, longitude ${o} degrees ${hemi(Number(o) === 0 ? 0 : l, 'east', 'west')}`)
  }
  if (type) spoken.push(type)
  if (dia) spoken.push(`diameter ${dia.slice(2).replace(' km', ' kilometres')}`)
  return { name: label.name, coords, detail, spoken: spoken.join('. ') + '.' }
}
/**
 * The lines in typing order, absent fields dropped. `stacked` (a narrow screen or a large text size, where a line does not fit beside or under the brackets)
 * puts each field on its own line: LAT, LON, the type and the diameter; the name then wraps at its spaces (lockLabel.css).
 */
export function lockLines(f: LockFields, stacked = false): string[] {
  const all = [f.name, f.coords, f.detail].filter((s): s is string => !!s)
  return stacked ? all.flatMap((l, i) => (i === 0 ? [l] : l.split(/ {2}(?=[^\s\d])/))) : all
}

export interface Typed {
  /** Characters shown per line (same order as `lockLines`). */
  counts: number[]
  /** Everything is shown; the cursor blinks. */
  done: boolean
  /** The line the cursor stands at the end of. */
  cursorLine: number
}
/**
 * The typing scheduler: what is shown `now`, for typing that starts at `start` (the brackets have landed). The name takes one character per step, the lines
 * below TYPE_LINE_CHARS per step after a short gap, one line after the other. Reduced motion shows everything at once.
 */
export function typedAt(lines: readonly string[], start: number, now: number, reduced: boolean): Typed {
  const n = lines.length
  if (n === 0) return { counts: [], done: true, cursorLine: 0 }
  if (reduced) return { counts: lines.map((l) => l.length), done: true, cursorLine: n - 1 }
  const steps = Math.max(0, Math.floor((now - start) / TYPE_STEP_MS))
  const counts = new Array<number>(n).fill(0)
  counts[0] = Math.min(lines[0].length, steps)
  let budget = Math.max(0, steps - lines[0].length - TYPE_GAP_STEPS) * TYPE_LINE_CHARS
  let cursorLine = 0
  for (let i = 1; i < n; i++) {
    if (budget <= 0) break
    counts[i] = Math.min(lines[i].length, budget)
    budget -= counts[i]
    cursorLine = i
  }
  const done = counts.every((c, i) => c === lines[i].length)
  return { counts, done, cursorLine }
}
/** When typing that starts at `start` is complete (for scheduling frames). */
export function typingEndsAt(lines: readonly string[], start: number): number {
  if (lines.length === 0) return start
  const rest = lines.slice(1).reduce((s, l) => s + l.length, 0)
  const steps = lines[0].length + (rest > 0 ? TYPE_GAP_STEPS + Math.ceil(rest / TYPE_LINE_CHARS) : 0)
  return start + steps * TYPE_STEP_MS
}

export interface HoldInput {
  /** The controller's name on screen (visible), or null. */
  id: string | null
  /** Motion thinning is active (the camera moves, or it stopped less than the thinning rest ago). */
  moving: boolean
  /** The caption is off for a reason other than motion (a sheet, the Labels layer, a hidden tab, the splash): nothing is kept. */
  suppressed: boolean
  now: number
}
export interface HoldView {
  /** The feature on screen, or null. */
  id: string | null
  /** When this name was committed (its brackets start then, its typing BRACKET_MS later). Changes only on a new commit. */
  since: number
}
/**
 * Decides which name is drawn. Rest picks wait HOLD_MS; while moving, the sampled centre pick replaces the prior name directly. Suppression clears it at once.
 */
export class LockHold {
  private shown: { id: string; since: number } | null = null
  private cand: { id: string; since: number } | null = null

  step(i: HoldInput): HoldView {
    if (i.suppressed) { this.shown = null; this.cand = null; return this.view() }
    // During motion, track only the latest sampled centre pick. The picker itself has spatial hysteresis; retaining a stale name here would leave a ghost
    // on the terrain after the camera has moved away from it.
    if (i.moving) {
      this.cand = null
      if (!i.id) this.shown = null
      else if (this.shown?.id !== i.id) this.shown = { id: i.id, since: i.now }
      return this.view()
    }
    if (i.id && this.shown?.id === i.id) { this.cand = null; return this.view() }
    if (i.id) {
      if (this.cand?.id !== i.id) this.cand = { id: i.id, since: i.now }
      if (i.now - this.cand.since >= HOLD_MS) { this.shown = { id: i.id, since: i.now }; this.cand = null; return this.view() }
    } else this.cand = null
    if (!i.id) this.shown = null
    return this.view()
  }
  /** A name waits for its rest hold: the frame loop must keep stepping. */
  busy(): boolean { return this.cand !== null }
  private view(): HoldView { return { id: this.shown?.id ?? null, since: this.shown?.since ?? 0 } }
}

export interface Box { left: number; top: number; width: number; height: number }
/** The fixed reticle, px: shown when the brackets cannot honestly frame the feature (it then says nothing about size). */
export const RETICLE_PX = 64
/** The brackets frame the feature's extent only when that extent is this many px or more on each side (two 18 px arms and a little room) ... */
export const EXTENT_MIN_PX = 44
/** ... at most this share of the viewport's short side, and inside the viewport by EXTENT_EDGE_PX. */
export const EXTENT_MAX_SHARE = 0.7
export const EXTENT_EDGE_PX = 12
/** Rim points projected for the extent (a foreshortened rim is an ellipse; its bounding box is what is framed). */
const RIM_N = 24

/** Selenographic (lon, lat) degrees to a unit vector in Moon coordinates (x to longitude 0, z north). */
const unit = (latDeg: number, lonDeg: number): V3 => {
  const la = latDeg * Math.PI / 180, lo = lonDeg * Math.PI / 180
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]
}
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

/** A Moon-frame point to CSS px in a `w` x `h` viewport, or null behind the camera. */
export function projectPx(cam: CamSample, p: V3, w: number, h: number): [number, number] | null {
  const right = cross(cam.up, cam.back)
  const d: V3 = [p[0] - cam.pos[0], p[1] - cam.pos[1], p[2] - cam.pos[2]]
  const z = -dot(d, cam.back)
  if (!(z > 1e-9)) return null
  const x = dot(d, right) / (z * cam.tanHalf * cam.aspect), y = dot(d, cam.up) / (z * cam.tanHalf)
  return [(x + 1) / 2 * w, (1 - y) / 2 * h]
}

export interface Brackets extends Box {
  /** 'extent': the box is the feature's projected rim (it shows real size); 'reticle': a fixed size at the screen centre (it shows no size). */
  rule: 'extent' | 'reticle'
}
/**
 * Where the brackets stand. Rule: a crater (the Gazetteer's crater kind: craters and their satellite features, whose IAU diameter is a rim) is framed by the
 * bounding box of its projected rim (24 points on the sphere, so a crater near the limb gets a flat box) when the whole rim faces the camera, lies inside the
 * viewport and spans EXTENT_MIN_PX to EXTENT_MAX_SHARE of the short side. Everything else (maria, ranges, rimae: their "diameter" is an extent or a length,
 * not a rim), and a crater outside that range, gets the fixed reticle at the screen centre.
 */
export function bracketBox(label: Pick<MoonLabel, 'kind' | 'lat' | 'lon' | 'sizeKm'>, cam: CamSample | null, w: number, h: number): Brackets {
  const reticle: Brackets = { rule: 'reticle', left: w / 2 - RETICLE_PX / 2, top: h / 2 - RETICLE_PX / 2, width: RETICLE_PX, height: RETICLE_PX }
  if (!cam || label.kind !== 'crater' || !(typeof label.sizeKm === 'number' && label.sizeKm > 0) || !Number.isFinite(label.lat) || !Number.isFinite(label.lon)) return reticle
  const c = unit(label.lat, label.lon)
  const east = norm(cross([0, 0, 1], c)), north = cross(c, east)
  const ang = label.sizeKm / 2 / R_KM
  const ca = Math.cos(ang), sa = Math.sin(ang)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let k = 0; k < RIM_N; k++) {
    const t = 2 * Math.PI * k / RIM_N
    const p: V3 = [0, 1, 2].map((j) => c[j] * ca + (east[j] * Math.cos(t) + north[j] * Math.sin(t)) * sa) as unknown as V3
    // The rim point must face the camera (not past the limb).
    if (!(dot(p, [cam.pos[0] - p[0], cam.pos[1] - p[1], cam.pos[2] - p[2]]) > 0)) return reticle
    const s = projectPx(cam, p, w, h)
    if (!s) return reticle
    x0 = Math.min(x0, s[0]); x1 = Math.max(x1, s[0]); y0 = Math.min(y0, s[1]); y1 = Math.max(y1, s[1])
  }
  const bw = x1 - x0, bh = y1 - y0, short = Math.min(w, h)
  if (bw < EXTENT_MIN_PX || bh < EXTENT_MIN_PX || bw > EXTENT_MAX_SHARE * short || bh > EXTENT_MAX_SHARE * short) return reticle
  if (x0 < EXTENT_EDGE_PX || y0 < EXTENT_EDGE_PX || x1 > w - EXTENT_EDGE_PX || y1 > h - EXTENT_EDGE_PX) return reticle
  return { rule: 'extent', left: x0, top: y0, width: bw, height: bh }
}
