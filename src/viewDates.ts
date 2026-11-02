import { TYCHO, PLATO } from './labels/gazetteer'
import { getCinematicFlight } from './cinematics/flights'
import { keptMorning, nextMorning, nextRouteMorning } from './sunMorning'

/**
 * The dates of the viewpoints that need a low Sun, computed from the ephemeris and kept for an hour (the search steps through a month).
 * Shared by the hotspots (stills) and the moments (flights) so a still and the flight round the same place are lit by the same morning.
 */

/** A lunar morning at Tycho: the Sun 10 deg up and rising over the crater. */
export const tychoMorning = (): Date => keptMorning('tycho', () => nextMorning(TYCHO.lon, TYCHO.lat, 10))
/** A lunar morning at Plato: the Sun 10 deg up and rising over the crater. */
export const platoMorning = (): Date => keptMorning('plato', () => nextMorning(PLATO.lon, PLATO.lat, 10))

/** The Sun elevation, degrees, that the darkest waypoint of each re-dated flight has at its date. */
export const FLIGHT_MORNING_MIN_EL_DEG: Readonly<Record<string, number>> = {
  'rille-run': 6,
  'terminator-run': 3,
  'sunrise-arc-a': 3,
  'sunrise-arc-b': 3,
}

/**
 * The next time the whole route of a flight is in daylight just east of the morning terminator: the Sun over its darkest waypoint is
 * `FLIGHT_MORNING_MIN_EL_DEG[id]` above the horizon and rising, so every other waypoint (further east) is higher, never below it.
 */
export function flightMorning(flightId: string, from?: Date): Date {
  const f = getCinematicFlight(flightId)
  const min = FLIGHT_MORNING_MIN_EL_DEG[flightId]
  if (!f?.waypoints || min === undefined) throw new Error(`No morning for flight ${flightId}`)
  const points = f.waypoints
  if (from) return nextRouteMorning(points, min, from)
  return keptMorning(`flight:${flightId}`, () => nextRouteMorning(points, min))
}
