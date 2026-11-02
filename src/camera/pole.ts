import { wrapLon } from './pose'

/** Continue a latitude change across either pole while preserving the viewed direction. */
export function crossPole(lon: number, lat: number, dLon: number, dLat: number, roll = 0): { lon: number; lat: number; roll: number } {
  let nextLon = lon + dLon
  let nextLat = lat + dLat
  let nextRoll = roll
  while (nextLat > 90 || nextLat < -90) {
    if (nextLat > 90) nextLat = 180 - nextLat
    else nextLat = -180 - nextLat
    nextLon += 180
    nextRoll += 180
  }
  return { lon: wrapLon(nextLon), lat: nextLat, roll: ((nextRoll + 180) % 360 + 360) % 360 - 180 }
}
