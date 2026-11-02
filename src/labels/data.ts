/**
 * The Labels layer's rows: published coordinates only, one source per row. A value that was not found is left out, never guessed
 * (Chang'e 5 and several impacts are absent for that reason; see MISSING).
 *
 * Natural features come from the nightly USGS/IAU Moon Gazetteer KMZ (9,080 named natural features, accessed 2026-10-07);
 * landing and impact rows come from NASA NSSDCA and mission reports, with the source recorded per row.
 */
import { whenGazetteer, type GazetteerRow, type GazetteerTable } from './gazetteerTable'
export type LabelKind = 'mare' | 'crater' | 'range' | 'site'
export type Agency = 'usa' | 'ussr' | 'china' | 'india' | 'japan' | 'israel' | 'im' | 'firefly' | 'ispace'
export type SiteStatus = 'crewed' | 'landed' | 'crashed'

export interface MoonLabel {
  id: string
  name: string
  kind: LabelKind
  /** Selenographic degrees, east positive. */
  lon: number
  lat: number
  /** Diameter or extent, km, where the source gives it (drives when the label shows). */
  sizeKm?: number
  agency?: Agency
  status?: SiteStatus
  /** The patch site id when a local photograph exists (main.ts flies there through the site's own pin). */
  patchSite?: 'a11' | 'a17'
  /** The year of landing, for a site. */
  year?: number
  source: string
  /** The Gazetteer’s full IAU feature class, shown in the feature detail tooltip. */
  featureType?: string
}

const GAZETTEER_URL = 'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.kmz'
const SRC_LAND = 'NASA NSSDCA, Table of Anthropogenic Impacts and Spacecraft on the Moon (nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html), read 2026-10-04'
const featureSlug = (s: string): string => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** The natural-feature rows of a Gazetteer table (ids, slugs and sources exactly as they were when the table was a static import). */
export function buildFeatures(gazetteer: GazetteerTable): MoonLabel[] {
  const gazetteerRows: GazetteerRow[] = gazetteer.features
  const slugCounts = new Map<string, number>()
  for (const [, name] of gazetteerRows) slugCounts.set(featureSlug(name), (slugCounts.get(featureSlug(name)) ?? 0) + 1)
  const gazetteerSource = (id: number): string => `USGS Astrogeology / IAU Gazetteer of Planetary Nomenclature, ${GAZETTEER_URL} (Feature/${id}), accessed ${gazetteer.accessed}`
  return gazetteerRows.map(([featureId, name, kind, lon, lat, sizeKm, featureType]) => {
    const slug = featureSlug(name)
    return {
      id: slugCounts.get(slug) === 1 ? slug : `gaz-${slug}-${featureId}`,
      name, kind, lon, lat, ...(sizeKm && sizeKm > 0 ? { sizeKm } : {}), source: gazetteerSource(featureId),
      featureType,
    }
  })
}

const site = (id: string, name: string, agency: Agency, status: SiteStatus, year: number, lat: number, lon: number, patchSite?: 'a11' | 'a17'): MoonLabel =>
  ({ id, name, kind: 'site', agency, status, year, lat, lon, source: SRC_LAND, ...(patchSite ? { patchSite } : {}) })

/** Every landing on the list read: crewed and robotic, successful and crashed. Coordinates as published, in degrees. */
export const SITES: MoonLabel[] = [
  // NSSDCA note f (Wagner et al. 2017): this is the initial Pravda report; LROC shows no lander there and the true site is probably 10 km or more away.
  { ...site('luna-9', 'Luna 9', 'ussr', 'landed', 1966, 7.13, -64.37), source: SRC_LAND + '; the position is the 1966 Pravda report, not an imaged lander (NSSDCA note f)' },
  site('surveyor-1', 'Surveyor 1', 'usa', 'landed', 1966, -2.4745, -43.3398),
  site('luna-13', 'Luna 13', 'ussr', 'landed', 1966, 18.87, -62.05),
  site('surveyor-3', 'Surveyor 3', 'usa', 'landed', 1967, -3.0162, -23.418),
  site('surveyor-5', 'Surveyor 5', 'usa', 'landed', 1967, 1.4551, 23.1943),
  site('surveyor-6', 'Surveyor 6', 'usa', 'landed', 1967, 0.4742, -1.4275),
  site('surveyor-7', 'Surveyor 7', 'usa', 'landed', 1968, -40.9812, -11.5127),
  site('apollo-11', 'Apollo 11', 'usa', 'crewed', 1969, 0.6740806, 23.4729694, 'a11'),
  site('apollo-12', 'Apollo 12', 'usa', 'crewed', 1969, -3.0128, -23.4219),
  site('luna-16', 'Luna 16', 'ussr', 'landed', 1970, -0.5137, 56.3638),
  site('luna-17', 'Luna 17 / Lunokhod 1', 'ussr', 'landed', 1970, 38.23764, -35.00163),
  site('apollo-14', 'Apollo 14', 'usa', 'crewed', 1971, -3.6453, -17.4713611),
  site('apollo-15', 'Apollo 15', 'usa', 'crewed', 1971, 26.1322194, 3.6338611),
  site('luna-20', 'Luna 20', 'ussr', 'landed', 1972, 3.7863, 56.6242),
  site('apollo-16', 'Apollo 16', 'usa', 'crewed', 1972, -8.9730111, 15.5001889),
  site('apollo-17', 'Apollo 17', 'usa', 'crewed', 1972, 20.1908, 30.7716806, 'a17'),
  site('luna-21', 'Luna 21 / Lunokhod 2', 'ussr', 'landed', 1973, 25.9994, 30.4076),
  site('luna-24', 'Luna 24', 'ussr', 'landed', 1976, 12.7142, 62.2129),
  site('change-3', 'Chang’e 3', 'china', 'landed', 2013, 44.1214, -19.5117),
  site('change-4', 'Chang’e 4', 'china', 'landed', 2019, -45.4561, 177.5885),
  site('change-6', 'Chang’e 6', 'china', 'landed', 2024, -41.6385, -153.9852),
  site('chandrayaan-3', 'Chandrayaan-3', 'india', 'landed', 2023, -69.3741, 32.32),
  site('slim', 'SLIM', 'japan', 'landed', 2024, -13.316, 25.251),
  site('im-1', 'IM-1 Odysseus', 'im', 'landed', 2024, -80.13, 1.44),
  site('im-2', 'IM-2 Athena', 'im', 'landed', 2025, -84.7906, 29.1957),
  site('blue-ghost-1', 'Blue Ghost M1', 'firefly', 'landed', 2025, 18.562, 61.81),
  site('beresheet', 'Beresheet', 'israel', 'crashed', 2019, 32.5956, 19.3496),
  site('hakuto-r-1', 'Hakuto-R M1', 'ispace', 'crashed', 2023, 47.581, 44.094),
  site('hakuto-r-2', 'Resilience (Hakuto-R M2)', 'ispace', 'crashed', 2025, 60.4445, -4.588),
  site('chandrayaan-2', 'Chandrayaan-2 Vikram', 'india', 'crashed', 2019, -70.8810, 22.7840),
  site('luna-25', 'Luna 25', 'ussr', 'crashed', 2023, -57.865, 61.360),
]

/** Rows left out because no coordinate was found in the sources read. */
export const MISSING: string[] = ['Chang’e 5 landing coordinates', 'Surveyor 2/4 impact coordinates', 'Ranger probe impact coordinates']

/**
 * Every row. The Gazetteer's natural features arrive after the first frame (loadGazetteer, gazetteerTable.ts); until then FEATURES is
 * empty and LABELS is the sites alone. Both are live bindings, replaced once when the table loads. Read them at the point of use, never
 * copy them at module load (spatial.ts and centrePick.ts rebuild their indexes from LABELS' identity).
 */
export let FEATURES: MoonLabel[] = []
export let LABELS: MoonLabel[] = [...SITES]
whenGazetteer((t) => { FEATURES = buildFeatures(t); LABELS = [...FEATURES, ...SITES] })
