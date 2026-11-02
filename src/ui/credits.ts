/** Source catalogue and the conservative frame facts used by the Credits popover. */
import { PROCESSED_BY, RENDERING_MODEL_CREDIT } from '../branding'

export type CreditId =
  | 'moon-base' | 'lunar-tiles' | 'polar-wac' | 'jaxa-tc' | 'apollo-11' | 'apollo-17' | 'apollo-17-tier' | 'apollo-17-flight'
  | 'lunar-module' | 'earth-maps' | 'hyg-stars' | 'astronomy-engine' | 'modelled-light'
  | 'gazetteer' | 'apollo-17-panoramas' | 'open-source' | 'telemetry'

export interface CreditEntry {
  id: CreditId
  title: string
  credit: string
  detail: string
  links: Array<{ label: string; href: string }>
}

export const CREDIT_CATALOG: readonly CreditEntry[] = [
  {
    id: 'moon-base', title: 'Moon base maps',
    credit: "NASA's Scientific Visualization Studio; Ernie Wright; Noah Petro; LRO Camera team / Arizona State University; LOLA",
    detail: 'The globe uses the pinned 2019 NASA SVS CGI Moon Kit 4720 colour and elevation maps. The colour is derived from LROC WAC; the elevation is LOLA. This is a visualization product, not a uniform-resolution survey.',
    links: [{ label: 'NASA SVS CGI Moon Kit 4720', href: 'https://svs.gsfc.nasa.gov/4720/' }],
  },
  {
    id: 'lunar-tiles', title: 'Global close-up imagery and terrain',
    credit: 'Barker et al. (2016); NASA/GSFC/MIT (LOLA); Japan Aerospace Exploration Agency (JAXA), SELENE/Kaguya Terrain Camera; NASA/GSFC/Arizona State University (LROC WAC); Wagner, Speyerer, Robinson and the LROC Team (2015), LROC WAC Global Morphology Mosaic',
    detail: 'Hosted close-up tiles combine WAC colour and global WAC detail with SLDEM2015 terrain from LOLA and SELENE/Kaguya Terrain Camera stereo within 60° latitude; toward the poles, the terrain source is LOLA. Polar heights above 85° are low-pass filtered, so fine relief there is smoothed. Grid spacing is not the same as independent measurement resolution.',
    links: [{ label: 'LROC QuickMap', href: 'https://quickmap.lroc.asu.edu/' }, { label: 'SLDEM2015 product record', href: 'https://pgda.gsfc.nasa.gov/products/54' }, { label: 'LOLA PDS archive', href: 'https://pds-geosciences.wustl.edu/missions/lro/lola.htm' }, { label: 'WAC Global Morphology Mosaic 100 m (Wagner et al., 2015, LPSC 46)', href: 'https://astrogeology.usgs.gov/search/map/moon_lro_lroc_wac_global_morphology_mosaic_100m' }],
  },
  {
    id: 'polar-wac', title: 'Polar colour detail',
    credit: 'LROC WAC team, NASA/GSFC/Arizona State University; Speyerer, Robinson, Boyd, Wagner and Henriksen (2020), Exploration of the lunar south pole with LROC data products, Lunar Surface Science Workshop, Abstract #5132',
    detail: 'North and south summer WAC 643 nm imagery is high-pass colour detail. It retains residual illumination from the source mosaic and is not true albedo.',
    links: [{ label: 'LROC WAC north summer 100 m product', href: 'https://data.lroc.im-ldi.com/lroc/view_rdr_product/WAC_ROI_NORTH_SUMMER_100M' }, { label: 'LROC WAC south summer 100 m product', href: 'https://data.lroc.im-ldi.com/lroc/view_rdr_product/WAC_ROI_SOUTH_SUMMER_100M' }, { label: 'Speyerer et al. (2020), LSSW Abstract #5132 (cited on the LROC product page)', href: 'https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_ROI_NORTH_SUMMER' }],
  },
  {
    id: 'jaxa-tc', title: 'SELENE (Kaguya) Terrain Camera detail',
    credit: 'ISAS/JAXA (modified)',
    detail: `Fine surface texture from the SELENE (Kaguya) Terrain Camera orthomosaic, processed by ${PROCESSED_BY} into a brightness-ratio layer over the WAC colour. The data was modified. We thank the SELENE(KAGUYA) TC team and the SELENE Data Archive.`,
    links: [{ label: 'JAXA SELENE data archive (DARTS)', href: 'https://darts.isas.jaxa.jp/planet/pdap/selene/' }],
  },
  {
    id: 'apollo-11', title: 'Apollo 11 site detail',
    credit: 'LROC NAC; NASA/GSFC/Arizona State University',
    detail: 'The site photograph and terrain model are localized products built from LROC NAC and lunar elevation data.',
    links: [{ label: 'LROC QuickMap', href: 'https://quickmap.lroc.asu.edu/' }],
  },
  {
    id: 'apollo-17', title: 'Apollo 17 site detail',
    credit: 'LROC NAC; NASA/GSFC/Arizona State University',
    detail: 'The site photograph and terrain model are localized products built from LROC NAC and lunar elevation data.',
    links: [{ label: 'LROC QuickMap', href: 'https://quickmap.lroc.asu.edu/' }],
  },
  {
    id: 'apollo-17-tier', title: 'Apollo 17 lander-area tier',
    credit: 'I. Haase, M. Wählisch, P. Gläser, J. Oberst and M. S. Robinson (TU Berlin, DLR), Earth and Space Science 6(1), 59-95, 2019; LROC; NASA/GSFC/Arizona State University; USGS PDS Annex',
    detail: 'The 25 cm orthomosaic is resampled from native 27 × 56 cm NAC pixels. Its companion DTM is a 1.5 m grid. The image ratio is not true albedo.',
    links: [{ label: 'USGS Apollo 17 product record', href: 'https://astrogeology.usgs.gov/search/map/moon_apollo_17_lroc_nac_landing_site_orthomosaic_50cm' }, { label: 'Haase et al. (2019), doi:10.1029/2018EA000408', href: 'https://doi.org/10.1029/2018EA000408' }],
  },
  {
    id: 'apollo-17-panoramas', title: 'Apollo 17 surface panoramas',
    credit: 'NASA/JSC. Original flight-film panoramas (JSC2004e52772, JSC2007e045388, JSC2007e045387) assembled by Warren Harold at Johnson Space Center.',
    detail: 'The panoramas are mosaics of Apollo 17 surface photographs, shown as a historical record. NASA media guidelines apply; the astronauts pictured are Eugene Cernan and Harrison Schmitt.',
    links: [{ label: 'NASA image record JSC2004e52772', href: 'https://images.nasa.gov/details/jsc2004e52772' }, { label: 'NASA media usage guidelines', href: 'https://www.nasa.gov/nasa-brand-center/images-and-media/' }],
  },
  {
    id: 'apollo-17-flight', title: 'Apollo 17 descent and landing record',
    credit: 'NASA Manned Spacecraft Center; Apollo Lunar Surface Journal by Eric M. Jones and Ken Glover',
    detail: 'The powered-descent timeline and calls are transcribed from mission records; the pre-ignition orbit, interpolated intervals, dust, and camera motion are modelled and identified in the flight notes.',
    links: [
      { label: 'Apollo 17 Mission Report (JSC-07904)', href: 'https://ntrs.nasa.gov/archive/nasa/casi.ntrs.nasa.gov/19730015117.pdf' },
      { label: 'Apollo Lunar Surface Journal', href: 'https://www.nasa.gov/history/alsj-and-afj/' },
    ],
  },
  {
    id: 'lunar-module', title: 'Lunar Module model',
    credit: 'NASA 3D Resources; model by Michael D. Carbajal',
    detail: 'NASA’s generic Apollo Lunar Module model is used; it is not a model of LM-12.',
    links: [{ label: 'NASA Apollo Lunar Module model', href: 'https://science.nasa.gov/3d-resources/apollo-lunar-module/' }, { label: 'NASA media usage guidelines', href: 'https://www.nasa.gov/nasa-brand-center/images-and-media/' }],
  },
  {
    id: 'earth-maps', title: 'Earth maps',
    credit: 'Blue Marble: Reto Stöckli, NASA Earth Observatory (NASA Goddard Space Flight Center); clouds: NASA GSFC image by Reto Stöckli, enhancements by Robert Simmon, MODIS Land, Atmosphere and Ocean groups and MODIS Science Data Support Team; Black Marble: NASA Earth Observatory images by Joshua Stevens, using Suomi NPP VIIRS data from Miguel Román, NASA GSFC; water mask: NASA GIBS / MOD44W (Carroll et al., 2009).',
    detail: 'Blue Marble Next Generation monthly land, Blue Marble clouds, 2016 Black Marble night lights, and the MOD44W water mask. The displayed night-light scale is modelled; clouds are a 2002 map, not current weather. Earth air is one modelled clear state, not today’s weather.',
    links: [
      { label: 'Blue Marble Next Generation', href: 'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/' },
      { label: 'Blue Marble clouds (Visible Earth archive copy)', href: 'https://archive.org/details/VE-IMG-2432' },
      { label: 'Black Marble', href: 'https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/' },
      { label: 'NASA GIBS', href: 'https://gibs.earthdata.nasa.gov/' },
    ],
  },
  {
    id: 'hyg-stars', title: 'Stars', credit: 'HYG Database contributors, CC BY-SA 4.0',
    detail: `A catalogue to visual magnitude 6.5, adapted by ${PROCESSED_BY} to a compact JSON file that is served openly. The apparent star brightness is computed from catalogue flux and the view’s pixel scale.`,
    links: [{ label: 'HYG database', href: 'https://codeberg.org/astronexus/hyg' }, { label: 'CC BY-SA 4.0 licence', href: 'https://creativecommons.org/licenses/by-sa/4.0/' }],
  },
  {
    id: 'astronomy-engine', title: 'Solar-system positions', credit: 'Astronomy Engine by Don Cross, MIT licence',
    detail: 'Sun, Moon and planet positions use Astronomy Engine. The viewer’s shadowing, exposure and atmospheric scattering are calculated or modelled from those positions.',
    links: [{ label: 'Astronomy Engine', href: 'https://github.com/cosinekitty/astronomy' }],
  },
  {
    id: 'gazetteer', title: 'Feature names',
    credit: 'IAU WGPSN, Gazetteer of Planetary Nomenclature (USGS Astrogeology Science Center)',
    detail: 'Crater, mare and other feature names and positions come from the IAU Gazetteer of Planetary Nomenclature, which is in the public domain. Label positions are the gazetteer’s centre points.',
    links: [{ label: 'Gazetteer of Planetary Nomenclature', href: 'https://planetarynames.wr.usgs.gov/' }],
  },
  {
    id: 'open-source', title: 'Open-source notices',
    credit: 'three.js (MIT), Astronomy Engine (MIT), Sentry browser SDK (MIT), posthog-js (Apache-2.0 and MIT), Tabler Icons by Paweł Kuna (MIT), Draco (Apache-2.0), Jost (SIL Open Font License 1.1), Share Tech Mono (SIL Open Font License 1.1), HYG Database (CC BY-SA 4.0), Bruneton atmosphere parametrisation (BSD-3-Clause)',
    detail: 'The full licence texts for the software and data this viewer ships are in one notices file.',
    links: [{ label: 'Third-party notices', href: `${((import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ?? '/'}THIRD-PARTY-NOTICES.txt` }],
  },
  {
    id: 'telemetry', title: 'Anonymous statistics',
    credit: 'Anonymous performance and error stats (no cookies) help us fix stutter.',
    detail: 'The published viewer sends error reports and a small frame-timing summary per flight or drag. No cookies, no recordings, no account, no IP address kept. Add ?telemetry=0 to the address to turn it off.',
    links: [],
  },
  {
    id: 'modelled-light', title: 'Modelled light and atmosphere', credit: RENDERING_MODEL_CREDIT,
    detail: 'The Sun’s direct light is computed from the ephemeris. Earthshine, atmospheric scattering, lunar earthlight, and display exposure choices are modelled; they are not brightness measurements. Terrain shadows are lifted by a modelled 3% fill for legibility.',
    links: [],
  },
] as const

/** Facts about sources that can contribute to the current rendered view, not what happened to load. */
export interface CreditsContext {
  moonVisible: boolean
  lunarTilesVisible: boolean
  polarWacVisible: boolean
  /** JAXA TC detail tiles can contribute in this frame (opt-in `?tc=`); absent counts as false. */
  jaxaTcVisible?: boolean
  sitePatchVisible: 'a11' | 'a17' | null
  apollo17TierVisible: boolean
  apollo17FlightVisible: boolean
  lunarModuleVisible: boolean
  earthVisible: boolean
  starsVisible: boolean
}

export interface CreditCamera {
  pos: readonly [number, number, number]
  right: readonly [number, number, number]
  up: readonly [number, number, number]
  back: readonly [number, number, number]
  tanHalf: number
  aspect: number
}

const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const length = (a: readonly number[]): number => Math.hypot(a[0], a[1], a[2])
const sub = (a: readonly number[], b: readonly number[]): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

/** True when any part of a sphere crosses the viewport and some of its disc is not hidden by a nearer sphere. */
export function sphereVisibleInFrame(camera: CreditCamera, centre: readonly [number, number, number], radius: number,
                                     occluders: ReadonlyArray<{ centre: readonly [number, number, number]; radius: number }> = []): boolean {
  const rel = sub(centre, camera.pos)
  const distance = length(rel)
  if (distance <= radius) return true
  const forward = -dot(rel, camera.back)
  if (forward <= 0) return false
  const projectedX = dot(rel, camera.right) / forward
  const projectedY = dot(rel, camera.up) / forward
  const tangentRadius = radius / Math.sqrt(Math.max(1e-12, distance * distance - radius * radius))
  if (Math.abs(projectedX) > camera.tanHalf * camera.aspect + tangentRadius || Math.abs(projectedY) > camera.tanHalf + tangentRadius) return false
  const direction = rel.map((v) => v / distance)
  for (const blocker of occluders) {
    const toBlocker = sub(blocker.centre, camera.pos)
    const blockerDistance = length(toBlocker)
    if (blockerDistance <= blocker.radius || blockerDistance + blocker.radius >= distance - radius) continue
    const blockerDirection = toBlocker.map((v) => v / blockerDistance)
    const cos = Math.max(-1, Math.min(1, dot(direction, blockerDirection)))
    const separation = Math.acos(cos)
    const blockerAngle = Math.asin(Math.min(1, blocker.radius / blockerDistance))
    const bodyAngle = Math.asin(Math.min(1, radius / distance))
    if (separation + bodyAngle <= blockerAngle) return false
  }
  return true
}

/** Selects rows from facts measured for this frame; no loaded/cache state is inferred here. */
export function selectCredits(context: CreditsContext): ReadonlySet<CreditId> {
  const active = new Set<CreditId>()
  if (context.moonVisible) active.add('moon-base')
  if (context.moonVisible && context.lunarTilesVisible) active.add('lunar-tiles')
  if (context.moonVisible && context.polarWacVisible) active.add('polar-wac')
  if (context.moonVisible && context.jaxaTcVisible) active.add('jaxa-tc')
  if (context.moonVisible) active.add('gazetteer')
  if (context.sitePatchVisible === 'a17') active.add('apollo-17-panoramas')
  active.add('open-source')
  active.add('telemetry')
  if (context.sitePatchVisible) active.add(context.sitePatchVisible === 'a11' ? 'apollo-11' : 'apollo-17')
  if (context.sitePatchVisible === 'a17' && context.apollo17TierVisible) active.add('apollo-17-tier')
  if (context.apollo17FlightVisible) active.add('apollo-17-flight')
  if (context.lunarModuleVisible) active.add('lunar-module')
  if (context.earthVisible) active.add('earth-maps')
  if (context.starsVisible) active.add('hyg-stars')
  // The viewer computes solar-system positions on every displayed frame; modelled light is relevant wherever a lit body is drawn.
  active.add('astronomy-engine')
  if (context.moonVisible || context.earthVisible || context.lunarModuleVisible || context.sitePatchVisible) active.add('modelled-light')
  return active
}

/** Small interaction model keeps explicit dismissal stable until a fresh pointer or focus entry. */
export interface CreditsOpenState { pinned: boolean; hovering: boolean; focused: boolean; dismissed: boolean; suppressFocus: boolean }
export const initialCreditsOpenState = (): CreditsOpenState => ({ pinned: false, hovering: false, focused: false, dismissed: false, suppressFocus: false })
export function creditsAreOpen(s: CreditsOpenState): boolean { return !s.dismissed && (s.pinned || s.hovering || s.focused) }
export function creditsPointer(s: CreditsOpenState, inside: boolean): CreditsOpenState {
  return { ...s, hovering: inside, dismissed: inside ? false : s.dismissed }
}
/**
 * Focus entering the Credits control. Landing on the trigger itself (a Tab through the page, or focus handed back after Close) does not open
 * the panel: it opens on activation (Enter, Space, a click), so a Tab never walks into 21 source links on the way to the controls.
 * Focus moving onto something inside an open panel keeps it open.
 */
export function creditsFocus(s: CreditsOpenState, inside: boolean, onTrigger = false): CreditsOpenState {
  if (inside && onTrigger) return s.suppressFocus ? { ...s, suppressFocus: false } : s
  if (inside && s.suppressFocus) return { ...s, suppressFocus: false }
  return { ...s, focused: inside, dismissed: inside ? false : s.dismissed }
}
export function creditsClick(s: CreditsOpenState): CreditsOpenState {
  return creditsAreOpen(s) && s.pinned
    ? { pinned: false, hovering: false, focused: false, dismissed: true, suppressFocus: false }
    : { ...s, pinned: true, dismissed: false }
}
export function dismissCredits(_s: CreditsOpenState, restoreFocus = false): CreditsOpenState {
  return { pinned: false, hovering: false, focused: false, dismissed: true, suppressFocus: restoreFocus }
}

/** Reference-radius drop under an inside-sphere camera that stands in for the terrain it hovers over (about 1.7 km). */
const INSIDE_GROUND_DROP = 1e-3

/**
 * Distance along a unit ray to the ground a credit sample should read, or Infinity for sky.
 * Centre is the body centre, radius its reference sphere.
 */
export function creditSurfaceHit(origin: readonly [number, number, number], direction: readonly [number, number, number],
                                 centre: readonly [number, number, number], radius: number): number {
  const oc = sub(origin, centre)
  // Terrain stands above the reference sphere, so a camera low over it can sit inside that sphere. The far side
  // is never what it sees: sample the ground ahead on a sphere just under the camera, and report sky for rays
  // that do not descend to it.
  const r = Math.hypot(oc[0], oc[1], oc[2])
  if (r < radius) {
    const ground = Math.max(0, r - INSIDE_GROUND_DROP)
    const gb = dot(oc, direction), gdisc = gb * gb - (r * r - ground * ground)
    return gdisc < 0 || -gb - Math.sqrt(gdisc) <= 0 ? Infinity : -gb - Math.sqrt(gdisc)
  }
  const b = dot(oc, direction), c = dot(oc, oc) - radius * radius
  const disc = b * b - c
  if (disc < 0) return Infinity
  const root = Math.sqrt(disc), near = -b - root, far = -b + root
  return near > 0 ? near : far > 0 ? far : Infinity
}

/** A point on the ground a credit sample reads: frame east/north metres and the range from the camera, metres. */
export interface GroundCreditTarget { e: number; n: number; rangeM: number }

/** Frame positions the ground credits sample (x across, y up, in half-heights): the centre and a spread over the frame, denser in the lower half where the ground is. */
const GROUND_SAMPLE_GRID: ReadonlyArray<readonly [number, number]> = [[-0.7, -0.7], [0.7, -0.7], [0, -0.7], [0, -0.35], [-0.7, 0], [0.7, 0], [-0.7, 0.7], [0.7, 0.7], [0, 0.7]]
/** A ray flatter than this (as the share of its length pointing down) is the horizon: its ground is too far to read. */
const GROUND_RAY_MIN_DOWN = 2e-3

/**
 * Where the visible ground is, for the credits: the centre ray at its measured range (null when it sees sky) and a spread of rays
 * over the frame meeting the ground under the camera (flat, at `groundZ`). The centre ray alone dropped "Apollo 17 site detail"
 * whenever the horizon sat at mid-screen, with the lower half of the frame still full of the site's ground.
 * The camera's axes are in the ground frame (east, north, up).
 */
export function groundCreditTargets(camera: CreditCamera, groundZ: number, centreRangeM: number | null): GroundCreditTarget[] {
  const out: GroundCreditTarget[] = []
  const at = (dir: readonly number[], range: number): void => { out.push({ e: camera.pos[0] + dir[0] * range, n: camera.pos[1] + dir[1] * range, rangeM: range }) }
  if (centreRangeM !== null && Number.isFinite(centreRangeM)) at([-camera.back[0], -camera.back[1], -camera.back[2]], centreRangeM)
  for (const [sx, sy] of GROUND_SAMPLE_GRID) {
    const d = [0, 1, 2].map((k) => -camera.back[k] + camera.right[k] * sx * camera.tanHalf * camera.aspect + camera.up[k] * sy * camera.tanHalf)
    const len = Math.hypot(d[0], d[1], d[2])
    const down = -d[2] / len
    if (down < GROUND_RAY_MIN_DOWN) continue
    const range = (camera.pos[2] - groundZ) / down
    if (range > 0 && Number.isFinite(range)) at([d[0] / len, d[1] / len, d[2] / len], range)
  }
  return out
}
