import { MOMENTS } from '../moments'
/** Claims stay reviewable even when source checks pass and visual/data evidence is unavailable. */
export const TOUR_CLAIMS = MOMENTS.map(m => ({
  id: m.id, label: m.label, subject: m.look === 'earth' ? 'Earth' : m.look === 'sun' ? 'Sun' : m.groundEnd ? 'Moon terrain/module' : 'Moon',
  promise: m.watch, arrival: 'generation-specific arrival event',
  nominalTravelS: m.orbit ? 40 : m.look === 'earth' ? 8 : m.camera.at === 'site' ? 26 : 2.2,
  dwellS: m.dwellS,
  timingCaveat: m.needsPatch ? 'Loading, source refinement and distant-site approach can extend the journey; Play all waits for arrival' : null,
  provenance: m.needsPatch ? 'Measured NAC terrain/image ratio; optional finer sources only under actual camera demand' : 'Ephemeris geometry and modelled radiance with measured global maps',
  gates: ['G1', 'G2', 'G2b', 'G3', 'G4', 'G6', 'G8'],
  verification: 'Source/CPU checks only; exact-build lossless pixels and interactive review pending',
}))
