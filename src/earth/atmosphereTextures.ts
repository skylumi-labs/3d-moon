import * as THREE from 'three'
import { trackGpu } from '../quality/track'
import {
  ATMOSPHERE_TOP_KM, GRAZING_N, TRANSMITTANCE_H, TRANSMITTANCE_W,
  buildGrazingLut, buildTransmittanceLut, extinction,
} from './atmosphere'

/**
 * The atmosphere model's tables as half-float textures for the Earth pass.
 * All three come from atmosphere.ts (nothing is retuned here); the CPU
 * builds take a few tens of milliseconds and run once at load.
 */

const half = THREE.DataUtils.toHalfFloat

function halfTexture(data: Float32Array, w: number, h: number): THREE.DataTexture {
  const u16 = new Uint16Array(data.length)
  for (let i = 0; i < data.length; i++) u16[i] = half(data[i])
  const t = new THREE.DataTexture(u16, w, h, THREE.RGBAFormat, THREE.HalfFloatType)
  t.minFilter = THREE.LinearFilter
  t.magFilter = THREE.LinearFilter
  t.wrapS = THREE.ClampToEdgeWrapping
  t.wrapT = THREE.ClampToEdgeWrapping
  t.generateMipmaps = false
  t.needsUpdate = true
  trackGpu('earth', `lut-${w}x${h}`, w * h * 8, t)
  return t
}

export const PROFILE_N = 256
/** Scale of the stored extinctions (per km x this) so half-float keeps them off its subnormals. */
export const PROFILE_SCALE = 1000
/** Scale of the stored bending angle (radians x this). */
export const BEND_SCALE = 1000

export interface AtmosphereTextures {
  /** RGB = optical depth from a point (radius r, cosine mu from vertical) to the top of the atmosphere. */
  transmittance: THREE.DataTexture
  /** 256 x 3, rows Rayleigh, Mie, absorption; RGB per km x PROFILE_SCALE; columns uniform in sqrt(h / top). */
  profile: THREE.DataTexture
  /** 256 x 1: RGB grazing optical depth (clear sky), A = bending angle x BEND_SCALE; uniform in sqrt(h / top). */
  grazing: THREE.DataTexture
}

export function buildAtmosphereTextures(): AtmosphereTextures {
  const prof = new Float32Array(PROFILE_N * 3 * 4)
  for (let i = 0; i < PROFILE_N; i++) {
    const x = i / (PROFILE_N - 1)
    const e = extinction(x * x * ATMOSPHERE_TOP_KM)
    const rows = [e.ray, e.mie, e.abs]
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) prof[(r * PROFILE_N + i) * 4 + c] = rows[r][c] * PROFILE_SCALE
      prof[(r * PROFILE_N + i) * 4 + 3] = 1
    }
  }
  const graz = buildGrazingLut()
  for (let i = 0; i < GRAZING_N; i++) graz[i * 4 + 3] *= BEND_SCALE
  return {
    transmittance: halfTexture(buildTransmittanceLut(), TRANSMITTANCE_W, TRANSMITTANCE_H),
    profile: halfTexture(prof, PROFILE_N, 3),
    grazing: halfTexture(graz, GRAZING_N, 1),
  }
}
