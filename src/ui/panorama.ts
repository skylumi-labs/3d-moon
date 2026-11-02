import * as THREE from 'three'
import { APOLLO17_ALSEP, APOLLO17_PANORAMAS, type ApolloPanorama, type PanoramaTier } from '../ground/pano/manifest'
import { choosePanoramaTier } from '../ground/pano/tier'
import { composePanoramaTiles } from '../ground/pano/tileComposer'
import { clampPanoramaHorizontalFov, defaultPanoramaHorizontalFov, panoramaHorizontalFov, panoramaVerticalFov, panPanoramaByProjectedRays } from '../ground/pano/viewRay'
import './panorama.css'
import { trackUsage } from '../usage'

const DEG = Math.PI / 180
const VIEW_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec2 uResolution;
uniform sampler2D uPano;
uniform float uYaw;
uniform float uPitch;
uniform float uTanHalf;
uniform float uField;
uniform float uLeft;
uniform float uK;
uniform float uKind;
uniform float uCenter;
uniform float uScale;
uniform vec3 uTilt;
uniform float uAspect;
out vec4 fragColor;
void main() {
  vec2 screen = gl_FragCoord.xy / uResolution * 2.0 - 1.0;
  vec3 ray = normalize(vec3(screen.x * uTanHalf, screen.y * uTanHalf / uAspect, 1.0));
  float cp = cos(uPitch);
  float sp = sin(uPitch);
  float north = ray.z * cp - ray.y * sp;
  float up = ray.y * cp + ray.z * sp;
  float az = uYaw + atan(ray.x, north);
  float el = asin(clamp(up, -1.0, 1.0));
  float cameraEl = el - (uTilt.x + uTilt.y * cos(az) + uTilt.z * sin(az));
  float turn = mod(az - uLeft + 6.283185307179586, 6.283185307179586);
  float u = turn / uField;
  float row = cameraEl / uK;
  float v = uCenter - (uKind > 0.5 ? tan(row) : row) * uScale;
  // Above the photograph is open sky; below it, extend its last ground row to avoid a grey blank band.
  // The top row is also black: between v = 0 and half a texel the sampler (ClampToEdge, mipmapped) blends the row with the edge and
  // draws a faint dashed line across the sky (V11), so the photograph starts 1.5 texels down.
  float texelV = 1.0 / float(textureSize(uPano, 0).y);
  if (u >= 1.0 || v < 1.5 * texelV) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  // u wraps at the 360 degree seam. Take the screen-space gradient from the variant of u that is continuous there,
  // otherwise the sampler picks the smallest mip for one column of pixels and draws a line at the seam.
  float photoV = clamp(v, 1.5 * texelV, 1.0);
  vec2 uvA = vec2(u, photoV);
  vec2 uvB = vec2(fract(u + 0.5) - 0.5, photoV);
  vec2 gx = dFdx(uvA); vec2 gy = dFdy(uvA);
  vec2 hx = dFdx(uvB); vec2 hy = dFdy(uvB);
  if (abs(hx.x) + abs(hy.x) < abs(gx.x) + abs(gy.x)) { gx = hx; gy = hy; }
  vec3 linear = textureGrad(uPano, uvA, gx, gy).rgb;
  // CanvasTexture is decoded from sRGB by the sampler; the standalone custom
  // shader writes sRGB display values (no Moon exposure/tone mapping).
  vec3 display = mix(12.92 * linear, 1.055 * pow(max(linear, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), linear));
  fragColor = vec4(display, 1.0);
}
`

export interface PanoramaHooks {
  /** Stop the main Moon renderer while this view is shown. */
  onOpen?: () => void
  /** Resume the main Moon renderer after this view is dismissed. */
  onClose?: () => void
  /** The quality class's widest panorama tier (ClassProfile.panoMax); the tier is chosen from the class, not from the user agent. */
  classMaxWidth?: number
}

export interface PanoramaViewer {
  /** Open the viewer on a panorama (default: ALSEP, or the one shown last). */
  open(id?: ApolloPanorama['id']): void
  close(): void
  dispose(): void
  isOpen(): boolean
}

/** A standalone, registered photo view. The caller supplies the Photos entry point in Viewpoints. */
export function mountPanoramaViewer(parent: HTMLElement, hooks: PanoramaHooks = {}): PanoramaViewer {
  let pano: ApolloPanorama = APOLLO17_ALSEP
  const overlay = document.createElement('section')
  overlay.className = 'panorama-viewer'
  overlay.hidden = true
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  
  const canvas = document.createElement('canvas')
  canvas.className = 'panorama-canvas'
    const header = document.createElement('header')
  header.className = 'panorama-header'
  const heading = document.createElement('div')
  heading.className = 'panorama-heading'
  const title = document.createElement('h2')
    const subtitle = document.createElement('p')
    heading.append(title, subtitle)
  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'panorama-close'
  closeButton.textContent = 'Close'
  closeButton.setAttribute('aria-label', 'Close Apollo 17 panorama')
  header.append(heading, closeButton)

  const error = document.createElement('div')
  error.className = 'panorama-error'
  error.hidden = true
  error.setAttribute('role', 'status')
  error.setAttribute('aria-live', 'polite')
  const errorText = document.createElement('span')
  const retryButton = document.createElement('button')
  retryButton.type = 'button'; retryButton.textContent = 'Retry'
  error.append(errorText, retryButton)

  const footer = document.createElement('footer')
  footer.className = 'panorama-footer'
  const hint = document.createElement('span')
  hint.className = 'panorama-hint'
  hint.textContent = 'Drag to look · pinch or scroll to zoom'
  const source = document.createElement('span')
  source.className = 'panorama-credit'
  const creditText = document.createElement('span')
  source.append(creditText)
  const sourceLink = document.createElement('a')
  sourceLink.target = '_blank'; sourceLink.rel = 'noopener noreferrer'
  source.append(' ', sourceLink, ' · ')
  const rightsLink = document.createElement('a')
  rightsLink.href = pano.rightsPage
  rightsLink.target = '_blank'; rightsLink.rel = 'noopener noreferrer'
  rightsLink.textContent = 'NASA media guidelines'
  source.append(rightsLink)
  footer.append(hint, source)
  overlay.append(canvas, header, error, footer)
  parent.append(overlay)

  /** Point the viewer at one panorama: text, aria labels, links and (once the renderer exists) the projection uniforms. */
  const applyPano = (next: ApolloPanorama): void => {
    pano = next
    overlay.setAttribute('aria-label', `Apollo 17 ${pano.name} photograph`)
    canvas.setAttribute('aria-label', `Drag to look around the Apollo 17 ${pano.title} panorama`)
    overlay.dataset.panorama = pano.id
    title.textContent = pano.title
    subtitle.textContent = pano.subtitle
    creditText.textContent = `${pano.credit}`
    sourceLink.href = pano.sourcePage
    sourceLink.textContent = pano.imageId
    if (material) {
      const u = material.uniforms
      u.uField.value = pano.projection.horizontalFovDeg * DEG
      u.uLeft.value = pano.projection.leftAzDeg * DEG
      u.uK.value = pano.projection.verticalScale
      u.uKind.value = pano.projection.kind === 'cylindrical' ? 1 : 0
      u.uCenter.value = pano.projection.centerRow
      u.uTilt.value.set(pano.projection.elevationOffsetDeg.constant * DEG, pano.projection.elevationOffsetDeg.cosAz * DEG, pano.projection.elevationOffsetDeg.sinAz * DEG)
    }
  }

  let renderer: THREE.WebGLRenderer | null = null
  let material: THREE.ShaderMaterial | null = null
  let scene: THREE.Scene | null = null
  let camera: THREE.OrthographicCamera | null = null
  let texture: THREE.Texture | null = null
  let loading: Promise<void> | null = null
  let texturePano = ''
  let frame = 0
  let open = false
  let closeTimer: ReturnType<typeof setTimeout> | null = null
  let revealAfterPaint = false
  let dirty = true
  let yaw = 180 * DEG
  let pitch = 0
  let horizontalFov = 86 * DEG
  let layoutAspect: number | null = null
  let userAdjustedFov = false
  let lastFocus: HTMLElement | null = null
  const pointers = new Map<number, { x: number; y: number }>()
  let dragPoint: { x: number; y: number } | null = null
  let pinch: { distance: number; fov: number } | null = null

  const invalidate = (): void => {
    dirty = true
    if (open && !frame) frame = requestAnimationFrame(draw)
  }

  const setStatus = (message: string | null): void => {
    error.hidden = !message
    errorText.textContent = message ?? ''
    retryButton.hidden = !message || message.startsWith('Loading')
  }

  const currentTier = (): PanoramaTier => {
    const max = renderer?.capabilities.maxTextureSize ?? 8192
    return choosePanoramaTier(pano.tiers, {
      maxTextureSize: max,
      coarsePointer: matchMedia('(pointer: coarse)').matches,
      deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
      maxWidth: hooks.classMaxWidth,
    })
  }

  const ensureRenderer = (): void => {
    if (renderer) return
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    renderer.setClearColor(0x000000, 1)
    material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: VIEW_FRAGMENT,
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) }, uPano: { value: null }, uAspect: { value: 1 },
        uYaw: { value: yaw }, uPitch: { value: pitch }, uTanHalf: { value: Math.tan(horizontalFov / 2) },
        uField: { value: pano.projection.horizontalFovDeg * DEG },
        uLeft: { value: pano.projection.leftAzDeg * DEG },
        uK: { value: pano.projection.verticalScale },
        uKind: { value: pano.projection.kind === 'cylindrical' ? 1 : 0 },
        uCenter: { value: pano.projection.centerRow },
        uScale: { value: 1 / (currentTier().height / currentTier().width * pano.projection.horizontalFovDeg * DEG) },
        uTilt: { value: new THREE.Vector3(
          pano.projection.elevationOffsetDeg.constant * DEG,
          pano.projection.elevationOffsetDeg.cosAz * DEG,
          pano.projection.elevationOffsetDeg.sinAz * DEG,
        ) },
      },
      depthTest: false, depthWrite: false,
    })
    scene = new THREE.Scene()
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    scene.add(new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1, -1, 0), new THREE.Vector3(3, -1, 0), new THREE.Vector3(-1, 3, 0),
    ]), material))
    resize()
  }

  const resize = (): void => {
    if (!open || !renderer || !material) return
    renderer.setSize(Math.max(1, overlay.clientWidth), Math.max(1, overlay.clientHeight), false)
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    const aspect = size.x / Math.max(1, size.y)
    if (layoutAspect === null) horizontalFov = defaultPanoramaHorizontalFov(aspect)
    else if (Math.abs(aspect - layoutAspect) > 0.01) {
      horizontalFov = userAdjustedFov
        ? clampPanoramaHorizontalFov(panoramaHorizontalFov(panoramaVerticalFov(horizontalFov, layoutAspect), aspect), aspect)
        : defaultPanoramaHorizontalFov(aspect)
    }
    layoutAspect = aspect
    material.uniforms.uResolution.value.copy(size)
    material.uniforms.uAspect.value = aspect
    invalidate()
  }

  const setFov = (value: number): void => {
    const aspect = layoutAspect ?? overlay.clientWidth / Math.max(1, overlay.clientHeight)
    horizontalFov = clampPanoramaHorizontalFov(value, aspect || 1)
    userAdjustedFov = true
    invalidate()
  }

  const draw = (): void => {
    frame = 0
    if (!open || !dirty || !texture || !renderer || !scene || !camera || !material) return
    dirty = false
    material.uniforms.uYaw.value = yaw
    material.uniforms.uPitch.value = pitch
    material.uniforms.uTanHalf.value = Math.tan(horizontalFov / 2)
    // Read by the GPU rig's panorama check: the view direction in degrees.
    overlay.dataset.yaw = String(((yaw / DEG) % 360 + 360) % 360)
    overlay.dataset.pitch = String(pitch / DEG)
    overlay.dataset.fov = String(horizontalFov / DEG)
    renderer.render(scene, camera)
    if (revealAfterPaint) {
      revealAfterPaint = false
      requestAnimationFrame(() => { if (open) overlay.classList.add('is-visible') })
    }
  }

  const loadTexture = async (): Promise<void> => {
    ensureRenderer()
    const requested = pano
    const tier = currentTier()
    if (texture && texturePano === pano.id && (texture.image as HTMLCanvasElement).width === tier.width) return
    texture?.dispose()
    texture = null
    setStatus('Loading the Apollo 17 photograph…')
    const tex = await composePanoramaTiles(tier, pano.id, undefined, pano.projection.horizontalFovDeg >= 360)
    if (!open || pano !== requested) { tex.dispose(); if (!open) setStatus(null); return }
    texture = tex
    texturePano = pano.id
    if (material) {
      material.uniforms.uPano.value = tex
      material.uniforms.uScale.value = 1 / (tier.height / tier.width * pano.projection.horizontalFovDeg * DEG)
    }
    setStatus(null)
    invalidate()
  }

  const beginLoad = (): void => {
    if (loading) return
    loading = loadTexture().catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : 'The photograph could not load.'
      setStatus(`${message} You can retry or open the NASA source.`)
      revealAfterPaint = false
      requestAnimationFrame(() => { if (open) overlay.classList.add('is-visible') })
    }).finally(() => { loading = null })
  }

  const close = (): void => {
    if (!open) return
    open = false
    document.removeEventListener('keydown', onKeyDown, true)
    overlay.classList.remove('is-visible')
    overlay.classList.add('is-closing')
    hooks.onClose?.()
    if (closeTimer) clearTimeout(closeTimer)
    const duration = getComputedStyle(overlay).transitionDuration.split(',')[0].trim()
    const durationMs = duration.endsWith('ms') ? parseFloat(duration) : parseFloat(duration) * 1000
    closeTimer = setTimeout(() => {
      overlay.hidden = true
      overlay.classList.remove('is-closing')
      closeTimer = null
    }, durationMs)
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    pointers.clear(); dragPoint = null; pinch = null
    if (texture) {
      texture.dispose()
      const image = texture.image as HTMLCanvasElement
      image.width = image.height = 1
      texture = null
      if (material) material.uniforms.uPano.value = null
    }
    lastFocus?.focus()
  }

  function onKeyDown(event: KeyboardEvent): void {
    event.stopPropagation()
    if (event.key === 'Tab') {
      const focusable = [...overlay.querySelectorAll<HTMLElement>('button:not([hidden]), a[href]:not([hidden])')]
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (!first || !last) return
      if (!overlay.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      return
    }
    if (event.key === 'Escape') { event.preventDefault(); close() }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); yaw += horizontalFov * 0.08; invalidate() }
    else if (event.key === 'ArrowRight') { event.preventDefault(); yaw -= horizontalFov * 0.08; invalidate() }
    else if (event.key === 'ArrowUp') { event.preventDefault(); pitch = Math.min(75 * DEG, pitch + 4 * DEG); invalidate() }
    else if (event.key === 'ArrowDown') { event.preventDefault(); pitch = Math.max(-75 * DEG, pitch - 4 * DEG); invalidate() }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); setFov(2 * Math.atan(Math.tan(horizontalFov / 2) * 0.9)) }
    else if (event.key === '-') { event.preventDefault(); setFov(2 * Math.atan(Math.tan(horizontalFov / 2) / 0.9)) }
  }

  const distanceBetween = (): number => {
    const points = [...pointers.values()]
    if (points.length < 2) return 0
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
  }

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size === 1) dragPoint = { x: event.clientX, y: event.clientY }
    else if (pointers.size === 2) { pinch = { distance: Math.max(1, distanceBetween()), fov: horizontalFov }; dragPoint = null }
  })
  canvas.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return
    const previous = pointers.get(event.pointerId)!
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size >= 2 && pinch) {
      const scale = pinch.distance / Math.max(1, distanceBetween())
      setFov(2 * Math.atan(Math.tan(pinch.fov / 2) * scale))
    } else if (dragPoint) {
      const rect = canvas.getBoundingClientRect()
      const ndc = (point: { x: number; y: number }): [number, number] => [
        ((point.x - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        1 - ((point.y - rect.top) / Math.max(1, rect.height)) * 2,
      ]
      const [nextYaw, nextPitch] = panPanoramaByProjectedRays(
        yaw, pitch, ndc(previous), ndc({ x: event.clientX, y: event.clientY }),
        rect.width / Math.max(1, rect.height), Math.tan(horizontalFov / 2),
      )
      yaw = nextYaw
      pitch = THREE.MathUtils.clamp(nextPitch, -75 * DEG, 75 * DEG)
      dragPoint = { x: event.clientX, y: event.clientY }
      invalidate()
    }
  })
  const endPointer = (event: PointerEvent): void => {
    pointers.delete(event.pointerId)
    pinch = pointers.size === 2 ? { distance: Math.max(1, distanceBetween()), fov: horizontalFov } : null
    dragPoint = pointers.size === 1 ? [...pointers.values()][0] : null
  }
  canvas.addEventListener('pointerup', endPointer)
  canvas.addEventListener('pointercancel', endPointer)
  canvas.addEventListener('lostpointercapture', endPointer)
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault()
    setFov(2 * Math.atan(Math.tan(horizontalFov / 2) * Math.exp(event.deltaY * 0.001)))
  }, { passive: false })
  // Close on pointerdown so mobile focus/touch synthesis cannot consume the first tap before a click is produced.
  closeButton.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.preventDefault()
    close()
  })
  closeButton.addEventListener('click', close)
  retryButton.addEventListener('click', beginLoad)
  overlay.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('resize', resize)
  applyPano(pano)

  return {
    open(id) {
      const next = id ? APOLLO17_PANORAMAS.find((p) => p.id === id) : undefined
      if (open && (!next || next === pano)) return
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
      if (next && next !== pano) { applyPano(next); yaw = 180 * DEG; pitch = 0; userAdjustedFov = false; layoutAspect = null; if (open) { loading = null; beginLoad(); resize(); invalidate(); return } }
      open = true
      trackUsage('panorama_open', { id: pano.id })
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
      overlay.style.setProperty('--panorama-transition-ms', `${reduced ? 150 : 700}ms`)
      overlay.classList.remove('is-closing', 'is-visible')
      revealAfterPaint = true
      lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      overlay.hidden = false
      // Escape and the arrows work wherever focus is (a drag on the canvas moves it to the body); the overlay's own listener only hears keys from inside it.
      document.removeEventListener('keydown', onKeyDown, true)
      document.addEventListener('keydown', onKeyDown, true)
      hooks.onOpen?.()
      closeButton.focus()
      resize()
      beginLoad()
      invalidate()
    },
    close,
    isOpen: () => open,
    dispose() {
      close()
      if (closeTimer) clearTimeout(closeTimer)
      window.removeEventListener('resize', resize)
      overlay.removeEventListener('keydown', onKeyDown, true)
      texture?.dispose(); material?.dispose(); renderer?.dispose()
      texture = null; material = null; renderer = null
      overlay.remove()
    },
  }
}
