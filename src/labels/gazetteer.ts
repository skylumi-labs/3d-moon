/** Gazetteer positions that more than one module draws, so two values for one feature cannot exist. */
/** Tycho's official centre point, east-positive degrees (USGS/IAU feature 6163, KMZ accessed 2026-10-07). */
export const TYCHO = { lat: -43.2958, lon: -11.2153 } as const
/** Plato's centre point (IAU feature 4757, from gazetteerFeatures.json). */
export const PLATO = { lat: 51.6192, lon: -9.3825 } as const
/** Rima Hadley's centre point (IAU feature 5064, from gazetteerFeatures.json). */
export const RIMA_HADLEY = { lat: 25.7159, lon: 3.1467 } as const
