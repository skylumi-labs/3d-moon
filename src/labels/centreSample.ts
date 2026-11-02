import type { Ephemeris } from '../ephemeris'
import type { ViewCamera } from '../camera/pose'
import type { CamSample } from './centreCaptionCore'

/** The effective camera in Moon coordinates (the components along the Moon's x/y/z axes, as the labels layer does), copied so later edits to `cam` cannot change it. */
export function toMoonSample(cam: ViewCamera, e: Ephemeris, aspect: number): CamSample {
  const m = (v: { dot(o: unknown): number }): [number, number, number] => [v.dot(e.moonX), v.dot(e.moonY), v.dot(e.moonZ)]
  return { pos: m(cam.pos), back: m(cam.back), up: m(cam.up), tanHalf: cam.tanHalf, aspect }
}
