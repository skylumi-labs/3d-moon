import * as THREE from 'three'
import { EARTH_R_KM, FULLSCREEN_VERTEX, MOON_R_KM, fullscreenTriangle } from '../glsl/common'
import { SUN_R_KM } from '../lighting/solar'
import type { Ephemeris } from '../ephemeris'
import type { ViewCamera } from '../camera/pose'
import { buildAtmosphereTextures } from './atmosphereTextures'
import { EARTH_COVER_FRAGMENT, EARTH_SHADE_FRAGMENT } from './earthShader'
import credits from './credits.json'
import { trackGpu } from '../quality/track'
import { textureBytes } from '../quality/ledger'

type Common = Record<string, THREE.IUniform>

/** The credit line for the maps, shown with the others. */
export const EARTH_CREDIT =
  'Earth: NASA Earth Observatory (Blue Marble: Next Generation, R. Stöckli; Blue Marble clouds, MODIS 2002; Black Marble 2016, Suomi NPP VIIRS, M. Román) and NASA GIBS (MODIS land-water mask).'
/** What the page says about how much of the Earth is data and how much is model. */
export const EARTH_NOTE =
  'The Earth’s clouds are one day in 2002, its air is one modelled clear state with single scattering, and its city lights are a modelled stretch: none of it is today’s weather.'
export const EARTH_MAP_SOURCES = credits.sources

const BASE = import.meta.env.BASE_URL
const url = (name: string): string => `${BASE}earth/${name}`

/**
 * The maps the shader reads one channel of (`.r`: cloud cover, city lights, the water mask; all three files are greyscale). They are uploaded as
 * R8, a quarter of the RGBA8 they used to take: 2.7 MB each at 2048x1024 with mips instead of 10.7 (issue #206, the Apollo 17 view on an
 * Android phone held all four Earth maps, 43 MB). Same bytes in the red channel, so the picture does not change.
 */
export const EARTH_SINGLE_CHANNEL: ReadonlySet<string> = new Set(['clouds.jpg', 'lights.jpg', 'water.png'])
export const earthTextureBytes = (name: string, w: number, h: number): number => textureBytes(w, h, EARTH_SINGLE_CHANNEL.has(name) ? 1 : 4, { mips: true })

function configure(t: THREE.Texture, name: string, anisotropy: number): THREE.Texture {
  if (EARTH_SINGLE_CHANNEL.has(name)) { t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType }
  t.colorSpace = THREE.NoColorSpace // albedo and lights are sRGB-encoded numbers, decoded in the shader
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.ClampToEdgeWrapping
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.generateMipmaps = true
  t.anisotropy = anisotropy
  const img = t.image as { width: number; height: number }
  trackGpu('earth', name, earthTextureBytes(name, img.width, img.height), t)
  return t
}

/**
 * An <img> texture is decoded and Y-flipped on the main thread inside the first texImage upload: four 2048x1024 maps cost 30-65 ms each in the
 * first frames of a link that opens on the Earth (measured on the rig; img.decode() beforehand changed nothing). createImageBitmap decodes
 * and flips off the main thread, the same way the Moon's own maps arrive. The <img> path stays as the fallback.
 */
function loadTexture(name: string, anisotropy: number): Promise<THREE.Texture> {
  const viaImage = (): Promise<THREE.Texture> => new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url(name), (t) => resolve(configure(t, name, anisotropy)), undefined, () => reject(new Error(`Could not load ${url(name)}`)))
  })
  if (typeof createImageBitmap !== 'function') return viaImage()
  return fetch(url(name)).then((res) => {
    if (!res.ok) throw new Error(`Could not load ${url(name)} (${res.status})`)
    return res.blob()
  }).then((blob) => createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'flipY' }))
    .then((bmp) => {
      const t = new THREE.Texture(bmp)
      t.flipY = false // already flipped by the decode
      t.needsUpdate = true
      t.onUpdate = () => bmp.close()
      return configure(t, name, anisotropy)
    }, () => viaImage())
}

const month = (d: Date): number => d.getUTCMonth() + 1
const albedoName = (m: number): string => `albedo-${String(m).padStart(2, '0')}.jpg`

/**
 * The Earth (README pass order: after the Sun, before the Moon). Two draws
 * like the Moon: the first clears the disc's coverage out of what is behind,
 * the second adds the globe's radiance and the light of the air over the
 * limb. Skipped from the Earth's centre, where there is no Earth to see.
 */
export class EarthPass {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera()
  private readonly uniforms: Record<string, THREE.IUniform>
  private enabled = false
  /** False while the maps are still on their way (loadDeferred): the globe is not drawn until they are in, never a grey ball. */
  private texturesReady = true
  private loadedMonth: number
  private loadingMonth = -1
  private readonly anisotropy: number
  /** Called when a later month's albedo arrives, so the page redraws. */
  onLoaded: (() => void) | null = null

  private constructor(common: Common, textures: Record<string, THREE.Texture>, m: number, anisotropy: number) {
    this.loadedMonth = m
    this.anisotropy = anisotropy
    const atm = buildAtmosphereTextures()
    this.uniforms = {
      ...common,
      uTanPerPx: { value: 1e-3 },
      uEarthRel: { value: new THREE.Vector3() },
      uSunE: { value: new THREE.Vector3() },
      uSunPos: { value: new THREE.Vector3() },
      uEarthPos: { value: new THREE.Vector3() },
      uSunTheta: { value: 0.0047 },
      uSunPerp: { value: new THREE.Vector3() },
      uRingOn: { value: 0 },
      uShadowOn: { value: 0 },
      uWorldToEarth: { value: new THREE.Matrix3() },
      uLod0: { value: 0 },
      uAlbedo: { value: textures.albedo },
      uClouds: { value: textures.clouds },
      uLights: { value: textures.lights },
      uWater: { value: textures.water },
      uTrans: { value: atm.transmittance },
      uProf: { value: atm.profile },
      uGraz: { value: atm.grazing },
    }
    const geometry = fullscreenTriangle()
    const cover = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: EARTH_COVER_FRAGMENT,
      uniforms: { ...common, uTanPerPx: this.uniforms.uTanPerPx, uEarthRel: this.uniforms.uEarthRel },
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    })
    const shade = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: EARTH_SHADE_FRAGMENT,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    })
    const a = new THREE.Mesh(geometry, cover), b = new THREE.Mesh(geometry, shade)
    a.renderOrder = 0
    b.renderOrder = 1
    for (const m2 of [a, b]) {
      m2.frustumCulled = false
      this.scene.add(m2)
    }
  }

  static async load(common: Common, date: Date, anisotropy: number): Promise<EarthPass> {
    const m = month(date)
    const [albedo, clouds, lights, water] = await Promise.all([
      loadTexture(albedoName(m), anisotropy),
      loadTexture('clouds.jpg', anisotropy),
      loadTexture('lights.jpg', anisotropy),
      loadTexture('water.png', anisotropy),
    ])
    return new EarthPass(common, { albedo, clouds, lights, water }, m, anisotropy)
  }

  /**
   * The Earth without waiting for its four maps (about 3 MB): the pass exists at once and draws nothing, and `loaded` resolves once the
   * maps are in and the globe is drawn. For a start that cannot have the Earth in its first frame; a start that looks at it uses `load`.
   */
  static loadDeferred(common: Common, date: Date, anisotropy: number): { pass: EarthPass; loaded: Promise<void> } {
    const m = month(date)
    const blank = (): THREE.Texture => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t }
    const blanks = { albedo: blank(), clouds: blank(), lights: blank(), water: blank() }
    const pass = new EarthPass(common, blanks, m, anisotropy)
    pass.texturesReady = false
    const loaded = Promise.all([loadTexture(albedoName(m), anisotropy), loadTexture('clouds.jpg', anisotropy), loadTexture('lights.jpg', anisotropy), loadTexture('water.png', anisotropy)]).then(([albedo, clouds, lights, water]) => {
      const u = pass.uniforms
      const real = { uAlbedo: albedo, uClouds: clouds, uLights: lights, uWater: water }
      for (const [k, t] of Object.entries(real)) { (u[k].value as THREE.Texture).dispose(); u[k].value = t }
      pass.texturesReady = true
      pass.onLoaded?.()
    })
    return { pass, loaded }
  }

  /** Per frame: the moment's geometry as this camera sees it. */
  private ring: boolean | null = null
  /** `?ring=0` switches the refracted ring off; the query string is read once, not per frame. */
  private ringAllowed(): boolean { return this.ring ??= new URLSearchParams(location.search).get('ring') !== '0' }

  update(e: Ephemeris, cam: ViewCamera, tanPerPx: number): void {
    const u = this.uniforms
    const earthPos = e.earthKm.clone().divideScalar(MOON_R_KM)
    const rel = earthPos.clone().sub(cam.pos)
    const dKm = rel.length() * MOON_R_KM
    // A camera inside the Earth has no exterior globe to draw.
    this.enabled = this.texturesReady && dKm > EARTH_R_KM * 1.005
    const m = month(e.date)
    if (m !== this.loadedMonth && m !== this.loadingMonth) {
      this.loadingMonth = m
      loadTexture(albedoName(m), this.anisotropy).then((t) => {
        const old = this.uniforms.uAlbedo.value as THREE.Texture
        this.uniforms.uAlbedo.value = t
        old.dispose()
        this.loadedMonth = m
        this.loadingMonth = -1
        this.onLoaded?.()
      }, () => { this.loadingMonth = -1 })
    }
    if (!this.enabled) return
    ;(u.uTanPerPx as THREE.IUniform).value = tanPerPx
    ;(u.uEarthRel.value as THREE.Vector3).copy(rel)
    const sunFromEarth = e.sunKm.clone().sub(e.earthKm)
    ;(u.uSunE.value as THREE.Vector3).copy(sunFromEarth).normalize()
    ;(u.uSunPos.value as THREE.Vector3).copy(e.sunKm).divideScalar(MOON_R_KM)
    ;(u.uEarthPos.value as THREE.Vector3).copy(earthPos)
    u.uSunTheta.value = Math.asin(SUN_R_KM / e.sunKm.length())
    ;(u.uWorldToEarth.value as THREE.Matrix3).copy(e.earthToWorld).transpose()

    // The Sun's offset from the Earth's centre line, seen from the camera:
    // the refracted ring exists only when the Sun is behind the Earth.
    const sV = e.sunKm.clone().divideScalar(MOON_R_KM).sub(cam.pos).normalize()
    const cHat = rel.clone().normalize()
    const perp = sV.clone().addScaledVector(cHat, -sV.dot(cHat))
    ;(u.uSunPerp.value as THREE.Vector3).copy(perp)
    u.uRingOn.value = perp.length() < 0.03 && sV.dot(cHat) > 0 && this.ringAllowed() ? 1 : 0
    // The Moon can shade the Earth only when the Sun is near it as seen from the Earth.
    const toMoon = e.earthKm.clone().negate().normalize()
    const sep = Math.acos(Math.max(-1, Math.min(1, toMoon.dot(sunFromEarth.clone().normalize()))))
    u.uShadowOn.value = sep < 0.03 ? 1 : 0
    // Level of the maps' mip chain for the pixel's arc on the globe (2048-texel-wide maps).
    const pixelArc = tanPerPx * dKm / EARTH_R_KM
    u.uLod0.value = Math.log2(Math.max(1e-3, pixelArc / (2 * Math.PI / 2048)))
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.enabled) return
    renderer.render(this.scene, this.camera)
  }
}
