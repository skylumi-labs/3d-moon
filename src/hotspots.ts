import * as Astronomy from 'astronomy-engine'
import type { Ephemeris } from './ephemeris'
import { nextMorning, sunElevationDeg } from './sunMorning'
import { tychoMorning } from './viewDates'
import { PATCH_SITES } from './moon/patch/sites'
import { MOMENTS, type Moment } from './moments'
import { wrapLon } from './camera/pose'
import { TYCHO } from './labels/gazetteer'

/**
 * Hotspots: the places a visitor can fly to from Home (MOON-UX-REDESIGN.md, section 3.2). Each is a Moment (a date, a camera, a
 * caption) so it plays through the same machinery as the archive's tours (main.ts playMoment), plus the point on the Moon its pin
 * is drawn at. The archive's moments (moments.ts) stay as they were, behind ?archive=1.
 *
 * Captions are drafts for the owner's review and went through the no-ai-slop brief: one title, one sentence, no claim the
 * picture does not carry. Apollo 17 ends at eye level beside the fixed module (main.ts landingView('eye')).
 */
export interface Hotspot extends Moment {
  /** Where the pin is drawn on the Moon (selenographic degrees, east positive), for the ephemeris of the moment it is shown at. */
  pin(e: Ephemeris): { lon: number; lat: number }
  /** The distance the pin's own view is at, Moon radii: a camera this close and near to the pin fades it out (the view is already there). */
  viewDist: number
  /** False: listed in the Hotspots sheet only, with no pin drawn on the Moon (a view, not a place on it: From Earth). */
  pinned?: boolean
}

export { sunElevationDeg, nextMorning }

/** The next time the far side is fully lit (new Moon). */
export function nextNewMoon(from = new Date()): Date {
  const t = Astronomy.SearchMoonPhase(0, from, 40)
  return t ? t.date : from
}

const A11 = PATCH_SITES.a11, A17 = PATCH_SITES.a17
const fromMoment = (id: string): Moment => {
  const m = MOMENTS.find((x) => x.id === id)
  if (!m) throw new Error(`No moment ${id}`)
  return m
}

export const HOTSPOTS: Hotspot[] = [
  {
    id: 'pin-earth', label: 'View from Earth', title: 'View from Earth',
    caption: 'The Moon as it looks from the Earth right now.',
    watch: '', time: () => new Date(), camera: { at: 'earth' }, look: 'moon', live: true, dwellS: 9,
    pin: (e) => ({ lon: e.subEarth.lon, lat: e.subEarth.lat }), viewDist: 12, pinned: false,
  },
  {
    id: 'pin-tycho', label: 'Tycho Crater', title: 'Tycho Crater',
    caption: '85 km across, with rays that reach across much of the near side.',
    watch: '', time: tychoMorning, camera: { at: 'fly', lon: TYCHO.lon, lat: TYCHO.lat, dist: 1.225, pitch: 35 }, look: 'moon', dwellS: 12, needsTiles: true,
    pin: () => ({ lon: TYCHO.lon, lat: TYCHO.lat }), viewDist: 1.225,
  },
  {
    id: 'pin-copernicus', label: 'Copernicus Crater', title: 'Copernicus Crater',
    caption: 'A close view of the crater and its terraced wall.',
    watch: '', time: () => new Date('2026-10-20T19:00:00Z'), camera: { at: 'fly', lon: -20.08, lat: 9.62, dist: 1.18 }, look: 'moon', fovDeg: 30, dwellS: 12, needsTiles: true,
    pin: () => ({ lon: -20.08, lat: 9.62 }), viewDist: 1.18,
  },
  {
    ...fromMoment('apollo11'), id: 'pin-apollo11', label: 'Apollo 11 landing zone', title: 'Apollo 11 landing zone', camera: { at: 'siteView' }, dwellS: 12,
    caption: 'Tranquility Base on the 2011 orbiter photograph. The lander’s shadow is about five pixels wide.',
    pin: () => ({ lon: A11.lon, lat: A11.lat }), viewDist: 1.001,
  },
  {
    // The module stands fixed beside the ground view (no landing, no settle, no plume): the old 'Beside the LM' moment, quickened.
    ...fromMoment('land-lm-eye'), id: 'pin-apollo17', label: 'Apollo 17', title: 'Apollo 17', fixed: true, camera: { at: 'siteView' }, dwellS: 12,
    caption: 'Challenger in the Taurus-Littrow valley, on the 2011 photograph. The module is NASA’s model at the measured spot.',
    pin: () => ({ lon: A17.lon, lat: A17.lat }), viewDist: 1.001,
  },
  {
    // The same site as pin-apollo17, ending at eye level: the list's "Eye level" sub-view when the ground view is not already open.
    ...fromMoment('land-lm-eye'), id: 'pin-apollo17-eye', label: 'Apollo 17 at eye level', title: 'Apollo 17, eye level', fixed: true, camera: { at: 'siteView' }, dwellS: 12,
    caption: 'Eye level beside Challenger, on the 2011 photograph. The module is NASA’s model at the measured spot.',
    pin: () => ({ lon: A17.lon, lat: A17.lat }), viewDist: 1.001, pinned: false,
  },
  {
    id: 'pin-earthrise', label: 'Earthrise', title: 'Earthrise',
    caption: 'The Earth over the far-side limb, computed for this moment.',
    watch: '', time: () => new Date(), camera: { at: 'earthrise', dist: 4 }, look: 'earth', fovDeg: 20, dwellS: 11,
    // On the east limb as seen from the Earth: the nearest place to it a pin can sit on the visible side.
    pin: (e) => ({ lon: wrapLon(e.subEarth.lon + 80), lat: 0 }), viewDist: 4,
  },
]
