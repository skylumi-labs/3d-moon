import * as THREE from 'three'
import { DataUtils } from 'three'
import type { HeightMap } from './maps'
import { createSurfaceHeightSampler } from '../labels/surfaceHeight'
import { MOON_R_KM } from '../glsl/common'
import { trackGpu } from '../quality/track'

export const COARSE_HORIZON_WIDTH = 64
export const COARSE_HORIZON_HEIGHT = 32

/** Build a deliberately coarse base-map horizon toward the Sun. 18,432 height
 * samples at most; the small map is only the fixed-policy cache-miss fallback. */
export function buildCoarseHorizon(height: HeightMap, sunBody: readonly [number, number, number]): THREE.DataTexture {
  const sampler = createSurfaceHeightSampler(height, 1)
  const data = new Uint16Array(COARSE_HORIZON_WIDTH * COARSE_HORIZON_HEIGHT)
  const sl = Math.hypot(...sunBody) || 1
  const sx = sunBody[0] / sl, sy = sunBody[1] / sl, sz = sunBody[2] / sl
  const distances = [2, 5, 10, 20, 40, 80, 160, 300, 500]
  for (let y = 0; y < COARSE_HORIZON_HEIGHT; y++) for (let x = 0; x < COARSE_HORIZON_WIDTH; x++) {
    const lon = ((x + 0.5) / COARSE_HORIZON_WIDTH * 360 - 180) * Math.PI / 180
    const lat = (90 - (y + 0.5) / COARSE_HORIZON_HEIGHT * 180) * Math.PI / 180
    const p = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
    const dot = p[0] * sx + p[1] * sy + p[2] * sz
    let tx = sx - p[0] * dot, ty = sy - p[1] * dot, tz = sz - p[2] * dot
    const tl = Math.hypot(tx, ty, tz)
    let best = -90
    if (tl > 1e-6) {
      tx /= tl; ty /= tl; tz /= tl
      const h0 = sampler.sample(lon * 180 / Math.PI, lat * 180 / Math.PI) ?? 0
      for (const d of distances) {
        const a = d / MOON_R_KM
        const qx = p[0] * Math.cos(a) + tx * Math.sin(a)
        const qy = p[1] * Math.cos(a) + ty * Math.sin(a)
        const qz = p[2] * Math.cos(a) + tz * Math.sin(a)
        const qlon = Math.atan2(qy, qx) * 180 / Math.PI
        const qlat = Math.asin(Math.max(-1, Math.min(1, qz))) * 180 / Math.PI
        const hq = sampler.sample(qlon, qlat) ?? h0
        best = Math.max(best, Math.atan2((hq - h0) / 1000 - MOON_R_KM * (1 - Math.cos(a)), MOON_R_KM * Math.sin(a)) * 180 / Math.PI)
      }
    }
    data[y * COARSE_HORIZON_WIDTH + x] = DataUtils.toHalfFloat(best)
  }
  const texture = new THREE.DataTexture(data, COARSE_HORIZON_WIDTH, COARSE_HORIZON_HEIGHT, THREE.RedFormat, THREE.HalfFloatType)
  texture.internalFormat = 'R16F'
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  trackGpu('tiles', 'coarse-horizon', COARSE_HORIZON_WIDTH * COARSE_HORIZON_HEIGHT * 2, texture)
  return texture
}

/** Quantize direction to the existing cache's angular scale, avoiding needless rebuilds from float noise. */
export function coarseSunEpoch(sun: readonly [number, number, number]): string {
  const n = Math.hypot(...sun) || 1
  return sun.map((v) => Math.round((v / n) * 10000)).join(':')
}

export function coarseHorizonNeedsRebuild(previousEpoch: string, sun: readonly [number, number, number]): boolean {
  return coarseSunEpoch(sun) !== previousEpoch
}
