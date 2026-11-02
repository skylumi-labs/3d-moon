/**
 * The sites that have a local patch (scripts/build-patch.mts, scripts/sites.json). This is what the
 * page knows before a patch is fetched: where to look, what to call it, whose picture it is and when
 * it was taken. The manifest (patch/<id>/manifest.json) is what the loaded patch itself says;
 * scripts/patch.test.mts checks the two agree.
 */
export interface PatchSite {
  /** The directory under the patch base, and the key of the tour ('apollo11' and 'apollo17' are the tours' ids). */
  id: string
  /** 'Apollo 11'. */
  name: string
  /** Where the lander stands, selenographic degrees (east positive). */
  lon: number
  lat: number
  /** Ground at the site, metres from the 1737.4 km sphere (the terrain model's, 5 by 5 texel mean). */
  groundM: number
  /** The finest image texel and the finest height texel, metres: what the floor and the HUD say. */
  imageTexelM: number
  heightTexelM: number
  credit: string
  /** The time of the photograph the site's Sun is taken from, and which pass that is. */
  photoTime: string
  /**
   * More than one photograph under different Suns (a mosaic): how many passes, and their first and last
   * dates. The sky's Sun is the site block's pass only.
   */
  mosaic?: { passes: number; first: string; last: string }
  /** Follow the terrain model under the camera (the floor and the altitude read from it) instead of one flat ground height. */
  terrainFollow: boolean
  /** The patch's heights also make the ground the shadow march and the ground hit read (Apollo 17: a valley between 2 km massifs); false leaves the global tiles' ground and only shades the surface (Apollo 11, whose output stays as it was). */
  fusedGround: boolean
  /** The site may have the optional 25 cm tier beside its patch (haase-tier.manifest.json): only these sites look for it, so the others make no request that would 404. */
  hasTier?: boolean
  /** The steepest slope (rise over run) the patch's heights may give the shading, or omitted for no limit: caps the walls a seam in a terrain model would draw. */
  maxSlope?: number
  /** Where the tour ends: heading in degrees turned from north (the camera looks that way), its tilt from straight down, and how many times the floor's altitude it stops at (default 1: the floor). */
  end: { headingDeg: number; pitchDeg: number; altFactor?: number }
}

const CREDIT = 'NASA/GSFC/Arizona State University'

export const PATCH_SITES: Record<string, PatchSite> = {
  a11: {
    id: 'a11',
    name: 'Apollo 11',
    lon: 23.473,
    lat: 0.6741,
    groundM: -1928,
    imageTexelM: 0.5,
    heightTexelM: 2,
    credit: CREDIT,
    photoTime: '2011-01-22T19:00:00Z',
    terrainFollow: false,
    fusedGround: false,
    end: { headingDeg: 0, pitchDeg: 38 },
  },
  a17: {
    id: 'a17',
    name: 'Apollo 17',
    lon: 30.7723,
    lat: 20.1911,
    groundM: -2626,
    imageTexelM: 0.6,
    heightTexelM: 2,
    credit: CREDIT,
    photoTime: '2011-01-22T05:50:21Z',
    mosaic: { passes: 6, first: '2010-07-28', last: '2011-05-11' },
    terrainFollow: true,
    fusedGround: true,
    hasTier: true,
    maxSlope: 0.6,
    // Looking north at the landing site from about 1 floor up (the funnel floor, 1 km) and 3 km south of it, 20 degrees below the horizon (tilt 70 from straight down), with the Sun 14 degrees up in the west (the tour's date): side light on the massifs, their long shadows across the valley. The old end (4 floors up, tilt 76) backed 8.6 km off the site, outside the terrain model. See src/descent/landing.ts.
    end: { headingDeg: 0, pitchDeg: 70, altFactor: 1 },
  },
}

/** Sites in tour order. */
export const PATCH_SITE_LIST: PatchSite[] = [PATCH_SITES.a11, PATCH_SITES.a17]
