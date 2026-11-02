import * as THREE from 'three'

/**
 * The lunar module's texture filtering and look-dev variants (owner complaint 13, 2026-10-23: "the lander could be made sharper; it looks a little artificial").
 *
 * What the glb holds (public/lm/apollo-lunar-module.glb, Blender glTF I/O 4.2.57, listed 2026-10-23): 3 base-colour textures (BOOSTER3 400 x 400,
 * TEXTUREA 900 x 900, TEXTURE_ 900 x 900; WebP with a PNG fallback) on 3 of its 12 materials, the other 9 flat colours; its one sampler is linear /
 * linear-mipmap-linear; NO normal, roughness, metalness, occlusion or emissive map, no tangents. So the only surface detail available is the procedural
 * crinkle (LunarModule.ts crinkleNormalMap); an authored map, if a later model brings one, is kept by tuneMaterials and the crinkle used only without it.
 *
 * Filtering: three leaves `anisotropy` at 1, so the foil's and the decals' texels smear along a grazing view (the eye-level pose sees the descent stage at
 * 10 to 30 deg); `tuneLmTexture` sets the GPU's maximum (16 at most) and trilinear mips on every map, which is a filtering change and not a new asset.
 */

/** The most anisotropy asked of the GPU (its own maximum where lower). */
export const LM_MAX_ANISOTROPY = 16
export function lmAnisotropy(gpuMax: number): number { return Math.max(1, Math.min(LM_MAX_ANISOTROPY, Math.floor(gpuMax) || 1)) }

/**
 * Trilinear mips and `aniso` on a texture; true when something changed (the caller then flags a re-upload, harmless before the first one).
 * A texture whose mips cannot be generated (a compressed or video texture) keeps its filter.
 */
export function tuneLmTexture(t: THREE.Texture, aniso: number): boolean {
  let changed = false
  const canMip = !(t as THREE.CompressedTexture).isCompressedTexture && !(t as THREE.VideoTexture).isVideoTexture
  if (canMip && t.minFilter !== THREE.LinearMipmapLinearFilter) { t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; changed = true }
  if (canMip && t.magFilter !== THREE.LinearFilter) { t.magFilter = THREE.LinearFilter; changed = true }
  if (t.anisotropy !== aniso) { t.anisotropy = aniso; changed = true }
  return changed
}

/** Every texture any material of `root` holds, each once. */
export function lmTextures(root: THREE.Object3D): THREE.Texture[] {
  const seen = new Set<THREE.Texture>()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) seen.add(v as THREE.Texture)
  })
  return [...seen]
}

/**
 * A look-dev variant of the module's materials (`?lmlook=<id>`), for the owner to pick from a rig contact sheet at the eye pose (moon-a17eye.mjs --lmlooks).
 * All are CHOICES against Apollo-era surface photographs, none a measurement; `main` is the look shipped before this (LunarModule.tuneMaterials).
 */
export interface LmLook {
  id: string
  /** Share of the model's own base colour kept (the regolith is exposed white at 5x its I/F, so the module's paint sits below white). */
  albedoScale: number
  /** The descent stage's foil: roughness, metalness and the crinkle normal map's strength (0 flat). */
  foilRoughness: number
  foilMetalness: number
  crinkle: number
  /** The bare white structure's crinkle strength (a lighter texture than the foil's). */
  structureCrinkle: number
  note: string
}

export const LM_LOOKS: Readonly<Record<string, LmLook>> = {
  main: { id: 'main', albedoScale: 0.3, foilRoughness: 0.42, foilMetalness: 0.55, crinkle: 0.9, structureCrinkle: 0.25, note: 'the shipped look' },
  // More crease structure and a glossier foil: the Sun breaks into finer, harder glints; the structure a touch sharper too.
  crisp: { id: 'crisp', albedoScale: 0.3, foilRoughness: 0.34, foilMetalness: 0.6, crinkle: 1.3, structureCrinkle: 0.35, note: 'finer, harder glints; glossier foil' },
  // A duller, dustier foil with softer creases (the descent stage after the dust of the landing): less "CG", less sparkle.
  matte: { id: 'matte', albedoScale: 0.34, foilRoughness: 0.55, foilMetalness: 0.4, crinkle: 0.6, structureCrinkle: 0.2, note: 'dustier foil, softer creases' },
  // The module a third brighter against the regolith (the audit found the shipped albedo a little dark beside the white structure of the photographs).
  bright: { id: 'bright', albedoScale: 0.4, foilRoughness: 0.45, foilMetalness: 0.5, crinkle: 1.0, structureCrinkle: 0.25, note: 'a third brighter, otherwise the shipped foil' },
}
export const LM_LOOK_DEFAULT = 'main'

/** The variant the page asks for (`?lmlook=`), `main` for none or an unknown id. */
export function lmLook(search: string): LmLook {
  const id = new URLSearchParams(search).get('lmlook') ?? LM_LOOK_DEFAULT
  return LM_LOOKS[id] ?? LM_LOOKS[LM_LOOK_DEFAULT]
}
