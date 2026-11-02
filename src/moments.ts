import * as Astronomy from 'astronomy-engine'
import { HANDOVER_T, IGNITION_UTC_MS } from './descent/DescentPath'
import { ORBIT_SECONDS, ORBIT_START_ARC_DEG } from './journey/lifecycle'
import { flightMorning, platoMorning, tychoMorning } from './viewDates'
import { APOLLO17_ALSEP } from './ground/pano/manifest'

/**
 * Moments: real dates, each with a camera. Eclipse times are greatest
 * eclipse from astronomy-engine 2.1.19 (checked against NASA's tables:
 * 2 Aug 2027 10:07 UT, 31 Dec 2028 16:52 UT, 26 Jun 2029 03:22 UT).
 *
 * A camera is where to put the viewpoint once the moment's time is set:
 *   earth     the Earth view, as an orbit pose far out with a narrow lens (the dolly zoom out of it is gone);
 *   fly       above a selenographic point (east longitude, latitude, deg),
 *             `dist` Moon radii from the centre;
 *   subEarth  above the point that faces the Earth at that moment;
 *   subSun    above the point that faces the Sun.
 * `look` turns the view from the Moon's centre toward another body.
 * `fovDeg` narrows the fly field (default 30 deg across the short side):
 * the Earth spans under 2 deg from the Moon, so views of it need a longer lens.
 */
export type MomentCamera =
  | { at: 'earth' }
  | { at: 'fly'; lon: number; lat: number; dist: number; /** Tilt from straight down toward the horizon, deg (only felt near the ground). */ pitch?: number }
  /** Over the far side's centre (the point facing away from the Earth). */
  | { at: 'antiEarth'; dist: number }
  /** Near the lunar limb, looking back past it toward the Earth (look 'earth'). */
  | { at: 'earthrise'; dist: number; /** Earth-centre height above the lunar limb in Earth radii. */ aboveLimbEarthR?: number; /** Camera path bearing from the far-side point, degrees clockwise from north. */ bearingDeg?: number }
  /** East of the subsolar point, at a Sun-to-camera angle in degrees; used for real limb-occultation shots. */
  | { at: 'solarHorizon'; dist: number; sunAngleDeg: number }
  | { at: 'subEarth' | 'subSun'; dist: number }
  /** arcDeg from the subsolar point toward the morning terminator (the solar-eclipse flight's first sample). */
  | { at: 'sunArc'; dist: number; arcDeg: number }
  /** A pin's own view of a patch site: one planned fly-to (journey/path.ts, under 3 s) to the site's end view, once its photograph is in. */
  | { at: 'siteView' }
  /** Over the site patch (Apollo 11 or 17): a scripted descent from the current view to the patch's floor (main.ts). */
  | { at: 'site' }
  /** The Apollo 17 powered descent on the real 1972 clock (src/descent/, main.ts startFlight). */
  | { at: 'descent' }

export interface Moment {
  id: string
  /** Short text for the tour button. */
  label: string
  title: string
  /** One or two sentences a visitor reads under the title. */
  caption: string
  /** One line: what to look at in the frame. */
  watch: string
  time: () => Date
  camera: MomentCamera
  /** Optional continuous camera flight that starts after the approach tween. */
  cinematicFlight?: string
  look: 'moon' | 'earth' | 'sun'
  /** Field across the short side, deg (default: the fly view's 30). */
  fovDeg?: number
  /** The Earth look's earthrise waypoint distance, Moon radii (default 5): farther makes the Moon a smaller disc beside the Earth. */
  earthWaypointR?: number
  /** Start the slow orbit at once (the fly-around). */
  orbit?: boolean
  /** Follow the clock instead of fixing the time. */
  live?: boolean
  /** Seconds a "Play all" stays on this moment. */
  dwellS: number
  /** Needs the milestone-2 tiles: not offered when the site has no tile base (main.ts). */
  needsTiles?: boolean
  /** Needs the patch of this site (id in src/moon/patch/sites.ts): not offered when that patch is not there. */
  needsPatch?: string
  /** Needs the patch's optional 25 cm tier (its manifest is probed with the patch's). */
  needsTier?: boolean
  /** Where a site tour ends when it is not the site's own end (sites.ts): heading and tilt in degrees, floors up; `tier` counts the floors of the 25 cm tier. */
  end?: { headingDeg: number; pitchDeg: number; altFactor?: number; tier?: boolean }
  /** After the descent, hand over to ground mode (src/ground/) and glide to a place beside the Apollo 17 lunar module: 'hover' 30 m to the north-west and 10 m up, 'eye' at 1.7 m, 20 m from a leg. */
  groundEnd?: 'hover' | 'eye'
  /** The module stands fixed at its measured spot and the way there is short (a pin of the planner, not a tour): a quick descent and a short glide to the ground view. */
  fixed?: boolean
}

/** Greatest eclipse of the total solar eclipse of 2 Aug 2027 (6 min 23 s; NASA 10:07:50 UT near 25.5 N 33.2 E; checked against astronomy-engine in scripts/solar-eclipse-geometry.test.mts). */
export const SOLAR_ECLIPSE_2027_UTC = '2027-08-02T10:07:50Z'

function nextNewMoon(from = new Date()): Date {
  const t = Astronomy.SearchMoonPhase(0, from, 40)
  return t ? t.date : from
}

/**
 * The next thin waxing crescent: the Moon 40 deg east of the Sun (about 12%
 * lit), searched forward from now so the date never passes. It is the
 * evening crescent, the one with earthshine.
 */
export function nextThinCrescent(from = new Date()): Date {
  const t = Astronomy.SearchMoonPhase(40, from, 40)
  return t ? t.date : from
}

/**
 * The tours, in play order. 'surface' (Milestone 2) ends near the ground:
 * `dist` 1.5 is the closest the data allows (camera/pose.ts floorDist gives
 * 1.45 to 1.6 for phones and desktops), and main.ts drops the entry when the
 * site has no tile base. The buttons, keys, ?moment= links and Play all all
 * read this array.
 */
export const MOMENTS: Moment[] = [
  {
    id: 'first-light',
    label: 'Sunrise above the Moon',
    title: 'Sunrise above the Moon',
    caption: 'The low-orbit view moves to where the Sun is just emerging from behind the lunar limb. Its position is calculated for the sky time shown.',
    watch: 'The Sun’s first bright edge over the Moon’s limb.',
    time: () => new Date(),
    camera: { at: 'solarHorizon', dist: 1.5, sunAngleDeg: 138.31 },
    look: 'moon',
    fovDeg: 80,
    dwellS: 8,
    needsTiles: true,
  },
  {
    id: 'earthrise',
    label: 'Earthrise',
    title: 'Earthrise',
    caption: 'A reconstruction inspired by Apollo 8’s 1968 Earthrise photograph. The date and Earth phase follow the ephemeris; the modern lunar map and the camera path are illustrative, not the spacecraft’s recorded track.',
    watch: 'The partly sunlit Earth rising over the curved lunar horizon.',
    time: () => new Date('1968-12-24T16:39:39Z'),
    camera: { at: 'earthrise', dist: 1.065, aboveLimbEarthR: -1.2, bearingDeg: 90 },
    look: 'earth',
    fovDeg: 10.5,
    cinematicFlight: 'apollo8-earthrise',
    needsTiles: true,
    dwellS: 8,
  },
  {
    id: 'solar-eclipse',
    label: 'Solar eclipse, 2 August 2027',
    title: 'Solar eclipse, 2 August 2027',
    caption: 'The total solar eclipse of 2 August 2027 (predicted), from the Moon: the Sun about to rise over the horizon of the lunar night, the Moon between the Sun and the Earth, then the Moon’s shadow on the Earth. The camera path is illustrative; the Sun, Earth and shadow are computed for the moment of greatest eclipse.',
    watch: 'The small dark spot on the sunlit Earth near Egypt is the total shadow; the soft darkening round it is the partial shadow.',
    time: () => new Date(SOLAR_ECLIPSE_2027_UTC),
    camera: { at: 'sunArc', dist: 1.12, arcDeg: 114 },
    look: 'moon',
    fovDeg: 46,
    cinematicFlight: 'solar-eclipse',
    needsTiles: true,
    dwellS: 8,
  },
  {
    id: 'now',
    label: 'Now',
    title: 'Now',
    caption: 'The Moon as it is right now, seen from the Earth’s centre.',
    watch: 'The terminator, the line between day and night, and the craters that catch the low light beside it.',
    time: () => new Date(),
    camera: { at: 'earth' },
    look: 'moon',
    live: true,
    dwellS: 9,
  },
  {
    id: 'fly-around',
    label: 'Fly around the Moon',
    title: 'Fly around the Moon',
    caption: `The camera goes once around the Moon in ${ORBIT_SECONDS} seconds, so you see every side. It starts over the sunlit Moon, slows while the Sun sets behind the limb and rises on the other side, and ends back in the light.`,
    watch: 'The Sun setting behind the Moon, and coming out on the other side.',
    time: () => new Date(),
    // ORBIT_START_ARC_DEG (50) east of the subsolar point: a lit start, under 90 deg from the Sun; the Sun hides behind the limb from 168.5 deg at 5 radii (lifecycle.ts).
    camera: { at: 'sunArc', dist: 5, arcDeg: -ORBIT_START_ARC_DEG },
    look: 'moon',
    orbit: true,
    live: true,
    dwellS: 14,
  },
  {
    id: 'far-side',
    label: 'Far side fully lit',
    title: 'The far side, fully lit',
    caption: 'At new Moon the side we never see faces the Sun. It is only dark from the Earth.',
    watch: 'Few dark seas. The far side has far fewer of them than the side we see.',
    time: () => nextNewMoon(),
    camera: { at: 'subSun', dist: 6 },
    look: 'moon',
    dwellS: 9,
  },
  {
    id: 'surface',
    label: 'Copernicus Crater',
    title: 'Copernicus Crater',
    caption: 'A drone-style flight. The camera drops toward Copernicus crater and circles it, with the Sun low over the rim. The route is an illustration, not a mission track.',
    watch: 'The terraced wall and the shadows across the crater floor.',
    time: () => new Date('2026-10-20T19:00:00Z'),
    camera: { at: 'fly', lon: -20.08, lat: 4.62, dist: 1.3, pitch: 16 },
    look: 'moon',
    fovDeg: 50,
    cinematicFlight: 'copernicus-flyover',
    dwellS: 10,
    needsTiles: true,
  },
  {
    id: 'taurus-littrow-pass',
    label: 'Across Taurus-Littrow',
    title: 'A low pass through Taurus-Littrow',
    caption: 'An illustrative low camera pass crosses the Taurus-Littrow valley. The route follows the loaded site floor and is not a recorded Apollo 17 flight path.',
    watch: 'The valley floor between the massifs.',
    time: () => new Date('2011-01-23T06:00:00Z'),
    camera: { at: 'fly', lon: 30.05, lat: 20.28, dist: 1.004, pitch: 69 },
    look: 'moon',
    fovDeg: 50,
    cinematicFlight: 'taurus-littrow-pass',
    dwellS: 8,
    needsTiles: true,
    needsPatch: 'a17',
  },
  {
    id: 'apollo11',
    label: 'Zoom to Apollo 11',
    title: 'Down to Tranquility Base',
    caption: 'The Moon on 22 January 2011, the day the Lunar Reconnaissance Orbiter photographed the Apollo 11 landing site. The descent starts on the global map. The last kilometre is that photograph, 0.5 m per pixel, with heights on a 2 m grid. The Sun is the one that lit the photograph, 27 degrees up in the west.',
    watch: 'The craters around the landing site, growing from dots into bowls. The lander is too small to see: its shadow is about five pixels wide in the photograph.',
    time: () => new Date('2011-01-22T19:00:00Z'),
    camera: { at: 'site' },
    look: 'moon',
    dwellS: 34,
    needsTiles: true,
    needsPatch: 'a11',
  },
  {
    id: 'apollo17',
    label: 'Zoom to Apollo 17',
    title: 'Down into the Taurus-Littrow valley',
    caption: 'The Moon on 23 January 2011, with the Sun 14 degrees up in the west. The last kilometres are LROC photographs, 0.6 m per pixel, with heights on a 2 m grid (NASA/GSFC/Arizona State University). Six passes under different Suns are flattened to surface colour and lit again by this Sun, so every shadow comes from the heights. Where no photograph exists the ground is smooth and the heights are the global LOLA map.',
    watch: 'The valley floor and the long shadows the massifs throw across it.',
    time: () => new Date('2011-01-23T06:00:00Z'),
    camera: { at: 'site' },
    look: 'moon',
    dwellS: 38,
    needsTiles: true,
    needsPatch: 'a17',
  },
  {
    id: 'apollo17-25cm',
    label: 'Zoom to Apollo 17 (25 cm)',
    title: 'The ground around the lunar module',
    caption: 'The Moon on 23 January 2011, with the Sun 14 degrees up in the west. Around the lunar module the ground is a photograph resampled to 25 cm (Haase and colleagues, TU Berlin and DLR, from LROC images), with heights on a 1.5 m grid. Its own Sun was higher, so this Sun casts the shadows. The camera stops where a pixel is about 40 cm, because the photograph’s real pixels are 27 by 56 cm.',
    watch: 'The craters, boulders and trampled ground around the lunar module, and how far the photograph reaches.',
    time: () => new Date('2011-01-23T06:00:00Z'),
    camera: { at: 'site' },
    look: 'moon',
    dwellS: 38,
    needsTiles: true,
    needsPatch: 'a17',
    needsTier: true,
    end: { headingDeg: 0, pitchDeg: 58, altFactor: 1, tier: true },
  },
  {
    id: 'land-lm',
    label: 'Beside the LM',
    title: 'Beside the lunar module, under the 1972 Sun',
    caption: 'The Sun of 12 December 1972 at 06:22 UTC, near the end of Apollo 17’s first moonwalk, 18 degrees up in the east, so the module’s shadow falls west as the crew saw it. The ground is the 2011 LROC photograph and terrain model lit again by that Sun, and the rover, flag, instruments and tracks are not drawn. The module is NASA’s 3D model at the measured position. Its heading is inferred and its materials are a guess.',
    watch: 'The module’s shadow on the ground, and its legs resting on the slope.',
    time: () => new Date(APOLLO17_ALSEP.timeUtc),
    camera: { at: 'site' },
    look: 'moon',
    dwellS: 50,
    needsTiles: true,
    needsPatch: 'a17',
    needsTier: true,
    end: { headingDeg: 0, pitchDeg: 58, altFactor: 1, tier: true },
    groundEnd: 'hover',
  },
  {
    id: 'land-lm-eye',
    label: 'Walk up to the LM',
    title: 'Eye level, 20 m from a leg',
    caption: 'The same 1972 morning Sun, at the height of a standing astronaut’s eyes, 20 m from one of the legs. The ground is the 2011 photograph and terrain model magnified past the data, so nothing finer than about 40 cm is measured; the massifs are the terrain model, not a photograph. The rover, flag, instruments and tracks are not drawn. The module’s heading is inferred and its materials are a guess.',
    watch: 'The leg and footpad, and the low eastern light along the massifs.',
    time: () => new Date(APOLLO17_ALSEP.timeUtc),
    camera: { at: 'site' },
    look: 'moon',
    dwellS: 52,
    needsTiles: true,
    needsPatch: 'a17',
    needsTier: true,
    end: { headingDeg: 0, pitchDeg: 58, altFactor: 1, tier: true },
    groundEnd: 'eye',
  },
  {
    id: 'terminator-run', label: 'Long shadows', title: 'Along the terminator',
    caption: 'A low flight follows the day and night boundary, where the Sun throws long shadows across the relief.',
    watch: 'The long shadows at the edge of lunar night.', time: () => flightMorning('terminator-run'),
    camera: { at: 'fly', lon: -35, lat: -25, dist: 1.03, pitch: 62 }, look: 'moon', fovDeg: 42,
    cinematicFlight: 'terminator-run', needsTiles: true, dwellS: 8,
  },
  {
    id: 'earthrise-low', label: 'Earthrise low', title: 'Earth above the mountains',
    caption: 'A low pass skims a mountain range near the lunar limb as Earth rises into view.',
    watch: 'Earth rising above the mountain horizon.', time: () => new Date('1968-12-24T16:39:39Z'),
    camera: { at: 'fly', lon: 88, lat: -8, dist: 1.0825, pitch: 58 }, look: 'moon', fovDeg: 28,
    cinematicFlight: 'earthrise-low', needsTiles: true, dwellS: 8,
  },
  {
    id: 'plato-rim', label: 'Plato Crater', title: 'Plato Crater',
    caption: 'A low orbit circles Plato and keeps the crater at the centre of the view.',
    watch: 'Plato’s rim and dark, level floor.', time: platoMorning,
    camera: { at: 'fly', lon: -15.3, lat: 51.6, dist: 1.0975, pitch: 55 }, look: 'moon', fovDeg: 42,
    cinematicFlight: 'plato-rim', needsTiles: true, dwellS: 8,
  },
  {
    id: 'tycho-rim', label: 'Tycho Crater', title: 'Tycho Crater',
    caption: 'A low orbit circles Tycho while the crater stays in view.',
    watch: 'Tycho’s terraced rim and central peak.', time: tychoMorning,
    camera: { at: 'fly', lon: -15.5, lat: -43.3, dist: 1.0975, pitch: 55 }, look: 'moon', fovDeg: 36,
    cinematicFlight: 'tycho-rim', needsTiles: true, dwellS: 8,
  },
  {
    id: 'rille-run', label: 'Hadley Rille', title: 'Along Hadley Rille',
    caption: 'A low flight follows Hadley Rille through the Apollo 15 landing region.',
    watch: 'The winding channel cut into the valley floor.', time: () => flightMorning('rille-run'),
    camera: { at: 'fly', lon: 3.1, lat: 26.9, dist: 1.0675, pitch: 58 }, look: 'moon', fovDeg: 36,
    cinematicFlight: 'rille-run', needsTiles: true, dwellS: 8,
  },
  {
    id: 'pole-limb-sweep', label: 'Pole to limb', title: 'From pole to limb',
    caption: 'The camera sweeps from the north polar highlands down to the lunar limb.',
    watch: 'The curve of the Moon from high polar orbit.', time: () => new Date('2026-10-20T19:00:00Z'),
    camera: { at: 'fly', lon: 0, lat: 85, dist: 1.4, pitch: 30 }, look: 'moon', fovDeg: 48,
    cinematicFlight: 'pole-limb-sweep', needsTiles: true, dwellS: 8,
  },
  {
    id: 'bank-turn-a', label: 'Banked S-turn A', title: 'Banked turn over the highlands',
    caption: 'A low S-turn banks through rugged lunar highlands before lifting toward the horizon.',
    watch: 'The banks and broken highland ridges.', time: () => new Date('2026-10-20T19:00:00Z'),
    camera: { at: 'fly', lon: -18, lat: 24, dist: 1.1125, pitch: 48 }, look: 'moon', fovDeg: 38,
    cinematicFlight: 'bank-turn-a', needsTiles: true, dwellS: 8,
  },
  {
    id: 'bank-turn-b', label: 'Banked S-turn B', title: 'A longer banked turn',
    caption: 'A longer low pass weaves through the highlands with a gentle bank on each turn.',
    watch: 'The changing horizon above the ridges.', time: () => new Date('2026-10-20T19:00:00Z'),
    camera: { at: 'fly', lon: -24, lat: 18, dist: 1.1275, pitch: 45 }, look: 'moon', fovDeg: 42,
    cinematicFlight: 'bank-turn-b', needsTiles: true, dwellS: 8,
  },
  {
    id: 'sunrise-arc-a', label: 'Sunrise arc A', title: 'First light on the horizon',
    caption: 'A low arc follows the dawn boundary as sunlight reaches the lunar ridges.',
    watch: 'The first light and long foreground shadows.', time: () => flightMorning('sunrise-arc-a'),
    camera: { at: 'fly', lon: -35, lat: 7, dist: 1.0825, pitch: 68 }, look: 'moon', fovDeg: 25,
    cinematicFlight: 'sunrise-arc-a', needsTiles: true, dwellS: 8,
  },
  {
    id: 'sunrise-arc-b', label: 'Sunrise arc B', title: 'Dawn across the ridgeline',
    caption: 'A wider dawn arc skims the ridges while the Sun approaches the horizon.',
    watch: 'The glow at the edge of lunar morning.', time: () => flightMorning('sunrise-arc-b'),
    camera: { at: 'fly', lon: -40, lat: -6, dist: 1.0975, pitch: 64 }, look: 'moon', fovDeg: 28,
    cinematicFlight: 'sunrise-arc-b', needsTiles: true, dwellS: 8,
  },
  {
    id: 'limb-glide-a', label: 'Limb glide A', title: 'Earth beyond the limb',
    caption: 'A slow bank skims above the lunar limb with Earth low in the background.',
    watch: 'The curved lunar horizon and Earth beyond it.', time: () => new Date('1968-12-24T16:39:39Z'),
    camera: { at: 'fly', lon: 70, lat: 16, dist: 1.195, pitch: 24 }, look: 'moon', fovDeg: 36,
    cinematicFlight: 'limb-glide-a', needsTiles: true, dwellS: 8,
  },
  {
    id: 'limb-glide-b', label: 'Limb glide B', title: 'A longer limb glide',
    caption: 'A longer, gradual bank follows the lunar limb with Earth hanging low beyond it.',
    watch: 'Earth low against the lunar horizon.', time: () => new Date('1968-12-24T16:39:39Z'),
    camera: { at: 'fly', lon: 67, lat: -19, dist: 1.255, pitch: 20 }, look: 'moon', fovDeg: 40,
    cinematicFlight: 'limb-glide-b', needsTiles: true, dwellS: 8,
  },
]

// The real-1972 landing tour last: it runs on its own clock (the descent's 11 December 1972, not the moment's date) and takes about 14 minutes.
export const ARCHIVED_MOMENTS: Moment[] = [{
  id: 'land-like-apollo17',
  label: 'Land like Apollo 17',
  title: 'Land like Apollo 17, 11 December 1972',
  caption: 'Challenger’s descent on the real clock, from 20 km up to touchdown at 19:54:58 UTC. The ground is 2011 LROC photographs lit again by the 1972 Sun, so the module’s shadow falls west. The rover, flag and instruments, and their traces in the 2011 photograph, are not drawn. The path is a model built from the crew’s calls and the Mission Report. Horizontal speed is an estimate with a band, and the heading and tilt are inferred.',
  watch: 'The ground coming up, the shadow to the west, and the dust from about 60 feet.',
  time: () => new Date(IGNITION_UTC_MS + HANDOVER_T * 1000),
  camera: { at: 'descent' },
  look: 'moon',
  dwellS: 900,
  needsTiles: true,
  needsPatch: 'a17',
  needsTier: true,
}]

export const momentById = (id: string): Moment | undefined => MOMENTS.find((m) => m.id === id)
