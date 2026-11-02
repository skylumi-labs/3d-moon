/**
 * The Labels layer's rows (owner brief 2026-10-17): about 160 features and
 * missions chosen by hand, each with an importance tier and, for the major ones, one short line of context.
 *
 * Positions are never copied here. A natural feature reads its centre and diameter from the USGS/IAU Gazetteer table the
 * app already bundles (curatedGazetteer.json: the rows of gazetteerFeatures.json these labels use, by Gazetteer feature id), and a landing reads its position from SITES
 * (data.ts, NASA NSSDCA). The rows neither table holds carry their own position and say where it is from (EXTRA_SOURCES).
 * Facts are hedged ("about") and claim no more than the cited figure; the poles and the summit are points, not features.
 */
import GAZETTEER from './curatedGazetteer.json'
import { SITES, type Agency } from './data'

export type CuratedKind = 'mare' | 'crater' | 'mountain' | 'valley' | 'point' | 'mission'
/** 1 major: always eligible, with its fact line; 2 notable: from about two radii in; 3 minor: close views, name only. */
export type Tier = 1 | 2 | 3
export type MissionStatus = 'crewed' | 'landed' | 'impact' | 'crashed'

export interface CuratedLabel {
  id: string
  name: string
  kind: CuratedKind
  tier: Tier
  /** Selenographic degrees, east positive. */
  lon: number
  lat: number
  /** Diameter or extent from the Gazetteer, km (0 for points and missions). */
  sizeKm: number
  /** One line of context, at most about 70 characters ('' for none). */
  fact: string
  /** The English name of a sea (Sea of Showers). */
  sub?: string
  year?: number
  agency?: string
  status?: MissionStatus
  source: string
}

const GAZ_URL = 'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.kmz'
type GazRow = [id: number, name: string, kind: string, lon: number, lat: number, sizeKm: number | null, featureType: string]
const GAZ = new Map((GAZETTEER.features as GazRow[]).map((r) => [r[0], r]))

/** A natural feature by its Gazetteer id: name, centre and diameter from the table. */
function N(gazId: number, id: string, kind: Exclude<CuratedKind, 'mission' | 'point'>, tier: Tier, fact: string, sub?: string): CuratedLabel {
  const r = GAZ.get(gazId)
  if (!r) throw new Error(`curated label ${id}: no Gazetteer feature ${gazId}`)
  return {
    id, name: r[1], kind, tier, lon: r[3], lat: r[4], sizeKm: r[5] ?? 0, fact, ...(sub ? { sub } : {}),
    source: `USGS Astrogeology / IAU Gazetteer of Planetary Nomenclature, ${GAZ_URL} (Feature/${gazId}), accessed ${GAZETTEER.accessed}`,
  }
}

/** The short name of each agency, shown after a mission's year. */
export const AGENCY_NAME: Record<Agency, string> = {
  usa: 'NASA', ussr: 'USSR', china: 'CNSA', india: 'ISRO', japan: 'JAXA', israel: 'SpaceIL', im: 'Intuitive Machines', firefly: 'Firefly', ispace: 'ispace',
}
const SITE_BY_ID = new Map(SITES.map((s) => [s.id, s]))
/** A landing from SITES (data.ts): position, year, agency and outcome from that table. */
function M(id: string, tier: Tier, fact: string, agencyName?: string): CuratedLabel {
  const s = SITE_BY_ID.get(id)
  if (!s || !s.agency || !s.status || !s.year) throw new Error(`curated label ${id}: no landing site`)
  return {
    id, name: s.name, kind: 'mission', tier, lon: s.lon, lat: s.lat, sizeKm: 0, fact,
    year: s.year, agency: agencyName ?? AGENCY_NAME[s.agency], status: s.status, source: s.source,
  }
}

/** Where the rows that neither table holds come from. */
export const EXTRA_SOURCES = {
  nssdca: 'NASA NSSDCA, Table of Anthropogenic Impacts and Spacecraft on the Moon (nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html), read 2026-10-04',
  change5: 'Chang’e 5 landing site 43.06° N, 51.92° W as published from the descent images (Qian et al. 2021, Geophysical Research Letters 48, e2021GL092434)',
  summit: 'The highest point of the LOLA topography, 10,786 m above the 1737.4 km sphere at 5.41° N, 201.37° E (Smith et al. 2010, GRL 37, L18204)',
  reinerGamma: 'IAU albedo feature Reiner Gamma (not in the bundled table, which leaves albedo features out); centre about 7.5° N, 59° W',
  poles: 'The rotation poles of the IAU Moon frame',
}

/** A name with its apostrophes and spacing made plain (Chang’e and Chang'e are one name), for comparing names across tables: the
 * curated rows write the curly apostrophe, the Gazetteer the straight one. */
export const normaliseName = (name: string): string => name.normalize('NFC').replace(/[‘’ʼ`]/g, "'").replace(/\s+/g, ' ').trim()
const CURATED_NAME_KEYS = new Set<string>()
/** Whether a name (a Gazetteer row's, say) is one of the curated labels', apostrophes aside: the Gazetteer's row then stays out, so one place never carries two names. */
export function isCuratedName(name: string): boolean {
  if (!CURATED_NAME_KEYS.size) for (const l of CURATED) CURATED_NAME_KEYS.add(normaliseName(l.name))
  return CURATED_NAME_KEYS.has(normaliseName(name))
}

/**
 * The major labels in the order people look for them (owner 2026-10-17: "things that people know and might be looking for"):
 * where two cannot both be placed, the earlier one wins. Ids not listed follow, by size. 'terminator' is the live day-night label.
 */
export const FAME: readonly string[] = [
  'apollo-11', 'tycho', 'copernicus', 'mare-tranquillitatis', 'mare-imbrium', 'oceanus-procellarum', 'apollo-17', 'terminator', 'mare-serenitatis',
  'mare-crisium', 'plato', 'aristarchus', 'south-pole', 'north-pole', 'change-4', 'apollo-15', 'montes-apenninus', 'clavius',
  'luna-2', 'luna-17', 'mons-huygens', 'rupes-recta', 'mare-orientale', 'change-6', 'chandrayaan-3', 'vallis-schroteri',
  'antoniadi', 'shackleton', 'tsiolkovskiy', 'highest-point',
]

export const CURATED: CuratedLabel[] = [
  N(4395, 'oceanus-procellarum', 'mare', 1, 'Largest of the seas, about 2,500 km across', 'Ocean of Storms'),
  N(3678, 'mare-imbrium', 'mare', 1, 'Great basin about 1,100 km across, ringed by mountains', 'Sea of Showers'),
  N(3691, 'mare-tranquillitatis', 'mare', 1, 'Apollo 11 landed here in 1969', 'Sea of Tranquility'),
  N(3686, 'mare-serenitatis', 'mare', 1, 'Apollo 17 landed at its eastern edge in 1972', 'Sea of Serenity'),
  N(3671, 'mare-crisium', 'mare', 1, 'A separate round sea near the eastern limb, about 555 km', 'Sea of Crises'),
  N(3685, 'mare-orientale', 'mare', 1, 'Bullseye basin of three rings, astride the western limb', 'Eastern Sea'),
  N(3674, 'mare-frigoris', 'mare', 2, 'A long, narrow sea stretching about 1,400 km', 'Sea of Cold'),
  N(3684, 'mare-nubium', 'mare', 2, 'The Straight Wall fault lies at its eastern edge', 'Sea of Clouds'),
  N(3673, 'mare-fecunditatis', 'mare', 2, 'Luna 16 returned the first robotic soil sample from here', 'Sea of Fertility'),
  N(3677, 'mare-humorum', 'mare', 2, 'About 420 km across', 'Sea of Moisture'),
  N(3683, 'mare-nectaris', 'mare', 2, 'Rupes Altai is the rim of its larger basin', 'Sea of Nectar'),
  N(3682, 'mare-moscoviense', 'mare', 2, 'One of the few seas on the far side', 'Sea of Moscow'),
  N(5565, 'sinus-iridum', 'mare', 2, 'A bay ringed by the Jura mountains, about 250 km across', 'Bay of Rainbows'),
  N(3694, 'mare-vaporum', 'mare', 3, '', 'Sea of Vapours'),
  N(3670, 'mare-cognitum', 'mare', 3, 'Ranger 7 sent the first US close-ups from here in 1964', 'Sea that has Become Known'),
  N(3679, 'mare-ingenii', 'mare', 3, 'Far-side sea with bright magnetic swirls', 'Sea of Cleverness'),
  N(5567, 'sinus-medii', 'mare', 3, 'The central bay, at 0° longitude and latitude', 'Bay of the Centre'),
  N(3665, 'mare-australe', 'mare', 3, '', 'Southern Sea'),
  N(3689, 'mare-smythii', 'mare', 3, '', 'Smyth’s Sea'),
  N(3676, 'mare-humboldtianum', 'mare', 3, '', 'Humboldt’s Sea'),
  N(3217, 'lacus-somniorum', 'mare', 3, '', 'Lake of Dreams'),
  N(3212, 'lacus-mortis', 'mare', 3, '', 'Lake of Death'),
  N(6163, 'tycho', 'crater', 1, 'About 108 million years old; its rays reach across the near side'),
  N(1296, 'copernicus', 'crater', 1, 'Terraced walls and central peaks, about 800 million years old'),
  N(4757, 'plato', 'crater', 1, 'Dark lava floor 100 km across, ringed by a low rim'),
  N(1236, 'clavius', 'crater', 1, 'One of the largest craters on the near side, 230 km'),
  N(380, 'aristarchus', 'crater', 1, 'The brightest large feature on the Moon'),
  N(296, 'antoniadi', 'crater', 1, 'Its floor holds the lowest point: about 9 km below the mean radius'),
  N(5450, 'shackleton', 'crater', 1, 'At the south pole; its floor never sees the Sun'),
  N(6108, 'tsiolkovskiy', 'crater', 1, 'Dark lava floor and a central peak, a landmark of the far side'),
  N(2990, 'kepler', 'crater', 2, 'Bright ray crater, about 30 km across'),
  N(2252, 'grimaldi', 'crater', 2, 'Dark-floored basin near the western limb'),
  N(3273, 'langrenus', 'crater', 2, 'Terraced walls, 132 km across'),
  N(4668, 'petavius', 'crater', 2, 'A great rille splits its floor'),
  N(5965, 'theophilus', 'crater', 2, 'Central peaks rise over a kilometre above its floor'),
  N(4808, 'posidonius', 'crater', 2, 'Rille-crossed floor at the edge of Mare Serenitatis'),
  N(1820, 'eratosthenes', 'crater', 2, 'At the southern end of the Apennines'),
  N(350, 'archimedes', 'crater', 2, 'Lava-flooded crater in Mare Imbrium'),
  N(4860, 'ptolemaeus', 'crater', 2, 'Flat-floored walled plain, 154 km'),
  N(206, 'alphonsus', 'crater', 2, 'Ranger 9 struck its floor in 1965, sending pictures to the end'),
  N(2111, 'gassendi', 'crater', 2, 'Rille-crossed floor at the edge of Mare Humorum'),
  N(561, 'bailly', 'crater', 2, 'The largest crater on the near side, about 300 km'),
  N(953, 'cabeus', 'crater', 2, 'The LCROSS impact found water ice here in 2009'),
  N(6440, 'von-karman', 'crater', 2, 'Chang’e 4 landed here in 2019, the first far-side landing'),
  N(2482, 'hertzsprung', 'crater', 2, 'Far-side basin, about 536 km across'),
  N(3090, 'korolev', 'crater', 2, 'Far-side basin, about 423 km across'),
  N(326, 'apollo', 'crater', 2, 'Far-side basin named for the programme; Chang’e 6 landed inside it'),
  N(5381, 'schrodinger', 'crater', 2, 'Young basin near the south pole, 316 km'),
  N(2172, 'giordano-bruno', 'crater', 2, 'Very young and bright, with crisp rays'),
  N(1381, 'daedalus', 'crater', 2, 'Photographed by Apollo 11 from orbit; the far side’s best-known view'),
  N(4627, 'peary', 'crater', 2, 'At the north pole'),
  N(5368, 'schickard', 'crater', 3, ''),
  N(2516, 'hipparchus', 'crater', 3, ''),
  N(1799, 'endymion', 'crater', 3, ''),
  N(1239, 'cleomedes', 'crater', 3, ''),
  N(4886, 'pythagoras', 'crater', 3, ''),
  N(2582, 'humboldt', 'crater', 3, ''),
  N(2781, 'jackson', 'crater', 3, 'Bright ray crater on the far side'),
  N(6305, 'van-de-graaff', 'crater', 3, 'Strongly magnetised crust'),
  N(3837, 'mendeleev', 'crater', 3, ''),
  N(2054, 'gagarin', 'crater', 3, ''),
  N(1278, 'compton', 'crater', 3, ''),
  N(2007, 'fra-mauro', 'crater', 3, 'Apollo 14 landed in the highlands north of it'),
  N(1498, 'descartes', 'crater', 3, 'Apollo 16 explored the highlands beside it'),
  N(3869, 'messier', 'crater', 3, 'Twin craters with a double ray from a grazing impact'),
  N(5704, 'stevinus', 'crater', 3, ''),
  N(917, 'bullialdus', 'crater', 3, ''),
  N(382, 'aristoteles', 'crater', 3, ''),
  N(1863, 'eudoxus', 'crater', 3, ''),
  N(1045, 'cassini', 'crater', 3, ''),
  N(3760, 'maurolycus', 'crater', 3, ''),
  N(5736, 'stofler', 'crater', 3, ''),
  N(4034, 'moretus', 'crater', 3, ''),
  N(6488, 'wargentin', 'crater', 3, 'Filled to the brim with lava: a raised plateau'),
  N(5022, 'riccioli', 'crater', 3, ''),
  N(2493, 'hevelius', 'crater', 3, ''),
  N(3715, 'marius', 'crater', 3, 'The volcanic Marius Hills lie to its west'),
  N(2475, 'herodotus', 'crater', 3, ''),
  N(6012, 'timocharis', 'crater', 3, ''),
  N(5878, 'taruntius', 'crater', 3, ''),
  N(941, 'byrd', 'crater', 3, ''),
  N(247, 'amundsen', 'crater', 3, ''),
  N(3603, 'malapert', 'crater', 3, ''),
  N(753, 'birkhoff', 'crater', 3, ''),
  N(3472, 'lorentz', 'crater', 3, ''),
  N(4604, 'pasteur', 'crater', 3, ''),
  N(1940, 'fermi', 'crater', 3, ''),
  N(4749, 'planck', 'crater', 3, ''),
  N(4775, 'poincare', 'crater', 3, ''),
  N(3554, 'mach', 'crater', 3, ''),
  N(2976, 'keeler', 'crater', 3, ''),
  N(3335, 'leibnitz', 'crater', 3, ''),
  N(6711, 'zeeman', 'crater', 3, ''),
  N(4004, 'montes-apenninus', 'mountain', 1, 'The grandest range: 600 km long, up to about 5 km above Mare Imbrium'),
  N(3987, 'mons-huygens', 'mountain', 1, 'About 5.5 km high; often called the Moon’s tallest mountain'),
  N(5230, 'rupes-recta', 'valley', 1, 'The Straight Wall: a 110 km fault about 250 to 300 m high'),
  N(6300, 'vallis-schroteri', 'valley', 1, 'The largest sinuous rille, winding about 185 km'),
  N(4003, 'montes-alpes', 'mountain', 2, 'The lunar Alps, cut through by Vallis Alpes'),
  N(6290, 'vallis-alpes', 'valley', 2, 'A straight valley about 155 km long through the Alps'),
  N(4007, 'montes-caucasus', 'mountain', 2, 'Between Mare Imbrium and Mare Serenitatis'),
  N(4011, 'montes-jura', 'mountain', 2, 'Ring Sinus Iridum: the “Golden Handle” at local sunrise'),
  N(4018, 'montes-taurus', 'mountain', 2, 'Apollo 17 landed in the Taurus-Littrow valley'),
  N(4008, 'montes-cordillera', 'mountain', 2, 'Outer ring of the Orientale basin, about 960 km across'),
  N(3983, 'mons-hadley', 'mountain', 2, 'About 4.5 km high; Apollo 15 landed nearby'),
  N(5064, 'rima-hadley', 'valley', 2, 'Sinuous rille the Apollo 15 rover drove to in 1971'),
  N(5224, 'rupes-altai', 'valley', 2, 'A scarp about 500 km long: the rim of the Nectaris basin'),
  N(3994, 'mons-rumker', 'mountain', 2, 'Volcanic dome complex; Chang’e 5 sampled the plain beside it'),
  N(4006, 'montes-carpatus', 'mountain', 3, ''),
  N(4009, 'montes-haemus', 'mountain', 3, ''),
  N(4015, 'montes-rook', 'mountain', 3, 'Inner ring of the Orientale basin'),
  N(4012, 'montes-pyrenaeus', 'mountain', 3, ''),
  N(4014, 'montes-riphaeus', 'mountain', 3, ''),
  N(3992, 'mons-pico', 'mountain', 3, 'Isolated peak about 2.4 km high'),
  N(3993, 'mons-piton', 'mountain', 3, ''),
  N(4013, 'montes-recti', 'mountain', 3, 'The Straight Range'),
  N(4019, 'montes-teneriffe', 'mountain', 3, ''),
  N(5040, 'rima-ariadaeus', 'valley', 3, 'A straight graben about 250 km long'),
  N(5067, 'rima-hyginus', 'valley', 3, ''),
  N(6298, 'vallis-rheita', 'valley', 3, ''),
  N(6301, 'vallis-snellius', 'valley', 3, ''),
  N(6297, 'vallis-planck', 'valley', 3, ''),
  N(1058, 'catena-davy', 'valley', 3, 'A chain of small craters'),
  N(16070, 'mons-mouton', 'mountain', 3, 'Near the south pole; named for mathematician Melba Mouton'),
  N(16338, 'mons-malapert', 'mountain', 3, 'A south-polar massif with long sunlit stretches'),

  // Points
  { id: 'north-pole', name: 'North Pole', kind: 'point', tier: 1, lon: 0, lat: 90, sizeKm: 0, fact: '90° N', source: EXTRA_SOURCES.poles },
  { id: 'south-pole', name: 'South Pole', kind: 'point', tier: 1, lon: 0, lat: -90, sizeKm: 0, fact: '90° S: craters here never see the Sun', source: EXTRA_SOURCES.poles },
  { id: 'highest-point', name: 'Highest point', kind: 'point', tier: 1, lon: -158.63, lat: 5.41, sizeKm: 0, fact: 'About 10.8 km above the mean radius, on the far side', source: EXTRA_SOURCES.summit },
  { id: 'reiner-gamma', name: 'Reiner Gamma', kind: 'point', tier: 2, lon: -59.0, lat: 7.5, sizeKm: 70, fact: 'A bright magnetic swirl with no relief at all', source: EXTRA_SOURCES.reinerGamma },

  // Missions
  M('luna-9', 2, 'First soft landing, 3 February 1966'),
  M('surveyor-1', 2, 'First US soft landing, June 1966'),
  M('surveyor-3', 3, 'Apollo 12 landed beside it in 1969 and brought parts home'),
  M('apollo-11', 1, 'First crewed landing, 20 July 1969: Tranquility Base'),
  M('apollo-12', 2, 'Pinpoint landing within 200 m of Surveyor 3'),
  M('apollo-14', 2, 'The Fra Mauro highlands, February 1971'),
  M('apollo-15', 1, 'First lunar rover; drove to the edge of Hadley Rille'),
  M('apollo-16', 2, 'The Descartes highlands, April 1972'),
  M('apollo-17', 1, 'Last crewed landing, December 1972, with geologist Harrison Schmitt'),
  M('luna-16', 2, 'First robotic sample return: 101 g of soil'),
  M('luna-17', 1, 'First rover on another world; drove about 10 km'),
  M('luna-20', 3, 'Sample return from the highlands'),
  M('luna-21', 2, 'Drove about 39 km, a record that stood for 41 years'),
  M('luna-24', 3, 'Last Soviet sample return'),
  M('change-3', 2, 'First soft landing since 1976, with the Yutu rover'),
  M('change-4', 1, 'First landing on the far side, in Von Kármán crater'),
  M('change-6', 1, 'First samples brought back from the far side'),
  M('chandrayaan-3', 1, 'First landing near the south pole, at 69° S'),
  M('slim', 2, 'Precision landing within 100 m of its target; came to rest on its nose'),
  M('im-1', 2, 'First commercial lander, at 80° S; tipped over on touchdown'),
  M('im-2', 3, 'Landed on its side near the south pole'),
  M('blue-ghost-1', 2, 'First fully successful commercial landing, in Mare Crisium'),
  M('beresheet', 3, 'Israel’s lander crashed on descent'),
  M('chandrayaan-2', 3, 'Lost in the final descent'),
  M('hakuto-r-1', 3, 'Lost in the final descent when its fuel ran out'),
  M('luna-25', 3, 'Russia’s first lunar lander since 1976 crashed before landing', 'Roscosmos'),
  { id: 'luna-2', name: 'Luna 2', kind: 'mission', tier: 1, lon: 0, lat: 29.1, sizeKm: 0, fact: 'First human-made object to reach the Moon, 13 September 1959', year: 1959, agency: 'USSR', status: 'impact', source: EXTRA_SOURCES.nssdca },
  { id: 'ranger-7', name: 'Ranger 7', kind: 'mission', tier: 3, lon: -20.6, lat: -10.63, sizeKm: 0, fact: 'First US close-up pictures of the Moon, taken on the way down', year: 1964, agency: 'NASA', status: 'impact', source: EXTRA_SOURCES.nssdca },
  { id: 'lcross', name: 'LCROSS', kind: 'mission', tier: 2, lon: -48.73, lat: -84.68, sizeKm: 0, fact: 'Impact into Cabeus; water ice was found in the plume', year: 2009, agency: 'NASA', status: 'impact', source: EXTRA_SOURCES.nssdca },
  { id: 'change-5', name: 'Chang’e 5', kind: 'mission', tier: 2, lon: -51.92, lat: 43.06, sizeKm: 0, fact: 'Returned about 1.7 kg of young basalt', year: 2020, agency: 'CNSA', status: 'landed', source: EXTRA_SOURCES.change5 },
]
