import * as THREE from 'three'
import type { PanoramaTier } from './manifest'
import { trackGpu } from '../../quality/track'
import { textureBytes } from '../../quality/ledger'

/** Fetches only the selected, bounded tier and joins its horizontal tiles into one GPU texture. */
export async function composePanoramaTiles(tier: PanoramaTier, panoramaId: string, signal?: AbortSignal, wrapsAround = false): Promise<THREE.CanvasTexture> {
  let canvas: HTMLCanvasElement | null = document.createElement('canvas')
  canvas.width = tier.width
  canvas.height = tier.height
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Panorama canvas is unavailable')

  try {
    await Promise.all(tier.tiles.map(async (tile) => {
      const response = await fetch(`${import.meta.env.BASE_URL}${tile.path.replace(/^\//, '')}`, { signal })
      if (!response.ok) throw new Error(`Panorama tile failed (${response.status})`)
      const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
      try {
        const padLeft = tile.padLeft ?? 0
        if (bitmap.width !== tile.width + padLeft + (tile.padRight ?? 0) || bitmap.height !== tier.height) throw new Error(`Panorama tile has unexpected dimensions: ${tile.path}`)
        // Only the tile's own columns are drawn; its padding is context that keeps lossy edges from meeting at a seam.
        context.drawImage(bitmap, padLeft, 0, tile.width, tier.height, tile.x0, 0, tile.width, tier.height)
      } finally { bitmap.close() }
    }))
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    // A 360 degree panorama is baked so its last column continues into its first: wrap, never clamp, at that edge.
    texture.wrapS = wrapsAround ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = true
    texture.flipY = false
    texture.needsUpdate = true
    trackGpu('pano', `${panoramaId}-photo`, textureBytes(tier.width, tier.height, 4, { mips: true }), texture)
    return texture
  } catch (error) {
    canvas.width = canvas.height = 1
    canvas = null
    throw error
  }
}
