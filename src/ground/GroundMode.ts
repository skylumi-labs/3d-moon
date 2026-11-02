import { LM_SHADOW_RES } from './lmShadow'
import * as THREE from 'three'
import type { Ephemeris } from '../ephemeris'
import type { ViewCamera } from '../camera/pose'
import type { MoonPass } from '../moon/MoonPass'
import type { PatchLayer } from '../moon/patch/PatchLayer'
import { GroundCamera } from './GroundCamera'
import type { LunarModule } from './LunarModule'
import type { GroundWarmKind } from './warmKinds'
import { LM_DRACO_DIR, LM_MODEL_FILE, takeLanderPreload } from './lmPrefetch'
import { CAMERA_PRESETS, type CameraPreset } from './presets'
import { PAD_DISC_OFF_Z, PLACEMENT_INVALID_Z, fitPlacement, needsRefit, padHasContact, type Placement } from './lmPlacement'
import { span } from '../perf/perf'
import { ABL } from '../abl'
import { PROBE_REACH_M, PointCache, ProbeQueue } from './probeCache'
import { GroundBudget, groundSwitches } from './groundBudget'
import { lmAnisotropy } from './lmMaterials'
import { GroundPass, type GroundSample } from './GroundPass'
import { HAASE_TO_PATCH_EN, LM_HAASE, LM_REPORTED_PITCH_DEG, LM_REPORTED_ROLL_DEG } from './site17'
import { R_M, type FrameAxes, type GroundView, type SiteFrame, enuDir, frameAxes, groundBasis, groundFromView, lonLatAtOffset, makeSiteFrame, offsetEN, viewFromGround } from './frame'
import { compileForTarget } from '../net/compileTarget'

/**
 * Ground mode's owner: the site frame, the ground camera and the ground pass. main.ts asks it for the
 * camera every other pass takes (`viewCamera`), and hands it the scene target to draw the ground into.
 */
/** Mean albedo of the regolith the module's bounce light comes from (the ground pass's own albedo runs 0.05 to 0.13). */
/** The 25 cm tier's filled disc around the module: the mask radius (30 texels of 25 cm) and its feather. */
const FILL_RADIUS_M = 9.5
const GROUND_BOUNCE_ALBEDO = 0.09
/** The budget (`?groundbudget=1`): how long a refit waits for the visitor's input to pause, and how long after an input it counts as active. */
export const REFIT_DEFER_MS = 250
export const INPUT_ACTIVE_MS = 120

const ZERO = new THREE.Vector3()

/** The lighting an ephemeris shows: its date and its Sun direction (a carried ephemeris changes the Sun while the date stays the destination's). */
export function lightingKey(e: Pick<Ephemeris, 'date' | 'sunDir'>): string {
  return `${e.date.getTime()}|${e.sunDir.x}|${e.sunDir.y}|${e.sunDir.z}`
}

export class GroundMode {
  active = false
  readonly frame: SiteFrame
  /** The frame origin's metres east and north of the patch's site point. */
  readonly patchOffEN: [number, number]
  readonly pass: GroundPass
  cam: GroundCamera
  private axes: FrameAxes | null = null
  private axesFor: Ephemeris | null = null
  private readonly probeCache = ABL.has('probe1') ? new PointCache(1, 0.05, Infinity) : new PointCache()
  /** `?gprobe=async` (groundBudget.ts): a height the cache cannot answer is read back through a fence and served from the newest answer within reach meanwhile. */
  readonly asyncProbe: boolean
  private readonly probeQueue = new ProbeQueue((pts) => this.pass.probeBegin(this.renderer, pts))
  /**
   * `?groundbudget=1`: the ground's own motion budget (groundBudget.ts); null when off. It does nothing by itself: main.ts starts a ground gesture on
   * `budget.start(fallback, max)` and feeds it `budget.observe(scale, ms, budgetMs)` per ground frame (the wiring is the PR note, not this file).
   */
  readonly budget: GroundBudget | null
  /** `?grefit=1`: a refit reads its five points in one readback and waits for the visitor's input to pause (refitLm). */
  readonly refitBatch: boolean
  /** When the patch revision the module was placed at first fell behind (`refitBatch` lets the refit wait for the input to pause, at most REFIT_DEFER_MS). */
  private refitDueAt = -1
  private renderer: THREE.WebGLRenderer
  /** The lunar module once its model has loaded and been set on the ground. */
  lm: LunarModule | null = null
  /** A phone class in the native app (main.ts sets it from the quality class and nativeHost): the module's bounce is lit without a PMREM environment (ground/bounceLight.ts). Web browsers keep PMREM. */
  phone = false
  /** Bearing the module's windows face, deg clockwise from north. INFERRED (LANDING-ASSETS.md: the forward hatch and windows face roughly west), not measured. */
  lmHeadingDeg = 270
  /** The camera preset in use (null: free), and whether the origin labels are on. */
  preset: CameraPreset | null = null
  origin = false
  private lmSun: { at: string; share: number } = { at: '', share: 1 }
  /** Which attitude the module is set in: the crew's reported 5 deg nose up and 2 deg left roll (default), or the plane fitted to the 1.5 m terrain model under the pads. */
  lmTilt: 'reported' | 'fit' = 'fit'
  /** Bumped on every placement: with the Sun's time it is the key the shadow maps are redrawn on. */
  private placeVer = 0
  /** The patch's height revision at the last placement (see `refitLm`). */
  private refitRev = -1
  /** When a descent flight last set the module's pose (the refit waits for it). */
  private flightAt = -1e9
  private shadowKey = ''
  private shadowValid = false
  private cpuRay: THREE.Raycaster | null = null
  /** The tilt the 1.5 m terrain model alone would give (degrees), for the label when the reported one is drawn. */
  lmFit = { pitchDeg: 0, rollDeg: 0 }
  /** The model's own size, metres (measured from its geometry). */
  lmSizeM = { heightM: 0, spanM: 0 }
  /** Metres from the camera to what the view centre looks at (null: sky). Refreshed at 5 Hz by a one-ray probe. */
  rangeM: number | null = null
  private rangeAt = -1e9
  onChange: () => void = () => {}
  /** The patch the ground is drawn from (its max grid feeds the hit). */
  private readonly patch: PatchLayer

  constructor(renderer: THREE.WebGLRenderer, moon: MoonPass, lonSpan: number, mapWidth: number, patch: PatchLayer, private readonly lmShadowRes: number = LM_SHADOW_RES) {
    this.renderer = renderer
    this.patch = patch
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    // The module and the Sun hold still between date changes and placements: redraw the shadow maps only then (render()).
    renderer.shadowMap.autoUpdate = false
    const site = patch.manifest.site
    // The frame's origin is the lunar module: the patch site plus its offset, then the Haase shift into the patch's frame.
    const [e0, n0] = offsetEN(site.lon, site.lat, LM_HAASE.lon, LM_HAASE.lat)
    this.patchOffEN = [e0 + HAASE_TO_PATCH_EN[0], n0 + HAASE_TO_PATCH_EN[1]]
    const ll = lonLatAtOffset(site.lon, site.lat, this.patchOffEN[0], this.patchOffEN[1])
    this.frame = makeSiteFrame(ll.lon, ll.lat, site.groundM)
    this.pass = new GroundPass(moon, lonSpan, mapWidth)
    const sw = groundSwitches(typeof location === 'undefined' ? '' : location.search)
    this.asyncProbe = sw.asyncProbe
    this.budget = sw.budget ? new GroundBudget() : null
    this.refitBatch = sw.refit
    this.cam = new GroundCamera({ pos: new THREE.Vector3(0, 0, 30), headingDeg: 0, pitchDeg: -20, rollDeg: 0, tanHalf: Math.tan(15 * Math.PI / 180) }, (e, n) => this.groundZ(e, n))
    this.cam.onInput = () => { this.preset = null; this.inputAt = performance.now() }
  }

  /** When the visitor last turned or moved the camera (`cam.onInput`; main.ts wraps the callback and keeps this). */
  private inputAt = -1e9
  /** Whether the visitor is driving the camera now: an input in the last INPUT_ACTIVE_MS, or a step that moved it (a glide, held keys). */
  private inputActive(now: number): boolean { return now - this.inputAt < INPUT_ACTIVE_MS || this.cam.moved }

  axesAt(e: Ephemeris): FrameAxes {
    if (this.axesFor !== e || !this.axes) { this.axes = frameAxes(e, this.frame); this.axesFor = e }
    return this.axes
  }

  /**
   * Frame height (metres) of the ground at (e, n): probed on the GPU, cached for the last 8 points while the query stays within 5 cm of one.
   * With `asyncProbe`, a miss that has an answer within PROBE_REACH_M is served that answer while the asked point is read back through a fence
   * (collected by `pollProbes`); only a miss with nothing that near waits for the GPU. The one exception is the camera's own point during a glide: its
   * height is not set from it then (`GroundCamera.step` returns before `follow`), only the HUD reads it, so any cached answer serves. Every other ask
   * (a viewpoint's landing view, the module's pads and contact discs, `fillInView`) keeps the 20 cm reach, so a destination tens of metres away is exact.
   */
  groundZ(e: number, n: number): number {
    const hit = this.probeCache.get(e, n, performance.now())
    if (hit !== null) return hit
    if (this.asyncProbe) {
      const own = this.cam.gliding && Math.hypot(e - this.cam.view.pos.x, n - this.cam.view.pos.y) <= PROBE_REACH_M
      const near = this.probeCache.nearest(e, n, own ? Infinity : PROBE_REACH_M)
      if (near !== null) { this.probeQueue.ask(e, n); return near }
    }
    const s = span('ground.probe', () => this.pass.probe(this.renderer, [[e, n]]))
    if (!s) return -1e6
    const z = this.frameZ(e, n, s[0])
    // The synchronous read may stall; begin the full TTL when its result is actually cached.
    this.probeCache.set(e, n, z, performance.now())
    return z
  }

  /** A probed sample's height over the sphere as a frame height (the frame is a tangent plane at the origin). */
  private frameZ(e: number, n: number, s: GroundSample): number { return s.h - this.frame.h0M - (e * e + n * n) / (2 * (R_M + this.frame.h0M)) }

  /** Reads several points in ONE readback and caches them (the budget's refit: nine separate asks were nine stalls, #65 measured each at 12 ms on the rig). */
  private prefetchZ(pts: ReadonlyArray<readonly [number, number]>): void {
    const s = span('ground.probe', () => this.pass.probe(this.renderer, pts))
    if (!s) return
    const now = performance.now()
    s.forEach((smp, i) => this.probeCache.set(pts[i][0], pts[i][1], this.frameZ(pts[i][0], pts[i][1], smp), now))
  }

  /**
   * Collects the fence read that landed, if one did (`asyncProbe`; a no-op otherwise): the heights go into the cache, the Sun-share ask into `lmSun`,
   * and the waiting asks go out. A read asked before the cache was last cleared (a refit, `enter`) is dropped: it was answered by the old terrain.
   * Call it BEFORE the camera steps (main.ts, right before `groundMode.cam.step`), so the step's own asks find the heights that just arrived: `update`
   * calls it too, but by then the step has moved the camera and asked. A landed read that changes what is drawn (the module's lighting, the height
   * under the camera) asks for a frame (`onChange`), since nothing else would redraw a page at rest.
   */
  pollProbes(now = performance.now()): void {
    if (!this.asyncProbe) return
    const s = this.pass.probePoll(this.renderer)
    if (!s) return
    const ask = this.probeQueue.landed()
    if (!ask) return
    let changed = false
    ask.pts.forEach((p, i) => {
      if (!s[i]) return
      const z = this.frameZ(p[0], p[1], s[i])
      const before = this.probeCache.nearest(p[0], p[1], PROBE_REACH_M)
      this.probeCache.set(p[0], p[1], z, now)
      // The height under the camera arrived (or moved by more than a centimetre from what was served): the eye follows it on the next step.
      if (Math.hypot(p[0] - this.cam.view.pos.x, p[1] - this.cam.view.pos.y) <= PROBE_REACH_M && (before === null || Math.abs(before - z) > 0.01)) changed = true
    })
    if (ask.sun >= 0 && s[ask.sun] && s[ask.sun].lit !== this.lmSun.share) { this.lmSun.share = s[ask.sun].lit; changed = true }
    if (changed) this.onChange()
  }

  sample(pts: ReadonlyArray<readonly [number, number]>): GroundSample[] | null {
    return this.pass.probe(this.renderer, pts)
  }

  /** Takes over from a world-frame camera (the orbital rig's) with the same position, orientation and field. */
  enter(e: Ephemeris, cam: ViewCamera): void {
    const g = groundFromView(this.axesAt(e), cam)
    this.cam.view = g
    this.cam.cancelGlide()
    this.probeCache.clear()
    this.probeQueue.drop()
    this.active = true
  }

  leave(): void { this.active = false; this.pass.releaseBake() }

  /** A world-frame camera as a ground view (for a rate between two frames), without entering. */
  viewOf(e: Ephemeris, cam: ViewCamera): GroundView {
    return groundFromView(this.axesAt(e), cam)
  }

  /** The camera every other pass takes. */
  viewCamera(e: Ephemeris): ViewCamera {
    return viewFromGround(this.axesAt(e), this.cam.view)
  }

  /** Glides to a preset camera. False until the module is loaded and placed. */
  goPreset(id: string, now: number, ms = 2200): boolean {
    const pr = CAMERA_PRESETS.find((p) => p.id === id)
    if (!this.lm || !pr) return false
    this.cam.glideTo(this.lm.presetView(pr), now, ms)
    this.preset = pr
    return true
  }

  view(): GroundView { return this.cam.view }

  update(e: Ephemeris, aspect: number, now = performance.now()): void {
    // The reads that landed (a second poll in a frame is a no-op): main.ts polls before the camera steps; this catches a frame that did not.
    this.pollProbes(now)
    this.pass.setSiteMax(this.patch.siteMax)
    this.pass.update({ frame: this.frame, axes: this.axesAt(e), ephem: e, view: this.cam.view, patchOffEN: this.patchOffEN, aspect })
    // The baked near field follows the camera while the ground is drawn (a no-op without ?near=photo); its targets are freed on leaving.
    if (this.active) this.pass.updateBake(this.renderer, this.cam.view.pos.x, this.cam.view.pos.y)
    this.refitLm(now)
    if (this.active) {
      // Never wait for the GPU here: the one-ray range is read back through a fence, collected on a later frame, and the next one starts 200 ms after the last.
      const r = this.pass.rangePoll(this.renderer)
      if (r !== undefined) this.rangeM = r
      if (!this.pass.rangePending && now - this.rangeAt > 200) { this.rangeAt = now; this.pass.rangeBegin(this.renderer) }
    }
  }

  /** Compiles the three ground shaders in the background once the patch is ready, so the first ground frame does not stall on it. */
  warm(between?: () => Promise<void>, kinds?: readonly GroundWarmKind[]): Promise<void> { return this.pass.warm(this.renderer, between, kinds) }

  /** The module's materials are the standard PBR program (the phone-class knob, `lmMaterialLite`); main sets it from the class and `?lmmat=` before the first load. */
  lmLite = false
  /** The module shadows itself (lmShadow.ts lmSelfShadow; main.ts sets it from the shell and the GPU). */
  lmSelfShadow = true

  /** Loads the NASA model and sets it on the fused ground (needs the ground pass ready: the patch loaded). The mesh code is a separate chunk. */
  async loadLm(e: Ephemeris, aspect: number): Promise<void> {
    if (this.lm) return
    const base = import.meta.env.BASE_URL
    const { LunarModule: LM } = await import('./LunarModule')
    // The module the prefetch window already parsed and linked (lmPrefetch.startLanderPreload), else load it here as before.
    const pre = takeLanderPreload<LunarModule>()
    const preloaded = pre ? await pre : null
    const lm = preloaded ?? await LM.load(`${base}${LM_MODEL_FILE}`, `${base}${LM_DRACO_DIR}`, this.lmShadowRes, { phone: this.phone, lite: this.lmLite, selfShadow: this.lmSelfShadow })
    if (this.lm) { lm.dispose(); return }
    // The model's textures at the GPU's anisotropy (16 at most) before the first draw: the preload path builds the module without a renderer (complaint 13).
    lm.setAnisotropy(lmAnisotropy(this.renderer.capabilities.getMaxAnisotropy()))
    this.lm = lm
    // Link the module's programs (PBR, foil normal maps, the shadow depth variant) in the background, so the first view of it does not stall.
    if (!preloaded) void compileForTarget(this.renderer, lm.scene, lm.camera).catch(() => undefined)
    const box = new THREE.Box3().setFromObject(lm.model)
    this.lmSizeM = { heightM: box.max.y - box.min.y, spanM: 2 * 2.76 * Math.SQRT2 + 0.9 }
    // The ground pass's uniforms (site, offset, Sun) are set per frame while active; a preload before the first ground frame needs them for its probes.
    this.update(e, aspect)
    this.placeLm()
    this.onChange()
  }

  /** The placement the ground heights now give: attitude reported or fitted, height so no pad is under the ground. */
  private computePlacement(lm: LunarModule): { p: Placement; fit: Placement } {
    const gz = (e: number, n: number): number => this.groundZ(e, n)
    const p = fitPlacement(lm.pads, this.lmHeadingDeg, gz, this.lmTilt === 'reported' ? { attitude: { pitchDeg: LM_REPORTED_PITCH_DEG, rollDeg: LM_REPORTED_ROLL_DEG } } : {})
    const fit = this.lmTilt === 'fit' ? p : fitPlacement(lm.pads, this.lmHeadingDeg, gz)
    return { p, fit }
  }

  /** Sets the module on the ground: attitude reported or fitted, height so none is under it. The four pad heights are read here, and again when finer heights arrive (`refitLm`). */
  placeLm(): void {
    const lm = this.lm
    if (!lm) return
    const { p, fit } = this.computePlacement(lm)
    lm.setPlacement(p)
    this.lmFit = { pitchDeg: fit.pitchDeg, rollDeg: fit.rollDeg }
    this.placeVer++
    this.feedPads()
    this.refitRev = this.patch.revision
  }

  /**
   * Re-sits the module when finer heights have arrived under its footprint, so the pads end on the final ground (feedback 2026-10-14: the lander looked stuck
   * in the ground). It snaps, in the frame the ground pass draws the new heights, so the pads never lag the terrain. Waits while a descent flight drives the pose.
   */
  private refitLm(now: number): void {
    const lm = this.lm
    if (!lm || !needsRefit(this.refitRev, this.patch.revision, lm.placement.z, now - this.flightAt)) { this.refitDueAt = -1; return }
    if (this.refitBatch) {
      // `?grefit=1`: current input first. A refit while the camera is being moved waits for the input to pause, at most REFIT_DEFER_MS, so its one
      // readback (below) does not land inside a walk or a look.
      if (this.refitDueAt < 0) this.refitDueAt = now
      if (this.inputActive(now) && now - this.refitDueAt < REFIT_DEFER_MS) return
    }
    // Finer heights: everything cached and every read in flight was answered by the old terrain.
    this.probeCache.clear()
    this.probeQueue.drop()
    // `?grefit=1`: the origin and the four pads in one readback, so the placement's asks (the pads at each attitude iteration, then the contact discs,
    // all within the cache's 5 cm of these) hit the cache instead of each waiting for the GPU.
    if (this.refitBatch) this.prefetchZ([[0, 0], ...lm.pads.map((pad) => { const f = lm.toFrame(pad); return [f.x, f.y] as const })])
    if (this.groundZ(0, 0) < PLACEMENT_INVALID_Z) return   // the ground pass cannot answer yet: try again next frame
    this.placeLm()
    this.onChange()
  }

  setTilt(mode: 'reported' | 'fit'): void {
    if (this.lmTilt === mode) return
    this.lmTilt = mode
    this.placeLm()
    this.onChange()
  }

  /**
   * Flight (G2b), ground regime: the module's pose from the descent track (frame ENU, body to ENU). The shadow maps are redrawn every frame it moves,
   * and the pad contact discs are used only in the last metres (their ground heights are GPU probes).
   */
  setFlight(pos: THREE.Vector3, bodyToEnu: THREE.Quaternion, padsOn: boolean): void {
    const lm = this.lm
    if (!lm) return
    lm.setFlightPose(pos, bodyToEnu, ZERO)
    this.flightAt = performance.now()
    this.placeVer++
    if (padsOn) this.feedPads()
    else this.pass.lm.padOn.value = 0
  }

  /** Flight, settling after the camera is released: the track's pose blended into the G1 placement (`k` 1 = rest). `placeLm` must have run. */
  setSettle(pos: THREE.Vector3, bodyToEnu: THREE.Quaternion, k: number): void {
    const lm = this.lm
    if (!lm) return
    lm.setFlightPoseBlend(pos, bodyToEnu, k)
    this.flightAt = performance.now()
    this.placeVer++
    this.feedPads()
  }

  /** Flight, orbit regime: the ground pass is not drawn; the module is drawn over the Moon pass, positions relative to the camera (`rebase`). */
  renderFlightLm(e: Ephemeris, aspect: number, preExpose: number, view: GroundView, pos: THREE.Vector3, bodyToEnu: THREE.Quaternion): void {
    const lm = this.lm
    if (!lm) return
    lm.setFlightPose(pos, bodyToEnu, view.pos)
    const sunL = enuDir(this.axesAt(e), e.sunDir)
    lm.updateLight(sunL, preExpose, 1)
    lm.setBounce(this.renderer, GROUND_BOUNCE_ALBEDO * Math.max(sunL.z, 0) * 0.7)
    this.renderer.shadowMap.needsUpdate = true
    lm.render(this.renderer, { ...view, pos: new THREE.Vector3() }, aspect)
  }

  /** The module's frame position and the ground under each pad, for the ground pass's contact shadows. Read at placement, not per frame. */
  private feedPads(): void {
    const lm = this.lm
    if (!lm) return
    const u = this.pass.lm
    lm.pads.forEach((pad, i) => {
      const f = lm.toFrame(pad)
      // A pad with clearance keeps no sky from the ground under it: its disc would be a second shadow from nothing, so it is moved out of range.
      ;(u.pads.value as THREE.Vector3[])[i].set(f.x, f.y, padHasContact(lm.placement.clearanceM[i]) ? this.groundZ(f.x, f.y) : PAD_DISC_OFF_Z)
    })
    u.padOn.value = 1
    u.padR.value = 1.1
  }

  /** True when any of the filled disc of the 25 cm tier (the module's footprint) is inside the camera's frame. */
  fillInView(aspect: number): boolean {
    const lm = this.lm
    if (!lm) return false
    const c = lm.toFrame(new THREE.Vector3(0, 0, 0))
    const v = this.cam.view
    const b = groundBasis(v)
    const d = new THREE.Vector3(c.x - v.pos.x, c.y - v.pos.y, this.groundZ(c.x, c.y) - v.pos.z)
    const dist = d.length()
    if (dist < FILL_RADIUS_M) return true
    const back = d.dot(b.back)
    if (back >= 0) return false
    const rho = FILL_RADIUS_M / dist
    return Math.abs(d.dot(b.right) / -back) < v.tanHalf * aspect + rho && Math.abs(d.dot(b.up) / -back) < v.tanHalf + rho
  }

  /** The module's shadow at a ground point by ray casting the mesh toward the Sun on the CPU (debug and tests: what the shadow map should say). 1 light, 0 shadow. */
  lmShadeCpu(e: number, n: number, sunL: THREE.Vector3): number {
    const lm = this.lm
    if (!lm) return 1
    if (!this.cpuRay) this.cpuRay = new THREE.Raycaster()
    const z = this.groundZ(e, n) + 0.02
    this.cpuRay.set(new THREE.Vector3(e, z, -n), new THREE.Vector3(sunL.x, sunL.z, -sunL.y).normalize())
    this.cpuRay.far = 200
    ;(this.cpuRay as unknown as { firstHitOnly: boolean }).firstHitOnly = true
    return this.cpuRay.intersectObject(lm.root, true).length ? 0 : 1
  }

  /** The Sun's direction in the frame for the date on screen. */
  sunInFrame(e: Ephemeris): THREE.Vector3 { return enuDir(this.axesAt(e), e.sunDir) }

  render(e: Ephemeris, aspect: number, preExpose: number): void {
    const lm = this.lm
    const sunL = enuDir(this.axesAt(e), e.sunDir)
    if (lm) {
      // Keyed on the lighting, not only the date: a pick's date carry (journey/ephemCarry.ts) moves the Sun under one date.
      const t = lightingKey(e)
      if (this.lmSun.at !== t) {
        // The async path keeps the last share until the fence read lands (collectProbes); a time scrub then costs no stall per frame.
        if (this.asyncProbe) { this.lmSun.at = t; this.probeQueue.askSun() }
        else {
          const s = this.pass.probe(this.renderer, [[0, 0]])
          this.lmSun = { at: t, share: s ? s[0].lit : 1 }
        }
      }
      lm.updateLight(sunL, preExpose, this.lmSun.share)
      // The ground the module's underside sees is lit by this Sun: mean albedo 0.09, cosine of the Sun, x0.7 for the phase (I/F, modelled).
      lm.setBounce(this.renderer, GROUND_BOUNCE_ALBEDO * Math.max(sunL.z, 0) * 0.7 * this.lmSun.share)
      const key = `${t}|${this.placeVer}`
      if (key !== this.shadowKey) {
        // Sun or placement changed: redraw the ground pass's depth map and three's own self-shadow map, once.
        lm.renderShadow(this.renderer)
        this.renderer.shadowMap.needsUpdate = true
        this.shadowKey = key
        this.shadowValid = true
        const u = this.pass.lm
        u.shadow.value = lm.shadowTarget.depthTexture
        u.shadowM.value.copy(lm.shadowMatrix())
      }
      // Never read a depth map nothing has drawn into.
      this.pass.lm.shadowOn.value = this.shadowValid && this.lmSun.share > 0.01 ? 1 : 0
    }
    this.pass.render(this.renderer)
    lm?.render(this.renderer, this.cam.view, aspect)
  }

  renderMetadata(aspect: number): void {
    this.pass.renderMetadata(this.renderer)
    this.lm?.renderMetadataOcclusion(this.renderer, this.cam.view, aspect)
  }

  dispose(): void { this.lm?.dispose(); this.pass.dispose(this.renderer) }
}
