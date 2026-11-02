import { BRAND_LINE, MADE_BY } from './branding'
import { trackUsage } from './usage'
import { LOOK_LABEL, NEAR_LABEL, NEAR_LABEL_DIRECT, TRACKS_LABEL } from './ground/nearField'
import { type Exposure } from './post/exposure'
import type { CaptionApi } from './ui/caption'
import { hintFor } from './ui/touchControlsLogic'
import { pushTap, tapTime } from './ui/debugTaps'
import { CREDIT_CATALOG, creditsAreOpen, creditsClick, creditsFocus, creditsPointer, dismissCredits, initialCreditsOpenState, type CreditId, type CreditsOpenState } from './ui/credits'

/**
 * A minimal HUD: the moment (UTC), where the camera is, and which exposure
 * shows what (moon-v1's labels). The earthlight's brightness is modelled
 * (the Earth's albedo taken as 0.3), and the label says so.
 */

/** Ground mode's line for the HUD (G1). */
export interface GroundHud {
  presetName: string | null
  walking: boolean
  aglM: number
  /** The origin labels are on. */
  origin: boolean
  /** The lunar module has loaded and been placed. */
  /** Some of the tier's filled disc (the module's footprint) is inside the frame. */
  fillInView: boolean
  lm: { headingDeg: number; pitchDeg: number; rollDeg: number; maxClearanceCm: number; tilt: 'reported' | 'fit'; fitPitchDeg: number; fitRollDeg: number; heightM: number; spanM: number } | null
  /** Range to the ground along the view centre, metres (null: the centre looks at the sky). */
  rangeM: number | null
  /** `?near=photo` (ground/nearField.ts): the modelled near-field ground is drawn, and with it the modelled tracks (`&tracks=1`). */
  near?: { tracks: boolean; baked: boolean; look: boolean } | null
}

/** The powered descent's readout (G2b): every quantity carries the provenance code the track file gives it (V verified, R read second-hand, I interpolated, E estimated). */
export interface FlightHud {
  /** Ground elapsed time on the Apollo Lunar Surface Journal clock (hhh:mm:ss), and the real UTC of 1972. */
  get: string
  utc: string
  /** Seconds since ignition, and the clock rate now. */
  t: number
  rate: number
  paused: boolean
  regime: 'orbit' | 'ground'
  cam: 'chase' | 'window'
  altM: number
  altProv: string
  altBandM: number
  vHorizMs: number
  vHorizProv: string
  vHorizBandMs: number
  vRateMs: number
  vRateProv: string
  engine: string
  attKnown: boolean
  psiDeg: number
  attProv: string
  attBandDeg: number
  dust: number
  sunElDeg: number
  sunAzDeg: number
  origin: boolean
  plume: boolean
  blending: boolean
  /** Before ignition the orbit is modelled. */
  coasting: boolean
}

const provMark = (c: string): string => (c === 'V' ? '' : c === 'R' ? ' (read)' : c === 'I' ? ' (interpolated)' : ' est')
/** Intl formatters are built once: `toLocaleString` constructs one per call, which was the dominant cost of the HUD text on a frame. */
const INT_GB = new Intl.NumberFormat('en-GB')
const UTC_STAMP = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
const ft = (m: number): string => INT_GB.format(Math.round(m / 0.3048))

/** What the flight shows, line by line: the readout and, with the origin toggle on, what each element is. */
export function flightLines(f: FlightHud): { head: string; sub: string; notes: string[] } {
  const alt = f.altM >= 10000 ? `${(f.altM / 1000).toFixed(1)} km` : f.altM >= 100 ? `${Math.round(f.altM).toLocaleString('en-GB')} m (${ft(f.altM)} ft)` : `${f.altM.toFixed(1)} m (${ft(f.altM)} ft)`
  const band = (b: number, unit: string): string => (Number.isFinite(b) && b > 0 ? ` ±${b >= 100 ? Math.round(b).toLocaleString('en-GB') : b.toFixed(1)} ${unit}` : '')
  const head = `<b>Apollo 17 powered descent · ${f.get} GET</b> · ${f.utc} UTC · ${f.paused ? 'paused' : `×${f.rate}`}`
  const speed = f.coasting ? `${Math.round(Math.hypot(f.vHorizMs, f.vRateMs)).toLocaleString('en-GB')} m/s along the orbit est` : `${f.vHorizMs.toFixed(f.vHorizMs < 10 ? 1 : 0)} m/s${band(f.vHorizBandMs, 'm/s')}${provMark(f.vHorizProv)}`
  const sub = `Altitude ${alt}${f.coasting ? ` ±${Math.round(f.altBandM / 1000)} km est` : band(f.altBandM, 'm')}${f.coasting ? '' : provMark(f.altProv)}` +
    ` · ${f.coasting ? 'speed' : 'ground speed'} ${speed}` +
    (f.coasting ? '' : ` · descent rate ${Math.abs(f.vRateMs).toFixed(1)} m/s${provMark(f.vRateProv)}`) +
    ` · engine ${f.engine}${f.coasting ? '' : ' (thrust est)'}` +
    (f.coasting && f.cam === 'chase' ? ' · camera: trailing the module at about 80 m, a framing choice' : '')
  const notes: string[] = []
  notes.push(`The ground is LROC photographs and a terrain model from 2011, lit again by the Sun of 11 December 1972: ${f.sunElDeg.toFixed(1)}° up, ${f.sunAzDeg.toFixed(0)}° from north (east), so shadows fall west. The Sun is the real one for this moment`)
  if (f.coasting) notes.push('Before ignition the module coasts on the descent orbit: the orbit is modelled from the Mission Report’s elements, and its attitude is held at the ignition attitude, not a source value')
  if (f.blending) notes.push('The camera is moving from the orbital view to the flight camera; the clock is held')
  if (f.origin) {
    notes.push(`Track: altitude is read from the crew’s calls and mission report and interpolated between them; horizontal speed is modelled in every second (est), with a band that reaches ±${Math.round(f.vHorizBandMs)} m/s here`)
    notes.push(f.attKnown ? `Attitude: pitch and yaw come from the mission report at its waypoints; after the pitchover they are fitted (est, ±${Math.round(f.attBandDeg)}°). Pitch now ${f.psiDeg.toFixed(0)}° from vertical${provMark(f.attProv)}. The heading and tilt at rest are inferred and reported` : 'Attitude: held at the ignition attitude')
    notes.push('The module is NASA’s generic lunar module model, moved along the track; its materials are a guess and it is not LM-12')
    notes.push(f.cam === 'window' ? 'Camera: the commander’s window is a modelled pose (the window-height eye, looking 41° outboard and 41° down through a 49° field). No cabin is drawn, so it is not his view' : 'Camera: an observer 45 m south of the module, moving with it (before ignition it trails the module at about 80 m and closes in). A modelled pose and a framing choice, not a recording')
    notes.push(f.dust > 0.004 ? `Dust: a modelled effect. Grains fly on ballistic arcs from under the engine as a flat sheet, growing with the crew’s calls of dust from about 60 to 70 ft (index ${f.dust.toFixed(2)}, a rendering scale). It is not a reconstruction of the film` : 'Dust: nothing is drawn above about 110 ft; the crew first saw dust at 60 to 70 ft')
    notes.push(f.plume ? 'Engine glow: a modelled cone. The real exhaust could not be seen in a vacuum' : 'Engine glow: off. The real exhaust could not be seen in a vacuum')
    notes.push('The rover, the flag, the instruments and the tracks in the 2011 photographs did not exist yet, so none is drawn')
  }
  return { head, sub, notes }
}

/** What each element on screen is, for the origin toggle: measured, inferred, modelled or computed. `p` is the patch line (its pixel size is the range's). */
export function originLines(g: GroundHud, p: HudInfo['patchLine']): string[] {
  const imageM = p?.tier?.effectiveM ?? p?.imageM ?? 0.25
  const heightM = p?.tier?.heightM ?? p?.heightM ?? 1.5
  const px = g.rangeM !== null && p && Number.isFinite(p.pxM) ? p.pxM : null
  const cm = (m: number): string => (m * 100 >= 10 ? String(Math.round(m * 100)) : (m * 100).toFixed(1))
  const scale = px === null ? '' : px < imageM * 0.9
    ? `. At this range one screen pixel is ${cm(px)} cm, so nothing finer than ${cm(imageM)} cm is real`
    : `. At this range one screen pixel is ${cm(px)} cm, about the photograph’s own detail`
  const lines = [`The ground is the LROC photograph (${cm(imageM)} cm here, resampled) and its terrain model (${heightM} m grid)${scale}`]
  if (p?.tier && g.fillInView) lines.push('The 2011 photograph of the module itself, its legs and its shadow is filled out of the ground, so the model does not stand over a photographed twin. The fill is made up')
  if (g.lm) {
    const m = g.lm
    const tilt = m.tilt === 'reported'
      ? `Its tilt is the crew’s report by ear, ${m.pitchDeg.toFixed(0)}° nose up and ${m.rollDeg.toFixed(0)}° left down. The terrain model alone gives ${m.fitPitchDeg.toFixed(1)}° and ${m.fitRollDeg.toFixed(1)}°, so a pad floats up to ${Math.round(m.maxClearanceCm)} cm above this ground`
      : `Its tilt is fitted to the terrain model under the pads, ${m.pitchDeg.toFixed(1)}° nose up and ${m.rollDeg.toFixed(1)}° left down. The crew reported about 5° and 2° by eye. It is drawn at the fit so the pads touch, because this model’s legs are rigid and the real struts stroked`
    lines.push('The lunar module’s position is measured, from the Haase lander control point. Its heading is inferred, with the windows facing west')
    lines.push(`Its shape is NASA’s model, not necessarily this lander: ${m.heightM.toFixed(1)} m tall against about 7 m, and ${m.spanM.toFixed(1)} m across the pads against about 9.4 m`)
    lines.push(tilt)
    lines.push('Materials, and the ground bounce on the module, are modelled')
  }
  lines.push('Shadows on the ground are computed from the heights and the Sun of this moment. The module’s shadow is only as right as the model’s shape')
  if (g.presetName?.startsWith('Window')) lines.push('The window-height view takes its field from the window size and looks along the window’s direction; no cabin is modelled and the eye is not the commander’s')
  return lines
}

export interface HudInfo {
  /** 'earth' is the Earth-centre readout (kept for the HUD plan's tests); the camera itself is always 'fly'. */
  mode: 'earth' | 'fly'
  date: Date
  /** Camera distance from the Moon's centre, km. */
  distKm: number
  /** Point under the camera, selenographic deg. */
  under: { lon: number; lat: number }
  /** Sun-Moon-viewpoint angle, deg. */
  phaseFromCameraDeg: number
  illuminatedFraction: number
  libration: { lon: number; lat: number }
  earthshine: number
  /** The Earth's shadow on the Moon's Earth-facing point: none, partial (penumbra) or total. */
  shadow: 'none' | 'partial' | 'total'
  exposure: Exposure
  /** True when the renderer has a nonzero night floor on visible geometrically unlit Moon ground. */
  nightFloorApplied?: boolean
  /** Ground per canvas pixel under the camera against the tiles' samples, km; null without tiles or in the Earth view. */
  resolution: { pxKm: number; heightKm: number; colourKm: number; /** Texel of the Terrain Camera detail drawn under the camera (km); absent or null: none is. */ tcKm?: number | null } | null
  /** Ground under the camera from the 1737.4 km sphere, km (0 away from a site patch). */
  groundKm: number
  /** Over a site patch: metres of ground per canvas pixel, and the patch's own samples; null elsewhere. */
  patchLine: {
    pxM: number; imageM: number; heightM: number
    /** Which site, when its photograph was taken (ISO), whether it is a mosaic of several passes, and the time the sky is set to. */
    site?: string; photoTime?: string; mosaic?: { passes: number; first: string; last: string }; simulated?: Date
    /** Over the 25 cm tier: the tier's own texel (metres), the effective one, its DTM's, and the Sun of its photograph (inferred). */
    /** ?surround=1 is on: ground beyond the photographs carries a modelled texture. */
    surround?: boolean
    tier?: { imageM: number; effectiveM: number; heightM: number; nativeM: [number, number]; sunLabel: string; sunElDeg: number; inferred: boolean }
  } | null
  /** The night-side visibility floor: applied (a calibration is loaded) or pending (disabled until calibrated). */
  visibilityFloor?: 'applied' | 'pending'
  /** Set in ground mode. */
  ground?: GroundHud | null
  /** Set during the powered-descent flight (G2b); takes the place of the ground block. */
  flight?: FlightHud | null
  /** The clock follows the real time (the caption says "now"). */
  live?: boolean
  /** The Moon is waxing (null: not known). */
  waxing?: boolean | null
  /** The first visit's one-sentence hint under the caption. */
  hint?: boolean
  /** ?archive=1: the technical text lines of the ground and flight views are shown on screen; a visitor gets them behind the i button. */
  archive?: boolean
}

const fmtKm = (v: number): string => INT_GB.format(Math.round(v))
const signed = (v: number, digits = 1): string => (v >= 0 ? '+' : '') + v.toFixed(digits)

/**
 * A line when a pixel is no bigger than the data's sample: what the data is,
 * and that nothing finer is measured. The heights are a grid (LOLA, gridded
 * and interpolated), not one laser shot per cell.
 */
export function resolutionLine(r: HudInfo['resolution']): string | null {
  // The finest source drawn under the camera sets the verdict: the heights (a deeper block's 59 m, not the built set's 474 m) or the Terrain Camera
  // detail. A source that is only listed or still loading is not passed in (main.ts reads the resident texel), so the line never credits more than is drawn.
  const tc = r && r.tcKm != null && r.tcKm > 0 && Number.isFinite(r.tcKm) ? r.tcKm : null
  if (!r) return null
  const finest = tc === null ? r.heightKm : Math.min(r.heightKm, tc)
  if (r.pxKm > finest * 1.1) return null
  const grid = `heights on a ${fmtTexelM(r.heightKm)} m grid, colour on a ${fmtTexelM(r.colourKm)} m grid${tc === null ? '' : `, Terrain Camera detail on a ${fmtTexelM(tc)} m grid`}`
  return r.pxKm >= finest * 0.9 ? `Data resolution reached: ${grid}` : `Magnified past the data (${grid}): nothing finer here is measured`
}
/** A texel in metres: whole metres from 20 m up, one decimal below (the Terrain Camera's 12.5 m is not 13). */
function fmtTexelM(km: number): string {
  const m = km * 1000
  return m >= 20 ? String(Math.round(m)) : String(Math.round(m * 10) / 10)
}

/**
 * Over a site patch, once a pixel is down to a few metres: what the patch is and whether the
 * picture is still finer than the data or already magnified past it. Its image is a photograph
 * (0.5 m per pixel) and its heights a 2 m grid, so the heights run out first.
 */
export function patchResolutionLine(r: HudInfo['patchLine']): string | null {
  if (!r || r.pxM > 16) return null
  if (r.tier) {
    const t = r.tier
    const grid = `25 cm texels, about ${Math.round(t.effectiveM * 100)} cm of real detail: photograph resampled to ${t.imageM} m from ${Math.round(t.nativeM[0] * 100)} by ${Math.round(t.nativeM[1] * 100)} cm pixels, heights on a ${t.heightM} m grid`
    if (r.pxM >= t.effectiveM * 0.9) return `Data resolution reached (${grid})`
    return `Magnified past the data (${grid}). Nothing finer here is measured`
  }
  const grid = `photograph at ${r.imageM} m per pixel, heights on a ${r.heightM} m grid`
  if (r.pxM >= r.imageM * 0.9) return `Data resolution reached (${grid})`
  return `Magnified past the data (${grid}). Nothing finer here is measured`
}

/**
 * Which light the patch's photograph was taken in, next to the sky's own date. A mosaic (several passes under different
 * Suns) says so and names the one whose Sun the sky uses; a single photograph names its date only when the sky's differs.
 */
export function patchLightLine(r: HudInfo['patchLine']): string | null {
  if (!r || !r.photoTime) return null
  if (r.tier && r.pxM <= 8) {
    const t = r.tier
    const when = formatUtc(new Date(t.sunLabel.replace(/^ephemeris /, '')))
    return `The 25 cm photograph was taken about ${when}, the Sun ${t.sunElDeg.toFixed(1)}° up (${t.inferred ? 'inferred from the spacecraft clock, not stated in the product' : 'stated'}). The Sun in the sky is not that one's`
  }
  const shot = new Date(r.photoTime)
  const day = (iso: string): string => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const differs = !!r.simulated && Math.abs(r.simulated.getTime() - shot.getTime()) > 30 * 60 * 1000
  if (r.mosaic) {
    const first = `${r.mosaic.passes} photographs, ${day(r.mosaic.first)} to ${day(r.mosaic.last)}, each under its own Sun. Shadows in the picture come from several Suns; only the ${formatUtc(shot)} pass is named here`
    return differs ? `${first}. The Sun in the sky is not that pass's` : first
  }
  return differs ? `Photograph taken ${formatUtc(shot)}. The Sun in the sky is not that one's` : null
}

/** Height above the ground, as the nearer unit. */
export function altitudeText(altKm: number, aboveGround: boolean): string {
  const tail = aboveGround ? 'above the ground' : 'up'
  return altKm < 10 ? `${Math.round(altKm * 1000).toLocaleString('en-GB')} m ${tail}` : `${fmtKm(altKm)} km ${tail}`
}

export function formatUtc(d: Date): string {
  return UTC_STAMP.format(d) + ' UTC'
}

/**
 * The note on the night-side visibility floor, for the panel behind the i button. Only when a night side is in the frame (absent
 * otherwise). The floor is a display look choice that keeps the unlit disc readable, never a measured brightness.
 */
export function visibilityFloorNote(x: Exposure, state: 'applied' | 'pending' | undefined): string | null {
  if (!state || x.search.hits === 0 || x.search.sunlitFraction >= 0.999) return null
  return state === 'applied'
    ? 'Night-side visibility floor: a display look choice that keeps the unlit disc readable against the sky. It is not a measured brightness'
    : null
}

/** What the exposure shows, in words (null when it is plain day). */
export function exposureLabel(x: Exposure, earthshine: number, short: boolean, nightFloorApplied = false): string | null {
  const s = x.search
  const nightOnly = s.sunlitFraction < 0.002
  const earthlit = s.esMax > 0.02
  const shown = x.esLevelView >= x.esLevel / 8
  const skyInView = s.hits < s.samples
  const starsNote = skyInView && !short ? ' · stars from the long exposure' : ''
  // In a lunar eclipse the bent sunlight, not the Earth's light, sets the long exposure.
  const eclipseLit = s.eclipseLevel > 0.16 * earthshine * s.esMax
  const figure = (earthshine * 1e5).toFixed(1)
  // Never print an earthlight figure that rounds to 0.0.
  const esNote = short ? ' (modelled)' : figure === '0.0' ? ' (modelled)' : ` (earthlight ${figure}×10⁻⁵ of sunlight, modelled)`
  const shadowNote = ' (modelled)'
  // No Moon in the frame: the exposure is set for the Earth or the Sun, not for ground.
  if (s.hits === 0) {
    if (x.hdr < 0.5) return 'One short exposure, set for the brightest thing in view'
    return skyInView ? 'Stars, from a long exposure' : null
  }
  // The night floor (?nightfloor=, post/exposure.ts): the unlit disc is lifted so it reads under the labels; a look, never a measured brightness.
  const floorNote = nightFloorApplied ? ' · night side lifted for visibility, not a measured brightness' : ''
  if (x.hdr < 0.5) {
    return nightOnly ? 'Night side in a short exposure set for sunlit terrain; visibility is a display look choice' + floorNote : floorNote ? 'Sunlit ground from a short exposure' + floorNote : null
  }
  if (nightOnly) {
    if (eclipseLit) return `In the Earth’s shadow: sunlight bent through its air, long exposure${shadowNote}` + starsNote
    if (!earthlit) return 'Night side, turned away from the Earth: unlit, a gap in the stars' + floorNote + starsNote
    if (!shown) return `Night side, lit by the Earth, long exposure: little earthlight at this phase, so it stays dark${esNote}` + floorNote + starsNote
    return `Night side, lit by the Earth, long exposure, shown darker than day${esNote}` + floorNote + starsNote
  }
  if (eclipseLit && shown) return `Sunlit ground from a short exposure · shadowed ground, lit by sunlight bent through the Earth’s air, from a long one${shadowNote}` + floorNote + starsNote
  if (earthlit && shown) return `Sunlit ground from a short exposure · earthlit ground from a long one${esNote}` + floorNote + starsNote
  if (floorNote) return 'Sunlit ground from a short exposure' + floorNote + starsNote
  return skyInView && !short ? 'Stars from the long exposure' : null
}

/** The About text (the content of the retired About button). */
export const ABOUT_PARAGRAPHS: readonly string[] = [
  'A 3D Moon you can turn, zoom and fly over. Every view is computed for the time shown.',
  "The shape of the ground comes from NASA's laser altimeter on the Lunar Reconnaissance Orbiter. The colour comes from its wide-angle camera. Sun, Earth and Moon positions are calculated.",
  'The viewpoint buttons in the bar step through places and flights. Time changes the lighting.',
  "Some parts are modelled, not measured, for example Earthlight and the Earth's atmosphere. The sources are listed below.",
  MADE_BY,
]

export interface HudLine { html: string; cls: string }
export interface HudPlan {
  /**
   * The caption for an ordinary view of the Moon (Home, any orbit): one title and at most one sentence, shown in the bottom caption
   * element (ui/caption.ts) instead of the text block. Null in ground mode and in the flight, which keep their readout lines.
   */
  caption: { title: string; hint: string } | null
  /** At most three lines: what this is and when, where the camera is, and one hint. Empty when `caption` is set. */
  lines: HudLine[]
  /** Everything else the screen used to print: exposure, resolution, light, origin notes. Reachable behind the i button. */
  notes: string[]
  /** The notes were asked for (the Origin toggle is on): the panel opens. */
  openNotes: boolean
}
export const HUD_MAX_LINES = 3

/** What the HUD shows for this state. Pure, so the line budget is testable. */
export function planHud(i: HudInfo, narrow: boolean): HudPlan {
  const label = exposureLabel(i.exposure, i.earthshine, narrow, i.nightFloorApplied)
  // A display visibility envelope is a look choice, never a brightness measurement.
  const when = formatUtc(i.date)
  // With the origin labels on in ground mode the scale sentence lives in the first origin line, so the two never disagree.
  const res = i.ground?.origin ? null : patchResolutionLine(i.patchLine) ?? resolutionLine(i.resolution)
  const light = [patchLightLine(i.patchLine), i.patchLine?.surround ? 'Modelled surround. Beyond the photographs the ground carries a made-up low-contrast texture, not data' : null].filter(Boolean).join('. ') || null
  const notes: string[] = [label, visibilityFloorNote(i.exposure, i.visibilityFloor), res, light].filter((x): x is string => !!x)
  const L = (html: string, cls = 'sub'): HudLine => ({ html, cls })
  if (i.mode === 'earth') {
    notes.unshift(`Libration ${signed(i.libration.lon)}° in longitude and ${signed(i.libration.lat)}° in latitude. Celestial north is up.`)
    notes.unshift(`${fmtKm(i.distKm)} km from the Moon’s centre, in the view from the Earth’s centre.`)
    return { caption: null, lines: [], notes, openNotes: false }
  }
  if (i.flight) {
    const l = flightLines(i.flight)
    return { caption: null, lines: [L(l.head), L(l.sub), L('Controls at the top right · Esc ends the flight', 'hint')], notes: [...notes, ...l.notes], openNotes: i.flight.origin }
  }
  if (i.ground) {
    const g = i.ground
    if (g.origin) notes.push(...originLines(g, i.patchLine))
    // The modelled near field says so on every line a visitor can reach: the head line and the notes (a label must not claim more than the data under it).
    if (g.near) notes.unshift((g.near.baked ? NEAR_LABEL : NEAR_LABEL_DIRECT) + (g.near.tracks ? `. ${TRACKS_LABEL}` : '') + (g.near.look ? `. ${LOOK_LABEL}` : ''))
    const head = `<b>On the ground at Apollo 17 · ${g.presetName ?? (g.walking ? 'walking at eye level' : 'free camera')}</b> · ${when}${g.near ? ' · near ground modelled, not measured' : ''}`
    const sub = `${g.aglM < 100 ? g.aglM.toFixed(1) : Math.round(g.aglM)} m above the ground · Sun–Moon–viewpoint ${i.phaseFromCameraDeg.toFixed(0)}°`
    const hint = 'Drag to look · W A S D and the wheel to move · V walks · Esc goes back up'
    // A visitor gets one caption (the pin's, ui/caption.ts) and these three lines behind the i button; ?archive=1 keeps them on screen.
    if (!i.archive) return { caption: null, lines: [], notes: [`${head.replace(/<\/?b>/g, '')}`, sub, hint, ...notes], openNotes: g.origin }
    return { caption: null, lines: [L(head), L(sub), L(hint, 'hint')], notes, openNotes: g.origin }
  }
  // An ordinary view of the Moon: one caption line (and on the first visit one sentence); where the camera is goes behind the i.
  const where = `${Math.abs(i.under.lat).toFixed(0)}° ${i.under.lat >= 0 ? 'N' : 'S'}, ${Math.abs(i.under.lon).toFixed(0)}° ${i.under.lon >= 0 ? 'E' : 'W'}`
  const sunlit = (i.exposure.search.sunlitFraction * 100).toFixed(0)
  const showSunlit = i.exposure.search.hits > 0
  notes.unshift(`${fmtKm(i.distKm)} km from the centre (${altitudeText(i.distKm - 1737.4 - i.groundKm, i.groundKm !== 0)}) over ${where} · Sun–Moon–viewpoint ${i.phaseFromCameraDeg.toFixed(0)}°` + (showSunlit ? ` · ${sunlit}% of the ground in view sunlit` : ''))
  // No always-visible home caption or controls hint.
  return { caption: null, lines: [], notes, openNotes: false }
}

export class Hud {
  private readonly root: HTMLElement
  private readonly main: HTMLDivElement
  private readonly credit: HTMLDivElement
  private readonly creditFull: HTMLElement
  private readonly creditExtrasList: HTMLUListElement
  private readonly creditCatalog: HTMLUListElement
  private readonly creditRows = new Map<CreditId, HTMLElement>()
  private readonly creditBadges = new Map<CreditId, HTMLElement>()
  private readonly creditExtras: string[] = []
  private creditKey = ''
  private creditsProvider: (() => ReadonlySet<CreditId>) | null = null
  private readonly infoBtn: HTMLButtonElement
  private readonly notesEl: HTMLDivElement
  private lastHtml = ''
  private notesKey = ''
  private notesTop: number | null = null
  private notesLayoutSize = ''
  private forcedOnce = false
  private caption: CaptionApi | null = null
  /** The technical text lines (the descent readout, the ground view's lines): off for a visitor, on from the debug sheet or ?archive=1. */
  private textOn = false
  private secretTap: (() => void) | null = null
  private quietFocus: (() => void) | null = null
  private taps: number[] = []

  /** The caption element takes the one-line title of an ordinary view; the text block keeps the ground and flight readouts. */
  bindCaption(c: CaptionApi): void { this.caption = c }

  /** Shows or hides the HUD's technical text lines (debug data); the loading and error messages always show. */
  setTextVisible(on: boolean): void { this.textOn = on; this.lastHtml = '\u0000' }
  get textVisible(): boolean { return this.textOn }
  /** Called on the fifth press of the Credits link within three seconds (the debug sheet). */
  onSecretTap(cb: () => void): void { this.secretTap = cb }
  /** Puts focus back on the Credits link without opening the panel (a plain focus() would, see creditsFocus). */
  focusCreditsLink(): void { this.quietFocus?.() }

  constructor(parent: HTMLElement) {
    this.root = parent
    this.main = document.createElement('div')
    this.main.id = 'hud'
    this.credit = document.createElement('div')
    this.credit.id = 'credit'
    const link = document.createElement('button')
    link.type = 'button'
    link.className = 'credit-link'
    link.textContent = 'Credits'
    link.setAttribute('aria-expanded', 'false')
    const full = document.createElement('section')
    full.className = 'credit-full'
    full.hidden = true
    full.id = 'credit-sources'
    full.setAttribute('aria-label', 'Credits and data sources')
    link.setAttribute('aria-controls', full.id)
    const heading = document.createElement('h2')
    heading.textContent = 'About, credits and sources'
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'credit-close'
    close.textContent = 'Close'
    close.setAttribute('aria-label', 'Close credits')
    const header = document.createElement('div')
    header.className = 'credit-head'
    header.append(heading, close)
    // The About text and the move-around help live here (the About button and the gesture hint under the controls are gone).
    const about = document.createElement('div')
    about.className = 'credit-about'
    const aboutHead = document.createElement('h3')
    aboutHead.textContent = 'About this visualization'
    about.append(aboutHead)
    for (const text of ABOUT_PARAGRAPHS) {
      const p = document.createElement('p')
      p.textContent = text
      about.append(p)
    }
    const helpHead = document.createElement('h3')
    helpHead.textContent = 'Moving around'
    about.append(helpHead)
    for (const [who, text] of [['Mouse and keyboard', hintFor(false)], ['Touch', hintFor(true)]] as const) {
      const p = document.createElement('p')
      const b = document.createElement('strong')
      b.textContent = `${who}: `
      p.append(b, text)
      about.append(p)
    }
    const inView = document.createElement('p')
    inView.className = 'credit-intro'
    inView.textContent = 'Badges mark source layers sampled in the current view or at its ground-view target; shading and overlays can change their pixel-level influence.'
    const catalog = document.createElement('ul')
    catalog.className = 'credit-sources'
    this.creditCatalog = catalog
    for (const entry of CREDIT_CATALOG) {
      const row = document.createElement('li')
      row.dataset.credit = entry.id
      const top = document.createElement('div')
      top.className = 'credit-row-head'
      const title = document.createElement('strong')
      title.textContent = entry.title
      const badge = document.createElement('span')
      badge.className = 'credit-badge'
      badge.textContent = 'In this view'
      badge.hidden = true
      top.append(title, badge)
      const names = document.createElement('p')
      names.className = 'credit-names'
      names.textContent = entry.credit
      const detail = document.createElement('p')
      detail.className = 'credit-detail'
      detail.textContent = entry.detail
      const links = document.createElement('div')
      links.className = 'credit-links'
      for (const item of entry.links) {
        const a = document.createElement('a')
        a.href = item.href
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.textContent = item.label
        links.append(a)
      }
      row.append(top, names, detail, links)
      catalog.append(row)
      this.creditRows.set(entry.id, row)
      this.creditBadges.set(entry.id, badge)
    }
    const extras = document.createElement('div')
    extras.className = 'credit-extras'
    extras.hidden = true
    const extrasHeading = document.createElement('h3')
    extrasHeading.textContent = 'Additional attribution'
    const extrasList = document.createElement('ul')
    extrasList.className = 'credit-extra-list'
    extras.append(extrasHeading, extrasList)
    this.creditFull = full
    this.creditExtrasList = extrasList
    full.append(header, about, inView, catalog, extras)
    // One line, "<BRAND_LINE> (Credits)" (src/branding.ts): the word is the credits button, the popover opens above the line.
    const brandText = document.createElement('span')
    brandText.className = 'brand-text'
    brandText.textContent = `${BRAND_LINE} (`
    const brandEnd = document.createElement('span')
    brandEnd.className = 'brand-text'
    brandEnd.textContent = ')'
    this.credit.append(brandText, link, brandEnd, full)
    let state: CreditsOpenState = initialCreditsOpenState()
    let closeTimer: ReturnType<typeof setTimeout> | null = null
    let wasOpen = false
    const setCredits = (): void => {
      const open = creditsAreOpen(state)
      if (open && !wasOpen) trackUsage('credits_open')
      wasOpen = open
      full.hidden = !open
      link.setAttribute('aria-expanded', String(open))
      if (open) this.refreshCredits()
    }
    const dismiss = (restoreFocus: boolean): void => {
      state = dismissCredits(state, restoreFocus)
      setCredits()
      if (restoreFocus) {
        link.focus()
        // focus() emits synchronously if focus moved. If it was already focused, don't suppress a later user re-entry.
        queueMicrotask(() => { state = { ...state, suppressFocus: false } })
      }
    }
    link.addEventListener('click', (ev) => {
      // The press time is the event's own timestamp, not the time the handler runs: a busy frame delays the handler, not the press.
      const t = pushTap(this.taps, tapTime(ev))
      this.taps = t.taps
      if (t.fired && this.secretTap) {
        // The fifth press opens the debug sheet and leaves the credits closed.
        state = dismissCredits(state)
        setCredits()
        this.secretTap()
        return
      }
      state = creditsClick(state)
      setCredits()
    })
    close.addEventListener('click', () => dismiss(true))
    this.quietFocus = () => dismiss(true)
    const enter = (): void => {
      if (closeTimer !== null) clearTimeout(closeTimer)
      closeTimer = null
      state = creditsPointer(state, true)
      setCredits()
    }
    this.credit.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') enter() })
    full.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') enter() })
    const leave = (): void => {
      if (closeTimer !== null) clearTimeout(closeTimer)
      closeTimer = setTimeout(() => {
        closeTimer = null
        state = creditsPointer(state, false)
        setCredits()
      }, 160)
    }
    this.credit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') leave() })
    full.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') leave() })
    this.credit.addEventListener('focusin', (e) => { state = creditsFocus(state, true, e.target === link); setCredits() })
    this.credit.addEventListener('focusout', (e) => {
      if (!this.credit.contains(e.relatedTarget as Node | null)) { state = creditsFocus(state, false); setCredits() }
    })
    // Capture before the page's global Esc handler so closing Credits cannot also close a flight or ground view.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || full.hidden) return
      e.preventDefault(); e.stopImmediatePropagation()
      dismiss(true)
    }, true)
    document.addEventListener('pointerdown', (e) => {
      if (!this.credit.contains(e.target as Node) && creditsAreOpen(state)) dismissCreditsAndUpdate()
    }, true)
    const dismissCreditsAndUpdate = (): void => { state = dismissCredits(state); setCredits() }
    this.infoBtn = document.createElement('button')
    this.infoBtn.type = 'button'
    this.infoBtn.className = 'hud-i'
    this.infoBtn.textContent = 'i'
    this.infoBtn.title = 'What is measured, and what is modelled'
    this.infoBtn.setAttribute('aria-label', 'About this view: what is measured and what is modelled')
    if (!this.infoBtn.hidden) this.infoBtn.hidden = true
    this.notesEl = document.createElement('div')
    this.notesEl.className = 'hud-notes'
    this.notesEl.hidden = true
    this.infoBtn.addEventListener('click', () => this.setOpen(this.notesEl.hidden !== false))
    parent.append(this.main, this.infoBtn, this.notesEl, this.credit)
    // Tab order: the controls (pill, toolbar, the rest) come first and Credits is the last stop. Everything else mounts into #ui after this
    // constructor, so keep #credit the last child whenever something is added after it. A node that holds focus is never moved.
    const keepCreditsLast = (): void => {
      if (parent.lastElementChild === this.credit || this.credit.contains(document.activeElement)) return
      parent.append(this.credit)
    }
    if (typeof MutationObserver !== 'undefined') new MutationObserver(keepCreditsLast).observe(parent, { childList: true })
  }

  /** The calibration state is engineering detail: the visitor's credits never carry it (the i panel states the look choice when it applies). */
  setVisibilityState(_id: string | null): void { /* no visitor text */ }

  /** Adds a credit sentence (a data set that loaded after the page did). */
  appendCredit(text: string): void {
    // These were previously appended when their manifest arrived. Their full names now live in the always-visible catalogue,
    // where the row can be highlighted only when it contributes to the current view.
    if (/^Polar imagery detail:/.test(text) || /^Apollo (?:11|17) site:/.test(text)
      || /^Apollo 17 lander area at 25 cm:/.test(text) || /^Lunar module: NASA 3D Resources/.test(text)) return
    if (this.creditExtras.includes(text)) return
    this.creditExtras.push(text)
    const li = document.createElement('li')
    li.textContent = text
    this.creditExtrasList.append(li)
    const section = this.creditExtrasList.parentElement
    if (section) section.hidden = this.creditExtrasList.childElementCount === 0
  }

  /** Updates only the badges whose frame facts changed; source rows and links stay mounted. */
  updateCredits(active: ReadonlySet<CreditId>): void {
    const key = CREDIT_CATALOG.map((row) => active.has(row.id) ? '1' : '0').join('')
    if (key === this.creditKey) return
    this.creditKey = key
    for (const row of CREDIT_CATALOG) {
      const on = active.has(row.id)
      const badge = this.creditBadges.get(row.id)
      if (badge) badge.hidden = !on
      const li = this.creditRows.get(row.id)
      li?.classList.toggle('in-view', on)
    }
    // Keep the marked sources above the fold on short phone screens while preserving one complete, stable catalogue.
    if (!this.creditCatalog.contains(document.activeElement)) {
      for (const row of [...CREDIT_CATALOG].sort((a, b) => Number(active.has(b.id)) - Number(active.has(a.id)))) {
        const el = this.creditRows.get(row.id)
        if (el) this.creditCatalog.append(el)
      }
    }
  }

  setCreditsProvider(provider: () => ReadonlySet<CreditId>): void { this.creditsProvider = provider }
  refreshCredits(): void { if (this.creditsProvider) this.updateCredits(this.creditsProvider()) }
  get creditsOpen(): boolean { return !this.creditFull.hidden }

  setHidden(hidden: boolean): void {
    this.root.classList.toggle('hidden', hidden)
  }

  message(text: string): void {
    this.main.textContent = text
  }

  /** The narrow-window query, created once: `matches` is live, so it answers as `matchMedia(...)` did at each call. */
  private readonly narrowQuery = window.matchMedia('(max-width: 800px)')
  /** The last `ground-mode` class state this panel wrote (the body starts without it). */
  private groundSeen = false

  update(i: HudInfo): void {
    const narrow = this.narrowQuery.matches
    const plan = planHud(i, narrow)
    if (plan.caption && this.caption) this.caption.setHome(plan.caption.title, plan.caption.hint)
    else if (this.caption) this.caption.setHome('', '')
    const html = !this.textOn && !i.archive ? '' : plan.lines.map((l, n) => `<div class="${n === 0 ? 'l1' : l.cls}">${l.html}</div>`).join('')
    // The loading message is plain text: an empty plan must clear it too, whatever lastHtml says.
    let htmlChanged = false
    if (html !== this.lastHtml || (html === '' && this.main.textContent !== '')) { this.lastHtml = html; this.main.innerHTML = html; htmlChanged = true }
    // The body class and offset the tour card and ground panel read (ui/tours.css).
    const ground = !!(i.flight || i.ground) && i.mode !== 'earth'
    if (ground !== this.groundSeen) { this.groundSeen = ground; document.body.classList.toggle('ground-mode', ground) }
    this.setNotes(plan.notes, plan.openNotes, htmlChanged)
    // The tour card stands under the text block and the i button.
    if (ground) document.documentElement.style.setProperty('--hud-bottom', `${Math.round(this.main.getBoundingClientRect().bottom + (this.infoBtn.hidden ? 10 : 44))}px`)
  }

  /** True while the notes panel is open (read only: Back asks before it acts). */
  notesOpen(): boolean {
    return this.notesEl.hidden === false
  }

  /** Closes the notes panel; true when it was open (Escape closes it before going Home). */
  closeNotes(): boolean {
    if (this.notesEl.hidden !== false) return false
    this.setOpen(false)
    return true
  }

  /** The I key: opens or closes the notes (nothing when there are none). */
  toggleNotes(): void {
    // Retained as a harmless hook for the old I-key binding.
  }

  /** The "i" button and its panel: every label that is not one of the three lines, reachable in one tap. */
  private setNotes(notes: string[], forceOpen: boolean, htmlChanged = true): void {
    const key = notes.join('\n')
    const notesChanged = key !== this.notesKey
    if (notesChanged) {
      this.notesKey = key
      this.notesEl.innerHTML = `<h2>About this view</h2>` + notes.map((n) => `<p>${n}</p>`).join('')
    }
    // Notes remain available to existing callers, but the information button is no longer part of the visitor UI.
    if (!this.infoBtn.hidden) this.infoBtn.hidden = true
    if (notes.length === 0) this.setOpen(false)
    // A toggle that exists to show labels (Origin) opens the panel the moment it turns on.
    if (forceOpen && !this.forcedOnce) { this.forcedOnce = true; this.setOpen(true) }
    if (!forceOpen) this.forcedOnce = false
    // The block's bottom edge only moves when its text, the notes or the window change: reading it every frame forced a layout after the writes above.
    const size = `${window.innerWidth}x${window.innerHeight}`
    if (htmlChanged || notesChanged || size !== this.notesLayoutSize || this.notesTop === null) {
      this.notesLayoutSize = size
      const top = Math.round(this.main.getBoundingClientRect().bottom + 4)
      if (top !== this.notesTop) { this.notesTop = top; this.infoBtn.style.top = `${top}px`; this.notesEl.style.top = `${top + 40}px` }
    }
  }

  private setOpen(open: boolean): void {
    void open
    if (!this.notesEl.hidden) this.notesEl.hidden = true
    if (!this.infoBtn.hidden) this.infoBtn.hidden = true
    if (this.infoBtn.getAttribute('aria-expanded') !== 'false') this.infoBtn.setAttribute('aria-expanded', 'false')
    if (this.infoBtn.getAttribute('aria-pressed') !== 'false') this.infoBtn.setAttribute('aria-pressed', 'false')
  }
}
