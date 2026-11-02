/**
 * The few Tabler Icons (MIT, (c) Pawel Kuna, https://tabler.io/icons) the viewer uses, as SVG path data copied from
 * @tabler/icons 3.46.0 (outline set, 24 px grid). Same family and stroke as SkyLumi (stroke 1.8). Inlined rather than
 * imported: the package ships thousands of icons and this is vanilla TS with no icon runtime.
 */
export const TABLER_STROKE = 1.8

const PATHS = {
  home: ['M5 12l-2 0l9 -9l9 9l-2 0', 'M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7', 'M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6'],
  clock: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 7v5l3 3'],
  infoCircle: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 9h.01', 'M11 12h1v4h1'],
  upload: ['M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2', 'M7 9l5 -5l5 5', 'M12 4l0 12'],
  adjustmentsHorizontal: [
    'M12 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M4 6l8 0', 'M16 6l4 0', 'M6 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M4 12l2 0', 'M10 12l10 0',
    'M15 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M4 18l11 0', 'M19 18l1 0',
  ],
  mapPin: ['M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0', 'M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z'],
  dots: ['M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0', 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0', 'M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0'],
  mountain: ['M3 20h18l-6.921 -14.612a2.3 2.3 0 0 0 -4.158 0l-6.921 14.612', 'M7.5 11l2 2.5l2.5 -2.5l2 3l2.5 -2'],
  chevronLeft: ['M15 6l-6 6l6 6'],
  chevronRight: ['M9 6l6 6l-6 6'],
  chevronDown: ['M6 9l6 6l6 -6'],
  plus: ['M12 5l0 14', 'M5 12l14 0'],
  minus: ['M5 12l14 0'],
  arrowBackUp: ['M9 14l-4 -4l4 -4', 'M5 10h11a4 4 0 1 1 0 8h-1'],
  list: ['M9 6l11 0', 'M9 12l11 0', 'M9 18l11 0', 'M5 6l0 .01', 'M5 12l0 .01', 'M5 18l0 .01'],
  rotateClockwise: ['M4.05 11a8 8 0 1 1 .5 4m-.5 5v-5h5'],
  // Drawn in the same style (not copied from the set): a small body in the middle of a flat orbit.
  orbit: ['M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M3 12a9 4 0 1 0 18 0a9 4 0 1 0 -18 0'],
  handMove: [
    'M8 13v-8.5a1.5 1.5 0 0 1 3 0v7.5', 'M11 11.5v-2a1.5 1.5 0 0 1 3 0v2.5', 'M14 10.5a1.5 1.5 0 0 1 3 0v1.5',
    'M17 11.5a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7l-.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47',
    'M2.541 5.594a13.487 13.487 0 0 1 2.46 -1.427', 'M14 3.458c1.32 .354 2.558 .902 3.685 1.612',
  ],
} as const

export type TablerName = keyof typeof PATHS

/** An inline SVG for a Tabler icon, stroke 1.8, sized `size` px, coloured by currentColor. */
export function tablerIcon(name: TablerName, size = 22): string {
  const d = PATHS[name].map((p) => `<path d="${p}"/>`).join('')
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${TABLER_STROKE}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
}
