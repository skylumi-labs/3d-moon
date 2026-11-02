/**
 * The lunar module's texture filtering and look-dev variants (src/ground/lmMaterials.ts, owner complaint 13): anisotropy at the GPU's maximum capped at 16,
 * trilinear mips on every map, `?lmlook=` picks a variant and an unknown id is the shipped look; the module applies both (source pins on LunarModule.ts and
 * GroundMode.ts). The glb inventory the helper's header states is checked against the file itself.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { LM_LOOKS, LM_LOOK_DEFAULT, LM_MAX_ANISOTROPY, lmAnisotropy, lmLook, lmTextures, tuneLmTexture } from '../src/ground/lmMaterials.ts'

assert.equal(lmAnisotropy(16), 16); assert.equal(lmAnisotropy(8), 8); assert.equal(lmAnisotropy(64), LM_MAX_ANISOTROPY, 'never above 16')
assert.equal(lmAnisotropy(0), 1, 'no anisotropy support: 1'); assert.equal(lmAnisotropy(NaN), 1)

// Looks: the default is the shipped one, every variant differs from it somewhere, all within physical range.
assert.equal(lmLook('').id, LM_LOOK_DEFAULT); assert.equal(lmLook('?lmlook=nonsense').id, LM_LOOK_DEFAULT)
assert.equal(lmLook('?lmlook=crisp').id, 'crisp'); assert.equal(lmLook('?x=1&lmlook=matte').id, 'matte')
const main = LM_LOOKS[LM_LOOK_DEFAULT]
assert.deepEqual([main.albedoScale, main.foilRoughness, main.foilMetalness, main.crinkle, main.structureCrinkle], [0.3, 0.42, 0.55, 0.9, 0.25], 'main is the look shipped before (LunarModule.tuneMaterials as of 2026-10-22)')
assert.ok(Object.keys(LM_LOOKS).length >= 3, 'at least two variants besides main')
for (const [id, l] of Object.entries(LM_LOOKS)) {
  assert.equal(l.id, id)
  for (const k of ['albedoScale', 'foilRoughness', 'foilMetalness'] as const) assert.ok(l[k] > 0 && l[k] <= 1, `${id}.${k} in (0, 1]`)
  assert.ok(l.crinkle >= 0 && l.crinkle <= 2 && l.structureCrinkle >= 0 && l.structureCrinkle <= 1, `${id} crinkle strengths`)
  if (id !== LM_LOOK_DEFAULT) assert.notDeepEqual({ ...l, id: '', note: '' }, { ...main, id: '', note: '' }, `${id} differs from main`)
}

// Filtering: trilinear mips and the anisotropy, once; a compressed texture keeps its filter but takes the anisotropy.
{
  const t = new THREE.DataTexture(new Uint8Array(16), 2, 2)
  t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.anisotropy = 1
  assert.equal(tuneLmTexture(t, 16), true)
  assert.equal(t.minFilter, THREE.LinearMipmapLinearFilter); assert.equal(t.magFilter, THREE.LinearFilter); assert.equal(t.generateMipmaps, true); assert.equal(t.anisotropy, 16)
  assert.equal(tuneLmTexture(t, 16), false, 'nothing to change the second time')
  const c = new THREE.CompressedTexture([], 4, 4)
  c.minFilter = THREE.LinearFilter
  assert.equal(tuneLmTexture(c, 8), true); assert.equal(c.minFilter, THREE.LinearFilter, 'no mips generated for a compressed texture'); assert.equal(c.anisotropy, 8)
  // Every texture of a model once, across shared materials and material arrays.
  const map = new THREE.DataTexture(new Uint8Array(4), 1, 1), nm = new THREE.DataTexture(new Uint8Array(4), 1, 1)
  const shared = new THREE.MeshStandardMaterial({ map, normalMap: nm })
  const root = new THREE.Group()
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), shared), new THREE.Mesh(new THREE.BufferGeometry(), shared), new THREE.Mesh(new THREE.BufferGeometry(), [shared, new THREE.MeshStandardMaterial({ map })]))
  assert.deepEqual(new Set(lmTextures(root)), new Set([map, nm]))
}

// The module applies the look and the filtering; GroundMode gives the GPU's maximum before the first draw; the lite and physical paths keep the authored maps.
{
  const lm = readFileSync(new URL('../src/ground/LunarModule.ts', import.meta.url), 'utf8')
  assert.ok(lm.includes('lm.tuneMaterials(opts.look ?? lmLook('), 'the look is read at load (the preload path too)')
  assert.ok(lm.includes('mat.metalness = look.foilMetalness; mat.roughness = look.foilRoughness') && lm.includes('crinkled(look.crinkle)') && lm.includes('mat.color.multiplyScalar(look.albedoScale)'), 'the look sets the foil and the albedo')
  assert.ok(lm.includes('if (authored.normalMap || k <= 0) return'), 'an authored normal map is never replaced by the crinkle')
  assert.ok(lm.includes("const authored = { map: old.map ?? null, normalMap: old.normalMap ?? null, roughnessMap: old.roughnessMap ?? null, metalnessMap: old.metalnessMap ?? null }"), 'authored maps carried over')
  assert.ok(lm.includes('for (const t of lmTextures(this.model)) if (tuneLmTexture(t, aniso)) { t.needsUpdate = true; n++ }'), 'setAnisotropy re-uploads only what changed')
  const gm = readFileSync(new URL('../src/ground/GroundMode.ts', import.meta.url), 'utf8')
  assert.ok(gm.includes('lm.setAnisotropy(lmAnisotropy(this.renderer.capabilities.getMaxAnisotropy()))'), 'GroundMode.loadLm applies it with the renderer in hand')
  assert.ok(gm.indexOf('lm.setAnisotropy(') < gm.indexOf('this.lm = lm'), 'before the module is in use')
}

// The inventory stated in lmMaterials.ts matches the glb: 3 textures on 3 of 12 materials, no normal/roughness/metalness/occlusion/emissive map.
{
  const buf = readFileSync(new URL('../public/lm/apollo-lunar-module.glb', import.meta.url))
  const jsonLen = buf.readUInt32LE(12)
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as { images?: unknown[]; textures?: unknown[]; materials: Array<Record<string, unknown> & { pbrMetallicRoughness?: Record<string, unknown> }> }
  assert.equal(json.textures?.length, 3); assert.equal(json.materials.length, 12)
  const withBase = json.materials.filter((m) => m.pbrMetallicRoughness?.baseColorTexture).length
  assert.equal(withBase, 3)
  for (const m of json.materials) {
    assert.equal(m.pbrMetallicRoughness?.metallicRoughnessTexture, undefined, 'no metallic-roughness map')
    for (const k of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) assert.equal(m[k], undefined, `no ${k}`)
  }
}
console.log('lm-look: ok')
