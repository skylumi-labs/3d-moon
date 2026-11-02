/**
 * Apollo 17 surface panoramas (ALSEP, Station 4, Station 6), from the JSC original-film mosaics.
 * The projection registrations and tile dimensions come from the published A17 panorama manifest
 * (data/apollo17/pano on the claude/a17-pano-data branch); the compact, phone and desktop WebP tiles are bundled locally.
 */
/** padLeft/padRight: extra columns of the neighbouring tile baked into the file, so lossy edges never meet at a tile seam. */
export interface PanoramaTile { path: string; x0: number; width: number; padLeft?: number; padRight?: number }
export interface PanoramaTier { id: 'compact' | 'phone' | 'desktop'; width: number; height: number; bytes: number; tiles: readonly PanoramaTile[] }
export interface PanoramaProjection {
  kind: 'equirectangular-linear' | 'cylindrical'
  leftAzDeg: number
  horizontalFovDeg: number
  verticalScale: number
  centerRow: number
  elevationOffsetDeg: { constant: number; cosAz: number; sinAz: number }
}
export interface ApolloPanorama {
  id: 'alsep' | 'station4' | 'station6'
  name: string
  /** Heading shown over the photograph. */
  title: string
  /** Subtitle: mission, date, photographer. */
  subtitle: string
  /** Label of the entry button in the Viewpoints sheet. */
  entryLabel: string
  /** Sun azimuth (degrees clockwise from north) and elevation at the EVA time, from sun-at-eva.json. */
  sun: { azimuthDeg: number; elevationDeg: number }
  imageId: string
  frames: string
  photographer: string
  timeUtc: string
  sourcePage: string
  sourceImage: string
  credit: string
  rightsPage: string
  projection: PanoramaProjection
  tiers: readonly PanoramaTier[]
}

export const APOLLO17_ALSEP: ApolloPanorama = {
  id: 'alsep',
  name: 'ALSEP, EVA 1',
  title: 'ALSEP · EVA 1',
  subtitle: 'Apollo 17 · 12 December 1972 · Jack Schmitt',
  entryLabel: 'Apollo 17 · ALSEP panorama',
  sun: { azimuthDeg: 97.84, elevationDeg: 18.29 },
  imageId: 'JSC2004e52772',
  frames: 'AS17-147-22572 to AS17-147-22600',
  photographer: 'Jack Schmitt',
  timeUtc: '1972-12-12T06:21:56.000Z',
  sourcePage: 'https://images.nasa.gov/details/jsc2004e52772',
  sourceImage: 'https://images-assets.nasa.gov/image/jsc2004e52772/jsc2004e52772~orig.jpg',
  credit: 'NASA/JSC. Original flight-film panorama assembled by Warren Harold at Johnson Space Center.',
  rightsPage: 'https://www.nasa.gov/nasa-brand-center/images-and-media/',
  projection: {
    kind: 'equirectangular-linear',
    leftAzDeg: 224.35,
    horizontalFovDeg: 360,
    verticalScale: 0.842,
    centerRow: 0.5,
    elevationOffsetDeg: { constant: -3.235, cosAz: 1.716, sinAz: -1.619 },
  },
  tiers: [
    {
      id: 'desktop', width: 14608, height: 1665, bytes: 3660256,
      tiles: [
        { path: '/panorama/alsep/desktop/t0.webp', x0: 0, width: 4096, padLeft: 0, padRight: 16 },
        { path: '/panorama/alsep/desktop/t1.webp', x0: 4096, width: 4096, padLeft: 16, padRight: 16 },
        { path: '/panorama/alsep/desktop/t2.webp', x0: 8192, width: 4096, padLeft: 16, padRight: 16 },
        { path: '/panorama/alsep/desktop/t3.webp', x0: 12288, width: 2320, padLeft: 16, padRight: 0 },
      ],
    },
    {
      id: 'phone', width: 8192, height: 934, bytes: 1460426,
      tiles: [
        { path: '/panorama/alsep/phone/t0.webp', x0: 0, width: 4096, padLeft: 0, padRight: 16 },
        { path: '/panorama/alsep/phone/t1.webp', x0: 4096, width: 4096, padLeft: 16, padRight: 0 },
      ],
    },
    {
      id: 'compact', width: 4096, height: 467, bytes: 418516,
      tiles: [
        { path: '/panorama/alsep/compact/t0.webp', x0: 0, width: 4096, padLeft: 0, padRight: 0 },
      ],
    },
  ],
}

export const APOLLO17_STATION4: ApolloPanorama = {
  id: 'station4',
  name: 'Station 4, Shorty crater, EVA 2',
  title: 'Station 4 · Shorty crater',
  subtitle: 'Apollo 17 · 13 December 1972 · Jack Schmitt',
  entryLabel: 'Apollo 17 · Station 4 panorama',
  sun: { azimuthDeg: 103.08, elevationDeg: 29.82 },
  imageId: 'JSC2007e045388',
  frames: 'AS17-137-20992 to AS17-137-21024',
  photographer: 'Jack Schmitt',
  timeUtc: '1972-12-13T06:59:02.000Z',
  sourcePage: 'https://www.lpi.usra.edu/resources/apollopanoramas/',
  sourceImage: 'https://www.lpi.usra.edu/resources/apollopanoramas/images/print/original/JSC2007e045388.jpg',
  credit: 'NASA/JSC. Original flight-film panorama assembled by Warren Harold at Johnson Space Center.',
  rightsPage: 'https://www.nasa.gov/nasa-brand-center/images-and-media/',
  projection: {
    kind: 'cylindrical',
    leftAzDeg: 27,
    horizontalFovDeg: 360,
    verticalScale: 0.95,
    centerRow: 0.5,
    elevationOffsetDeg: { constant: 3.404, cosAz: -1.545, sinAz: -1.24 },
  },
  tiers: [
    {
      id: 'desktop', width: 15409, height: 2044, bytes: 2285650,
      tiles: [
        { path: '/panorama/station4/desktop/t0.webp', x0: 0, width: 4096, padLeft: 0, padRight: 16 },
        { path: '/panorama/station4/desktop/t1.webp', x0: 4096, width: 4096, padLeft: 16, padRight: 16 },
        { path: '/panorama/station4/desktop/t2.webp', x0: 8192, width: 4096, padLeft: 16, padRight: 16 },
        { path: '/panorama/station4/desktop/t3.webp', x0: 12288, width: 3121, padLeft: 16, padRight: 0 },
      ],
    },
    {
      id: 'phone', width: 8192, height: 1087, bytes: 944876,
      tiles: [
        { path: '/panorama/station4/phone/t0.webp', x0: 0, width: 4096, padLeft: 0, padRight: 16 },
        { path: '/panorama/station4/phone/t1.webp', x0: 4096, width: 4096, padLeft: 16, padRight: 0 },
      ],
    },
    {
      id: 'compact', width: 4096, height: 543, bytes: 287886,
      tiles: [
        { path: '/panorama/station4/compact/t0.webp', x0: 0, width: 4096, padLeft: 0, padRight: 0 },
      ],
    },
  ],
}

export const APOLLO17_STATION6: ApolloPanorama = {
  id: 'station6',
  name: 'Station 6, Tracy’s Rock, EVA 3',
  title: 'Station 6 · Tracy’s Rock',
  subtitle: 'Apollo 17 · 14 December 1972 · Gene Cernan',
  entryLabel: 'Apollo 17 · Station 6 panorama',
  sun: { azimuthDeg: 108.37, elevationDeg: 39.04 },
  imageId: 'JSC2007e045387',
  frames: 'AS17-140-21488 to AS17-140-21507',
  photographer: 'Gene Cernan',
  timeUtc: '1972-12-14T03:07:01.000Z',
  sourcePage: 'https://www.lpi.usra.edu/resources/apollopanoramas/',
  sourceImage: 'https://www.lpi.usra.edu/resources/apollopanoramas/images/print/original/JSC2007e045387.jpg',
  credit: 'NASA/JSC. Original flight-film panorama assembled by Warren Harold at Johnson Space Center.',
  rightsPage: 'https://www.nasa.gov/nasa-brand-center/images-and-media/',
  projection: {
    kind: 'equirectangular-linear',
    leftAzDeg: 33,
    horizontalFovDeg: 264,
    verticalScale: 1.1,
    centerRow: 0.5,
    elevationOffsetDeg: { constant: -3.065, cosAz: 2.774, sinAz: 2.276 },
  },
  tiers: [
    {
      id: 'desktop', width: 11182, height: 1725, bytes: 1218318,
      tiles: [
        { path: '/panorama/station6/desktop/t0.webp', x0: 0, width: 4096, padLeft: 0, padRight: 16 },
        { path: '/panorama/station6/desktop/t1.webp', x0: 4096, width: 4096, padLeft: 16, padRight: 16 },
        { path: '/panorama/station6/desktop/t2.webp', x0: 8192, width: 2990, padLeft: 16, padRight: 0 },
      ],
    },
    {
      id: 'phone', width: 6144, height: 948, bytes: 468892,
      tiles: [
        { path: '/panorama/station6/phone/t0.webp', x0: 0, width: 4096, padLeft: 0, padRight: 16 },
        { path: '/panorama/station6/phone/t1.webp', x0: 4096, width: 2048, padLeft: 16, padRight: 0 },
      ],
    },
    {
      id: 'compact', width: 4096, height: 632, bytes: 230082,
      tiles: [
        { path: '/panorama/station6/compact/t0.webp', x0: 0, width: 4096, padLeft: 0, padRight: 0 },
      ],
    },
  ],
}

export const APOLLO17_PANORAMAS: readonly ApolloPanorama[] = [APOLLO17_ALSEP, APOLLO17_STATION4, APOLLO17_STATION6]
