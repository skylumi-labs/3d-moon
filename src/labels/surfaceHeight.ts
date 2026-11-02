import { DataUtils } from 'three'
import { MOON_R_KM } from '../glsl/common'

export interface HeightMipLevel {
  data: ArrayLike<number>
  width: number
  height: number
}

/** The subset of a Moon height map needed to sample its level-zero R16F source. */
export interface HeightMapSource {
  texture: {
    /** Three's Texture type includes cube and compressed mip variants; inspect these as unknown and narrow at runtime. */
    mipmaps?: unknown
    image?: unknown
  }
  /** Retained low-resolution half-float grid used after the renderer releases full mip data. */
  sample?: HeightMipLevel
  size: readonly [number, number]
  lonSpan: number
  pending?: boolean
}

export interface SurfaceHeightSampler {
  sample(lonDeg: number, latDeg: number): number | null
  clear(): void
  readonly cacheSize: number
}

const MAX_CACHE = 2048
const samplers = new WeakMap<object, SurfaceHeightSampler>()

function wrap(value: number, span: number): number {
  return ((value + span) % (2 * span) + 2 * span) % (2 * span) - span
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function mipLevel(value: unknown): HeightMipLevel | null {
  const candidate = record(value)
  if (!candidate) return null
  const data = candidate.data
  const width = candidate.width, height = candidate.height
  if (!data || typeof (data as { length?: unknown }).length !== 'number' || typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) return null
  if ((data as { length: number }).length < width * height) return null
  return { data: data as ArrayLike<number>, width, height }
}

/**
 * Build a bounded bilinear sampler matching `heightGlsl`: equirectangular,
 * north at row zero, half-float metres above the mean-radius sphere, longitude
 * wrapping at the dateline for whole-globe maps, and clamped polar rows.
 */
export function createSurfaceHeightSampler(source: HeightMapSource, maxCache = MAX_CACHE): SurfaceHeightSampler {
  const capacity = Math.max(1, Math.floor(maxCache))
  let cachedLevel: HeightMipLevel | null = null
  const cache = new Map<string, number>()
  const getLevel = (): HeightMipLevel | null => {
    if (cachedLevel) return cachedLevel
    if (source.pending) return null
    if (source.sample) { cachedLevel = source.sample; return cachedLevel }
    const mipmaps = source.texture.mipmaps
    const mip = Array.isArray(mipmaps) ? mipLevel(mipmaps[0]) : null
    const image = record(source.texture.image)
    const imageData = image?.data
    const imageLevel = imageData ? mipLevel({ data: imageData, width: image?.width ?? source.size[0], height: image?.height ?? source.size[1] }) : null
    cachedLevel = mip ?? imageLevel
    return cachedLevel
  }
  const sample = (lonDeg: number, latDeg: number): number | null => {
    if (!Number.isFinite(lonDeg) || !Number.isFinite(latDeg)) return null
    if (source.pending) return 0
    const lon = source.lonSpan >= 180 ? wrap(lonDeg, source.lonSpan) : Math.max(-source.lonSpan, Math.min(source.lonSpan, lonDeg))
    const lat = Math.max(-90, Math.min(90, latDeg))
    const key = `${lon.toFixed(5)}:${lat.toFixed(5)}`
    const known = cache.get(key)
    if (known !== undefined) {
      cache.delete(key)
      cache.set(key, known)
      return known
    }
    const level = getLevel()
    if (!level) return null
    const u = (lon + source.lonSpan) / (2 * source.lonSpan)
    const v = (90 - lat) / 180
    const tx = u * level.width - 0.5, ty = v * level.height - 0.5
    const ix = Math.floor(tx), iy = Math.floor(ty)
    const fx = tx - ix, fy = ty - iy
    const xAt = (x: number): number => source.lonSpan >= 180 ? ((x % level.width) + level.width) % level.width : Math.max(0, Math.min(level.width - 1, x))
    const yAt = (y: number): number => Math.max(0, Math.min(level.height - 1, y))
    const at = (x: number, y: number): number => DataUtils.fromHalfFloat(level.data[yAt(y) * level.width + xAt(x)] as number)
    const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1)
    const value = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
    if (!Number.isFinite(value)) return null
    cache.set(key, value)
    if (cache.size > capacity) cache.delete(cache.keys().next().value as string)
    return value
  }
  return { sample, clear: () => cache.clear(), get cacheSize() { return cache.size } }
}

/** Reuse the coordinate cache for a map object while allowing obsolete maps to be collected. */
export function sampleGlobalHeightM(source: HeightMapSource, lonDeg: number, latDeg: number): number | null {
  let sampler = samplers.get(source as object)
  if (!sampler) { sampler = createSurfaceHeightSampler(source); samplers.set(source as object, sampler) }
  return sampler.sample(lonDeg, latDeg)
}

/** Convert source elevation metres to a normalized radius matching the globe shader. */
export function radiusAtHeightM(heightM: number): number {
  return (MOON_R_KM + heightM / 1000) / MOON_R_KM
}
