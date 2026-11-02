import * as THREE from 'three'
import { MOON_R_KM } from '../glsl/common'
import { trackGpu } from '../quality/track'
import { textureBytes } from '../quality/ledger'
import { decodeHeights, heightInflateOnMain, inflateIfGzip, type DecodedHeights } from './heightDecode'
import mapsMeta from '../../shared-assets/moon-maps.json'

/**
 * The Moon's 4k maps, shared with the moon-v1 prototype: LROC WAC colour and
 * LOLA heights, whole globe, equirectangular, east longitude to the right,
 * north up (moon-maps.json). Imported through Vite so the build emits them
 * under /moon/.
 */
const COLOR_URL = new URL('../../shared-assets/moon-color-4k.jpg', import.meta.url).href
const HEIGHT_URL = new URL('../../shared-assets/moon-height-4k.bin.gz', import.meta.url).href

export const MAPS_CREDIT = mapsMeta.source.credit

export interface HeightMap {
  texture: THREE.DataTexture
  /** CPU half-float heights retained for sparse UI point samples after the GPU upload releases full-resolution mip data. */
  sample?: { data: Uint16Array; width: number; height: number }
  /** Mip levels, 4096 x 2048 down to 1 x 1. */
  levels: number
  /** Longitudes covered each side of 0, deg: 180 for the whole globe. */
  lonSpan: number
  size: [number, number]
  /** Largest error (m) the half-float store adds to level 0, measured while decoding: 0 to 4 m (step 4 m, half float steps 8 m above 8,192 m). */
  halfErrorM: number
  /** GPU bytes of the texture with its mips (R16F). */
  gpuBytes: number
  /** True for the flat stand-in drawn until the real map arrives (loadMoonMapsColorFirst): every height reads 0. */
  pending?: boolean
}

/**
 * The colour map's luminance as a pyramid of maxima, for the exposure
 * search (post/exposure.ts). Level 0 is the map averaged to 2048 x 1024
 * (5.3 km cells, about the shader's footprint at the closest approach); each
 * further level holds the brightest of the four cells below it, so a sample
 * reading the level as wide as the ground between samples cannot miss a
 * bright crater or ray in view.
 */
export interface AlbedoPyramid {
  levels: { y: Float32Array; w: number; h: number }[]
  cellKm: number
}

export interface MoonMaps {
  color: THREE.Texture
  height: HeightMap
  albedo: AlbedoPyramid
}

/** The inflate and decode in a worker (a copy of the buffer moves); a page that cannot start one inflates and decodes in place, to the same bytes. */
async function decodeOffThread(buf: ArrayBuffer): Promise<DecodedHeights> {
  if (typeof Worker !== 'undefined') {
    try {
      return await new Promise<DecodedHeights>((resolve, reject) => {
        const worker = new Worker(new URL('./heightWorker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (ev: MessageEvent<{ type: string; out?: DecodedHeights; message?: string }>) => {
          worker.terminate()
          if (ev.data.type === 'done') resolve(ev.data.out as DecodedHeights)
          else reject(new Error(ev.data.message))
        }
        worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'height worker failed')) }
        // A copy moves, so the in-page fallback below still has its bytes if the worker fails.
        const copy = buf.slice(0)
        worker.postMessage(copy, [copy])
      })
    } catch { /* decode in the page below */ }
  }
  return decodeHeights(await inflateIfGzip(buf))
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`)
  return res
}

/**
 * Heights: gradient-predicted residuals, zig-zag, planar bytes, gzip
 * (built offline). Decoded to metres, box-filtered into
 * a mip chain and uploaded as R16F, filtered in the shader (a float texture
 * holding exact metres is not filterable everywhere, and bilinear in the
 * shader is exact anyway).
 */
export async function loadHeight(): Promise<HeightMap> {
  const res = await fetchOk(HEIGHT_URL)
  let buf = await res.arrayBuffer()
  // A server may already have undone the gzip (Content-Encoding); the magic says which. The worker inflates it (inflateIfGzip): 82-109 ms of
  // DecompressionStream on the page's thread otherwise. ?heightinflate=main keeps the inflate on the page (the old path, for the A/B).
  if (typeof location !== 'undefined' && heightInflateOnMain(location.search)) buf = await inflateIfGzip(buf)
  const decoded = await decodeOffThread(buf)
  const { w, h, lonSpan, halfErrorM } = decoded
  const half = decoded.levels
  // Level 2 is an approximately 10 km grid (~1 MiB). Labels and other UI overlays need
  // occasional terrain anchors after the full-resolution CPU mip chain is freed.
  const sample = half[Math.min(2, half.length - 1)]
  let gpuBytes = 0
  for (const m of half) gpuBytes += m.data.length * 2
  const texture = new THREE.DataTexture(half[0].data, w, h, THREE.RedFormat, THREE.HalfFloatType)
  texture.internalFormat = 'R16F'
  texture.mipmaps = half as unknown as THREE.DataTexture['mipmaps']
  texture.generateMipmaps = false
  texture.minFilter = THREE.NearestMipmapNearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.flipY = false
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  // Once on the GPU the page need not keep the copy. (After a lost context the map is fetched and decoded again: main.ts.)
  texture.onUpdate = () => {
    texture.mipmaps = []
    texture.image = { data: null, width: w, height: h } as unknown as typeof texture.image
  }
  return { texture, sample, levels: half.length, lonSpan, size: [w, h], halfErrorM, gpuBytes }
}

async function loadColor(): Promise<{ texture: THREE.Texture; bitmap: ImageBitmap }> {
  const res = await fetchOk(COLOR_URL)
  const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const texture = new THREE.Texture(bitmap)
  // sRGB bytes decoded by the sampler (SRGB8_ALPHA8), mipmapped by the GPU.
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  // The albedo pyramid reads the bitmap before the first frame uploads it;
  // after that the 32 MB decode is only in the GPU's copy.
  texture.onUpdate = () => bitmap.close()
  return { texture, bitmap }
}

function albedoPyramid(img: ImageBitmap): AlbedoPyramid {
  const W = 2048, H = 1024
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas unavailable')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, W, H)
  const d = ctx.getImageData(0, 0, W, H).data
  const lin = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const x = i / 255
    lin[i] = x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  let level = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) level[i] = 0.2126 * lin[d[4 * i]] + 0.7152 * lin[d[4 * i + 1]] + 0.0722 * lin[d[4 * i + 2]]
  const levels = [{ y: level, w: W, h: H }]
  let lw = W, lh = H
  while (lw > 32) {
    const nw = lw >> 1, nh = lh >> 1
    const next = new Float32Array(nw * nh)
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const i = 2 * y * lw + 2 * x
        next[y * nw + x] = Math.max(level[i], level[i + 1], level[i + lw], level[i + lw + 1])
      }
    }
    levels.push({ y: next, w: nw, h: nh })
    level = next
    lw = nw
    lh = nh
  }
  return { levels, cellKm: 2 * Math.PI * MOON_R_KM / W }
}

export async function loadMoonMaps(maxAnisotropy: number): Promise<MoonMaps> {
  const [color, height] = await Promise.all([loadColor(), loadHeight()])
  // The colour map covers the same longitudes as the heights; a whole globe
  // wraps across longitude 180.
  color.texture.wrapS = height.lonSpan >= 180 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
  color.texture.anisotropy = Math.min(8, maxAnisotropy)
  // SRGB8_A8 with a GPU mip chain; R16F with the CPU chain (height.gpuBytes sums it).
  trackGpu('maps', 'global-colour', textureBytes(color.bitmap.width, color.bitmap.height, 4, { mips: true }), color.texture)
  trackGpu('maps', 'global-height', height.gpuBytes, height.texture)
  const albedo = albedoPyramid(color.bitmap)
  return { color: color.texture, height, albedo }
}

/**
 * The maps for a first frame on a slow link: the colour image (1.3 MB) and a flat stand-in for the heights, so the Moon is drawn as soon as
 * the colour is in. The 6.2 MB height map follows with `loadHeight()` once a frame is up; the page swaps it in and eases it in
 * (`uHeightMix`, 0 to 1), so there is no pop. The stand-in has the real map's span and size (the shaders are built from them) and one 1 x 1 level.
 */
export async function loadMoonMapsColorFirst(maxAnisotropy: number): Promise<MoonMaps> {
  const color = await loadColor()
  color.texture.wrapS = THREE.RepeatWrapping
  color.texture.anisotropy = Math.min(8, maxAnisotropy)
  const albedo = albedoPyramid(color.bitmap)
  const flat = new THREE.DataTexture(new Uint16Array([0]), 1, 1, THREE.RedFormat, THREE.HalfFloatType)
  flat.internalFormat = 'R16F'
  flat.minFilter = THREE.NearestFilter
  flat.magFilter = THREE.NearestFilter
  flat.generateMipmaps = false
  flat.unpackAlignment = 1
  flat.needsUpdate = true
  const [w, h] = mapsMeta.size as [number, number]
  return { color: color.texture, albedo, height: { texture: flat, levels: 1, lonSpan: mapsMeta.lonRangeDeg[1], size: [w, h], halfErrorM: 0, gpuBytes: 2, pending: true } }
}
