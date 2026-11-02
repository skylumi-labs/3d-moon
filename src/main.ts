import { mountReviewLabel } from './ui/reviewLabel'
import { handleMemoryWarning } from './native/memoryWarning'
import { PRESSURE_PENDING_MS, pressureStep, tileRebuildLayers } from './quality/pressure'
import {
  GROW_CLASSES, GROW_HEADROOM_BYTES, cachegrowOff, clearRunning, growPoll, learnSize, maxFor, patchRoom, setRunning, startFromStorage, writeRemembered, type GrowState,
} from './quality/cachegrow'
import { PATCH_DEFAULT_BYTES, SAFETY_BYTES } from './quality/enforce'
import { TILE_PAIR, newOverrunWatch, overrunPoll, shedPlan } from './quality/enforce'
import { linkRoute, warmLinkSteps } from './native/deepLink'
import { planFly, type FlyEnd } from './journey/path'
import { journeyClockStart, leadStartRate, stallShift, type PoseRate } from './journey/join'
import { TOUR_CLAIMS } from './journey/claims'
import { JourneyLifecycle, ORBIT_SECONDS, orbitAngleDeg } from './journey/lifecycle'
import { validateCalibration, type VisibilityCalibration } from './post/visibility'
import * as THREE from 'three'
import { SUN_R_KM } from './lighting/solar'
import { EARTH_R_KM, MOON_R_KM, commonUniforms } from './glsl/common'
import { type Ephemeris, ephemerisAt as clockEphemerisAt, isWaxing } from './ephemeris'
import { MOON_TURN_PITCH_MAX, MoonSurfaceTurn, turnEphemeris } from './camera/moonTurn'
import { IntroController, type IntroHost } from './intro/controller'
import { openingPrefetchTargets } from './intro/openings'
import { introWanted, stripOverlayParams } from './intro/parse'
import { mountLoadingLine } from './intro/splash'
import { SCRUB_SEARCH_REUSE_MS, ScrubGate } from './scrub'
import { type MoonMaps, type HeightMap, loadMoonMaps, loadMoonMapsColorFirst, loadHeight } from './moon/maps'
import { MoonPass } from './moon/MoonPass'
import { getShadowMode, onShadowModeChange } from './moon/shadowMode'
import { accountShadowFrame, bodyFrameSunEpoch, cacheBuildMotion, cacheReadDuringMotion, parseShadowPolicy, shadowCoverageStats } from './moon/shadowPolicy'
import { parseShadowDebug, serveShares, summariseServe, summariseCount, countDebugOn, VIS_DBG_VALUE, W_DBG_VALUE, SERVE_DBG_VALUE, BOUND_DBG_VALUE, VIEW_BOUND_DBG_VALUE } from './moon/shadowServe'
import { GlobalHorizonCache } from './moon/tiles/GlobalHorizonCache'
import { SunHorizonBake } from './moon/tiles/SunHorizonBake'
import { sunBakeOn } from './moon/sunHorizon'
import { envHistogram, envProbePoint, ghCacheOn, ghUv, tenvOn } from './moon/globalHorizon'
import { TileEnvelope } from './moon/tiles/TileEnvelope'
import { MOTION_TERRAIN_ITER, termAaFactor } from './moon/moonShader'
import type { HorizonMode } from './moon/horizon'
import { ledger } from './quality/ledger'
import { StarPass } from './sky/stars'
import { STAR_BOOST_CAP_SHARE, boostGain, loadBoost, loadStarLiftFloor, saveBoost } from './sky/starBoost'
import { skyCullGain, skyStarGain } from './sky/skyStars'
import { debugEnabled } from './debug/gate'
import { mountDebugSheet, type DebugSheetApi } from './ui/debugSheet'
import { TargetCache } from './post/targets'
import { dprFor, mayChooseRestRatio, motionDprCapFromSearch, motionDprFor, PHONE_REST_FACTOR_MIN, RestDprGovernor, restGovernorOn, restRatioAfterFold } from './quality/dpr'
import { FrameGate, frameCapFps } from './quality/frameCap'
import { flightHzOn } from './moon/horizon'
import { SHARP_EMERGENCY_FLOOR, SHARP_FLIGHT_MAX, flightGridIsOnlyScale, flightScaleModeFor, measuredGridFor, setMeasuredGrid, sharpFlightGrid, sharpFlightStart, sharpGridSource } from './quality/sharp'
import { FlightPrep, PREP_MAX_MS, PREP_MAX_MS_COLD, PREP_TEXT, SharpWarm, prepPoseUs, prepWanted, warmPoseUs } from './quality/sharpPrep'
import { fadeCadenceMs } from './moon/tiles/fades'
import { fitLayers } from './quality/startupClass'
import { applyShadowMode, describeQuality, motionKnobs, motionShaderFor } from './quality/apply'
import { FlightScaleLadder } from './quality/flightScale'
import { MOTION_POLICY_KEY, SharpPacer, constResMotionOn, isDownscaled, motionPolicy, phoneMotionOn, renderDims, resolveMotionPolicy, setMotionPolicy, sharpMotionOn, type MotionPolicy } from './quality/sharpMotion'
import { FracStats, PhonePacer, motionPxCapFor, phoneForcedF, phoneForcedHz, phoneMoment, phoneRestSample, sharpParamsFor } from './quality/phoneSharp'
import { getQuality, isExplicit, onQualityChange } from './quality/settings'
import { mountQualitySheet } from './ui/quality'
import { showGpuRetry } from './ui/gpuResetCard'
import { lmSelfShadow } from './ground/lmShadow'
import { lossExit, probeWebGL2, START_MESSAGE } from './quality/gpuReset'
import { FocusScreenDriver } from './post/focusScreenDriver'
import { focusPullOn } from './moon/tiles/focusPull'
import { reducedReasons } from './quality/reduced'
import { HEALTHY_RESET_MS, LOSS_INFO_KEY, LOST_CEILING_EXPIRES_KEY, LOST_CEILING_KEY, LOST_RELOADS_KEY, RESTORE_NUDGE_MS, ceilingToStore, groundRestDprCap, healthyFrameWindow, healthyResetDue, lostWatchdog, parkTileShadowsInGround, patchBudget, planAfterRestore, prepareLossReload, recoveryIsCurrent, softRecoveryExpired } from './quality/contextRecovery'
import { LAST_VIEW_KEY } from './native/lifecycle'
import { initQuality, memcapOff, mountQualityReadout, type Quality } from './quality/runtime'
import { GlarePass } from './post/glare'
import { FinalPass, REFINE_CROSSFADE_MS } from './post/final'
import { moonGlareScale } from './post/moonGlare'
import { MOTION_STEPS as MOTION_STEPS_START, DEFAULT_MOTION_SCALE, FenceGrid, REFINE_MID_SCALE, bandCount, foldFullCost, predictBandMs, releaseHoldActive, PacingBudget, parsePaceMode, emergencyStep, exposureReusable, exposureWindowMs, ladderStep, needsHandBack, restCatchUpPlan, predictRestMs, foldRestCost, restFrameMs, EMPTY_REST_COST, REST_BUDGET_MS, setFixedShare, measuredStart, motionActive, fullMotionSafe, recentCost, WallLadder, frameBudgetMs, restCostFloor, settleFullAffordable, settleQuietFromSearch, pressYieldActive, wallMemoryFromSearch, wallMemoryHolds, MotionMemory, startFromCostPlan, settleDefers, handBackPlan, BAND_MAX_STEPPED, type FrameCost } from './post/motionGrid'
import { ABL, ABLATE } from './abl'
import { FramePacer } from './post/framePacer'
import { DisplayRate, GpuTimer, PassTimer } from './post/gpuTimer'
import { mountPerfHud } from './post/perfHud'
import { capStep } from './native/frameCap'
import { MOON_PAGE } from './native/deepLink'
import { wireNativeShell } from './native/shell'
import { openOverlay, type OverlayFlags } from './native/back'
import { CoarseGain } from './post/coarseGain'
import { type ExposureView, exposureViewMoveSmall, flightExposureWindowMs, parseFlightExposureMode, useCoarseFlightExposure } from './post/flightExposure'
import { bandMustAbandon, bandStartAllowed } from './post/bandGate'
import { type Ahead, ExposureController, EXP_SNAP_ON, SETTLE_WINDOW_MS, SNAP_SETTLE_WINDOW_MS } from './post/exposureControl'
import { moonSubjectInFrame, sunInFrame } from './post/sunInFrame'
import { stepGlareScale } from './post/glareScale'
import { AHEAD_PER_FRAME_SCRIPTED, AHEAD_S, aheadExposureReusable, aheadMemoMustReset, aheadRefreshSet, sunArrivalAheadS } from './post/aheadPlan'
import { type Exposure, type ExposureInput, EARTH_WHITE_IF, RING_WHITE_IF, SUN_WHITE_IF, coarseCalibrationFor, coarseGainFor,computeExposure as computeExposureRaw, nightFloorShare, setSearchReuseMs, subjectHoldAnchor, whiteTargetIF } from './post/exposure'
import { cachedQuery } from './loop/domCache'
import { mountBrandFade } from './ui/brandFade'
import { lowEndHintDevice, mountLowEndHint } from './ui/lowEndHint'
import { resolvePace } from './loop/paceMode'
import { GroundStillness } from './ground/groundStill'
import { foldGroundSamples } from './ground/groundBudget'
import { IdleGate, WAKE_EVENTS, beatDelay, idleOn, wakeAction } from './loop/idle'
import { moonOffAxis } from './camera/grab'
import { loopErrorCountAfter, loopErrorPlan, loopRetryAction, lossEventIsDuplicate } from './loop/guard'
import { RESUME_CHECK_MS, RESUME_MIN_HIDDEN_MS, classifyResume, moonDiscOnScreen, type ResumeInfo } from './loop/resume'
import { PERF, span, add as perfAdd, endFrame, programCount, report as perfReport } from './perf/perf'
import { CameraRig, type LookTarget, idleOrbitOn } from './camera/rig'
import { attachControls } from './camera/controls'
import { highlightFit } from './labels/highlightFit'
import { HighlightGate, highlightAnimating } from './labels/highlightMotion'
import { CARRY_MAX_MS, CARRY_MIN_MS, EphemCarry, samePicture } from './journey/ephemCarry'
import { AimRelease } from './camera/aimRelease'
import { JOIN_FIX_MS, JOIN_GAP_REPORT, type JoinFix, applyJoinFix, joinFixFor, joinGap } from './journey/joinFix'
import { floorBlendDuration, sampleEffectiveFloorState, sampleFloorBlend, tweenAt, tweenProgress, smoothstep, type FloorBlend, type FlyTween } from './camera/tween'
import { D_MAX, D_MIN, FLY_FOV_DEG, PITCH_MAX, angularDistance, lonLatOfDir, homePose, floorDist, poseFromView, reliefShare, siteAltR, siteGround, type Pose, type ViewCamera, subEarthPose, underCamera, wrapLon } from './camera/pose'
import { feelClockSlip, flightFeelOn } from './journey/feel'
import { MOMENTS, momentById, type Moment } from './moments'
import { EARTH_VIEW_DIST, EARTH_VIEW_FOV_DEG, momentPose } from './momentPose'
import { heightCapacity, heightFloor, heightWantCap, tcCapacity, tileBase, tileCapacity } from './moon/tiles/config'
import type { TileStreamer, StreamView } from './moon/tiles/TileStreamer'
import { finestHeightTexelKm, loadManifest, prefetchAllowed, resolvedManifest, prefetcherFor, type PrefetchTarget } from './net/prefetch'
import { flightPrefetchTargets as buildFlightPrefetchTargets } from './net/flightPrefetch'
import { advanceShadowIdleDraws, shadowMotionForFrame, waitForCaptureReadiness } from './capture/readiness'
import { TILE_PREPARE_DELAY_MS } from './net/tilePrepare'
import { createCompileQueue, precompileSteps } from './net/compileQueue'
import { compileForTarget } from './net/compileTarget'
import { groundWarmKinds } from './ground/warmKinds'
import { patchBase, midPatchBase, patchSamplerBudget } from './moon/patch/config'
import { PatchShadowCache } from './moon/patch/PatchShadowCache'
import type { PatchLayer } from './moon/patch/PatchLayer'
import { PATCH_SITES, PATCH_SITE_LIST, type PatchSite } from './moon/patch/sites'
import { mountTours } from './ui/tours'
import { mountPins, selenoUnit } from './ui/pins'
import { createFirstHotspots, type FirstHotspotsApi } from './ui/firstHotspotsView'
import { hotspotsMode, readRemembered } from './ui/firstHotspots'
import { mountSiteRing, projectWorldPoint } from './ui/siteRing'
import { mountViewpoints } from './ui/viewpoints'
import { mountNavigator, type NavigatorApi } from './ui/navigator'
import { type FlightLeft, type NavAction, PIN_MOMENT, actionKey, firstSentence, resumeProgress } from './viewpointList'
import { NEXT_VIEW_OWNER, capTargets, neighbourPositions, nextViewReady } from './net/nextViewPrefetch'
import { type CancelCause, afterGrab, keepPatchLoad, cancelJourneyAndContinuation, isTap, onCancel, viewpointJourneyBusy } from './journey/cancel'
import { HOTSPOTS, type Hotspot } from './hotspots'
import { HttpError, fetchRetry, progressLine, type ProgressSnapshot } from './net/load'
import { minimalAim, safeRect, subjectFrame, type Occluder } from './ui/layout'
import { EARTH_VIEW_FILL, type EarthFrame } from './camera/pose'
import { mountBar, type BarApi } from './ui/bar'
import { mountCaption, type CaptionApi } from './ui/caption'
import { mountNewMoonNote } from './ui/newMoonNote'
import { mountOfflineNote } from './ui/offlineNote'
import { offlineNoteVisible } from './net/offlineState'
import { NEW_MOON_BELOW, nextLitEvening, utcEveningLabel } from './newMoon'
import { earthShadowOnMoonParts, luminance } from './lighting/shadowMath'
import { Hud, type HudInfo } from './hud'
import { patchIsDrawn } from './patchDrawn'
import { SunPass, SUBJECT_SUN_GLARE } from './sun/SunPass'
import { EarthPass } from './earth/EarthPass'
import { GroundMode } from './ground/GroundMode'
import { NEAR as NEAR_GROUND, NEAR_BAKED, NEAR_LOOK, NEAR_TRACKS } from './ground/nearField'
import { attachGroundControls } from './ground/groundControls'
import { mountGroundUi } from './ui/ground'
import { mountZoomTape, type ZoomTapeApi } from './ui/zoomTape'
import { mountTouchControls, type TouchControlsApi } from './ui/touchControls'
import { homeFollowStep } from './camera/homeFollow'
import { heightAboveSurfaceM, tapeLimitPulse, tapeWakeAllowed } from './ui/zoomScale'
import { windowAvailable } from './ui/flight'
import { DescentPath, HANDOVER_T } from './descent/DescentPath'
import { descentReached } from './descent/reach'
import { landingPose } from './descent/landing'
import { descentRenderPose } from './descent/renderPose'
import { stepClock, clockStepMs } from './descent/clock'
import { LM_DRACO_DIR, LM_MODEL_FILE, discardLanderPreload, lmMaterialLite, momentNeedsLander, prefetchLander, startLanderPreload } from './ground/lmPrefetch'
import { ARRIVAL_HANDOVER_U, ARRIVAL_HOLD_MAX_MS, ARRIVAL_WAIT_MS, arrivalGlideMs, arrivalHoldPose, arrivalPatchDemand, directArrival, enuOfPose, holdLevelsWanted, landingHoldStalled, landingReady, poseVelocityENU } from './descent/arrival'
import { SITE_APEX_DIST, SITE_FUNNEL_DIST, descentDetailResident, floorGuard, funnelAim, gatedU, guardedAim, siteApexDist, stepGate } from './descent/siteDrop'
import { canDrawFinalOnly, DATE_CROSSFADE_MS, dateChangeCrossfades } from './journey/dateTransition'
import { DescentFlight, type FlightFrame, SETTLE_BLEND_S, SETTLE_END_T, HANDOFF_T, lmPoseOf, siteRadius } from './descent/flight'
import type { DescentPath as DescentPathT } from './descent/DescentPath'
import { enuDir, groundBasis, lonLatAtOffset } from './ground/frame'
import { RIDGE_SITE, RIDGE_TIME, type Observer, observerAt, skyState } from './ridge/observer'
import { JOURNEY_SECONDS, type JourneyFrame, endPose, journeyFrame, moonFramedCamera } from './ridge/journey'
import { RidgePass } from './ridge/RidgePass'
import { ridgeExit } from './ridge/exit'
import { refractionArcmin, skyLevelIF, transmission } from './ridge/sky'
import { type JourneyHandle, JourneyScrub, clamp01, progressOfTimed, t0AtProgress } from './journey/scrub'
import { mountJourneyScrub } from './ui/journeyScrub'
import { nextEndingUntil, scrubHandleShown, scrubVisibility } from './ui/journeyScrubVisibility'
import { mountRidgeUi } from './ui/ridge'
import { mountLabels, type ShownLabel } from './ui/labels'
import { CURATED } from './labels/curated'
import { loadGazetteer } from './labels/gazetteerTable'
import { terminatorView, unitOf } from './labels/terminator'
import { tablerIcon } from './ui/tablerIcons'
import { mountCentreCaption, type CentreCaptionUi } from './ui/centreCaption'
import { mountLockLabel, type LockLabelUi } from './ui/lockLabel'
import { labelStyleOf } from './labels/lockLabelCore'
import { CentreCaption, centreDir, type CamSample, type CaptionHost, type ReadResult } from './labels/centreCaptionCore'
import { fallbackHit } from './labels/centrePick'
import { toMoonSample } from './labels/centreSample'
import { VIEWPOINT_FEATURES } from './labels/centreViewpoints'
import { PresentedScene } from './labels/centreScene'
import { mountPanoramaViewer } from './ui/panorama'
import { APOLLO17_PANORAMAS, type ApolloPanorama } from './ground/pano/manifest'
import { sampleGlobalHeightM, radiusAtHeightM } from './labels/surfaceHeight'
import { CaptureClock, ECLIPSE_SUN_BEAT_U, eclipseResumeU, flightAim, getCinematicFlight, getFlight, sampleFlight, sunGaze, type CinematicFlight } from './cinematics/flights'
import { assertCaptureNotCancelled, captureIsInitializing } from './cinematics/captureSession'
import { featureViewDistance } from './labels/framing'
import { mountDebugHeat } from './ui/debugHeat'
import { mountRoutes } from './ui/routes'
import { daylightTarget, lapseApproachMs, lapseClockMs, photoSun } from './routes/daylight'
import { AUTO_RETRY_BUSY_MS, autoRetryDelay, autoRetryVerdict } from './net/autoRetry'
import { ROUTES, type Route, type RouteView, cumulativeKm, flatten, overviewDistFor, routeOwnerCheck, routeShot } from './routes/routes'
import { coverageAlt, coverageRoots, deeperFloorAt, finestRegionAt, loadInternalCoverage, loadRemoteCoverage, pointFloorAt } from './coverage/coverage'
import { shareParams, readShare, sitePin, type ShareStart } from './ui/shareView'
import { trackUsage, setUsageSource } from './usage'
import { creditSurfaceHit, groundCreditTargets, selectCredits, sphereVisibleInFrame, type CreditsContext } from './ui/credits'
import { effectiveFootprintKm, GLOBAL_TEXEL_KM, WANT_TEXELS_FLIGHT, foldRafGap } from './moon/tiles/wanted'
import { tcGain } from './moon/tiles/tcDetail'
import { detailStrength } from './moon/tiles/detail'
import { SITES, type MoonLabel } from './labels/data'

/**
 * The standalone site: the Moon now, full screen, from the Earth's centre;
 * drag to fly around it with the real Sun and Earth.
 *
 * URL: ?t=<ISO UTC> (default now, kept current once a minute)
 *      ?view=earth|fly  ?lon=&lat=&dist=&roll=&pitch= (a fly pose: deg, deg, Moon
 *      radii 3.58 to 30, deg)  ?auto=0 (no idle orbit)  ?still=1 (no HUD,
 *      no idle orbit, every frame at full resolution: captures)
 * Start: ?start=ridge|earth (the default is the ridge opening unless the URL names a time, a view or a moment); ?journey=<0..1> holds the
 * ridge lift-off at that progress (captures).
 * Tiles (milestone 2, closer than 3.58 radii): ?tiles=off|<base url>, ?tilecache=<layers>
 * (moon/tiles/config.ts). Without a tile base the site is exactly milestone 1.
 * Test switches: ?fp16flush=1 zeroes every stored value below half-float's
 * smallest normal number, as many phone and Apple GPUs do, and =2 keeps
 * them only in half-float's subnormal steps; ?preexpose=0 stores raw I/F.
 * Together they reproduce the posterised Moon those GPUs drew before the
 * pre-exposure. ?nosun=1 / ?noearth=1 skip that pass and ?ring=0 the Earth's
 * refracted ring (isolating a pass). ?seed=<n> changes the grain. ?flyt=0.4 holds the way out of
 * the Earth view (to the ?lon/lat/dist pose, or the default one) at that
 * progress, and with &back=1 the way back from that pose: for captures of
 * the dolly zoom.
 */

/** What Back can close (native/back.ts). Read only: it never opens or closes anything. */
function overlayFlags(): OverlayFlags {
  return { panorama: !!panoramaUi?.isOpen(), sheet: !!bar?.sheetOpen(), notes: hud.notesOpen(), credits: hud.creditsOpen }
}
// A native build starts from its launch link, a pending link or the last view (native/boot.ts), before the parameters below are read.
const NATIVE_BUILD = import.meta.env?.VITE_NATIVE_BUILD === 'true'
/** Developer tools: the `__moon` surface, the capture API, the perf HUD, exposure tracing, the sampler, the debug sheet and the ?debug / ?heat views.
 * A native build folds this to false and the code behind it leaves the store binary (App Store guideline 2.3.1). The web build keeps all of it. */
const DEV_TOOLS = !NATIVE_BUILD
const nativeHost = NATIVE_BUILD ? await (await import('./native/boot')).bootNative() : null
/** A page with no query string of its own (the Artifact preview, scripts/artifact-preview.mjs) may carry one in window.__moonQuery. */
const params = new URLSearchParams(location.search || (window as { __moonQuery?: string }).__moonQuery || '')
/** Opt-in fixed-Sun policy. Legacy is the unchanged default until the rig A/B. */
const SHADOW_POLICY = parseShadowPolicy(params.toString())
const termAaParam = parseFloat(params.get('termaa') ?? '')
const STILL = params.get('still') === '1'
/** `?flightfeel=0`: the earlier fly-to law, Home look and Home framing (journey/feel.ts). Default: v2. */
const FLIGHT_FEEL = flightFeelOn(params)
/** Sky drags turn the Moon at a grab's rate (camera/grab.ts skyDragGain); `?skydrag=damped` keeps the older, slower sky rate. */
const SKY_DRAG_MATCH = params.get('skydrag') !== 'damped'
/** `?wantprobe=1` (measurement only, J1): `__moon.exactResidency()` recomputes the unthrottled want at the last drawn camera and counts what is resident. */
const WANT_PROBE = params.get('wantprobe') === '1'
let lastStreamView: StreamView | null = null
/** The centre caption (the feature name under the screen centre after a 2 s pause); `?caption=0` turns it off. */
const CAPTION_ON = !STILL && params.get('caption') !== '0'
/** The centre caption's look: the "Target lock" brackets and typed block (default), or `?labelstyle=classic`, the plain name above the dock. */
const LABEL_STYLE = labelStyleOf(location.search)
document.body.classList.toggle('label-style-lock', LABEL_STYLE === 'lock')
const DEBUG = DEV_TOOLS && params.get('debug') === '1'
const FLUSH16 = params.get('fp16flush') === '1' ? 1 : params.get('fp16flush') === '2' ? 2 : 0
const PRE_EXPOSE = params.get('preexpose') !== '0'
const SEED = Math.max(1, Math.floor(Number(params.get('seed')) || 1))
const LIVE_TICK_MS = 60_000
/** The opening (intro/): the title splash and the flyby to Home, for a person opening the page itself (intro/parse.ts). */
/** This start is the reload a lost context caused (reloadAfterLoss; native/boot.ts reads the same key). */
const AFTER_LOSS = ((): boolean => { try { return sessionStorage.getItem(LOST_RELOADS_KEY) !== null } catch { return false } })()
const intro = !STILL && introWanted(params, navigator.webdriver === true, AFTER_LOSS) ? new IntroController() : null
intro?.mountEarly()
// No splash (a shared link, an automated browser): #preview is the one loading state, with the bytes received so far.
if (!intro) mountLoadingLine()

/** A body drawn between the stars and the Moon (README pass order: the Sun, then the Earth). */
interface FrameInfo {
  now: number
  ephem: Ephemeris
  cam: ViewCamera
  width: number
  height: number
  tanPerPx: number
  exposure: Exposure
}
interface BodyPass {
  update(frame: FrameInfo): void
  render(renderer: THREE.WebGLRenderer): void
}
// README pass order, back to front: the Sun, then the Earth (the Moon is drawn after both).
const bodyPasses: BodyPass[] = []

function parseTime(s: string | null): Date | null {
  if (!s) return null
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}
const num = (k: string): number | undefined => {
  const v = params.get(k)
  if (v === null || v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

const canvas = document.getElementById('c') as HTMLCanvasElement
const hud = new Hud(document.getElementById('ui') as HTMLElement)
/** The brand line fades in once the view has been still for 2 s (out while moving) (stillness: the frame loop's loopQuiet); not in a capture. */
const brandFade = STILL ? null : mountBrandFade(document.getElementById('credit') as HTMLElement, () => hud.creditsOpen)
/** A one-time hint where measured frame times say the device struggles (ui/lowEndHint.ts); not in a capture. */
const lowEndHint = STILL || !lowEndHintDevice(matchMedia('(pointer: coarse)').matches, navigator.maxTouchPoints)
  ? null
  : mountLowEndHint(document.getElementById('ui') as HTMLElement)
/** The one caption element (ui/caption.ts) and the one bar (ui/bar.ts), mounted into the bottom dock. */
const caption: CaptionApi = mountCaption(document.getElementById('ui') as HTMLElement)
const newMoonNote = mountNewMoonNote(document.getElementById('ui') as HTMLElement, () => showNewMoonLit())
/** The offline line (net/offlineState.ts): the data host is unreachable and the browser is offline; the bundled 4k Moon keeps drawing. */
const offlineNote = mountOfflineNote(document.getElementById('ui') as HTMLElement)
let manifestFailed = false
function syncOfflineNote(): void {
  offlineNote.set(offlineNoteVisible({ hasTileBase: !!TILE_BASE, online: navigator.onLine !== false, tilesFailed: tilesState === 'failed', manifestFailed }))
}
window.addEventListener('offline', syncOfflineNote)
window.addEventListener('online', () => {
  // Back online: clear the line and try the data again now (the 5 s retry wait is for a bad minute, not for a returning connection).
  manifestFailed = false
  syncOfflineNote()
  if (tilesState === 'failed') { tilesFailedAt = -1e9; void ensureTiles().then(syncOfflineNote) }
  else if (TILE_BASE && !STILL) void loadManifest(TILE_BASE).catch(() => undefined)
})
hud.bindCaption(caption)
let bar: BarApi | null = null
/** The archive flag: the old chip row and its moments come back (the planner's pins replace them for visitors). */
const ARCHIVE = new URLSearchParams(location.search).get('archive') === '1'
if (ARCHIVE) document.body.classList.add('archive')
/** The first visit's hint under the caption stays until the visitor first touches the Moon, and is not shown again. */
let hintOn = true
try { hintOn = localStorage.getItem('moon.hintSeen') !== '1' } catch { /* private window */ }
function hintSeen(): void {
  if (!hintOn) return
  hintOn = false
  try { localStorage.setItem('moon.hintSeen', '1') } catch { /* private window */ }
}

interface MoonApi {
  ready: boolean
  frames: number
  error: string | null
  [k: string]: unknown
}
const api: MoonApi = { ready: false, frames: 0, error: null }
/** The last `__moon.serveSummary()` result (?shadowdebug=serve, dev builds): counts per serving category. Null until one is taken. */
let lastServe: Record<string, number | null> | null = null
api.shadowStats = (): Record<string, unknown> => {
  const mode = getShadowMode()
  const groundActive = groundMode?.active === true
  const patchBuilt = groundActive ? 0 : patchShadowCache?.stats.buildsLastFrame ?? 0
  const globalBuilt = groundActive ? 0 : shadowCache?.stats.buildsLastFrame ?? 0
  const accounted = accountShadowFrame({
    mode,
    servedPath: groundActive ? 'live-march' : moon?.shadowServePath,
    bakedDrawing: moon?.bakedStats?.drawing === true,
    patchCacheOn: patchShadowCache?.shaderOn === true && moon?.uniforms.uPShOn.value === 1,
    globalCacheOn: shadowCache?.shaderOn === true && moon?.uniforms.uShOn.value === 1,
    globalBuilt,
    patchBuilt,
    // Fixed policy: every demanded tile that is not exact is unmet, including demand left without a cache layer by the class cap (never dropped from the count).
    globalPending: groundActive ? 0 : SHADOW_POLICY === 'fixed' ? Math.max(shadowCache?.stats.visibleUnmetBand ?? 0, shadowCache?.stats.visibleNotExact ?? 0) : shadowCache?.stats.visibleUnmetBand ?? 0,
    patchPending: groundActive ? 0 : patchShadowCache?.stats.pending ?? 0,
    bakedPending: groundActive ? 0 : moon?.bakedStats?.pending ?? 0,
  })
  const sunEpoch = bodyFrameSunEpoch([ephem.sunDir.dot(ephem.moonX), ephem.sunDir.dot(ephem.moonY), ephem.sunDir.dot(ephem.moonZ)])
  const visibleDemand = shadowCache?.stats.visibleWanted ?? 0
  const exact = SHADOW_POLICY === 'fixed' ? (shadowCache?.stats.visibleExact ?? 0) : 0
  const { cacheCoverage, fallbackShare } = shadowCoverageStats(visibleDemand, exact)
  // Read-only: settlement is computed by the cache's own update, keyed by the Sun epoch, terrain revision and visible-demand revision.
  const settledMs = SHADOW_POLICY === 'fixed' ? shadowCache?.stats.settledMs ?? -1 : -1
  const diag = DEV_TOOLS && shadowCache ? { pool: shadowCache.poolStats(), notExact: shadowCache.tileDiag.map((t) => ({ ...t })), terrainRev: shadowCache.stats.terrainRev, demandSig: shadowCache.stats.demandSig, capacityBlockedVisible: shadowCache.stats.capacityBlockedVisible } : null
  return { ...accounted, serve: lastServe, global: globalHorizon ? { ...globalHorizon.stats } : null, sunBake: sunBake ? { ...sunBake.stats } : null, tileEnv: tileEnvelope ? { ...tileEnvelope.stats } : null, cache: shadowCache ? { ...shadowCache.stats, envelope: shadowCache.envelope } : null, policy: SHADOW_POLICY, sunEpoch, cacheCoverage, fallbackShare, settledAt: settledMs >= 0 ? settledMs : null, diag, frame: api.frames }
}
let navPointerCount = 0
Object.defineProperty(api, 'nav', { enumerable: true, get: () => ({
  pointers: navPointerCount,
  dragging: rig.dragging,
  gliding: rig.gliding(),
  frozen: rig.frozen,
  journey: journey.state ? { ...journey.state } : null,
  lastInputAt: rig.lastInputAt,
  floorDist: rig.floorAt(rig.pose.lon, rig.pose.lat),
  dist: rig.pose.dist,
  rig: rig.debugState(),
}) })
/** Why the loop drew: one count per cause of `dirty` (the rig's idle-redraw probe reads it as `__moon.why`; a rest frame with a count that keeps rising names the stuck cause). */
const why: Record<string, number> = {}
api.why = why
const because = (k: string): void => { why[k] = (why[k] ?? 0) + 1 }
/** The cut log the virtual-user gate reads (window.__moon.cuts, dev builds only). */
const cutLog: Array<{ t: number; kind: string }> = []
const computeExposure: typeof computeExposureRaw = (...a) => span('exposure', () => computeExposureRaw(...a))
if (DEV_TOOLS) api.cuts = cutLog
/** Diagnostic (dev builds): the camera floor over a point (rig.floorAt, Moon radii from the centre), so a rig job can scan a flight's track for steps. */
if (DEV_TOOLS) api.floorAt = (lon: number, lat: number): number => rig.floorAt(lon, lat)

/**
 * Diagnostic (dev builds): `__moon.camTrace(true)` starts a per-drawn-frame log of the camera in the Moon's body frame (where the surface
 * is fixed), the lens, the subject aim, the Sun's body-frame direction and the clock; `__moon.camTrace(false)` returns it and stops. The
 * rig's tap-jump job reads it to show a start-of-flight snap as a first-frame delta against the flight's own per-frame motion.
 */
let camTrace: Array<Record<string, unknown>> | null = null
function traceRow(c: ViewCamera, now: number, e: Ephemeris = ephem): Record<string, unknown> {
  const b = (v: { dot(o: unknown): number }): number[] => [v.dot(e.moonX), v.dot(e.moonY), v.dot(e.moonZ)]
  return { t: now, frame: api.frames, pos: b(c.pos), back: b(c.back), up: b(c.up), tanHalf: c.tanHalf, sun: b(e.sunDir), time: time.getTime(),
    pose: { ...rig.pose }, fovDeg: rig.fovDeg, aim: [rig.aimShiftX, rig.aimShift], look: rigLook, earthLook: rig.earthLook, earth: b(e.earthDir), lookDbg: rig.lookDebug(e, canvasAspect(), now), shadow: shadowCache ? { sv: shadowCache.stats.serving, vw: shadowCache.stats.visibleWanted, vb: shadowCache.stats.visibleBuilt, mv: shadowCache.stats.sunMoving, cuf: shadowCache.stats.catchUpFrames, cul: shadowCache.stats.catchUpLayers } : null, carry: !!ephemCarry, tween: !!tween, flight: !!cinematicFlight, orbit: !!orbitJourney, descent: !!descent }
}
// The first row is the camera on screen now (the last frame drawn), so a view at rest that draws nothing until the tap still has its 'before'.
/** Debug: what is moving the camera now (the tap-jump job records until a move is over; an orbit runs until something else is picked). */
if (DEV_TOOLS) api.moving = (): { tween: boolean; flight: boolean; descent: boolean; orbit: boolean; carry: boolean } => ({ tween: !!tween, flight: !!cinematicFlight, descent: !!descent, orbit: !!orbitJourney, carry: !!ephemCarry })
if (DEV_TOOLS) api.camTrace = (on: boolean): Array<Record<string, unknown>> | null => { const out = camTrace; camTrace = on ? (last ? [{ ...traceRow(last.cam, performance.now(), last.ephem), seed: true }] : []) : null; return out }
if (DEV_TOOLS) (window as unknown as { __moon: MoonApi }).__moon = api

/**
 * The reload a GPU reset ends in, in the app: it comes up at Home (native/boot.ts starts at Home while LOST_RELOADS_KEY is set), never in the
 * view that lost the context. Used by the retry card (quality/gpuReset.ts), which calls it only once a fresh context was granted.
 */
function reloadAtHome(): void {
  try { sessionStorage.setItem(LOST_RELOADS_KEY, String((Number(sessionStorage.getItem(LOST_RELOADS_KEY)) || 0) + 1)) } catch { /* blocked: boot then honours the launch link */ }
  try { localStorage.removeItem(LAST_VIEW_KEY) } catch { /* blocked */ }
  location.reload()
}

function fail(msg: string): never {
  api.error = msg
  const el = document.getElementById('err')
  if (el) {
    el.textContent = msg
    el.style.display = 'grid'
  }
  throw new Error(msg)
}

// WebGL disabled, a blocked GPU process or iOS Lockdown Mode make this throw: say so instead of leaving the splash up.
const renderer = ((): THREE.WebGLRenderer => {
  try {
    return new THREE.WebGLRenderer({
      canvas, alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false,
      powerPreference: 'high-performance',
      // Captures read the canvas back; otherwise the browser keeps the last
      // frame on screen between renders anyway.
      preserveDrawingBuffer: STILL,
    })
  } catch (err) {
    // The app after a GPU reset (issue #206): the WebView may refuse a context for a while. Offer a wait-and-retry instead of a dead end.
    if (NATIVE_BUILD && showGpuRetry(reloadAtHome, START_MESSAGE)) throw err
    return fail(`This page needs WebGL2, and the browser could not create a context (${err instanceof Error ? err.message : String(err)}).`)
  }
})()
// ?passes=1: per-pass GPU ms (`__moon.perf.passes`) instead of the whole-frame timer; pair it with ?motionscale= (the ladder needs the frame timer).
const passTimer = new PassTimer(renderer.getContext() as WebGL2RenderingContext, params.get('passes') === '1')
const gpuTimer = new GpuTimer(renderer.getContext() as WebGL2RenderingContext, params.get('gputimer') !== '0' && !passTimer.enabled, params.get('gpusource') === 'fence')
const displayRate = new DisplayRate()
let paceHolds = 0
// `?motion=sharp` (quality/sharpMotion.ts): motion frames have the rest dimensions; over budget the cost is cut elsewhere, then a 30 fps tier. Default off.
setMotionPolicy(resolveMotionPolicy(location.search, (() => { try { return localStorage.getItem(MOTION_POLICY_KEY) } catch { return null } })()))
const sharpPacer = new SharpPacer()
const SHARP_GATE_30 = new FrameGate(30)
/** downscaledFrames: motion frames drawn below the canvas size (0 under the policy); overridden: frames where a ladder's grid or motion DPR was overruled. */
const sharpMotionStats = { downscaledFrames: 0, overridden: 0 }
let sharpSeenSeq = 0
const pacing = new PacingBudget(parsePaceMode(new URLSearchParams(location.search).get('pacetier')))
/** Measured, not modelled: what the last gestures cost (read through `__moon.perf`, drawn by ?perfhud=1). */
/** Rest catch-up counters (?restcache): runs started, build-only frames, ms from the first build-only frame to the full frame, runs abandoned by movement, visible layers unmet at the start of the last run and at its end (-1 until a run). */
const restCatchUpStats = { runs: 0, frames: 0, ms: 0, abandoned: 0, unmetStart: -1, unmetEnd: -1 }
const perfState = { motionScale: 1, gesture: false, gestureEndAt: 0, taggedDoneAt: 0, motionFrames: 0, motionSubmitMs: 0 }
const perfSnapshot = (): Record<string, unknown> => ({ motionF: motionF.snapshot(), motionCap: phoneMotionOn() && phonePacer.params.ladder === 'desktop' ? { mp: Number.isFinite(phonePacer.pxCap) ? phonePacer.pxCap / 1e6 : 0, bound: phonePacer.capBound, frames: phonePacer.cappedFrames, ladderF: phonePacer.ladderF } : null, phone: phoneMotionOn() ? { level: phonePacer.level, hz: phonePacer.hzFor(phoneMomentActive()), moment: phoneMomentActive(), f: sharpF(), entries: phonePacer.entries, probes: phonePacer.probes, failedProbes: phonePacer.failedProbes, vetoed: phonePacer.vetoed, vetoExpired: phonePacer.vetoExpired, ladder: phonePacer.params.ladder, restFactor: restGovernor.factor, restDowns: restGovernor.downs, restUps: restGovernor.ups } : null, motionPolicy: { policy: motionPolicy(), ...sharpMotionStats, tier: sharpMotionOn() ? sharpPacer.tier : null, cutCost: sharpMotionOn() && sharpPacer.cutCost, cutEntries: sharpPacer.cutEntries, tier30Entries: sharpPacer.tier30Entries, probes: sharpPacer.probes }, wallSteps, wallObs, wallGapLast: +wallGapLast.toFixed(0), wallCap: wallLadder.cap, wallLite: wallLadder.lite, ...gpuTimer.stats(), ...targets.stats(), source: gpuTimer.source, flightExposure: { mode: FLIGHT_EXP_MODE, ...flightExpStats }, flightScale: { mode: flightScaleController.mode, steps: flightScaleController.steps, total: flightScaleController.totalSteps }, smoothedMs: gpuTimer.smoothed, displayHz: displayRate.hz, ...perfState, restCatchUp: { on: RESTCACHE_ON, budgetMs: REST_BUDGET, holeyMs: restCost.holey?.ms ?? null, holeyUnmet: restCost.holey?.unmet ?? null, c0Ms: Number.isFinite(restCost.c0) ? restCost.c0 : null, ...restCatchUpStats, layers: shadowCache?.stats.catchUpLayers ?? 0 }, taggedDoneAt: gpuTimer.taggedDoneAt, taggedMs: gpuTimer.taggedMs, rafFrameMs: frameMs, hitShared: moon?.hitShared ?? null, class: quality.detected.cls, quality: getQuality(), qualityLine: describeQuality(getQuality(), quality.detected.cls), fencePath: FENCE_CLASS, frameCapMs: +FRAME_GATE.periodMs.toFixed(2), sharp: quality.sharp.on, sharpGrid: flightScaleController.current, ...sharpPerf(), flightCapMs: +FLIGHT_GATE.periodMs.toFixed(2), paceOn: PACE_ON, paceTier: pacing.currentTier, paceCadenceHz: pacing.cadenceHz, paceTierCalls: pacing.tierCalls, paceHolds, inFlight: framePacer.inFlight, held: framePacer.held, paceDepth: framePacer.depth, bandFrames, bandedFrames, finalOnlyFrames, bandsOn: BANDS_ON, fullCostMs: +fullCostMs.toFixed(1), paceMs: +framePacer.periodMs.toFixed(1), paceRest: PACE_REST, settle: SETTLE_STEPPED ? 'stepped' : 'off', settleQuietMs: SETTLE_QUIET_MS, settleHolds, settleDeferred, settleFades, bandMs: BAND_MS, bandMax: BAND_MAX, restFullMs: +learnedFullMs().toFixed(1), fadeCadenceMs: fadeCadenceNow(), pressYield: PRESS_YIELD, pressYields, wallMemoryMs: WALL_MEMORY_MS, wallMemoryBySize: WALL_MEMORY.on, motionMemory: motionMemory.snapshot(), motionStart: MOTION_START_COST ? 'cost' : 'class', motionStartUsed, motionCost, motionRestFactor: MOTION_REST_FACTOR_PARAM ?? 1 / fullShaderFactor(), motionDprCap: MOTION_DPR_CAP_PARAM ?? null, fenceGrid: fenceGrid.snapshot(), groundBudget: groundMode?.budget?.snapshot() ?? null, dpr: restDpr, motionDpr, passes: passTimer.summary(), ablate: [...ABLATE], cpu: PERF ? perfReport() : null, shadow: shadowCache?.stats ?? null, baked: moon?.bakedStats ?? null })
Object.defineProperty(api, 'perf', { get: perfSnapshot, enumerable: true })
// The quality-knob form of `?motion=sharp`: takes effect at the next gesture or flight (the pixel ratio is chosen between gestures). Persisted in localStorage.
Object.defineProperty(api, 'setMotionPolicy', { enumerable: true, value: (p: MotionPolicy): void => { if (p !== 'sharp' && p !== 'default') return; setMotionPolicy(p); try { localStorage.setItem(MOTION_POLICY_KEY, p) } catch { /* blocked storage: this page only */ } } })
/** Rig phases: start a fresh f record (`__moon.perf.motionF`). */
Object.defineProperty(api, 'resetMotionF', { enumerable: true, value: (): void => motionF.reset() })
/** The running f record itself, for telemetry's per-window f (flight_perf / drag_perf read `.frames` and `.last` per tick in telemetry/boot.ts). */
Object.defineProperty(api, 'motionFStats', { get: () => motionF })
const perfHud = mountPerfHud(perfSnapshot, DEV_TOOLS && params.get('perfhud') === '1')
// ?sampler=1: the owner's frame recorder (perf/flightSampler.ts). Loaded only on this switch; nothing runs until Record is pressed, nothing leaves the page.
if (DEV_TOOLS && params.get('sampler') === '1') void import('./perf/flightSampler').then((m) => m.mountSampler(canvas))
if (!renderer.extensions.has('EXT_color_buffer_float')) fail('This page needs WebGL2 with float render targets (EXT_color_buffer_float).')
renderer.autoClear = false
renderer.setPixelRatio(1)

const common = commonUniforms()
common.uFlush16.value = FLUSH16

let time = parseTime(params.get('t')) ?? new Date()
let live = !parseTime(params.get('t')) && !STILL
const moonSurfaceTurn = new MoonSurfaceTurn()
let moonTurnMotion = false
let deferredClockCamera: ViewCamera | null = null
/** The clock's Sun and Earth geometry, with the visitor's temporary Moon-body turn applied to its axes. */
const ephemerisAt = (d: Date): Ephemeris => turnEphemeris(clockEphemerisAt(d), moonSurfaceTurn.orientation)
/** Explicit time changes clear the visitor's temporary body turn and restore the date's real Moon orientation. */
const clockSet = (d: Date, settleCamera = true): Ephemeris => {
  const hadTurn = moonSurfaceTurn.orientation.angleTo(new THREE.Quaternion()) > 1e-8
  const now = performance.now()
  const camera = hadTurn ? rig.camera(ephem, frameAspect || canvasAspect(), now) : null
  deferredClockCamera = !settleCamera ? camera : null
  moonSurfaceTurn.reset()
  moonTurnMotion = false
  const next = clockEphemerisAt(d)
  if (camera && settleCamera) rig.settle(next, frameAspect || canvasAspect(), now, camera)
  return next
}
let ephem = ephemerisAt(time)
let lastLiveTick = performance.now()

const rig = new CameraRig()
/** Rebuild the drawn body frame after a hand turn and keep the rendered camera exactly fixed in world space. */
function applyMoonSurfaceTurn(now: number): void {
  const aspect = frameAspect || canvasAspect()
  const camera = rig.camera(ephem, aspect, now)
  ephem = ephemerisAt(time)
  rig.keepWorldPosition(ephem, camera, now)
}
rig.auto = idleOrbitOn(params, STILL)
const targets = new TargetCache()
/** Phone classes cap the Moon's marches and the glare chain on motion frames only (`?motioncaps=0|1` forces it off or on for an A/B). */
const MOTION_GLARE_LEVELS = 4
let moonMotionCaps = false
/** `?exptrace=1` records one row per drawn frame (exposure target and applied white, gesture state, grid); `=full` also runs the full-quality search during a gesture to log the coarse search's error. Read with `__moon.exposureTrace()`. Measurement only. */
const EXP_TRACE = DEV_TOOLS && (params.get('exptrace') === '1' || params.get('exptrace') === 'full')
const EXP_TRACE_FULL = DEV_TOOLS && params.get('exptrace') === 'full'
/** `?coarsegain=0` restores the uncorrected coarse search during a gesture (the earlier behaviour), for A/B. On by default. */
const COARSE_GAIN_ON = params.get('coarsegain') !== '0'
const coarseGain = new CoarseGain()
// ?flightexposure=coarse: scripted flights use the coarse exposure search with their own gain and a motion-keyed reuse window (post/flightExposure.ts); default full = unchanged.
const FLIGHT_EXP_MODE = parseFlightExposureMode(params.get('flightexposure'))
const flightCoarseGain = new CoarseGain()
let flightFullSunlit: number | null = null
let ablExposureView: ExposureView | null = null
const flightExpStats = { coarseFrames: 0, calibrations: 0, reused: 0, searches: 0 }
const expTrace: Array<{ t: number; gain: number; cal: number; g: boolean; u: boolean; fx: boolean; s: number; raw: number; full: number; fb: number; fullFb: number; w: number; hits: number }> = []
const hitShareParam = new URLSearchParams(location.search).get('hitshare')
/** Startup class and GPU ledger (src/quality/). */
const quality: Quality = initQuality({ gl: renderer.getContext() as WebGL2RenderingContext, search: location.search, nativeShell: !!nativeHost })
// Phone motion policy (quality/phoneSharp.ts, `?phonesharp=0` restores the ladders): touch classes on the web draw every moving frame at one fraction f of the
// canvas (1.25 px per CSS px, never under half the canvas), drop to 30 fps before they drop f, native-resolution stars, Catmull-Rom, a rest governor that recovers.
// Desktop motion policy (`?desktopsharp=0` restores the ladders): the same policy on the desktop class with its own ladder (f 1 -> 0.75 at 60 fps -> 0.75 at 30).
const SHARP_PARAMS = motionPolicy() === 'default' ? sharpParamsFor(quality.detected.cls, location.search, !!nativeHost) : null
if (SHARP_PARAMS) setMotionPolicy('phone')
// Desktop motion pixel cap (`?motionmp=<megapixels>`, 0 = no cap; default 8 MP): after the ladder, a moving frame keeps at most that many render px, so f goes
// under 0.75 only on a canvas where f 0.75 exceeds the cap (5120x2880 and larger). Phones: no cap (#365's policy).
const phonePacer = new PhonePacer(phoneForcedF(location.search), phoneForcedHz(location.search), SHARP_PARAMS ?? undefined, motionPxCapFor(SHARP_PARAMS, location.search))
/** The policy's f for this canvas (the canvas at the rest ratio, as the frame sizes it), with the motion pixel cap. */
const sharpF = (): number => phonePacer.f(restDpr, Math.max(64, Math.round(canvas.clientWidth * restDpr)), Math.max(64, Math.round(canvas.clientHeight * restDpr)))
const PHONE_GATE_30 = new FrameGate(30)
let phoneSeenSeq = 0
/** A moment (scripted camera move: a fly-to, a cinematic flight, the Fly-around orbit, the intro) runs at a steady 30 fps under the phone policy. */
const phoneMomentActive = (): boolean => phoneMoment({ tween: !!tween, cinematic: !!cinematicFlight, orbit: !!orbitJourney, intro: !!intro?.moving, descent: !!descent, flight: !!flight, ridge: !!ridge, route: !!routeFlight, rigGlide: rig.gliding(), groundGlide: !!groundMode?.active && !!groundMode.cam.gliding })
/** f = render width / canvas width over drawn motion frames, every policy (the phone metric; `__moon.perf.motionF`). */
const motionF = new FracStats()
// A native shell's OS memory warning runs the context-loss steps on a live context (native/memoryWarning.ts): the ceiling lowers, the baked
// horizon is released and the chip re-reads. The web host never calls back. Tile eviction to a floor has no streamer API yet (see the
// progress file); tiles.suspend() is not used here because it is permanent (ParkWake.suspend) and would stop park wakes for the session.
nativeHost?.onMemoryWarning(() => {
  handleMemoryWarning(quality)
  moon?.disposeBaked()
  // The horizon comes back at the lowered ceiling (it sizes its array against it when it fills), as recoverContext does.
  moon?.configureBaked(renderer, quality.detected.cls, quality.ceilingBytes, markDirty)
  refreshReduced()
  // Tiles and the landing-site patch are released on the next calm frame (applyMemoryPressure).
  memoryPressure = { until: performance.now() + PRESSURE_PENDING_MS }
})
/** A memory warning's pending release of tiles and patch, or null (quality/pressure.ts). */
let memoryPressure: { until: number } | null = null
/** The shared terrain hit when `?hitshare=` is absent (`off|motion|1` force it): desktop class only until a phone measures its bandwidth and memory (8 B/px target, two cached sizes). */
const hitShareDefault: 'off' | 'motion' | 'always' = quality.detected.cls === 'desktop' ? 'always' : 'off'
/** The Quality sheet's preset over the device class: pixel-ratio caps and motion caps (`?motioncaps=` still forces the caps for an A/B). */
let knobs = motionKnobs(quality.profile, getQuality().preset)
const motionCapsParam = new URLSearchParams(location.search).get('motioncaps')
const motionCapsFor = (): boolean => motionCapsParam === null ? !!knobs.motionCaps : motionCapsParam === '1'
let motionCapsOn = motionCapsFor()
// `?fixedshare=0..0.95` overrides the class's motion cost model for an A/B (0 = the pure pixel-count model).
setFixedShare(params.get('fixedshare') !== null ? Number(params.get('fixedshare')) : knobs.motionFixedShare ?? 0)

// `?targetcache=N` (up to 8) raises the class's kept render sizes for an A/B.
targets.maxSets = Math.max(quality.profile.targetSets, Math.min(8, Number(params.get('targetcache')) || 0))
/** Read by reducedNow() below, which runs at module load: these must be declared before it (TDZ). */
let groundMode: GroundMode | null = null
/** Camera input and moving steps in ground mode, for the visitor-facing stillness (brand line, low-end hint). */
const groundStillness = new GroundStillness()
let flight: DescentFlight | null = null
let flightFrame: FlightFrame | null = null
const reducedNow = (): ReturnType<typeof reducedReasons> => {
  // The caps the renderer actually uses: the preset's knobs, not the class row (High and Battery change them, phone-android rests at restDprCap).
  const preset = getQuality().preset
  const k = motionKnobs(quality.profile, preset)
  return reducedReasons({
    cls: quality.detected.cls, profile: quality.profile, ceilingBytes: quality.ceilingBytes, contextLosses: quality.contextLosses, memoryWarnings: quality.memoryWarnings,
    allocatedTiles: quality.allocated.tiles, nativeDpr: window.devicePixelRatio || 1, preset,
    dprCap: k.dprCap, closeDprCap: k.closeDprCap, restDprCap: k.restDprCap, dprOverride: quality.dprOverride,
    dist: groundMode?.active || (flight && flightFrame) ? 0 : rig.pose.dist,
  })
}
let chipDpr = { rest: 0, moving: 0 }
/** What the quality audit reads (no visitor chip any more): recomputed on the events that can change the reasons, no timer. */
let reducedAudit: ReturnType<typeof reducedReasons> = []
const refreshReduced = (): void => { reducedAudit = reducedNow() }
refreshReduced()
const qualityReadout = STILL ? null : mountQualityReadout(document.getElementById('ui') as HTMLElement, quality, DEV_TOOLS && (DEBUG || params.get('perfhud') === '1'))
let maps: MoonMaps
let moon: MoonPass
/** Loaded after the first frame (never on the way in), and only when the visitor has the stars on. */
let stars: StarPass | null = null
let starsLoading = false
/** The faint real sky (HYG, CC BY-SA) behind the Moon: always on for a visitor; ?stars=0 turns it off for an audit or a comparison. */
const starsOn = params.get('stars') !== '0'
/** How much of the star field is shown, 0..1: eases to the button's state over STARS_FADE_MS, never a pop. */
let starsLevel = 0
let debugSheet: DebugSheetApi | null = null
/** The debug Switches panel (src/debug/): a lazy chunk, mounted only with ?debug=1 and never in a capture. */
let switchesApi: import('./debug/panel').SwitchesApi | null = null
/** 0 = physical flux (default 1.0); the ?tune=1 slider or ?starboost= lifts it. Saved in localStorage. */
let starBoost = loadBoost(location.search, (() => { try { return localStorage } catch { return null } })())
/** ?starlift= (rig A/B switch); 0 leaves the exposure unchanged. */
const STAR_LIFT_FLOOR = loadStarLiftFloor(location.search)
const STARS_FADE_MS = 800
let starsFadeAt = 0
/** The sky-star lift's gain for the last drawn scene (0: off); the final pass reads it on every frame, band and final-only frames included. ?skystars=0 turns the lift off. */
let skyStarsGain = 0
const SKY_STARS_ON = params.get('skystars') !== '0'
/** Waits before the 2nd, 3rd and 4th try of the star catalogue (ms); after the last one the visitor is told. */
const STARS_RETRY_MS = [3000, 8000, 20000]
let starsAttempt = 0
function ensureStars(): Promise<void> {
  if (stars || starsLoading) return Promise.resolve()
  starsLoading = true
  // The arrival is a repaint, not a gesture: the picture does not drop to the motion grid or crossfade for it, and the stars fade in.
  return StarPass.load(common as unknown as Record<string, THREE.IUniform>, quality.detected.cls === 'desktop' || phoneMotionOn()).then((s) => { stars = s; starsFadeAt = performance.now(); markDirty() }).catch((e) => {
    starsLoading = false
    console.warn('stars', e)
    const wait = STARS_RETRY_MS[starsAttempt++]
    if (wait !== undefined && !STILL) setTimeout(() => void ensureStars(), wait)
    else if (!STILL) caption.flash('The star field did not load', 'Reload the page to try again.', 6000)
  })
}
let glare: GlarePass
let final: FinalPass
let sun: SunPass
let earth: EarthPass
/** Ground mode (src/ground/): the camera in the site's metre frame, once the Apollo 17 patch is loaded. */
let groundUi: ReturnType<typeof mountGroundUi> | null = null
/** SkyLumi's zoom tape, on the left: shows the camera's height while it changes. */
let touchControlsUi: TouchControlsApi | null = null
let zoomTapeUi: ZoomTapeApi | null = null
/** When the tape last looked at the rig's zoom input (see tapeWakeAllowed). */
let tapeCheckedAt = Number.NEGATIVE_INFINITY
let zoomTapeLimitHits = 0
let viewpointsUi: ReturnType<typeof mountViewpoints> | null = null
let siteRingUi: ReturnType<typeof mountSiteRing> | null = null
/** The powered-descent flight (src/descent/), when its tour is running, and the frame it last computed. */
/** After the camera is released at contact, the module keeps dropping to its pads until SETTLE_END_T (the free camera is the user's). */
let settle: { path: DescentPathT; t: number } | null = null
let flightPlume = false
/** The moment (epoch ms) the current ephemeris was computed for during a flight: it is refreshed every 200 sim ms, not every frame. */
let flightEphemMs = -1

// ---------------------------------------------------------------------------
// Tiles (milestone 2). Nothing is fetched until the camera is near enough for
// a tile to matter (or a URL / moment asks for the surface): the first load is
// the milestone-1 load. Until the manifest is known the floor stays D_MIN.
// ---------------------------------------------------------------------------
const TILE_BASE = tileBase()
let tiles: TileStreamer | null = null
/** The Sun-keyed shadow cache over the tiles (moon/tiles/ShadowCache.ts); ?shcache=0 keeps the live march everywhere (A/B). */
let shadowCache: import('./moon/tiles/ShadowCache').ShadowCache | null = null
/** The fixed policy's global-map horizon cache (moon/tiles/GlobalHorizonCache.ts): the 4k-map shadow march cached per Sun epoch; `?ghcache=0` keeps the live march there (A/B). */
let globalHorizon: GlobalHorizonCache | null = null
let globalHorizonFailed = false
/** The fixed policy's Sun-keyed 4k horizon bake (moon/tiles/SunHorizonBake.ts): per cell and lod bin the lowest / highest horizon toward the fixed Sun, so the Sun march is skipped outside it; `?sunbake=0` leaves it out (A/B). */
let sunBake: SunHorizonBake | null = null
let sunBakeFailed = false
/** The fixed policy's per-tile horizon envelope (moon/tiles/TileEnvelope.ts): the tile march's highest horizon per cell of every resident tile, Sun-independent; `?tenv=0` keeps the live tile march (A/B). */
let tileEnvelope: TileEnvelope | null = null
let tileEnvelopeFailed = false
const TENV_ON = tenvOn(params.toString())
const GH_CACHE_ON = ghCacheOn(params.toString())
const SUN_BAKE_ON = sunBakeOn(params.toString())
const SHADOW_CACHE_ON = params.get('shcache') !== '0'
/** The patch shadow cache (moon/patch/PatchShadowCache.ts): the Sun-keyed horizon cache for a fused-ground site patch; ?pshcache=0 keeps the live march there (A/B). */
let patchShadowCache: PatchShadowCache | null = null
const PATCH_SHADOW_CACHE_ON = params.get('pshcache') !== '0' && SHADOW_CACHE_ON
/** While a gesture runs the shader marches the shadow live, as V1.1 did (V1.1 parity; whether the cache read itself costs presented frames, or only the cooler GPU clock after a cheap cached rest frame, is under test with ?kw); the cache serves the rest frame and the sharpen after release. `?shmotion=cache` lets motion read the cache. */
const SH_MOTION_LIVE = params.get('shmotion') !== 'cache'
/** The night side's display floor, ?nightfloor=<share of display white> (default NIGHT_FLOOR_DEFAULT_SHARE since 2026-10-24, 0 turns it off; post/exposure.ts nightFloorRadiance). */
const NIGHT_FLOOR = nightFloorShare(params.get('nightfloor'))
let tilesState: 'off' | 'idle' | 'loading' | 'ready' | 'failed' = TILE_BASE ? 'idle' : 'off'
let tilesLoading: Promise<void> | null = null
/** When the tiles failed for good (performance.now()): a later request for them tries again after RETRY_AFTER_MS, so one bad minute never latches the session. */
let tilesFailedAt = 0
const RETRY_AFTER_MS = 5000
/** How far the patch being loaded has got (null when none is loading). */
let patchProgress: ProgressSnapshot | null = null
let progressNotifiedAt = 0
/** Tells the tour card the loading figures moved: at most four times a second. */
function notifyProgress(force = false): void {
  const t = performance.now()
  if (!force && t - progressNotifiedAt < 250) return
  progressNotifiedAt = t
  toursApi?.refresh()
}
let toursApi: { refresh(): void; syncNow(): void; demote(): void; stop(): void; open(id: string): boolean } | null = null
/** The navigator pill above the bar (ui/navigator.ts): the visitor's list of viewpoints, stepped with its arrows. */
let navApi: NavigatorApi | null = null
let liveSeen = true
/** Distance under which the manifest is fetched ahead of need (Moon radii). */
const TILE_PREWARM_DIST = 4.3
const POLAR_DETAIL_CREDIT = 'Polar imagery detail: LROC WAC north and south summer 100 m mosaics, NASA/GSFC/Arizona State University; Speyerer, Robinson, Boyd, Wagner, and Henriksen (2020), “Exploration of the lunar south pole with LROC data products.” Imagery detail retains source illumination and is not true albedo.'

/** One resident tile (heights R16F 322 px + colour SRGB8_A8 382 px with mips), config.ts. */
const TILE_PAIR_BYTES = TILE_PAIR
/** Left for what loads after the tile cache: the TC and detail caches, the Earth, a site patch, the lander. */
const TILE_RESERVE_BYTES = 160 * 1048576

/**
 * The finest height texel the hosted set has under every tile (manifest `deeper` level -3: SLDEM within 60 deg, LOLA polar), km: the fallback
 * when the manifest has not resolved at pick time. The boot starts the shared manifest load (net/prefetch.ts loadManifest) on the first frames,
 * so usually it has, and its own finest texel is used instead of this constant. The tiles themselves (TileStreamer.create: dynamic import,
 * texture allocation) are what take seconds; applyFloor later installs rig.deepFloor from the same texel.
 */
const EXPECTED_FINEST_HEIGHT_TEXEL_KM = 0.0592
/** 1 + the altitude at 1 texel per pixel of that texel (the pointFloorAt formula), on this canvas at the rig's lens. */
function expectedLoadingFloor(): number {
  const dpr = Math.min(window.devicePixelRatio || 1, knobs.dprCap)
  const short = Math.min(canvas.clientWidth, canvas.clientHeight) * dpr
  const man = TILE_BASE ? resolvedManifest(TILE_BASE) : null
  const texelKm = man ? finestHeightTexelKm(man) : EXPECTED_FINEST_HEIGHT_TEXEL_KM
  return Math.min(D_MIN, 1 + siteAltR(texelKm * 1000, short, rig.fovDeg))
}
/**
 * After a failed load the low floor stays; D_MIN comes back only once the camera is above it on its own. Never moves the camera.
 * Called every frame by the render path (cheap) and when the load fails.
 */
let floorRestorePending = false
function restoreFloorAfterFailure(): void {
  if (auditFloor !== null || tilesState !== 'failed') { floorRestorePending = false; return }
  floorRestorePending = true
  if (rig.pose.dist >= D_MIN) { rig.setFloor(D_MIN); floorRestorePending = false }
}
function ensureTiles(): Promise<void> {
  if (!TILE_BASE || tilesState === 'ready') return Promise.resolve()
  // A failed load is tried again when something asks for the tiles after a pause (a chip click, the camera coming near).
  if (tilesState === 'failed') {
    if (performance.now() - tilesFailedAt < RETRY_AFTER_MS) return Promise.resolve()
    tilesState = 'idle'
    tilesLoading = null
  }
  if (tilesLoading) return tilesLoading
  tilesState = 'loading'
  // A move started while the manifest loads plans its end against this floor, not D_MIN (3.58 R): the real one is known to ~0.01 R already.
  floorRestorePending = false
  if (auditFloor === null) rig.setFloor(expectedLoadingFloor())
  tilesLoading = (async () => {
    try {
      const { TileStreamer: TS } = await import('./moon/tiles/TileStreamer')
      const gl = renderer.getContext() as WebGL2RenderingContext
      const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number
      let layers = tileCapacity(maxLayers, location.search, quality.profile.tiles)
      // A device with a memory ceiling never allocates past it: the layer count (create-time only, texStorage3D is immutable) is cut to what is left
      // after the maps, the targets and a reserve for what loads later (TC, detail, Earth, a patch). ?tilecache=N is a measurement and is not cut.
      if (!new URLSearchParams(location.search).has('tilecache')) {
        layers = fitLayers(layers, 8, TILE_PAIR_BYTES, quality.ceilingBytes - ledger.total() - TILE_RESERVE_BYTES)
        quality.allocated.tiles = layers
        refreshReduced()
      }
      // A shed for an overrun (enforceMemory) rebuilds the cache at the layer count it computed, not at the creation fit above.
      layers = growLayers(layers, maxLayers)
      if (memShedTileCap !== null) { layers = Math.min(layers, memShedTileCap); quality.allocated.tiles = layers }
      if (cacheGrow) { learnSize(cacheGrow, layers, performance.now()); persistGrow(); if (cacheGrow.next < cacheWritten) { writeRemembered(cacheGrowKv, quality.detected.cls, cacheGrow.next); cacheWritten = cacheGrow.next } }
      api.tilesCreateAt = performance.now() // startup timeline for the rig (drag-stall-trace.mjs --loadtrace)
      const hFloor = heightFloor(location.search, quality.profile.heightTiles)
      tiles = await TS.create(renderer, TILE_BASE, layers, undefined, (c, d, m) => heightCapacity(c, d, m, hFloor), { tc: quality.profile.tc, tcCapacity: tcCapacity(maxLayers, location.search, quality.profile.tcTiles), heightWantFor: (c, d, m, h) => heightWantCap(location.search, heightCapacity(c, d, m), h) })
      tiles.onChange = () => { markDirty() }
      tiles.shaderShade = SHADOW_POLICY === 'fixed'
      moon.setTiles(tiles)
      // The cache's layers are single-channel half floats rendered to: that needs a colour-renderable float extension (the HDR scene target already does).
      const exts = renderer.extensions
      if (SHADOW_CACHE_ON && (exts.has('EXT_color_buffer_float') || exts.has('EXT_color_buffer_half_float'))) {
        const { ShadowCache: SC } = await import('./moon/tiles/ShadowCache')
        shadowCache = new SC(renderer, moon.uniforms, tiles.capacity, maps.height.lonSpan, maps.height.size[0], tiles.deepest, tiles.parking ? tiles.heightWant : tiles.capacity)
        shadowCache.diagnostics = DEV_TOOLS
        moon.setShadowCache(shadowCache)
      }
      // The patch shadow cache: before any patch is bound (the cache read is part of the patch shader's layout, and costs one of its texture units).
      if (PATCH_SHADOW_CACHE_ON && !patchShadowCache && (exts.has('EXT_color_buffer_float') || exts.has('EXT_color_buffer_half_float'))) {
        patchShadowCache = new PatchShadowCache(renderer, moon.uniforms, maps.height.lonSpan, maps.height.size[0], tiles.deepest)
        moon.setPatchShadowCache(patchShadowCache)
      }
      tilesState = 'ready'
      manifestFailed = false
      syncOfflineNote()
      api.tilesReadyAt = performance.now()
      notifyProgress(true)
      api.tiles = tiles
      if (tiles.polarDetailEnabled) hud.appendCredit(POLAR_DETAIL_CREDIT)
      applyFloor()
      markMoved()
    } catch (e) {
      tilesState = 'failed'
      tilesFailedAt = performance.now()
      restoreFloorAfterFailure()
      console.warn('Tiles unavailable, staying at the 4k maps:', (e as Error).message)
      syncOfflineNote()
      toursApi?.refresh()
    }
  })()
  return tilesLoading
}

// ---------------------------------------------------------------------------
// The site patches (src/moon/patch/sites.ts: Apollo 11 and 17): a local image (0.5 to 0.6 m per pixel) and
// height (2 m) patch over the tiles, one loaded at a time. Fetched (30 to 50 MB gzipped) when the
// camera comes down over its site or its tour starts.
// ---------------------------------------------------------------------------
const PATCH_BASE = patchBase()
const MID_PATCH_BASE = midPatchBase()
let patch: PatchLayer | null = null
let patchBoundRevision = -1
/** Compiles the shader layout of a patch's resident levels in the background, then runs `bind` (see MoonPass.prepare). Chases a layout that changes meanwhile. */
async function bindWhenCompiled(layer: PatchLayer, bind: () => void): Promise<void> {
  try {
    for (let i = 0; i < 4; i++) {
      const key = moon.layoutKeyOf(layer)
      await moon.prepare(renderer, layer)
      if (moon.layoutKeyOf(layer) === key) break
    }
  } catch (e) { console.warn('patch shader precompile failed; compiling on first draw', e) }
  bind()
}
let patchLoadGeneration = 0
let patchController: AbortController | null = null
let patchRefinementPaused = false
/** Which site's patch is loaded or loading, and the state of that load. */
let patchSiteId: string | null = null
let patchError: string | null = null
let patchState: 'off' | 'idle' | 'loading' | 'ready' | 'failed' = PATCH_BASE ? 'idle' : 'off'
let patchLoading: Promise<void> | null = null
/** Sites whose manifest answered (probed at start): only these get tours and prewarm. */
const patchSitesFound = new Set<string>()
/** Sites whose optional 25 cm tier manifest answered. */
const tierSitesFound = new Set<string>()
/** Angular distance (radians) under which a patch is fetched ahead of need, and camera distance (radii) under which. */
const PATCH_PREWARM_ARC = 0.05
const PATCH_PREWARM_DIST = 1.6
/** Camera distance (radii) under which a camera over a site's fine photographs (coverage data) fetches its patch. */
const PATCH_COVERAGE_DIST = 2.2
/** The terrain grid the floor and altitude follow at sites that ask for it: cell size, metres. */
const TERRAIN_CELL_M = 128

/** The site table entry for the patch that is loaded (or being loaded). */
function loadedSite(): PatchSite | null {
  return patchSiteId ? PATCH_SITES[patchSiteId] : null
}

/**
 * Which sites get tours. A site is offered unless its manifest definitely is not there (a 404): a dropped connection or a
 * slow host must not remove a chip, so those are retried and, failing that, the site stays offered (its card then says what
 * happened and offers a retry). The whole probe is capped at 4 s so the chips never wait on a dead host.
 */
async function probePatchSites(): Promise<void> {
  if (!PATCH_BASE) return
  for (const site of PATCH_SITE_LIST) { patchSitesFound.add(site.id); if (site.hasTier && params.get('tier') !== 'off') tierSitesFound.add(site.id) }
  const absent = async (url: string): Promise<boolean> => {
    try { await fetchRetry(url, { delaysMs: [400, 1500] }); return false } catch (e) { return e instanceof HttpError && (e.status === 404 || e.status === 403) }
  }
  const probes = Promise.all(PATCH_SITE_LIST.map(async (site) => {
    if (await absent(`${PATCH_BASE}${site.id}/manifest.json`)) patchSitesFound.delete(site.id)
    if (site.hasTier && params.get('tier') !== 'off' && await absent(`${PATCH_BASE}${site.id}/haase-tier.manifest.json`)) tierSitesFound.delete(site.id)
  }))
  await Promise.race([probes, new Promise((r) => setTimeout(r, 4000))])
}

/** Drops the loaded patch (another site's is wanted, or the context was lost). */
function dropPatch(): void {
  clearAutoRetry()
  patchLoadGeneration++
  patchController?.abort(); patchController = null
  patchBoundRevision = -1
  if (groundMode) { leaveGround(true); groundMode.dispose(); groundMode = null }
  // A descent over the old site would read its manifest.
  descent = null
  moon.setPatch(null)
  if (patch) { patch.dispose(); patch = null }
  rig.site = null
  patchSiteId = null
  patchState = PATCH_BASE ? 'idle' : 'off'
  patchLoading = null
  patchProgress = null
  patchError = null
  api.patch = undefined
}

function ensurePatch(siteId: string): Promise<void> {
  if (!PATCH_BASE || !PATCH_SITES[siteId]) return Promise.resolve()
  if (patchSiteId === siteId) {
    if (patchState === 'ready' || patchState === 'failed') return Promise.resolve()
    if (patchLoading) return patchLoading
  } else if (patchSiteId && patchState === 'loading' && patchLoading) {
    // Another site's patch is on its way: let it land, then swap.
    return patchLoading.then(() => ensurePatch(siteId))
  } else if (patchSiteId) {
    dropPatch()
  }
  const site = PATCH_SITES[siteId]
  const generation = ++patchLoadGeneration
  const controller = new AbortController()
  patchController = controller
  patchSiteId = siteId
  patchState = 'loading'
  patchProgress = null
  patchLoading = (async () => {
    try {
      await ensureTiles()
      if (tilesState !== 'ready') throw new Error('needs the tiles')
      const { PatchLayer: PL } = await import('./moon/patch/PatchLayer')
      const { uploadSliced } = await import('./moon/patch/sliceUpload')
      let loaded = await PL.create(`${PATCH_BASE}${siteId}/`, {
        net: { init: { signal: controller.signal, priority: 'high' } as RequestInit },
        initialDemand: MID_PATCH_BASE ? { altitudeKm: Infinity, metresPerPixel: Infinity, zoomedIn: false } : (() => {
          const cam = last?.cam ?? rig.camera(ephem, canvasAspect(), performance.now())
          const nadir = underCamera(ephem, cam.pos)
          const altitudeKm = Math.max(0, (cam.pos.length() - 1) * MOON_R_KM - site.groundM / 1000)
          return { altitudeKm, metresPerPixel: altitudeKm * 1000 * cam.tanHalf / Math.max(1, canvas.height / 2),
            zoomedIn: altitudeKm < 300 && angularDistance(nadir.lon, nadir.lat, site.lon, site.lat) < PATCH_PREWARM_ARC }
        })(),
        maxSamplers: patchSamplerBudget(renderer.capabilities.maxTextures, patchShadowCache ? 1 : 0),
        maxResidentBytes: patchBudget(quality.profile.patchResidentBytes, !!nativeHost && quality.detected.cls === 'phone-android', !!nativeHost && quality.contextLosses > 0),
        maxTexture: Math.min(Number(params.get('maxtex')) || Infinity, renderer.capabilities.maxTextureSize),
        terrainCellM: site.terrainFollow ? TERRAIN_CELL_M : undefined,
        tier: !!site.hasTier && params.get('tier') !== 'off',
        floatLinear: renderer.extensions.has('OES_texture_float_linear') && params.get('f32h') !== 'off',
        upload: params.get('slice') === 'off' ? undefined : (t, data) => uploadSliced(renderer, t, data),
        onResident: layer => {
          if (patch !== layer) return
          const bind = (): void => {
            if (patch !== layer) return
            moon.setPatch(layer.levels.length ? layer : null, site.maxSlope, site.fusedGround)
            patchBoundRevision = -1
            markMoved()
          }
          // A level arriving makes a new shader layout: it is compiled in the background first and bound once it is linked. A level
          // leaving (its textures are disposed already) is bound at once.
          if (layer.levels.length > moon.boundLevels) { void bindWhenCompiled(layer, bind) } else bind()
        },
        onProgress: (p) => { if (patchSiteId === siteId) { patchProgress = p; notifyProgress() } },
      })
      if (MID_PATCH_BASE) {
        try {
          const coarse = await PL.create(`${MID_PATCH_BASE}${siteId}/`, {
            net: { init: { signal: controller.signal, priority: 'high' } as RequestInit },
            initialDemand: { altitudeKm: Infinity, metresPerPixel: Infinity, zoomedIn: false },
            maxTexture: Math.min(Number(params.get('maxtex')) || Infinity, renderer.capabilities.maxTextureSize),
            terrainCellM: site.terrainFollow ? TERRAIN_CELL_M : undefined,
            floatLinear: renderer.extensions.has('OES_texture_float_linear'), tier: false,
            // The band is most of what "Loading the photograph" waits for (Apollo 17: 22.4 MB of heights): its bytes move the card's bar and its retries say so.
            onProgress: (p) => { if (patchSiteId === siteId && generation === patchLoadGeneration) { patchProgress = p; notifyProgress() } },
          })
          loaded = PL.compose(coarse, loaded)
          hud.appendCredit('Wide terrain: SLDEM2015 heights from LOLA and SELENE.')
        } catch (error) { console.warn('Wide height bridge unavailable; global fallback retained:', String(error)) }
      }
      try { await moon.prepare(renderer, loaded) } catch (e) { console.warn('patch shader precompile failed; compiling on first draw', e) }
      if (patchSiteId !== siteId || generation !== patchLoadGeneration) { loaded.dispose(); return }
      patchProgress = null
      patch = loaded
      moon.setPatch(patch.levels.length ? patch : null, site.maxSlope, site.fusedGround)
      patchBoundRevision = patch.revision
      hud.appendCredit(`${site.name} site: LROC narrow angle camera photograph and terrain model, ${site.credit} (public domain PDS products).`)
      if (patch.manifest.tier) hud.appendCredit('Apollo 17 lander area at 25 cm: I. Haase, M. Wählisch, P. Gläser, J. Oberst and M. S. Robinson (TU Berlin, DLR), from LROC narrow angle camera images, NASA/GSFC/Arizona State University, USGS PDS Annex.')
      if (siteId === 'a17') hud.appendCredit('Lunar module: NASA 3D Resources (Apollo Lunar Module model).')
      patchState = 'ready'
      autoRetries.delete(siteId)
      notifyProgress(true)
      api.patch = patch
      // Apollo 17: build the ground pass, compile its shaders and fetch the module now, so the first ground frame has neither hitch.
      if (siteId === 'a17' && patch.readyCoarse && !STILL) { const g = ensureGround(); if (g) { compileQueue.enqueue('ground', () => g.warm(idleSlot, groundWarmKinds(metadataWarm)).then(() => { groundWarmDone = true }, () => { groundWarmDone = true })); void g.loadLm(ephem, canvasAspect()).catch(() => undefined) } }
      applyFloor()
      markMoved()
    } catch (e) {
      if (controller.signal.aborted) return
      if (patchSiteId === siteId && generation === patchLoadGeneration) { patchState = 'failed'; patchProgress = null; patchError = (e as Error).message }
      console.warn('Site patch unavailable:', (e as Error).message)
      notifyProgress(true)
      if (patchSiteId === siteId && generation === patchLoadGeneration && patchState === 'failed') scheduleAutoRetry(siteId)
    }
  })()
  return patchLoading
}

const autoRetries = new Map<string, number>()
let autoRetryTimer: ReturnType<typeof setTimeout> | null = null
let autoRetryOnline: (() => void) | null = null
/** Ends any pending automatic try (the pin, the site or the whole scene changed under it). */
function clearAutoRetry(): void {
  if (autoRetryTimer) { clearTimeout(autoRetryTimer); autoRetryTimer = null }
  if (autoRetryOnline) { window.removeEventListener('online', autoRetryOnline); autoRetryOnline = null }
}
/**
 * Tries a failed site photograph again by itself, a few times, while its pin is still the one shown (the caption's Retry chip stays for the rest).
 * It retries the DATA only (the camera is never flown again), waits for the browser to be online, and waits while the visitor is dragging.
 */
function scheduleAutoRetry(siteId: string, delay?: number): void {
  clearAutoRetry()
  const n = autoRetries.get(siteId) ?? 0
  const wait = delay ?? autoRetryDelay(n)
  if (wait === null) return
  autoRetryTimer = setTimeout(() => {
    autoRetryTimer = null
    const h = pinShown?.h
    const verdict = autoRetryVerdict({ shownNeeds: h?.needsPatch ?? null, siteId, patchSiteId, patchState, online: navigator.onLine !== false, busy: !!(rig.dragging || tween || descent || rig.gliding() || routeFlight) })
    if (verdict === 'stop' || !h) return
    if (verdict === 'wait') {
      if (navigator.onLine === false) {
        // Offline: nothing to ask for until the browser says so, then one try.
        autoRetryOnline = () => { autoRetryOnline = null; scheduleAutoRetry(siteId, 500) }
        window.addEventListener('online', autoRetryOnline, { once: true })
      } else scheduleAutoRetry(siteId, AUTO_RETRY_BUSY_MS)
      return
    }
    autoRetries.set(siteId, (autoRetries.get(siteId) ?? 0) + 1)
    const seq = playSeq
    dropPatch()
    void ensurePatch(siteId).then(() => {
      // Resume the moment only if the visitor has not moved on or turned the Moon meanwhile: the data stays loaded either way (a tap on the pin is then quick).
      if (seq !== playSeq || pinShown?.h !== h || patchSiteId !== siteId || patchState !== 'ready') return
      const site = PATCH_SITES[siteId]
      if (angularDistance(rig.pose.lon, rig.pose.lat, site.lon, site.lat) > 3 * Math.PI / 180 || rig.pose.dist > APPROACH_DIST * 1.1 || tween || rig.dragging) return
      beginJourney(h)
      playMoment(h, false, true)
    })
  }, wait)
}

/**
 * The texel the site's floor is set by: the finest photograph the patch DECLARES, not the finest one loaded. A loaded-only floor stopped
 * the camera 131 km over Apollo 11 (set by the 59 m height-only bridge), where the 8 m photograph is not yet wanted: its demand needs
 * the camera nearer, so the visitor could never come nearer (found 2026-10-04 with the coverage map). The levels stream in as the camera descends.
 */
function floorTexelOf(p: PatchLayer): number {
  const pictures = p.availableLevels.filter((l) => l.detail)
  const fin = pictures.at(-1) ?? p.finest
  return fin.floorTexelM ?? fin.texelM
}

/** The closest distance for this canvas and these tiles (DESIGN-M2.md section 7), and the patch's funnel. */
/** Set by the audit hook `setFloorDist` only. */
let auditFloor: number | null = null
/** The floor's cone starts at the edge of finer data (coverage.ts deeperFloorAt, continuous); `?flooredge=0` is the old ladder, the rig's legacy arm for owner item 7. */
const FLOOR_EDGE = params.get('flooredge') !== '0'
function applyFloor(): void {
  if (!tiles) return
  const dpr = Math.min(window.devicePixelRatio || 1, knobs.dprCap)
  const short = Math.min(canvas.clientWidth, canvas.clientHeight) * dpr
  // The global floor is the BUILT tiles' texel (`texelKm`): a manifest's deeper block covers a region and does not move it; the block's own
  // lower floor is `rig.deepFloor` below (heightTexelKmAt under the camera, with a cone past the block's edge).
  rig.setFloor(auditFloor ?? Math.min(D_MIN, floorDist(tiles.texelKm, short, rig.fovDeg)))
  // Over a block of deeper height tiles (the 59 m SLDEM around Apollo 11) the floor is that block's texel, with a cone past its edge; anywhere else it is the global one.
  const ts = tiles
  const memo = new Map<string, number>()
  rig.deepFloor = auditFloor !== null || (ts.deepest >= 0 && !ts.tc) ? null : (lon, lat) => {
    // One lookup per frame and place: the camera, the route and the clamp ask about the same few points.
    const key = `${lon.toFixed(5)},${lat.toFixed(5)},${rig.fovDeg.toFixed(3)}`
    let v = memo.get(key)
    if (v === undefined) {
      v = deeperFloorAt(lon, lat, { shortPx: short, fovDeg: rig.fovDeg, texelKmAt: (a, b) => (ts.tc ? Math.min(ts.heightTexelKmAt(a, b), ts.tc.texelKmAt(a, b)) : ts.heightTexelKmAt(a, b)), globalTexelKm: ts.texelKm, edge: FLOOR_EDGE })
      if (memo.size > 256) memo.clear()
      memo.set(key, v)
    }
    return v
  }
  // The same data as a CONTINUOUS floor for the zoom dolly: its own texel's floor at a point (no ladder), from which the dolly builds a cone along its path.
  rig.deepTexelFloor = rig.deepFloor ? (lon, lat) => pointFloorAt(lon, lat, { shortPx: short, fovDeg: rig.fovDeg, texelKmAt: (a, b) => (ts.tc ? Math.min(ts.heightTexelKmAt(a, b), ts.tc.texelKmAt(a, b)) : ts.heightTexelKmAt(a, b)), globalTexelKm: ts.texelKm }) : null
  const site = loadedSite()
  if (patch && site && patchState === 'ready') {
    const s = patch.manifest.site
    // One texel of the finest image per canvas pixel (0.5 or 0.6 m), above the patch's ground.
    const siteId = site.id
    const skipIds = new Set(patch.failedLevelNames.map((n) => `${siteId}-${n}`))
    // The finest picture UNDER the camera sets the floor (coverage boxes widened as cones), one texel per canvas pixel above the patch's ground.
    const view = { shortPx: short, fovDeg: rig.fovDeg, skip: skipIds }
    rig.site = {
      lon: s.lon, lat: s.lat, groundR: patch.groundR, altR: siteAltR(floorTexelOf(patch), short, rig.fovDeg),
      alt: (lon, lat) => coverageAlt(siteId, lon, lat, view),
      terrain: site.terrainFollow && patch.terrain ? patch.terrain : undefined,
    }
    failedKey = patch.failedLevelNames.join()
  }
}
/** The failed levels the floor was last computed for: a change (a 404, a retry) recomputes it. */
let failedKey = ''

let dirty = true
/** The loop stopped asking for frames because the scene is at rest (src/loop/idle.ts); a redraw request or an input wakes it. */
let idleSleeping = false
/** performance.now() of the last frame render() completed (resume diagnostics, loop/resume.ts). */
let lastRenderedAt = 0
/** Every request for a redraw goes through here: one from outside render() (a move, a tile, a clock tick) voids the final-pass-only shortcut, because the scene target may be stale. render() requests its own (exposure, tiles, the crossfade) with `inRender` set. */
let inRender = false
/** The refine crossfade was the only reason for the last redraw (render() sets it) and nothing has asked for a redraw since: the scene target is still current. */
let fadeOnly: { scale: number } | null = null
function markDirty(): void {
  dirty = true
  if (idleSleeping) wakeLoop(false)
  if (!inRender) {
    fadeOnly = null
    // A partial scene target is only reusable while nothing outside its
    // band sequence has changed. Restart at band 0 after tiles/UI/data dirties.
    bandState = null
  }
}
let needsRefine = false
/** ?restcache=0 restores the hand-back that draws the full frame at once. A build-only catch-up in progress (frames spent, start time), else null. */
const RESTCACHE_ON = params.get('restcache') !== '0'
let restCatchUp: { frames: number; since: number } | null = null
/** Freeze threshold for the full frame (ms); ?restbudget= overrides. */
const REST_BUDGET = Number(params.get('restbudget')) > 0 ? Number(params.get('restbudget')) : REST_BUDGET_MS
/** What a full-size rest frame costs here: learned from the frame drawn at each hand-back (see the loop), priced as max(GPU query, wall gap to the next frame). */
let restCost = EMPTY_REST_COST
/** The pending sample: when the full frame was drawn (0 = none), the unmet count it was drawn with, gpuTimer.fullFrame at that moment (the first different one is this draw's), its wall gap. */
let restDrawAt = 0
let restDrawUnmet = 0
let restDrawFF: unknown = null
let restDrawWall = -1
/** Set by render() when a build-only frame found the canvas size changed and did nothing: the caller abandons the catch-up. */
let renderAborted = false
/** Set when a build-only frame aborted on a canvas-size change: the next hand-back must be a normal render (it resizes the canvas), not another hold. Cleared by any normal draw. */
let restForceNormal = false
let scrubbingPrev = false
/** 0, or 1 once the coarse first step of a two-step refine has been drawn. */
let refineStep = 0
/** Budgeted-refine classes (BANDS_ON; `?bands=off` is the previous behaviour): after the last finger lifts the picture still counts as moving this long, so the next pinch of a pinch-zoom sequence does not pay a hand-back in between. Counted from the pointerup only; the common motion hold remains unchanged. */
const REFINE_RELEASE_HOLD_MS = 150
let wasDragging = false
let lastReleaseAt = -1e9
let dragStartAt = 0
let lastMoveAt = -1e9
/** True from the first moving frame of a gesture to its refine: the motion grid is held fixed in between. */
let gestureOn = false
/** Whether the last gesture frame was a user's (not a scripted camera move): picks snap or main's exposure behaviour for the settle after it. */
let gestureWasUser = false
/** The canvas pixel ratio last chosen at rest (0 = not yet). */
let restDpr = 0
/** Native shell non-desktop classes and the web's phone classes (R56): `?restgov=0` turns it off. Other web classes draw rest frames as before. */
const restGovernor = new RestDprGovernor(restGovernorOn(quality.detected.cls, !!nativeHost, location.search), phoneMotionOn() ? { recover: true, factorMin: PHONE_REST_FACTOR_MIN } : undefined)
let motionDpr = 1
/** Before GPU timing exists, desktop starts at 0.7 and lets measured frames lower it; mobile quality classes keep their own start policy. */
const START_MOTION_SCALE = (() => { const v = Number(new URLSearchParams(location.search).get('motionstart')); return MOTION_STEPS_START.includes(v) ? v : 0 })() || (knobs.motionStart ?? (quality.detected.cls === 'desktop' ? 0.7 : (window.devicePixelRatio || 1) ** 2 * innerWidth * innerHeight > 1.5e6 ? 0.35 : DEFAULT_MOTION_SCALE))
let motionScale = START_MOTION_SCALE
// ?flightscale=hyst: judge flights on GPU/fence time with 3-of-8 hysteresis, a 1.5 s dwell and at most 6 steps per flight (quality/flightScale.ts); default old.
// ?sharp=1 (quality/sharp.ts): a flight holds ONE grid (class and flight id), only an emergency steps it down; the grid is the only scale (no ratio factor); 30 fps (FLIGHT_GATE, frameLoop).
const flightScaleController = new FlightScaleLadder(sharpFlightStart(quality.sharp, quality.detected.cls, motionScale), flightScaleModeFor(quality.sharp, params.get('flightscale')))
const FLIGHT_GATE = new FrameGate(quality.sharp.flightFps)
/** ?flighthz=1 (on under ?sharp=1 unless ?flighthz=0): a scripted flight frame keeps the rest terrain march and skyline AA (uFlightHz). Not a gesture frame (#96). */
const FLIGHTHZ_ON = flightHzOn(params.get('flighthz'), quality.sharp.on)
let flightScaleLastGpuAt = 0
let flightScaleLastWallSeq = 0
let flightScaleWasActive = false
/** Sharp: the cinematic flight id the held grid was chosen for ('' = a fly-to or the intro), or null between flights. */
let sharpGridFor: string | null = null
let flightScaleLastPose: Pose | null = null
let flightScaleLastAt = 0
let ablExposure: ReturnType<typeof computeExposure> | null = null
let ablAhead: Ahead[] = []
let aheadOwner: unknown = null
let aheadEphemerisBucket = -1
let aheadLastNow = -1
let ablExposureAt = -1
let aheadCursor = 0
let lastExposureBlockMs = 0
let lastScale = 1
/** ?motionscale=0.25|0.5|...: forces the motion grid (no ladder), so a drag can be timed at two scales (GPU-bound if the frame time follows the pixel count). */
const FORCED_MOTION_SCALE = (() => { const v = Number(params.get('motionscale')); return v > 0.05 && v <= 1 ? v : 0 })()
let frameMs = 16
// Smoothed rAF interval for the tile pump's at-rest upload budget. Fed from every frameLoop tick (rAF runs at display rate even when nothing is dirty), never from the gap between draws: that gap is the idle interval at rest.
let tileFrameSmoothed = 16
/** The rAF interval smoothed over the current gesture's frames (ms), and how many frames the held grid has drawn. */
let rafMs = 0
let framesOnGrid = 0
/** The fence source's period model and sticky grid (post/motionGrid.ts FenceGrid): carried across gestures. */
const fenceGrid = new FenceGrid()
/** The fence pacer and FenceGrid are for touch classes (phone, tablet, iOS). A desktop whose Chrome lacks the timer query keeps the ladder it always had: at DPR 2 the grid fell to 0.25 and zoom presented 81 % against 94 %. */
const FENCE_PATH = (cls: string): boolean => cls === 'ios' || cls === 'ipad' || cls === 'phone-android' || cls === 'tablet'
const FENCE_CLASS = FENCE_PATH(quality.detected.cls)
/** The desktop class: the one class the rest-to-motion levers (`pace=rest`, `wallmem`, `motionstart=cost`) are on for by default (measured 2026-10-23); phone and fence classes keep their pacer and start policy. */
const DESKTOP_CLASS = quality.detected.cls === 'desktop'
/** The web frame cap (R56): phone, tablet and iOS draw at most 60 a second on a 90/120 Hz panel; `?fps=0` removes it, `?fps=N` sets it. Never in a capture. */
// The native build has its own 60 Hz cap (native/frameCap.ts, nativeCapAllows): two gates on one loop would drop each other's frames.
const FRAME_GATE = new FrameGate(nativeHost ? 0 : frameCapFps(quality.detected.cls, location.search))
/** A press, touch or key since the last admitted frame: the gate lets that frame through at once, so the cap never delays a gesture's first frame. Moves and wheel ticks are not urgent (they would defeat the cap). */
let gateUrgent = false
if (FRAME_GATE.periodMs > 0) for (const ev of ['pointerdown', 'touchstart', 'keydown']) document.addEventListener(ev, () => { gateUrgent = true }, { capture: true, passive: true })

/**
 * R57: a frame whose only reason is a tile fade is drawn at most this often (ms) on a class whose rest frame is over budget (fades.ts); 0 draws every frame.
 * `?fadebatch=0` turns it off, `?fadebatch=1` turns it on for every class. The fade values follow the clock, so a skipped frame loses a step, not time.
 */
// Read per frame since `?fadebatch=cost` (rest-to-motion, WP-A) follows the measured full-frame cost, which is learned after the first releases; the class rule is a constant.
const fadeCadenceNow = (): number => fadeCadenceMs(quality.detected.cls, undefined, restCostKnown(), 1000 / (displayRate.hz || 60))
/** The last tiles update was busy only because tiles are fading: no upload, decode, gate or shadow build is waiting (set where tiles.update runs). */
let tilesFadeOnly = false
/** The focus pull's split-prism indicator (post/focusScreenDriver.ts), off by default (`?focuspull=1` turns it on). */
const focusScreen = new FocusScreenDriver()
let fadeWake: ReturnType<typeof setTimeout> | null = null
/** One pending wake that asks for the next fade frame `ms` after the one just drawn (rendering is dirty-gated; nothing else would come). */
function wakeForFade(ms: number): void {
  if (fadeWake !== null) return
  fadeWake = setTimeout(() => { fadeWake = null; markDirty() }, ms)
}
/** The cheaper motion shader on gesture frames, every class: the Quality sheet's Motion detail row (Smooth is V1.1's default; #96 made it opt-in, #118 and phone-term restored it). `?motionshader=0|1` and `?phonemotion=0|1` seed the row. Read per call so a tap applies at once. */
function motionShaderOn(): boolean { return motionShaderFor(getQuality()) }
let visibilityCalibration: VisibilityCalibration | null = null
let auditHeld = false
let renderedFrameId = 0
let dateTransition: { from: string; to: string; began: number } | null = null
/** The scrub and Time-sheet date changes hold a move this long (the crossfade runs on a still camera). Viewpoint and pin picks hold nothing (PICK_FADE_HOLD_MS). */
const FADE_HOLD_MS = 300
/** A viewpoint or pin pick holds nothing: the camera moves on the first frame and the date blend runs under the move (owner R1 6:43, R2 1:00). */
const PICK_FADE_HOLD_MS = 0
/**
 * A pick's new date is carried along its move (journey/ephemCarry.ts): the Sun, the Earth and the stars go from the picture on screen to the
 * place's over the approach instead of turning on the first frame (owner report 2026-10-29, "the moon jumps to some other place"). `?datecarry=0`
 * restores the cut (diagnostic).
 */
const DATE_CARRY = new URLSearchParams(location.search).get('datecarry') !== '0'
let ephemCarry: EphemCarry | null = null
/** The fly-to the carry rides on (its progress is the carry's clock), or null for a move without one (a descent): journey/ephemCarry.ts step. */
let carryDriver: ScriptedTween | null = null
/** The layout aim easing to zero under a move that does not blend it itself (camera/aimRelease.ts); null when nothing is easing. */
let aimRelease: AimRelease | null = null
/** `?aimrelease=0`: the aim drops to 0 on a pick's first frame as before (diagnostic, the rig's A/B against the jump). */
const AIM_CUT = new URLSearchParams(location.search).get('aimrelease') === '0'
/** Centres the subject over AIM_RELEASE_MS from the aim on screen (a cut when `instant`), instead of jumping the picture by the aim on frame 1. */
function releaseAim(instant: boolean, now: number): void {
  aimRelease = null
  if (instant || AIM_CUT || (rig.aimShift === 0 && rig.aimShiftX === 0)) { rig.aimShift = 0; rig.aimShiftX = 0; return }
  aimRelease = new AimRelease(rig.aimShiftX, rig.aimShift, now)
  markDirty()
}
/**
 * Starts carrying the shown sky from `before` (the ephemeris on screen before the pick set the place's) to the current `ephem`, over the move
 * the pick just started: the fly-to's remaining time (the flight or orbit it hands over to then samples the place's own ephemeris, so the carry
 * must be over by the join), a descent's first part, else CARRY_MIN_MS.
 */
function carryDate(before: Ephemeris, instant: boolean): void {
  if (!DATE_CARRY || instant || STILL) { ephemCarry = null; deferredClockCamera = null; return }
  // The same place's date again (a moment replayed once its tiles or patch arrived, after approachSite): the running carry goes on toward it.
  if (ephemCarry && ephemCarry.target.date.getTime() === ephem.date.getTime()) { deferredClockCamera = null; ephemCarry.retarget(ephem); if (tween) { ephemCarry.newDriver(); carryDriver = tween } return }
  ephemCarry = null
  if (samePicture(before, ephem)) {
    if (deferredClockCamera) rig.keepWorldPosition(ephem, deferredClockCamera, performance.now())
    deferredClockCamera = null
    return
  }
  deferredClockCamera = null
  const now = performance.now()
  const ms = tween ? tween.t0 + tween.plan.ms - now : descent ? descent.ms : CARRY_MIN_MS
  // The offset's time base is the fly-to's whole length (its progress is what the carry rides on), not the remaining time of a late hand-off.
  const carryMs = Math.max(CARRY_MIN_MS, Math.min(CARRY_MAX_MS, ms))
  ephemCarry = new EphemCarry(before, ephem, now, carryMs)
  carryDriver = tween
  markDirty()
}
/** One step of the date carry (journey/ephemCarry.ts) on the frame loop's clock. */
function stepDateCarry(now: number): void {
  if (!ephemCarry) return
  // One clock with the camera: the fly-to's own progress while it runs (or once it has ended: 1, the hand-over); a fly-to cancelled before its
  // end (a grab, Stop) leaves the carry on its own clock from the weight on screen.
  const d = carryDriver
  const progress = d && (d === tween || now >= d.t0 + d.plan.ms) ? tweenProgress(d, now) : undefined
  if (d && progress === undefined) carryDriver = null
  const c = ephemCarry.step(now, ephem, progress)
  if (!c || c.done) ephemCarry = null
  // The carry moves the light: it is motion for the resolution policy until it ends (markMoved, not markDirty). A carry that outlives its fly-to
  // (a grab or Stop dropped the move, or no move: the own clock over CARRY_MIN_MS) otherwise let the hand-back draw full-size frames, and its refine
  // crossfade blend the last motion frame's Sun under a Sun still moving, while the light went on turning.
  if (c) { ephem = c.e; markMoved(); because('dateCarry') }
}
let dateHoldAt = -1e9
let dateHoldFor = FADE_HOLD_MS
/**
 * Crossfades the last drawn frame into the next ones over `ms` and, when `hold`, makes a fly-to started this frame wait for it.
 * The fade is a picture change of its own (a date), so it is marked as one here: the gesture start's
 * `if (!dateTransition) final?.cancelDateTransition()` (frame loop) drops only a refine composite. Unmarked, a link's lighting fade began in the event
 * and the markMoved that came with the new Sun started a gesture on the next frame, which cancelled it before its first frame was drawn: a cut.
 */
function fadeFrame(ms: number, hold: boolean): void {
  if (!last || !final) return
  const now = performance.now()
  final.beginDateTransition(renderer, targets.get(last.w, last.h), last.exposure, now, ms)
  dateHoldAt = hold ? now : -1e9
  dateHoldFor = ms
  dateTransition = { from: time.toISOString(), to: time.toISOString(), began: now }
}
/**
 * `holdMs` 0: the camera does not move during the crossfade (a scrub or a cut), so the full 0.6 s frame blend is safe. A journey
 * passes its hold: the blend runs that long on the still camera and `flyTo` starts its move after it.
 */
const scrubGate = new ScrubGate()
function beginDateChange(next: Date, holdMs = 0, journeyStart = false): void {
  if (next.getTime() === time.getTime() || !last || !final) return
  // A continuous scrub (the slider, a drag of the clock) changes the picture a little every frame: the crossfade would be a full extra final pass per
  // event and a ghost of the previous frame. Only a jump (a first change, or one after a pause) fades; a journey's held fade always runs.
  if (scrubGate.note(performance.now()) && holdMs === 0 && !journeyStart) return
  // A moment's start moves the camera at once: blending the frozen old picture under that move leaves a fixed ghost edge (R4). `?datefade=1` restores it.
  if (!dateChangeCrossfades(holdMs, journeyStart, params.get('datefade') === '1')) return
  fadeFrame(holdMs > 0 ? holdMs : DATE_CROSSFADE_MS, holdMs > 0)
  dateTransition = { from: time.toISOString(), to: next.toISOString(), began: performance.now() }
}
/** How long a move started at `now` waits: the rest of the crossfade begun this very frame, else none. */
function dateHoldMs(now: number): number { return now - dateHoldAt < 50 ? dateHoldFor : 0 }
/**
 * The last frame drawn: its camera (world space) and the ephemeris it was drawn with. The date carry steps `ephem` on every loop pass, also on
 * one the pacer does not draw, so settling the rig to `cam` against the CURRENT ephemeris put the camera into a newer body frame than the
 * picture on screen: the surface moved by one carry step of the Moon's orientation (rig 2026-10-29, phone flight-earthrise: 1.18 deg of
 * longitude, a 1.7 % position step, on the pick's first frame). Settles to `cam` use `ephem` here.
 */
let last: { cam: ViewCamera; ephem: Ephemeris; exposure: Exposure; w: number; h: number; cw: number; ch: number } | null = null
let lastCreditsRefresh = -Infinity
/** The clock time the last drawn camera was computed for (measurement: `__moon.camState().at`). */
let lastCamAt = 0

// ---------------------------------------------------------------------------
// The centre caption. The render path publishes the camera of the scene it PRESENTED (never a camera that was only selected: buildOnly frames, unfinished
// bands and final-only redraws do not present a new scene); the controller (labels/centreCaptionCore.ts) turns that into a pause and a name.
// ---------------------------------------------------------------------------
let centreCtl: CentreCaption | null = null
/** The last pointer, wheel or key event: the centre caption's pause starts here while the camera settles (coast, level). */
let lastUserInputAt = -Infinity
for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'wheel', 'keydown', 'keyup']) window.addEventListener(type, () => { lastUserInputAt = performance.now() }, { capture: true, passive: true })
let centreUi: CentreCaptionUi | null = null
/** The lock-style caption (the same object as centreUi), or null with ?labelstyle=classic. */
let centreLock: LockLabelUi | null = null
/** Which camera belongs to the scene on screen, and which one wrote the Moon's hit target (labels/centreScene.ts). */
const presentedScene = new PresentedScene()
/** The read in flight: a synthetic sphere result (relief off) or the camera that drew the hit target. */
let centreSphere: ReadResult | null = null
let centreReadCam: { cam: CamSample; w: number; h: number } | null = null
/** The surface generation the read in flight was started for (a result for another generation is stale). */
let centreReadGen = 0
let centreWhy = ''
/** The CPU estimate of the surface along a ray: the retained height level at the effective relief scale (reliefShare x height fade). */
function centrePredict(pos: readonly [number, number, number], dir: readonly [number, number, number]): ReturnType<typeof fallbackHit> {
  const relief = reliefShare(Math.hypot(pos[0], pos[1], pos[2])) * (moon.uniforms.uHeightMix.value as number)
  return fallbackHit(pos, dir, { sampleM: (lon, lat) => sampleGlobalHeightM(maps.height, lon, lat), pending: !!maps.height.pending, halfErrorM: maps.height.halfErrorM }, relief)
}
const centreHost: CaptionHost = {
  why: () => centreWhy,
  readable: () => !!renderer && moon.centreReadPossible(renderer),
  beginRead(): boolean {
    const snap = presentedScene.current
    if (!snap || !renderer) { centreWhy = 'noSnapshot'; return false }
    if (moon.centreReadPending) moon.cancelCentreRead(renderer)
    centreReadGen = presentedScene.generation
    // With the relief off the drawn surface is the sphere exactly: nothing to read.
    if (!((moon.uniforms.uTerrain.value as number) > 0)) { centreSphere = { kind: 'hit', cam: snap, rangeRadii: 0, w: 0, h: Math.max(64, last?.h ?? 1080), gen: centreReadGen }; return true }
    const drawn = presentedScene.hit
    if (!drawn) { centreWhy = moon.hitShared ? 'bandedOrOlderSurface' : 'hitNotShared(class/patch/relief)'; return false }
    if (!moon.beginCentreRead(renderer)) { centreWhy = 'beginFailed'; return false }
    centreReadCam = drawn
    return true
  },
  pollRead(): ReadResult | null | undefined {
    if (centreSphere) { const r = centreSphere; centreSphere = null; return r }
    const drawn = centreReadCam
    if (!drawn) return null
    const r = moon.pollCentreRead(renderer)
    if (!r) return undefined
    centreReadCam = null
    // The target must be the one the scene's hit was written to, at its original size; the pixel error uses that size, not the current canvas.
    if (r.w !== drawn.w || r.h !== drawn.h) { centreWhy = `targetSize ${r.w}x${r.h} vs ${drawn.w}x${drawn.h}`; return null }
    if (r.cover <= 0) return { kind: 'sky', gen: centreReadGen }
    return { kind: 'hit', cam: drawn.cam, rangeRadii: r.range, w: r.w, h: r.h, ix: r.ix, iy: r.iy, gen: centreReadGen }
  },
  fallback(s: CamSample) { return centrePredict(s.pos, centreDir(s)) },
  predict: (pos, dir) => centrePredict(pos, dir),
}
/** Any sheet other than the Time sheet is open (Time scrubbing keeps the camera and the name). */
function otherSheetOpen(): boolean {
  if (!bar?.sheetOpen()) return false
  const open = document.querySelectorAll('.dock .bar-sheet:not([hidden])')
  return !(open.length === 1 && open[0].id === 'bar-time')
}
/** The features the active viewpoint's pill already names, or null once the visitor has moved away from it (every manual camera move marks the navigator away). */
function activeViewpointFeatures(): readonly string[] | null {
  const n = navApi?.state()
  if (!n || !n.state.pos || n.state.away) return null
  const entry = n.entries[n.state.pos.entry]
  return entry ? VIEWPOINT_FEATURES[entry.id] ?? null : null
}
/** The camera is being moved (a gesture, a glide, any flight): the map labels thin, the lock label waits. */
function cameraMoving(): boolean {
  return gestureOn || rig.dragging || rig.gliding() || !!(tween || cinematicFlight || flight || routeFlight || orbitJourney || intro?.moving || ridge)
}
function stepCentreCaption(now: number): void {
  if (!centreCtl || !centreUi) return
  const off = auditHeld || !!captureSession
  const ctx = {
    // With the Labels layer on, the names are already on the Moon: the centre caption stays quiet.
    enabled: CAPTION_ON && !off && !ABL.has('dom0') && !labelsApi?.isOn(), hidden: document.hidden, panorama: !!panoramaUi?.isOpen(), sheet: otherSheetOpen(),
    preserveMovingLock: LABEL_STYLE === 'lock',
    splash: document.body.classList.contains('intro-on') || !!intro?.active, dragging: rig.dragging, moving: cameraMoving(), usable: centreUi.usable(), viewpointFeatures: activeViewpointFeatures(),
  }
  const view = centreCtl.step(now, ctx)
  const geometry = centreLock
    ? centreLock.frame(view, {
      moving: cameraMoving(),
      suppressed: !ctx.enabled || ctx.hidden || ctx.panorama || ctx.sheet || ctx.splash,
      cam: centreCtl.camera,
    })
    : centreUi.apply(view)
  // A change of the caption's rect re-places the map labels once, without a GPU redraw.
  if ((centreCtl.consumeDomDirty() || geometry) && last) updateLabelsDom()
}

interface CreditSurfaceSample { lon: number; lat: number; colorFpKm: number; heightFpKm: number; fpM: number }
function creditsAtCurrentView(): ReadonlySet<import('./ui/credits').CreditId> {
  const frame = last
  if (!frame) return selectCredits({ moonVisible: false, lunarTilesVisible: false, polarWacVisible: false, sitePatchVisible: null, apollo17TierVisible: false, apollo17FlightVisible: false, lunarModuleVisible: false, earthVisible: false, starsVisible: false })
  const cam = frame.cam
  const earthCentre = ephem.earthKm.clone().divideScalar(MOON_R_KM)
  const earthRadius = EARTH_R_KM / MOON_R_KM
  const earthVisible = params.get('noearth') !== '1' && sphereVisibleInFrame(
    { pos: cam.pos.toArray() as [number, number, number], right: cam.right.toArray() as [number, number, number], up: cam.up.toArray() as [number, number, number], back: cam.back.toArray() as [number, number, number], tanHalf: cam.tanHalf, aspect: frame.cw / Math.max(1, frame.ch) },
    earthCentre.toArray() as [number, number, number], earthRadius,
    [{ centre: [0, 0, 0], radius: 1 }],
  )
  const camera = { pos: cam.pos.toArray() as [number, number, number], right: cam.right.toArray() as [number, number, number], up: cam.up.toArray() as [number, number, number], back: cam.back.toArray() as [number, number, number], tanHalf: cam.tanHalf, aspect: frame.cw / Math.max(1, frame.ch) }
  const sphereHit = (origin: THREE.Vector3, direction: THREE.Vector3, centre: THREE.Vector3, radius: number): number =>
    creditSurfaceHit(origin.toArray() as [number, number, number], direction.toArray() as [number, number, number], centre.toArray() as [number, number, number], radius)
  const samples: CreditSurfaceSample[] = []
  if (!groundMode?.active) {
    const tanPerPx = cam.tanHalf / Math.max(1, frame.ch / 2)
    for (const [sx, sy] of [[0, 0], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]] as const) {
      const ray = cam.back.clone().negate().addScaledVector(cam.right, sx * cam.tanHalf * camera.aspect).addScaledVector(cam.up, sy * cam.tanHalf).normalize()
      const hit = sphereHit(cam.pos, ray, new THREE.Vector3(), 1)
      if (!Number.isFinite(hit)) continue
      const earthHit = params.get('noearth') === '1' ? Infinity : sphereHit(cam.pos, ray, earthCentre, earthRadius)
      if (earthHit < hit) continue
      const point = cam.pos.clone().addScaledVector(ray, hit).normalize()
      const lon = Math.atan2(point.dot(ephem.moonY), point.dot(ephem.moonX)) * 180 / Math.PI
      const lat = Math.asin(Math.max(-1, Math.min(1, point.dot(ephem.moonZ)))) * 180 / Math.PI
      const view = cam.pos.clone().sub(point).normalize()
      const mu = Math.max(0.15, point.dot(view))
      const minorKm = hit * MOON_R_KM * tanPerPx
      samples.push({ lon, lat, colorFpKm: effectiveFootprintKm(minorKm, mu), heightFpKm: minorKm / mu, fpM: minorKm / mu * 1000 })
    }
  }
  const moonVisible = !groundMode?.active && sphereVisibleInFrame(camera, [0, 0, 0], 1, earthVisible ? [{ centre: earthCentre.toArray() as [number, number, number], radius: earthRadius }] : [])
  let lunarTilesVisible = false, polarWacVisible = false, jaxaTcVisible = false
  let sitePatchVisible: 'a11' | 'a17' | null = null, apollo17TierVisible = false
  if (moonVisible && tiles && params.get('tiles') !== 'off') {
    const detailGateAt = (fp: number): number => {
      const x = Math.max(0, Math.min(1, (fp / GLOBAL_TEXEL_KM - 0.5) / 0.4))
      const tileGate = 1 - x * x * (3 - 2 * x)
      return params.get('tiles') === 'off' ? 0 : tileGate
    }
    for (const sample of samples) {
      if (tiles.sourceAt(sample.lon, sample.lat, sample.colorFpKm, sample.heightFpKm, GLOBAL_TEXEL_KM)) lunarTilesVisible = true
      if (tiles.detail && detailStrength() > 0) {
        const sources = tiles.detail.sourcesAt(sample.lon, sample.lat, sample.colorFpKm, detailGateAt(sample.colorFpKm), 0)
        polarWacVisible ||= sources.polar
        lunarTilesVisible ||= sources.global
      }
      if (tiles.tc && tcGain() > 0) jaxaTcVisible ||= tiles.tc.sourceAt(sample.lon, sample.lat, sample.colorFpKm, detailGateAt(sample.colorFpKm))
    }
  }
  if (moonVisible && patch && patchIsDrawn({ hasPatch: true, patchState, boundLevels: moon.boundLevels })) {
    for (const sample of samples) {
      const region = finestRegionAt(sample.lon, sample.lat)
      if (region?.site !== patchSiteId) continue
      const activeLevels = patch.sourceLevelsAt(sample.lon, sample.lat, sample.fpM)
      if (!activeLevels.length) continue
      sitePatchVisible = patchSiteId === 'a11' ? 'a11' : patchSiteId === 'a17' ? 'a17' : sitePatchVisible
      if (patchSiteId === 'a17' && patch.manifest.tier && patch.levels.slice(-2).some((level) => activeLevels.includes(level.name))) apollo17TierVisible = true
    }
  }
  if (groundMode?.active && patch && patchSiteId === 'a17' && patchIsDrawn({ hasPatch: true, patchState, boundLevels: moon.boundLevels })) {
    // The visible ground, not the centre ray alone: with the horizon at mid-screen the centre sees sky while the lower frame is site ground.
    const view = groundMode.view(), basis = groundBasis(view)
    const targets = groundCreditTargets(
      { pos: [view.pos.x, view.pos.y, view.pos.z], right: basis.right.toArray() as [number, number, number], up: basis.up.toArray() as [number, number, number], back: basis.back.toArray() as [number, number, number], tanHalf: view.tanHalf, aspect: frame.cw / Math.max(1, frame.ch) },
      groundMode.groundZ(view.pos.x, view.pos.y), groundMode.rangeM,
    )
    for (const t of targets) {
      const target = lonLatAtOffset(patch.manifest.site.lon, patch.manifest.site.lat, t.e + groundMode.patchOffEN[0], t.n + groundMode.patchOffEN[1])
      const fpM = t.rangeM * view.tanHalf / Math.max(1, frame.ch / 2)
      const activeLevels = patch.sourceLevelsAt(target.lon, target.lat, fpM)
      if (!activeLevels.length) continue
      sitePatchVisible = 'a17'
      if (patch.manifest.tier && patch.levels.slice(-2).some((level) => activeLevels.includes(level.name))) apollo17TierVisible = true
    }
  }
  const flightBasis = flightFrame ? groundBasis(flightFrame.view) : null
  const lunarModuleVisible = (!!groundMode?.active && !!groundMode.lm && groundMode.fillInView(frame.cw / Math.max(1, frame.ch)))
    || (!!flightFrame && !!flightBasis && sphereVisibleInFrame(
      { pos: flightFrame.view.pos.toArray() as [number, number, number], right: flightBasis.right.toArray() as [number, number, number], up: flightBasis.up.toArray() as [number, number, number], back: flightBasis.back.toArray() as [number, number, number], tanHalf: flightFrame.view.tanHalf, aspect: frame.cw / Math.max(1, frame.ch) },
      flightFrame.lm.pos.toArray() as [number, number, number], 8,
    ))
  let skyVisible = false
  const sunCentre = ephem.sunKm.clone().divideScalar(MOON_R_KM)
  for (const [sx, sy] of [[0, 0], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]] as const) {
    const ray = cam.back.clone().negate().addScaledVector(cam.right, sx * cam.tanHalf * camera.aspect).addScaledVector(cam.up, sy * cam.tanHalf).normalize()
    const moonHit = sphereHit(cam.pos, ray, new THREE.Vector3(), 1)
    const earthHit = params.get('noearth') === '1' ? Infinity : sphereHit(cam.pos, ray, earthCentre, earthRadius)
    const sunHit = sphereHit(cam.pos, ray, sunCentre, SUN_R_KM / MOON_R_KM)
    if (![moonHit, earthHit, sunHit].some((hit) => Number.isFinite(hit))) { skyVisible = true; break }
  }
  const context: CreditsContext = {
    moonVisible, lunarTilesVisible, polarWacVisible, jaxaTcVisible, sitePatchVisible, apollo17TierVisible,
    apollo17FlightVisible: !!flight, lunarModuleVisible, earthVisible,
    starsVisible: (!!stars && starsLevel > 0 && starsOn && skyVisible),
  }
  return selectCredits(context)
}
hud.setCreditsProvider(creditsAtCurrentView)

function markMoved(): void {
  lastMoveAt = performance.now()
  needsRefine = true
  markDirty()
}

/** Canvas height in device pixels, as the streamer's `ch` (flight prefetch sizes its feature cap with it). */
function canvasHeightPx(): number {
  return captureSize?.height ?? Math.max(64, Math.round(canvas.clientHeight * (captureSession ? 1 : restDpr || window.devicePixelRatio || 1)))
}
function canvasAspect(): number {
  return Math.max(1e-3, canvas.clientWidth / Math.max(1, canvas.clientHeight))
}

// Clip to world for the far plane only, which is all cameraRay reads. The
// near plane sits at half the far one: with near << far the far plane's w
// is a difference of two large numbers, and in float32 at the Earth view's
// 0.6 deg field that error moves rays by tens of pixels.
const FAR = 1e4
const NEAR = FAR / 2
function cameraMatrices(cam: ViewCamera, w: number, h: number): { invViewProj: THREE.Matrix4; viewRotProj: THREE.Matrix4 } {
  const top = NEAR * cam.tanHalf
  const right = top * (w / h)
  const proj = new THREE.Matrix4().makePerspective(-right, right, top, -top, NEAR, FAR)
  const rot = new THREE.Matrix4().makeBasis(cam.right, cam.up, cam.back)
  const world = rot.clone().setPosition(cam.pos)
  return {
    invViewProj: world.multiply(proj.clone().invert()),
    // Stars are at infinity: the rotation alone.
    viewRotProj: proj.multiply(rot.transpose()),
  }
}

/**
 * SUN_WHITE_IF when the Sun's disc is in the frame and neither the Earth nor
 * the Moon hides it: the frame is then exposed for the Sun, as a camera
 * pointed at it would be, instead of flooding in glare. 0 otherwise.
 */
// Hysteresis: once the Sun counts as in frame it stays so until it is clearly
// out (a margin past the edge; a disc just showing past the Moon's limb),
// so a slow orbit that grazes the edge does not flip the exposure back and forth.
let sunOn = false
let moonSubjectOn = false
let moonDiscOn = false
let glareScaleCur: number | null = null
/** Set per frame before the bodies: terrain or the lander is drawn over the sky (ground mode, the ridge view, a flight's lander). */
let sunForeground = false
/** The same frames, when the scene target's depth attachment holds that foreground (ground mode, a flight's lander; not the ridge view): the final pass hides the Sun by it. */
let sunCoverage = false
let glareScaleAt = 0
/**
 * The camera looks at the Sun: the Sun button's turn, or the solar-eclipse flight while its gaze is on the Sun (it blends the Moon's centre
 * toward the Sun, which the rig does not know as SUN_LOOK). Either way the frame is exposed for the Sun and its glare comes in with the exposure.
 */
/** The same flag while a film of the eclipse flight is captured (the capture path samples the flight itself, not stepCinematic). */
let captureSunLook = false
function sunLookNow(): boolean { return rig.looksAt(SUN_LOOK) || !!cinematicFlight?.sunLook || captureSunLook }
function sunWhiteIF(cam: ViewCamera, aspect: number): number {
  const subject = moonIsSubject(cam, aspect)
  const result = sunInFrame({ camera: cam, aspect, sunPosition: ephem.sunKm.clone().divideScalar(MOON_R_KM), earthPosition: ephem.earthKm.clone().divideScalar(MOON_R_KM), sunWhite: SUN_WHITE_IF, wasOn: sunOn, moonSubject: subject, wasMoonInFrame: moonDiscOn, sunLook: sunLookNow() })
  sunOn = result.on
  moonDiscOn = result.moonInFrame
  return result.white
}
/**
 * The Moon's centre well inside the frame (and the camera in orbit, not on the ground) makes the Moon the subject. The Sun peeking over its limb, or the Earth
 * a few pixels wide at the edge of the frame, are then glare and scenery to leave as they fall, not white points to expose for: the Circle the Moon orbit went
 * black for ~3 s each time the Sun reached the field, and every Earth-in-frame second exposed the Moon five stops down (audit 7).
 */
/** The share of the Sun's clamped-disc glare kept while the Moon is the subject: the Sun stays a bright dot at the edge, not a flood. */
const MOON_SUBJECT_SUN_GLARE = SUBJECT_SUN_GLARE
function moonIsSubject(cam: ViewCamera, aspect: number, update = true): boolean {
  const subject = moonSubjectInFrame(cam, aspect, moonSubjectOn)
  if (update) moonSubjectOn = subject
  return subject
}
/**
 * The share of the Sun's clamped-disc glare to draw. While a scripted view turns to the Sun, the picture is still in the long
 * exposure (hdr near 1: it was keyed for stars while nothing bright was in view) until the disc arrives and the exposure catches up. The veil of a Sun
 * not yet on screen, seen through that long exposure, washes the whole frame grey for a second and then fades: pumping. It is held back by the share of
 * the picture still on the long exposure, so it comes in with the exposure and the arrival is one continuous brightening.
 */
function sunGlareScale(cam: ViewCamera, aspect: number, hdr: number): { target: number; continuous: boolean } {
  if (moonIsSubject(cam, aspect)) return { target: MOON_SUBJECT_SUN_GLARE, continuous: false }
  if (sunLookNow()) return { target: Math.max(0, 1 - hdr), continuous: true }
  return { target: 1, continuous: false }
}
function smoothSunGlareScale(target: number, now: number, continuous = false): number {
  const dt = Math.min(0.1, Math.max(0, now - glareScaleAt) / 1000)
  glareScaleAt = now
  glareScaleCur = stepGlareScale(glareScaleCur, target, dt, continuous || STILL || exposureCutFrames > 0)
  return glareScaleCur
}
function sunWhiteRaw(cam: ViewCamera, aspect: number, on: boolean, subject = moonSubjectInFrame(cam, aspect, false), sunLook = sunLookNow()): number {
  return sunInFrame({ camera: cam, aspect, sunPosition: ephem.sunKm.clone().divideScalar(MOON_R_KM), earthPosition: ephem.earthKm.clone().divideScalar(MOON_R_KM), sunWhite: SUN_WHITE_IF, wasOn: on, moonSubject: subject, sunLook }).white
}

/**
 * The I/F the exposure should map to white for the Earth: EARTH_WHITE_IF when
 * a sunlit part of its disc is in the frame; RING_WHITE_IF when the Sun is
 * behind it (the refracted ring is then the brightest thing in the frame);
 * 0 when neither, or from the Earth's centre.
 */
function earthWhiteIF(cam: ViewCamera, aspect: number, peek = false): number {
  const sunW = peek ? sunWhiteRaw(cam, aspect, sunOn) : sunWhiteIF(cam, aspect)
  if (sunW > 0) return sunW
  if (moonIsSubject(cam, aspect, !peek)) return 0
  const rel = ephem.earthKm.clone().divideScalar(MOON_R_KM).sub(cam.pos)
  const dist = rel.length()
  if (dist * MOON_R_KM < 1.5 * EARTH_R_KM) return 0
  const dir = rel.divideScalar(dist)
  const back = dir.dot(cam.back)
  if (back >= 0) return 0
  const x = dir.dot(cam.right) / -back, y = dir.dot(cam.up) / -back
  const rho = EARTH_R_KM / (dist * MOON_R_KM)
  if (Math.abs(x) > cam.tanHalf * aspect + rho || Math.abs(y) > cam.tanHalf + rho) return 0
  // Sunlit share of the disc seen from here: the Sun-Earth-camera angle.
  const toSun = ephem.sunKm.clone().sub(ephem.earthKm).normalize()
  const toCam = cam.pos.clone().multiplyScalar(MOON_R_KM).sub(ephem.earthKm).normalize()
  if ((1 + toSun.dot(toCam)) / 2 > 0.03) return EARTH_WHITE_IF
  // Sun behind the Earth as this camera sees it: the ring pass runs.
  const sV = ephem.sunKm.clone().divideScalar(MOON_R_KM).sub(cam.pos).normalize()
  const perp = sV.clone().addScaledVector(dir, -sV.dot(dir))
  return perp.length() < 0.03 && sV.dot(dir) > 0 ? RING_WHITE_IF : 0
}

/** The Earth's shadow on the Moon's Earth-facing point (the whole disc in the Earth view). */
function earthShadowState(): 'none' | 'partial' | 'total' {
  const d = luminance(earthShadowOnMoonParts(
    [ephem.earthDir.x, ephem.earthDir.y, ephem.earthDir.z],
    [ephem.sunKm.x / MOON_R_KM, ephem.sunKm.y / MOON_R_KM, ephem.sunKm.z / MOON_R_KM],
    [ephem.earthKm.x / MOON_R_KM, ephem.earthKm.y / MOON_R_KM, ephem.earthKm.z / MOON_R_KM],
  ).direct)
  return d >= 0.999 ? 'none' : d < 0.02 ? 'total' : 'partial'
}

// The highlight shoulder changes between orbit's and ground mode's curve over ~0.4 s, so bright slopes do not step at the hand-over (captures jump).
let shoulderMix = 0
let lastShoulderAt = 0
function easedShoulder(ground: boolean, now: number): number {
  const target = ground ? 1 : 0
  if (STILL) shoulderMix = target
  else {
    const step = Math.min(0.1, Math.max(0, now - lastShoulderAt) / 1000) / 0.4
    shoulderMix = Math.abs(target - shoulderMix) <= step ? target : shoulderMix + Math.sign(target - shoulderMix) * step
    if (shoulderMix !== target) markDirty()
  }
  lastShoulderAt = now
  return shoulderMix
}

const exposureControl = new ExposureController()
/** A scratch rig for sampling the cameras a fly-to will have (aheadCameras). */
const aheadRig = new CameraRig()
/**
 * A change of picture the page itself caused (a click on a moment, a date set, a teleport, a mode hand-over): the exposure may then
 * snap to the new picture's white point. Anything else that moves the raw white by over a stop is slewed unless it lasts two frames.
 * Lives for a few frames, since the camera's own move can start a frame after the click.
 */
let exposureCutFrames = 0
function declareExposureCut(kind = 'event'): void {
  exposureCutFrames = 3
  heldGestureWhite = 0
  // A cut is a new picture: the last rest frame's white belongs to the old one. Left in place, a pin's flight (which counts as a gesture) would
  // hold it and the arrival would be exposed up to a stop away from its own frame (the far side on a phone: white at half its brightest, a flat white disc).
  restFrameWhite = 0
  // The virtual-user gate (audit/) reads this log: a step of the picture at a declared cut is a cut, not pumping.
  cutLog.push({ t: performance.now(), kind })
}
/** Debug readout (api.exposureState): the last frame's raw and controlled white point, I/F. */
let lastExposureInfo: { searchHits: number; rawWhite: number; white: number; aheadWhite: number[]; aheadHdr: number[]; aheadT: number[]; hdr: number; longMax: number } | null = null

/** How far ahead the exposure looks on a scripted journey, s: the camera it will have at each offset asks for its own exposure. */
/**
 * The cameras a dolly zoom, a look turn or a descent will have over the next seconds (all pure in time), so the exposure can be
 * ready before the bright thing arrives. None for the ridge, ground mode and the flight, and none when the camera is at rest.
 */
function aheadCameras(now: number, aspect: number): { t: number; cam: ViewCamera }[] {
  const out: { t: number; cam: ViewCamera }[] = []
  if (intro?.moving) {
    // The opening is pure in time as well.
    for (const t of AHEAD_S) { const c = intro.camera(rig.camera(ephem, aspect, now + t * 1000), now + t * 1000); if (c) out.push({ t, cam: c }) }
  } else if (tween) {
    // A scripted fly-to is pure in time: the camera it will have at each offset (the planner's plan, one scratch rig) asks for its own exposure.
    aheadRig.dMin = rig.dMin; aheadRig.site = rig.site
    const tw = tween
    const camAt = (t: number): ViewCamera => {
      const sample = tweenAt(tw, now + t * 1000)
      aheadRig.setPose(sample.pose)
      aheadRig.fovDeg = sample.fov
      aheadRig.aimShift = sample.aim
      aheadRig.aimShiftX = sample.aimX
      aheadRig.setLookBlend(sample.look, resolveLook('earth'))
      return aheadRig.camera(ephem, aspect, now + t * 1000)
    }
    for (const t of AHEAD_S) out.push({ t, cam: camAt(t) })
    // The Sun's disc arriving beside the Earth is a jump of many stops: announce it from the whole rest of the move, not only the
    // next 3 s, so the white point ramps (at the rising rate) instead of snapping when it appears.
    if (tw.plan.to.look === 1) {
      const remaining = Math.max(0, tw.t0 + tw.plan.ms - now) / 1000
      const arrive = sunArrivalAheadS((t) => sunWhiteRaw(camAt(t), aspect, false, undefined, true) > 0, remaining)
      if (arrive !== null) out.push({ t: arrive, cam: camAt(arrive) })
    }
  } else if (cinematicFlight && cinematicFlight.definition.kind === 'eclipse' && cinematicFlight.t0 >= 0 && cinematicFlight.pausedU === null) {
    // The eclipse flight lifts its gaze to the Sun and turns away again: pure in time, so the exposure is told of the Sun's arrival as a look turn's is.
    const cf = cinematicFlight, secs = cf.definition.seconds
    aheadRig.dMin = rig.dMin; aheadRig.site = rig.site
    const camAt = (t: number): ViewCamera => {
      const shot = sampleFlight(cf.definition, Math.min(1, Math.max(0, (now + t * 1000 - cf.t0) / (secs * 1000))), ephem, (lon, lat) => rig.floorAt(lon, lat), (lon, lat) => rig.groundAt(lon, lat))
      aheadRig.setPose(shot.pose)
      aheadRig.fovDeg = shot.fovDeg
      aheadRig.aimShift = 0
      aheadRig.aimShiftX = 0
      aheadRig.setLookBlend(shot.look, flightAim(shot, ephem))
      return aheadRig.camera(ephem, aspect, now + t * 1000)
    }
    for (const t of AHEAD_S) out.push({ t, cam: camAt(t) })
    // The Sun can only be in the frame in the first part of the flight: probe only that window, not all 40 s each frame.
    const remaining = Math.max(0, cf.t0 + secs * 1000 * ECLIPSE_SUN_BEAT_U - now) / 1000
    const arrive = remaining <= 0 ? null : sunArrivalAheadS((t) => sunWhiteRaw(camAt(t), aspect, false, undefined, true) > 0, remaining)
    if (arrive !== null) out.push({ t: arrive, cam: camAt(arrive) })
  } else if (rig.lookingAt(now) && !descent) {
    // A look turn (the Sun button) is pure in time too: ask each future camera for its own exposure, and announce the Sun's arrival from the whole rest of the turn.
    for (const t of AHEAD_S) out.push({ t, cam: rig.camera(ephem, aspect, now + t * 1000) })
    const remaining = rig.lookRemainingS(now)
    const arrive = sunArrivalAheadS((t) => sunWhiteRaw(rig.camera(ephem, aspect, now + t * 1000), aspect, false, undefined, true) > 0, remaining)
    if (arrive !== null) out.push({ t: arrive, cam: rig.camera(ephem, aspect, now + arrive * 1000) })
  } else if (descent && descent.t0 >= 0 && descent.from) {
    const saved = { ...rig.pose }
    for (const t of AHEAD_S) {
      const u = Math.min(1, (now + t * 1000 - descent.t0) / descent.ms)
      rig.setPose(descentPose(u, descent.from, descent.alt0, descent.slide))
      out.push({ t, cam: rig.camera(ephem, aspect, now) })
    }
    rig.pose = saved
  }
  return out
}

const round2 = (v: number): number => Math.round(v * 100) / 100
/** The patch line for the HUD: over the site and down to a few metres per pixel (see patchResolutionLine), and what light the photograph has. */
function patchHudInfo(cam: ViewCamera, canvasTanPerPx: number): HudInfo['patchLine'] {
  const site = loadedSite()
  if (!patch || !site || patchState !== 'ready') return null
  const u = underCamera(ephem, cam.pos)
  const s = patch.manifest.site
  if (angularDistance(u.lon, u.lat, s.lon, s.lat) > 0.005) return null
  const altKm = (cam.pos.length() - 1) * MOON_R_KM - siteGround(rig.site ?? { lon: s.lon, lat: s.lat, groundR: patch.groundR, altR: 0 }, u.lon, u.lat) * MOON_R_KM
  return {
    pxM: altKm * 1000 * canvasTanPerPx, imageM: round2(patch.finest.texelM), heightM: round2(patch.finestHeights.sourceTexelM ?? patch.finestHeights.texelM),
    site: site.name, photoTime: site.photoTime, mosaic: site.mosaic, simulated: ephem.date,
    surround: params.get('surround') === '1' && site.fusedGround,
    tier: patch.manifest.tier && patch.tierNear(u.lon, u.lat, 1700)
      ? { imageM: round2(patch.finest.texelM), effectiveM: patch.manifest.tier.effectiveTexelM, heightM: patch.manifest.tier.heightSourceTexelM, nativeM: patch.manifest.tier.nativePixelM, sunLabel: patch.manifest.tier.light.label, sunElDeg: patch.manifest.tier.light.elDeg, inferred: patch.manifest.tier.light.inferred }
      : undefined,
  }
}

/** 1 away from the patch; up to PATCH_GAIN over its site once a pixel is a few metres (see ExposureInput.patchGain). */
const PATCH_GAIN = 1.3
function patchExposureGain(cam: ViewCamera): number {
  if (!patch) return 1
  const u = underCamera(ephem, cam.pos)
  const s = patch.manifest.site
  const arc = angularDistance(u.lon, u.lat, s.lon, s.lat)
  const altM = ((cam.pos.length() - 1) * MOON_R_KM - siteGround(rig.site ?? { lon: s.lon, lat: s.lat, groundR: patch.groundR, altR: 0 }, u.lon, u.lat) * MOON_R_KM) * 1000
  const over = 1 - smooth(Math.min(1, Math.max(0, (arc - 0.0005) / 0.0025)))
  // Full from 8 km down, none from 400 km up, on a log scale (the descent's own scale), so the white point eases in instead of stepping.
  const close = 1 - smooth(Math.min(1, Math.max(0, Math.log(Math.max(altM, 1) / 8000) / Math.log(50))))
  return 1 + (PATCH_GAIN - 1) * over * close
}

/**
 * The site's anchor exposure (see ExposureInput.anchor): the white point the descent's arrival frame asks for, computed once per
 * site and moment on the pose the descent ends at; and how far a camera is pulled to it (full over the site from 20 km down, none
 * from 300 km up or far from it, on the descent's own log scale).
 */
let anchorCache: { key: string; white: number; flatWhite: number } | null = null
/** A camera straight above (lon, lat), degrees, at `altKm`, looking down, 20 degrees high: built from the ephemeris alone (no rig, so no ground floor or streamed level can move it). */
function nadirCamera(lonDeg: number, latDeg: number, altKm: number): ViewCamera {
  const lon = lonDeg * Math.PI / 180, lat = latDeg * Math.PI / 180
  const n = new THREE.Vector3().addScaledVector(ephem.moonX, Math.cos(lat) * Math.cos(lon)).addScaledVector(ephem.moonY, Math.cos(lat) * Math.sin(lon)).addScaledVector(ephem.moonZ, Math.sin(lat)).normalize()
  const up = ephem.moonZ.clone().addScaledVector(n, -ephem.moonZ.dot(n)).normalize()
  const right = new THREE.Vector3().crossVectors(up, n).normalize()
  return { pos: n.clone().multiplyScalar(1 + altKm / MOON_R_KM), right, up, back: n, tanHalf: Math.tan(10 * Math.PI / 180) }
}
/**
 * Ground mode's white point is `GROUND_WHITE_MULT` times the I/F of flat sunlit ground seen from straight above at this site and time
 * (the nadir reference below), whatever the camera looks at: the exposure does not follow the view, so it is the same on every run.
 * Chosen on audit 6's sweep of the four camera presets (mult 2.5 to 14, frames and numbers): at 5 the ground reads as mid-grey regolith
 * (median about 73 of 255 looking toward the Sun from the window, 140 from the follow camera, whose ground is brighter at low phase)
 * and about 1% of the picture is above 240 in the follow view (the module's white foil). At 3.5 the sunlit ground behind the module washed to near white; at 8 the window view was back to 56.
 * An exposure CHOICE for this site's 1972 lighting, not a measurement.
 */
const GROUND_WHITE_MULT = 5
/** Ground-mode exposure tuning, exposed as `api.exposureTune` for the audit's sweep. `weight` is how far (in stops) the frame is pulled to the anchor white times `mult`. */
const exposureTune: { groundMult: number; groundWeight: number; pin: boolean } = { groundMult: GROUND_WHITE_MULT, groundWeight: 1, pin: false }
/** The raw exposure held while `exposureTune.pin` is set (the flicker determination's (iii): the frame search cannot move the white). */
let pinnedRawExposure: Exposure | null = null
/** The flight's white point (I/F) while the camera is high: an exposure choice calibrated on audit 5's frames (mean grey about 110 of 255), not a measurement. `flightStops > 0` only marks a flight caller. */
const FLIGHT_HIGH_WHITE = 0.5
const FLIGHT_HIGH_STOPS = 1
function siteAnchor(cam: ViewCamera, aspect: number, canvasHeight: number, share = 1, flightStops = 0, ground = false): { white: number; weight: number; capStops?: number; floorStops?: number } | undefined {
  if (!patch || patchState !== 'ready' || patchSiteId === null) return undefined
  const s = patch.manifest.site
  const u = underCamera(ephem, cam.pos)
  const arc = angularDistance(u.lon, u.lat, s.lon, s.lat)
  const altM = ((cam.pos.length() - 1) * MOON_R_KM - siteGround(rig.site ?? { lon: s.lon, lat: s.lat, groundR: patch.groundR, altR: 0 }, u.lon, u.lat) * MOON_R_KM) * 1000
  // The powered-descent flight is over the site by definition, though its camera stands tens of km off to the side.
  const over = flightStops > 0 ? 1 : 1 - smooth(Math.min(1, Math.max(0, (arc - 0.002) / 0.03)))
  const close = 1 - smooth(Math.min(1, Math.max(0, Math.log(Math.max(altM, 1) / 20000) / Math.log(15))))
  const weight = over * close * share
  if (weight <= 0) return undefined
  const key = `${patchSiteId}|${patch.finest.name}|${momentEnd ? momentEnd.pitchDeg : 'site'}|${Math.floor(time.getTime() / 3.6e6)}`
  if (anchorCache?.key !== key) {
    const saved = { ...rig.pose }, savedFov = rig.fovDeg
    rig.setPose(descentPose(1, { lon: s.lon, lat: s.lat, dist: 4.5, roll: 0, pitch: 0 }, 3.5))
    const endCam = rig.camera(ephem, aspect, performance.now())
    rig.pose = saved; rig.fovDeg = savedFov
    const raw = computeExposure({
      cam: endCam, aspect, canvasHeight, ephem, albedo: maps.albedo, lonSpan: maps.height.lonSpan, preExposeOn: PRE_EXPOSE,
      patchGain: patchExposureGain(endCam), relief: tiles && tiles.relief.size > 0 && params.get('relief') !== 'off' ? tiles.relief : null,
    })
    // Ground mode's reference, independent of everything streamed: a camera straight above the site at 2 km (a field of about 700 m,
    // all ground), no tile relief, no patch gain. The arrival frame above is a grazing view a few metres over the ground, and its
    // value moved by a decade with the patch levels and relief tiles resident at the moment it was computed (audit 6: 0.129, 0.064 and
    // 0.012 within one minute), which is why ground exposure varied run to run.
    const nadirCam = nadirCamera(s.lon, s.lat, 2)
    const flat = computeExposure({ cam: nadirCam, aspect, canvasHeight, ephem, albedo: maps.albedo, lonSpan: maps.height.lonSpan, preExposeOn: PRE_EXPOSE, relief: null })
    anchorCache = { key, white: raw.white, flatWhite: flat.white }
  }
  // The powered-descent flight looks straight down from 5 to 20 km, where the valley floor is lit at its brightest and the arrival's
  // oblique anchor is far too dark a white point for it (audit 5: frames at mean 190 of 255 with a washed look). A scripted flight keeps
  // one exposure, so while it is high it uses FLIGHT_HIGH_WHITE, a white point chosen on those frames, and eases to the plain anchor under 1 km.
  if (flightStops > 0) {
    const high = smooth(Math.min(1, Math.max(0, (altM - 1000) / 4000)))
    return { white: Math.exp(Math.log(anchorCache.flatWhite * GROUND_WHITE_MULT) * (1 - high) + Math.log(FLIGHT_HIGH_WHITE) * high), weight: Math.max(weight, 0.95 * high) }
  }
  if (ground) return { white: anchorCache.flatWhite * exposureTune.groundMult, weight: over * close * exposureTune.groundWeight }
  return { white: anchorCache.white, weight, floorStops: 0.5 }
}

/**
 * Subject-locked exposure, per gesture (WP4 / WP4b, MOON-UX-REDESIGN 5.1 step 3). While the Moon is the subject (`moonIsSubject`: orbit, Home, a pin) and the
 * camera is moving, the white point is held at the FRAME SEARCH's own value from the last frame at rest, so a drag cannot breathe the whole disc (a brighter
 * highland entering the search used to move it 0.7 stops over one 8 s drag at a quarter phase). At rest nothing is locked: the picture is exposed for its own
 * frame, exactly as before WP4 (WP4 locked the white to the sub-solar flat ground at all times, which left a quarter Moon about 1.6 stops darker, the
 * owner's "never too dark" rule). Earth and Sun subjects, ground, flights, the ridge keep the frame search.
 */
/** How far the held white may sit from the frame's own search before the lock gives way, stops each way: a drag that carries the Moon to a very different phase is exposed for itself, not left dim or clipped. A look choice. */
/** The frame search's white (I/F, before any anchor) from the last frame drawn at rest; the gesture holds it. */
let restFrameWhite = 0
/** The white a running gesture holds, or 0 when none: set on the gesture's first frame, cleared by the refine. */
let heldGestureWhite = 0
/** The clock the held white was taken at (updated through the gesture: Turn moves the date and the white stays). */
let heldAtMs = 0
function subjectAnchor(cam: ViewCamera, aspect: number, updateSubjectState = true): { white: number; weight: number; capStops: number; floorStops: number } | undefined {
  if (gestureOn) heldAtMs = time.getTime()
  else if (heldGestureWhite !== 0) {
    // After the release the white stays where the drag left it (it used to hand over to the frame search and drift for ~5 s, 0.165 to 0.123).
    // The anchor's own cap and floor (SUBJECT_HOLD_*_STOPS) keep it within a stop darker and a quarter stop brighter than the frame's search, so it can never clip or go dark; it lets
    // go on another date (the live clock's drift is not one), a declared cut (a pin, Home), or a frame that is no longer the Moon.
    if (Math.abs(time.getTime() - heldAtMs) > 600000) heldGestureWhite = 0
  }
  if (!gestureOn && heldGestureWhite === 0) return undefined
  if (!moonIsSubject(cam, aspect, updateSubjectState) || earthShadowState() !== 'none') { if (!gestureOn) heldGestureWhite = 0; return undefined }
  if (heldGestureWhite === 0) heldGestureWhite = restFrameWhite
  if (heldGestureWhite === 0) return undefined
  // Eased in over the camera's first radius above the 1.5 radii gate, so a descent hands over to the frame search without a step.
  return subjectHoldAnchor(heldGestureWhite, smooth(Math.min(1, Math.max(0, (cam.pos.length() - 1.5) / 0.7))))
}

/**
 * The HUD's resolution snapshot (R57, TM-17): the height texel and the Terrain Camera texel DRAWN under the camera, not the built level's. Under a deeper
 * block the heights are 59 m and the TC 12.5 m; the line used to compare the pixel with the built 474 m and could say "magnified past the data" while
 * finer data was drawn. A tile counts only once it is resident and faded in, so a source that is merely listed (or still loading) is never credited.
 */
function residentResolution(pxKm: number, under: { lon: number; lat: number }): { pxKm: number; heightKm: number; colourKm: number; tcKm: number | null } {
  const t = tiles!
  const tc = t.tc && tcGain() > 0 ? t.tc.residentTexelKmAt(under.lon, under.lat) : Infinity
  return { pxKm, heightKm: t.residentHeightTexelKmAt(under.lon, under.lat), colourKm: t.colourTexelKm, tcKm: Number.isFinite(tc) ? tc : null }
}
/** The patch line in ground mode: the same wording, with the pixel size at the range the camera looks at. */
function groundHudLine(gm: GroundMode | null, cam: ViewCamera, canvasTanPerPx: number): HudInfo['patchLine'] {
  const line = patchHudInfo(cam, canvasTanPerPx)
  if (!gm || !line) return line
  // The pixel size is the range to what the view centre looks at (the ground pass's own ray), not a guess; the sky has none.
  return { ...line, pxM: gm.rangeM === null ? Infinity : gm.rangeM * canvasTanPerPx }
}
function groundHud(gm: GroundMode, aspect: number): NonNullable<HudInfo['ground']> {
  const p = gm.lm?.placement
  const pads = gm.lm?.pads
  return {
    presetName: gm.preset?.name ?? null, walking: gm.cam.mode === 'walk', aglM: gm.cam.agl(), origin: gm.origin, rangeM: gm.rangeM, fillInView: gm.fillInView(aspect),
    near: NEAR_GROUND === 'photo' ? { tracks: NEAR_TRACKS, baked: NEAR_BAKED, look: NEAR_LOOK && NEAR_BAKED } : null,
    lm: p && pads ? {
      headingDeg: p.headingDeg, pitchDeg: p.pitchDeg, rollDeg: p.rollDeg, maxClearanceCm: Math.max(...p.clearanceM) * 100,
      tilt: gm.lmTilt, fitPitchDeg: gm.lmFit.pitchDeg, fitRollDeg: gm.lmFit.rollDeg, heightM: gm.lmSizeM.heightM, spanM: gm.lmSizeM.spanM,
    } : null,
  }
}
/** The way down is offered (and the G key works) only at the Apollo 17 floor, never from altitude. */
function canEnterGround(): boolean {
  if (flight || groundMode?.active || !patch || patchState !== 'ready' || patchSiteId !== 'a17' || descent) return false
  const u = underCamera(ephem, (last?.cam ?? rig.camera(ephem, canvasAspect(), performance.now())).pos)
  return angularDistance(u.lon, u.lat, patch.manifest.site.lon, patch.manifest.site.lat) < 0.004 && rig.pose.dist - 1 - rig.groundAt(rig.pose.lon, rig.pose.lat) < 0.002
}
/** Pushes ground mode's state to its buttons. */
function updateGroundUi(): void {
  viewpointsUi?.update(!!groundMode?.active && !!groundMode.lm && !flight, viewpoint)
  if (!groundUi) return
  const gm = groundMode
  const canEnter = canEnterGround()
  groundUi.update({ canEnter: canEnter && !flight, active: !!gm?.active && !flight, lmReady: !!gm?.lm, preset: gm?.preset?.id ?? null, walking: gm?.cam.mode === 'walk', origin: !!gm?.origin, reportedTilt: (gm?.lmTilt ?? 'reported') === 'reported' })
}

/**
 * ?debug=1: for the first frames after the module is placed, compares the GPU shadow map with a CPU ray cast at points
 * in the light and in the shadow (in line with the Sun, near and far) and warns on any mismatch: an unwritten or stale
 * map (G1's strip) then shows in the console instead of only in a picture. Result kept in `__moon.shadeSelfCheck`.
 */
let shadeChecks = 0
function selfCheckShade(gm: GroundMode): void {
  if (shadeChecks >= 3) return
  const shadeCheck = (api.ground as { shadeCheck: (pts: Array<[number, number]>) => { gpu: number; cpu: number }[] | null }).shadeCheck
  const sun = gm.sunInFrame(ephem)
  const h = Math.hypot(sun.x, sun.y)
  if (h < 1e-3 || sun.z <= 0.02) return
  const ux = sun.x / h, uy = sun.y / h
  const pts: Array<[number, number]> = []
  for (const d of [2, 4, 7, 10, 14]) pts.push([-ux * d, -uy * d], [ux * d, uy * d], [-uy * d, ux * d])
  const r = shadeCheck(pts)
  if (!r) return
  shadeChecks++
  const bad = r.map((v, i) => ({ v, i })).filter(({ v }) => Math.abs(v.gpu - v.cpu) > 0.5)
  ;(api as Record<string, unknown>).shadeSelfCheck = { frame: shadeChecks, points: r.length, mismatches: bad.length, shadowed: r.filter((v) => v.cpu < 0.5).length }
  if (bad.length) console.warn(`shadeCheck: ${bad.length} of ${r.length} points differ between the shadow map and the CPU ray cast`, bad.map(({ v, i }) => ({ at: pts[i], gpu: v.gpu, cpu: v.cpu })))
}

const framePacer = new FramePacer(Number(params.get('paceold')) || undefined, Number(params.get('pacelight')) || undefined)
/** ?pace=off|on. Hard backpressure is on by default for the fence-class phone path only (#96 made it default for every source and a 60 Hz desktop then presented 49% of vsyncs); `?pace=on` forces it, `off` disables it. */
const PACE_PARAM = params.get('pace')
const PACE_ON = resolvePace(PACE_PARAM, FENCE_CLASS, params.get('settle') === 'stepped', DESKTOP_CLASS).on
/**
 * Rest to motion (WP-A, 2026-10-23, owner complaint 1). Measured on the owner's 4.58 Mpx desktop canvas: after every gesture the loop submitted a full-size
 * rest frame (117 ms) every rAF for 10-14 s while tiles streamed and faded, with nothing pacing it, so a press a few seconds after a release queued behind 2-3 of
 * them (250-350 ms frozen map, a saturated GPU delays WindowServer: the jittery OS cursor). Each lever is behind its own URL switch. Defaults since the measurements of 2026-10-23 (desktop class only): `pace=rest`, `wallmem`, `motionstart=cost` ON (`?pace=off|on|all`, `?wallmem=0`, `?motionstart=<scale>` opt out); `settle=stepped`, `pressyield`, `fadebatch=cost`, `mdpr` stay OFF:
 *  - `?settle=stepped` (1d): the hand-back's full-size frame is one submit only when it fits two vsyncs; a dearer one waits for a `?settlequiet=` ms spell with no
 *    input (300; 0 draws at once) and then goes in bands of at most BAND_MS (50 here, `?bandms=`), one per signalled fence, so no single submit is 117 ms. The tile
 *    refresh frames at rest go in bands the same way. Rest frames are fenced and tagged so their cost is LEARNED (`fullCostMs`), which `BANDS_ON` alone never did on desktop.
 *  - `?pace=rest` (1a, implied by `settle=stepped`): the pacer holds REST frames only (one dear frame in flight); gesture frames are never fenced or held (#96).
 *  - `?pressyield=1` (1c): PRESS_YIELD_MS after a pointerdown the tile uploads and the shadow-cache builds stand down.
 *  - `?fadebatch=cost` (1b, fades.ts): the fade cadence follows the measured full-frame cost, not only the class.
 *  - `?wallmem=<ms>` (2a, ON by default on desktop; `0` off): the wall ladder's `lite` and `cap` are kept for that long (60 s with no value) or until the canvas size changes, and the grid a gesture ended on is remembered per context.
 *  - `?motionstart=cost` (2b, ON by default on desktop; a scale value overrides): the gesture starts from the last gesture's measured motion cost, else from the rest cost times `?motionfactor=` (an estimate, 1).
 *  - `?mdpr=1.5` (2c, dpr.ts): a motion-only pixel-ratio cap for canvases over 3 Mpx; rest frames keep the full ratio.
 */
const SETTLE_STEPPED = params.get('settle') === 'stepped'
const SETTLE_QUIET_MS = settleQuietFromSearch(location.search)
const PACE_REST = resolvePace(PACE_PARAM, FENCE_CLASS, SETTLE_STEPPED, DESKTOP_CLASS).rest
const PRESS_YIELD = params.get('pressyield') === '1'
const WALL_MEMORY = wallMemoryFromSearch(location.search, DESKTOP_CLASS)
const MOTION_START_COST = params.get('motionstart') === 'cost' || (params.get('motionstart') === null && DESKTOP_CLASS)
/** `?motionfactor=`: the live-march motion frame's cost as a multiple of the cached rest frame's; absent, 1 / fullShaderFactor() (the same estimate the bands use, read the other way), resolved where it is used. */
const MOTION_REST_FACTOR_PARAM = (() => { const v = Number(params.get('motionfactor')); return v > 0 ? v : null })()
const MOTION_DPR_CAP_PARAM = motionDprCapFromSearch(location.search)
/** `?pressyield=1`: the last pointerdown (the press that starts a gesture, also a stationary one). */
let pressAt = -1e9
if (PRESS_YIELD) document.addEventListener('pointerdown', () => { pressAt = performance.now() }, { capture: true, passive: true })
/** Counters for __moon.perf: frames whose uploads and builds stood down for a press; full frames the stepped settle held back for the quiet spell, deferred for a shut band gate, and the final-only crossfade redraws drawn while it held. */
let pressYields = 0, settleHolds = 0, settleDeferred = 0, settleFades = 0
/** When the stepped settle first deferred a dear full frame for a shut band gate (-1: not deferring); bounded by SETTLE_DEFER_MAX_MS. */
let settleDeferSince = -1
/** `?wallmem=`: the grid the last gesture ended on, per context (orbit/ground, canvas size); and the last gesture's live-march motion cost for `?motionstart=cost`. */
const motionMemory = new MotionMemory()
let motionCost: FrameCost | null = null
let motionStartUsed: 'motion' | 'rest' | 'none' = 'none'
/** Budgeted refine (fence classes): a frame the period model predicts dearer than BAND_MS is drawn as horizontal bands, one per signalled fence, into one target and presented when complete. `?bands=off` restores single frames, `?bands=on` forces it, `?bandms=N` sets the per-band budget (150 is the phone's; the L4 runs ~10x faster; 50 under `?settle=stepped`). */
const BAND_PARAM = params.get('bands')
const BANDS_ON = BAND_PARAM === 'off' ? false : BAND_PARAM === 'on' || (gpuTimer.source === 'fence' && FENCE_CLASS) || SETTLE_STEPPED
const BAND_MS = Number(params.get('bandms')) || (SETTLE_STEPPED ? 50 : 150)
/** The phone's cap of 8 cannot hold a 50 ms budget on the owner's 613 ms frame (77 ms each): under `?settle=stepped` the count follows measured cost / budget up to BAND_MAX_STEPPED. */
const BAND_MAX = SETTLE_STEPPED ? BAND_MAX_STEPPED : 8
interface BandState { k: number; n: number; scale: number; cw: number; ch: number; exposure: Exposure | null; tilesBusy: boolean }
let bandState: BandState | null = null
/** Last frame a tween, flight or descent drove the camera: a banded frame waits BAND_HANDOVER_MS after it (bandGate.ts). */
let lastScriptedAt = -1e9
/** Schedule the next band without external invalidation; frameLoop waits for the previous band's fence before drawing it. */
function completeBand(band: BandState): boolean {
  if (bandState !== band) return false
  if (band.k < band.n - 1) { band.k++; dirty = true; return true }
  bandState = null
  return false
}
/** Counters for __moon.perf: band draws, complete banded frames, final-pass-only redraws. */
let bandFrames = 0, bandedFrames = 0, finalOnlyFrames = 0
/** The motion frame the next full-size frame crossfades from, kept until that frame is complete. */
let pendingFade: { w: number; h: number; cw: number; ch: number } | null = null
/** How many bands a frame on grid `scale` takes: 1 with no model. */
function bandsFor(scale: number): number {
  // A full-size frame runs a dearer shader than the motion frames the period model was fitted on (four marches, the sub-pixel average, 56 terrain steps): the model alone under-predicts it 2 to 4x. The cost is MEASURED from the rest frames already drawn (fullCostMs, per full-canvas frame); until one exists the motion model is scaled by fullShaderFactor() (an estimate, not a measurement).
  const pred = predictBandMs(learnedFullMs(), scale, fenceGrid.predict(scale), fullShaderFactor())
  return bandCount(pred, BAND_MS, BAND_MAX)
}
/** The full-size rest frame's cost as known so far (ms): the fenced rest frames' period, or the hand-back's wall-priced model (desktop, every release); 0 with neither. Read only by the switches (`fadebatch=cost`, `motionstart=cost`, the perf readout) and by the bands under `settle=stepped`. */
function restCostKnown(): number { return restCostFloor(fullCostMs, restCost) }
/** The cost the bands and the release hold read: with every switch off (and under `?bands=on` alone) exactly `fullCostMs`, as before; under `?settle=stepped` the known rest cost, so the first stepped release is already banded. */
function learnedFullMs(): number { return SETTLE_STEPPED ? restCostKnown() : fullCostMs }
/** Bands and the release hold apply only when the full frame needs more than one band; a fast phone whose frame fits the budget behaves exactly like `?bands=off`. */
function bandsWorth(): boolean { return BANDS_ON && bandsFor(1) > 1 }
/** Estimate used only before any rest frame has been timed: the full shader's per-pixel cost over the motion variant's (the review's 2 to 4x, middle). */
const fullShaderFactor = (): number => motionShaderOn() ? 3 : 1
/** Measured period (ms) of a full-canvas rest frame (a banded frame's bands summed, divided by scale squared); 0 until one has finished. */
let fullCostMs = 0
/** term-fix B: the wall-clock backstop for a GPU timer that lags or reads 0 (`?wall=0` turns it off for an A/B). */
const wallLadder = new WallLadder()
const WALL_ON = params.get('wall') !== '0'
/** term-fix D: `?motionlite=1` runs every motion frame on the phone's lite march (stride 4, 12 terrain steps, no refine or deep-near) on desktop, so shadow cost scales with pixels. Default off: B latches it only after frames run slow. */
/** term-fix F: the motion shader (1 shadow sample, lite terms) follows the GESTURE, not the grid: a desktop gesture often holds scale 1, and those frames ran the 4-sample rest average (bimodal 3 Hz vs 30 Hz on the M5). `?motiongrid=1` restores grid-only keying. */
const MOTION_GRID_ONLY = params.get('motiongrid') === '1'
const MOTION_LITE_FORCED = params.get('motionlite') === '1'
let wallDrawSeq = 0
let wallSeenSeq = 0
let wallPrevDrawAt = 0
let wallGap = 0
const WALL_IGNORE_MS_MAIN = 1500
/** Wall-clock memory across gestures: a frame that takes hundreds of ms starves the pointer, so one drag can end and restart the gesture on every frame (scale 1 all the way on the M5). The learned ceiling and the lite latch survive a restart inside WALL_MEMORY_MS (4 s; `?wallmem=<ms>` keeps them longer, and until the canvas size changes). */
const WALL_MEMORY_MS = WALL_MEMORY.ms
let wallCapAt = -1e9
/** The canvas size (device px) when the wall ladder last stepped: a different pixel count is a different cost (`?wallmem=` only). */
let wallCapSize = ''
const wallMemoryLive = (now: number): boolean => wallMemoryHolds(now, wallCapAt, WALL_MEMORY_MS, `${canvas.width}x${canvas.height}`, wallCapSize, WALL_MEMORY.on)
let wallSteps = 0
let wallObs = 0
let wallGapLast = 0
/**
 * The desktop start cap: a gesture with live shadows never starts above this grid scale (0.7 from 2026-10-11, was 0.5: the owner found the drag
 * "very blurry", and accepted shipping 0.7 before the rig A/B). `?startcap=0` removes the cap, `?startcap=0.5` restores the old value (A/B in one build).
 */
const START_CAP_PARAM = params.get('startcap')
const START_CAP_ON = START_CAP_PARAM !== '0'
const START_CAP_LIVE = (() => { const v = Number(START_CAP_PARAM); return START_CAP_PARAM !== null && v > 0 && v <= 1 ? v : 0.7 })()
let restAcc: { id: number; sum: number; seen: number; n: number; scale: number } | null = null
let restFrameId = 0
let restLast = 0
/** Folds the finished tagged rest frames the pacer has seen into fullCostMs. */
function drainRestCosts(): void {
  for (const f of framePacer.finished.splice(0)) {
    const t = f.tag as { id: number; n: number; scale: number }
    if (!restAcc || restAcc.id !== t.id) restAcc = { id: t.id, sum: 0, seen: 0, n: t.n, scale: t.scale }
    // A fence is seen at the next rAF, so a period carries up to a vsync of waiting that is not GPU work: half a frame is taken off each band, so many light bands do not add up to a dear frame.
    restAcc.sum += Math.max(0, f.ms - 0.5 * (1000 / (displayRate.hz || 60))); restAcc.seen++
    if (restAcc.seen === restAcc.n) {
      const full = restAcc.sum / (restAcc.scale * restAcc.scale)
      // The very first full-size frame of a page compiles its shader program: that stall is not the steady cost (measured on the L4: 440 ms read for a frame that then costs ~50), so it is skipped.
      // A stall (first compile of a variant, a tile upload burst) reads as a dear frame once; the cost is taken from two agreeing readings, the dearer one only if both are dear.
      const steady = restLast > 0 ? Math.min(restLast, full) : 0
      restLast = full
      if (steady > 0) fullCostMs = foldFullCost(fullCostMs, steady)
      restAcc = null
    }
  }
}
function render(now: number, scale: number, band: BandState | null = null, finalOnly = false, capture = false, cameraNow = now, buildOnly = false): void {
  /** A continuation band (not the first): the scene target already holds the earlier bands, exposure and tile state are those of band 0. */
  const cont = !!band && band.k > 0
  /** buildOnly: the hand-back's cache catch-up. Runs the tile and shadow-cache update, draws nothing, leaves the last picture on the canvas. */
  const skipScene = cont || finalOnly || buildOnly
  const frameT0 = performance.now()
  setSearchReuseMs(scrubGate.active(now) ? SCRUB_SEARCH_REUSE_MS : 0)
  /** `?pressyield=1`: this frame is inside the PRESS_YIELD_MS after a press (never in a capture, a catch-up or a scripted flight): no tile upload, no shadow build. */
  // `?motion=sharp` over budget (SharpPacer.cutCost): no tile upload and no shadow-cache build while the Moon moves, flights included; resolution is never the lever.
  const sharpDefer = sharpMotionOn() && sharpPacer.cutCost && (gestureOn || flightScaleWasActive)
  // Fixed shadow policy: at most one 128 px cache block per frame while the Moon is being moved (a gesture, or a flight under ?motion=sharp).
  const blockCapFrame = gestureOn || (sharpMotionOn() && flightScaleWasActive)
  const yielding = !skipScene && !captureSession && (sharpDefer || (!tween && !cinematicFlight && pressYieldActive(PRESS_YIELD, frameT0, pressAt)))
  if (yielding) pressYields++
  // The pixel ratio follows the camera's distance, but only between gestures: a canvas resize mid-drag reallocates every target.
  if (mayChooseRestRatio(gestureOn, restDpr)) {
    const native = window.devicePixelRatio || 1
    const fullDpr = dprFor({ native, cap: knobs.dprCap, closeCap: knobs.closeDprCap, dist: groundMode?.active || (flight && flightFrame) ? 0 : rig.pose.dist, override: quality.dprOverride })
    // `?mdpr=` (or a class motionDprCap): motion frames on a large canvas keep fewer pixels; the canvas itself (the rest frames) stays at the full ratio, like the phones' restDprCap path. Never under an explicit `?dpr=`.
    motionDpr = quality.dprOverride === undefined ? motionDprFor(fullDpr, MOTION_DPR_CAP_PARAM ?? knobs.motionDprCap, canvas.clientWidth * canvas.clientHeight, knobs.motionDprFromPx) : fullDpr
    // Rest frames may use a finer canvas than the motion ratio (the shadow cache made them cheap); the ratio is fixed for the whole gesture, so no resize mid-drag.
    restDpr = knobs.restDprCap !== undefined && quality.dprOverride === undefined ? Math.max(motionDpr, Math.min(native, knobs.restDprCap)) : fullDpr
    // From the moment a landing is pending (the descent's last seconds load the finest patch levels while the Moon pass still holds its cache), not only on the ground.
    const groundRest = (groundMode?.active || pendingLanding !== null) && quality.dprOverride === undefined ? groundRestDprCap(quality.detected.cls, !!nativeHost) : undefined
    if (groundRest !== undefined) restDpr = Math.max(motionDpr, Math.min(restDpr, groundRest))
    restDpr = restGovernor.apply(restDpr, motionDpr)
    // `?motion=sharp`: the motion ratio is the rest ratio for the whole gesture or flight (chosen here, between gestures, so no resize mid-drag).
    if (sharpMotionOn()) motionDpr = restDpr
    // The chip's DPR line follows the ratio just chosen (chip updates are otherwise event-driven).
    // Phone policy: the moving line is the real motion ratio, f x the rest ratio (the old line read 1.5 while frames were 0.26 of the canvas).
    const movingShown = phoneMotionOn() ? +(restDpr * sharpF()).toFixed(2) : motionDpr
    if (restDpr !== chipDpr.rest || movingShown !== chipDpr.moving) { chipDpr = { rest: restDpr, moving: movingShown }; refreshReduced() }
  }
  // Phone policy: f can drop mid-drag (the pacer's floor), when the block above does not run; the chip follows it on change.
  if (phoneMotionOn() && restDpr > 0) { const m = +(restDpr * sharpF()).toFixed(2); if (m !== chipDpr.moving) { chipDpr = { rest: restDpr, moving: m }; refreshReduced() } }
  const dpr = captureSession ? 1 : restDpr
  const cw = captureSize?.width ?? Math.max(64, Math.round(canvas.clientWidth * dpr))
  const ch = captureSize?.height ?? Math.max(64, Math.round(canvas.clientHeight * dpr))
  // A canvas resized between bands would leave the earlier rows undefined in a fresh target: abandon the frame (the resize already asked for a refine).
  if (band && band.k > 0 && (band.cw !== cw || band.ch !== ch)) { bandState = null; markDirty(); needsRefine = true; return }
  // An exposure cut declared between bands would leave the bands on two exposures (a seam): abandon and redraw whole.
  if (band && band.k > 0 && bandMustAbandon(exposureCutFrames, exposureControl.moving)) { bandState = null; markDirty(); needsRefine = true; return }
  if (band && band.k === 0) { band.cw = cw; band.ch = ch }
  // A catch-up frame never resizes the canvas (that would clear the picture it leaves on screen): it does nothing and sets renderAborted, the loop drops the catch-up and the normal frame resizes.
  if (buildOnly && (canvas.width !== cw || canvas.height !== ch)) { renderAborted = true; markDirty(); return }
  if (canvas.width !== cw || canvas.height !== ch) renderer.setSize(cw, ch, false)
  // A motion frame on a rest canvas finer than the motion ratio keeps the motion pixel count: the grid is relative to the motion ratio.
  // Under `?motion=sharp` renderDims makes the grid 1 and the motion ratio the rest ratio: w x h = cw x ch (quality/sharpMotion.ts). Default: the expression that stood here.
  const policy: MotionPolicy = motionPolicy()
  const dims = renderDims(policy, { cw, ch, scale, gestureOn, motionDpr, restDpr: dpr, gridIsOnlyScale: flightGridIsOnlyScale(quality.sharp, flightScaleWasActive) })
  const { w, h } = dims
  if ((gestureOn || flightScaleWasActive) && !skipScene && !buildOnly && !capture && !captureSession) { motionF.add(w / cw); if (phoneMotionOn()) phonePacer.noteFrame() }
  if (policy === 'sharp' && (scale < 1 || motionDpr !== restDpr)) sharpMotionStats.overridden++
  if (policy === 'sharp' && (gestureOn || flightScaleWasActive) && !skipScene && isDownscaled(dims, cw, ch)) sharpMotionStats.downscaledFrames++
  const aspect = cw / ch
  const gm = groundMode?.active ? groundMode : null
  const fl = flight && flightFrame ? flightFrame : null
  // Flight: the ground camera holds the flight's view (ground regime); in the orbit regime the flight's own world camera is used.
  if (gm && fl) gm.cam.view = fl.view
  const rf = ridge && !gm && !fl ? ridgeF : null
  const ic = !gm && !fl && !rf && intro?.active ? intro.camera(rig.camera(ephem, aspect, cameraNow), cameraNow) : null
  const cam = gm ? gm.viewCamera(ephem) : fl ? fl.cam : rf ? rf.cam : ic ?? rig.camera(ephem, aspect, cameraNow)
  if (ic) intro?.drawn(ic)
  // The camera of a scene drawn now (not buildOnly, not a continuation band, not a final-only redraw): published once the scene is presented (below).
  if (centreCtl) presentedScene.selected(skipScene, () => toMoonSample(cam, ephem, aspect))
  let airIn: { air: number; transmission: number; skyLevel: number; ev: number } | undefined
  if (rf && ridge) {
    const st = skyState(ephem, ridge.obs)
    const apparent = st.moon.alt + refractionArcmin(Math.max(st.moon.alt, 0.5)) / 60
    airIn = { air: rf.air, transmission: transmission(apparent, 1, RIDGE_HAZE)[1], skyLevel: skyLevelIF(st.sun.alt, st.moon.alt), ev: RIDGE_EV }
  }
  const ridgeNight = !!(rf && ridge && skyState(ephem, ridge.obs).sun.alt < -2)
  let exposure: Exposure
  if (tween || descent || cinematicFlight || orbitJourney || routeFlight) lastScriptedAt = now
  if (skipScene && (cont ? band!.exposure : last?.exposure)) exposure = (cont ? band!.exposure : last!.exposure)!
  else {
  // Snap behaviour is for a USER gesture (drag, wheel, touch, their inertia) only. Every scripted camera move also sets gestureOn, and those keep main's
  // exposure exactly: the ridge lift-off holds one exposure by design, flights and journeys have look-ahead cameras and their own rates.
  const scriptedCamera = !!(tween || descent || flight || rf || fl || routeFlight || cinematicFlight || orbitJourney || hover || ridge || gm || siteLandingWait !== null)
  const aheadOwnerNow = tween ?? cinematicFlight ?? descent ?? null
  const aheadBucketNow = Math.floor(time.getTime() / 60_000)
  const aheadOwnerChanged = aheadMemoMustReset(aheadOwner, aheadOwnerNow, aheadEphemerisBucket, aheadBucketNow, aheadLastNow, cameraNow, exposureCutFrames)
  if (aheadOwnerChanged) {
    ablAhead = []
    aheadCursor = 0
    aheadOwner = aheadOwnerNow
    aheadEphemerisBucket = aheadBucketNow
    aheadLastNow = cameraNow
  }
  const flightExpCoarse = useCoarseFlightExposure({ mode: FLIGHT_EXP_MODE, flightLike: !!(tween || cinematicFlight || routeFlight || orbitJourney || intro?.moving) && !flight && !fl && !descent && !hover, gestureOn, captureSession: !!captureSession, cutFrames: exposureCutFrames, ownsExposure: !!rf, groundMode: !!gm, coarseGainOn: COARSE_GAIN_ON })
  const expView: ExposureView | null = flightExpCoarse ? { back: cam.back, tanHalf: cam.tanHalf, alt: cam.pos.length() - 1 } : null
  const wantsFrozen = exposureReusable({ gestureOn, hasSearch: ablExposure !== null, cutFrames: exposureCutFrames, ownsExposure: !!rf, now, searchAt: ablExposureAt, freeze: ABL.has('expfreeze'), noReuse: ABL.has('noexpreuse'), windowMs: flightExposureWindowMs(exposureWindowMs(lastExposureBlockMs, scriptedCamera && !captureSession), flightExpCoarse, !!expView && exposureViewMoveSmall(ablExposureView, expView)) })
  const expFrozen = aheadExposureReusable(wantsFrozen, aheadOwnerChanged)
  if (gestureOn) gestureWasUser = !scriptedCamera
  const userGesture = EXP_SNAP_ON && gestureOn && !scriptedCamera
  const expInput = (coarse: boolean): ExposureInput => ({
    air: airIn,
    starLiftFloor: STAR_LIFT_FLOOR,
    // The lift-off from a dusk or night ridge keeps ONE exposure, the Moon's, all the way: the look-back at the Earth has nothing of its own to expose for (night lights are ~1e-5 of the Moon's white),
    // so searching its own frame left the exposure at its last value and the picture black for 9 s (audit 7). A lit ground below (sun more than 2 degrees up) keeps its own frame's search.
    searchCam: rf ? (rf.earthLook < 0.1 || ridgeNight ? moonFramedCamera(rf.earthLook < 0.1 ? cam : rf.searchCam) : undefined) : undefined,
    cam, aspect, canvasHeight: ch, ephem, albedo: maps.albedo, lonSpan: maps.height.lonSpan, preExposeOn: PRE_EXPOSE,
    // The Sun just below the ridge's horizon is in the look-back's frame but behind the Earth: it is not a subject to expose for (it exposed the frame for 50 I/F and left it black).
    earthWhite: rf && ridgeNight ? 0 : whiteTargetIF(!!gm, earthWhiteIF(cam, aspect)),
    // The ridge journey is far from any site: its look-back camera must not pull the white toward a site's anchor.
    patchGain: rf ? 1 : patchExposureGain(cam),
    // The ridge journey is far from any site: its look-back camera must not pull the white toward a site's anchor.
    anchor: rf ? undefined : siteAnchor(cam, aspect, ch, 1, fl ? FLIGHT_HIGH_STOPS : 0, !!gm && !fl) ?? (gm || fl ? undefined : subjectAnchor(cam, aspect)),
    relief: tiles && tiles.relief.size > 0 && params.get('relief') !== 'off' ? tiles.relief : null,
    coarse,
    coarseGain: coarse && COARSE_GAIN_ON ? (flightExpCoarse ? flightCoarseGain.gain : coarseGain.gain) : 1,
  })
  // The coarse search of a gesture reads low (it misses the small bright spots); measure by how much, on the gesture's first frame and then every few hundred ms, so the gesture is exposed like the rest frame it ends on.
  let coarseCalMs = 0
  if (!userGesture) coarseGain.reset()
  else if (COARSE_GAIN_ON && !expFrozen && coarseGain.due(now)) { const t0 = performance.now(); coarseGain.update(now, coarseGainFor(expInput(true))); coarseCalMs = performance.now() - t0 }
  // The flight's own gain: one full search next to the coarse one every 250 ms (the same CoarseGain); the HUD's sunlit share is read from that full search, never from the 20-row one.
  if (!flightExpCoarse) { if (FLIGHT_EXP_MODE === 'coarse') { flightCoarseGain.reset(); flightFullSunlit = null } }
  else if (!expFrozen && flightCoarseGain.due(now)) { const cal = coarseCalibrationFor(expInput(true)); flightCoarseGain.update(now, cal.gain); flightFullSunlit = cal.sunlitFraction; flightExpStats.calibrations++ }
  const exposureBlockStart = !expFrozen ? performance.now() : 0
  let exposureRaw = expFrozen ? ablExposure! : computeExposure(expInput(userGesture || flightExpCoarse))
  if (!expFrozen && flightExpCoarse && flightFullSunlit !== null) exposureRaw = { ...exposureRaw, search: { ...exposureRaw.search, sunlitFraction: flightFullSunlit } }
  if (flightExpCoarse) { flightExpStats.coarseFrames++; if (expFrozen) flightExpStats.reused++; else flightExpStats.searches++ }
  if (!expFrozen) { ablExposure = exposureRaw; ablExposureAt = now; ablExposureView = expView }
  // (expView is null off the coarse flight path, which also forgets the old view: the next flight frame searches.)
  if (!gestureOn) restFrameWhite = exposureRaw.frameBrightest
  if (exposureTune.pin) { pinnedRawExposure ??= exposureRaw; exposureRaw = pinnedRawExposure } else pinnedRawExposure = null
  // The exposure has memory (post/exposureControl.ts): this frame's answer is a target, not the picture's exposure.
  const ahead: Ahead[] = expFrozen ? ablAhead : []
  if (!gm && !fl && !rf && !STILL && !expFrozen) {
    // Capture readiness may render the same pinned camera several times while settling fades.
    const offs = aheadCameras(cameraNow, aspect)
    const owner = aheadOwnerNow
    const ephemerisBucket = aheadBucketNow
    if (aheadMemoMustReset(aheadOwner, owner, aheadEphemerisBucket, ephemerisBucket, aheadLastNow, cameraNow, exposureCutFrames)) {
      ablAhead = []
      aheadCursor = 0
    }
    aheadOwner = owner
    aheadEphemerisBucket = ephemerisBucket
    aheadLastNow = cameraNow
    const refresh = scriptedCamera && !captureSession ? aheadRefreshSet(offs.length, aheadCursor, AHEAD_PER_FRAME_SCRIPTED) : null
    if (refresh) aheadCursor = refresh.next
    const previousByTime = new Map(ablAhead.map((a) => [a.t, a.raw]))
    const refreshIndices = refresh ? new Set(refresh.indices) : null
    for (let i = 0; i < offs.length; i++) {
      const o = offs[i]
      const previous = previousByTime.get(o.t)
      const isArrival = i >= AHEAD_S.length
      const shouldRefresh = !refreshIndices || isArrival || refreshIndices!.has(i) || !previous
      const raw = shouldRefresh ? computeExposure({
        cam: o.cam, aspect, canvasHeight: ch, ephem, albedo: maps.albedo, lonSpan: maps.height.lonSpan, preExposeOn: PRE_EXPOSE,
        earthWhite: earthWhiteIF(o.cam, aspect, true), patchGain: patchExposureGain(o.cam), anchor: siteAnchor(o.cam, aspect, ch) ?? subjectAnchor(o.cam, aspect, false),
        relief: tiles && tiles.relief.size > 0 && params.get('relief') !== 'off' ? tiles.relief : null,
      }) : previous!
      ahead.push({ t: o.t, raw })
    }
  }
  if (!expFrozen) {
    ablAhead = ahead
    const blockMs = performance.now() - exposureBlockStart
    lastExposureBlockMs = lastExposureBlockMs > 0 ? lastExposureBlockMs * 0.5 + blockMs * 0.5 : blockMs
  }
  const snapNow = EXP_SNAP_ON && (gestureOn ? userGesture : gestureWasUser)
  const settleWindow = snapNow ? SNAP_SETTLE_WINDOW_MS : SETTLE_WINDOW_MS
  const settleActive = !gestureOn && perfState.gestureEndAt > 0 && now - perfState.gestureEndAt < settleWindow
  exposureControl.snap = snapNow
  exposure = exposureControl.step(exposureRaw, now, STILL, ahead, exposureCutFrames > 0, false, settleActive, gestureOn)
  if (exposureCutFrames > 0) exposureCutFrames--
  if (EXP_TRACE) { if (expTrace.length >= 6000) expTrace.shift(); const fullRaw = EXP_TRACE_FULL && (userGesture || flightExpCoarse) ? computeExposure(expInput(false)) : exposureRaw; expTrace.push({ t: now, gain: flightExpCoarse ? flightCoarseGain.gain : coarseGain.gain, cal: coarseCalMs, g: gestureOn, u: userGesture, fx: flightExpCoarse, s: scale, raw: exposureRaw.white, full: fullRaw.white, fb: exposureRaw.frameBrightest, fullFb: fullRaw.frameBrightest, w: exposure.white, hits: exposureRaw.search.hits }) }
  lastExposureInfo = { searchHits: exposureRaw.search.hits, rawWhite: exposureRaw.white, white: exposure.white, aheadWhite: ahead.map(a => a.raw.white), aheadHdr: ahead.map(a => a.raw.hdr), aheadT: ahead.map(a => a.t), hdr: exposure.hdr, longMax: exposure.longMax }
  if (exposureControl.moving) { markDirty(); because('exposure') }
  }
  const t = targets.get(w, h)
  const m = cameraMatrices(cam, w, h)
  ;(common.uInvViewProj.value as THREE.Matrix4).copy(m.invViewProj)
  ;(common.uCamPos.value as THREE.Vector3).copy(cam.pos)
  ;(common.uResolution.value as THREE.Vector2).set(w, h)
  common.uPreExpose.value = exposure.preExpose
  moon.setTopographyWhiteIF(exposure.white)
  const nightFloorRadianceOn = moon.setNightFloor(NIGHT_FLOOR, exposure)
  const nightFloorApplied = !gm && nightFloorRadianceOn && cam.pos.clone().normalize().dot(ephem.sunDir) < 0.999999
  const tanPerPx = cam.tanHalf / (h / 2)
  if (!skipScene) {
    const dtS = Math.min(0.25, Math.max(0, (now - starsFadeAt) / 1000))
    starsFadeAt = now
    const goal = starsOn && stars ? 1 : 0
    const step = dtS * 1000 / STARS_FADE_MS
    starsLevel = starsLevel < goal ? Math.min(goal, starsLevel + step) : Math.max(goal, starsLevel - step)
    if (starsLevel !== goal) { markDirty(); because('stars') }
    // Stars stay visible beside a sunlit Moon (sky/skyStars.ts): a display-space lift in the final pass, off where the sky is not the subject (ground mode, a flight's lander, the ridge view).
    const skyOn = SKY_STARS_ON && !gm && !fl && !rf && stars && starsLevel > 0
    skyStarsGain = skyOn ? skyStarGain(tanPerPx, boostGain(starBoost), exposure.white, cam.tanHalf) : 0
    if (stars && starsLevel > 0) stars.update(m.viewRotProj, tanPerPx, starsLevel, starBoost, STAR_BOOST_CAP_SHARE * exposure.white * exposure.preExpose, exposure.white, skyCullGain(skyStarsGain, exposure.hdr))
  }
  const canvasTanPerPx = cam.tanHalf / (ch / 2)
  let tilesBusy = cont ? band!.tilesBusy : false
  if (!cont) tilesFadeOnly = false
  if (!(cont || finalOnly)) {
  // Keep terrain intersections and shadow geometry consistent through a gesture. The cheaper march is an explicit performance comparison.
  const motionFrame = (scale < 1 || (gestureOn && !MOTION_GRID_ONLY)) && motionShaderOn() && !ABL.has('nomotion')
  moon.setMotion(motionFrame)
  moon.setFlightHz(FLIGHTHZ_ON && motionFrame && !!cinematicFlight && !gestureOn)
  moon.setGridFrame(scale < 1)
  moon.setTermAA(termAaFactor(termAaParam, scale, motionFrame))
  moon.setMotionCaps(motionCapsOn || MOTION_LITE_FORCED || (wallLadder.lite && motionFrame) || (sharpMotionOn() && sharpPacer.cutCost && motionFrame), phoneMotionOn() ? MOTION_TERRAIN_ITER : undefined)
  moon.setHitShare(hitShareParam === '1' ? 'always' : hitShareParam === 'motion' ? 'motion' : hitShareParam === 'off' || hitShareParam === '0' ? 'off' : hitShareDefault)
  moonMotionCaps = motionFrame && (motionCapsOn || MOTION_LITE_FORCED || wallLadder.lite || (sharpMotionOn() && sharpPacer.cutCost))
  moon.update(ephem, tanPerPx, canvasTanPerPx)
  if (floorRestorePending) restoreFloorAfterFailure()
  if (tilesState === 'idle' && cam.pos.length() < TILE_PREWARM_DIST) void ensureTiles()
  if (!patchRefinementPaused && patchSitesFound.size && cam.pos.length() < PATCH_COVERAGE_DIST) {
    const u = underCamera(ephem, cam.pos)
    // Nothing loaded, or the loaded site is far behind (then the next one's patch may replace it); never while one is loading or still near.
    const held = loadedSite()
    const free = !descent && (patchState === 'idle' || patchState === 'ready') && (patchState === 'idle' || ( !!held && angularDistance(u.lon, u.lat, held.lon, held.lat) > 0.15))
    if (free) {
      for (const site of PATCH_SITE_LIST) {
        if (!patchSitesFound.has(site.id) || site.id === patchSiteId || (tourSite && tourSite !== site.id)) continue
        // Over the site's own fine photographs (the coverage data), the patch is wanted from farther out than the old 0.05 rad arc at 1.6 radii: the zoom limit is lower there, so the picture must be on its way.
        const covered = finestRegionAt(u.lon, u.lat)?.site === site.id
        if (covered || (cam.pos.length() < PATCH_PREWARM_DIST && angularDistance(u.lon, u.lat, site.lon, site.lat) < PATCH_PREWARM_ARC)) { void ensurePatch(site.id); break }
      }
    }
  }
  if (!patchRefinementPaused && patch && patchState === 'ready') {
    const active = patch
    const site = loadedSite()
    const nadir = underCamera(ephem, cam.pos)
    const altitudeKm = Math.max(0, (cam.pos.length() - 1 - active.groundR) * MOON_R_KM)
    const close = !!gm || (!!site && altitudeKm <= 300
      && angularDistance(nadir.lon, nadir.lat, site.lon, site.lat) < PATCH_PREWARM_ARC)
    // A scripted descent is going to need every level, and each takes seconds to arrive: ask for them all as it starts instead of as the camera passes their altitude (audit 5: the clock waited 13 s at a slowed rate for the last ones).
    // The arrival hold asks the same (src/descent/arrival.ts arrivalPatchDemand): at its 69 km the free demand would want the coarse bridge alone, and the hold waits for the fine levels.
    void active.updateDemand(arrivalPatchDemand(!!(descent || arrivalHold), { altitudeKm, metresPerPixel: altitudeKm * 1000 * canvasTanPerPx, zoomedIn: close, hold: false })).then(() => {
      if (patch === active && patchBoundRevision !== active.revision && moon.layoutReady(active)) {
        moon.setPatch(active.levels.length ? active : null, site?.maxSlope, site?.fusedGround)
        patchBoundRevision = active.revision
        applyFloor()
        // A new floor never restarts or teleports an in-progress descent: its clock is monotonic, and stepDescent's distance lag absorbs the step in the floor.
        if (active.readyCoarse && patchSiteId === 'a17') {
          const g = ensureGround(); if (g && !STILL) void g.loadLm(ephem, aspect).catch(() => undefined)
        }
        markMoved()
      }
    })
  }
  passTimer.mark('tiles')
  if (tiles && !(ABL.has('tilefreeze') && gestureOn)) {
    applyFloor()
    const streamView = {
      pos: cam.pos, right: cam.right, up: cam.up, back: cam.back, tanHalf: cam.tanHalf, aspect, tanPerPx: canvasTanPerPx,
      moonX: ephem.moonX, moonY: ephem.moonY, moonZ: ephem.moonZ, moving: gestureOn, frameMs: tileFrameSmoothed, flight: !!(tween || cinematicFlight || intro?.moving), scripted: cameraOwned(), patchLoading: patchState === 'loading' && (!!descent || approachFor !== null), flightReuse: !captureSession, flightId: currentWantedFlightId(),
      texels: sharpFlightTexels(),
      // `?pressyield=1`: the first PRESS_YIELD_MS after a press upload nothing (and build no shadow layer, below), never in a capture or a scripted flight.
      yield: yielding,
    }
    // The beat before a sharp flight streams the path's first third while the camera holds the start pose.
    const prepCam = cinematicFlight?.prepCam
    if (prepCam) { streamView.pos = prepCam.pos; streamView.right = prepCam.right; streamView.up = prepCam.up; streamView.back = prepCam.back; streamView.tanHalf = prepCam.tanHalf; streamView.tanPerPx = prepCam.tanHalf / (ch / 2) }
    if (WANT_PROBE) lastStreamView = { ...streamView, pos: cam.pos.clone(), right: cam.right.clone(), up: cam.up.clone(), back: cam.back.clone(), moonX: ephem.moonX.clone(), moonY: ephem.moonY.clone(), moonZ: ephem.moonZ.clone() }
    tilesBusy = span('tiles.update', () => tiles!.update(streamView, performance.now()))
    tilesFadeOnly = tilesBusy && tiles.fadeOnlyBusy
    // The horizon envelope of the 4k map (fixed policy): the highest horizon in any azimuth per texel, Sun-independent, built once in budgeted blocks; the shader skips the Sun and viewer
    // marches where they clear it (everywhere else it marches live, as legacy). It needs the 4k heights (not their placeholder) and is idle in the ground view and for baked/off shadows.
    if (SHADOW_POLICY === 'fixed' && GH_CACHE_ON && !globalHorizonFailed) {
      const floatRt = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float')
      if (!globalHorizon && floatRt && !maps.height.pending && maps.height.lonSpan === 180) globalHorizon = new GlobalHorizonCache(renderer, moon.uniforms, maps.height.lonSpan, maps.height.size[0], quality.detected.cls !== 'desktop')
      if (globalHorizon) {
        const mode = getShadowMode()
        const ghBusy = globalHorizon.update({
          now: performance.now(), frameMs: tileFrameSmoothed, frameQuery: gpuTimer,
          allowed: !gm && mode !== 'baked' && mode !== 'off' && !maps.height.pending,
        })
        moon.setGlobalHorizon(globalHorizon.texture, globalHorizon.readOn)
        tilesBusy = ghBusy || tilesBusy
        if (globalHorizon.failed) { moon.setGlobalHorizon(null); globalHorizon.dispose(); globalHorizon = null; globalHorizonFailed = true }
      }
    }
    // The Sun-keyed 4k horizon bake (fixed policy, with the envelope's shader variant): built in budgeted blocks once the Sun is still, read as it stands (an unbuilt cell marches live), dropped when the Sun moves.
    if (SHADOW_POLICY === 'fixed' && GH_CACHE_ON && SUN_BAKE_ON && !sunBakeFailed && globalHorizon) {
      if (!sunBake && !maps.height.pending && maps.height.lonSpan === 180) sunBake = new SunHorizonBake(renderer, moon.uniforms, maps.height.lonSpan, maps.height.size[0], quality.detected.cls !== 'desktop')
      if (sunBake) {
        const mode = getShadowMode()
        const sbBusy = sunBake.update({ now: performance.now(), frameMs: tileFrameSmoothed, frameQuery: gpuTimer, allowed: !gm && mode !== 'baked' && mode !== 'off' && !maps.height.pending })
        moon.setSunBake(sunBake.texture, sunBake.readOn)
        tilesBusy = sbBusy || tilesBusy
        if (sunBake.failed) { moon.setSunBake(null); sunBake.dispose(); sunBake = null; sunBakeFailed = true }
      }
    }
    // The per-tile horizon envelope (fixed policy): built for fully faded shaded tiles once the ground is quiet, cleared when a tile within the march's reach changes; the shader skips the tile
    // march and the viewer march where the Sun / viewer clears its bound. Needs the 4k envelope's shader variant (same gate) and the shadow cache's tile set.
    if (SHADOW_POLICY === 'fixed' && GH_CACHE_ON && TENV_ON && !tileEnvelopeFailed && tiles && globalHorizon) {
      const floatRt = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float')
      if (!tileEnvelope && floatRt && maps.height.lonSpan === 180) {
        tileEnvelope = new TileEnvelope(renderer, moon.uniforms, tiles.capacity, maps.height.lonSpan, maps.height.size[0], tiles.deepest, quality.detected.cls !== 'desktop')
      }
      if (tileEnvelope) {
        const mode = getShadowMode()
        const teBusy = tileEnvelope.update(tiles, { now: performance.now(), frameMs: tileFrameSmoothed, frameQuery: gpuTimer, allowed: !gm && mode !== 'baked' && mode !== 'off', motion: gestureOn || scale < 1 || yielding })
        moon.setTileEnvelope(tileEnvelope.texture, tileEnvelope.readOn)
        tilesBusy = teBusy || tilesBusy
        if (tileEnvelope.failed) { moon.setTileEnvelope(null); tiles.trackEnvChanges = false; tileEnvelope.dispose(); tileEnvelope = null; tileEnvelopeFailed = true }
      }
    }
    // The shadow cache: layers whose Sun is not this frame's are dropped before the Moon is drawn, a few are built when the Sun is still.
    // ?shprobe=noupdate (measurement only): the cache exists and is attached but is never updated and never read, to separate its presence from its per-frame work.
    if (getShadowMode() === 'baked') { moon.uniforms.uShOn.value = 0; moon.uniforms.uPShOn.value = 0 }
    if (shadowCache && !gm && params.get('shprobe') === 'noupdate') moon.uniforms.uShOn.value = 0
    else if (shadowCache && !gm && getShadowMode() !== 'baked') {
      // Drift is only for the live clock's slow Sun motion; an active Moon turn changes the body-frame Sun and must drop old layers immediately.
      passTimer.mark('sun-visibility-cache')
      const legacyMotion = shadowMotionForFrame(capture, gestureOn || scale < 1 || yielding)
      const shadowBusy = shadowCache.update(tiles, ephem, performance.now(), { drift: live && !moonTurnMotion, motion: cacheBuildMotion(SHADOW_POLICY, legacyMotion, sharpDefer), catchUp: buildOnly, capture, frameStart: frameT0, frameQuery: gpuTimer, ...(SHADOW_POLICY === 'fixed' ? { fixedPolicy: true, ...(blockCapFrame ? { maxBlocks: 1 } : {}), fixedBudgetMs: Math.max(0.25, Math.min(8, Number(params.get('shbuildms')) || (FENCE_CLASS ? 1.5 : 3))) } : {}) })
      if (shadowBusy) tilesFadeOnly = false
      tilesBusy = shadowBusy || tilesBusy
      // With no layer shown (a Sun drag, a fresh Sun) the plain live march is cheaper than the cache path's fade fetch and branch: shader reads the cache only when it serves.
      const legacyRead = !(SH_MOTION_LIVE && gestureOn && !FENCE_CLASS)
      moon.uniforms.uShOn.value = ((SHADOW_POLICY === 'fixed' && shadowCache.readOn) || shadowCache.shaderOn) && cacheReadDuringMotion(SHADOW_POLICY, legacyRead) ? 1 : 0
      // A layer that cannot be rendered to: the cache is detached for good and the shader marches live (the A/B control's path).
      if (shadowCache.detachIfFailed(moon, tiles)) shadowCache = null
    }
    if (buildOnly) { renderer.setRenderTarget(null); return }
    // The patch shadow cache: blocks of the site patch's ground horizons, built nearest the view first in rest frames only (never in a gesture or a motion frame).
    if (patchShadowCache && getShadowMode() !== 'baked') {
      // Pre-arrival catch-up (W3-M2, R55): while a scripted arrival runs with the site's patch bound, the cache builds at half the rest rate instead of waiting for the camera to stop.
      passTimer.mark('patch-shadow-cache')
      const arriving = !gm && patchState === 'ready' && !gestureOn && scale >= 1 && !!(descent || pendingLanding !== null || ((tween || flight || rig.gliding()) && moon.patchInView()))
      const patchLegacyMotion = shadowMotionForFrame(capture, scale < 1 || gestureOn || yielding || !!(tween || descent || rig.gliding() || flight || ridge || orbitJourney))
      const patchShadowBusy = patchShadowCache.update(tiles, ephem, performance.now(), { active: !gm && moon.patchInView(), catchUp: arriving, drift: live && !moonTurnMotion, motion: cacheBuildMotion(SHADOW_POLICY, patchLegacyMotion, sharpDefer), frameStart: frameT0, frameQuery: gpuTimer, camPos: cam.pos, camBack: cam.back, ...(SHADOW_POLICY === 'fixed' ? { fixedPolicy: true, ...(blockCapFrame ? { maxBlocks: 1 } : {}), fixedBudgetMs: Math.max(0.25, Math.min(8, Number(params.get('pshbuildms')) || (FENCE_CLASS ? 1.5 : 3))) } : {}) })
      if (patchShadowBusy) tilesFadeOnly = false
      tilesBusy = patchShadowBusy || tilesBusy
      // Gestures march live on desktop (V1.1 parity, as the global cache): the patch program draws without the read while one runs.
      const legacyRead = !(SH_MOTION_LIVE && gestureOn && !FENCE_CLASS)
      if (!cacheReadDuringMotion(SHADOW_POLICY, legacyRead)) { patchShadowCache.shaderOn = false; moon.uniforms.uPShOn.value = 0 }
      if (patchShadowCache.failed) { moon.uniforms.uPShOn.value = 0; moon.setPatchShadowCache(null); patchShadowCache.dispose(); patchShadowCache = null }
    }
  }

  }
  // The scene, back to front (README): stars, the Sun, the Earth, the Moon.
  passTimer.mark('stars+bodies')
  // ?stars=native: the stars as native-resolution dots in the final pass (sky/starDots.ts) instead of the sprites below; a ridge frame keeps the sprites.
  final.setStarDots(stars, !!stars && starsLevel > 0 && !rf, cw, ch)
  renderer.setRenderTarget(t.scene)
  if (!skipScene) {
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, !!gm || !!fl, false)
    if (stars && starsLevel > 0) stars.render(renderer)
  }
  const frame: FrameInfo = { now, ephem, cam, width: w, height: h, tanPerPx, exposure }
  // Terrain or the lander draws over the sky. Ground mode and a flight's lander have a depth attachment the final pass reads as coverage (sun/sunCoverage.ts), so
  // their Sun takes the display path; the ridge view has none, so it keeps the HDR path (sun/sunRouting.ts).
  sunForeground = !!(gm || rf || ridge || (fl && groundMode?.lm))
  sunCoverage = !!(gm || (fl && groundMode?.lm)) && !!t.scene.depthTexture
  if (!skipScene) span('bodies', () => { for (const p of bodyPasses) {
    p.update(frame)
    p.render(renderer)
  } })
  if (rf && ridge) {
    const st = skyState(ephem, ridge.obs)
    const warm = Math.max(0, Math.min(1, (st.sun.alt + 8) / 6)) * Math.exp(-Math.max(0, st.moon.alt) / 10)
    final.setAureole(0.003 * RIDGE_HAZE * rf.air, [0.86 + 0.14 * warm, 0.9 - 0.18 * warm, 1 - 0.5 * warm])
  } else final.setAureole(0, [1, 1, 1])
  // In the ridge view the Sun is under the horizon, so no glare from it.
  final.setSunGlare(rf && rf.air > 0.02 ? { ...sun.glare, on: false } : sun.glare, t, cw, canvas.clientWidth, !!visibilityCalibration || auditHeld, m.invViewProj, cam.pos)
  final.setMoonGlare(moonGlareScale(cam.pos, ephem.sunDir))
  final.setShoulder(easedShoulder(!!gm, now))
  final.setSkyStars(skyStarsGain > 0 && !gm && !fl && !rf ? skyStarsGain : 0)
  if (gm) {
    passTimer.mark('ground')
    span('ground.update', () => gm.update(ephem, aspect))
    if (fl) applyFlightToModule(gm, fl, exposure.preExpose, h, aspect, true)
    else if (settle) applySettle(gm, settle, exposure.preExpose, h, aspect)
    span('ground.render', () => gm.render(ephem, aspect, exposure.preExpose))
  } else {
    passTimer.mark('moon')
    if (!finalOnly) span('moon.render', () => band ? moon.renderBand(renderer, t.scene, band.k, band.n) : moon.render(renderer))
    // The hit target holds this camera's surface only when a whole frame (not a band) shared its hit.
    if (centreCtl && !finalOnly && !band) presentedScene.drewMoon(moon.hitShared, w, h)
    passTimer.mark('after-moon')
    if (rf && ridge) {
      const st = skyState(ephem, ridge.obs)
      ridgePass.update(ridge.obs, st.moon, st.sun, rf)
      ridgePass.render(renderer)
    }
    if (fl && groundMode?.lm) {
      applyFlightToModule(groundMode, fl, exposure.preExpose, h, aspect, false)
      groundMode.renderFlightLm(ephem, aspect, exposure.preExpose, fl.view, fl.lm.pos, fl.lm.quat)
    }
  }
  if (band) {
    if (band.k === 0) { band.exposure = exposure; band.tilesBusy = tilesBusy }
    // A partial frame is not presented: the canvas keeps the last picture until the final band's glare and final pass.
    if (band.k < band.n - 1) { renderer.setRenderTarget(null); return }
  }
  // Independent metadata uses the identical frame/camera/resolution, then genuine foreground occlusion.
  if (visibilityCalibration || auditHeld) {
  passTimer.mark('viewer-visibility')
  renderer.setRenderTarget(targets.metadata(t))
  renderer.setClearColor(0x000000, 0)
  renderer.clear(true, !!gm, false)
  if (gm) gm.renderMetadata(aspect)
  else {
    moon.renderMetadata(renderer)
    if (rf && ridge) ridgePass.renderMetadataOcclusion(renderer)
    if (fl && groundMode?.lm) groundMode.lm.renderMetadataOcclusion(renderer, { ...fl.view, pos: new THREE.Vector3() }, aspect)
  }
  renderer.setRenderTarget(t.scene)
  }
  if (DEBUG && gm?.lm) selfCheckShade(gm)
  passTimer.mark('glare')
  if (!finalOnly && getQuality().glow) span('glare', () => glare.run(renderer, t, moonMotionCaps ? MOTION_GLARE_LEVELS : undefined, (n) => passTimer.mark(n)))
  const otherDirty = dirty
  const fading = final.stepDate(now)
  if (fading) { markDirty(); because('dateTransition') }
  else dateTransition = null
  passTimer.mark('final')
  span('final', () => final.render(renderer, t, exposure))
  if (PERF) programCount(renderer.info.programs?.length ?? 0)
  renderer.setRenderTarget(null)
  // Focus pull: the indicator shows only while a visible tile is drawn coarser than wanted with its finer level in flight; its fade out asks for frames.
  // Without `?focuspull=1` (the default): nothing is measured or allocated.
  if (focusPullOn() && focusScreen.frame(renderer, performance.now(), tiles ? tiles.focusMeasure(cw) : null, !STILL && !captureSession && !capture)) { markDirty(); because('focusScreen') }

  last = { cam, ephem, exposure, w, h, cw, ch }
  lastCamAt = cameraNow
  if (FLIGHT_FEEL) recordDrawnPose(cameraNow)
  // Presented: the scene on screen now is the one drawn at the start of this frame or band sequence (a final-only redraw keeps the previous scene).
  if (centreCtl) {
    const onScreen = presentedScene.presented(finalOnly)
    // A scripted move (tween, descent, route show) is not a settle even if the rig still reports a coast from before it started.
    if (onScreen) centreCtl.sawCamera(onScreen, performance.now(), presentedScene.generation, rig.settling() && !tween && !descent && !routeFlight, lastUserInputAt)
  }
  if (hud.creditsOpen && now - lastCreditsRefresh >= 250) {
    lastCreditsRefresh = now
    hud.refreshCredits()
  }
  api.exposure = { white: exposure.white, preExpose: exposure.preExpose, esLevel: exposure.esLevel, esLevelView: exposure.esLevelView, longMax: exposure.longMax, hdr: exposure.hdr, esMax: exposure.search.esMax, bestA: exposure.search.bestA, sunlit: exposure.search.sunlitFraction, earthshine: ephem.earthshine, air: airIn ?? null }
  notifyChange()
  updateGroundUi()
  updateFlightUi()
  if (tilesBusy) {
    // Only a tile fade wants the next frame, on a class with a fade cadence, with nothing else asking for one: thin the fade frames out (R57).
    const fadeMs = fadeCadenceNow()
    if (fadeMs > 0 && tilesFadeOnly && !gestureOn && !captureSession && !dirty) { wakeForFade(fadeMs); because('tilesFade') }
    else { markDirty(); because('tilesBusy') }
  }
  // Only the crossfade wants another frame: the next one redraws the final pass over this scene target instead of marching the Moon again.
  fadeOnly = fading && !otherDirty && !tilesBusy && !gm && !fl && !rf ? { scale } : null
  api.frames++
  if (camTrace) camTrace.push({ ...traceRow(cam, now), scale, gesture: gestureOn })
  lastRenderedAt = performance.now()
  renderedFrameId++
  if (!STILL && !rf && !ABL.has('dom0')) {
    const km = cam.pos.length() * MOON_R_KM
    const tHud0 = PERF ? performance.now() : 0
    // The point under the camera, once for the tape, the HUD and the ground height (four identical calls before).
    const under = underCamera(ephem, cam.pos)
    span('dom.tape', () => {
      const groundKm = patch && rig.site ? siteGround(rig.site, under.lon, under.lat) * MOON_R_KM : 0
      const heightM = heightAboveSurfaceM({ distKm: km, groundKm, aglM: gm && !fl ? span('dom.tape.agl', () => gm.cam.agl()) : null })
      const floorGroundKm = patch && rig.site ? siteGround(rig.site, rig.pose.lon, rig.pose.lat) * MOON_R_KM : 0
      const floorM = (rig.floorAt(rig.pose.lon, rig.pose.lat) - 1) * MOON_R_KM * 1000 - floorGroundKm * 1000
      // The tape is for the visitor's own zoom: not a flight, a viewpoint move, Home or a time change (the reading still follows the camera).
      const scriptedNow = viewpointJourneyRunning() || !!(flight || ridge || routeFlight || cinematicFlight || orbitJourney || tween || descent || intro?.moving)
      if (scriptedNow) zoomTapeUi?.hide()
      const tapeNow = performance.now()
      span('dom.tape.ui', () => zoomTapeUi?.update(heightM, floorM, tapeWakeAllowed(tapeNow, rig.lastZoomInputAt, scriptedNow, tapeCheckedAt)))
      tapeCheckedAt = tapeNow
      const limitPulse = tapeLimitPulse(rig.limitHits, zoomTapeLimitHits, scriptedNow)
      zoomTapeLimitHits = limitPulse.seen
      if (limitPulse.pulse) zoomTapeUi?.pulse()
    })
    hud.update({
      mode: rig.mode,
      live,
      waxing: isWaxing(ephem),
      hint: hintOn && !ARCHIVE,
      date: ephem.date,
      distKm: km,
      under,
      phaseFromCameraDeg: cam.pos.clone().normalize().angleTo(ephem.sunDir) * 180 / Math.PI,
      illuminatedFraction: ephem.illuminatedFraction,
      // The date's libration (a hand turn is a view gesture, not the Moon's real orientation).
      libration: clockEphemerisAt(time).subEarth,
      earthshine: ephem.earthshine,
      shadow: earthShadowState(),
      exposure,
      nightFloorApplied,
      groundKm: patch && rig.site ? siteGround(rig.site, under.lon, under.lat) * MOON_R_KM : 0,
      patchLine: groundHudLine(gm, cam, canvasTanPerPx),
      visibilityFloor: visibilityCalibration ? 'applied' : 'pending',
      ground: gm && !fl ? groundHud(gm, aspect) : null,
      flight: fl ? flightHud(fl) : null,
      archive: ARCHIVE,
      resolution: tiles ? residentResolution((cam.pos.length() - 1) * MOON_R_KM * canvasTanPerPx, underCamera(ephem, cam.pos)) : null,
    })
    if (PERF) perfAdd('dom.hud', performance.now() - tHud0)
  }
}


// ---------------------------------------------------------------------------
// The ridge opening and its lift-off (src/ridge), and the slider every journey shares (src/journey).
// The ridge view is the moon-v1 `ridge` preset: an observer in the Alps, the crescent Moon low behind an illustrative
// ridge. The lift-off is one camera from there to the orbit view (ridge/journey.ts); at the end the rig takes over at
// exactly the pose the site's own dolly zoom lands on.
// ---------------------------------------------------------------------------
/** Aerosol scale of the ridge evening (moon-v1's ridge preset: 1.6, a hazy dusk; 1 is clear). A look choice, labelled. */
const RIDGE_HAZE = 1.6
/** The exposure offset of the ridge look, stops (moon-v1 used 0.3 with its own white point; this site's frame search gives a brighter white, so a little more). A look choice. */
const RIDGE_EV = 0.8
interface RidgeState { u: number; t0: number; playing: boolean; obs: Observer; /** The progress the frame is drawn at: it follows `u` on a short lag while the slider is dragged (a jump of the handle is not a jump of the lens), and equals it otherwise. */ shown?: number; shownAt?: number }
/** The time constant of the shown progress behind a dragged slider, ms. */
const SCRUB_FOLLOW_MS = 140
let ridge: RidgeState | null = null
let ridgeF: JourneyFrame | null = null
let ridgePass: RidgePass
let ridgeUi: ReturnType<typeof mountRidgeUi> | null = null
const scrub = new JourneyScrub()
let scrubUi: ReturnType<typeof mountJourneyScrub> | null = null
let scrubEndingUntil = 0
let scrubCancelled = false
/** Drops the slider's lingering ending at once: every mode change and cancel calls this (stopMoments, enterGround, leaveGround, startRouteFlight, goHome, playMoment). */
function resetScrubEnding(): void { scrubEndingUntil = 0; scrubCancelled = true }
let navUpdatedAt = 0
const JOURNEY_MS = JOURNEY_SECONDS * 1000

function startRidge(u = 0, playing = false): void {
  moonSurfaceTurn.stopInertia()
  cancelPendingWheelZoom()
  cancelRoute()
  declareExposureCut()
  time = new Date(RIDGE_TIME.getTime())
  live = false
  ephem = clockSet(time)
  const now = performance.now()
  hud.message('')
  ridge = { u: clamp01(u), t0: t0AtProgress(now, u, JOURNEY_MS), playing, obs: observerAt(ephem) }
  rig.auto = false
  markMoved()
}
/** Leaves the ridge view where it is (another mode takes over from the Earth view). */
function dropRidge(): void {
  if (!ridge) return
  ridge = null
  ridgeF = null
  api.ridge = false
  // What startRidge switched off comes back; the ridge's date stays (the Back to now chip shows while the clock is not live).
  rig.auto = ridgeExit({ autoAllowed: idleOrbitOn(params, STILL), live }).auto
  markMoved()
}
/** Skip: the Earth view, on the ridge's date like every other way out; Back to now is one click. */
function skipRidge(): void {
  if (!ridge) return
  dropRidge()
  markMoved()
  notifyChange()
}
/** Arrival: the orbit view over the sub-Earth point, with no jump. */
function finishRidge(now: number): void {
  if (journey.state?.id === 'lift-off') journey.arrive(journey.state.generation, now)
  const aspect = canvasAspect()
  rig.setPose(endPose(ephem, aspect))
  rig.fovDeg = FLY_FOV_DEG
  rig.aimShift = 0
  rig.aimShiftX = 0
  rig.lastInputAt = now
  dropRidge()
  notifyChange()
}
function stepRidge(now: number): boolean {
  if (!ridge) { ridgeF = null; return false }
  if (ridge.playing) ridge.u = progressOfTimed(now, ridge.t0, JOURNEY_MS)
  if (ridge.playing && ridge.u >= 1 && !scrub.held) { finishRidge(now); return true }
  ridge.obs = observerAt(ephem)
  let shown = ridge.u
  if (!STILL && ridge.shown !== undefined && ridge.shownAt !== undefined && (scrub.held || ridge.shown !== ridge.u)) {
    const k = Math.exp(-Math.min(250, Math.max(0, now - ridge.shownAt)) / SCRUB_FOLLOW_MS)
    shown = ridge.u + (ridge.shown - ridge.u) * k
    if (Math.abs(shown - ridge.u) < 1e-3) shown = ridge.u
  }
  ridge.shown = shown; ridge.shownAt = now
  ridgeF = journeyFrame(shown, { e: ephem, aspect: canvasAspect(), obs: ridge.obs })
  return ridge.playing || scrub.held || shown !== ridge.u
}
function liftOff(): void {
  clearAutoRetry()
  if (!ridge) return
  journey.begin('lift-off', 'Lift off', 'earth', performance.now())
  ridge.playing = true
  ridge.t0 = t0AtProgress(performance.now(), ridge.u, JOURNEY_MS)
  markMoved()
}
/** The Alps ridge opening as a place to go (the Moon opens on Home; this is the way back to the evening behind the ridge). */
function openRidge(): void {
  if (groundMode?.active) { leaveGround(false, openRidge); return }
  cancelRoute()
  bar?.closeSheets()
  if (flight) stopFlight(true)
  tween = null; descent = null; orbitJourney = null; approachFor = null; pendingLanding = null
  playSeq++
  pinShown = null
  homeFrame = false
  caption.show('', '')
  toursApi?.demote()
  clearMomentUrl()
  if (ridge) dropRidge()
  startRidge(0, false)
  api.ridge = true
  navApi?.noteSelected({ kind: 'ridge', id: 'alps-ridge' })
}
function pauseRidge(): void {
  if (!ridge) return
  ridge.playing = !ridge.playing
  if (ridge.playing) ridge.t0 = t0AtProgress(performance.now(), ridge.u, JOURNEY_MS)
  markMoved()
}
const fmtUtc = (d: Date): string => `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UT`
function ridgeUiState() {
  const st = ridge ? skyState(ephem, ridge.obs) : null
  return {
    active: !!ridge, playing: !!ridge?.playing, u: ridge?.u ?? 0, altKm: ridgeF?.altKm ?? 0,
    dateText: `${RIDGE_SITE.name}, ${fmtUtc(ephem.date)}`,
    moonText: st ? `Moon ${(ephem.illuminatedFraction * 100).toFixed(0)}% lit, ${st.moon.alt.toFixed(1)}° up` : '',
  }
}

const timedHandles = {
  ridge: { id: 'ridge', label: 'Lift-off', get: () => ridge?.u ?? 0, set: (u: number, now?: number) => {
    if (!ridge) return
    ridge.u = clamp01(u)
    ridge.t0 = t0AtProgress(now ?? performance.now(), ridge.u, JOURNEY_MS)
    markMoved()
  } } satisfies JourneyHandle,
  descent: { id: 'descent', label: 'Descent', get: () => (descent && descent.t0 >= 0 ? (descent.u ?? progressOfTimed(performance.now(), descent.t0, descent.ms)) : 0), set: (u: number, now?: number) => {
    if (descent && descent.t0 >= 0) { descent.t0 = t0AtProgress(now ?? performance.now(), u, descent.ms); markMoved() }
  } } satisfies JourneyHandle,
  tween: { id: 'tween', label: 'Move to the view', get: () => (tween ? tweenProgress(tween, performance.now()) : 0), set: (u: number, now?: number) => {
    if (tween) { tween.t0 = t0AtProgress(now ?? performance.now(), u, tween.plan.ms); markMoved() }
  } } satisfies JourneyHandle,
}
let flightWasPlaying = false
const flightHandle: JourneyHandle = {
  id: 'flight', label: 'Powered descent',
  get: () => (flight ? (flight.t - HANDOVER_T) / Math.max(1, flight.path.tMax - HANDOVER_T) : 0),
  set: (u) => { if (flight) { flight.seek(HANDOVER_T + clamp01(u) * (flight.path.tMax - HANDOVER_T)); markMoved() } },
  freeze: (on) => {
    if (!flight) return
    if (on) { flightWasPlaying = flight.playing; flight.playing = false } else flight.playing = flightWasPlaying && !flight.ended
  },
}
/** The flight on screen as a journey the slider can hold, seek and pause: one handle per flight, so a drag is not released every frame. */
function cinematicHandle(f: NonNullable<typeof cinematicFlight>): JourneyHandle {
  if (f.handle) return f.handle
  const ms = f.definition.seconds * 1000
  const h: JourneyHandle = {
    id: 'cinematic', label: journey.state?.label ?? 'Flight', durationS: f.definition.seconds,
    get: () => (cinematicFlight === f ? (f.pausedU ?? progressOfTimed(performance.now(), f.t0, ms)) : 1),
    set: (u, now) => {
      if (cinematicFlight !== f) return
      f.t0 = t0AtProgress(now ?? performance.now(), u, ms)
      if (f.pausedU !== null) f.pausedU = clamp01(u)
      markMoved()
    },
    paused: () => f.pausedU !== null,
    pause: (on) => {
      if (cinematicFlight !== f) return
      f.pausedU = on ? progressOfTimed(performance.now(), f.t0, ms) : null
      if (!on) f.t0 = t0AtProgress(performance.now(), progressOfTimed(performance.now(), f.t0, ms), ms)
      markMoved()
    },
  }
  f.handle = h
  return h
}
const orbitHandle: JourneyHandle = {
  id: 'orbit', label: 'Fly around the Moon', durationS: ORBIT_SECONDS,
  get: () => progressOfTimed(performance.now(), orbitJourney?.t0 ?? 0, ORBIT_SECONDS * 1000),
  set: (u, now) => { if (orbitJourney) orbitJourney.t0 = t0AtProgress(now ?? performance.now(), u, ORBIT_SECONDS * 1000); markMoved() },
}
/**
 * A moment's lead-in (the approach before its flight or orbit, Sharp's preparing beat): the slider is live from the start. Dragging it
 * past 0 ends the approach where it was headed and starts the journey at the dragged progress; the drag then holds the journey itself.
 */
const leadInHandle: JourneyHandle = {
  id: 'lead-in', leadIn: true,
  get label() { return journey.state?.label ?? 'Flight' },
  get durationS() { return cinematicFlight ? cinematicFlight.definition.seconds : ORBIT_SECONDS },
  get: () => 0,
  set: (u, now) => { if (u > 0) startLeadInAt(u, now ?? performance.now()) },
}
function startLeadInAt(u: number, now: number): void {
  const cin = cinematicFlight && cinematicFlight.t0 < 0 ? cinematicFlight : null
  const orbit = !cin && orbitJourney && orbitJourney.t0 < 0 ? orbitJourney : null
  if (!cin && !orbit) return
  if (tween) {
    // The approach lands where it was going (pose, lens, look) on this frame, as if it had run its course.
    const tw = tween
    tw.t0 = now - tw.plan.ms
    if (tw.floorBlend) tw.floorBlend.t0 = now - floorBlendDuration(tw.floorBlend)
    stepTween(now)
    tween = null
  }
  joinHandOverAt = null
  if (cin) {
    if (cin.prep) { cin.prepCam = null; cin.prep = undefined; targets.releaseScratch() }
    cin.t0 = t0AtProgress(now, u, cin.definition.seconds * 1000)
    cin.lastNow = now
    if (cin.definition.kind === 'eclipse') declareExposureCut('event')
  } else if (orbit) {
    orbit.t0 = t0AtProgress(now, u, ORBIT_SECONDS * 1000)
    orbit.lon0 = rig.pose.lon
  }
  markMoved()
}
/** The journey on screen now, if any; the slider drives it. */
function pickHandle(): JourneyHandle | null {
  if (flight && !flight.blending) return flightHandle
  if (ridge) return timedHandles.ridge
  if (descent && descent.t0 >= 0) return timedHandles.descent
  if (cinematicFlight && cinematicFlight.t0 >= 0) return cinematicHandle(cinematicFlight)
  if (orbitJourney && orbitJourney.t0 >= 0) return orbitHandle
  if (leadInRunning()) return leadInHandle
  if (tween) return timedHandles.tween
  return null
}
/** A moment's flight or orbit is waiting for its clock (the approach, Sharp's preparing beat) and no other journey owns the camera. */
function leadInRunning(): boolean {
  return !flight && !ridge && !descent && !!((cinematicFlight && cinematicFlight.t0 < 0) || (orbitJourney && orbitJourney.t0 < 0 && rig.mode === 'fly'))
}

let lastLoopAt = performance.now()
// A lost WebGL context (a GPU reset, a tab the browser reclaimed): stop drawing, and on
// restore give back what three does not own: the height map's CPU copy is gone (maps.ts frees it
// once uploaded) and the tile cache's raw textures died with the context. three re-creates its
// own targets, programs and other textures when the context returns.
let contextLost = false
let loopRunning = false
interface CaptureSession {
  fps: number; baseNow: number; clock: CaptureClock; flight?: CinematicFlight; tween?: ScriptedTween
  ready: boolean; cancelled: boolean
  patchRequired: boolean; tilesRequired: boolean; fadesSettled?: boolean; shadowIdleDraws?: number; stuckResident?: number; stuckSince?: number; warnedMissing?: boolean
  previousGestureOn: boolean
  previousLive: boolean; previousAuto: boolean; previousPose: Pose; previousTime: Date; previousFov: number
  previousAim: [number, number]; previousLook: number; previousLookBlend: ReturnType<CameraRig['snapshotLookBlend']>; previousDpr: [number, number]
}
let captureSession: CaptureSession | null = null
let captureSize: { width: number; height: number } | null = null
api.contextLosses = 0
api.contextRestores = 0
let lostAt = 0
let lossGeneration = 0
let healthyRecoveryAt: number | null = null
let healthyRecoveryPending = false
let healthyLastFrameAt: number | null = null
let healthyResetTimer: ReturnType<typeof setTimeout> | null = null
let healthyResetTimerFiredAt: number | null = null
// Native builds only (no dev tools there): read-only figures for a device pass, from a WebView inspector.
if (NATIVE_BUILD) {
  const w = window as unknown as Record<string, unknown>
  w.__moonLedger = () => ({ ...quality.snapshot(), patchResidentBytes: (patch as unknown as { residentBytes?: number } | null)?.residentBytes ?? null, ground: !!groundMode?.active, patchState, canvas: [canvas.width, canvas.height], dpr: window.devicePixelRatio })
  w.__moonLossInfo = () => storeGet(LOSS_INFO_KEY)
}
let lostWatch: ReturnType<typeof setInterval> | null = null
let nudged = false
let softStartedAt = 0
const storeGet = (k: string): string | null => { try { return sessionStorage.getItem(k) } catch { return null } }
const storeSet = (k: string, v: string | null): void => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v) } catch { /* blocked */ } }
// A persisted loss remains pending until a successful frame starts its healthy window.
healthyRecoveryPending = quality.contextLosses > 0 || Number(storeGet(LOST_RELOADS_KEY)) > 0
function clearHealthyResetTimer(): void {
  if (healthyResetTimer) clearTimeout(healthyResetTimer)
  healthyResetTimer = null
  healthyResetTimerFiredAt = null
}
function invalidateHealthyRecoveryWindow(): void {
  clearHealthyResetTimer()
  healthyRecoveryAt = null
  healthyLastFrameAt = null
}
function armHealthyResetTimer(): void {
  if (healthyRecoveryAt === null || contextLost || nativePaused || document.hidden || healthyResetTimer) return
  healthyResetTimer = setTimeout(() => {
    healthyResetTimer = null
    const now = performance.now()
    healthyResetTimerFiredAt = now
    if (!healthyResetDue(healthyRecoveryAt!, now, healthyLastFrameAt, !document.hidden && !nativePaused, contextLost, idleSleeping)) {
      // A stopped or stalled render loop breaks the streak. The next completed frame starts it again.
      healthyRecoveryAt = null
      healthyResetTimerFiredAt = null
      return
    }
    // A healthy foreground frame must arrive after this timer. A last frame just before the deadline
    // is not evidence that the render loop stayed alive through the end of the recovery window.
    if (idleSleeping) finishHealthyRecovery()
  }, HEALTHY_RESET_MS)
}
function finishHealthyRecovery(): void {
  storeSet(LOST_RELOADS_KEY, null)
  storeSet(LOST_CEILING_KEY, null)
  storeSet(LOST_CEILING_EXPIRES_KEY, null)
  healthyRecoveryAt = null
  healthyResetTimerFiredAt = null
  healthyRecoveryPending = false
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearHealthyResetTimer()
  else if (healthyRecoveryPending) { healthyRecoveryAt = null; healthyLastFrameAt = null }
})
/**
 * Gives up on in-place recovery: native reloads restore the shell's saved view; web reloads reopen the current URL as-is, at the lowered ceiling,
 * which is written to sessionStorage here and only here (a loss that recovers in place keeps it in memory). After MAX_LOSS_RELOADS of these in
 * one session, or when sessionStorage cannot hold the count, it stops, forgets the saved view (so the next launch starts at Home, not in the view
 * that lost the context) and says so, instead of sitting on a blank canvas.
 */
function reloadAfterLoss(): void {
  if (lostWatch) { clearInterval(lostWatch); lostWatch = null }
  // In the app, a reload into a WebView that refuses WebGL after a GPU reset is a dead end (issue #206): ask for a throwaway context first, and
  // when none is granted show the retry card, which waits, asks again and reloads at Home only once a context is available.
  if (lossExit(!!nativeHost, probeWebGL2(() => document.createElement('canvas'))) === 'retry') {
    const ceiling = ceilingToStore(quality.ceilingBytes, ledger.total())
    hud.message('')
    // Pressed by the visitor, so it reloads even past the loss budget; prepareLossReload still writes the count (a start at Home) and the lowered ceiling.
    showGpuRetry(() => {
      let store: Storage | null = null
      try { store = sessionStorage } catch { /* blocked */ }
      prepareLossReload(store, ceiling)
      if (nativeHost) try { localStorage.removeItem(LAST_VIEW_KEY) } catch { /* blocked */ }
      location.reload()
    })
    return
  }
  let store: Storage | null = null
  try { store = sessionStorage } catch { /* blocked: give up below */ }
  if (prepareLossReload(store, ceilingToStore(quality.ceilingBytes, ledger.total())) === 'give-up') {
    if (nativeHost) try { localStorage.removeItem(LAST_VIEW_KEY) } catch { /* blocked */ }
    hud.message('The graphics could not be restored on this device. Close the app and open it again.')
    return
  }
  // The reload comes up at Home (native/boot.ts reads LOST_RELOADS_KEY): never in the view that lost the context.
  if (nativeHost) try { localStorage.removeItem(LAST_VIEW_KEY) } catch { /* blocked */ }
  location.reload()
}
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault()
  // The same loss announced twice (the synthetic event of noticeUnannouncedLoss, then the real one late): handled once.
  if (lossEventIsDuplicate(contextLost, softStartedAt !== 0)) return
  contextLost = true
  lossGeneration++
  softStartedAt = 0
  clearHealthyResetTimer()
  healthyRecoveryAt = null
  healthyRecoveryPending = false
  healthyLastFrameAt = null
  // The splash would hide the messages below, and the frame loop that ends the opening has stopped (issue #206: stuck on the splash).
  intro?.abort()
  ;(api.contextLosses as number)++
  // What the page held at the loss, kept across the reload (read it with `__moonLossInfo()` from a WebView inspector): the ledger is a lower bound, the patch rasters are not in it.
  try {
    const q = quality.snapshot() as { ledger: unknown }
    storeSet(LOSS_INFO_KEY, JSON.stringify({ ledger: q.ledger, patchResidentBytes: (patch as unknown as { residentBytes?: number } | null)?.residentBytes ?? null, ground: !!groundMode?.active, patchState, canvas: [canvas.width, canvas.height], dpr: window.devicePixelRatio, sinceStartMs: Math.round(performance.now()) }))
  } catch { /* diagnostics only */ }
  // The ceiling becomes 0.7x of what the ledger held (this session only): recovering at the same settings would reproduce the loss.
  moon?.disposeBaked()
  tiles?.suspend()
  quality.contextLost()
  refreshReduced()
  hud.message('The graphics context was lost. Restoring…')
  // A restore that never comes (the white canvas of issue #206) ends in a reload, never a wait.
  lostAt = performance.now(); nudged = false
  if (lostWatch) clearInterval(lostWatch)
  lostWatch = setInterval(() => {
    if (!contextLost) { if (lostWatch) clearInterval(lostWatch); lostWatch = null; return }
    // A hidden page never reloads from here: the next poll after it is shown does.
    if (softStartedAt && softRecoveryExpired(performance.now() - softStartedAt)) { if (!document.hidden) reloadAfterLoss(); return }
    if (softStartedAt) return
    // The context is back but its `webglcontextrestored` never reached the page (it can be dropped across a freeze): recover as that event would.
    if (!(renderer.getContext() as WebGL2RenderingContext).isContextLost()) { void recoverContext(lossGeneration); return }
    const a = lostWatchdog(performance.now() - lostAt, nudged, document.hidden)
    if (a === 'nudge') {
      nudged = true
      try { (renderer.getContext() as WebGL2RenderingContext).getExtension('WEBGL_lose_context')?.restoreContext() } catch { /* only valid after the page's own loseContext */ }
    } else if (a === 'reload') reloadAfterLoss()
  }, Math.round(RESTORE_NUDGE_MS / 5))
})
/** Disposes the tile streamer and the shadow caches that read it; the next ensureTiles builds them again (at the ceiling then in force). `lost`: the context is gone. */
function releaseTiles(lost: boolean): void {
  if (shadowCache) { moon.setShadowCache(null); shadowCache.dispose(lost); shadowCache = null }
  if (lost && globalHorizon) { moon.setGlobalHorizon(null); globalHorizon.dispose(true); globalHorizon = null }
  if (tileEnvelope) { moon.setTileEnvelope(null); tileEnvelope.dispose(lost); tileEnvelope = null }
  if (sunBake) { moon.setSunBake(null); sunBake.dispose(lost); sunBake = null }
  if (patchShadowCache) { moon.setPatchShadowCache(null); patchShadowCache.dispose(lost); patchShadowCache = null }
  if (tiles) { tiles.dispose(lost); tiles = null }
  tilesState = TILE_BASE ? 'idle' : 'off'
  tilesLoading = null
  api.tiles = undefined
  moon.setTiles(null)
}
/**
 * Memory ceiling enforcement (R54, quality/enforce.ts). The ledger above the class ceiling for 2 s arms a shed: the landing-site patch goes first
 * and only while the camera is outside its coverage, then the tile cache is rebuilt to the room that is left; a busy view waits. `?memcap=0` off.
 * The pending shed ends when the ledger fits, nothing is releasable, or 60 s pass.
 */
/** A gesture, flight, ground mode, capture, load or lost context: nothing is released or rebuilt now. */
const viewBusy = (): boolean => gestureOn || !!(tween || flight || cinematicFlight || descent || ridge || routeFlight || orbitJourney || groundMode?.active || contextLost || captureSession || rig.dragging || rig.gliding()) || tilesState === 'loading' || patchState === 'loading'
const memcapOn = !memcapOff(location.search)
const overrunWatch = newOverrunWatch()
let overrunPending: { until: number } | null = null
let memShedTileCap: number | null = null
const memShed = { count: 0, patch: 0, tiles: 0, last: '', overBytes: 0 }
function enforceMemory(now: number): void {
  if (!memcapOn || !Number.isFinite(quality.ceilingBytes)) return
  const total = ledger.total()
  if (!overrunPending && overrunPoll(overrunWatch, now, total, quality.ceilingBytes)) overrunPending = { until: now + PRESSURE_PENDING_MS }
  if (!overrunPending) return
  if (now > overrunPending.until) { overrunPending = null; return }
  const busy = viewBusy()
  const cats = ledger.byCategory()
  const plan = shedPlan({
    total, ceiling: quality.ceilingBytes, patchBytes: cats.patch, patchReady: patchState === 'ready' && !!patch,
    awayFromPatch: rig.pose.dist >= PATCH_COVERAGE_DIST && !groundMode?.active,
    tilesReady: !!tiles && tilesState === 'ready' && !new URLSearchParams(location.search).has('tilecache'), tilesBytes: cats.tiles, tileLayers: tiles?.capacity ?? 0, minLayers: 8, pairBytes: TILE_PAIR_BYTES, busy,
  })
  if (plan.fits) { overrunPending = null; return }
  if (busy) return
  if (!plan.steps.length) { overrunPending = null; return }
  memShed.overBytes = total - quality.ceilingBytes
  if (plan.steps.includes('patch')) { dropPatch(); memShed.patch++ }
  if (plan.steps.includes('tiles') && plan.tileLayers !== null) { memShedTileCap = plan.tileLayers; releaseTiles(false); memShed.tiles++ }
  memShed.count++
  memShed.last = plan.steps.join('+')
  refreshReduced()
  markDirty()
  overrunPending = null
}

/**
 * Adaptive tile cache (W3-M5, quality/cachegrow.ts): starts at the remembered size (else the allocated class size); while every signal is calm it
 * RECORDS one step more for the NEXT load, never rebuilding mid-session; an overrun shed is followed down. `?cachegrow=0` keeps the fixed class size.
 */
const cacheGrowOn = !cachegrowOff(location.search) && GROW_CLASSES.includes(quality.detected.cls) && Number.isFinite(quality.ceilingBytes) && !new URLSearchParams(location.search).has('tilecache')
let cacheGrow: GrowState | null = null
let cacheGrowKv: Storage | null = null
try { cacheGrowKv = localStorage } catch { cacheGrowKv = null }
const cacheShedSeen = { n: 0 }
let cacheWritten = 0
let cacheTickAt = 0
let cacheFrameMs = 16
let cacheGrowEvents = { grown: 0, shrunk: 0 }
/** The layer count a (re)build asks for: the grown size when the ledger has room for it, else what the creation fit gave. */
function growLayers(fitted: number, maxArrayLayers: number): number {
  if (!cacheGrowOn || !TILE_BASE) return fitted
  const cls = quality.detected.cls
  if (!cacheGrow) {
    cacheGrow = startFromStorage(cacheGrowKv, cls, fitted, maxFor(quality.profile.tiles, maxArrayLayers), performance.now())
    cacheWritten = cacheGrow.next
  }
  // A context loss this session: back to the start size for good (a rebuild after the loss comes through here before the poll sees it).
  if (quality.contextLosses > 0 && !cacheGrow.lostContext) {
    cacheGrow.lostContext = true; cacheGrow.size = cacheGrow.start; cacheGrow.next = cacheGrow.start; cacheGrow.lastShrink = 'context_loss'; cacheGrow.shrinks++
    writeRemembered(cacheGrowKv, cls, cacheGrow.size); cacheWritten = cacheGrow.next
  }
  if (cacheGrow.lostContext || cacheGrow.size <= fitted) return fitted
  const room = quality.ceilingBytes - (ledger.total() - ledger.byCategory().tiles) - patchRoom(quality.profile.patchResidentBytes ?? PATCH_DEFAULT_BYTES, ledger.byCategory().patch) - SAFETY_BYTES - GROW_HEADROOM_BYTES
  return fitLayers(cacheGrow.size, fitted, TILE_PAIR_BYTES, room)
}
/** Keep the crash marker current (the live size); the marker is cleared on pagehide. */
function persistGrow(): void {
  if (cacheGrow) setRunning(cacheGrowKv, quality.detected.cls, cacheGrow.size)
}
addEventListener('pagehide', () => { clearRunning(cacheGrowKv, quality.detected.cls) })
/** Decides and RECORDS the size for the next load. It never rebuilds the live cache: a rebuild flashes the 4k maps (see quality/cachegrow.ts). */
function stepCacheGrow(now: number): void {
  if (!cacheGrowOn || !cacheGrow || !tiles || tilesState !== 'ready') return
  const gap = now - cacheTickAt
  cacheTickAt = now
  if (gap > 0 && gap <= 100) cacheFrameMs = cacheFrameMs * 0.9 + gap * 0.1 // awake frames only: a sleeping loop's long gaps are not slow frames
  const cats = ledger.byCategory()
  const s = {
    now, visible: !document.hidden, atRestMs: now - lastUserInputAt, busy: viewBusy(), tilesReady: true,
    tilesBytes: cats.tiles, ledgerTotal: ledger.total(), ceilingBytes: quality.ceilingBytes, pairBytes: TILE_PAIR_BYTES,
    patchRoomBytes: patchRoom(quality.profile.patchResidentBytes, cats.patch), contextLosses: quality.contextLosses, frameMs: cacheFrameMs,
    sessionMs: now, shedCount: memShed.count,
  }
  const d = growPoll(cacheGrow, s, cacheShedSeen)
  if (!d) return
  if (d.kind === 'grow') cacheGrowEvents.grown++; else cacheGrowEvents.shrunk++
  writeRemembered(cacheGrowKv, quality.detected.cls, d.next)
  cacheWritten = d.next
}
/** One frame of a pending memory-warning release: rebuild the tiles smaller and drop the patch when the view is calm (quality/pressure.ts). */
function applyMemoryPressure(now: number): void {
  enforceMemory(now)
  stepCacheGrow(now)
  if (!memoryPressure) return
  if (now > memoryPressure.until) { memoryPressure = null; return }
  const maxLayers = (renderer.getContext() as WebGL2RenderingContext).getParameter((renderer.getContext() as WebGL2RenderingContext).MAX_ARRAY_TEXTURE_LAYERS) as number
  const shrunk = tiles && tilesState === 'ready' && !new URLSearchParams(location.search).has('tilecache')
    ? tileRebuildLayers({ current: tiles.capacity, want: tileCapacity(maxLayers, location.search, quality.profile.tiles), ceiling: quality.ceilingBytes, ledgerTotal: ledger.total(), tilesBytes: ledger.byCategory().tiles, reserveBytes: TILE_RESERVE_BYTES, pairBytes: TILE_PAIR_BYTES, minLayers: 8 })
    : null
  const busy = viewBusy()
  const step = pressureStep({
    tilesReady: tilesState === 'ready', tilesShrinkable: shrunk !== null, patchReady: patchState === 'ready' && !!patch,
    overCeiling: ledger.total() > quality.ceilingBytes, awayFromPatch: rig.pose.dist >= PATCH_COVERAGE_DIST && !groundMode?.active, busy,
  })
  if (step.tiles) releaseTiles(false)
  if (step.patch) dropPatch()
  if (step.tiles || step.patch) { refreshReduced(); markDirty() }
  if (step.done) memoryPressure = null
}
canvas.addEventListener('webglcontextrestored', () => { void recoverContext(lossGeneration) })
async function recoverContext(generation: number): Promise<void> {
  if (softStartedAt) return
  const gl = renderer.getContext() as WebGL2RenderingContext
  if (!recoveryIsCurrent(lossGeneration, generation, contextLost, gl.isContextLost())) return
  // In the app, a ground view or a site patch holds GPU resources of its own (lander, patch rasters, probes, targets): the clean path is a reload
  // at the lowered ceiling. The website tries in place first, as main did.
  if (planAfterRestore({ losses: quality.contextLosses, groundActive: !!groundMode?.active, patchLoaded: !!patch, native: !!nativeHost }) === 'reload') { reloadAfterLoss(); return }
  softStartedAt = performance.now()
  try {
    releaseTiles(true)
    dropPatch()
    // Nothing is linked after a lost context: forget what was compiled so the first draw does not relink every program on this thread.
    moon.resetPrograms()
    groundMode?.pass.resetPrograms()
    ledger.releasePrefix('maps', '')
    const fresh = await loadMoonMaps(renderer.capabilities.getMaxAnisotropy())
    if (!recoveryIsCurrent(lossGeneration, generation, contextLost, gl.isContextLost())) return
    maps.color = fresh.color
    maps.height = fresh.height
    moon.uniforms.uColor.value = fresh.color
    moon.uniforms.uHeight.value = fresh.height.texture
    moon.uniforms.uHeightLevels.value = fresh.height.levels
    moon.uniforms.uHeightMix.value = 1
    // The lowered ceiling (quality.contextLost()), never the class profile's: the same figure would reproduce the loss.
    moon.configureBaked(renderer, quality.detected.cls, quality.ceilingBytes, markDirty)
    if (softRecoveryExpired(performance.now() - softStartedAt)) { softStartedAt = 0; reloadAfterLoss(); return }
    softStartedAt = 0
    contextLost = false
    healthyRecoveryPending = true
    healthyRecoveryAt = null
    healthyLastFrameAt = null
    hud.message('')
    refreshReduced()
    ;(api.contextRestores as number)++
    markDirty()
    markMoved()
    if (!loopRunning) { idleSleeping = false; loopRunning = true; requestAnimationFrame(frameLoop) }
  } catch (e) {
    if (generation !== lossGeneration) return
    softStartedAt = 0
    console.error('Soft graphics recovery failed, reloading:', e)
    reloadAfterLoss()
  }
}

// ---------------------------------------------------------------------------
// Layout: the subject is framed in whatever the cards, chip rows and panels leave free.
// ---------------------------------------------------------------------------
/** A moment with a fly camera is on: the aim follows the free rect instead of a fixed offset. */
let layoutAimOn = false
/** v2 (?flightfeel): Home's aim keeps the disc at the middle unless the bar or the caption would cover it (ui/layout.ts minimalAim). Set by Home, dropped by anything else that frames a subject. */
let homeAimMinimal = false
let frameTarget: EarthFrame = { nx: 0, ny: 0, fill: EARTH_VIEW_FILL }
/** Home's disc radius, CSS px, for a frame (homeDistFor's fill of the short side). */
function homeDiscRadiusPx(frame: EarthFrame, vw: number, vh: number): number {
  return Math.max(0.2, Math.min(HOME_FILL, frame.fill)) * Math.min(vw, vh) / 2
}
let layoutMeasuredAt = -1e9
const LAYOUT_MEASURE_MS = 150
function measureOccluders(sheetsClosed = false): Occluder[] {
  const wide = window.matchMedia('(min-width: 900px)').matches
  const out: Occluder[] = []
  const add = (sel: string, side: Occluder['side']): void => {
    // Every visible match: a second sheet must not hide behind a closed first one.
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (el.hidden) continue
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) out.push({ rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, side })
    }
  }
  add('.tour-row', 'bottom')
  add('.bar', 'bottom')
  add('.bar-padrow', 'bottom')
  add('.journey-scrub', 'bottom')
  add('.tour-card', wide ? 'left' : 'bottom')
  // A tap that closes the sheets measures as if they were already shut (their rects are still there until the next frame).
  // The small Time sheet is exempt: scrubbing the clock must not move or re-fit the Moon. The big sheets (Viewpoints, Quality, More) still claim their band.
  if (!sheetsClosed) add('.bar-sheet:not(.bar-time)', 'bottom')
  // The caption stands over the bar centred on a narrow screen: the Moon rises above it. On a wide one it is bottom left, clear of the middle.
  if (!wide) add('.caption', 'bottom')
  if (!wide) add('#hud', 'top')
  return out
}
/**
 * Home frames the whole disc at every aspect ratio: the distance follows what the caption and the bar leave free (the disc fills
 * at most HOME_FILL of the short side, and at most the fill the free rectangle allows), so a short window zooms out instead of
 * pushing the Moon off the top. Dropped the moment anything else moves the distance (a gesture, a pin, a key).
 */
const HOME_FILL = 0.63
let homeFrame = true
let homeDistApplied = NaN
/** rig.lastZoomInputAt as stepLayout last saw it: a change is a zoom input since the last frame. */
let homeZoomInputSeen = Number.NEGATIVE_INFINITY
let homeAimTarget = { nx: 0, ny: 0 }
function homeDistFor(frame: EarthFrame): number {
  const d = Math.max(0.2, Math.min(HOME_FILL, frame.fill))
  const a = Math.atan(d * Math.tan(FLY_FOV_DEG * Math.PI / 360))
  return Math.max(3, Math.min(D_MAX, 1 / Math.sin(a)))
}
/** The frame the subject gets once the sheets are closed (a pin's tap closes them, but the layout is measured a moment later): the viewport minus the bar, the caption and the cards. */
function restingFrame(): EarthFrame {
  const vw = window.innerWidth, vh = window.innerHeight
  return subjectFrame(vw, vh, safeRect(vw, vh, measureOccluders(true)), EARTH_VIEW_FILL)
}
/** v2: the layout aim's follow (critically damped, rad/s), its speed per axis and the value it wrote last (a different value means someone else moved the aim). */
const AIM_OMEGA = 7
const aimVelX = { v: 0 }, aimVelY = { v: 0 }, aimWritten = { x: NaN, y: NaN }
function stepLayout(now: number, dt: number): boolean {
  if (STILL || ridge || groundMode?.active || flight) return false
  if (now - layoutMeasuredAt > LAYOUT_MEASURE_MS) {
    layoutMeasuredAt = now
    const vw = window.innerWidth, vh = window.innerHeight
    const safe = safeRect(vw, vh, measureOccluders())
    frameTarget = subjectFrame(vw, vh, safe, EARTH_VIEW_FILL)
    homeAimTarget = minimalAim(vw, vh, safe, homeDiscRadiusPx(frameTarget, vw, vh))
  }
  let changed = false
  // v2: during a fly-to the planned aim is the one flown (applyTweenSubject), so the aim eases with the move instead of on its own clock.
  if (layoutAimOn && !descent && !(homeAimMinimal && tween)) {
    const k = 1 - Math.exp(-7 * dt)
    const step = (a: number, b: number): number => (Math.abs(b - a) < 1e-4 ? b : a + (b - a) * k)
    const aim = homeAimMinimal ? homeAimTarget : frameTarget
    // v2: the aim follows its target as a critically damped spring, which leaves rest at zero speed (the exponential left it at its fastest, a step of aim speed
    // at the first frame of every pick from Home, whose disc now stands at the middle). Anyone else moving the aim resets the speed.
    const spring = (a: number, b: number, vel: { v: number }): number => {
      if (Math.abs(b - a) < 1e-4 && Math.abs(vel.v) < 1e-3) { vel.v = 0; return b }
      let x = a
      for (let left = Math.min(dt, 0.1), h = left / Math.ceil(left / 0.008); left > 1e-9; left -= h) { vel.v += (AIM_OMEGA * AIM_OMEGA * (b - x) - 2 * AIM_OMEGA * vel.v) * h; x += vel.v * h }
      return x
    }
    if (FLIGHT_FEEL && (rig.aimShiftX !== aimWritten.x || rig.aimShift !== aimWritten.y)) { aimVelX.v = 0; aimVelY.v = 0 }
    const ax = FLIGHT_FEEL ? spring(rig.aimShiftX, aim.nx, aimVelX) : step(rig.aimShiftX, aim.nx), ay = FLIGHT_FEEL ? spring(rig.aimShift, aim.ny, aimVelY) : step(rig.aimShift, aim.ny)
    aimWritten.x = ax; aimWritten.y = ay
    if (ax !== rig.aimShiftX || ay !== rig.aimShift) changed = true
    rig.aimShiftX = ax
    rig.aimShift = ay
  }
  // A zoom input of the visitor's (wheel, pinch, + and -, the zoom buttons) ends the Home frame at once, however small its first frames are (homeFollow.ts).
  const zoomInput = rig.lastZoomInputAt !== homeZoomInputSeen
  homeZoomInputSeen = rig.lastZoomInputAt
  if (homeFrame && layoutAimOn && !tween && !descent && !groundMode?.active) {
    const h = homeFollowStep({ homeFrame, applied: homeDistApplied }, rig.pose.dist, homeDistFor(frameTarget), dt, zoomInput)
    homeFrame = h.homeFrame
    homeDistApplied = h.applied
    if (h.dist !== rig.pose.dist) { rig.pose.dist = h.dist; changed = true }
  }
  return changed
}

/** Positions the map labels against the screen areas they must keep clear of. Run after a drawn frame, and once more when the centre caption's geometry changes (no GPU redraw). */
const dockEl = cachedQuery(document, '.dock')
const captionEl = cachedQuery(document, '.caption')
let frameAspect = 0
window.addEventListener('resize', () => { frameAspect = 0 }, { passive: true })
type LabelsChrome = { blocked: Array<[number, number, number, number]>; aspect: number; vw: number; vh: number }
function readLabelsChrome(): LabelsChrome | null {
  if (ABL.has('dom0') || !labelsApi?.isOn() || !last) return null
  const dr = dockEl()?.getBoundingClientRect()
  const cr = captionEl()?.getBoundingClientRect()
  const blocked: Array<[number, number, number, number]> = []
  if (dr && dr.height > 0) blocked.push([0, dr.top - 8, window.innerWidth, window.innerHeight])
  if (cr && cr.height > 0) blocked.push([cr.left - 6, cr.top - 6, cr.right + 6, cr.bottom + 6])
  const ccr = centreUi?.rect()
  if (ccr) blocked.push([ccr.left - 6, ccr.top - 6, ccr.right + 6, ccr.bottom + 6])
  return { blocked, aspect: canvasAspect(), vw: window.innerWidth, vh: window.innerHeight }
}
function updateLabelsDom(pre: LabelsChrome | null = null): void {
  if (!ABL.has('dom0') && labelsApi && last) {
    const chrome = pre ?? readLabelsChrome()
    const blocked = chrome ? [...chrome.blocked] : []
    // The pins stand over the labels: every pin the pins layer placed this frame (dot and text) is kept clear, so a name never runs under a pin.
    // The pins layer has been hidden since #124, so this list is empty and the Labels layer's pass is the one collision pass on screen
    // (WP-G, 2026-10-22); it stays so that pins, if they return, go through the same pass.
    if (pinsApi) for (const b of pinsApi.boxes()) blocked.push([b[0] - 4, b[1] - 4, b[2] + 4, b[3] + 4])
    // The first-visit hotspots (rings and their labels) are kept clear the same way.
    if (firstHotspotsApi) for (const b of firstHotspotsApi.boxes()) blocked.push([b[0] - 4, b[1] - 4, b[2] + 4, b[3] + 4])
    // The names stay through drags, glides, zooms and fly-tos (they are placed every drawn frame); they step aside only where
    // something else owns the picture: the ground view, a descent, a tour, the ridge, an orbit, the site approach, a panorama.
    const away = !!(descent || groundMode?.active || flight || ridge || orbitJourney || approachFor !== null || cinematicFlight || panoramaUi?.isOpen())
    labelsApi.update({ surfaceRadius: (lon, lat) => radiusAtHeightM(sampleGlobalHeightM(maps.height, lon, lat) ?? 0), cam: last.cam, aspect: chrome?.aspect ?? canvasAspect(), vw: chrome?.vw, vh: chrome?.vh, e: ephem, dist: rig.pose.dist, fovDeg: rig.fovDeg, hidden: away, moving: cameraMoving(), blocked })
  }
}

/** Native shell state: the loop is stopped while the app is in the background, and the due time of the last frame drawn (for the 60 Hz cap, native/frameCap.ts). */
let nativePaused = false
let nativeDue: number | null = null
/** Native build: whether this vsync draws (native/frameCap.ts). The due time moves only on a draw. */
function nativeCapAllows(now: number): boolean {
  const step = capStep(now, nativeDue)
  nativeDue = step.lastDue
  return step.render
}
let ridgeOnSeen = false
/**
 * The rest state (src/loop/idle.ts). After IDLE_AFTER_MS of nothing going on the loop stops asking for frames; a redraw request, an input event or the
 * one-second heartbeat starts it again. `?idle=0` keeps the old behaviour (a frame request at every vsync). Not on the native shell, in a capture or a still.
 */
const IDLE_ON = idleOn(location.search) && !NATIVE_BUILD && !STILL
const idleGate = new IdleGate()
let idleBeat: ReturnType<typeof setTimeout> | null = null
let idleSleeps = 0
api.idle = { on: IDLE_ON, get sleeps() { return idleSleeps }, get sleeping() { return idleSleeping } }
function wakeLoop(byInput: boolean): void {
  if (!idleSleeping || wakeAction(loopRunning, contextLost, nativePaused) === 'ignore') return
  idleSleeping = false
  if (idleBeat !== null) { clearTimeout(idleBeat); idleBeat = null }
  if (byInput) idleGate.reset()
  loopRunning = true
  // The sleep is not a slow frame: the rate and gap estimates start from this tick.
  lastLoopAt = performance.now()
  displayRate.gap()
  // Nor is it a stall of the healthy window (intentional idle counts as healthy, healthyResetDue): its frame gap counts from this tick.
  if (healthyRecoveryPending && healthyLastFrameAt !== null) healthyLastFrameAt = lastLoopAt
  requestAnimationFrame(frameLoop)
}
if (IDLE_ON) for (const ev of WAKE_EVENTS) (ev === 'resize' || ev === 'orientationchange' || ev === 'focus' ? window : document).addEventListener(ev, () => { if (idleSleeping) wakeLoop(true) }, { capture: true, passive: true })
// ---------------------------------------------------------------------------
// Resume diagnostics (loop/resume.ts): a page shown again after a hidden spell is judged once, RESUME_CHECK_MS later, from figures the page already
// holds (no pixel readback, nothing per frame). A blank-looking page sends one event to the telemetry module (it listens for `moon:resumeblank`;
// main.ts never imports it) and is readable at `__moon.resumeInfo()`.
// ---------------------------------------------------------------------------
let hiddenAt: number | null = document.hidden ? performance.now() : null
let lastHiddenMs = 0
let resumeTimer: ReturnType<typeof setTimeout> | null = null
let lastResume: { at: number; info: ResumeInfo; blank: boolean; reasons: string[] } | null = null
/** A loss the page was never told about (the event did not reach it, e.g. across a freeze): the same handler runs as for the real event. */
function noticeUnannouncedLoss(): void {
  if (contextLost || !(renderer.getContext() as WebGL2RenderingContext).isContextLost()) return
  canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
}
function gatherResume(): ResumeInfo {
  const gl = renderer.getContext() as WebGL2RenderingContext
  const cam = last?.cam ?? null
  const ex = api.exposure as { white?: number; hdr?: number } | undefined
  const now = performance.now()
  return {
    contextLosses: api.contextLosses as number, contextRestores: api.contextRestores as number, contextLost,
    glLost: gl.isContextLost(),
    hiddenMs: Math.round(hiddenAt !== null ? now - hiddenAt : lastHiddenMs),
    camDist: cam ? cam.pos.length() : null,
    // Not judged on the ground or in a flight (the Lunar module's own camera): looking up there legitimately shows no Moon.
    moonOnScreen: cam && !groundMode?.active && !flight ? moonDiscOnScreen(moonOffAxis(cam), cam.pos.length(), cam.tanHalf, canvasAspect()) : null,
    exposureWhite: typeof ex?.white === 'number' ? ex.white : null,
    exposureHdr: typeof ex?.hdr === 'number' ? ex.hdr : null,
    loopRunning, idleSleeping,
    lastFrameAgeMs: lastRenderedAt > 0 ? Math.round(now - lastRenderedAt) : null,
    visible: !document.hidden,
  }
}
function checkResume(): void {
  resumeTimer = null
  noticeUnannouncedLoss()
  const info = gatherResume()
  const v = classifyResume(info)
  lastResume = { at: Math.round(performance.now()), info, blank: v.blank, reasons: v.reasons }
  if (v.blank) try { window.dispatchEvent(new CustomEvent('moon:resumeblank', { detail: { info, reasons: v.reasons, loopErrors } })) } catch { /* diagnostics only */ }
}
function onHidden(): void { if (hiddenAt === null) hiddenAt = performance.now() }
function onShown(): void {
  if (hiddenAt !== null) { lastHiddenMs = performance.now() - hiddenAt; hiddenAt = null }
  if (lastHiddenMs < RESUME_MIN_HIDDEN_MS) return
  noticeUnannouncedLoss()
  if (resumeTimer) clearTimeout(resumeTimer)
  resumeTimer = setTimeout(checkResume, RESUME_CHECK_MS)
}
document.addEventListener('visibilitychange', () => { if (document.hidden) onHidden(); else onShown() })
addEventListener('pagehide', onHidden)
addEventListener('pageshow', onShown)
api.resumeInfo = () => {
  const info = gatherResume()
  return { ...info, ...classifyResume({ ...info, hiddenMs: Math.max(info.hiddenMs, lastHiddenMs) }), loopErrors, lastLoopError, lastCheck: lastResume }
}
/** Nothing is moving, loading, fading or waiting to be priced: the picture on screen is final and no per-frame code has work to do. */
/** Camera steps that moved the ground view, for groundStill (the loop stays awake in ground mode; this is only the visitor-facing stillness). */
function groundStepNoted(now: number, dt: number): boolean {
  return groundStillness.noteStep(now, groundMode!.cam.step(now, dt))
}
/** `groundStillOk`: ground mode counts as still (no input and no camera motion lately); the render loop's own sleep decision never passes it. */
function loopQuiet(now: number, groundStillOk = false): boolean {
  return api.ready && !dirty && !needsRefine && !gestureOn && !bandState && !restCatchUp && !pendingFade && !fadeOnly && restDrawAt === 0 && !restForceNormal
    && !rig.dragging && !rig.gliding() && !rig.auto && !rig.lookingAt(now) && !wasDragging
    && !tween && !flight && !cinematicFlight && !descent && !ridge && !routeFlight && !orbitJourney && !(groundMode?.active && !groundStillOk) && !settle && !intro?.active && !intro?.moving
    && !pendingLanding && approachFor === null && !pendingPanorama && !panoramaUi?.isOpen() && !dateTransition && !scrubGate.active(now) && scrubEndingUntil <= now
    && (!centreCtl || centreCtl.quiescent(now)) && !centreLock?.busy() && !highlightAnimating(labelsApi?.isOn() ? hlHover?.id ?? hlSticky?.l.id ?? null : null, hlShown?.id ?? null, hlStrength, !!hlSticky) && !memoryPressure && tilesState !== 'loading' && patchState !== 'loading'
    && !document.body.classList.contains('intro-on') && !(journey.state && journey.state.status !== 'arrived') && (tiles?.inflight ?? 0) === 0
    && !auditHeld && !captureSession && !captureIsInitializing(captureSession) && !document.hidden
}
/** A tick that throws used to end the rAF chain for good (loop/guard.ts): count it, report the first few, and ask for the next frame. */
let loopErrors = 0
let loopErrorRun = 0
let lastLoopError: string | null = null
function frameLoop(now: number): void {
  try {
    frameLoopBody(now)
    loopErrorRun = loopErrorCountAfter(loopErrorRun, false)
  } catch (e) {
    loopErrors++
    loopErrorRun = loopErrorCountAfter(loopErrorRun, true)
    lastLoopError = String((e as Error)?.message ?? e).slice(0, 80)
    const plan = loopErrorPlan(loopErrorRun)
    // Rethrown from a task of its own so the global handler (Sentry) still sees it; the loop is already rescheduled.
    if (plan.rethrow) setTimeout(() => { throw e }, 0)
    setTimeout(() => {
      // Lost meanwhile: park, so the restore sees a stopped loop and starts one (loopRunning left true would freeze the canvas after it).
      if (loopRetryAction(contextLost) === 'frame') requestAnimationFrame(frameLoop)
      else loopRunning = false
    }, plan.retryMs)
  }
}
function frameLoopBody(now: number): void {
  // v2: a hand-off rate is for a fly-to in the SAME event as the stop that left it; once a frame loop tick has run, the event is over and the camera
  // stands still on screen, so a later fly-to (a tap's pointerup, a tile arrival) starts from rest, not at the carried speed.
  handOffRate = null
  if (FRAME_GATE.periodMs > 0 && !captureSession && !captureIsInitializing(captureSession) && !FRAME_GATE.shouldRun(now, gateUrgent)) { requestAnimationFrame(frameLoop); return }
  // Sharp: a scripted flight (as of the last frame) draws every second 60 Hz tick; a press, touch or key runs at once.
  // `?motion=sharp`: the 30 fps tier is the pacer's explicit fallback (SHARP_GATE_30), not a standing flight cap.
  if (sharpMotionOn() && sharpPacer.tier === 30 && (gestureOn || flightScaleWasActive) && !captureSession && !captureIsInitializing(captureSession) && !SHARP_GATE_30.shouldRun(now, gateUrgent)) { requestAnimationFrame(frameLoop); return }
  // Phone policy: the 30 fps tier is PhonePacer's fallback before any resolution step (quality/phoneSharp.ts).
  if (phoneMotionOn() && phonePacer.hzFor(phoneMomentActive()) === 30 && (gestureOn || flightScaleWasActive) && !captureSession && !captureIsInitializing(captureSession) && !PHONE_GATE_30.shouldRun(now, gateUrgent)) { requestAnimationFrame(frameLoop); return }
  if (!constResMotionOn() && FLIGHT_GATE.periodMs > 0 && flightScaleWasActive && !captureSession && !captureIsInitializing(captureSession) && !FLIGHT_GATE.shouldRun(now, gateUrgent)) { requestAnimationFrame(frameLoop); return }
  gateUrgent = false
  feelBackstop(now)
  const tLoop0 = PERF ? performance.now() : 0
  stepCentreCaption(now)
  if (hlShown || hlHover || hlSticky) stepHighlight(now)
  if (tweenHoldU !== null && tween) tween.t0 = now - tweenHoldU * tween.plan.ms
  if (auditHeld) { requestAnimationFrame(frameLoop); return }
  if (captureIsInitializing(captureSession) || captureSession) { lastLoopAt = now; requestAnimationFrame(frameLoop); return }
  if (contextLost) { loopRunning = false; return }
  if (nativePaused) { loopRunning = false; return }
  applyMemoryPressure(now)
  const dt = Math.min(0.1, Math.max(0, now - lastLoopAt) / 1000)
  const rafGap = now - lastLoopAt
  lastLoopAt = now
  tileFrameSmoothed = foldRafGap(tileFrameSmoothed, rafGap)
  gpuTimer.poll(now)
  // Price the full frame drawn at the last hand-back: its wall gap (first tick after it) and the first full-frame GPU sample that is not the one we saw at draw time.
  if (restDrawAt > 0) {
    if (restDrawWall < 0 && now > restDrawAt) restDrawWall = restFrameMs(0, rafGap, document.hidden)
    const ff = gpuTimer.fullFrame
    const sampled = ff !== null && ff !== restDrawFF
    if (restDrawWall >= 0 && (sampled || now - restDrawAt > 500)) {
      const restMs = restFrameMs(sampled ? ff.ms : 0, restDrawWall, document.hidden)
      restCost = foldRestCost(restCost, restDrawUnmet, restMs)
      // A rest frame over 100 ms twice running lowers the rest ratio one step; it is recomputed on the next frame between gestures (native shell and web phones).
      if (restDrawUnmet === 0) restDpr = restRatioAfterFold(restGovernor.fold(restMs), gestureOn, restDpr)
      restDrawAt = 0
    }
  }
  passTimer.poll()
  if (panoramaUi?.isOpen()) { requestAnimationFrame(frameLoop); return }
  if (live && now - lastLiveTick > LIVE_TICK_MS) {
    lastLiveTick = now
    time = new Date()
    ephem = ephemerisAt(time)
    ephemCarry?.retarget(ephem)
    markDirty(); because('liveTick')
  }
  stepDateCarry(now)
  stepSettle(dt)
  scrub.hold(now)
  // The on-screen zoom and tilt buttons glide with this frame's own timestamp (touchControls.ts), before anything else reads the camera.
  touchControlsUi?.frame(now)
  const ridgeMoved = stepRidge(now) || stepRoute(now) || (intro?.step(now) ?? false)
  // The completed height/Sun probe reads are collected BEFORE the camera steps (so its own asks find the heights that just landed), whatever the dirty/render/pacing gates do after.
  if (groundMode?.active) groundMode.pollProbes(now)
  const tweened = ridgeMoved || stepFlight(now, dt) || stepTween(now) || stepCinematic(now) || stepHover(now) || stepDescent(now) || stepSiteLanding(now) || (groundMode?.active && !flight ? groundStepNoted(now, dt) : false)
  if (aimRelease) {
    // The layout or a fly-to took the aim over (layoutAimOn, applyTweenSubject): it is theirs from here.
    if (layoutAimOn || tween) aimRelease = null
    else {
      const a = aimRelease.step(now, rig.aimShiftX, rig.aimShift)
      if (!a || a.done) aimRelease = null
      if (a) { rig.aimShiftX = a.x; rig.aimShift = a.y; markDirty(); because('aimRelease') }
    }
  }
  const laid = stepLayout(now, dt)
  if (ridgeF && journey.state?.id === 'lift-off') journey.sample(journey.state.generation, ridgeF.subject, ridge?.u ?? 1)
  const rigMoved = rig.step(now, dt)
  const moonTurned = !rig.dragging && moonSurfaceTurn.step(dt)
  if (!rig.dragging) moonTurnMotion = moonTurned
  if (moonTurned) applyMoonSurfaceTurn(now)
  const orbited = stepOrbit(now)
  const moved = rigMoved || tweened || laid || orbited || moonTurned
  if (journey.state && journey.current(journey.state.generation)) {
    const state = journey.state
    if (descent) journey.sample(state.generation, 'descent', descent.t0 < 0 ? 0 : progressOfTimed(now, descent.t0, descent.ms))
    else if (tween) journey.sample(state.generation, 'approach', tweenProgress(tween, now))
    else if (!cinematicFlight && !orbitJourney && !flight && !ridge && patchState !== 'loading' && tilesState !== 'loading' && !approachFor && !pendingLanding && !rig.lookingAt(now))
      journey.arrive(state.generation, now)
  }
  if (pendingPanorama && journey.state?.generation === pendingPanorama.generation && journey.state.status === 'arrived') {
    const id = pendingPanorama.id
    pendingPanorama = null
    panoramaUi?.open(id)
  }
  if (moved) { markMoved(); because(rigMoved ? 'rig' : laid ? 'layout' : orbited ? 'orbit' : ridgeMoved ? 'ridge/route' : 'tween/ground') }
  if (ridgeOnSeen !== !!ridge) { ridgeOnSeen = !!ridge; document.body.classList.toggle('ridge-on', ridgeOnSeen) }
  const scrubPicked = pickHandle()
  scrub.attach(scrubPicked)
  // A plain fly-to tween (Home, a pin, Next/Back) has no slider in the pill; the approach tween of a moment is its lead-in (locked at 0).
  const scrubLiveId = scrubPicked && (ARCHIVE || scrubPicked.id !== 'tween') ? scrubPicked.id : null
  const scrubAnimating = !!(flight || cinematicFlight || orbitJourney || descent)
  if (groundMode?.active || routeFlight) resetScrubEnding()
  scrubEndingUntil = nextEndingUntil(scrubEndingUntil, { handleId: scrubLiveId, cancelled: scrubCancelled, now })
  scrubCancelled = false
  const scrubVis = scrubVisibility({ handleId: scrubLiveId, animating: scrubAnimating, endingUntil: scrubEndingUntil, now })
  if (live !== liveSeen) { liveSeen = live; toursApi?.syncNow() }
  scrubUi?.update(scrubVis)
  if (navApi && now - navUpdatedAt > 250) { navUpdatedAt = now; navApi.update(); nextViewTick(now) }
  ridgeUi?.update(ridgeUiState())
  // The scrub's last loose exposure search must not stand as the rest target: one exact search on the frame the reuse window closes.
  const scrubbing = scrubGate.active(now)
  if (scrubbingPrev && !scrubbing) markDirty()
  scrubbingPrev = scrubbing
  let scale = 1
  let buildOnly = false
  let buildFade: { scale: number } | null = null
  // Hard backpressure: while the previous frame is still on the GPU nothing below runs (no gesture bookkeeping, no refine step), `dirty` stays
  // pending and the loop comes back next rAF. A hidden tab releases it (a fence that never signals must not freeze the picture); a lost context returns above.
  if (!wasDragging && rig.dragging) dragStartAt = now
  if (wasDragging && !rig.dragging && lastMoveAt >= dragStartAt) lastReleaseAt = now // a tap moves nothing and holds nothing
  wasDragging = rig.dragging
  // `?pace=rest`: the hold applies to rest frames and to the press that starts a gesture (it waits for at most the one rest frame in flight); gesture frames only poll.
  const paceHeld = dirty && !STILL && (PACE_ON ? framePacer.shouldHold(renderer.getContext() as unknown as WebGL2RenderingContext, now, document.hidden)
    : PACE_REST ? framePacer.shouldHoldRest(renderer.getContext() as unknown as WebGL2RenderingContext, now, gestureOn, document.hidden) : false)
  if (BANDS_ON) drainRestCosts()
  /** `?settle=stepped`: a dear full-size frame waits for the quiet spell; set in the hand-back below, drawn nothing this frame, `dirty` stays pending. */
  let settleHeld = false
  if (paceHeld) perfAdd('frame.held', 1)
  if (!STILL && !paceHeld) {
    const moving = motionActive(moved, rig.dragging, gestureOn, now - lastMoveAt) || releaseHoldActive(bandsWorth(), now - lastReleaseAt, now - lastMoveAt, REFINE_RELEASE_HOLD_MS)
    // The opening's flyby is a scripted flight too: its resolution follows the flight controller's smooth scale, not the
    // gesture ladder's steps (which read as a stutter on a long move).
    const scriptedFlight = !!(tween || cinematicFlight || intro?.moving)
    const cameraSpeed = flightScaleLastPose && flightScaleLastAt > 0 && now > flightScaleLastAt
      ? angularDistance(flightScaleLastPose.lon, flightScaleLastPose.lat, rig.pose.lon, rig.pose.lat) * 180 / Math.PI * 1000 / (now - flightScaleLastAt)
      : Infinity
    // Sharp: a paused flight (the slider's pause) is at rest, so the hand-back draws it at full quality instead of the held flight grid.
    const flightPaused = quality.sharp.on && !tween && cinematicFlight?.pausedU != null
    const flightScaleActive = scriptedFlight && !flightPaused && !FORCED_MOTION_SCALE && cameraSpeed <= 8
    if (flightScaleActive && !flightScaleWasActive) {
      sharpGridFor = cinematicFlight?.definition.id ?? ''
      flightScaleController.reset(sharpFlightStart(quality.sharp, quality.detected.cls, motionScale, cinematicFlight?.definition.id))
      flightScaleLastWallSeq = wallDrawSeq
      flightScaleLastGpuAt = gpuTimer.latestSample?.at ?? 0
    }
    if (!flightScaleActive && flightScaleWasActive) { motionScale = flightScaleController.current; flightScaleController.reset(motionScale) }
    const flightScaleWasActiveBefore = flightScaleWasActive
    flightScaleWasActive = flightScaleActive
    if (!flightScaleActive) sharpGridFor = null
    else if (quality.sharp.on && sharpGridFor !== (cinematicFlight?.definition.id ?? '')) {
      // The approach (a fly-to) handed over to a cinematic flight: its own ceiling applies from here (never a finer grid than the one held).
      sharpGridFor = cinematicFlight?.definition.id ?? ''
      flightScaleController.reset(Math.min(flightScaleController.current, sharpFlightGrid(quality.detected.cls, cinematicFlight?.definition.id)))
    }
    if (scriptedFlight) { flightScaleLastPose = { ...rig.pose }; flightScaleLastAt = now }
    else { flightScaleLastPose = null; flightScaleLastAt = 0 }
    let flightFenceMs = 0
    if (moving) {
      bandState = null; pendingFade = null
      if (restCatchUp) { restCatchUpStats.abandoned++; restCatchUpStats.ms += now - restCatchUp.since; restCatchUp = null }
    }
    const measured = gpuTimer.latestSample
    // The smoothed time when this grid has one (one raw frame, a 250 ms spike, must not flip the cadence tier); else the latest sample.
    const budget = gpuTimer.source === 'query' && gestureOn && gpuTimer.smoothed > 0 && gpuTimer.fresh >= 2 ? pacing.get(displayRate.hz, gpuTimer.smoothed, motionScale) : pacing.get(displayRate.hz, measured?.ms ?? 0, measured?.scale ?? 1)
    // Phone motion and rest DPR may differ. Keep their existing bounded ladder;
    // a desktop can retain full detail when a real full-quality frame fits.
    // A rest frame that the shadow cache serves is cheap, but the first Sun move drops every layer and the shader marches live: not a basis for full-size motion.
    const legacyCacheReadSuppressed = SHADOW_POLICY === 'legacy' && SH_MOTION_LIVE && !FENCE_CLASS
    const cacheSteady = !((shadowCache || patchShadowCache?.shaderOn) && legacyCacheReadSuppressed) && (!shadowCache || shadowCache.shaderOn) && !scrubGate.active(now)
    // fullMotionSafe is effectively dead on desktops while the cache exists: with live-march motion cacheSteady is false, so the cap is 0.7. It matters only with ?shmotion=cache or no cache.
    const maxMotionScale = gpuTimer.source === 'query' && motionDpr === restDpr && cacheSteady && fullMotionSafe(gpuTimer.fullFrame, now, budget) ? 1 : 0.7
    if (moving) displayRate.gap(); else displayRate.sample(now)
    if (moving) {
      // ONE grid for the whole gesture: the limb ramp, the sub-pixel march offsets and the upsampling all live on the render grid, so a
      // grid that changes mid-turn makes the limb go soft, sharp, soft. The step is chosen from the frame time measured so far, once, when
      // the gesture starts (or after a refine), and held until it ends.
      if (!gestureOn) {
        gestureOn = true
        refineStep = 0
        gpuTimer.reset()
        passTimer.reset()
        const wallRemembered = wallMemoryLive(now)
        if (!wallRemembered) wallLadder.reset()
        wallSeenSeq = wallDrawSeq
        // A drag that follows an idle spell must not count the idle gap as a slow frame; a restart inside a run of slow frames keeps its gap.
        if (now - perfState.gestureEndAt > 700) wallPrevDrawAt = 0
        motionScale = FORCED_MOTION_SCALE || (gpuTimer.source === 'fence' && FENCE_CLASS ? fenceGrid.start(START_MOTION_SCALE) : measuredStart(gpuTimer.source === 'query' && cacheSteady ? measured : null, now, budget, gpuTimer.source === 'query' ? motionScale : START_MOTION_SCALE, maxMotionScale))
        // `?motionstart=cost`: the grid from the last gesture's measured motion cost (validated once; the same measurement sets the pacing tier), else from the known rest cost times the estimate factor against the base budget (the rest fallback never re-tiers). The motion cost keeps its own 60 s memory: the 4 s wall memory is exactly the rest the owner's press follows.
        if (MOTION_START_COST && !FORCED_MOTION_SCALE && !FENCE_CLASS) {
          const plan = startFromCostPlan(motionCost, restCostKnown(), MOTION_REST_FACTOR_PARAM ?? 1 / fullShaderFactor(), now, pacing, displayRate.hz, budget, START_MOTION_SCALE, maxMotionScale)
          motionScale = plan.scale
          motionStartUsed = plan.used
        }
        // A desktop gesture marches shadows live, and the rest frame it is judged from is served by the cache: never start above START_CAP_LIVE (0.7) there, nor above what the wall clock learned a moment ago.
        if (!FORCED_MOTION_SCALE && !FENCE_CLASS && START_CAP_ON) motionScale = Math.min(motionScale, SH_MOTION_LIVE && (shadowCache || patchShadowCache) ? START_CAP_LIVE : 1, wallRemembered ? wallLadder.cap : 1)
        // `?groundbudget=1`: a ground gesture starts on the grid its own ground frames learned (the Moon pass's choice is the fallback). Off: groundMode.budget is null, nothing changes.
        if (!FORCED_MOTION_SCALE && groundMode?.active && groundMode.budget) motionScale = groundMode.budget.start(motionScale, maxMotionScale)
        // `?wallmem=`: no finer than the grid the last gesture in this context (orbit or ground, this canvas size) ended on; the wall ladder climbs from there.
        if (WALL_MEMORY.on && !FORCED_MOTION_SCALE && !FENCE_CLASS) { const m = motionMemory.recall(MotionMemory.key(!!groundMode?.active, canvas.width, canvas.height), now, WALL_MEMORY_MS); if (m !== null) motionScale = Math.min(motionScale, m) }
        // `?motion=sharp`: the whole start ladder above (measured start, cost start, live cap, ground budget, remembered coarse grids) is void: the grid is 1 and the pacer starts at 60 fps.
        if (sharpMotionOn()) { if (motionScale < 1) sharpMotionStats.overridden++; motionScale = 1; sharpPacer.reset(); sharpSeenSeq = wallDrawSeq }
        // Phone policy: the same, at the pacer's f (its level carries over from the last gesture).
        if (phoneMotionOn()) { motionScale = sharpF(); phoneSeenSeq = wallDrawSeq }
        if (!dateTransition) final?.cancelDateTransition()
        rafMs = 0
      }
      scale = motionScale
      rafMs = rafMs === 0 ? dt * 1000 : rafMs * 0.85 + dt * 1000 * 0.15
      frameMs = rafMs
      // The ladder reads the GPU's own time for the frames drawn on this grid (the rAF interval is CPU time and goes blind to a GPU backlog); with no
      // GPU timing source it falls back to the rAF interval. It steps down within two finished frames, up only after fourteen and well inside the budget.
      // Only the disjoint timer query measures GPU time. The fence path is floored at one rAF interval (CPU time), so it feeds neither the ladder nor
      // query prediction; without a query the rAF interval is an emergency brake (down only, far over budget).
      const timed = gpuTimer.source === 'query' && gpuTimer.fresh > 0
      // The fence source with one frame in flight (the pacer) reads a frame period: a model with an intercept, sticky across gestures, down only.
      if (gpuTimer.source === 'fence') {
        const periods = gpuTimer.drainPeriods()
        foldGroundSamples(groundMode?.budget, periods, budget)
        for (const p of periods) {
          flightFenceMs = Math.max(flightFenceMs, p.ms)
          if (FENCE_CLASS) fenceGrid.observe(p.scale, p.ms)
        }
      }
      // Each completed query measurement once, on the grid and in the context (ground or orbit) it was submitted in; the smoothed figure repeats and is not a sample.
      if (gpuTimer.source === 'query') foldGroundSamples(groundMode?.budget, gpuTimer.drainSamples(), budget)
      const step = FORCED_MOTION_SCALE || flightScaleActive || constResMotionOn() ? null : gpuTimer.source === 'query'
        ? (timed ? ladderStep(gpuTimer.smoothed, motionScale, gpuTimer.fresh, pacing.get(displayRate.hz, gpuTimer.smoothed, motionScale), maxMotionScale) : null)
        : gpuTimer.source === 'fence' && FENCE_CLASS ? fenceGrid.step(motionScale)
        : emergencyStep(rafMs, motionScale, framesOnGrid)
      framesOnGrid++
      if (step !== null) { scale = motionScale = step; gpuTimer.reset(); framesOnGrid = 0; rafMs = 0 }
      else if (WALL_ON && !FENCE_CLASS && !FORCED_MOTION_SCALE && !flightScaleActive && !constResMotionOn() && wallDrawSeq !== wallSeenSeq) {
        wallSeenSeq = wallDrawSeq
        // The tiered pacing budget is not used: it stretches to 30 Hz and wider on the very frames being judged. The display's own interval is the yardstick.
        const wall = wallGap > 0 ? wallLadder.observe(wallGap, (pacing.isSlow ? 1000 / pacing.cadenceHz : frameBudgetMs(displayRate.hz)), motionScale) : null
        if (wallGap > 0) { wallObs++; wallGapLast = wallGap }
        if (wallLadder.fired) { wallCapAt = now; wallCapSize = `${canvas.width}x${canvas.height}` }
        if (wall !== null) { scale = motionScale = wall; wallSteps++; gpuTimer.reset(); framesOnGrid = 0; rafMs = 0 }
      }
    } else if (bandState) {
      // A budgeted frame in progress: the next band, on the same grid, once the previous band's fence has signalled (the pacer above).
      scale = bandState.scale
    } else if (needsHandBack(moving, gestureOn, needsRefine)) {
      if (refineStep === 0) perfState.gestureEndAt = now
      if (gestureOn) {
        // The gesture's end: what it learned, for the next one (`?wallmem=`, `?motionstart=cost`). The GPU query's smoothed time on the held grid is the live-march motion cost; cached rest frames never feed it.
        if (WALL_MEMORY.on && !FORCED_MOTION_SCALE && !constResMotionOn()) motionMemory.remember(MotionMemory.key(!!groundMode?.active, canvas.width, canvas.height), motionScale, now)
        if (!constResMotionOn() && gpuTimer.source === 'query' && gpuTimer.fresh >= 2 && gpuTimer.smoothed > 0 && motionScale < 1) motionCost = { ms: gpuTimer.smoothed, scale: motionScale, at: now }
      }
      gestureOn = false
      // Two steps: a coarse grid drawn at once (a quarter of the full frame's cost) crossfades in, then the full-size frame on the next one.
      // `?settle=stepped` judges "affordable" by the learned cost (the GPU query under-reads 5-7x on Metal), against two vsyncs of this display.
      const fullAffordable = SETTLE_STEPPED && learnedFullMs() > 0 ? settleFullAffordable(learnedFullMs(), 1000 / (displayRate.hz || 60)) : recentCost(gpuTimer.fullFrame, now) && gpuTimer.fullFrame.ms <= 50
      // A catch-up in progress goes straight to its full step (the mid step, if any, was drawn before it started).
      // `?settle=stepped`: a dear full frame (one that would go in bands) is not started inside the quiet spell after the last move or input; the mid picture stands, the loop comes back next rAF (handBackPlan: the tested decision).
      const plan = handBackPlan({ refineStep, motionScale, forced: !!FORCED_MOTION_SCALE, noRefine: ABL.has('norefine'), catchUp: !!restCatchUp, skipMid: (phoneMotionOn() && phonePacer.params.ladder === 'phone') || fullAffordable || (bandsWorth() && !SETTLE_STEPPED), stepped: SETTLE_STEPPED, quietMs: SETTLE_QUIET_MS, sinceMoveMs: now - Math.max(lastMoveAt, lastUserInputAt), dearFull: bandsWorth(), capture: !!captureSession })
      scale = plan.scale
      refineStep = plan.refineStep
      needsRefine = plan.needsRefine
      if (plan.held) { settleHeld = true; settleHolds++; scale = lastScale }
      // Cache-first hand-back: before the full-size frame, a bounded run of frames that draw nothing and build the visible shadow layers it would otherwise march live.
      if (scale === 1 && !settleHeld && RESTCACHE_ON && last && shadowCache && SH_MOTION_LIVE && !FENCE_CLASS && !ABL.has('norefine') && !FORCED_MOTION_SCALE && !captureSession && !restForceNormal) {
        const unmet = shadowCache.visibleUnmet()
        // The Sun or clock moving, a scrub and a date crossfade end the hold like camera movement does.
        const act = restCatchUpPlan(restCatchUp ?? { frames: 0, since: now }, now, unmet, moving || shadowCache.stats.sunMoving || scrubGate.active(now) || !!dateTransition, true, predictRestMs(restCost, unmet), REST_BUDGET, restCost.c0)
        if (act === 'build') {
          if (!restCatchUp) { restCatchUp = { frames: 0, since: now }; restCatchUpStats.runs++; restCatchUpStats.unmetStart = unmet }
          restCatchUp.frames++
          restCatchUpStats.frames++
          buildOnly = true
          buildFade = final.refining() ? { scale: lastScale } : null // from the crossfade's own state, not fadeOnly (a tile arriving mid-hold dirties the frame)
          needsRefine = true
        } else if (act === 'draw') {
          // The full frame is drawn now: remember how many layers it is drawn short of, so its measured cost prices the next release.
          restDrawUnmet = unmet; restDrawAt = now; restDrawFF = gpuTimer.fullFrame; restDrawWall = -1
        }
        if (act !== 'build' && restCatchUp) {
          restCatchUpStats.ms += now - restCatchUp.since
          restCatchUpStats.unmetEnd = unmet
          if (act === 'abandon') restCatchUpStats.abandoned++
          restCatchUp = null
        }
      } else if (restCatchUp) {
        // The guard went false while a hold was running (cache detached, capture, a forced grid): drop it.
        restCatchUpStats.ms += now - restCatchUp.since; restCatchUpStats.abandoned++; restCatchUp = null
      }
      // Phone policy: the classes it runs on are all FENCE_CLASS, so the cache-first branch above never prices a rest frame and the rest governor (its floor
      // and recovery) would get no samples. Price the hand-back's full frame here instead; the sampler at the top of the loop folds it (restDrawUnmet 0 only).
      if (phoneRestSample({ phone: phoneMotionOn() && phonePacer.params.ladder === 'phone', scale, settleHeld, buildOnly, pending: restDrawAt > 0, capture: !!captureSession })) {
        restDrawUnmet = shadowCache?.visibleUnmet() ?? 0; restDrawAt = now; restDrawFF = gpuTimer.fullFrame; restDrawWall = -1
      }
      markDirty()
      if (settleHeld) because('settleWait')
      // The refine at rest is a crossfade from the last motion frame to the full-size one, not a snap.
      if (!buildOnly && !settleHeld && last && final && !ABL.has('norefine') && last.w < Math.round(last.cw * scale) && !dateTransition) pendingFade = { w: last.w, h: last.h, cw: last.cw, ch: last.ch }
    } else scale = lastScale
    // `?motion=sharp`: the wall time between drawn motion frames feeds the pacer (cut cost, then the 30 fps tier); at a gesture start it was reset above, at a flight start here.
    if (sharpMotionOn() && (moving || flightScaleActive)) {
      if (flightScaleActive && !flightScaleWasActiveBefore) { sharpPacer.reset(); sharpSeenSeq = wallDrawSeq }
      if (wallDrawSeq !== sharpSeenSeq) { sharpSeenSeq = wallDrawSeq; if (wallGap > 0) sharpPacer.observe(wallGap, 1000 / (displayRate.hz || 60)) }
    }
    if (flightScaleActive) {
      const deviceFloor = FORCED_MOTION_SCALE || MOTION_STEPS_START[0]
      const latest = gpuTimer.latestSample
      const wallCost = wallDrawSeq !== flightScaleLastWallSeq ? wallGap : 0
      flightScaleLastWallSeq = wallDrawSeq
      const gpuCost = latest && latest.at > flightScaleLastGpuAt ? latest.ms : null
      if (gpuCost !== null) flightScaleLastGpuAt = latest!.at
      scale = motionScale = flightScaleController.update({ wallMs: wallCost, gpuMs: gpuCost, fenceMs: flightFenceMs, hasGpuSource: gpuTimer.source !== 'none', capMs: FLIGHT_GATE.periodMs || undefined }, deviceFloor, now, quality.sharp.on ? { emergencyFloor: SHARP_EMERGENCY_FLOOR } : undefined)
    }
    // `?motion=sharp`: whatever a ladder, a memory or the flight controller chose, a gesture or flight frame is drawn at the rest size.
    if (sharpMotionOn() && (gestureOn || flightScaleActive)) { if (scale < 1 || motionScale < 1) sharpMotionStats.overridden++; scale = 1; motionScale = 1 }
    // Phone policy: every moving frame (gesture, fly-to, flight, the Fly-around orbit, the intro) at the pacer's f; the wall gap between drawn frames feeds it.
    if (phoneMotionOn() && (gestureOn || flightScaleActive)) {
      if (wallDrawSeq !== phoneSeenSeq) { phoneSeenSeq = wallDrawSeq; if (wallGap > 0) phonePacer.observe(wallGap, 1000 / (displayRate.hz || 60), phoneMomentActive(), gpuTimer.source === 'query' && gpuTimer.fresh >= 2 ? gpuTimer.smoothed : undefined) }
      scale = motionScale = sharpF()
    }
  }
  // `?settle=stepped` (review item 2): a dear rest frame whose band gate is shut (exposure cut or moving, a scripted hand-over) must not fall through to one unbanded
  // submit: it is deferred, bounded by SETTLE_DEFER_MAX_MS, then drawn whatever the gate says. Ground mode, flights and ridges never band and are not deferred (L6).
  // A final-only crossfade redraw (fadeOnly) is cheap and never deferred. The hand-back's price stamp for this frame is dropped: a deferred frame must not be priced by its wait.
  if (SETTLE_STEPPED && !settleHeld && !buildOnly && !gestureOn && !bandState && dirty && !STILL && scale === 1 && !captureSession && !groundMode?.active && !flight && !ridge && bandsWorth() && !(fadeOnly && fadeOnly.scale === scale && !pendingFade)) {
    const gateShut = !bandStartAllowed({ cutFrames: exposureCutFrames, sinceScriptedMs: now - lastScriptedAt, exposureMoving: exposureControl.moving })
    if (gateShut && settleDeferSince < 0) settleDeferSince = now
    if (settleDefers(SETTLE_STEPPED, true, gateShut, gateShut ? now - settleDeferSince : 0)) {
      settleHeld = true; settleDeferred++; because('settleDefer')
      if (restDrawAt > 0) { restDrawAt = 0; restDrawWall = -1 }
    } else settleDeferSince = -1
  } else if (!settleHeld) settleDeferSince = -1
  // F7: on a fast display held to slow pacing, a motion frame draws every second (third) vsync so the presented cadence is steady.
  const holdForPacing = scale < 1 && gestureOn && pacing.holdFrame(now)
  if (holdForPacing && dirty) paceHolds++
  if (buildOnly) {
    // A catch-up frame: tiles and shadow layers update, nothing is drawn, nothing is timed or paced, the last picture stays; the next frame re-enters the hand-back.
    dirty = false
    inRender = true
    renderAborted = false
    try {
      span('render', () => render(now, 1, null, false, false, now, true))
      // The mid frame's crossfade keeps running while the hold lasts: redraw only the final pass over the mid scene, so the mid picture fades in instead of freezing at blend 0.
      if (buildFade && !renderAborted) span('render', () => render(now, buildFade!.scale, null, true))
    } catch (e) { invalidateHealthyRecoveryWindow(); gpuTimer.abort(); passTimer.abort(); throw e } finally { inRender = false }
    markDirty()
    if (renderAborted) restForceNormal = true
    if (renderAborted && restCatchUp) { restCatchUpStats.ms += now - restCatchUp.since; restCatchUpStats.abandoned++; restCatchUp = null }
  } else if (settleHeld && !paceHeld && last && final?.refining()) {
    // The stepped settle holds the full frame, not the crossfade (review item 1): the mid frame's time-based transition is redrawn as a final-only pass over the mid scene
    // (what buildFade does for the catch-up), so the mid picture fades in during the spell instead of sitting at blend 0 and expiring unseen. `dirty` stays pending.
    inRender = true
    try { span('render', () => render(now, lastScale, null, true)) } catch (e) { invalidateHealthyRecoveryWindow(); gpuTimer.abort(); passTimer.abort(); throw e } finally { inRender = false }
    finalOnlyFrames++; settleFades++
  } else if (dirty && !paceHeld && !holdForPacing && !settleHeld && (!NATIVE_BUILD || nativeCapAllows(now))) {
    dirty = false
    restForceNormal = false // a normal draw resizes the canvas; the hold may resume after it
    pacing.drew(now)
    wallGap = now - wallPrevDrawAt < WALL_IGNORE_MS_MAIN ? now - wallPrevDrawAt : 0
    wallPrevDrawAt = now; wallDrawSeq++
    // Budgeted refine: a full-size (non-gesture) frame the period model puts over BAND_MS is drawn in bands; a redraw whose only reason is the refine crossfade redraws just the final pass.
    let band: BandState | null = null
    let finalOnly = false
    if (!STILL && !gestureOn) {
      if (bandState) band = bandState
      else if (fadeOnly && fadeOnly.scale === scale && !pendingFade && canDrawFinalOnly(false, true, paceHeld, holdForPacing, !!last)) finalOnly = true
      else if (bandsWorth() && bandStartAllowed({ cutFrames: exposureCutFrames, sinceScriptedMs: now - lastScriptedAt, exposureMoving: exposureControl.moving }) && !groundMode?.active && !flight && !ridge) {
        const n = bandsFor(scale)
        if (n > 1) band = bandState = { k: 0, n, scale, cw: 0, ch: 0, exposure: null, tilesBusy: false }
      }
    }
    if (band) { bandFrames++; if (band.k === band.n - 1) bandedFrames++ }
    if (finalOnly) finalOnlyFrames++
    fadeOnly = null
    // The crossfade from the last motion frame starts when the picture it fades into is complete.
    if (pendingFade && final && (!band || band.k === band.n - 1)) {
      final.beginDateTransition(renderer, targets.get(pendingFade.w, pendingFade.h), last!.exposure, now, REFINE_CROSSFADE_MS, { w: pendingFade.cw, h: pendingFade.ch })
      pendingFade = null
    }
    lastScale = scale
    if (PERF) perfAdd('pre.frame', performance.now() - tLoop0)
    passTimer.begin('pre')
    if (!band && !finalOnly) gpuTimer.begin(now, scale === 1 && perfState.gestureEndAt > 0 && now - perfState.gestureEndAt < 1000, !FORCED_MOTION_SCALE ? scale : 0, groundMode?.active ? 1 : 0)
    inRender = true
    try { span('render', () => render(now, scale, band, finalOnly)) } catch (e) { invalidateHealthyRecoveryWindow(); gpuTimer.abort(); passTimer.abort(); throw e } finally { inRender = false }
    passTimer.end()
    gpuTimer.end()
    const bandK = band ? band.k : 0
    if (band) completeBand(band)
    // `?pace=rest`: only rest frames are fenced (a gesture frame fenced and held is #96).
    if (PACE_ON || (PACE_REST && !gestureOn)) {
      // Rest frames (and their bands) are tagged so their measured period feeds bandsFor.
      if (BANDS_ON && !gestureOn && !finalOnly && scale >= REFINE_MID_SCALE && perfState.gestureEndAt > 0) {
        if (bandK === 0) restFrameId++
        framePacer.drew(renderer.getContext() as unknown as WebGL2RenderingContext, now, false, { id: restFrameId, n: band ? band.n : 1, scale })
      } else framePacer.drew(renderer.getContext() as unknown as WebGL2RenderingContext, now, false)
    }
    perfState.motionScale = scale
    if (scale < 1) { perfState.gesture = true; perfState.motionFrames++ }
    const labelsChrome = readLabelsChrome()
    const domAspect = labelsChrome?.aspect ?? canvasAspect()
    const vw = labelsChrome?.vw ?? window.innerWidth, vh = labelsChrome?.vh ?? window.innerHeight
    frameAspect = domAspect
    labelsApi?.prepareFrame()
    if (!ABL.has('dom0') && pinsApi && last) pinsApi.update({ cam: last.cam, aspect: domAspect, e: ephem, pose: rig.pose, hidden: cameraOwned() })
    if (!ABL.has('dom0') && firstHotspotsApi && last) firstHotspotsApi.update({ cam: last.cam, aspect: domAspect, e: ephem, pose: rig.pose, hidden: cameraOwned(), landed: !document.body.classList.contains('intro-on') && !intro?.active })
    updateLabelsDom(labelsChrome)
    if (!ABL.has('dom0') && routesApi && last) routesApi.update({ cam: last.cam, aspect: domAspect, vw, vh, e: ephem, dist: rig.pose.dist, hidden: !!(!routesShown || ridge || groundMode?.active || flight || (tween && !routeFlight) || descent) })
    if (!ABL.has('dom0') && heatApi && last) heatApi.update({ cam: last.cam, aspect: domAspect, e: ephem })
    updateSiteRing(domAspect, vw, vh)
    // A level that failed to load (or a retry) changes which pictures exist: the floor follows what is there.
    if (patch && patchState === 'ready' && patch.failedLevelNames.join() !== failedKey) applyFloor()
    checkPinCaption()
    updatePinCaption()
    if (!api.ready) {
      api.ready = true
      api.readyAt = performance.now()
      document.body.dataset.ready = '1'
      startDeferredLoads()
      const pv = document.getElementById('preview')
      if (pv) { pv.classList.add('done'); setTimeout(() => pv.remove(), 600) }
    }
  }
  if (PERF) perfAdd('frame.cpu', performance.now() - tLoop0)
  endFrame(now)
  if (healthyRecoveryPending && !contextLost && !document.hidden && !nativePaused) {
    const frameAt = performance.now()
    // A stall since the previous frame starts the window again: this frame cannot complete it (issue #254).
    const w = healthyFrameWindow(healthyRecoveryAt, healthyLastFrameAt, frameAt)
    if (w.restarted) clearHealthyResetTimer()
    healthyRecoveryAt = w.recoveredAt
    healthyLastFrameAt = frameAt
    if (healthyResetTimerFiredAt !== null && healthyLastFrameAt > healthyResetTimerFiredAt && healthyResetDue(healthyRecoveryAt, healthyLastFrameAt, healthyLastFrameAt, true, false, false)) finishHealthyRecovery()
    armHealthyResetTimer()
  }
  const quiet = loopQuiet(now)
  const visitorQuiet = groundMode?.active ? loopQuiet(now, groundStillness.still(now, lastUserInputAt)) : quiet
  brandFade?.tick(visitorQuiet, now)
  lowEndHint?.tick(visitorQuiet, !!(cinematicFlight || flight), now)
  if (IDLE_ON && idleGate.update(quiet, now)) {
    loopRunning = false
    idleSleeping = true
    idleSleeps++
    idleBeat = setTimeout(() => { idleBeat = null; wakeLoop(false) }, beatDelay(live, performance.now() - lastLiveTick, LIVE_TICK_MS))
    return
  }
  requestAnimationFrame(frameLoop)
}

// ---------------------------------------------------------------------------
// Capture and integration API.
// ---------------------------------------------------------------------------
type CaptureBegin = { flightId: string; fps: number; width: number; height: number } | { tween: { to: Pose }; fps: number; width: number; height: number }
function endCaptureState(state: CaptureSession): void {
  state.cancelled = true
  if (state.clock.active) state.clock.end()
  cancelFlightPrefetch()
  if (captureSession === state) { captureSession = null; switchesApi?.setHidden(false) }
  captureSize = null
  captureSunLook = false
  live = state.previousLive; rig.auto = state.previousAuto
  gestureOn = state.previousGestureOn
  tween = null
  time = state.previousTime; ephem = clockSet(time)
  rig.setPose(state.previousPose); rig.fovDeg = state.previousFov
  rig.aimShift = state.previousAim[0]; rig.aimShiftX = state.previousAim[1]; rigLook = state.previousLook
  rig.restoreLookBlend(state.previousLookBlend)
  restDpr = state.previousDpr[0]; motionDpr = state.previousDpr[1]
  markMoved()
}
const captureApi = {
  // The film job opens ?still=1, reusing its preserveDrawingBuffer and snapped
  // exposure behavior; this manual path pins the render grid to full resolution.
  async begin(opts: CaptureBegin): Promise<void> {
    if (captureSession) throw new Error('Capture already active')
    if (!Number.isFinite(opts.fps) || opts.fps <= 0 || opts.width < 64 || opts.height < 64) throw new RangeError('Invalid capture settings')
    if (groundMode?.active || ridge || flight || descent || cinematicFlight || tween || orbitJourney) throw new Error('End the active camera journey before capture')
    const flightDef = 'flightId' in opts ? getCinematicFlight(opts.flightId) : undefined
    if ('flightId' in opts && !flightDef) throw new Error(`Unknown cinematic flight: ${opts.flightId}`)
    const previousLive = live, previousAuto = rig.auto, previousGestureOn = gestureOn
    const previousPose = { ...rig.pose }, previousTime = new Date(time), previousFov = rig.fovDeg
    const previousAim: [number, number] = [rig.aimShift, rig.aimShiftX], previousLook = rigLook, previousLookBlend = rig.snapshotLookBlend()
    const previousDpr: [number, number] = [restDpr, motionDpr]
    live = false; rig.auto = false; gestureOn = false
    captureSize = { width: Math.round(opts.width), height: Math.round(opts.height) }
    restDpr = motionDpr = 1
    const clock = new CaptureClock(); clock.begin(opts.fps)
    const state: CaptureSession = { fps: opts.fps, baseNow: performance.now(), clock, previousLive, previousAuto, previousGestureOn, previousPose, previousTime, previousFov, previousAim, previousLook, previousLookBlend, previousDpr, patchRequired: false, tilesRequired: !!TILE_BASE, ready: false, cancelled: false }
    captureSession = state
    switchesApi?.setHidden(true)
    try {
      if ('flightId' in opts) {
        const moment = MOMENTS.find((m) => m.cinematicFlight === opts.flightId)
        if (moment) { time = moment.time(); ephem = clockSet(time) }
        state.flight = flightDef!
        const flightMoment = MOMENTS.find((m) => m.cinematicFlight === opts.flightId)
        const start = sampleFlight(state.flight, 0, ephem, (lon, lat) => rig.floorAt(lon, lat), (lon, lat) => rig.groundAt(lon, lat))
        rig.setPose(start.pose); rig.fovDeg = start.fovDeg; rigLook = start.look
        if (flightMoment?.needsPatch) state.patchRequired = true
      } else {
        flyTo({ pose: { ...opts.tween.to } }, state.baseNow)
        state.tween = tween ?? undefined
        if (!state.tween) throw new Error('Tween capture did not create a flight plan')
      }
      // Make the configured tile streamer real before capture readiness can be measured.
      await ensureTiles()
      assertCaptureNotCancelled(state)
      if (state.tilesRequired && !tiles) throw new Error('Tile streamer is unavailable for capture')
      const flightMoment = state.flight && MOMENTS.find((m) => m.cinematicFlight === state.flight!.id)
      if (flightMoment?.needsPatch) await ensurePatch(flightMoment.needsPatch)
      assertCaptureNotCancelled(state)
      state.ready = true
      markMoved()
    } catch (error) {
      const wasCancelled = state.cancelled || captureSession !== state
      if (captureSession === state) endCaptureState(state)
      if (wasCancelled) throw new Error('Capture initialization was cancelled')
      throw error
    }
  },
  async frame(i: number): Promise<{ i: number; waitedMs: number; resident: true } | { i: number; waitedMs: number; resident: false; cancelled: true } | { i: number; waitedMs: number; resident: false; timedOut: true; why: { wanted: number; resident: number; inflight: number; tcInflight: number; shadowIdle: boolean; sigChanged: boolean; floorFlips: number; boundLevels: number } }> {
    const state = captureSession
    if (!state) throw new Error('Capture is not active')
    if (!state.ready) throw new Error('Capture is still initializing')
    const t = state.clock.frameTimeMs(i)
    const now = state.baseNow + t
    const uFlight = state.flight ? Math.min(1, t / (state.flight.seconds * 1000)) : 0
    const sampleCapturePose = (): void => {
      if (state.flight) {
        const shot = sampleFlight(state.flight, uFlight, ephem, (lon, lat) => rig.floorAt(lon, lat), (lon, lat) => rig.groundAt(lon, lat))
        rig.setPose(shot.pose); rig.fovDeg = shot.fovDeg; rigLook = shot.look; rig.setLookBlend(shot.look, flightAim(shot, ephem)); captureSunLook = sunGaze(shot)
      } else if (state.tween) {
        const sample = state.tween.plan.at(Math.min(1, t / state.tween.plan.ms))
        rig.setPose(sample.pose); rig.fovDeg = sample.fovDeg
        applyTweenSubject(state.tween, { aim: sample.aimShift, aimX: sample.aimShiftX, look: sample.look })
      }
    }
    sampleCapturePose()
    if (state.flight) {
      if (TILE_BASE) void prefetchFlight(buildFlightPrefetchTargets((u) => {
        const s = sampleFlight(state.flight!, uFlight + (1 - uFlight) * u, ephem, (lon, lat) => rig.floorAt(lon, lat), (lon, lat) => rig.groundAt(lon, lat))
        return { pose: s.pose, fovDeg: s.fovDeg }
      }, Math.max(0, state.flight.seconds * 1000 - t), { aspect: captureSize!.width / captureSize!.height, heightPx: canvasHeightPx() }))
    } else if (state.tween) {
      if (TILE_BASE) void prefetchFlight(buildFlightPrefetchTargets((u) => {
        const s = state.tween!.plan.at(Math.min(1, (t + u * Math.max(0, state.tween!.plan.ms - t)) / state.tween!.plan.ms))
        return { pose: s.pose, fovDeg: s.fovDeg }
      }, Math.max(0, state.tween.plan.ms - t), { aspect: captureSize!.width / captureSize!.height, heightPx: canvasHeightPx() }))
    }
    let identical = 0, previous = '', drawStep = 0
    let lastFloor: number | null = null, floorDirection = 0, floorFlips = 0
    const result = await waitForCaptureReadiness(i, async () => {
      sampleCapturePose()
      const poseFloor = rig.floorAt(rig.pose.lon, rig.pose.lat)
      if (lastFloor !== null && Math.abs(poseFloor - lastFloor) > 1e-7) {
        const direction = Math.sign(poseFloor - lastFloor)
        if (floorDirection && direction !== floorDirection) floorFlips++
        floorDirection = direction
      }
      lastFloor = poseFloor
      // Capture time is frame-index based. Once data is resident, render two
      // extra settling frames for fades/adaptation, while the camera's clock
      // stays pinned to this output frame regardless of how long loading took.
      const settleNow = now + drawStep++ * 16
      render(settleNow, 1, null, false, true, now)
      const res = (api.residency as () => { wanted: number; resident: number; inflight: number; bestLevelShare: number })()
      const signature = `${rig.pose.lon.toFixed(8)}|${rig.pose.lat.toFixed(8)}|${rig.pose.dist.toFixed(9)}|${rig.pose.pitch?.toFixed(6)}|${rig.pose.roll?.toFixed(6)}|${rig.fovDeg.toFixed(6)}|${rigLook.toFixed(6)}|${moon.boundLevels}|${tiles?.captureFadeSignature() ?? 0}|${tiles?.detail?.captureFadeSignature() ?? 0}|${tiles?.tc?.captureFadeSignature() ?? 0}|${lastExposureInfo?.white.toFixed(6) ?? ''}|${shadowCache?.captureFadeSignature() ?? 0}|${patchShadowCache?.stats.buildsTotal ?? 0}|${patchShadowCache?.stats.rebuilds ?? 0}|${patchShadowCache?.stats.serving ?? 0}`
      identical = signature === previous ? identical + 1 : 0
      previous = signature
      const patchReady = !state.patchRequired || (patchState === 'ready' && !!patch && patch.readyCoarse && !patch.loading && !patch.refinementPending && moon.boundLevels >= patch.levels.length)
      const streamersReady = !state.tilesRequired || (!!tiles && !tiles.busy() && !tiles.detail?.busy && !tiles.tc?.busy)
      const shadowsIdle = (!shadowCache || shadowCache.captureIdle()) && (!patchShadowCache || patchShadowCache.captureIdle()) && (!globalHorizon || globalHorizon.captureIdle()) && (!sunBake || sunBake.captureIdle())
      const shadowState = advanceShadowIdleDraws(state.shadowIdleDraws ?? 0, shadowsIdle)
      state.shadowIdleDraws = shadowState.count
      // A wanted tile that can never load (absent or failed upstream) leaves the share just under 1 with nothing in flight: after
      // 1.5 s of an unchanged resident count with at most max(3, 2 %) tiles missing, the frame counts as resident (logged once).
      const missing = res.wanted - res.resident
      if (res.inflight === 0 && missing > 0 && res.resident === state.stuckResident) { state.stuckSince ??= performance.now() } else { state.stuckSince = undefined; state.stuckResident = res.resident }
      const missingOk = res.inflight === 0 && missing > 0 && missing <= Math.max(3, 0.02 * res.wanted) && state.stuckSince !== undefined && performance.now() - state.stuckSince > 1500
      if (missingOk && !state.warnedMissing) { state.warnedMissing = true; console.warn('Capture: wanted tiles never loaded, continuing', { missing, wanted: res.wanted }) }
      const shareOk = res.bestLevelShare >= 0.999 || missingOk
      if (!shareOk || res.inflight > 0) state.fadesSettled = false
      if (!state.fadesSettled && shareOk && res.inflight === 0 && streamersReady) {
        tiles?.completeFadesForCapture(settleNow)
        tiles?.detail?.completeFadesForCapture(settleNow)
        tiles?.tc?.completeFadesForCapture(settleNow)
        state.fadesSettled = true
        identical = 0; previous = ''
      }
      if (state.patchRequired && patchState === 'failed') throw new Error(`Capture patch failed: ${patchError ?? patchSiteId ?? 'unknown site'}`)
      const ready = shareOk && res.inflight === 0 && streamersReady && patchReady && shadowState.ready && !exposureControl.moving && identical >= 2
      if (ready) return { ready: true as const, value: undefined }
      const tileStats = tiles?.tc
      return { ready: false as const, why: { wanted: res.wanted, resident: res.resident, inflight: res.inflight, tcInflight: tileStats?.inflight ?? 0, shadowIdle: shadowState.ready, sigChanged: identical < 2, floorFlips, boundLevels: moon.boundLevels } }
    }, { now: () => performance.now(), sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)), timeoutMs: 20_000, cancelled: () => state.cancelled || captureSession !== state })
    if (captureSession !== state || 'cancelled' in result) return { i, waitedMs: result.waitedMs, resident: false, cancelled: true }
    if (!result.resident) {
      console.warn('Capture frame readiness timed out', { i: result.i, waitedMs: result.waitedMs, ...result.why })
      return result
    }
    return { i, waitedMs: result.waitedMs, resident: true }
  },
  end(): void {
    const state = captureSession
    if (!state) return
    endCaptureState(state)
  },
}
if (DEV_TOOLS) api.capture = captureApi
/** Something other than the free-orbit rig holds the camera (a fly-to, a descent, ground mode, a flight, the ridge, a journey). */
function cameraOwned(): boolean {
  return !!(cinematicFlight || tween || descent || rig.gliding() || groundMode?.active || flight || ridge || orbitJourney || approachFor !== null)
}
function resolveLook(target: LookTarget | 'earth' | 'sun'): LookTarget {
  if (target === 'earth') return (cam) => ephem.earthKm.clone().divideScalar(MOON_R_KM).sub(cam.pos)
  if (target === 'sun') return SUN_LOOK
  return target
}
/** One function for the Sun, shared by scripted views and the orbit rig. */
const SUN_LOOK: LookTarget = (cam) => ephem.sunKm.clone().divideScalar(MOON_R_KM).sub(cam.pos)
/**
 * The turn to the Sun is slower than the others: the Sun entering the frame is an 8-stop jump, and the exposure may rise 3 stops a second at most,
 * so the look-ahead needs about three seconds of lead for the picture to be at its new exposure when the disc arrives, with no pumping in shot.
 */
const vec = (v: THREE.Vector3): number[] => [v.x, v.y, v.z]

Object.assign(api, {
  /** Where the journeys are (captures and tests). */
  build: __MOON_BUILD__,
  /** Telemetry super-property: where the viewer runs (web, native-ios, native-android). */
  surface: nativeHost ? `native-${nativeHost.platform()}` : 'web',
  /** Quality: startup class, its table, the GPU ledger per category and high-water. */
  quality: () => ({ ...quality.snapshot(), reduced: reducedAudit }),
  /** Telemetry: how many shader programs three holds (each was compiled and linked once). Null when the renderer does not list them. */
  shaderPrograms: () => renderer.info.programs?.length ?? null,
  /** Memory-ceiling sheds so far (R54): the telemetry poll turns a rise in `count` into a `perf_degraded` of what 'memory'. */
  memoryShed: () => ({ ...memShed, on: memcapOn }),
  /** Adaptive tile cache (W3-M5): the state for the rig (`size`, `start`, `max`, grows, shrinks, last shrink reason, whether it is on). */
  cacheGrow: () => ({ on: cacheGrowOn, size: cacheGrow?.size ?? null, next: cacheGrow?.next ?? null, start: cacheGrow?.start ?? null, max: cacheGrow?.max ?? null, grows: cacheGrow?.grows ?? 0, shrinks: cacheGrow?.shrinks ?? 0, lastShrink: cacheGrow?.lastShrink ?? null, startedLower: cacheGrow?.startedLower ?? false, lostContext: cacheGrow?.lostContext ?? false, layers: tiles?.capacity ?? null }),
  /** Debug and measurement: the tile streamer's counts (resident layers, in flight, loaded bytes) and the wanted-set summary of the last frame. */
  /** Debug and measurement: the patch shadow cache's counts and bytes, and the GPU ledger's lines (null: ?pshcache=0, no fused-ground patch bound yet). */
  patchShadowCache: () => (patchShadowCache ? { ...patchShadowCache.stats, shaderOn: patchShadowCache.shaderOn, ledger: ledger.entries(), ledgerTotal: ledger.total() } : null),
  /** Measurement: the Moon shader's debug output mode (the ?dbg= value; 4 draws the lit factor alone, i.e. the shadows) from the next frame on. */
  /** Rig only, ?shadowdebug=serve: draw one frame in the serving-mask view, read the canvas back (width x height RGBA) and count pixels per category; shadowStats().serve returns it. */
  serveSummary(): Record<string, number | null> | null {
    if (parseShadowDebug(params.toString()) !== 'serve') return null
    render(performance.now(), 1)
    const gl = renderer.getContext() as WebGL2RenderingContext
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
    const buf = new Uint8Array(w * h * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    const counts = summariseServe(buf)
    lastServe = { ...counts, ...serveShares(counts), frame: api.frames, width: w, height: h }
    return lastServe
  },
  /**
   * Dev/rig: reads the horizon envelope back and returns its distribution (decoded degrees: min, p50, p95, max, and the counts of unbuilt / unbounded codes), the build state,
   * and for a 9 x 9 grid of screen pixels (sphere hit; relief ignored): elevS, elevV, the lod, env(p), the Sun and viewer margins and clearances actually used, uTermAA and
   * whether each skip fires. Null without an envelope (not the fixed policy, or not built yet).
   */
  envelopeProbe(): Record<string, unknown> | null {
    if (!DEV_TOOLS || !globalHorizon) return null
    const codes = globalHorizon.readback()
    const glErr = (renderer.getContext() as WebGL2RenderingContext).getError()
    const base = { state: globalHorizon.stats.state, readOn: globalHorizon.readOn, uEnvOn: moon.uniforms.uEnvOn.value, maxTextures: renderer.capabilities.maxTextures, glError: glErr, stats: { ...globalHorizon.stats } }
    if (!codes) return { ...base, histogram: null, grid: [] }
    const { w, h } = globalHorizon.size
    const u = moon.uniforms
    const inv = (u.uInvViewProj.value as { elements: number[] }).elements
    const cam = u.uCamPos.value as { x: number; y: number; z: number }
    const res = u.uResolution.value as { x: number; y: number }
    const S = u.uS.value as { x: number; y: number; z: number }, X = u.uX.value as { x: number; y: number; z: number }, Y = u.uY.value as { x: number; y: number; z: number }, K = u.uK.value as { x: number; y: number; z: number }
    const termAA = u.uTermAA.value as number
    const tanPerPx = u.uTanPerPx.value as number
    const texelKm = 2 * Math.PI * 1737.4 / maps.height.size[0]
    const grid: Array<Record<string, unknown>> = []
    for (let gy = 0; gy < 9; gy++) for (let gx = 0; gx < 9; gx++) {
      const nx = ((gx + 0.5) / 9) * 2 - 1, ny = ((gy + 0.5) / 9) * 2 - 1
      const e = inv, x = nx, y = ny, z = 1, ww = 1
      const hx = e[0] * x + e[4] * y + e[8] * z + e[12] * ww, hy = e[1] * x + e[5] * y + e[9] * z + e[13] * ww, hz = e[2] * x + e[6] * y + e[10] * z + e[14] * ww, hw = e[3] * x + e[7] * y + e[11] * z + e[15] * ww
      let dx = hx / hw - cam.x, dy = hy / hw - cam.y, dz = hz / hw - cam.z
      const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl
      const b = cam.x * dx + cam.y * dy + cam.z * dz, c = cam.x * cam.x + cam.y * cam.y + cam.z * cam.z - 1
      const disc = b * b - c
      if (disc < 0) { grid.push({ gx, gy, hit: false }); continue }
      const t = -b - Math.sqrt(disc)
      const px = cam.x + dx * t, py = cam.y + dy * t, pz = cam.z + dz * t
      const vx = cam.x - px, vy = cam.y - py, vz = cam.z - pz, vl = Math.hypot(vx, vy, vz)
      const muP = (px * vx + py * vy + pz * vz) / vl
      const elevS = Math.asin(Math.max(-1, Math.min(1, px * S.x + py * S.y + pz * S.z))) * 180 / Math.PI
      const elevV = Math.asin(Math.max(-1, Math.min(1, muP))) * 180 / Math.PI
      const kmPerPx = vl * 1737.4 * tanPerPx
      const lod0 = Math.log2(Math.max(1, kmPerPx / Math.max(muP, 0.15) / texelKm))
      const lodS = Math.max(lod0, Math.log2(Math.max(1, kmPerPx / Math.max(muP, 0.02) / texelKm)))
      const [uu, vv] = ghUv([px * X.x + py * X.y + pz * X.z, px * Y.x + py * Y.y + pz * Y.z, px * K.x + py * K.y + pz * K.z])
      // The azimuths of the Sun's and the viewer's tangents in the build's frame (e = normalize(cross(K, p) + 1e-6), n = cross(p, e)): they pick the sector.
      let ex = K.y * pz - K.z * py + 1e-6, ey = K.z * px - K.x * pz + 1e-6, ez = K.x * py - K.y * px + 1e-6
      const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el
      const qx = py * ez - pz * ey, qy = pz * ex - px * ez, qz = px * ey - py * ex
      const azOf = (ax: number, ay: number, az: number): number => { const d = ax * px + ay * py + az * pz; const tx = ax - px * d, ty = ay - py * d, tz = az - pz * d; return Math.atan2(tx * qx + ty * qy + tz * qz, tx * ex + ty * ey + tz * ez) }
      const azS = azOf(S.x, S.y, S.z), azV = azOf(vx / vl, vy / vl, vz / vl)
      const sun = envProbePoint(codes, w, h, uu, vv, lodS, elevS, elevV, termAA, azS, azV)
      const view = envProbePoint(codes, w, h, uu, vv, lod0, elevS, elevV, termAA, azS, azV)
      grid.push({ gx, gy, hit: true, azSunDeg: +(azS * 180 / Math.PI).toFixed(1), azViewDeg: +(azV * 180 / Math.PI).toFixed(1), u: +uu.toFixed(4), v: +vv.toFixed(4), elevS: +elevS.toFixed(2), elevV: +elevV.toFixed(2), lod0: +lod0.toFixed(2), lodS: +lodS.toFixed(2), env: sun.env, envView: view.envView, sunMargin: sun.sunMargin, sunCert: sun.sunCert, sunSkip: sun.sunSkip, viewMargin: view.viewMargin, viewClear: view.viewClear, viewSkip: view.viewSkip, uTermAA: termAA })
    }
    return { ...base, width: w, height: h, resolution: [res.x, res.y], histogram: envHistogram(codes), grid }
  },
  /** Rig only, ?shadowdebug=serve: the distribution of the tile share gTileMarch over the Moon's pixels (0 = the 4k map only; 1 = the tile march). */
  tileShareSummary(): Record<string, number | null> | null {
    if (parseShadowDebug(params.toString()) !== 'serve') return null
    const prev = moon.uniforms.uDbg.value
    moon.uniforms.uDbg.value = W_DBG_VALUE
    try {
      render(performance.now(), 1)
      const gl = renderer.getContext() as WebGL2RenderingContext
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
      const buf = new Uint8Array(w * h * 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      return { ...summariseServe(buf, 1, 'w'), frame: api.frames, width: w, height: h }
    } finally { moon.uniforms.uDbg.value = prev || SERVE_DBG_VALUE; markMoved() }
  },
  /** Rig only, ?shadowdebug=count&dbg=25: draw one frame in the march-count view and sum the marches that RAN per pixel (Sun tile / 4k, viewer tile / 4k), over all sub-pixel taps. */
  countSummary(): ReturnType<typeof summariseCount> & { frame: number; width: number; height: number } | null {
    if (!countDebugOn()) return null
    render(performance.now(), 1)
    const gl = renderer.getContext() as WebGL2RenderingContext
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
    const buf = new Uint8Array(w * h * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    return { ...summariseCount(buf), frame: api.frames, width: w, height: h }
  },
  /** Rig only, ?shadowdebug=serve: the same for the viewer-visibility march (skipped by the horizon envelope, marched, or not needed), per pixel. */
  visSummary(): Record<string, number | null> | null {
    if (parseShadowDebug(params.toString()) !== 'serve') return null
    const prev = moon.uniforms.uDbg.value
    moon.uniforms.uDbg.value = VIS_DBG_VALUE
    try {
      render(performance.now(), 1)
      const gl = renderer.getContext() as WebGL2RenderingContext
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
      const buf = new Uint8Array(w * h * 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      const counts = summariseServe(buf, 1, true)
      const asked = (counts.visSkipped ?? 0) + (counts.visMarched ?? 0) + (counts.visGated ?? 0) + (counts.visNoEnv ?? 0)
      return { ...counts, skipShare: asked > 0 ? (counts.visSkipped ?? 0) / asked : null, frame: api.frames, width: w, height: h }
    } finally { moon.uniforms.uDbg.value = prev || SERVE_DBG_VALUE; markMoved() }
  },
  /**
   * Rig only, ?shadowdebug=serve: for every Moon pixel the legacy live horizon toward the Sun against the envelope bound the fixed policy reads (the Sun's azimuth sector), as counts per
   * BOUND_CATEGORIES. bExcessHarm (the live horizon above the bound by more than the skip tolerance, with the skip firing) is the only category that can change the picture: there must be none.
   * `view` = true checks the viewer-visibility skip (the bound toward the viewer) instead of the Sun's. Needs the fixed policy and built envelopes.
   */
  boundSummary(view = false): Record<string, number | null> | null {
    if (parseShadowDebug(params.toString()) !== 'serve') return null
    const prev = moon.uniforms.uDbg.value
    moon.uniforms.uDbg.value = view ? VIEW_BOUND_DBG_VALUE : BOUND_DBG_VALUE
    try {
      render(performance.now(), 1)
      const gl = renderer.getContext() as WebGL2RenderingContext
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
      const buf = new Uint8Array(w * h * 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      return { ...summariseServe(buf, 1, 'b'), frame: api.frames, width: w, height: h }
    } finally { moon.uniforms.uDbg.value = prev || SERVE_DBG_VALUE; markMoved() }
  },
  /**
   * Dev/rig: reads one tile-envelope layer back (eight sector bytes a cell, n x n x 8) with the tile it belongs to; `layer` omitted = the first fully built eligible layer. Null without the tile envelope.
   */
  tileEnvelopeLayer(layer?: number): Record<string, unknown> | null {
    if (!DEV_TOOLS || !tileEnvelope || !tiles) return null
    const slots = tiles.cacheSlots()
    const s = layer === undefined ? slots.find((x) => x.full && x.shade && x.layer < tileEnvelope!.layers) : slots.find((x) => x.layer === layer)
    if (!s) return null
    const bytes = tileEnvelope.readLayer(s.layer)
    return { layer: s.layer, level: s.level, tx: s.tx, ty: s.ty, n: tileEnvelope.n, bytes: Array.from(bytes) }
  },
  /** Rig only, ?shadowdebug=serve: draws one frame in debug view `dbg` and returns the canvas as a PNG data URL (read in the same task as the draw, so the buffer is valid; a screenshot of a slow software-GL page times out). */
  debugShot(dbg: number): string | null {
    if (parseShadowDebug(params.toString()) !== 'serve') return null
    const prev = moon.uniforms.uDbg.value
    moon.uniforms.uDbg.value = dbg
    try {
      render(performance.now(), 1)
      return canvas.toDataURL('image/png')
    } finally { moon.uniforms.uDbg.value = prev || SERVE_DBG_VALUE; markMoved() }
  },
  setDbg(n: number): void { moon.uniforms.uDbg.value = n; markMoved() },
  /** Measurement: the patch shader reads its shadow cache (true) or marches live (false) from the next frame on; the cache keeps building. */
  patchShadowCacheRead(on: boolean): void { if (patchShadowCache) { patchShadowCache.readOn = on; patchShadowCache.shaderOn = on && patchShadowCache.stats.serving > 0; moon.uniforms.uPShOn.value = patchShadowCache.shaderOn ? 1 : 0 } },
  /** Debug and measurement: the shadow cache's counts and bytes, and the GPU ledger's lines (null: ?shcache=0, or no tiles yet). */
  shadowCache: () => (shadowCache ? { ...shadowCache.stats, ledger: ledger.entries(), ledgerTotal: ledger.total() } : null),
  /** Measurement: the shader reads the shadow cache (true) or marches live (false) from the next frame on; the cache itself keeps building. Lets one page load render both. */
  shadowCacheRead(on: boolean): void { if (shadowCache) { shadowCache.readOn = on; shadowCache.shaderOn = on && shadowCache.stats.serving > 0 } moon.uniforms.uShOn.value = on && shadowCache && shadowCache.shaderOn ? 1 : 0 },
  /** Measurement: draws one frame now at `scale` of the canvas (1 = the rest frame) and returns; the caller times it with a GPU query. */
  drawFrame(scale = 1): void { render(performance.now(), scale) },
  /** Measurement: holds the gesture state (live shadow march, motion shader) so scripted frames draw as a real drag's frames do. Always pair with forceGesture(false). */
  forceGesture(on: boolean): void { gestureOn = on },
  /** Measurement (`?passes=1`): one frame with per-pass GPU queries; `passFrames()` returns the finished frames' segments in order. */
  passFrame(scale = 1): void { passTimer.begin('pre'); try { render(performance.now(), scale) } catch (e) { passTimer.abort(); throw e } passTimer.end(); passTimer.poll() },
  passFrames: () => { passTimer.poll(); return passTimer.takeFrames() },
  passFramesPeek: () => { passTimer.poll(); return passTimer.pending() },
  /** Measurement: the moment moves with no crossfade and no exposure cut (as a drag's clock once did), so a scrub frame is the picture of its own time. */
  scrubTo(iso: string): void {
    const d = parseTime(iso)
    if (!d) throw new Error(`Not a date: ${iso}`)
    time = d
    live = false
    ephem = clockSet(d)
    touched = true
    markMoved()
  },
  focusPull: () => focusScreen.snapshot(),
  tileStats: () => (tiles ? { resident: tiles.resident, inflight: tiles.inflight, ...tiles.stats, wantedByLevel: tiles.wantedByLevel, tc: tiles.tc ? { resident: tiles.tc.resident, inflight: tiles.tc.inflight, ...tiles.tc.stats, wantedByLevel: tiles.tc.wantedByLevel } : null } : null),
  /** Residency snapshot used by the flight rig: tile wanted/resident counts by level and the streamer work still in flight. */
  residency: () => {
    const wantedByLevel: Record<string, number> = {}
    const wantedResidentByLevel: Record<string, number> = {}
    const merge = (wanted: Record<string, number>, resident: Record<string, number>, prefix = ''): void => {
      for (const [level, count] of Object.entries(wanted)) wantedByLevel[`${prefix}${level}`] = count
      for (const [level, count] of Object.entries(resident)) wantedResidentByLevel[`${prefix}${level}`] = count
    }
    if (tiles) {
      merge(tiles.wantedByLevel, tiles.wantedResidentByLevel())
      if (tiles.detail) merge(tiles.detail.wantedByLevel, tiles.detail.wantedResidentByLevel(), 'detail:')
      if (tiles.tc) merge(tiles.tc.wantedByLevel, tiles.tc.wantedResidentByLevel(), 'tc:')
    }
    const wanted = Object.values(wantedByLevel).reduce((sum, n) => sum + n, 0)
    const resident = Object.values(wantedResidentByLevel).reduce((sum, n) => sum + n, 0)
    const streamerMissing = !!TILE_BASE && (!tiles || tilesState !== 'ready')
    const inflight = streamerMissing ? 1 : (tiles?.inflight ?? 0) + (tiles?.detail?.inflight ?? 0) + (tiles?.tc?.inflight ?? 0)
    return { wanted, resident, inflight, bestLevelShare: streamerMissing ? 0 : wanted ? resident / wanted : 1, wantedByLevel, wantedResidentByLevel }
  },
  /** Measurement only (?wantprobe=1, J1): residency against an exact want at the last drawn camera, plus how many exact tiles the throttled want lacks. Costs about one extra wanted pass per streamer per call. */
  exactResidency: () => (WANT_PROBE && tiles && lastStreamView ? tiles.exactResidency(lastStreamView) : null),
  claims: TOUR_CLAIMS,
  /** The centre caption's readback hits versus CPU-estimate fallbacks (rig measurement). */
  /** The shader compile state (rig and the program-count walk): linked programs, the queue's steps in the order they ran, the metadata variants built. */
  compileState: () => ({ programs: renderer.info.programs?.length ?? -1, steps: [...compileQueue.ran], pending: compileQueue.pending, metadataVariants: moon.metadataVariantCount, metadataWarm, enabled: [...PRECOMPILE], groundActive: !!groundMode?.active, programNames: (renderer.info.programs ?? []).map((p) => `${p.name}:${String(p.cacheKey).length}:${(p.usedTimes ?? 0)}`) }),
  centreCaptionStats: () => (centreCtl ? { ...centreCtl.stats, text: centreCtl.current?.text ?? null } : null),
  exposureTrace: (clear = false) => { const o = expTrace.slice(); if (clear) expTrace.length = 0; return o },
  exposureState: () => ({ ...lastExposureInfo, dateTransition, anchor: anchorCache && { white: anchorCache.white, flatWhite: anchorCache.flatWhite, key: anchorCache.key } }),
  exposureTune,
  setVisibilityCalibration(p: VisibilityCalibration | null): void {
    if (p) validateCalibration(p)
    visibilityCalibration = p
    if (p) wantMetadataPrograms()
    final.setVisibilityCalibration(p)
    hud.setVisibilityState(p?.id ?? null)
    markMoved()
  },
  /** Freeze at a full-resolution render; screenshot and metadata refer to this exact displayed frame. */
  auditBegin(opts?: { metadata?: boolean }): { frameId: number; width: number; height: number; metadataBase64: string; offscreen: boolean; limbApplicable: boolean; expectedNight: boolean; calibration: VisibilityCalibration | null; ground: boolean } {
    auditHeld = true
    wantMetadataPrograms()
    try {
      render(performance.now(), 1)
      const f = last!
      // The native Moon metadata (a full-size half-float readback, ~7 MB of base64 per frame) is only evidence for G8, which needs a calibration;
      // a run without one asks for the freeze alone (`metadata: false`), which is what keeps a development capture from stalling the page.
      let metadataBase64 = ''
      if (opts?.metadata !== false) {
        const target = targets.metadata(targets.get(f.w, f.h))
        const half = new Uint16Array(f.w * f.h * 4)
        renderer.readRenderTargetPixels(target, 0, 0, f.w, f.h, half)
        const encoded = new Uint8Array(half.length)
        // WebGL rows are bottom-up, matching texture coordinates, not screenshot rows.
        for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w * 4; x++)
          encoded[(f.h - y - 1) * f.w * 4 + x] = Math.round(Math.max(0, Math.min(1, THREE.DataUtils.fromHalfFloat(half[y * f.w * 4 + x]))) * 255)
        let binary = ''
        for (let off = 0; off < encoded.length; off += 32768) binary += String.fromCharCode(...encoded.subarray(off, off + 32768))
        metadataBase64 = btoa(binary)
      }
      const toMoon = f.cam.pos.clone().negate()
      const z = toMoon.dot(f.cam.back.clone().negate()), x = toMoon.dot(f.cam.right), y = toMoon.dot(f.cam.up)
      const tx = f.cam.tanHalf * (f.cw / f.ch), ty = f.cam.tanHalf
      const offscreen = z < -1.01 || Math.abs(x) > z * tx + 1.01 * Math.sqrt(1 + tx * tx)
        || Math.abs(y) > z * ty + 1.01 * Math.sqrt(1 + ty * ty)
      const fullDisc = z > 1.01 && z * tx - Math.abs(x) > 1.01 * Math.sqrt(1 + tx * tx)
        && z * ty - Math.abs(y) > 1.01 * Math.sqrt(1 + ty * ty)
      return { limbApplicable: fullDisc && !groundMode?.active, expectedNight: f.exposure.search.hits > 0 && f.exposure.search.sunlitFraction < .999, offscreen, frameId: renderedFrameId, width: f.w, height: f.h, metadataBase64, calibration: visibilityCalibration, ground: !!groundMode?.active }
    } catch (e) { auditHeld = false; throw e }
  },
  evidenceFrameId: () => renderedFrameId,
  auditEnd(): void { auditHeld = false; markMoved() },
  descentDebug: () => {
    if (!descent || !patch) return null
    const ideal = descentPose(1, descent.from as Pose, descent.alt0, descent.slide)
    return { u: Math.min(1, Math.max(0, (performance.now() - descent.t0) / descent.ms)), scale: descent.scale, lagDist: descent.lagDist, poseDist: rig.pose.dist, idealDist: ideal.dist, floor: rig.floorAt(ideal.lon, ideal.lat), readyCoarse: patch.readyCoarse, refinementPending: patch.refinementPending, bound: moon.boundLevels, loading: patch.loading, lastError: patch.lastError, levels: patch.levels.map((l) => l.name) }
  },
  patchTrace: () => (((globalThis as { __patchTrace?: unknown[] }).__patchTrace) ?? []).slice(),
  journeyState: () => ({ ...journey.state, durationS: orbitJourney ? ORBIT_SECONDS : descent ? descent.ms / 1000 : tween ? tween.plan.ms / 1000 : 0, ridge: !!ridge, u: ridge?.u ?? null, playing: !!ridge?.playing, mode: rig.mode, held: scrub.held, handle: scrub.current?.id ?? null, progress: scrub.progress(), descent: descent ? descent.t0 : null, patch: patchState, patchSite: patchSiteId }),
  /** Plays the ridge lift-off from where it stands (measurement; the ridge UI's Lift off button). */
  liftOff(): void { liftOff() },
  /** Holds the ridge lift-off at progress u (0 to 1), starting the ridge view if it is not on (captures and tests). */
  setJourney(u: number): void {
    if (!ridge) startRidge(u, false)
    else { ridge.u = clamp01(u); ridge.playing = false }
    markMoved()
  },
  /** Captures and A/B: the horizon option of moon/horizon.ts (`?horizon=` sets it at start), switched live. */
  setHorizon(mode: HorizonMode): void { moon.setHorizon(mode) },
  /** Fixes the moment (ISO UTC); stops following the clock. */
  setTime(iso: string): void {
    const d = parseTime(iso)
    if (!d) throw new Error(`Not a date: ${iso}`)
    stopMoments()
    beginDateChange(d)
    declareExposureCut()
    time = d
    live = false
    ephem = clockSet(d)
    markMoved()
  },
  /**
   * Audit and debugging only: sets the closest distance by hand, so a deeper block can be flown into before the coverage-driven floor exists
   * (the global floor is the BUILT tiles' texel; a regional floor from `tiles.heightTexelKmAt` is moon-zoom-apollo's zoomFloorAt).
   */
  setFloorDist(d: number | null): void {
    auditFloor = d
    markMoved()
  },
  /** Straight to a fly pose ({ lon, lat, dist, roll }); missing fields keep their values. */
  setPose(p: Partial<Pose>): void {
    rig.setPose({ ...rig.pose, ...p })
    markMoved()
  },
  /** Turns toward 'earth', 'sun', a world direction, or a function of the camera. */
  lookToward(target: LookTarget | 'earth' | 'sun', animate = true): void {
    declareExposureCut('look')
    const now = performance.now()
    rig.lookToward(resolveLook(target), animate, now, ephem, canvasAspect())
    markMoved()
  },
  lookAtMoon(animate = true): void {
    declareExposureCut('look')
    rig.lookAtMoon(animate, performance.now(), ephem, canvasAspect())
    markMoved()
  },
  /** The last frame's camera, geometry and exposure (JSON-friendly). */
  state() {
    if (!last) return null
    const x = last.exposure
    return {
      mode: rig.mode,
      caption: caption.text(),
      time: ephem.date.toISOString(),
      pose: { ...rig.pose },
      canvas: [last.cw, last.ch],
      target: [last.w, last.h],
      cam: { pos: vec(last.cam.pos), right: vec(last.cam.right), up: vec(last.cam.up), back: vec(last.cam.back), tanHalf: last.cam.tanHalf },
      sunDir: vec(ephem.sunDir),
      earthDir: vec(ephem.earthDir),
      moonAxes: { x: vec(ephem.moonX), y: vec(ephem.moonY), z: vec(ephem.moonZ) },
      phaseDeg: ephem.phaseDeg,
      subEarth: ephem.subEarth,
      subSolar: ephem.subSolar,
      earthshine: ephem.earthshine,
      exposure: {
        white: x.white, preExpose: x.preExpose, esLevel: x.esLevel, esLevelView: x.esLevelView,
        longMax: x.longMax, hdr: x.hdr, starLift: x.starLift, whiteFloored: x.whiteFloored, ...x.search,
      },
    }
  },
  /**
   * Stored values in the scene target, as the half-float store holds them:
   * among pixels with any light, the smallest channel's percentiles and how
   * many fall below half-float's smallest normal number or below 1e-3.
   * { disc: true } counts only pixels well inside the Moon's disc (no limb,
   * no stars), which is where the flush would show.
   */
  /** Debug: the scene target's centre row (max channel and alpha), every step px. */
  rowProfile(step = 8) {
    if (!last) return null
    const { w, h } = last
    const t = targets.get(w, h)
    const gl = renderer.getContext() as WebGL2RenderingContext
    renderer.setRenderTarget(t.scene)
    const px = new Float32Array(w * 4)
    gl.readPixels(0, Math.floor(h / 2), w, 1, gl.RGBA, gl.FLOAT, px)
    renderer.setRenderTarget(null)
    const out: number[][] = []
    for (let x = 0; x < w; x += step) out.push([x, px[4 * x], px[4 * x + 1], px[4 * x + 2], px[4 * x + 3]])
    return out
  },
  storedStats(opts: { disc?: boolean } = {}) {
    if (!last) return null
    const { w, h, cam } = last
    const t = targets.get(w, h)
    const gl = renderer.getContext() as WebGL2RenderingContext
    renderer.setRenderTarget(t.scene)
    const px = new Float32Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, px)
    renderer.setRenderTarget(null)
    const tpp = cam.tanHalf / (h / 2)
    const r = new THREE.Vector3()
    const onDisc = (x: number, y: number): boolean => {
      r.copy(cam.right).multiplyScalar((x + 0.5 - w / 2) * tpp).addScaledVector(cam.up, (y + 0.5 - h / 2) * tpp).sub(cam.back).normalize()
      const tc = -cam.pos.dot(r)
      return tc > 0 && cam.pos.clone().addScaledVector(r, tc).length() < 0.99
    }
    const vals: number[] = []
    let max = 0
    for (let i = 0; i < w * h; i++) {
      if (opts.disc && !onDisc(i % w, Math.floor(i / w))) continue
      const hi = Math.max(px[4 * i], px[4 * i + 1], px[4 * i + 2])
      if (hi > 0) vals.push(Math.min(px[4 * i], px[4 * i + 1], px[4 * i + 2]))
      max = Math.max(max, hi)
    }
    vals.sort((a, b) => a - b)
    const pct = (f: number) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(f * vals.length))] : null)
    return {
      nonzero: vals.length,
      belowHalfNormal: vals.filter((v) => v < 6.103515625e-5).length,
      below1e3: vals.filter((v) => v < 1e-3).length,
      p01: pct(0.01), p05: pct(0.05), p50: pct(0.5), max,
    }
  },
})

// ---------------------------------------------------------------------------
// Tours: a moment's time and camera, reached with the rig's own transitions.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Ground mode (src/ground/): the camera in the Apollo 17 lander's own metre frame. Entered from the orbital rig with the
// same position, orientation and field (no jump: ground.test.mts), left by gliding up to a pose the rig can hold.
// ---------------------------------------------------------------------------
function ensureGround(): GroundMode | null {
  if (groundMode) return groundMode
  if (!patch || patchState !== 'ready' || patchSiteId !== 'a17') return null
  groundMode = new GroundMode(renderer, moon, maps.height.lonSpan, maps.height.size[0], patch, quality.profile.lmShadowRes)
  groundMode.lmLite = lmMaterialLite(location.search, quality.detected.cls)
  groundMode.lmSelfShadow = lmSelfShadow(!!nativeHost, quality.hints.renderer, location.search)
  // The app's phone classes light the module's bounce without PMREM; every web browser keeps main's PMREM environment (unmeasured there).
  groundMode.phone = !!nativeHost && (quality.detected.cls === 'ios' || quality.detected.cls === 'ipad' || quality.detected.cls === 'phone-android')
  groundMode.onChange = markMoved
  const keepPreset = groundMode.cam.onInput
  groundMode.cam.onInput = () => { keepPreset?.(); viewpoint = null; navApi?.away(); groundStillness.noteInput(performance.now()) }
  return groundMode
}
/** Hands the camera to ground mode from wherever the orbital rig is. False when there is no Apollo 17 patch. */
/** The tile shadow cache was released for the ground view (parkTileShadowsInGround) and is rebuilt when the view closes. */
let shadowCacheParked = false
function parkShadowCache(): void {
  if (!shadowCache || !parkTileShadowsInGround(quality.detected.cls, !!nativeHost)) return
  moon.setShadowCache(null)
  shadowCache.dispose()
  shadowCache = null
  shadowCacheParked = true
}
async function unparkShadowCache(): Promise<void> {
  if (!shadowCacheParked) return
  const { ShadowCache: SC } = await import('./moon/tiles/ShadowCache')
  // Back in the ground view meanwhile, or the context or the tiles gone: stay parked (a lost context rebuilds everything anyway).
  if (groundMode?.active || !shadowCacheParked) return
  shadowCacheParked = false
  if (!tiles || contextLost || shadowCache) return
  shadowCache = new SC(renderer, moon.uniforms, tiles.capacity, maps.height.lonSpan, maps.height.size[0], tiles.deepest, tiles.parking ? tiles.heightWant : tiles.capacity)
  shadowCache.diagnostics = DEV_TOOLS
  moon.setShadowCache(shadowCache)
  markDirty()
}
function enterGround(frameCam?: ViewCamera): boolean {
  resetScrubEnding()
  declareExposureCut()
  const g = ensureGround()
  if (!g || g.active) return false
  // Hand over the camera of the frame on screen, not a fresh sample of the rig at a later clock (that was a 7 cm step at 898 m). A descent that hands
  // over in the middle of a frame passes THIS frame's rig camera (the rig has moved on from the last drawn one: that was a repeated frame).
  const cam = frameCam ?? last?.cam ?? rig.camera(ephem, canvasAspect(), performance.now())
  // The drawn camera in the body frame it was drawn in (a carry step the pacer has not drawn would move the ground under it: see `last`).
  const ephemOnScreen = !frameCam && last ? last.ephem : ephem
  targets.setDepth(true)
  rig.frozen = true
  rig.auto = false
  descent = null
  tween = null
  g.enter(ephemOnScreen, cam)
  parkShadowCache()
  trackUsage('ground_enter', { site: patchSiteId, mode: g.cam.mode === 'walk' ? 'walk' : 'eye' })
  // The lunar module loads once (0.7 MB) and is placed on the ground when the first ground frame has been drawn.
  void g.loadLm(ephem, canvasAspect()).catch((e) => console.warn('Lunar module unavailable:', (e as Error).message))
  markMoved()
  return true
}
/**
 * Back to the orbital rig: at once (silent), or by gliding up to a pose the rig can hold and handing over there. `overSite`: the climb ‹ makes from the
 * Apollo 17 ground (navigator 'orbit', #10) and the way out of a panorama opened from orbit: one glide up over the module, then the rig holds it. A
 * panorama still waiting for a journey's arrival is dropped: leaving the ground is leaving that journey.
 */
function leaveGround(silent = false, after?: () => void, overSite = false): void {
  resetScrubEnding()
  declareExposureCut()
  const g = groundMode
  if (!g?.active) return
  if (!silent) trackUsage('ground_exit', { site: patchSiteId, mode: g.cam.mode === 'walk' ? 'walk' : 'eye' })
  clearPendingPanorama()
  const finish = (): void => {
    viewpoint = null
    declareExposureCut()
    const cam = g.viewCamera(ephem)
    g.leave()
    void unparkShadowCache()
    targets.setDepth(false)
    rig.frozen = false
    const fov = 2 * Math.atan(cam.tanHalf) * 180 / Math.PI
    rig.fovDeg = canvasAspect() >= 1 ? fov : 2 * Math.atan(cam.tanHalf * canvasAspect()) * 180 / Math.PI
    rig.setPose(poseFromView(ephem, cam))
    markMoved()
    after?.()
  }
  if (silent) { finish(); return }
  const v = g.cam.view
  const floorZ = (rig.floorAt(g.frame.lonDeg, g.frame.latDeg) - 1) * MOON_R_KM * 1000 - g.frame.h0M
  const target = { ...v, pos: v.pos.clone(), pitchDeg: Math.min(v.pitchDeg, -20), rollDeg: 0, tanHalf: Math.tan(FLY_FOV_DEG * Math.PI / 360) }
  target.pos.z = Math.max(v.pos.z, floorZ + 5)
  if (overSite) {
    // Closing a panorama: one glide from where the visitor stands up over the module, looking down on the landing zone, then the rig holds it.
    target.pos = new THREE.Vector3(0, 0, g.groundZ(0, 0) + OVER_SITE_M)
    target.pitchDeg = -89
    g.cam.setMode('fly')
    g.cam.glideTo(target, performance.now(), OVER_SITE_MS, finish, new THREE.Vector3(0, 0, 0))
    markMoved()
    return
  }
  g.cam.glideTo(target, performance.now(), 1800, finish)
  markMoved()
}
/** The overhead landing-zone view a closed panorama flies out to (metres above the site) and the length of that one move. */
const OVER_SITE_M = 2000
const OVER_SITE_MS = 3200
/** Closing a panorama: fly back out and show the landing zone from the top. From the ground view it is one glide up; from the orbital rig one planned fly-to. Never a cut. */
function flyOutOverSite(): void {
  if (patchSiteId !== 'a17') return
  if (groundMode?.active) { leaveGround(false, () => navApi?.away(), true); return }
  if (!patch || patchState !== 'ready') return
  const { lon, lat } = siteLonLat()
  const dist = 1 + rig.groundAt(lon, lat) + OVER_SITE_M / (MOON_R_KM * 1000)
  flyTo({ pose: { lon, lat, dist, roll: 0, pitch: 0 }, fovDeg: FLY_FOV_DEG, aimShift: 0, aimShiftX: 0, look: 0 }, performance.now(), OVER_SITE_MS)
  navApi?.away()
  markMoved()
}

/** The ground landing a tour asked for (Moment.groundEnd), begun when its descent reaches the floor. */
let pendingLanding: 'hover' | 'eye' | null = null
/** The tour that asked for the landing is a pin (Moment.fixed): the glide to the ground view is short. */
let pendingFixed = false
/** The ground viewpoint on screen ('Beside the module' or 'Eye level'), or null when the visitor has moved off both. */
let viewpoint: 'hover' | 'eye' | null = null
/** The view a landing ends in, in the lunar module's frame: 'hover' is 30 m north-west of it and 10 m up looking at it; 'eye' is 20 m from the south-west pad at 1.7 m. */
function landingView(kind: 'hover' | 'eye', g: GroundMode): import('./ground/frame').GroundView {
  const lmZ = g.lm ? g.lm.placement.z : 0
  const toward = (from: THREE.Vector3, to: THREE.Vector3): { headingDeg: number; pitchDeg: number } => {
    const d = to.clone().sub(from)
    return { headingDeg: Math.atan2(d.x, d.y) * 180 / Math.PI, pitchDeg: Math.atan2(d.z, Math.hypot(d.x, d.y)) * 180 / Math.PI }
  }
  if (kind === 'hover') {
    const e = -21.2, n = 21.2
    const pos = new THREE.Vector3(e, n, g.groundZ(e, n) + 10)
    return { pos, ...toward(pos, new THREE.Vector3(0, 0, lmZ + 2.4)), rollDeg: 0, tanHalf: Math.tan(25 * Math.PI / 180) }
  }
  const pads = g.lm ? g.lm.pads.map((p) => (g.lm as NonNullable<GroundMode['lm']>).toFrame(p)) : [new THREE.Vector3(-2, -2, 0)]
  const pad = pads.reduce((a, b) => (a.x + a.y < b.x + b.y ? a : b))
  const dir = new THREE.Vector3(pad.x, pad.y, 0).normalize()
  const e = pad.x + dir.x * 20, n = pad.y + dir.y * 20
  const pos = new THREE.Vector3(e, n, g.groundZ(e, n) + 1.7)
  return { pos, ...toward(pos, new THREE.Vector3(pad.x, pad.y, pad.z + 0.6)), rollDeg: 0, tanHalf: Math.tan(25 * Math.PI / 180) }
}
/** Hands over to ground mode at the end of a descent and glides to the tour's ending beside the module. */
function beginLanding(kind: 'hover' | 'eye', instant: boolean, carry?: { cam: ViewCamera; v: THREE.Vector3; pitchRate: number }): void {
  declareExposureCut()
  const fixed = pendingFixed
  pendingFixed = false
  if (!enterGround(carry?.cam)) return
  const g = groundMode as GroundMode
  const generation = journey.state?.generation
  if (generation !== undefined) journey.sample(generation, 'ground-arrival', 0.9)
  approachFor = journey.state?.id ?? null
  void g.loadLm(ephem, canvasAspect()).then(() => {
    if (!g.active || generation === undefined || !journey.current(generation)) return
    const to = landingView(kind, g)
    const done = (): void => { approachFor = null; viewpoint = kind; if (generation !== undefined) journey.arrive(generation, performance.now()); if (kind === 'eye') g.cam.setMode('walk'); markMoved() }
    if (instant) { g.cam.view = to; done() }
    else if (carry && fixed) {
      // The descent handed over still moving: the glide leaves with its velocity and eases out to the eye pose (no stop at the join).
      const ms = arrivalGlideMs(to.pos.distanceTo(g.cam.view.pos), carry.v.length())
      g.cam.glideTo(to, performance.now(), ms, done, undefined, carry.v, carry.pitchRate)
    } else g.cam.glideTo(to, performance.now(), fixed ? FIXED_GLIDE_MS : kind === 'eye' ? 14000 : 11000, done)
    markMoved()
  }).catch((err) => {
    console.warn('Lunar module unavailable:', (err as Error).message)
    lmLoadFailed = true
    if (generation !== undefined && journey.current(generation)) { approachFor = null; journey.fail(generation) }
    // The visitor is already in ground mode at the hand-over camera: say what is missing and offer the retry (a glide to the view follows it).
    if (g.active) showLmFailure(g, kind)
  })
}
/** The lunar module's model did not load: the ground view stands without it. Set by beginLanding, cleared when a load succeeds. */
let lmLoadFailed = false
function showLmFailure(g: GroundMode, kind: 'hover' | 'eye'): void {
  caption.show('The lunar module did not load', 'Your connection may have dropped.', { label: 'Try again', run: () => {
    caption.clear()
    void g.loadLm(ephem, canvasAspect()).then(() => {
      lmLoadFailed = false
      if (!g.active) return
      viewpoint = kind
      g.preset = null
      g.cam.glideTo(landingView(kind, g), performance.now(), undefined, () => { if (kind === 'eye') g.cam.setMode('walk'); markMoved() })
      markMoved()
    }).catch(() => { if (g.active) showLmFailure(g, kind) })
  } }, true)
}

/** The ground view's two viewpoints on the bar: 'Beside the module' (the hover view) and 'Eye level' (1.7 m up, 20 m from a pad). A short glide, never a cut. */
function goViewpoint(kind: 'hover' | 'eye'): void {
  const g = groundMode
  if (!g?.active || !g.lm || flight) return
  declareExposureCut()
  viewpoint = kind
  g.preset = null
  // Walking pins the camera to eye height: fly while it moves, walk once it is there (the eye view).
  g.cam.setMode('fly')
  g.cam.glideTo(landingView(kind, g), performance.now(), undefined, () => { if (kind === 'eye') g.cam.setMode('walk'); markMoved() })
  if (kind === 'eye') navApi?.noteSelected({ kind: 'ground', id: 'eye' })
  else navApi?.noteSelected({ kind: 'pin', id: 'pin-apollo17' })
  markMoved()
}

// ---------------------------------------------------------------------------
// The powered-descent flight (src/descent/): the Apollo 17 track on the real 1972 clock. main.ts owns the clock, the ground mode hand-over
// and the drawing; DescentFlight owns the geometry. Orbit regime: the Moon pass draws the ground and the module is drawn over it; ground
// regime: ground mode draws both. The hand-off to the free ground camera is at the end of the track (HANDOFF_T).
// ---------------------------------------------------------------------------
let flightPath: DescentPath | null = null
let flightHeldByStop = false

async function startFlight(seq: number): Promise<void> {
  moonSurfaceTurn.stopInertia()
  declareExposureCut()
  const g = ensureGround()
  if (!g) return
  flightPath ??= await DescentPath.load()
  if (seq !== playSeq) return
  if (groundMode?.active) { leaveGround(false, () => { void startFlight(seq) }); return }
  const path = flightPath
  const aspect = canvasAspect(), now = performance.now()
  // A fly view over the site to blend from (the Earth view is 400,000 km away).
  const startCam = last?.cam ?? rig.camera(ephem, aspect, now)
  declareExposureCut()
  time = new Date(path.utcMsAt(HANDOVER_T))
  live = false
  ephem = clockSet(time)
  flightEphemMs = path.utcMsAt(HANDOVER_T)
  await g.loadLm(ephem, aspect).catch((e) => console.warn('Lunar module unavailable:', (e as Error).message))
  if (seq !== playSeq || !g.lm) return
  targets.setDepth(true)
  rig.frozen = true
  rig.auto = false
  descent = null
  tween = null
  settle = null
  flight = new DescentFlight(path)
  flightHeldByStop = false
  flight.begin(startCam, performance.now())
  flightFrame = null
  stepFlight(performance.now(), 0)
  markMoved()
}
// Keep the archived flight implementation available in source without a visitor entry point.
void startFlight

/** Ends the flight. Silent (another moment starts): back to the rig at once. Otherwise the camera stays where the flight left it, in ground mode when it is there. */
function stopFlight(silent: boolean): void {
  declareExposureCut()
  const f = flight
  if (!f) return
  const fr = flightFrame
  flight = null
  flightHeldByStop = false
  flightFrame = null
  flightEphemMs = -1
  const g = groundMode
  g?.lm?.setPlume(false, 0)
  if (g?.lm) g.placeLm()
  settle = !silent && f.ended && g?.active && g.lm ? { path: f.path, t: HANDOFF_T } : null
  if (!silent && g?.active) { g.cam.view = fr ? fr.view : g.cam.view; g.preset = null }
  if (g?.active && silent) { g.leave(); void unparkShadowCache(); targets.setDepth(false); rig.frozen = false }
  else if (!g?.active) {
    targets.setDepth(false)
    rig.frozen = false
    if (fr) {
      rig.settle(ephem, canvasAspect(), performance.now(), fr.cam)
      tween = null
    }
  }
  markMoved()
}

function stepFlight(now: number, dt: number): boolean {
  const f = flight, gm = groundMode
  if (!f || !gm || flightHeldByStop) return false
  f.advance(dt)
  const ms = f.path.utcMsAt(f.t)
  if (Math.abs(ms - flightEphemMs) > 200) { time = new Date(ms); ephem = clockSet(time); flightEphemMs = ms }
  const ready = !!gm.lm
  const fr = f.evaluate({
    axes: gm.axesAt(ephem), rs: siteRadius(gm.frame.h0M), nowMs: now,
    groundZ: ready ? (e, n) => { const z = gm.groundZ(e, n); return z < -1e5 ? null : z } : null,
  })
  flightFrame = fr
  // The end of the track: the camera passes to the free ground camera where it is.
  if (f.ended && fr.regime === 'ground' && gm.active) { stopFlight(false); return true }
  if (fr.regime === 'ground' && !gm.active) { gm.enter(ephem, fr.cam); gm.preset = null; parkShadowCache() }
  else if (fr.regime === 'orbit' && gm.active) { gm.leave(); void unparkShadowCache() }
  return true
}

/** The module still dropping to its pads after the camera was released: the track's pose, blended into G1's placement over the last SETTLE_BLEND_S so nothing pops. */
function applySettle(gm: GroundMode, st: { path: DescentPathT; t: number }, preExpose: number, targetH: number, aspect: number): void {
  const lm = gm.lm
  if (!lm) return
  const s = st.path.sample(st.t)
  const g = gm.groundZ(s.pos[0], s.pos[1])
  const off = g > -1e5 ? g + (s.pos[0] ** 2 + s.pos[1] ** 2) / (2 * siteRadius(gm.frame.h0M)) : 0
  const pose = lmPoseOf(s, off)
  const x = Math.max(0, Math.min(1, (st.t - (SETTLE_END_T - SETTLE_BLEND_S)) / SETTLE_BLEND_S))
  gm.setSettle(pose.pos, pose.quat, x * x * (3 - 2 * x))
  lm.dust.update({ tSim: s.t, centre: new THREE.Vector3(s.pos[0], gm.groundZ(s.pos[0], s.pos[1]), -s.pos[1]), groundY: gm.groundZ(s.pos[0], s.pos[1]), index: s.dust, exposure: preExpose, resPx: new THREE.Vector2(targetH * aspect, targetH) })
}
function stepSettle(dt: number): void {
  if (!settle) return
  const gm = groundMode
  if (!gm?.active || !gm.lm || flight) { settle = null; return }
  settle.t += dt
  if (settle.t >= SETTLE_END_T) {
    settle = null
    gm.placeLm()
    gm.lm.dust.mesh.visible = false
  }
  markMoved()
}

/** Poses the module and its dust for this frame's flight state (the exposure is only known at render time). */
function applyFlightToModule(gm: GroundMode, fr: FlightFrame, preExpose: number, targetH: number, aspect: number, ground: boolean): void {
  const lm = gm.lm
  if (!lm) return
  const s = fr.sample
  if (ground) gm.setFlight(fr.lm.pos, fr.lm.quat, s.padAlt < 3)
  lm.setPlume(flightPlume, s.engine === 'off' || s.engine === 'coast' || s.engine === 'ullage' ? 0 : s.throttleOfFtp)
  const rb = ground ? new THREE.Vector3() : fr.view.pos
  if (!ground) lm.setFlightPose(fr.lm.pos, fr.lm.quat, rb)
  // The dust sheet: only in the ground regime (it lives in the last 110 ft), on the ground under the module, in three's axes.
  const gz = ground ? gm.groundZ(s.pos[0], s.pos[1]) : 0
  lm.dust.update({
    tSim: s.t, centre: new THREE.Vector3(s.pos[0] - rb.x, gz - rb.z, -(s.pos[1] - rb.y)), groundY: gz - rb.z,
    index: ground ? s.dust : 0, exposure: preExpose, resPx: new THREE.Vector2(targetH * aspect, targetH),
  })
}

const pad2 = (n: number): string => String(n).padStart(2, '0')
const clockText = (sec: number): string => { const s = Math.floor(sec); return `${Math.floor(s / 3600)}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}` }
function flightHud(fr: FlightFrame): NonNullable<HudInfo['flight']> {
  const f = flight as DescentFlight, s = fr.sample
  const gm = groundMode as GroundMode
  const sun = enuDir(gm.axesAt(ephem), ephem.sunDir)
  const alsjS = 406193 + s.t
  const d = new Date(s.utcMs)
  return {
    get: clockText(alsjS), utc: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`, t: s.t, rate: f.speed(), paused: !f.playing,
    regime: fr.regime, cam: f.camMode,
    altM: s.altAgl, altProv: s.prov.alt, altBandM: s.unc.alt,
    vHorizMs: Math.hypot(s.vel[0], s.vel[1]), vHorizProv: s.prov.vh, vHorizBandMs: s.unc.vH,
    vRateMs: s.vel[2], vRateProv: s.prov.vv,
    engine: s.engine, attKnown: s.attitudeKnown, psiDeg: s.psiDeg, attProv: s.prov.att, attBandDeg: s.unc.attDeg,
    dust: s.dust, sunElDeg: Math.asin(sun.z) * 180 / Math.PI, sunAzDeg: (Math.atan2(sun.x, sun.y) * 180 / Math.PI + 360) % 360,
    origin: gm.origin, plume: flightPlume, blending: fr.blending, coasting: s.t < 0,
  }
}
function updateFlightUi(): void {
  const f = flight
  if (f && f.camMode === 'window' && !windowAvailable(f.path.sample(f.t).altAgl)) f.camMode = 'chase'
}

const smooth = smoothstep
/** The scripted fly-to now under way (journey/path.ts plans it), or null. */
type ScriptedTween = FlyTween & { recoverLook: boolean; floorDist: number; endBaseDist: number; endWasFloorBound: boolean; floorBlend: FloorBlend | null; lastShownDist: number; prefetchAt: number; /** v2: the frame time its clock last advanced to (feelBackstop). */ stepAt: number }
/** The cinematic flight the visitor last left, and the progress it was at (for the pill's Return). */
let flightLeft: FlightLeft | null = null
/** The progress the flight being started begins at: 0, or where Return found the visitor had left it. */
let flightStartU = 0
let cinematicFlight: { definition: CinematicFlight; startU: number; t0: number; generation: number; prefetchAt: number; /** Held at this progress by the slider's pause button, or null while it plays. */ pausedU: number | null; handle: JourneyHandle | null; /** Mean speeds it starts at after a fly-to that ends at that speed (journey/join.ts); 0 or absent: from rest. */ lead?: number; /** The previous frame's clock, for the stall guard (journey/join.ts stallShift). */ lastNow?: number; /** The eclipse flight's gaze is on the Sun now (sunLookNow). */ sunLook?: boolean; /** Sharp's "Preparing the flight" beat (sharpPrep.ts), set by playMoment; prepCam is the camera the streamer is fed while it holds. */ prep?: FlightPrep; prepCam?: ViewCamera | null; /** The hand-over's offset from the pose on screen to the flight's first sample, fading out (journey/joinFix.ts); null once spent, undefined before the first sample. */ joinFix?: JoinFix | null } | null = null
/** The waiting cinematic flight's path as prefetch targets (sharp only), built once per flight and canvas height. */
let cinematicAhead: { flight: object; heightPx: number; targets: PrefetchTarget[] } | null = null
function cinematicAheadTargets(): PrefetchTarget[] {
  const cin = cinematicFlight
  if (!cin || cin.t0 >= 0) return []
  const heightPx = canvasHeightPx()
  if (cinematicAhead?.flight !== cin || cinematicAhead.heightPx !== heightPx) {
    const startU = cin.startU
    cinematicAhead = { flight: cin, heightPx, targets: buildFlightPrefetchTargets((v) => {
      const shot = sampleFlight(cin.definition, startU + (1 - startU) * v, ephem, (lon, lat) => rig.floorAt(lon, lat), (lon, lat) => rig.groundAt(lon, lat), cin.lead ?? 0)
      return { pose: shot.pose, fovDeg: shot.fovDeg }
    }, (1 - startU) * cin.definition.seconds * 1000, { aspect: canvasAspect(), heightPx, texels: sharpFlightTexels(true) }) }
  }
  return cinematicAhead.targets
}
/** Texels per pixel a streamer view wants its levels at under a sharp flight (WANT_TEXELS_FLIGHT), else undefined: the beat and the flight proper, not the approach, a paused flight or the end dwell. */
function sharpFlightTexels(prefetch = false): number | undefined {
  const cin = cinematicFlight
  return quality.sharp.on && cin && (prefetch || !tween) && cin.pausedU == null ? WANT_TEXELS_FLIGHT : undefined
}
/** The camera at flight progress `u`, without touching the rig (the lookahead rig, as the exposure's lookahead does). */
function flightCamAt(cin: NonNullable<typeof cinematicFlight>, u: number): ViewCamera {
  const shot = sampleFlight(cin.definition, u, ephem, (lon, lat) => rig.floorAt(lon, lat), (lon, lat) => rig.groundAt(lon, lat), cin.lead ?? 0)
  aheadRig.dMin = rig.dMin; aheadRig.site = rig.site
  aheadRig.setPose(shot.pose)
  aheadRig.fovDeg = shot.fovDeg
  aheadRig.aimShift = 0
  aheadRig.aimShiftX = 0
  aheadRig.setLookBlend(shot.look, flightAim(shot, ephem))
  return aheadRig.camera(ephem, canvasAspect(), performance.now())
}
/** The streamer's view for a camera (the fields render() gives it, a flight under sharp). */
function flightStreamView(cam: ViewCamera): StreamView {
  return {
    pos: cam.pos, right: cam.right, up: cam.up, back: cam.back, tanHalf: cam.tanHalf, aspect: canvasAspect(), tanPerPx: cam.tanHalf / (canvasHeightPx() / 2),
    moonX: ephem.moonX, moonY: ephem.moonY, moonZ: ephem.moonZ, moving: false, flight: true, flightReuse: true, flightId: currentWantedFlightId(), texels: WANT_TEXELS_FLIGHT,
  }
}
/**
 * One timed off-screen draw of the Moon pass at `grid` of the canvas from `cam`, into the scene target, nothing presented (the next real frame sets every
 * uniform and mode this touches again). Wall time between two gl.finish() calls: the disjoint timer query and the fence path belong to the frame loop's
 * own frames. null: could not draw. 0: an untimed settle draw (target allocation, program warm-up).
 */
/** A warm-up draw may have overwritten the rest scene target (grid 1 shares its size): no final-only/banded frame may reuse it, the next presented frame is a full redraw of the real pose. */
function voidSceneReuse(): void {
  fadeOnly = null
  bandState = null
  markDirty()
}
function warmDraw(cam: ViewCamera, grid: number, timed: boolean): number | null {
  const gl = renderer.getContext() as WebGL2RenderingContext
  try {
    const w = Math.max(64, Math.round(canvas.width * grid)), h = Math.max(64, Math.round(canvas.height * grid))
    const sceneRt = targets.warmScene(w, h) // never targets.get: three grids would evict the rest/gesture sets
    const m = cameraMatrices(cam, w, h)
    ;(common.uInvViewProj.value as THREE.Matrix4).copy(m.invViewProj)
    ;(common.uCamPos.value as THREE.Vector3).copy(cam.pos)
    ;(common.uResolution.value as THREE.Vector2).set(w, h)
    common.uPreExpose.value = last?.exposure.preExpose ?? common.uPreExpose.value
    moon.setMotion(true)
    moon.setGridFrame(grid < 1)
    moon.setTermAA(termAaFactor(termAaParam, grid, true))
    moon.setMotionCaps(motionCapsOn || MOTION_LITE_FORCED || wallLadder.lite, phoneMotionOn() ? MOTION_TERRAIN_ITER : undefined)
    moon.update(ephem, cam.tanHalf / (h / 2), cam.tanHalf / (canvas.height / 2))
    gl.finish()
    const t0 = performance.now()
    renderer.setRenderTarget(sceneRt)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, false, false)
    moon.render(renderer)
    gl.finish()
    const ms = performance.now() - t0
    renderer.setRenderTarget(null)
    return timed ? ms : 0
  } catch {
    renderer.setRenderTarget(null)
    return null
  }
}
/** What __moon.perf reports of the beat and the measured grid. */
const prepStats = { plays: 0, lastMs: 0, lastBy: '', lastResidency: null as number | null, probes: 0, lastCold: false }
let sharpWarmLast: { flight: string; ms: Array<[number, number]>; source: 'measured' | 'table'; grid: number | null } | null = null
let prepsDone = 0
function sharpPerf(): Record<string, unknown> {
  const id = cinematicFlight?.definition.id ?? sharpWarmLast?.flight
  return { sharpWarmMs: sharpWarmLast ? Object.fromEntries(sharpWarmLast.ms.map(([g, ms]) => [g, +ms.toFixed(1)])) : null, sharpGridSource: sharpGridSource(id), sharpPrep: { ...prepStats, phase: cinematicFlight?.prep?.phase ?? null } }
}
/** The beat's frame: stream the path's first third, read its residency, then the warm-up draws. true: the camera still holds the start pose. */
function stepFlightPrep(cin: NonNullable<typeof cinematicFlight>, now: number): boolean {
  const prep = cin.prep!
  const us = prepPoseUs(cin.startU)
  if (!TILE_BASE || tilesState === 'failed') prep.cancel(now)
  else {
    if (!prep.started) { prep.begin(now); void prefetchFlight(cinematicAheadTargets()) }
    const pi = prep.probeDue(now)
    if (pi !== null && tiles) {
      const r = tiles.exactResidency(flightStreamView(flightCamAt(cin, us[pi])))
      prep.observe(pi, r.wanted, r.resident)
      prepStats.probes++
    }
    if (prep.phase === 'warm' && prep.warm) {
      const step = prep.warm.next()
      if (step) {
        prep.warm.record(warmDraw(flightCamAt(cin, warmPoseUs(cin.startU)[step.pose]), step.grid, step.timed))
        voidSceneReuse()
      }
    }
    prep.advance(now)
  }
  if (prep.phase !== 'done') {
    cin.prepCam = prep.phase === 'stream' ? flightCamAt(cin, us[prep.poseIndex(now)]) : null
    rig.lastInputAt = now
    journey.sample(cin.generation, 'loading', prep.progress(now))
    notifyProgress()
    return true
  }
  cin.prepCam = null
  cin.prep = undefined
  targets.releaseScratch()
  prepsDone++
  prepStats.plays++; prepStats.lastMs = Math.round(prep.endedAt); prepStats.lastBy = prep.endedBy ?? ''; prepStats.lastResidency = prep.residency(); prepStats.lastCold = prep.cold
  const r = prep.warm?.result()
  if (r) {
    sharpWarmLast = { flight: cin.definition.id, ms: r.ms, source: r.source, grid: r.grid }
    if (r.grid !== null) {
      setMeasuredGrid(cin.definition.id, r.grid)
      flightScaleController.reset(sharpFlightGrid(quality.detected.cls, cin.definition.id))
    }
  }
  notifyProgress(true)
  return false
}
/** Hand-over gaps over JOIN_GAP_REPORT (journey/joinFix.ts), newest last; `__moon.joinGaps` in dev builds. */
const joinGaps: Array<{ flight: string; gap: number; at: number }> = []
if (DEV_TOOLS) (api as unknown as { joinGaps: typeof joinGaps }).joinGaps = joinGaps
/** Fly the authored route only after its approach arrives; a new gesture cancels the same journey. */
function stepCinematic(now: number): boolean {
  const flight = cinematicFlight
  if (!flight) return false
  if (!journey.current(flight.generation)) { cinematicFlight = null; cancelFlightPrefetch(); targets.releaseScratch(); return false }
  if (flight.t0 < 0 && flight.prep && stepFlightPrep(flight, now)) return true
  if (flight.t0 < 0) { flight.t0 = journeyClockStart(now, flight.lead ? joinHandOverAt : null, flight.startU, flight.definition.seconds); joinHandOverAt = null; if (flight.definition.kind === 'eclipse') declareExposureCut('event') }
  // A stalled frame (shader compile, tile upload) does not run the flight's clock over it: it resumes where it was.
  // Not under a held slider: the hold has just put the clock where the finger is, and a shift would draw the frame behind it.
  if (flight.pausedU == null && !scrub.held) { flight.t0 += stallShift(flight.lastNow ?? null, now); flight.lastNow = now } else flight.lastNow = now
  // Held by the slider's pause button: the clock is moved on with the wall clock so the progress stands still.
  if (flight.pausedU != null) flight.t0 = now - flight.pausedU * flight.definition.seconds * 1000
  const u = Math.min(1, Math.max(0, (now - flight.t0) / (flight.definition.seconds * 1000)))
  if (TILE_BASE && now - flight.prefetchAt >= 500) {
    flight.prefetchAt = now
    const startU = u
    void prefetchFlight(buildFlightPrefetchTargets((v) => {
      const shot = sampleFlight(flight.definition, startU + (1 - startU) * v, ephem, (lon, lat) => rig.floorAt(lon, lat), (lon, lat) => rig.groundAt(lon, lat), flight.lead ?? 0)
      return { pose: shot.pose, fovDeg: shot.fovDeg }
    }, (1 - startU) * flight.definition.seconds * 1000, { aspect: canvasAspect(), heightPx: canvasHeightPx(), texels: sharpFlightTexels(true) }))
  }
  const shot = sampleFlight(flight.definition, u, ephem, (lon, lat) => rig.floorAt(lon, lat), (lon, lat) => rig.groundAt(lon, lat), flight.lead ?? 0)
  // The first sample: the gap from the pose on screen (the fly-to's end, planned to a start that a lowered floor may have moved since) fades out.
  if (flight.joinFix === undefined) {
    flight.joinFix = joinFixFor(rig.pose, rig.fovDeg, shot.pose, shot.fovDeg, u, JOIN_FIX_MS / (flight.definition.seconds * 1000))
    // A large gap is a planning error the fade hides: keep it visible (the tap-jump rig job reads __moon.joinGaps).
    const gap = flight.joinFix ? joinGap(flight.joinFix, shot.pose.lat) : 0
    if (gap > JOIN_GAP_REPORT) { joinGaps.push({ flight: flight.definition.id, gap: +gap.toFixed(4), at: Math.round(now) }); if (DEV_TOOLS) console.info(`flight hand-over gap ${flight.definition.id}: ${(gap * 100).toFixed(1)} % of the distance (faded over ${JOIN_FIX_MS} ms)`) }
  }
  if (flight.joinFix) {
    const j = applyJoinFix(flight.joinFix, shot.pose, shot.fovDeg, u)
    shot.pose = j.pose
    shot.fovDeg = j.fovDeg
    if (j.done) flight.joinFix = null
  }
  rig.setPose(shot.pose)
  rig.fovDeg = shot.fovDeg
  rigLook = shot.look
  rig.setLookBlend(shot.look, flightAim(shot, ephem))
  flight.sunLook = sunGaze(shot)
  rig.lastInputAt = now
  journey.sample(flight.generation, 'cinematic', u)
  if (u >= 1) {
    // A flight may finish while looking at a moving body (the eclipse ends on the Earth). Preserve that last view, then release the body tracker so
    // the next drag or zoom belongs to the visitor instead of continuing to orbit the flight's subject.
    const endAspect = canvasAspect()
    rig.settle(ephem, endAspect, now, rig.camera(ephem, endAspect, now))
    rigLook = 0
    cinematicFlight = null
    cancelFlightPrefetch()
    journey.arrive(flight.generation, now)
  }
  return true
}
let tween: ScriptedTween | null = null
/** v2: the pose rate a fly-to had when stopMoments ended it, and when (flyTo uses it only within the same event). */
let handOffRate: { rate: FlyRate; at: number; pose?: Pose; fov?: number } | null = null
type FlyRate = { lon: number; lat: number; dist: number; roll: number; pitch: number; fov: number }
/** v2: the clock of the camera on screen (the last drawn frame's). */
function shownClock(now: number): number {
  // However old the last drawn frame (an event in a hitch or after a hidden tab): the move continues from the pose on screen, and its first frame is held to
  // FEEL_MAX_STEP_MS by the backstop (feelBackstop), as the running move's would have been. Sampling at `now` put it the whole gap ahead of the picture.
  return FLIGHT_FEEL && now - lastCamAt >= 0 ? lastCamAt : now
}
/** A running fly-to's rates at `now`, per second: pose, roll, pitch and lens (the whole velocity a retarget must carry on). */
function tweenRate(tw: ScriptedTween, now: number): FlyRate {
  const A = tweenAt(tw, now), B = tweenAt(tw, now + 16), a = A.pose, b = B.pose
  return { lon: wrapLon(b.lon - a.lon) / 0.016, lat: (b.lat - a.lat) / 0.016, dist: (b.dist - a.dist) / 0.016, roll: (b.roll - a.roll) / 0.016, pitch: ((b.pitch ?? 0) - (a.pitch ?? 0)) / 0.016, fov: (B.fov - A.fov) / 0.016 }
}
/** v2: the pose of the last two DRAWN frames, for the speed the picture had when something other than a fly-to (an orbit, a flight, a coasting spin) is stopped. */
let drawnPrev: { at: number; pose: Pose; fov: number } | null = null
let drawnCur: { at: number; pose: Pose; fov: number } | null = null
function recordDrawnPose(at: number): void {
  if (drawnCur && at - drawnCur.at < 1) return
  drawnPrev = drawnCur
  drawnCur = { at, pose: { ...rig.pose }, fov: rig.fovDeg }
}
/** Below these the picture is at rest for a hand-off (degrees, radii, degrees per second): a carried zero speed would only move the move's clock back. */
const DRAWN_REST = 1e-3
/** Rates no camera can make (deg/s of surface travel; radii/s for the distance): a larger one between two drawn frames is not motion. */
const DRAWN_MAX = { surface: 60, dist: 40, roll: 360, pitch: 180, fov: 100 }
/** The least cos(latitude) a longitude rate is divided by: at a pole a degree of longitude is no distance, and the rate would be unbounded. */
const DRAWN_COS_FLOOR = 0.02
/**
 * v2: the speed the picture on screen had (the last two drawn frames), or null when it stood still or the frames are not recent. The surface velocity comes from the
 * two camera positions on the sphere (continuous across a pole, where longitude is relabelled by about 180 deg), as east and north rates at the drawn pose; the roll
 * rate is the wrapped change, and zero where that change is a relabel (more than DRAWN_MAX.roll).
 */
function drawnRate(now: number): { rate: FlyRate; at: number; pose: Pose; fov: number } | null {
  if (!FLIGHT_FEEL || !drawnPrev || !drawnCur) return null
  const dt = (drawnCur.at - drawnPrev.at) / 1000
  if (now - drawnCur.at < 0 || now - drawnCur.at >= 100 || dt <= 0 || dt > 0.1) return null
  const a = drawnPrev.pose, b = drawnCur.pose, D = Math.PI / 180
  const dir = (p: Pose): [number, number, number] => [Math.cos(p.lat * D) * Math.cos(p.lon * D), Math.cos(p.lat * D) * Math.sin(p.lon * D), Math.sin(p.lat * D)]
  const u0 = dir(a), u1 = dir(b)
  const d = [u1[0] - u0[0], u1[1] - u0[1], u1[2] - u0[2]]
  const sl = Math.sin(b.lat * D), cl = Math.cos(b.lat * D), so = Math.sin(b.lon * D), co = Math.cos(b.lon * D)
  const east = (-so * d[0] + co * d[1]) / D / dt, north = (-sl * co * d[0] - sl * so * d[1] + cl * d[2]) / D / dt
  const roll = wrapLon(b.roll - a.roll) / dt
  const rate = { lon: east / Math.max(DRAWN_COS_FLOOR, cl), lat: north, dist: (b.dist - a.dist) / dt, roll: Math.abs(roll) > DRAWN_MAX.roll ? 0 : roll, pitch: ((b.pitch ?? 0) - (a.pitch ?? 0)) / dt, fov: (drawnCur.fov - drawnPrev.fov) / dt }
  if (Math.hypot(east, north) > DRAWN_MAX.surface || Math.abs(rate.dist) > DRAWN_MAX.dist || Math.abs(rate.pitch) > DRAWN_MAX.pitch || Math.abs(rate.fov) > DRAWN_MAX.fov) return null
  if (Math.max(Math.hypot(east, north), Math.abs(rate.dist), Math.abs(rate.roll), Math.abs(rate.pitch), Math.abs(rate.fov)) < DRAWN_REST) return null
  return { rate, at: drawnCur.at, pose: { ...drawnCur.pose }, fov: drawnCur.fov }
}
/** v2: a running fly-to that is about to be dropped (an afterLoad re-plan) hands its speed to the fly-to planned in this same event. */
function rememberTweenRate(): void {
  if (!FLIGHT_FEEL || !tween) return
  const at = shownClock(performance.now())
  // The pose it shows at that clock goes with the rate (flyTo starts there, not at rig.pose, which a step the frame did not draw leaves one step ahead).
  const s = tweenAt(tween, at)
  const dist = tween.floorBlend ? sampleEffectiveFloorState(s.pose.dist, tween.floorDist, tween.floorBlend, at, tween.endWasFloorBound, tween.endBaseDist).dist : s.pose.dist
  handOffRate = { rate: tweenRate(tween, at), at, pose: { ...s.pose, dist }, fov: s.fov }
}
/** The frame on which the fly-to that ends at speed drew its last pose: the flight or orbit it hands over to starts its clock there, so its first frame moves on (journey/join.ts journeyClockStart). */
let joinHandOverAt: number | null = null
let wantedFlightOwner: unknown = null
let wantedFlightId = 0
function currentWantedFlightId(): number {
  const owner = tween ?? cinematicFlight ?? null
  if (owner !== wantedFlightOwner) { wantedFlightOwner = owner; wantedFlightId++ }
  return wantedFlightId
}
/** Where the look is: 0 the Moon's centre, 1 the Earth (the end of the last fly-to, or the blend now). */
let rigLook = 0

/** Applies the subject controls shared by live and captured tween samples. */
function applyTweenSubject(tw: ScriptedTween, sample: { aim: number; aimX: number; look: number }): void {
  if (!layoutAimOn || homeAimMinimal) { rig.aimShift = sample.aim; rig.aimShiftX = sample.aimX }
  if (tw.recoverLook) {
    rigLook = sample.look
  } else if (tw.plan.from.look !== tw.plan.to.look || rigLook > 0) {
    rig.setLookBlend(sample.look, resolveLook('earth'))
    rigLook = sample.look
  }
}

/** Debug (__moon.tweenHold): hold a running fly-to at this progress, 0 to 1, for frame-by-frame review of a path; null runs it. */
let tweenHoldU: number | null = null
/**
 * v2: the feel-clock backstop (journey/feel.ts feelClockSlip). Before anything reads the fly-to's clock this frame (the date carry rides on its
 * progress), a frame longer than FEEL_MAX_STEP_MS moves the move's clock start later by the excess, and its floor blend with it.
 */
function feelBackstop(now: number): void {
  if (!FLIGHT_FEEL || !tween) return
  const slip = feelClockSlip(tween.stepAt, tween.t0, now)
  const stepAt = tween.stepAt
  tween.stepAt = now
  if (slip <= 0) return
  tween.t0 += slip
  if (tween.floorBlend) tween.floorBlend.t0 += slip
  // The look the move recovers (flyTo's lookAtMoon / lookToward over plan.ms) runs on the rig's clock: it slips with the move, or it would turn the
  // whole gap on this frame and end before the move does.
  if (tween.recoverLook) rig.shiftLookClock(slip, stepAt)
}
function stepTween(now: number): boolean {
  if (!tween) return false
  const tw = tween
  const st = tweenAt(tw, now)
  const arrivalFloor = closeUpDist(tw.plan.to.pose.lon, tw.plan.to.pose.lat)
  if (Math.abs(arrivalFloor - tw.floorDist) > 1e-6) {
    const previousBlend = tw.floorBlend
    const from = previousBlend ? sampleFloorBlend(previousBlend, now) : tw.floorDist
    tw.floorBlend = { from, to: arrivalFloor, t0: now, base: previousBlend?.base ?? previousBlend?.from ?? from }
    tw.floorDist = arrivalFloor
  }
  const effectiveFloor = sampleEffectiveFloorState(st.pose.dist, tw.floorDist, tw.floorBlend, now, tw.endWasFloorBound, tw.endBaseDist)
  const currentFloor = effectiveFloor.floor
  const pose = { ...st.pose, dist: effectiveFloor.dist }
  if (TILE_BASE && now - tw.prefetchAt >= 500) {
    tw.prefetchAt = now
    const startU = tweenProgress(tw, now)
    const approach = buildFlightPrefetchTargets((u) => {
      const sample = tw.plan.at(startU + (1 - startU) * u)
      return { pose: sample.pose, fovDeg: sample.fovDeg }
    }, (1 - startU) * tw.plan.ms, { aspect: canvasAspect(), heightPx: canvasHeightPx() })
    // Sharp: the moment's flight is still waiting on this approach, so its tiles queue behind the approach's now (the flight's own kick only starts when it takes over).
    void prefetchFlight(quality.sharp.on ? approach.concat(cinematicAheadTargets()) : approach)
  }
  // The same effective floor shapes the whole sampled path and constrains every displayed frame.
  rig.setPose(pose, currentFloor)
  tw.lastShownDist = rig.pose.dist
  rig.fovDeg = st.fov
  // A grabbed free orientation eases to the flight's final subject over the same interval as the camera move.
  // Otherwise the planner blends Moon/Earth directions per frame as before.
  applyTweenSubject(tw, st)
  const floorBlendDone = !tw.floorBlend || now >= tw.floorBlend.t0 + floorBlendDuration(tw.floorBlend)
  // A hand-over ends at speed: do not hold it there for a late floor blend (the flight samples the live floor itself).
  if (st.done && (floorBlendDone || tw.plan.endSlope > 0)) {
    if (tw.recoverLook) rigLook = tw.plan.to.look
    tween = null
    joinHandOverAt = tw.plan.endSlope > 0 ? now : null
    cancelFlightPrefetch()
    // The idle orbit starts 20 s after the move ends, not at once.
    rig.lastInputAt = now
  }
  return true
}

/** The camera now as one end of a planned move. */
function currentEnd(): FlyEnd {
  return { pose: { ...rig.pose }, fovDeg: rig.fovDeg, aimShift: rig.aimShift, aimShiftX: rig.aimShiftX, look: rigLook >= 0.5 ? 1 : 0, ground: rig.groundAt(rig.pose.lon, rig.pose.lat) }
}
/** The zoom and tilt buttons' released glides stop (a scripted move starts over their tail). */
function cancelButtonGlides(): void { touchControlsUi?.cancelGlides() }
/**
 * Starts a planned fly-to from the camera as it is (a running move is taken over where it stands). The plan is sampled
 * before the first frame (journey/path.ts), so a path that would show an empty sky or cross the Moon is changed here, not on screen.
 */
function flyTo(end: Partial<FlyEnd> & { pose: Pose }, now: number, ms?: number, endRate?: PoseRate): void {
  moonSurfaceTurn.stopInertia()
  cancelFlightPrefetch()
  cancelPendingWheelZoom()
  // A released zoom or tilt button's glide tail would take this move over on its next step (camStep), killing it on its first frame.
  cancelButtonGlides()
  // v2: a running move is taken over where the camera SHOWN is (the last drawn frame's clock), and the carried move's clock starts there too, so the
  // pose, the floor and the speed are all sampled at one time (sampling at `now` counted the event-to-draw gap twice: up to a 2x speed spike on frame 1).
  const sampleAt = FLIGHT_FEEL && tween ? shownClock(now) : now
  const sampledFrom = tween ? (() => {
    if (tween.floorBlend && !FLIGHT_FEEL) return currentEnd()
    const s = tweenAt(tween, sampleAt)
    // v2: the pose the move shows at that time, as stepTween draws it (the planned pose raised by the effective floor), not rig.pose, which is where the
    // last STEP left it (a step the frame did not draw leaves it ahead of the picture). The aim and the look stay the rig's.
    if (tween.floorBlend) {
      const dist = sampleEffectiveFloorState(s.pose.dist, tween.floorDist, tween.floorBlend, sampleAt, tween.endWasFloorBound, tween.endBaseDist).dist
      const pose = { ...s.pose, dist }
      return { ...currentEnd(), pose, fovDeg: s.fov, ground: rig.groundAt(pose.lon, pose.lat) }
    }
    return { pose: s.pose, fovDeg: s.fov, aimShift: s.aim, aimShiftX: s.aimX, look: (s.look >= 0.5 ? 1 : 0) as 0 | 1, ground: rig.groundAt(s.pose.lon, s.pose.lat) }
  })() : handOffRate?.pose && FLIGHT_FEEL
    // v2: a hand-off from the drawn frames (an orbit, a flight, a spin) starts at the pose of that frame, the same time as its speed and its clock, not at rig.pose,
    // which a step the frame did not draw (a pace hold) leaves one step ahead: that frame would be twice as long.
    ? { ...currentEnd(), pose: { ...handOffRate.pose }, fovDeg: handOffRate.fov ?? rig.fovDeg, ground: rig.groundAt(handOffRate.pose.lon, handOffRate.pose.lat) }
    : currentEnd()
  const hasFreeOrientation = !!rig.freeOrientation()
  const from = hasFreeOrientation ? { ...sampledFrom, look: 0 as const } : sampledFrom
  const inheritedFloor = tween?.floorBlend
    ? sampleFloorBlend(tween.floorBlend, sampleAt)
    : tween?.floorDist ?? closeUpDist(from.pose.lon, from.pose.lat)
  const fromFloor = Math.min(rig.pose.dist, inheritedFloor)
  // v2 (?flightfeel): a running fly-to hands its speed on, so a new pick mid-flight carries on instead of stopping dead first
  // (directly, or through stopMoments, which ends the move a moment before the new one is planned in the same event).
  // The carried move's clock starts where the shown camera is (the last drawn frame's time), so the first new frame continues from it.
  const fromAt = !FLIGHT_FEEL ? now : tween ? shownClock(now) : handOffRate ? handOffRate.at : now
  const startRate = !FLIGHT_FEEL ? undefined : tween ? tweenRate(tween, fromAt) : handOffRate && fromAt === handOffRate.at ? handOffRate.rate : undefined
  handOffRate = null
  const to: FlyEnd = { fovDeg: rig.fovDeg, aimShift: rig.aimShift, aimShiftX: rig.aimShiftX, look: 0, ...end }
  to.ground ??= rig.groundAt(to.pose.lon, to.pose.lat)
  const endBaseDist = to.pose.dist
  const floorDist = closeUpDist(to.pose.lon, to.pose.lat)
  const endWasFloorBound = to.pose.dist <= floorDist
  to.pose = { ...to.pose, dist: Math.max(to.pose.dist, floorDist) }
  const recoverLook = hasFreeOrientation || (from.look === 0 && rig.hasActiveScriptState(now))
  rig.pose = { ...from.pose }
  rig.fovDeg = from.fovDeg
  // v2: a coasting spin would add its velocity on top of every pose of the move until it decays; its speed is in the carried rate already.
  if (FLIGHT_FEEL) rig.stopInertia()
  joinHandOverAt = null
  const hold = dateHoldMs(now)
  // A held start (a date crossfade) begins from rest: the carried speed would only be frozen by the hold.
  const carried = hold === 0 ? startRate : undefined
  const t0 = carried ? fromAt : now + hold
  const plan = planFly(ephem, from, to, { aspect: canvasAspect(), ms, endRate, feel: FLIGHT_FEEL, startRate: carried })
  const floorBlend: FloorBlend = { from: fromFloor, to: floorDist, t0 }
  tween = { t0, plan, recoverLook, floorDist, endBaseDist, endWasFloorBound, floorBlend, lastShownDist: rig.pose.dist, prefetchAt: -Infinity, stepAt: Math.min(t0, now) }
  // v2: the first frame's stepTween builds the same list (prefetchAt -Infinity) and replaces this one: one build per pick, not two (rig 2026-10-30: each
  // was 30-55 ms of the pick's frame on the L4 VM).
  if (TILE_BASE && !FLIGHT_FEEL) void prefetchFlight(buildFlightPrefetchTargets((u) => { const sample = plan.at(u); return { pose: sample.pose, fovDeg: sample.fovDeg } }, plan.ms, { aspect: canvasAspect(), heightPx: canvasHeightPx() }))
  // Keep the shown direction at the start of any date hold, then ease to the planned subject over the flight itself.
  if (recoverLook) {
    // v2: the look turn runs on the move's own clock (it starts at t0, the drawn frame's time for a carried start, and slips with it in feelBackstop).
    const lookAt = FLIGHT_FEEL ? Math.min(t0, now) : now
    const holdMs = t0 - lookAt
    if (to.look === 0) rig.lookAtMoon(true, lookAt, ephem, canvasAspect(), plan.ms, holdMs)
    else rig.lookToward(resolveLook('earth'), true, lookAt, ephem, canvasAspect(), plan.ms, holdMs)
  }
}

// ---------------------------------------------------------------------------
// The scripted descent ("Zoom to Apollo 11"): from the Earth view or the current fly view down to the
// patch's floor. Altitude above the ground falls on a log scale under a smoothstep (the altitude zoom
// law, so every doubling of the height takes the same time), the camera slides over the site early on,
// and the last stretch tilts a little toward the horizon so the relief and shadows read.
// ---------------------------------------------------------------------------
const DESCENT_MS = 26000
/** A pin's descent to the fixed module (Moment.fixed): the planner's pace, not the tour's. The glide to the ground view follows. */
const FIXED_DESCENT_MS = 6000
const FIXED_GLIDE_MS = 1300
/** The approach over a site for a pin that is not a drop (the Apollo 11 and Apollo 17 pins are one descent, not an approach). */
const FIXED_APPROACH_MS = 1500
/**
 * The Apollo 11 pin (a drop with no module): ONE journey from the camera's current pose, on every visit. Its apex is SITE_APEX_DIST radii from
 * the Moon's centre (the limb in view at the frame edges with the 30° lens, the site near the middle: "see from afar where we are"). A camera above the apex descends from where it is;
 * one below it climbs to the apex as the first part of the same smooth path (a start within SITE_AT_APEX_OCTAVES of the apex just descends); pitch and
 * roll blend from the current pose. Then one monotone descent to the ground-level end view. No separate fly-to, no hover. SITE_DROP_MS is the
 * apex-to-end time at the altitude zoom law's pace; the time is SITE_DROP_MS_PER_END_DOUBLING per doubling of the height down to the end (a start above the apex takes longer, 14 s from 12 R).
 */
const SITE_DROP_MS = 11000
/** The drop's time from the apex is this per doubling of the height down to the end altitude (about 6e-4 R), not under SITE_DROP_MIN_MS: 1.5 R up takes 11 s. */
const SITE_END_ALT_EST = 6e-4
const SITE_DROP_MS_PER_END_DOUBLING = 1000
const SITE_DROP_MIN_MS = 6000
const SITE_CLIMB_MS_PER_DOUBLING = 900
const SITE_CLIMB_MS_MIN = 900
const SITE_CLIMB_MS_MAX = 4000
const SITE_AT_APEX_OCTAVES = 0.1
/** How fast the camera follows a lowered floor down (ms). */
interface Descent { /** The previous frame's time, the slowed clock's scale (1 = real time) and the camera distance last drawn (radii), for the lag. */ last?: number; scale?: number; u?: number; lagDist?: number; t0: number; from: Pose | null; alt0: number; fov1: number; /** Length in ms and the share of it the sideways slide takes: a trip from another site (190 km from Apollo 11 to Apollo 17) is longer and slower to cross. */ ms: number; slide: number; /** A pin's quick descent (Moment.fixed). */ fast?: boolean; /** The Apollo 11 pin's drop from the apex (its distance from the centre, radii) and the climb to it from a low start (ms). */ apex?: number; climbMs?: number; prefetched?: boolean; /** The apex used (distance, radii): the camera's own when it is already between SITE_FUNNEL_DIST and SITE_APEX_DIST. */ apexDist?: number; /** The progress at which the path meets SITE_FUNNEL_DIST, and the creep's gain. */ uFunnel?: number; gate?: number; /** Its length when it is not FIXED_DESCENT_MS, ms. */ msFixed?: number; /** Apollo 17's arrival: the descent hands over to ground mode (pendingLanding) at ARRIVAL_HANDOVER_U, still moving. `holdAt` is when the path first reached its end (or, for a direct arrival, when it began waiting for the module). `replay`: the explicit "fly there again": the whole arrival, never the direct glide from low and close. */ landing?: boolean; holdAt?: number; replay?: boolean }
let descent: Descent | null = null

function siteLonLat(): { lon: number; lat: number } {
  // Before the patch is ready (the Apollo 11 drop starts at once) the site table has the same place.
  const s = patch ? patch.manifest.site : PATCH_SITES[patchSiteId as string]
  return { lon: s.lon, lat: s.lat }
}
/**
 * The pose at descent progress u (0 to 1) from `from`. Pure apart from reading the rig's site floor. The camera ends
 * looking `end.headingDeg` (from north, clockwise) tilted `end.pitchDeg` from straight down: the roll turns the
 * frame's top toward the heading, and the camera backs away from it so the site stays in the middle.
 */
/** Debug: a tour end (heading, tilt) tried without editing the site table. */
let endOverride: { headingDeg: number; pitchDeg: number; altFactor?: number } | null = null
/** The end the running tour asks for (Moment.end), when it is not the site's own. */
let momentEnd: { headingDeg: number; pitchDeg: number; altFactor?: number; tier?: boolean } | null = null
/** `?descent=legacy`: the earlier pin-descent path and floor-guard clock (src/descent/landing.ts `legacy`, siteDrop.ts `guardedAim`). */
const DESCENT_LEGACY = new URLSearchParams(location.search).get('descent') === 'legacy'
/**
 * `?a17arrive=hold` (owner complaint 7, 2026-10-23): the Apollo 17 pin flies to a held overview of the valley (src/descent/arrival.ts arrivalHoldPose) and the drop
 * starts only when the eye view's levels, the module, the ground programs and the patch shadow blocks are in (landingReady). `legacy` (the default until the rig
 * check, the a17eye job's `--probe arrive`) starts the drop on the coarse photograph and lets the rest arrive under it.
 */
const A17_ARRIVE_HOLD = new URLSearchParams(location.search).get('a17arrive') === 'hold'
function descentPose(u: number, from: Pose, alt0: number, slide = 0.35, apexPath?: { apex: number; climbU: number }): Pose {
  const { lon, lat } = siteLonLat()
  const end = endOverride ?? momentEnd ?? (loadedSite() as PatchSite).end
  const site = rig.site
  if (!patch) {
    // Not loaded yet: the altitude the end will have, from the site table's photograph (the same law as the floor).
    const alt = siteAltR((loadedSite() as PatchSite).imageTexelM, Math.min(canvas.width, canvas.height), rig.fovDeg) * (end.altFactor ?? 1)
    return landingPose(u, {
      site: { lon, lat }, end, alt1: alt, from, alt0, slide,
      groundAt: (l, b) => rig.groundAt(l, b), floorAt: (l, b) => rig.floorAt(l, b), relief: reliefShare, moonRadiusM: MOON_R_KM * 1000,
      apex: apexPath?.apex, climbU: apexPath?.climbU, legacy: DESCENT_LEGACY,
    })
  }
  // The site's tour ends are counted in floors of its base image (0.6 m at Apollo 17): the 25 cm tier lowers the floor (0.4 m
  // effective), so those ends are scaled to stay where they were. A tier tour counts in the tier's own floors.
  const baseFloor = (loadedSite() as PatchSite).imageTexelM
  // The finest AVAILABLE picture (the one rig.site.altR is set by), never the finest RESIDENT level: at 'ready' only the 59 m bridge is resident, and
  // a keep of 1/120 collapsed the end altitude (1120 m to 9 m), lifting the path 35 km in one frame (rig trace, diagnosis F2).
  const floorTexel = floorTexelOf(patch as PatchLayer)
  const keep = (end as { tier?: boolean }).tier ? 1 : baseFloor / floorTexel
  const alt1 = (site ? site.altR : 1e-3) * (end.altFactor ?? 1) * keep
  return landingPose(u, {
    site: { lon, lat }, end, alt1, from, alt0, slide,
    groundAt: (l, b) => rig.groundAt(l, b), floorAt: (l, b) => rig.floorAt(l, b), relief: reliefShare, moonRadiusM: MOON_R_KM * 1000,
    apex: apexPath?.apex, climbU: apexPath?.climbU, legacy: DESCENT_LEGACY,
  })
}
function startDescent(m: Moment, instant: boolean, now: number, aspect: number): void {
  moonSurfaceTurn.stopInertia()
  momentEnd = m.end ?? null
  pendingLanding = m.groundEnd ?? null
  pendingFixed = !!m.fixed
  const fov1 = m.fovDeg ?? FLY_FOV_DEG
  const { lon, lat } = siteLonLat()
  rig.auto = false
  releaseAim(instant, now)
  if (instant) {
    descent = null
    rig.setPose(descentPose(1, { lon, lat, dist: 4.5, roll: 0, pitch: 0 }, 3.5))
    rig.fovDeg = fov1
    markMoved()
    if (pendingLanding) { const k = pendingLanding; pendingLanding = null; beginLanding(k, true) }
    return
  }
  rig.fovDeg = fov1
  descent = { t0: -1, from: null, alt0: 0, fov1, ms: pendingFixed ? FIXED_DESCENT_MS : DESCENT_MS, slide: 0.35, fast: pendingFixed }
  if (m.look === 'moon') rig.lookAtMoon(true, now, ephem, aspect)
  markMoved()
}
/**
 * A pin at a patch site (Apollo 11, Apollo 17): the planner's fly-to, under 3 s, to the site's end view over the photograph; the
 * 1972 descent and its slider stay behind ?archive=1. Apollo 17's module then comes in on one short glide to the ground view
 * (stepSiteLanding), its model loading under the fly-to so nothing waits at the end.
 */
let siteLandingWait: number | null = null
function startSiteView(m: Moment, instant: boolean, now: number): void {
  moonSurfaceTurn.stopInertia()
  momentEnd = m.end ?? null
  pendingFixed = !!m.fixed
  const fov1 = m.fovDeg ?? FLY_FOV_DEG
  rig.auto = false
  releaseAim(instant, now)
  if (!instant) rig.stopInertia()
  const from = rig.pose
  const alt0 = Math.max(1e-4, from.dist - 1 - rig.groundAt(from.lon, from.lat))
  const pose = descentPose(1, { ...from }, alt0)
  if (m.look === 'moon') rig.lookAtMoon(true, now, ephem, canvasAspect())
  if (instant) {
    rig.setPose(pose)
    rig.fovDeg = fov1
    markMoved()
  } else {
    // The floor over the site lowers only as finer levels are asked for by a camera that is already low: a fly-to straight to the end pose
    // is clamped at the floor of the moment it starts (84 km up at Apollo 11, the site off the bottom of the frame). The short descent
    // follows the floor down and slows while detail is missing (stepDescent), and the end pose is reached however the loading goes.
    // The Apollo 11 pin: one descent from the apex of the path (see SITE_APEX_DIST); stepDescent sizes the climb and the time from the camera it finds.
    // Apollo 17's pin and its Eye level step (groundEnd) take the same descent and hand over to ground mode while still moving (stepDescent).
    // With the hold (A17_ARRIVE_HOLD) the drop is beat 2: beat 1 flies to the overview and waits there (beginArrivalHold, stepArrivalHold), unless the camera
    // is already low and close (Return from the overview, a panorama's fly-out: the direct arrival in stepDescent is one glide and needs no hold).
    // The explicit "fly there again" (navigator replay, arrivalReplayAt) is the whole arrival even from low and close: it bypasses the direct glide in both paths.
    const replay = now - arrivalReplayAt < ARRIVAL_REPLAY_WINDOW_MS
    arrivalReplayAt = -1e9
    if (A17_ARRIVE_HOLD && m.groundEnd && (replay || !arrivalDirect())) beginArrivalHold(m, now, fov1)
    else descent = { t0: -1, from: null, alt0: 0, fov1, ms: SITE_DROP_MS, slide: 0.35, fast: true, msFixed: SITE_DROP_MS, apex: SITE_APEX_DIST, landing: !!m.groundEnd, replay }
  }
  if (m.groundEnd) {
    pendingLanding = m.groundEnd
    siteLandingWait = instant ? now : null
    // The lunar module's model loads while the camera flies.
    void ensureGround()?.loadLm(ephem, canvasAspect()).catch(() => undefined)
  }
  markMoved()
}
/** Begins the short drop to the ground view once the fly-to has arrived and the photograph is in. Returns true while it is waiting. */
function stepSiteLanding(now: number): boolean {
  if (arrivalHold) return stepArrivalHold(now)
  if (siteLandingWait === null || !pendingLanding) { siteLandingWait = null; return false }
  if (tween || descent) return false
  if (!patch || patchState !== 'ready') { siteLandingWait = null; return false }
  // The coarse photograph must be resident, or the drop would start over blurred ground (flat grey ground, V12); give up after 6 s and drop anyway,
  // or after 25 s while it is still downloading. With the hold switch a link's cut to the end pose waits for what the eye view needs (landingReady), within the same caps.
  const resident = A17_ARRIVE_HOLD ? landingReady(moon.boundLevels, holdLevelsTarget(patch), patchShadowCache?.stats.pending ?? 0, !!groundMode?.lm, now - siteLandingWait, groundProgramsWarm()) : patch.readyCoarse && moon.boundLevels >= 1
  if (!resident && now - siteLandingWait < (patch.loading ? 25000 : 6000)) return false
  siteLandingWait = null
  const k = pendingLanding
  pendingLanding = null
  beginLanding(k, false)
  return true
}
/**
 * Beat 1 of the Apollo 17 arrival with the hold switch: the camera flies to the overview of the valley (the site in the middle, about 69 km up, tilted) and
 * stays there until landingReady; stepArrivalHold then starts beat 2, the drop, from that pose (its apex is the camera's own height, so there is no climb).
 * `at` is when the fly-to ended (the hold's clock); `generation` ties the hold to its journey: a press clears pendingLanding and cancels the journey
 * (stopMoments), and the hold ends with it, exactly as a press during the drop does.
 */
let arrivalHold: { at: number | null; fov1: number; generation: number | undefined; stalled: boolean } | null = null
/** The compile queue's 'ground' step has FINISHED its warm-up (the queue's `ran` lists a step as it starts). A failed warm-up counts: the first ground draw compiles then, as before the queue. */
let groundWarmDone = false
/** The ground programs are compiled, or that step is switched off and the first ground draw compiles them as before. */
function groundProgramsWarm(): boolean {
  return !PRECOMPILE.has('ground') || groundWarmDone
}
/** The levels the hold waits for: the site's DECLARED levels (the manifest's), less any whose fetch failed, less the finest. Never the resident count: one resident level would make the target one. */
function holdLevelsTarget(p: PatchLayer): number {
  return holdLevelsWanted(p.availableLevels.length, p.failedLevelNames.length)
}
/** The explicit "fly there again" (navigator replay): stamped just before its playPin and read by startSiteView within the window, so the whole arrival runs even from low and close. */
let arrivalReplayAt = -1e9
const ARRIVAL_REPLAY_WINDOW_MS = 2000
/** The camera is already below the funnel and within ARRIVAL_DIRECT_M of the site: the direct arrival in stepDescent (one glide) takes it, no hold. */
function arrivalDirect(): boolean {
  const { lon, lat } = siteLonLat()
  const site = loadedSite() ?? PATCH_SITES[patchSiteId ?? 'a17']
  return patchState === 'ready' && directArrival(enuOfPose(rig.pose, { lon, lat }, site.groundM, MOON_R_KM * 1000), rig.pose.dist, SITE_FUNNEL_DIST)
}
/** Ends the hold and takes its chip down (a cancel, a failure, or the drop starting). */
function endArrivalHold(): void {
  if (!arrivalHold) return
  if (arrivalHold.stalled) caption.clear()
  arrivalHold = null
}
/**
 * The module's load for the hold, tied to its journey: a failure ends the hold as a failed journey (momentUnavailable then says the module did not load and the
 * card offers the retry), never an endless wait for a model that is not coming. Also the chip's "Try again".
 */
function holdLoadLm(generation: number | undefined): void {
  const g = ensureGround()
  if (!g || g.lm) return
  lmLoadFailed = false
  void g.loadLm(ephem, canvasAspect()).catch((err) => {
    console.warn('Lunar module unavailable:', (err as Error).message)
    if (!arrivalHold || arrivalHold.generation !== generation) return
    lmLoadFailed = true
    endArrivalHold()
    pendingLanding = null
    if (generation !== undefined) journey.fail(generation)
  })
}
function beginArrivalHold(m: Moment, now: number, fov1: number): void {
  const { lon, lat } = siteLonLat()
  // The same end the drop will use (descentPose): the debug override, the moment's own, then the site table's.
  const end = endOverride ?? m.end ?? (loadedSite() ?? PATCH_SITES[m.needsPatch ?? 'a17']).end
  const pose = arrivalHoldPose({ lon, lat }, end.headingDeg, rig.groundAt(lon, lat), reliefShare)
  descent = null
  flyTo({ pose, fovDeg: fov1, aimShift: 0, aimShiftX: 0, look: 0 }, now)
  arrivalHold = { at: null, fov1, generation: journey.state?.generation, stalled: false }
  holdLoadLm(arrivalHold.generation)
}
/** The hold's frame step (from stepSiteLanding): waits at the overview, starts the drop when the eye view's picture is in, shows the chip when it stalls. Returns true while it moves the camera. */
function stepArrivalHold(now: number): boolean {
  const h = arrivalHold
  if (!h) return false
  // Cancelled (a press, Home, another viewpoint: stopMoments cleared pendingLanding and the journey), or the patch is gone: the hold is over, nothing drops.
  if (!pendingLanding || descent || (h.generation !== undefined && !journey.current(h.generation)) || patchState === 'failed' || patchState === 'off') {
    if (patchState === 'failed' && pendingLanding && h.generation !== undefined) journey.fail(h.generation)
    if (patchState === 'failed') pendingLanding = null
    endArrivalHold()
    return false
  }
  // Still on the way to the overview (stepTween moves the camera); the clock starts when it is there.
  if (tween) return false
  if (h.at === null) h.at = now
  const ready = !!patch && patchState === 'ready'
  const wanted = patch ? holdLevelsTarget(patch) : 1
  const lmOk = !!ensureGround()?.lm
  const waited = now - h.at
  if (h.generation !== undefined) journey.sample(h.generation, 'arrival-hold', Math.min(0.99, 0.5 + 0.5 * Math.min(1, waited / ARRIVAL_HOLD_MAX_MS)))
  // `stats.pending` counts every planned shadow block not yet built (the whole plan, not only the visible ones): a bound on the shadow work left, and the cap bounds the wait for it.
  if (ready && landingReady(moon.boundLevels, wanted, patchShadowCache?.stats.pending ?? 0, lmOk, waited, groundProgramsWarm())) {
    endArrivalHold()
    // Beat 2: the drop, from here (stepDescent sets the apex to the camera's own height below the funnel: no climb).
    descent = { t0: -1, from: null, alt0: 0, fov1: h.fov1, ms: SITE_DROP_MS, slide: 0.35, fast: true, msFixed: SITE_DROP_MS, apex: SITE_APEX_DIST, landing: true }
    markMoved()
    return true
  }
  // Past the cap without the picture: the overview stays (it is sharp), the caption says so and offers the retry (the levels and the module); the drop starts the moment they are in.
  if (!h.stalled && (landingHoldStalled(moon.boundLevels, wanted, lmOk, waited) || (ready && !!patch?.lastError && !patch.loading && moon.boundLevels < wanted))) {
    h.stalled = true
    caption.show('Still loading the sharp detail', 'Your connection may be slow.', { label: 'Try again', run: () => { patch?.retryRefinement(); holdLoadLm(h.generation); if (arrivalHold) { arrivalHold.at = performance.now(); arrivalHold.stalled = false } caption.clear() } }, true)
  }
  return false
}
/** The apex's altitude above the ground at the site, radii, from its distance from the Moon's centre. */
function apexAltitude(apexDist: number): number {
  const { lon, lat } = siteLonLat()
  return Math.max(1e-4, apexDist - 1 - rig.groundAt(lon, lat))
}
/**
 * A landing descent's motion over its last frame: velocity (m/s, site frame) and pitch rate (deg/s) of the camera, so the ground glide can leave with both.
 * It outlives the descent: a pin picked in the middle of a descent starts from the camera's motion, not from rest. The step is the clock's own (a stalled
 * frame advanced the path by at most MAX_STEP_MS, so it is not divided by the stall).
 */
let arrivalMotion: { pose: Pose; cam: ViewCamera; at: number; v: THREE.Vector3; pitchRate: number } | null = null
function trackArrival(now: number): NonNullable<typeof arrivalMotion> {
  const prev = arrivalMotion
  const cam = rig.camera(ephem, canvasAspect(), now)
  const stepMs = prev ? clockStepMs(Math.max(0, now - prev.at)) : 0
  const g = ensureGround()
  const v = prev && stepMs > 0 ? poseVelocityENU(prev.pose, rig.pose, stepMs, siteLonLat(), (loadedSite() as PatchSite).groundM, MOON_R_KM * 1000) : [0, 0, 0]
  const pitchRate = prev && g && stepMs > 0 ? (g.viewOf(ephem, cam).pitchDeg - g.viewOf(ephem, prev.cam).pitchDeg) / (stepMs / 1000) : 0
  arrivalMotion = { pose: { ...rig.pose }, cam, at: now, v: new THREE.Vector3(v[0], v[1], v[2]), pitchRate }
  return arrivalMotion
}
function stepDescent(now: number): boolean {
  if (!descent) return false
  const ready = !!patch && patchState === 'ready'
  if (!ready) {
    // The Apollo 11 drop runs its high part while the patch loads; every other descent needs it.
    if (!(descent.apex !== undefined && patchState === 'loading' && patchSiteId)) {
      if (descent.apex !== undefined && patchState === 'failed' && journey.state) journey.fail(journey.state.generation)
      // A failed patch ends the Apollo 17 descent: a landing still pending would block journey.arrive until the next moment.
      if (patchState === 'failed') pendingLanding = null
      descent = null
      return false
    }
  }
  if (descent.t0 < 0) {
    if (tween) return true
    if (descent.landing && pendingLanding && ready && ensureGround()) {
      // Apollo 17 from low and close (a panorama's fly-out, a second visit): there is nothing to climb to and nothing to descend through. Ground mode takes over from this
      // frame's camera at once and one glide, leaving with the camera's own motion, goes to the eye pose. (A climb to the funnel here was a stop at 695 km.)
      const rest = !descent.replay && directArrival(enuOfPose(rig.pose, siteLonLat(), (loadedSite() as PatchSite).groundM, MOON_R_KM * 1000), rig.pose.dist, SITE_FUNNEL_DIST)
      if (rest) {
        if (descent.holdAt === undefined) descent.holdAt = now
        const detailOk = !!patch && patch.readyCoarse && moon.boundLevels >= 1
        if (!((detailOk && !!groundMode?.lm) || now - descent.holdAt > ARRIVAL_WAIT_MS)) return true
        const m = arrivalMotion && now - arrivalMotion.at < 250 && arrivalMotion.pose.lon === rig.pose.lon && arrivalMotion.pose.lat === rig.pose.lat && arrivalMotion.pose.dist === rig.pose.dist ? arrivalMotion : null
        const k = pendingLanding
        pendingLanding = null
        descent = null
        arrivalMotion = null
        beginLanding(k, false, { cam: rig.camera(ephem, canvasAspect(), now), v: m ? m.v.clone() : new THREE.Vector3(), pitchRate: m ? m.pitchRate : 0 })
        return true
      }
    }
    descent.t0 = now
    descent.from = { ...rig.pose }
    descent.alt0 = Math.max(1e-4, rig.pose.dist - 1 - rig.groundAt(rig.pose.lon, rig.pose.lat))
    const { lon, lat } = siteLonLat()
    const far = smooth(angularDistance(rig.pose.lon, rig.pose.lat, lon, lat) / 0.1)
    descent.ms = descent.fast ? (descent.msFixed ?? FIXED_DESCENT_MS + 2500 * far) : DESCENT_MS + 22000 * far
    descent.slide = 0.35 + 0.25 * far
    if (descent.apex !== undefined) {
      // One path: a start below the apex climbs to it first (part of the same journey), one above it starts where it is and takes longer by
      // the doublings of its height. The apex is no higher than the camera needs: min(SITE_APEX_DIST, max(the camera's distance, SITE_FUNNEL_DIST)).
      // The sideways slide stays in the top half whatever the distance.
      descent.apexDist = Math.min(descent.apex, siteApexDist(rig.pose.dist))
      // A landing descent that starts below the funnel (but too far or too high for the direct glide) climbs nowhere: its apex is the camera's own height, so it
      // descends from where it is (picking the pin mid-descent never rises again to 695 km).
      if (descent.landing && rig.pose.dist < SITE_FUNNEL_DIST) descent.apexDist = Math.min(descent.apexDist, rig.pose.dist)
      const apexAlt = apexAltitude(descent.apexDist)
      const doublings = Math.log2(descent.alt0 / apexAlt)
      const climbMs = doublings < -SITE_AT_APEX_OCTAVES ? Math.max(SITE_CLIMB_MS_MIN, Math.min(SITE_CLIMB_MS_MAX, -doublings * SITE_CLIMB_MS_PER_DOUBLING)) : 0
      descent.climbMs = climbMs
      const dropMs = Math.max(SITE_DROP_MIN_MS, SITE_DROP_MS_PER_END_DOUBLING * Math.log2(Math.max(apexAlt, descent.alt0) / SITE_END_ALT_EST))
      descent.ms = dropMs + climbMs
      descent.slide = 0.3 + 0.2 * far
      if (!ready) {
        // Where the path meets the funnel: the clock creeps from there until the patch is ready.
        const ap = { apex: apexAlt, climbU: climbMs / descent.ms }
        descent.uFunnel = 1
        for (let i = Math.floor(ap.climbU * 200); i <= 200; i++) if (descentPose(i / 200, descent.from, descent.alt0, descent.slide, ap).dist <= SITE_FUNNEL_DIST + 1e-9) { descent.uFunnel = i / 200; break }   // after the climb: a low start is below the funnel at u 0
      }
    }
  }
  // The clock never stops and never runs backwards (src/descent/clock.ts): slow while the detail is not resident, never frozen.
  const frameMs = descent.last === undefined ? 0 : Math.max(0, now - descent.last)
  const detailResident = ready && patch !== null && descentDetailResident({ ready, apexPath: descent.apex !== undefined, readyCoarse: patch.readyCoarse, refinementPending: patch.refinementPending, boundLevels: moon.boundLevels, levels: patch.levels.length, failedAndIdle: !!(patch.lastError && !patch.loading) })
  let u = stepClock(descent, now, detailResident)
  if (descent.uFunnel !== undefined) {
    // Without the patch the journey is slowed smoothly as it nears the funnel (never a hard stop, never a step), and speeds up smoothly when the patch lands.
    const prevU = descent.u ?? 0
    // Not ready: the aim is also held off the floor under the camera, so the creep never runs into a level it cannot see.
    const guard = ready ? 1 : floorGuard(rig.pose.dist, rig.floorAt(rig.pose.lon, rig.pose.lat))
    descent.gate = stepGate(descent.gate ?? 1, guardedAim(funnelAim(prevU, descent.uFunnel, ready), guard, ready, DESCENT_LEGACY), frameMs)
    if (descent.gate < 0.999 || !ready) {
      u = gatedU(prevU, u, descent.gate)
      descent.t0 = now - u * descent.ms
    } else descent.uFunnel = undefined
  }
  descent.u = u
  const apexPath = descent.apexDist !== undefined ? { apex: apexAltitude(descent.apexDist), climbU: (descent.climbMs ?? 0) / descent.ms } : undefined
  if (apexPath && ready && !descent.prefetched) {
    // The tiles the rest of the path will need, asked for once the patch is here: while it downloads, the patch owns the link (the moving camera's
    // tiles starved it, 'ready' at 24 s instead of 11 s on 20 Mbps), and the tile streamer yields (2 in flight, low priority).
    descent.prefetched = true
    const d = descent
    if (TILE_BASE) void prefetchFlight(buildFlightPrefetchTargets((v) => ({ pose: descentPose(v, d.from as Pose, d.alt0, d.slide, apexPath), fovDeg: d.fov1 }), d.ms, { aspect: canvasAspect(), heightPx: canvasHeightPx() }))
  }
  const target = descentPose(u, descent.from as Pose, descent.alt0, descent.slide, apexPath)
  // No clamp while the patch loads: the gated clock drives the pose, so the camera keeps descending (slowly, then faster as the gain returns), and rig.floorAt
  // holds it above the resident level. The real pose differs from the pre-patch one by metres only; the floor lag below absorbs that.
  // A finer level arriving lowers the funnel floor: the camera follows it down on a short lag (in altitude above the ground, log scale) instead of stepping.
  const groundHere = rig.groundAt(target.lon, target.lat)
  const rendered = descentRenderPose(target, descent.lagDist, frameMs, groundHere, rig.floorAt(target.lon, target.lat))
  descent.lagDist = rendered.lagDist
  rig.setPose(rendered.pose)
  if (descent.landing && pendingLanding) {
    // Apollo 17: the hand-over to ground mode happens at ARRIVAL_HANDOVER_U with the descent's own velocity and pitch rate, not after a stop. It waits (the path's end holds) for the coarse
    // photograph and the module's model, then goes ahead anyway after ARRIVAL_WAIT_MS.
    const motion = trackArrival(now)
    if (u >= 1 && descent.holdAt === undefined) descent.holdAt = now
    const detailOk = ready && !!patch && patch.readyCoarse && moon.boundLevels >= 1
    const lmOk = !!groundMode?.lm
    if (u >= ARRIVAL_HANDOVER_U && ready && ((detailOk && lmOk) || (descent.holdAt !== undefined && now - descent.holdAt > ARRIVAL_WAIT_MS))) {
      const k = pendingLanding
      pendingLanding = null
      descent = null
      arrivalMotion = null
      // THIS frame's camera: the ground view starts where the rig is now, not at the frame drawn last (that was a repeated frame at the join).
      beginLanding(k, false, { cam: motion.cam, v: motion.v, pitchRate: motion.pitchRate })
      return true
    }
  }
  if (u >= 1 && ready && patch) {
    const ideal = descentPose(1, descent.from as Pose, descent.alt0, descent.slide, apexPath)
    if (!patch.readyCoarse || patch.refinementPending || moon.boundLevels < patch.levels.length || !descentReached(rig.pose.dist, ideal.dist, rig.floorAt(ideal.lon, ideal.lat))) {
      if (patch.lastError && !patch.loading && journey.state) journey.fail(journey.state.generation)
      return true
    }
    descent = null
    if (pendingLanding) { const k = pendingLanding; pendingLanding = null; beginLanding(k, false) }
  }
  return true
}

/** Camera distance of the approach over a site while its patch loads: 1.3 radii, about 520 km up, well inside the global tiles. */
const APPROACH_DIST = 1.3
/** The Apollo 11 pin (a drop, no module): it waits for its patch at the apex of its descent, and its approach is the planner's own pace. */
const isSiteDrop = (m: Moment): boolean => m.camera.at === 'siteView' && !m.fixed && !m.groundEnd
/** The Apollo 17 pin / Eye level step: the same drop, handing over to the ground view at its end (one continuous arrival). */
const isSiteArrival = (m: Moment): boolean => m.camera.at === 'siteView' && !!m.fixed && !!m.groundEnd
/**
 * Moves toward the site at once while its patch streams: one planned fly-to (journey/path.ts) to a view straight over the site.
 * Nothing here needs the patch. The moment's own motion takes over from this pose when the patch is ready. `instant` (a link
 * that names the moment) puts the camera there without the trip. The date change is a crossfade that runs under the first part
 * of the move, never before it.
 */
let approachFor: string | null = null
/** The approach in progress is the Apollo 11 drop's (it waits for the patch without moving, and has no hover). */
let approachIsDrop = false
function approachSite(site: PatchSite, m: Moment, instant: boolean): void {
  moonSurfaceTurn.stopInertia()
  if (approachFor === m.id) return
  approachFor = m.id
  const now = performance.now()
  const siteDrop = isSiteDrop(m)
  approachIsDrop = siteDrop
  const approachDist = APPROACH_DIST
  const pose: Pose = { lon: site.lon, lat: site.lat, dist: approachDist, roll: 0, pitch: 0 }
  declareExposureCut()
  const momentTime = m.time()
  // Every moment start is a journey start for the date blend: a tap moves the camera on frame 1 and a ?moment= link (instant) cuts it there (R4).
  beginDateChange(momentTime, PICK_FADE_HOLD_MS, true)
  const shownBefore = last?.ephem ?? ephem
  time = momentTime
  live = !!m.live && !STILL
  ephem = clockSet(time, instant || !DATE_CARRY || STILL)
  rememberTweenRate()
  tween = null
  descent = null
  rig.auto = false
  if (instant) {
    rig.aimShift = 0; rig.aimShiftX = 0
    rig.setPose(pose)
    rig.fovDeg = FLY_FOV_DEG
    rigLook = 0; rig.setLookBlend(0, resolveLook('earth'))
  } else if (siteDrop) {
    // No fly-to: the descent is the one journey, and starts from this pose the moment the patch is ready (manifests, mid band, shader precompile).
    rig.stopInertia()
  } else {
    // Already over this site and low: nothing to approach but the aim shifts easing to zero.
    flyTo({ pose: rig.pose.dist <= approachDist * 1.05 && angularDistance(rig.pose.lon, rig.pose.lat, site.lon, site.lat) < 0.05 ? { ...rig.pose } : pose, fovDeg: FLY_FOV_DEG, aimShift: 0, aimShiftX: 0, look: 0 }, now, m.camera.at === 'siteView' ? FIXED_APPROACH_MS : undefined)
  }
  carryDate(shownBefore, instant)
  markMoved()
}
/**
 * The hover: the camera waits over a site (APPROACH_DIST) while its photograph loads, and is never still. It wanders east and west
 * by under a degree on a 20 s period (0.3 deg/s at its quickest) so the frame keeps moving; the descent that follows slides over
 * whatever offset it has. The caption shows the load (updatePinCaption).
 */
const HOVER_AMPLITUDE_DEG = 0.95
const HOVER_PERIOD_S = 20
let hover: { lon0: number; t0: number } | null = null
function stepHover(now: number): boolean {
  const waiting = approachFor !== null && !tween && !descent && !groundMode?.active && !flight && !ridge && rig.pose.dist <= APPROACH_DIST * 1.05 && !approachIsDrop && (patchState === 'loading' || patchState === 'idle')
  if (!waiting || STILL) { hover = null; return false }
  if (!hover) hover = { lon0: rig.pose.lon, t0: now }
  rig.setPose({ ...rig.pose, lon: hover.lon0 + HOVER_AMPLITUDE_DEG * Math.sin(2 * Math.PI * (now - hover.t0) / (HOVER_PERIOD_S * 1000)) })
  return true
}
/** The site whose tour is on screen (its patch must not be swapped out by the camera passing another site), or null. */
let tourSite: string | null = null
/** The newest playMoment call: a moment waiting on tiles gives way to one chosen after it. */
let playSeq = 0
const journey = new JourneyLifecycle()
let pendingPanorama: { id: ApolloPanorama['id']; generation: number } | null = null
function clearPendingPanorama(): void { pendingPanorama = null }
let orbitJourney: { t0: number; lon0: number; lat: number; dist: number; generation: number; /** Mean speeds it starts at after a fly-to that ends at that speed (journey/join.ts). */ lead: number } | null = null
function stepOrbit(now: number): boolean {
  if (!orbitJourney || tween || rig.mode !== 'fly') return false
  if (orbitJourney.t0 < 0) { orbitJourney.t0 = journeyClockStart(now, orbitJourney.lead ? joinHandOverAt : null, 0, ORBIT_SECONDS); joinHandOverAt = null; orbitJourney.lon0 = rig.pose.lon }
  const u = progressOfTimed(now, orbitJourney.t0, ORBIT_SECONDS * 1000)
  const angle = orbitAngleDeg(u, orbitJourney.lead)
  rig.setPose({ lon: orbitJourney.lon0 + angle, lat: orbitJourney.lat, dist: orbitJourney.dist, roll: 0, pitch: 0 })
  journey.sample(orbitJourney.generation, 'orbit', u, angle)
  if (u >= 1) { journey.arrive(orbitJourney.generation, now); orbitJourney = null }
  return true
}
/** Why a moment cannot be shown right now (null: it can). The tour card shows this instead of the caption. */
function momentUnavailable(m: Moment): string | null {
  // The data is fetched again when the visitor chooses the view again (or presses Retry): nothing here tells them to reload the page.
  if (m.needsPatch && patchSiteId === m.needsPatch && patchState === 'failed' && patchError?.includes('mid-resolution')) return 'The terrain around the site did not load. Your connection may have dropped.'
  if (m.needsPatch && patchSiteId === m.needsPatch && patchState === 'failed') return `The ${PATCH_SITES[m.needsPatch].name} photograph did not load. Your connection may have dropped.`
  if (m.groundEnd && lmLoadFailed) return 'The lunar module did not load. Your connection may have dropped.'
  return m.needsTiles && tilesState === 'failed' ? 'The surface tiles did not load. Your connection may have dropped.' : null
}
/** What the card's progress line says for this moment while its data is on the way, or null when nothing is loading for it. */
function momentProgress(m: Moment): { text: string; fraction: number | null } | null {
  const prep = cinematicFlight?.prep
  if (prep?.started && prep.phase !== 'done' && journey.state?.id === m.id) return { text: PREP_TEXT, fraction: prep.progress(performance.now()) }
  // The Apollo 17 arrival hold (stepArrivalHold): the same beat, the same words.
  if (arrivalHold !== null && arrivalHold.at !== null && journey.state?.id === m.id) return { text: PREP_TEXT, fraction: journey.state.progress }
  if (m.needsPatch && patchSiteId === m.needsPatch && patch?.lastError) return { text: 'The sharper detail did not load.', fraction: null }
  if (m.needsPatch && patchSiteId === m.needsPatch && patchState === 'loading') {
    // No byte counts: the owner found them technical. The bar still moves with the fraction when the size is known.
    const p = patchProgress
    return { text: `${p?.waiting ? 'Connection dropped, trying again. ' : ''}Loading the photograph`, fraction: p && p.total !== null ? (p.fraction ?? 0) : null }
  }
  if (m.needsTiles && tilesState === 'loading') return { text: 'Loading the surface tiles', fraction: null }
  return null
}
/** The moment's retry: choose it again. */
function retryMoment(m: Moment): void { lmLoadFailed = false; patch?.retryRefinement(); playMoment(m, false) }
/** Stop: never moves the camera. A view that is still waiting for its data is cancelled, and a descent or tween on its way stays where it is. */
function takeCurrentScriptCamera(cause: CancelCause = 'other', holdPatch = false): void {
  moonSurfaceTurn.stopInertia()
  intro?.interrupt()
  cancelRoute()
  stopMoments(cause, holdPatch)
  patchRefinementPaused = false
  if (flight) stopFlight(false)
  if (ridge) {
    const shown = last ? { cam: last.cam, e: last.ephem } : ridgeF ? { cam: ridgeF.cam, e: ephem } : null
    dropRidge()
    if (shown) rig.settle(shown.e, canvasAspect(), performance.now(), shown.cam)
  }
}
/** A pin's journey is on its way (loading, moving or hovering for a photograph): a cancel is decided by journey/cancel.ts. */
function pinJourneyRunning(): boolean {
  const st = journey.state
  return !!pinShown && !!st && (st.status === 'loading' || st.status === 'travelling' || !!tween || !!descent || approachFor !== null)
}
/** A viewpoint journey is under way: a cinematic flight, a fly-to, a descent or orbit, or one still waiting for its data. */
function viewpointJourneyRunning(): boolean {
  return viewpointJourneyBusy(journey.state?.status, !!(cinematicFlight || tween || descent || orbitJourney || approachFor !== null))
}
/** The fly-to a grab stopped, which a tap on the canvas resumes (never a drag or the wheel). */
let resumable: { end: FlyEnd; ms: number } | null = null
/** The wheel's eased tail is cancelled by a new scripted action, but kept while consecutive wheel events accumulate. */
let cancelPendingWheelZoom = (): void => {}
/** holdPatch: the caller (a panorama opening) takes the camera but the site's photograph load is still wanted when it closes. */
function stopMoments(cause: CancelCause = 'other', holdPatch = false): void {
  cancelFlightPrefetch()
  if (cause !== 'grab') cancelPendingWheelZoom()
  const decision = onCancel(cause, pinJourneyRunning())
  if (decision === 'continue') return
  // The camera is being taken over (a grab, a wheel, Stop, another pick): an easing aim is theirs now, never re-applied (aimRelease.step also sees it).
  aimRelease = null
  // Decided before the script state below is cleared: did a script (a journey, flight, descent or ridge view) own the camera, and so the patch load?
  const keepPatch = holdPatch || keepPatchLoad(cause, viewpointJourneyRunning() || pinJourneyRunning() || !!flight || !!ridge || rig.hasActiveScriptState(performance.now()))
  // A flight the visitor leaves (before the journey is cancelled) is remembered where it was: the pill's Return carries on from there.
  if (cinematicFlight && cinematicFlight.t0 >= 0 && journey.state && journey.current(cinematicFlight.generation)) {
    flightLeft = { id: journey.state.id, u: cinematicFlight.pausedU ?? progressOfTimed(performance.now(), cinematicFlight.t0, cinematicFlight.definition.seconds * 1000) }
  }
  if (tween) {
    // v2: stop on the camera as last DRAWN (its clock), not on a pose at the event's time that was never shown; a new move then starts there.
    const now = shownClock(performance.now())
    const shown = tweenAt(tween, now)
    const floor = tween.floorBlend ? sampleFloorBlend(tween.floorBlend, now) : tween.floorDist
    // v2: the distance stepTween DREW at that clock (the planned pose raised by the effective floor), as flyTo and rememberTweenRate sample it: the old blend
    // formula differs from it while a floor blend runs (a move's first 400 ms, a floor that changed as tiles arrived), a height step where the carried speed starts.
    const dist = FLIGHT_FEEL ? sampleEffectiveFloorState(shown.pose.dist, tween.floorDist, tween.floorBlend, now, tween.endWasFloorBound, tween.endBaseDist).dist
      : shown.pose.dist + (Math.max(tween.endBaseDist, floor) - tween.plan.to.pose.dist) * smoothstep(tweenProgress(tween, now))
    const pose = { ...shown.pose, dist }
    // v2: the speed the stopped move had, for a fly-to started in this same event (Home or a new pick mid-flight) to carry on.
    if (FLIGHT_FEEL) handOffRate = { rate: tweenRate(tween, now), at: now }
    rig.setPose(pose)
    rig.fovDeg = shown.fov
    rig.aimShift = shown.aim
    rig.aimShiftX = shown.aimX
    rigLook = shown.look
    rig.stopInertia()
    if (!tween.recoverLook) rig.setLookBlend(shown.look, resolveLook('earth'))
  } else if (FLIGHT_FEEL) {
    // v2: an orbit, a flight or a coasting spin handed over at the speed the picture had, not from rest (a step of the whole orbit rate on frame 1).
    // A second stop in the same event (Home stops, then takes the script camera) keeps the first one's rate: it may be the analytic rate of a fly-to.
    const d = handOffRate ? null : drawnRate(performance.now())
    if (d) handOffRate = d
  }
  cancelJourneyAndContinuation(journey, clearPendingPanorama)
  resumable = decision === 'stop-resumable' && tween ? { end: { ...tween.plan.to }, ms: tween.plan.ms } : null
  // The caption holds while a tap may still resume the journey (checkPinCaption's wait window).
  if (resumable && pinShown) { pinShown.moving = false; pinShown.at = performance.now() }
  // Free orbiting and a settled free orientation are user-owned: only an active script look or a running move needs settling
  // (settling a plain orbit pose is what turned the Earth view into a 2 deg telephoto on every press).
  const scripted = rig.hasActiveScriptState(performance.now()) || !!(cinematicFlight || tween || descent || orbitJourney)
  playSeq++
  if (ridge) ridge.playing = false
  if (flight) { flight.playing = false; flightHeldByStop = true }
  // A wheel notch or tap on a free camera owns no patch load: aborting it only made the proximity loader restart the same download next frame (#185).
  if (!keepPatch) {
    patchRefinementPaused = true
    if (patchState === 'loading') {
      patchLoadGeneration++
      patchController?.abort(); patchController = null
      patchState = PATCH_BASE ? 'idle' : 'off'; patchLoading = null; patchSiteId = null; patchProgress = null
    } else patch?.cancelRefinement()
  }
  groundMode?.cam.cancelGlide()
  cinematicFlight = null
  orbitJourney = null
  approachFor = null
  // In the body frame of the picture on screen (last.ephem), not of a carry step the pacer has not drawn yet.
  if (!groundMode?.active && !flight && !ridge && scripted) { rig.settle(last?.ephem ?? ephem, canvasAspect(), performance.now(), last?.cam); rigLook = 0 }
  scrub.attach(null)
  resetScrubEnding()
  pendingLanding = null
  endArrivalHold()
  descent = null
  tween = null
  // Stopping at the displayed pose may need a redraw, but is not camera motion.
  markDirty()
}

const now0 = (): number => performance.now()
function beginJourney(m: Moment): void {
  journey.begin(m.id, m.title, m.look === 'earth' ? 'earth' : m.look === 'sun' ? 'sun' : m.groundEnd ? 'ground' : 'moon', performance.now())
}
/**
 * The background shader compiles (R50): one step per idle callback, in the order the viewer first needs them. `?precompile=` picks the steps
 * (src/net/compileQueue.ts); with a step off, its first draw compiles as it did before the queue.
 */
const PRECOMPILE = precompileSteps(location.search)
/** The independent metadata programs (Moon and ground) are warmed only for a visibility calibration, an audit, or `?precompile=meta`. */
let metadataWarm = PRECOMPILE.has('meta')
function wantMetadataPrograms(): void { metadataWarm = true; moon.setMetadataWanted(true) }
type IdleWindow = { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }
const idleSlot = (): Promise<void> => new Promise((done) => { const idle = (window as unknown as IdleWindow).requestIdleCallback; if (idle) idle(() => done(), { timeout: 1500 }); else setTimeout(done, 50) })
let compileQueueStarted = false
const compileQueue = createCompileQueue((cb) => {
  // The first slot waits for the first frame to be well past (the old tile-prepare delay); later ones follow the previous step at once.
  const delay = compileQueueStarted ? 0 : TILE_PREPARE_DELAY_MS
  compileQueueStarted = true
  const idle = (window as unknown as IdleWindow).requestIdleCallback
  setTimeout(() => (idle ? idle(cb, { timeout: 3000 }) : cb()), delay)
}, PRECOMPILE)
/**
 * Starts the lunar module's download (glTF, Draco decoder, code chunk) at low priority; the arrival then finds it in the HTTP cache. With `preload` (a moment that
 * lands beside the module, not the idle prefetch) the module is then parsed and its programs linked in a queue slot of their own, still inside the prefetch window.
 */
function prefetchLanderAssets(preload = false): void {
  if (STILL) return
  const bytes = prefetchLander({
    base: import.meta.env.BASE_URL,
    fetchImpl: (url, init) => fetch(url, init),
    importChunk: () => import('./ground/LunarModule'),
  })
  if (!preload) return
  void bytes.then(() => {
    compileQueue.enqueue('lm', () => startLanderPreload(
      async () => {
        const base = import.meta.env.BASE_URL
        const { LunarModule: LM } = await import('./ground/LunarModule')
        return LM.load(`${base}${LM_MODEL_FILE}`, `${base}${LM_DRACO_DIR}`, quality.profile.lmShadowRes, { phone: !!nativeHost && (quality.detected.cls === 'ios' || quality.detected.cls === 'ipad' || quality.detected.cls === 'phone-android'), lite: lmMaterialLite(location.search, quality.detected.cls), selfShadow: lmSelfShadow(!!nativeHost, quality.hints.renderer, location.search) })
      },
      (lm) => compileForTarget(renderer, lm.scene, lm.camera),
      (lm) => lm.dispose(),
    ))
  })
}
function playMoment(m: Moment, instant = false, afterLoad = false): void {
  moonSurfaceTurn.stopInertia()
  // A moment that does not land beside the module frees one a replaced moment preloaded (GPU memory); the preload also frees itself after a minute untaken.
  if (!afterLoad && !momentNeedsLander(m)) void discardLanderPreload()
  if (!afterLoad && momentNeedsLander(m) && prefetchAllowed(connection(), location.search)) prefetchLanderAssets(true)
  // R57: the site photograph's coarse level starts downloading at once (low priority), so the arrival's hold for it is shorter. ?patchpre=0 skips it.
  if (!afterLoad && m.needsPatch && PATCH_BASE && patchSitesFound.has(m.needsPatch) && !STILL && prefetchAllowed(connection(), location.search) && new URLSearchParams(location.search).get('patchpre') !== '0') {
    const site = m.needsPatch
    void import('./moon/patch/coarsePrefetch').then((c) => c.prefetchPatchCoarse(`${PATCH_BASE}${site}/`, { fetchImpl: (url, init) => fetch(url, init) }))
  }
  resetScrubEnding()
  if (!afterLoad) {
    clearPendingPanorama()
    pendingLanding = null
    cancelRoute()
    stopMoments()
  }
  if (groundMode?.active) { leaveGround(false, () => playMoment(m, instant, afterLoad)); return }
  if (!afterLoad) cancelPendingWheelZoom()
  homeFrame = false
  declareExposureCut()
  const seq = afterLoad ? playSeq : ++playSeq
  if (!afterLoad) patchRefinementPaused = false
  if (!afterLoad) {
    beginJourney(m)
    cinematicFlight = null
    orbitJourney = null
    flightStartU = resumeProgress(resumeRequest, m.id)
    resumeRequest = null
    flightLeft = null
    // A choice of the visitor starts the automatic tries afresh.
    if (m.needsPatch) autoRetries.delete(m.needsPatch)
  }
  if (!afterLoad) approachFor = null
  dropRidge()
  pendingLanding = null
  layoutAimOn = false
  if (flight) stopFlight(true)
  if (!m.needsPatch) tourSite = null
  // The surface needs the tiles' manifest first, or the floor would clamp the pose.
  let tilesProvisional = false
  // The Apollo 11 drop starts moving at once, from the current pose, on the base maps: the tiles' manifest and the patch load under it
  // (stepDescent runs the high part without them and creeps at the funnel until the patch is ready). A camera low on another site's floor
  // rises first (below), as before.
  const dropNow = (isSiteDrop(m) || isSiteArrival(m)) && !!m.needsPatch && !instant
    && !(patchSiteId !== m.needsPatch && patchState === 'ready' && rig.pose.dist < 1.05 && !tween)
    && !(patchSiteId && patchSiteId !== m.needsPatch && patchState === 'loading')
  if (dropNow) {
    if (patchSiteId === m.needsPatch && patchState === 'failed' && !afterLoad) dropPatch()
    void ensureTiles().catch(() => undefined)
    void ensurePatch(m.needsPatch as string)
    notifyProgress(true)
  } else if (m.needsTiles && !m.needsPatch && !instant && tilesState !== 'ready' && tilesState !== 'failed') {
    // Not waiting for the manifest: the camera starts now on the base maps. ensureTiles gave the rig the expected (finest) floor, so the plan
    // already ends at about the real one and the floor blend absorbs the residual. Only when the target's real floor differs from the one the
    // plan was made against by more than 0.05 R (a set without deeper levels) is the moment planned again from the live pose; that restarts
    // the velocity from rest mid-move (known risk).
    tilesProvisional = true
    void ensureTiles().then(() => {
      if (seq !== playSeq || !tween) return
      if (Math.abs(closeUpDist(tween.plan.to.pose.lon, tween.plan.to.pose.lat) - tween.floorDist) > 0.05) playMoment(m, instant, true)
    })
  } else if (m.needsTiles && (tilesState === 'idle' || tilesState === 'loading' || (tilesState === 'failed' && !afterLoad))) {
    // The approach over a site needs no tiles: start it now, not when their manifest has arrived.
    if (m.needsPatch && patchSiteId !== m.needsPatch) approachSite(PATCH_SITES[m.needsPatch], m, instant)
    if (tilesState === 'failed') { tilesFailedAt = -1e9 }
    notifyProgress(true)
    void ensureTiles().then(() => { if (seq === playSeq) playMoment(m, instant, true) })
    return
  }
  // No tiles, no surface: the pose would clamp to the 4k floor while the caption still said "900 km up".
  if (m.needsTiles && tilesState !== 'ready' && !tilesProvisional && !dropNow) { approachFor = null; journey.fail(journey.state!.generation); return }
  // A patch is 30 to 50 MB gzipped. The camera does not wait for it: it starts toward the site at once (approachSite), the card shows
  // how much has arrived, and the moment proper (the descent, the flight, the ground) starts from there the moment the patch is ready.
  // `afterLoad` is the call that follows a load: a patch that failed then stays failed (the card offers Retry) instead of looping.
  if (m.needsPatch && !dropNow && (patchSiteId !== m.needsPatch || patchState === 'idle' || patchState === 'loading' || (patchState === 'failed' && !afterLoad))) {
    // Choosing the view again after a failure is a retry: start from a clean slate.
    if (patchSiteId === m.needsPatch && patchState === 'failed') dropPatch()
    // From another site's floor (Apollo 11 to Apollo 17): rise while the new patch loads, so the swap does not drop the camera
    // from a kilometre up to the global floor in one frame.
    let climb = 0
    if (patchSiteId !== m.needsPatch && patchState === 'ready' && rig.pose.dist < 1.05 && !tween) {
      const now = now0()
      flyTo({ pose: { ...rig.pose, dist: 1.36, roll: 0, pitch: 0 } }, now)
      climb = (tween as FlyTween | null)?.plan.ms ?? 0
      climb += 100
      markMoved()
    } else approachSite(PATCH_SITES[m.needsPatch], m, instant)
    const wanted = m.needsPatch
    void new Promise((r) => setTimeout(r, climb)).then(() => seq === playSeq ? ensurePatch(wanted) : undefined).then(() => { if (seq === playSeq) playMoment(m, instant, true) })
    notifyProgress(true)
    return
  }
  if (m.needsPatch && patchState !== 'ready' && !dropNow) { approachFor = null; journey.fail(journey.state!.generation); return }
  approachFor = null
  tourSite = m.needsPatch ?? null
  const now = performance.now()
  const aspect = canvasAspect()
  declareExposureCut()
  const momentTime = m.time()
  // Every moment start is a journey start for the date blend: a tap moves the camera on frame 1 and a ?moment= link (instant) cuts it there (R4).
  beginDateChange(momentTime, PICK_FADE_HOLD_MS, true)
  const shownBefore = last?.ephem ?? ephem
  time = momentTime
  live = !!m.live && !STILL
  ephem = clockSet(time, instant || !DATE_CARRY || STILL)
  rememberTweenRate()
  tween = null
  descent = null
  touched = false
  looking = m.look
  const cam = m.camera
  if (cam.at === 'site') {
    startDescent(m, instant, now, aspect)
    carryDate(shownBefore, instant)
    return
  }
  if (cam.at === 'siteView') {
    startSiteView(m, instant, now)
    carryDate(shownBefore, instant)
    return
  }
  // The archived powered-descent source is retained, but no visitor moment starts it.
  if (cam.at === 'descent') return
  descent = null
  const cinema = getFlight(m)
  if (cinema) {
    // The flight's own lens sizes the floor and the first sample, but the approach must start from the lens the visitor has now
    // (a Plato 42 -> Tycho 36 move eases through planFly instead of cutting on frame 1).
    const lensBefore = rig.fovDeg
    rig.fovDeg = m.fovDeg ?? 50
    if (tilesProvisional && auditFloor === null) rig.setFloor(expectedLoadingFloor())
    applyFloor()
    // The eclipse flight's gaze can be on the Sun, which a fly-to's approach cannot look at: a resume restarts where the gaze is on the Moon's centre.
    if (cinema.kind === 'eclipse') flightStartU = eclipseResumeU(flightStartU)
    const shot = sampleFlight(cinema, flightStartU, ephem, (lon, lat) => rig.floorAt(lon, lat), (lon, lat) => rig.groundAt(lon, lat))
    rig.auto = false
    rig.stopInertia()
    layoutAimOn = false
    // The approach (flyTo below) eases the aim from the one on screen to the flight's 0 (applyTweenSubject); zeroing it here jumped the Moon on frame 1.
    aimRelease = null
    if (instant || AIM_CUT) rig.aimShift = rig.aimShiftX = 0
    if (instant) {
      rig.setPose(shot.pose); rig.fovDeg = shot.fovDeg; rigLook = shot.look
      rig.setLookBlend(shot.look, flightAim(shot, ephem))
    }
    // A fly-to into the flight from its start ends at the flight's own starting speed (the flight leads in at its mean speed), so the camera does not stop at the join (WP7b).
    // Sharp's beat (sharpPrep.ts) holds the camera at the start pose before the flight, so the approach ends at rest, not at the flight's speed.
    const preparing = prepWanted(quality.sharp, { instant, hasTiles: !!TILE_BASE, still: STILL, capture: !!captureSession })
    const joined = !instant && flightStartU === 0 && !preparing
    if (!instant) {
      const endRate = joined ? leadStartRate((v) => sampleFlight(cinema, v, ephem, (lon, lat) => rig.floorAt(lon, lat), (lon, lat) => rig.groundAt(lon, lat), 1).pose, cinema.seconds) : undefined
      rig.fovDeg = lensBefore
      flyTo({ pose: shot.pose, fovDeg: shot.fovDeg, aimShift: 0, aimShiftX: 0, look: shot.look >= 0.5 ? 1 : 0 }, now, undefined, endRate)
    }
    cinematicFlight = { definition: cinema, startU: flightStartU, t0: -1, generation: journey.state!.generation, prefetchAt: -Infinity, pausedU: null, handle: null, lead: joined ? 1 : 0, sunLook: sunGaze(shot) }
    if (preparing) {
      const id = cinema.id
      cinematicFlight.prep = new FlightPrep(prepsDone === 0 ? PREP_MAX_MS_COLD : PREP_MAX_MS, prepsDone === 0, measuredGridFor(id) !== undefined ? null : new SharpWarm(undefined, SHARP_FLIGHT_MAX[id] ?? 1))
    }
    carryDate(shownBefore, instant)
    markMoved()
    return
  }
  const pose = momentPose(cam, ephem)
  // The whole far-side disc is the subject: on a landscape frame 4 radii overflows top and bottom, so it stands at the distance Home frames a whole disc at.
  if (cam.at === 'antiEarth') pose.dist = homeDistFor(restingFrame())
  const fov1 = m.fovDeg ?? (cam.at === 'earth' ? EARTH_VIEW_FOV_DEG : FLY_FOV_DEG)
  rig.auto = false
  if (m.orbit && params.get('auto') !== '0' && !STILL)
    orbitJourney = { t0: -1, lon0: pose.lon, lat: pose.lat, dist: pose.dist, generation: journey.state!.generation, lead: instant ? 0 : 1 }
  // The subject is framed in what the cards leave free (stepLayout), not at a fixed phone offset.
  layoutAimOn = cam.at !== 'earth'
  homeAimMinimal = false
  // A fly-to eases the aim to the end's 0 itself (applyTweenSubject); only a cut drops it.
  aimRelease = null
  if (!layoutAimOn && (instant || AIM_CUT)) { rig.aimShift = 0; rig.aimShiftX = 0 }
  const look: 0 | 1 = m.look === 'earth' ? 1 : 0
  const cutPose = instant
  if (cutPose) {
    rig.setPose(pose)
    rig.fovDeg = fov1
    rigLook = look
    rig.setLookBlend(look, resolveLook('earth'))
  } else {
    // Into the orbit the move ends at the orbit's starting speed (it leads in at its mean speed), not at rest (WP7b).
    const endRate = orbitJourney ? leadStartRate((v) => ({ ...pose, lon: pose.lon + orbitAngleDeg(v, 1) }), ORBIT_SECONDS) : undefined
    flyTo({ pose, fovDeg: fov1, aimShift: layoutAimOn ? rig.aimShift : 0, aimShiftX: layoutAimOn ? rig.aimShiftX : 0, look }, now, undefined, endRate)
  }
  if (instant && rig.auto) rig.lastInputAt = -1e9
  carryDate(shownBefore, instant)
  markMoved()
}
Object.assign(api, {
  playMoment,
  /** Debug: fly to an arbitrary Moon-fixed camera pose. */
  flyToPose: (pose: { lon: number; lat: number; dist: number; pitch?: number; fovDeg?: number }): void => {
    flyTo({ pose: { ...rig.pose, lon: pose.lon, lat: pose.lat, dist: pose.dist, pitch: pose.pitch ?? rig.pose.pitch }, fovDeg: pose.fovDeg ?? rig.fovDeg }, performance.now())
    markMoved()
  },
  /** Debug: hold the running fly-to at progress `u` (0 to 1), or release it (null): frame-by-frame review of a planned path. */
  tweenHold: (u: number | null): void => { tweenHoldU = u; markMoved() },
  /** Debug: the running fly-to's duration, ms, or null. */
  tweenMs: (): number | null => tween?.plan.ms ?? null,
  /** The Labels layer: on or off, the ids on screen, and the last frame's layout (ui/labels.ts debug). */
  labels: {
    set: (on: boolean): void => labelsApi?.setOn(on),
    visible: (): string[] => labelsApi?.visibleIds() ?? [],
    debug: (): unknown => labelsApi?.debug() ?? null,
    stats: (): unknown => labelsApi?.stats() ?? null,
  },
  playPinId: (id: string): boolean => { const h = hotspotList.find((x) => x.id === id); if (!h) return false; playPin(h); return true },
  /** Debug and captures: what the navigator pill names (position, whether the visitor has moved away from it, a queued tap, the list length). */
  navState: () => { const n = navApi?.state(); return n ? { pos: n.state.pos, away: n.state.away, ready: n.ready, queued: n.queued, entries: n.entries.length } : null },
  /** Debug and captures: play a tour by id (the buttons' own path, animated). */
  playMomentId: (id: string, instant = false): boolean => { const m = MOMENTS.find((x) => x.id === id); if (m) playMoment(m, instant); return !!m },
  /** Debug: the camera of the last frame drawn (world frame, Moon radii) and whether ground mode drew it. */
  camState: () => (last ? { pose: { ...rig.pose }, fovDeg: rig.fovDeg, pos: last.cam.pos.toArray(), right: last.cam.right.toArray(), up: last.cam.up.toArray(), back: last.cam.back.toArray(), tanHalf: last.cam.tanHalf, ground: !!groundMode?.active, frame: api.frames, at: lastCamAt } : null),
  /** Debug and captures: the descent flight. `seek(t)` pauses at t; `info()` the state; `cam('chase'|'window')`. */
  flight: {
    seek: (t: number): boolean => { if (!flight) return false; flight.playing = false; flight.rate = 1; flight.seek(t); markMoved(); return true },
    cam: (m: 'chase' | 'window'): void => { if (flight) flight.camMode = m; markMoved() },
    plume: (on: boolean): void => { flightPlume = on; markMoved() },
    /** The module settling after the camera was released: the clock and the model root's height and quaternion (three's axes), or null. */
    settle: () => (settle && groundMode?.lm ? { t: settle.t, y: groundMode.lm.root.position.y, q: groundMode.lm.root.quaternion.toArray() } : null),
    info: () => (flight && flightFrame ? { t: flight.t, regime: flightFrame.regime, blending: flightFrame.blending, camDistM: flightFrame.camDistM, view: { pos: flightFrame.view.pos.toArray(), h: flightFrame.view.headingDeg, p: flightFrame.view.pitchDeg, r: flightFrame.view.rollDeg, tanHalf: flightFrame.view.tanHalf }, lm: flightFrame.lm.pos.toArray(), sample: { alt: flightFrame.sample.altAgl, dust: flightFrame.sample.dust, engine: flightFrame.sample.engine }, ground: !!groundMode?.active, frames: api.frames } : null),
  },
  /** Debug and captures: ground mode. `at` puts the camera at frame metres (east, north, up) heading/pitch/field in degrees, straight away. */
  ground: {
    enter: (): boolean => enterGround(),
    leave: (silent = false): void => leaveGround(silent),
    active: (): boolean => !!groundMode?.active,
    mode: (): GroundMode | null => groundMode,
    at(e: number, n: number, z: number, headingDeg: number, pitchDeg: number, fovDeg = 30): boolean {
      if (!groundMode?.active && !enterGround()) return false
      const g = groundMode as GroundMode
      g.cam.cancelGlide()
      g.cam.view = { pos: new THREE.Vector3(e, n, z), headingDeg, pitchDeg, rollDeg: 0, tanHalf: Math.tan(fovDeg * Math.PI / 360) }
      markMoved()
      return true
    },
    sample: (pts: Array<[number, number]>) => groundMode?.sample(pts) ?? null,
    /** Debug and tests: the module's shadow at frame points (east, north) from the shadow map (gpu) and from a CPU ray cast of the mesh toward the Sun (cpu); 1 light, 0 shadow. */
    shadeCheck(pts: Array<[number, number]>): { gpu: number; cpu: number }[] | null {
      const g = groundMode
      const s = g?.sample(pts)
      if (!g || !s) return null
      const sunL = g.sunInFrame(ephem)
      return pts.map((q, i) => ({ gpu: s[i].lmShade, cpu: g.lmShadeCpu(q[0], q[1], sunL) }))
    },
    setTilt: (mode: 'reported' | 'fit') => { groundMode?.setTilt(mode); markMoved() },
    /** Debug: the direction to the Sun in the site frame (east, north, up; unit), or null outside ground mode. */
    sunL: (): [number, number, number] | null => { const s = groundMode?.sunInFrame(ephem); return s ? [s.x, s.y, s.z] : null },
    /** Debug (`?near=photo`): the baked near field's levels (centre, drawn) and how many level draws it has made; null without the switch. */
    nearBake: (): { draws: number; levels: Array<{ cx: number; cy: number; valid: boolean }> } | null => { const b = groundMode?.pass.nearBake; return b ? { draws: b.draws, levels: b.levels.map((l) => ({ ...l })) } : null },
  },
  patchState: () => patchState,
  /** Debug: which patch revision the credits believe is drawn, against the loaded one, and the shader layout state. */
  patchBinding: () => ({ bound: patchBoundRevision, revision: patch?.revision ?? null, boundLevels: moon.boundLevels, layoutReady: patch ? moon.layoutReady(patch) : null }),
  ensurePatch,
  patchSiteId: () => patchSiteId,
  /** Debug: try another tour end (heading and tilt in degrees); null restores the site's. */
  setEnd(h: number | null, p = 78, altFactor = 1): void { endOverride = h === null ? null : { headingDeg: h, pitchDeg: p, altFactor }; markMoved() },
  /** Debug: a frame of the descent at progress u (0 to 1), straight there: the Earth view's dolly is skipped, it starts from the 4.5 radii view over the site. */
  descentAt(u: number): void {
    descent = null
    const { lon, lat } = siteLonLat()
    const from: Pose = { lon, lat, dist: 4.5, roll: 0, pitch: 0 }
    const alt0 = 3.5
    rig.setPose(descentPose(u, from, alt0))
    rig.fovDeg = FLY_FOV_DEG
    rig.aimShift = 0
    rig.aimShiftX = 0
    markMoved()
  },
  /** Debug: the descent frame whose altitude above the ground is `altKm` (found by bisection on progress). */
  descentAtAlt(altKm: number): number {
    const alt1 = rig.site ? rig.site.altR : 1e-3
    const target = Math.log(altKm / MOON_R_KM)
    let lo = 0, hi = 1
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      const a = Math.log(3.5) + (Math.log(alt1) - Math.log(3.5)) * smooth(mid)
      if (a > target) lo = mid; else hi = mid
    }
    ;(api.descentAt as (u: number) => void)((lo + hi) / 2)
    return (lo + hi) / 2
  },
  /** Debug: scales the patch's weight in the shader (0 shows the tiles and 4k maps only). */
  setPatchBlend(v: number): void { moon.uniforms.uPatchBlend.value = v; markMoved() },
  tilesState: () => tilesState,
  /** Debug: scales the tiles' weight in the shader (0 shows the 4k maps only). */
  setTileBlend(v: number): void { moon.uniforms.uTileBlend.value = v; markMoved() },
  /** Debug: 0 = the old 32-step shadow march everywhere, 1 = the tile march where tiles are drawn. */
  setMarch(v: number): void { moon.uniforms.uTileMarch.value = v; markMoved() },
  /** Debug: loses the WebGL context (and gives it back after `restoreAfterMs`), to watch the page recover. */
  loseContext(restoreAfterMs = 500): boolean {
    const ext = renderer.getContext().getExtension('WEBGL_lose_context')
    if (!ext) return false
    ext.loseContext()
    setTimeout(() => ext.restoreContext(), restoreAfterMs)
    return true
  },
  /** Debug: the terrain march's budget: steps, smallest-step divisor, and whether the shell is cut to the tiles' extremes (the 2026-09-29 march was 48, 40, false). */
  setTerrainMarch(iter: number, minDiv: number, bounded = true): void {
    moon.uniforms.uTerrIter.value = iter
    moon.uniforms.uTerrMinDiv.value = minDiv
    moon.uniforms.uTerrBounded.value = bounded ? 1 : 0
    markMoved()
  },
  /** Debug: true keeps the ground hit on the sphere (no relief parallax, no relief limb). */
  setTerrainOff(off: boolean): void { moon.terrainOff = off; markMoved() },
})

// ---------------------------------------------------------------------------
// The site's controls: time, where to look, and a link to share.
// ---------------------------------------------------------------------------
/** Where the view is turned: what the buttons show as pressed. */
let looking: 'moon' | 'earth' | 'sun' = 'moon'
/** True once the visitor has changed the time or grabbed the Moon since the last moment started. */
let touched = false
const changeListeners: Array<() => void> = []
let lastSig = ''
function notifyChange(): void {
  const sig = `${time.getTime()}|${live}|${looking}`
  if (sig === lastSig) return
  lastSig = sig
  for (const cb of changeListeners) cb()
}

function shareUrl(): string {
  // The hand turn is a visitor-local view gesture; share URLs always describe the Moon's real ephemeris geometry.
  // A shell's own origin is not a Moon link: a native share names the website's page (deepLink.ts).
  const cur = new URL(NATIVE_BUILD ? MOON_PAGE : location.href)
  cur.searchParams.delete('topography')
  if (labelsApi?.isOn()) cur.searchParams.set('labels', '1'); else cur.searchParams.delete('labels')
  // An archive moment untouched since it started is best shared as itself: it carries a lens and a look.
  if (cur.searchParams.get('moment') && !touched) return cur.href
  const u = new URL(cur.origin + cur.pathname)
  if (labelsApi?.isOn()) u.searchParams.set('labels', '1')
  if (ridge) { u.searchParams.set('start', 'ridge'); return u.href }
  // The archive's descent flight owns its own camera and clock: only the flight itself reopens it.
  const gm = groundMode?.active ? groundMode : null
  const site = patchSiteId ? PATCH_SITES[patchSiteId] : null
  // Every view reopens as seen (ui/shareView.ts): the pose, the lens, which way it is turned, and at a landing site the site to load first.
  const gv = gm?.cam.view
  const pin = sitePin({
    patchSite: patchSiteId, patchReady: patchState === 'ready', ground: !!gm, dist: rig.pose.dist, floor: D_MIN,
    near: !!site && angularDistance(rig.pose.lon, rig.pose.lat, site.lon, site.lat) < PATCH_PREWARM_ARC,
  })
  const earthLook = rig.earthLook
  for (const [k, v] of shareParams({
    autoOff: params.get('auto') === '0', live, time, layoutAim: layoutAimOn && !gm,
    pose: rig.pose as { lon: number; lat: number; dist: number; roll: number; pitch: number }, fovDeg: rig.fovDeg, defaultFovDeg: FLY_FOV_DEG,
    pitchFelt: rig.tiltFelt(),
    look: rig.looksAt(SUN_LOOK) ? { kind: 'sun' } : earthLook > 0 ? { kind: 'earth', w: earthLook } : null,
    free: rig.freeOrientation(), pin,
    ground: gv ? { e: gv.pos.x, n: gv.pos.y, z: gv.pos.z, heading: gv.headingDeg, pitch: gv.pitchDeg, roll: gv.rollDeg, tanHalf: gv.tanHalf, walk: gm?.cam.mode === 'walk' } : null,
    viewpoint,
  })) u.searchParams.set(k, v)
  return u.href
}

function clearMomentUrl(): void {
  const u = new URL(location.href)
  if (u.searchParams.has('moment')) { u.searchParams.delete('moment'); history.replaceState(null, '', u) }
}

/**
 * Sets the moment shown (the bar's time slider and Now, the N key): stops any scripted move, crossfades the date, keeps the camera.
 * `isLive` follows the clock from here on.
 */
function setClock(d: Date, isLive: boolean): void {
  // A date change does not cancel a pin's journey (a journey stopped by it once left the camera stranded over the pole): it carries on.
  stopMoments('clock')
  beginDateChange(d)
  dropRidge()
  declareExposureCut()
  time = d
  live = isLive && !STILL
  lastLiveTick = performance.now()
  ephem = clockSet(d)
  touched = true
  clearMomentUrl()
  toursApi?.demote()
  markMoved()
  notifyChange()
}



// ---------------------------------------------------------------------------
// Hotspots: the pins on the Moon and the sheet list the same places; choosing one is a planned fly-to with a caption.
// ---------------------------------------------------------------------------
let hotspotList: Hotspot[] = []
/** Set by the pill's Return for the one flight it restarts: the progress that flight was left at. */
let resumeRequest: FlightLeft | null = null
/** Whether the navigator's list can show this step in this build (asked once the site probe is done). */
function navHas(a: NavAction): boolean {
  switch (a.kind) {
    case 'pin': return hotspotList.some((h) => h.id === a.id)
    case 'moment': return MOMENTS.some((m) => m.id === a.id)
    case 'ridge': return true
    case 'panorama': return hotspotList.some((h) => h.id === 'pin-apollo17')
    case 'ground': return hotspotList.some((h) => h.id === 'pin-apollo17-eye')
    // The climb out exists only from the Apollo 17 ground: the navigator may ask this to learn whether ‹ is ground-local (viewpointList prevMoveFrom's `onGround`).
    case 'orbit': return onApollo17Ground()
  }
}
/** The visitor stands on the Apollo 17 ground (the ground view, or a panorama opened from it): every step of that entry is then ground-local (#10). */
function onApollo17Ground(): boolean {
  return !!groundMode?.active && patchSiteId === 'a17'
}
/**
 * What a navigator step does. Moments go through the tours (the ?moment= history entry); pins through the pin path. On the Apollo 17 ground (#10) every step
 * of that entry is ground-local: Eye level is a glide, a panorama opens where the visitor stands, ‹ at the first step ('orbit') is the climb out; the flight
 * to the site runs again only for `replay` (the explicit "fly there again"), never for Return or ‹.
 */
function runNavAction(a: NavAction, opts?: { resume?: boolean; replay?: boolean }): void {
  resumeRequest = opts?.resume ? flightLeft : null
  switch (a.kind) {
    case 'pin': { const h = hotspotList.find((x) => x.id === a.id); if (h) playPin(h); break }
    case 'moment':
      // The caption under the pill describes a place; a flight or a view of another entry does not share it.
      if (pinShown && navApi?.state().entries[navApi.state().state.pos?.entry ?? -1]?.id !== pinShown.h.id) { pinShown = null; caption.clear() }
      toursApi?.open(a.id); resumeRequest = null; break
    case 'ridge': openRidge(); break
    case 'panorama':
      // On the ground the panorama is an overlay over the retained ground pose: no climb, no flight, no second descent (openPanoramaFlight left the ground when the visitor had walked off the viewpoint).
      if (onApollo17Ground() && !opts?.replay) { clearPendingPanorama(); navApi?.noteSelected(a); navApi?.closeSheet(); panoramaUi?.open(a.id as ApolloPanorama['id']); break }
      openPanoramaFlight(a.id as ApolloPanorama['id']); break
    case 'ground': {
      // Already on the ground: a short glide to the eye view (Return after a walk, ‹ from a panorama); a module that did not load is fetched again first. Never the flight again from here.
      if (groundMode?.active && !flight && !opts?.replay) {
        const g = groundMode
        if (g.lm) { goViewpoint('eye'); break }
        lmLoadFailed = false
        void g.loadLm(ephem, canvasAspect()).then(() => { if (g.active) goViewpoint('eye') }).catch((err) => { console.warn('Lunar module unavailable:', (err as Error).message); lmLoadFailed = true; if (g.active) showLmFailure(g, 'eye') })
        break
      }
      // Otherwise the pin that ends at eye level; `replay` stamps the whole arrival (startSiteView: no direct glide, the hold even from low and close).
      const h = hotspotList.find((x) => x.id === 'pin-apollo17-eye')
      if (h) { if (opts?.replay) arrivalReplayAt = performance.now(); playPin(h) }
      break
    }
    case 'orbit':
      // ‹ at the entry's first step on the ground: up to the overview over the module and stop there; the pill dims and offers Return (a glide back down). From orbit there is nothing to climb out of.
      // The journey is cancelled first (its deferred eye glide, beginLanding's loadLm.then, must not pull the camera back down during the climb; approachFor clears).
      if (groundMode?.active) { takeCurrentScriptCamera('other', true); leaveGround(false, () => navApi?.away(), true) }
      break
  }
}
/** How far the data of the step on screen has got, as the pill's small line, or null. */
function navStatus(a: NavAction): string | null {
  const m: Moment | undefined = a.kind === 'pin' ? hotspotList.find((h) => h.id === a.id)
    : a.kind === 'moment' ? MOMENTS.find((x) => x.id === a.id)
    : a.kind === 'ground' ? hotspotList.find((h) => h.id === 'pin-apollo17-eye')
    : undefined
  if (!m) return null
  const bad = momentUnavailable(m)
  if (bad) return bad
  // The pill has no bar: a known fraction rides in the line, so a long load (the Apollo 17 height band, 22 MB) visibly moves (owner walkthrough 2026-10-31).
  const p = momentProgress(m)
  return p ? progressLine(p.text, p.fraction) : null
}
let pinsApi: ReturnType<typeof mountPins> | null = null
/** First-visit hotspots (ui/firstHotspots*.ts): made only for a first load, and its DOM only once the intro has landed. */
let firstHotspotsApi: FirstHotspotsApi | null = null
let labelsApi: ReturnType<typeof mountLabels> | null = null
let routesApi: ReturnType<typeof mountRoutes> | null = null
/** The Apollo paths (descent line, landing dot, "tap the line" label) are not part of the visitor's views: they draw in free views only in the archive or when the debug sheet's toggle is on. A fly-along started by `routes.play` still shows its own line. */
let routesShown = ARCHIVE

// ---------------------------------------------------------------------------
// Fly-along: a click on an Apollo path flies the camera along it. The camera is a pure function of the show's progress
// (routes.ts routeShot) read from the wall clock, so the frame rate cannot change the path; any gesture of the visitor ends it.
// ---------------------------------------------------------------------------
Object.assign(api, {
  /** Debug and the touch-controls rig check: the selenographic point under a frame spot (NDC), the Moon centre's frame spot, the view's free orientation. */
  touch: {
    moonAt: (nx: number, ny: number): [number, number] | null => { const P = rig.pickMoon(nx, ny, ephem, canvasAspect(), performance.now()); if (!P) return null; const ll = lonLatOfDir(ephem, P); return [ll.lon, ll.lat] },
    centre: (): { x: number; y: number; z: number } | null => {
      const cam = rig.camera(ephem, canvasAspect(), performance.now())
      const d = cam.pos.clone().negate(), z = -d.dot(cam.back)
      return { x: d.dot(cam.right) / z / (cam.tanHalf * canvasAspect()), y: d.dot(cam.up) / z / cam.tanHalf, z }
    },
    free: (): boolean => rig.hasScriptState(),
  },
})
Object.assign(api, {
  /** Debug and captures: `routes.play(id)` starts a fly-along; `routes.state()` reads its phase, the clock and whether the idle orbit is on. */
  routes: {
    play: (id: string): boolean => { const r = ROUTES.find((x) => x.id === id); if (!r) return false; startRouteFlight(r); return true },
    state: () => ({ active: routeFlight !== null || routeStarting, phase: routeFlight?.phase ?? null, pitch: rig.pose.pitch, roll: rig.pose.roll, dist: rig.pose.dist, lon: rig.pose.lon, lat: rig.pose.lat, lapsing: !!routeFlight?.lapse, time: time.toISOString(), auto: rig.auto }),
  },
})
interface RouteFlight { route: Route; pts: number[][]; cum: number[]; t0: number; ms: number; phase: 'approach' | 'along'; /** The approach's daylight time-lapse: the clock runs from `from` to `to` (ms) while the camera arrives; `lastCaptionAt` throttles the caption's clock line. */ lapse: { from: number; to: number; lastCaptionAt: number } | null; /** The tween the show itself started (any other tween is another owner's and ends the show). */ tween: unknown; view: RouteView }
let routeFlight: RouteFlight | null = null
/** The caption's line: what the flight is doing, then the path's provenance. No date on the main view (owner 2026-10-07); the Time sheet has it. */
function routeSentence(r: Route, _shown: Date, lapsing: boolean): string {
  const doing = lapsing ? 'Flying to the path as daylight reaches it.' : 'Flying along the path.'
  return `${doing} ${r.estimated ? 'The path is the model’s; only the touchdown is a measured position.' : 'Following the mapped route.'}`
}
/** Seconds of the show: 14 for a route of rover loops, up to 26 for the 570 km descent. */
const routeSeconds = (km: number): number => Math.max(14, Math.min(26, 10 + km / 30))
function startRouteFlight(r: Route): void {
  moonSurfaceTurn.stopInertia()
  resetScrubEnding()
  bar?.closeSheets(); dropRidge(); cancelRoute()
  // The previous pin's move (or a hover over its site) must not hold the camera: routeOwnerCheck cancels the show on any tween that is not its own (review P1-3).
  takeCurrentScriptCamera()
  descent = null; approachFor = null; orbitJourney = null; pinShown = null; homeFrame = false
  // v2: Home's minimal aim belongs to Home's framing; this move frames its subject in the cards' free rect again.
  homeAimMinimal = false
  const seq = routeSeq
  const play = playSeq
  const pts = flatten(r), cum = cumulativeKm(pts)
  const km = cum[cum.length - 1]
  const site = PATCH_SITES[r.mission]
  // The camera starts the show over the previous site (Apollo 11): without this the per-frame "nearest site" loader swapped the route's own patch for that one
  // the moment it arrived, so the follow flew over the wrong site's floor at 75 km (found on the rig, review P1-3).
  tourSite = site?.id ?? null
  // Owner rule: one continuous flight, no fades. The date is never swapped; a dark site is lit by running the clock forward during the approach (see `lapse`).
  caption.show(r.name, routeSentence(r, time, false))
  routeCaption = true
  routesApi?.setActive(r.id)
  routeStarting = true
  void (async () => {
    try {
      await ensureTiles()
      if (seq !== routeSeq || play !== playSeq) return
      if (site) await ensurePatch(site.id).catch(() => undefined)
      if (seq !== routeSeq || play !== playSeq) return
      const view = { overviewDist: overviewDistFor(km, FLY_FOV_DEG), followDist: 1 + Math.max(1, Math.min(40, 0.025 * km)) / MOON_R_KM, endDist: 1.0006, seconds: routeSeconds(km), floorAt: (lon: number, lat: number) => rig.floorAt(lon, lat) + 0.00004 }
      const rf: RouteFlight = { route: r, pts, cum, t0: 0, ms: routeSeconds(km) * 1000, phase: 'approach', view, tween: null, lapse: null }
      routeFlight = rf
      routeStarting = false
      rig.auto = false
      const s0 = routeShot(pts, cum, 0, view)
      // Owner rule: no fades. A site that is dark (or lit by another Sun than its photograph's) is brought into the photograph's daylight
      // by running the clock forward, continuously, over the approach: the Sun moves in the frame, nothing is cross-faded. The approach
      // is slowed to a pace the Sun can keep (about 4 days a second at most).
      const target = site ? daylightTarget(site.lon, site.lat, time, photoSun(site.lon, site.lat, site.photoTime)) : null
      const approachMs = target ? lapseApproachMs((target.to.getTime() - time.getTime()) / 86_400_000) : undefined
      if (target) { rf.lapse = { from: time.getTime(), to: target.to.getTime(), lastCaptionAt: -1e9 }; live = false; lastLiveTick = performance.now() }
      flyTo({ pose: { lon: s0.lon, lat: s0.lat, dist: s0.dist, roll: 0, pitch: 0 }, fovDeg: FLY_FOV_DEG, aimShift: 0, aimShiftX: 0, look: 0 }, performance.now(), approachMs)
      rf.tween = tween
      markMoved()
    } catch (e) {
      console.warn('Route unavailable:', (e as Error).message)
      if (seq === routeSeq) cancelRoute()
    }
  })()
}
/** Bumped by every camera-owning entry: a route start still awaiting its tiles sees the change and gives up. */
let routeSeq = 0
let routeStarting = false
/** Every other camera owner calls this first (Home, pins, labels, ridge, fly-to-point): the show ends, its caption and label with it. */
let routeCaption = false
function cancelRoute(): void {
  routeSeq++
  const had = routeFlight !== null || routeStarting
  // The caption the show put up goes with it (a cancelled show must not keep saying "Flying along the path").
  if (routeCaption) { routeCaption = false; caption.clear() }
  routeFlight = null
  routeStarting = false
  if (had) routesApi?.setActive(null)
}
/** Per frame; true while it moves the camera. */
function stepRoute(now: number): boolean {
  const rf = routeFlight
  if (!rf) return false
  // Another camera owner took over: the show ends rather than fighting it (and rather than resuming under it later).
  const owner = routeOwnerCheck({ ridge: !!ridge, descent: !!descent, flight: !!flight, ground: !!groundMode?.active, orbitJourney: !!orbitJourney, approach: approachFor !== null, tween, ownTween: rf.tween, phase: rf.phase })
  if (owner === 'cancel') { cancelRoute(); return false }
  if (rf.lapse) {
    // The approach's tween sets the pace of the clock: progress 0 to 1 of the same flight, eased, so the Sun arrives with the camera.
    const u = rf.phase === 'approach' && rf.tween ? tweenProgress(rf.tween as FlyTween, now) : 1
    const ms = lapseClockMs(rf.lapse.from, rf.lapse.to, u)
    time = new Date(ms); ephem = clockSet(time)
    markMoved()
    if (now - rf.lapse.lastCaptionAt > 200 || u >= 1) {
      rf.lapse.lastCaptionAt = now
      caption.show(rf.route.name, routeSentence(rf.route, time, u < 1))
    }
    if (u >= 1) rf.lapse = null
  }
  if (rf.phase === 'approach') {
    if (owner === 'wait') return false
    rf.phase = 'along'; rf.t0 = now
  }
  const u = Math.min(1, (now - rf.t0) / rf.ms)
  const s = routeShot(rf.pts, rf.cum, u, rf.view)
  rig.setPose({ lon: s.lon, lat: s.lat, dist: s.dist, roll: s.roll, pitch: s.pitch })
  if (u >= 1) {
    // The shot ends where the camera stands (the landing site's close-up, tipped toward the horizon): no second move, no cut.
    routeFlight = null
    routeCaption = false
    routesApi?.setActive(null)
    rig.lastInputAt = now
    // The show turned the idle orbit off for its own move; it is the visitor's setting again once the show has ended.
    rig.auto = idleOrbitOn(params, STILL)
  }
  return true
}
let panoramaUi: ReturnType<typeof mountPanoramaViewer> | null = null
let heatApi: ReturnType<typeof mountDebugHeat> | null = null

/** Fly through Apollo 17's pin journey before showing the panorama. A touch cancels both. */
function openPanoramaFlight(id: ApolloPanorama['id'], instant = false): void {
  navApi?.noteSelected({ kind: 'panorama', id })
  clearPendingPanorama()
  if (instant) { panoramaUi?.open(id); return }
  if (groundMode?.active && patchSiteId === 'a17' && viewpoint && !groundMode.cam.gliding) { panoramaUi?.open(id); return }
  if (groundMode?.active) { leaveGround(false, () => openPanoramaFlight(id)); return }
  const h = hotspotList.find((x) => x.id === 'pin-apollo17')
  if (!h) return
  navApi?.closeSheet()
  playPin(h)
  navApi?.noteSelected({ kind: 'panorama', id })
  const state = journey.state
  if (!state) { panoramaUi?.open(id); return }
  pendingPanorama = { id, generation: state.generation }
}

/** What a link's view keeps of its share: the roll and pitch, the lens and whether the Earth is the look. */
function carryOf(share: ShareStart): LinkCarry {
  return { roll: share.pose.roll ?? 0, pitch: share.pose.pitch ?? 0, fovDeg: share.fovDeg, earth: share.look?.kind === 'earth' }
}
/** A warm link's flight end: its pose, roll and pitch (pitch clamped as applyShareView clamps it), lens and Earth look (FlyEnd's look is 0 or 1). */
function carryEnd(lon: number, lat: number, dist: number, c: LinkCarry): Parameters<typeof flyTo>[0] {
  return { pose: { lon, lat, dist, roll: c.roll, pitch: Math.max(0, Math.min(PITCH_MAX, c.pitch)) }, fovDeg: c.fovDeg ?? FLY_FOV_DEG, aimShift: 0, aimShiftX: 0, look: c.earth ? 1 : 0 }
}
/** A warm link's `t`: the date changes with the same fade gotoTerminator uses, and the clock stops (as a cold start with t does). */
function applyLinkTime(d: Date): void {
  beginDateChange(d, FADE_HOLD_MS)
  time = d; live = false; ephem = clockSet(d)
}
/** The closest a camera may come over a point: the tiles' floor, or the loaded site's funnel where its patch is (rig.floorAt), a few metres above (additive: a multiple of the radius is tens of kilometres) so the clamp never fights the move. */
function closeUpDist(lon: number, lat: number): number {
  return rig.floorAt(lon, lat) + 0.00004
}
const PATCH_HOTSPOT: Record<string, string> = { a11: 'pin-apollo11', a17: 'pin-apollo17' }
/** What a warm link keeps of its view when it flies: the roll and pitch, the lens, the Earth look and the time. */
interface LinkCarry { roll: number; pitch: number; fovDeg: number | null; earth: boolean }
/** Flies to a point as close as the imagery there supports: a site with a patch through its own pin, anywhere else to the tiles' floor. `carry` (a warm link) flies to its exact pose instead of the pin. */
function flyToPoint(lon: number, lat: number, name: string, sub: string, siteId: string | null, farDist?: number, carry?: LinkCarry): void {
  clearPendingPanorama()
  pendingLanding = null
  cancelRoute()
  stopMoments()
  if (groundMode?.active) { leaveGround(false, () => flyToPoint(lon, lat, name, sub, siteId, farDist, carry)); return }
  cancelPendingWheelZoom()
  const pinId = siteId ? PATCH_HOTSPOT[siteId] : undefined
  const h = pinId ? hotspotList.find((x) => x.id === pinId) : undefined
  if (h && !carry) { playPin(h); return }
  bar?.closeSheets(); dropRidge()
  navApi?.clear()
  descent = null; approachFor = null; orbitJourney = null; pinShown = null; homeFrame = false
  caption.show(name, sub)
  const seq = ++playSeq
  void ensureTiles().then(() => {
    // The visitor moved on while the tiles loaded: this move is no longer theirs.
    if (seq !== playSeq) return
    const now = performance.now()
    const dist = Math.max(farDist ?? 0, closeUpDist(lon, lat))
    // Look at the selected feature. Tilting a camera directly above it by 35°
    // moved the arrival onto a different crater (Ptolemaeus arrived at Herschel).
    // v2: Home's minimal aim belongs to Home's framing; this move frames its subject in the cards' free rect again (set with the move, not while the tiles load).
    homeAimMinimal = false
    flyTo(carry ? carryEnd(lon, lat, dist, carry) : { pose: { lon, lat, dist, roll: 0, pitch: 0 }, fovDeg: FLY_FOV_DEG, aimShift: 0, aimShiftX: 0, look: 0 }, now)
    markMoved()
  }).catch((e) => { console.warn('Fly-to unavailable:', (e as Error).message); if (seq === playSeq) caption.clear() })
}
function flyToLabel(l: MoonLabel): void {
  const sub = l.kind === 'site' ? `${l.year}${l.status === 'crashed' ? ', crashed' : ''}` : l.kind === 'mare' ? 'Sea' : l.kind === 'range' ? 'Mountains' : 'Crater'
  // Frame the named feature's diameter with margin; the imagery floor still wins.
  flyToPoint(l.lon, l.lat, l.name, sub, l.patchSite ?? null, featureViewDistance(l.sizeKm, FLY_FOV_DEG, canvasAspect()))
}
/** The caption's second line for a label on arrival. */
const LABEL_SUB: Record<ShownLabel['kind'], string> = { mare: 'Sea', crater: 'Crater', mountain: 'Mountains', valley: 'Valley', point: '', mission: '', terminator: 'Where day meets night' }
/** A label of the Labels layer was chosen: the cinematic fly-to (journey/path.ts), its area lit while the camera travels. */
function flyToShownLabel(l: ShownLabel): void {
  setHighlight(l, true)
  if (l.kind === 'terminator') { flyToTerminator(l.lon, l.lat); return }
  const site = l.kind === 'mission' ? SITES.find((s) => s.id === l.id)?.patchSite ?? null : null
  const sub = l.kind === 'mission' ? `${l.year} · ${l.agency}` : l.sub ?? LABEL_SUB[l.kind]
  flyToPoint(l.lon, l.lat, l.name, sub, site, l.sizeKm > 0 ? featureViewDistance(l.sizeKm, FLY_FOV_DEG, canvasAspect()) : undefined)
}
/**
 * Flies to the terminator at (lon, lat): low over the sunlit side, tilted to look across the line toward the night with the Sun
 * behind the camera, so the shadows run away from the viewer and the line sits mid-frame (labels/terminator.ts).
 */
function flyToTerminator(lon: number, lat: number): void {
  clearPendingPanorama()
  pendingLanding = null
  cancelRoute()
  stopMoments()
  if (groundMode?.active) { leaveGround(false, () => flyToTerminator(lon, lat)); return }
  cancelPendingWheelZoom()
  bar?.closeSheets(); dropRidge()
  navApi?.clear()
  descent = null; approachFor = null; orbitJourney = null; pinShown = null; homeFrame = false
  caption.show('Terminator', 'Where day meets night')
  const seq = ++playSeq
  void ensureTiles().then(() => {
    if (seq !== playSeq) return
    const sun = unitOf(ephem.subSolar.lon, ephem.subSolar.lat), point = unitOf(lon, lat)
    let pose = terminatorView(sun, point, 1.09)
    const floor = closeUpDist(pose.lon, pose.lat)
    if (floor > pose.dist) pose = terminatorView(sun, point, floor)
    // v2: Home's minimal aim belongs to Home's framing; this move frames its subject in the cards' free rect again (set with the move, not while the tiles load).
    homeAimMinimal = false
    flyTo({ pose, fovDeg: FLY_FOV_DEG, aimShift: 0, aimShiftX: 0, look: 0 }, performance.now())
    markMoved()
  }).catch((e) => { console.warn('Fly-to unavailable:', (e as Error).message); if (seq === playSeq) caption.clear() })
}

// ---- The Labels layer's highlight: the hovered feature's area lights up on the Moon (moonShader.ts uHl*), and the place
// chosen stays lit while the camera flies there and a moment after it arrives.
const HL_SEAS_LIST = CURATED.filter((l) => l.kind === 'mare')
const HL_SEA_UNITS: Array<[number, number, number, number]> = HL_SEAS_LIST.map((l) => [...unitOf(l.lon, l.lat), Math.max(0.004, l.sizeKm / 2 / MOON_R_KM)])
let hlSeasSent = false
let hlHover: ShownLabel | null = null
let hlSticky: { l: ShownLabel; arrivedAt: number } | null = null
let hlShown: ShownLabel | null = null
let hlStrength = 0
let hlLastAt = 0
const hlGate = new HighlightGate()
/** Sets the hovered label (`sticky` false) or the flown-to one (`sticky` true); null clears that one. */
function setHighlight(l: ShownLabel | null, sticky: boolean): void {
  if (sticky) hlSticky = l ? { l, arrivedAt: Infinity } : null
  else hlHover = l
  markDirty()
}
function hasHighlightArea(l: ShownLabel): boolean {
  return l.kind !== 'terminator' && l.kind !== 'mission' && l.kind !== 'point' && l.sizeKm > 0
}
function stepHighlight(now: number): void {
  if (!moon) return
  const dt = hlLastAt ? Math.min(64, now - hlLastAt) : 16
  hlLastAt = now
  if (hlSticky) {
    // The flown-to place stays lit through the flight and 1.6 s after it lands.
    if (!tween && !Number.isFinite(hlSticky.arrivedAt)) hlSticky.arrivedAt = now
    if (now - hlSticky.arrivedAt > 1600) hlSticky = null
  }
  const want = labelsApi?.isOn() ? hlHover ?? hlSticky?.l ?? null : null
  // A new target fades the old one out first, then the new one in (no jump from one area to another).
  if (want && hlShown && want.id !== hlShown.id && hlStrength > 0) hlStrength = Math.max(0, hlStrength - dt / 160)
  else {
    if (want && (!hlShown || want.id !== hlShown.id)) hlShown = want
    const target = want ? 1 : 0
    hlStrength = target > hlStrength ? Math.min(1, hlStrength + dt / 260) : Math.max(0, hlStrength - dt / 360)
  }
  if (hlStrength <= 0 && !want) {
    if (hlShown) {
      hlShown = null
      if (hlGate.changed([0, 1, 0, 0.01, 0, -1])) { moon.setHighlight(0, [1, 0, 0], 0.01); markDirty() }
    }
    return
  }
  if (!hlShown) return
  const l = hlShown
  // Only a feature with an area lights up: a landing site or a named point has none, and a disc drawn for one read as a blob.
  if (!hasHighlightArea(l)) {
    if (hlGate.changed([0, 1, 0, 0.01, 0, -1])) { moon.setHighlight(0, [1, 0, 0], 0.01); markDirty() }
    return
  }
  const sea = l.kind === 'mare' ? HL_SEAS_LIST.findIndex((x) => x.id === l.id) : -1
  const r = Math.max(4, l.sizeKm / 2) / MOON_R_KM
  const centre = unitOf(l.lon, l.lat)
  const strength = hlStrength * (last ? highlightFit(centre, r, last.cam.pos, last.cam.tanHalf, ephem, sea >= 0, frameAspect || 1) : 1)
  if (hlGate.changed([strength, centre[0], centre[1], centre[2], r, sea])) {
    moon.setHighlight(strength, centre, r, sea, hlSeasSent ? undefined : HL_SEA_UNITS)
    hlSeasSent = true
    markDirty()
  }
}

function flyToCoverage(lon: number, lat: number, siteId: string | null): boolean {
  // Only a site with a patch in PATCH_SITES can draw its fine pictures; a hosted region for any other site changes the map, not the picture.
  if (!siteId || !PATCH_SITES[siteId]) return false
  flyToPoint(lon, lat, 'Fine imagery', `Site ${siteId}`, siteId)
  return true
}
/** The pin whose caption is showing, and the place it is at: the caption goes when the visitor has wandered off. */
let pinShown: { h: Hotspot; /** The caption title: the place, and the date when the move sets the clock. */ title: string; lon: number; lat: number; at: number; moving: boolean } | null = null
/** Home's caption waits for the picture: the Home line stays hidden until the move home has arrived. */
let homeCaptionHeld = false
function playPin(h: Hotspot): void {
  firstHotspotsApi?.noteFlight(h.id)
  // A tap on a pin is the visitor asking for this place now: the idle prefetch steps aside for what the move itself needs.
  if (TILE_BASE) prefetcherFor(TILE_BASE).cancel('idle')
  bar?.closeSheets()
  toursApi?.demote()
  // The craters and Earthrise are flights in the list: their pins play the flight (the pill names it) instead of a still.
  const flightId = PIN_MOMENT[h.id]
  if (flightId && navHas({ kind: 'moment', id: flightId })) { runNavAction({ kind: 'moment', id: flightId }); return }
  clearMomentUrl()
  playMoment(h, false)
  // The Apollo 17 eye-level pin is the list's "Eye level" step, not an entry of its own.
  navApi?.noteSelected(h.id === 'pin-apollo17-eye' ? { kind: 'ground', id: 'eye' } : { kind: 'pin', id: h.id })
  // The caption is visible in the first frame after the tap and holds for the whole move.
  // Owner 2026-10-07: no date or time on the main view. The Time sheet show it; the caption names the place only.
  const when = h.time()
  const title = h.title
  // The pill names the place; under it the caption keeps one short sentence about it, never the name again.
  if (navApi) caption.show(firstSentence(h.caption), '')
  else caption.show(title, h.caption)
  // Where the camera will be, not where the pin is drawn: Earthrise's pin sits on the limb while its camera is over the far side.
  const cam = h.camera
  const at = cam.at === 'site' || cam.at === 'siteView' || cam.at === 'descent' ? h.pin(ephem) : momentPose(cam, clockEphemerisAt(when))
  pinShown = { h, title, lon: at.lon, lat: at.lat, at: performance.now(), moving: false }
  homeCaptionHeld = false
}
/** Apollo 11's ring at the lander's measured position, over the photograph (the lander is a few pixels: a ring, not a drawn module). */
function updateSiteRing(aspect?: number, vw?: number, vh?: number): void {
  if (!siteRingUi) return
  const a11 = PATCH_SITES.a11
  const on = pinShown?.h.id === 'pin-apollo11' && patchSiteId === 'a11' && patchState === 'ready' && !tween && !descent && !groundMode?.active && !flight && rig.pose.dist < 1.01 && !!last
  if (!on || !last) { siteRingUi.update(null); return }
  const dir = selenoUnit(a11.lon, a11.lat, ephem)
  const r = 1 + a11.groundM / (MOON_R_KM * 1000)
  siteRingUi.update(projectWorldPoint(last.cam, aspect ?? canvasAspect(), { x: dir.x * r, y: dir.y * r, z: dir.z * r }, vw ?? window.innerWidth, vh ?? window.innerHeight))
}
/** While a pin's data is on its way the caption says how much has arrived (never a spinner); a failure says so and where to tap again. */
let pinCaptionKey = ''
function updatePinCaption(): void {
  const ps = pinShown
  if (!ps) { pinCaptionKey = ''; return }
  const bad = momentUnavailable(ps.h)
  const prog = bad || !(patchState === 'loading' || tilesState === 'loading') ? null : momentProgress(ps.h)
  const sentence = bad ? bad : prog ? prog.text : ps.h.caption
  const status = !!bad || !!prog
  const key = `${ps.h.id}|${status}|${sentence}`
  if (key === pinCaptionKey) return
  pinCaptionKey = key
  // A failed load offers its Retry in the caption itself: the pin may be off-screen, behind the limb or under this very caption.
  // With the pill on screen the loading line and the failure text live in the pill; the caption keeps the sentence and the Try again chip.
  if (navApi) caption.show(firstSentence(ps.h.caption), '', bad ? { label: 'Try again', run: () => retryMoment(ps.h) } : undefined)
  else caption.show(ps.title, sentence, bad ? { label: 'Try again', run: () => retryMoment(ps.h) } : undefined, status)
}
/** Drops the pin's caption once the camera is far from the place it names (a label must not claim more than the picture shows). */
function checkPinCaption(): void {
  if (homeCaptionHeld && !tween && !rig.gliding() && !rig.dragging) { homeCaptionHeld = false; caption.clear() }
  checkNewMoonNote()
  if (!pinShown) return
  if (tween || descent || rig.gliding()) { pinShown.moving = true; return }
  // The move has not started while the tiles or the photograph load: the caption waits (up to 20 s) with the camera at the start.
  if (!pinShown.moving && performance.now() - pinShown.at < 20000) return
  const far = angularDistance(rig.pose.lon, rig.pose.lat, pinShown.lon, pinShown.lat) > 25 * Math.PI / 180
  const lowPin = pinShown.h.camera.at === 'site' || pinShown.h.camera.at === 'siteView' || pinShown.h.viewDist < 2
  const wrongDist = lowPin ? rig.pose.dist > pinShown.h.viewDist * 2.2 + 0.2 : Math.abs(Math.log(rig.pose.dist / pinShown.h.viewDist)) > 0.7
  if (far || wrongDist) { pinShown = null; caption.clear() }
}

/**
 * Home: whatever is running stops, the clock goes to now, and the camera flies (one continuous move, the lens and the look
 * eased with it) to the opening view: the sub-Earth point at HOME_DIST radii, lunar north up. Never disabled, never hidden.
 */
function goHome(at?: Date): void {
  resetScrubEnding()
  clearPendingPanorama()
  pendingLanding = null
  cancelRoute()
  stopMoments()
  if (groundMode?.active) { leaveGround(false, () => goHome(at)); return }
  clearAutoRetry()
  const now = performance.now()
  bar?.closeSheets()
  navApi?.clear()
  takeCurrentScriptCamera()
  layoutAimOn = true
  pinShown = null
  // The Home line ("The Moon now, 51 % lit") appears when the picture is there, not at the first frame of the move.
  homeCaptionHeld = true
  caption.show('', '')
  newMoonNote.hide()
  const d = at ?? new Date()
  // v2: no crossfade and no hold. The sky goes from the picture on screen (`ephem` is the displayed one, a running date carry included) to now's
  // over the Home flight itself (carryDate below, journey/ephemCarry.ts), so Home after a historical moment is one continuous move too, and Home
  // during a pick's date carry continues from the intermediate sky instead of replacing it (owner rule: no jumps, cuts or fades).
  // The picture on screen is the last DRAWN ephemeris (as for a pick); `ephem` can be one undrawn carry step ahead of it.
  const shownBefore = last?.ephem ?? ephem
  if (!FLIGHT_FEEL) beginDateChange(d, FADE_HOLD_MS)
  declareExposureCut()
  time = d
  live = !at && !STILL
  lastLiveTick = now
  ephem = clockSet(d, !DATE_CARRY || STILL)
  touched = false
  tourSite = null
  clearMomentUrl()
  toursApi?.demote()
  rig.auto = idleOrbitOn(params, STILL)
  const home = homePose(ephem)
  homeFrame = true
  homeDistApplied = NaN
  homeZoomInputSeen = rig.lastZoomInputAt
  // Home from a sheet: the frame is the one the picture will have, not the one the open panel left (the Moon would shrink to it, then grow back).
  frameTarget = restingFrame()
  homeAimMinimal = FLIGHT_FEEL
  if (FLIGHT_FEEL) {
    // v2: the aim is part of the one flight (it ends where Home's disc sits, the middle unless the bar would cover it), and the look comes
    // back to the Moon over the whole move (flyTo's recoverLook), not in LOOK_MS at the start: that first swing down to the ground under a
    // low or tilted camera, before the climb, was the owner's "why do we fly to the bottom of the Moon?".
    const vw = window.innerWidth, vh = window.innerHeight
    homeAimTarget = minimalAim(vw, vh, safeRect(vw, vh, measureOccluders(true)), homeDiscRadiusPx(frameTarget, vw, vh))
    flyTo({ pose: { ...home, dist: homeDistFor(frameTarget) }, fovDeg: FLY_FOV_DEG, aimShift: homeAimTarget.ny, aimShiftX: homeAimTarget.nx, look: 0 }, now)
    carryDate(shownBefore, false)
  } else {
    flyTo({ pose: { ...home, dist: homeDistFor(frameTarget) }, fovDeg: FLY_FOV_DEG, aimShift: rig.aimShift, aimShiftX: rig.aimShiftX, look: 0 }, now)
    rig.lookAtMoon(true, now, ephem, canvasAspect())
  }
  bar?.reanchor()
  markMoved()
  notifyChange()
  if (!at) maybeShowNewMoonNote()
}

/** What the opening (intro/controller.ts) reads from and does to the page. */
/**
 * The opening's tile prefetch along the flyby path (openingPrefetchTargets: centres only, up to the pass). The splash waits for it
 * for at most INTRO_PREFETCH_MAX_MS; the rest of the flight streams at the flight rate. Module state set once (one start per page).
 */
const INTRO_PREFETCH_MAX_MS = 5000
let introPrefetched = false
function introHost(): IntroHost {
  return {
    scene: () => ({ sunDir: ephem.sunDir, placement: params.get('introplace') === 'legacy' ? 'legacy' : 'sunrise' }),
    readiness: (needs) => {
      const stages = [!!api.ready, !!api.heightsReady]
      let fraction = stages.filter(Boolean).length
      let n = stages.length
      if (needs.tiles && TILE_BASE) {
        n += 2
        fraction += (tilesState === 'ready' || tilesState === 'failed' ? 1 : 0)
        const st = prefetcherFor(TILE_BASE).stats
        fraction += introPrefetched ? 1 : st.requested > 0 ? Math.min(0.95, st.done / st.requested) : 0
      }
      return { fraction: fraction / n, done: stages.every(Boolean) && (!(needs.tiles && TILE_BASE) || ((tilesState === 'ready' || tilesState === 'failed') && introPrefetched)) }
    },
    prepare: (needs) => {
      if (!(needs.tiles && TILE_BASE)) { introPrefetched = true; return }
      void ensureTiles()
      // The camera's Home is the rig's pose from init; the plan is for this aspect (a rotate during the splash only changes the lens).
      const aspect = canvasAspect(), home = rig.camera(ephem, aspect, performance.now())
      const targets = openingPrefetchTargets(home, { sunDir: ephem.sunDir, placement: params.get('introplace') === 'legacy' ? 'legacy' : 'sunrise' }, ephem, aspect)
      const run = prefetchFlight(targets).catch(() => undefined)
      void Promise.race([run, new Promise<void>((r) => setTimeout(r, INTRO_PREFETCH_MAX_MS))]).finally(() => { introPrefetched = true })
    },
    cut: () => { declareExposureCut(); markMoved() },
    settle: (cam) => { rig.settle(ephem, canvasAspect(), performance.now(), cam) },
    moved: () => markMoved(),
  }
}

/** Around new Moon the real sky Home shows is nearly black: a small note offers the next visible crescent (newMoon.ts). */
function maybeShowNewMoonNote(): void {
  if (live && ephem.illuminatedFraction < NEW_MOON_BELOW && !groundMode?.active) newMoonNote.show()
}
/** The note's button: the next evening (UTC) with a visible crescent, shown from Home. */
function showNewMoonLit(): void {
  newMoonNote.hide()
  const evening = nextLitEvening(new Date())
  if (!evening) return
  goHome(evening)
  caption.flash(`The Moon on ${utcEveningLabel(evening)}`, '', 6000)
}
/** The note goes when the time changes (a scrub, a journey, the clock jumping) or the Moon is no longer almost dark. */
function checkNewMoonNote(): void {
  if (newMoonNote.visible && (!live || ephem.illuminatedFraction >= NEW_MOON_BELOW || groundMode?.active)) newMoonNote.hide()
}

/** Diagnostic (dev builds): the link Share would write now, so a rig job can reopen it. */
if (DEV_TOOLS) api.shareUrl = (): string => shareUrl()
async function shareLink(): Promise<void> {
  const url = shareUrl()
  trackUsage('share', { kind: nativeHost ? 'native' : 'link' })
  // In the shell the share sheet carries the link (the platform's own sheet, not a clipboard copy).
  if (nativeHost) { await nativeHost.share(url).catch(() => caption.flash('Could not share this view', '', 3000)); return }
  let msg = 'Link copied'
  try {
    await Promise.race([navigator.clipboard.writeText(url), new Promise((_, no) => setTimeout(no, 1500))])
  } catch {
    // No clipboard permission: the old copy command still works inside a tap.
    const ta = document.createElement('textarea')
    ta.value = url
    ta.style.cssText = 'position:fixed;left:-1000px;top:0;opacity:0'
    document.body.append(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { /* blocked */ }
    ta.remove()
    if (!ok) msg = url
  }
  caption.flash(msg, '', 3000)
}

// ---------------------------------------------------------------------------
// Start.
// ---------------------------------------------------------------------------
/** Puts a link's view on the camera: the fly pose, the lens and which way it is turned (what Share wrote, ui/shareView.ts). */
function applyShareView(share: ShareStart): void {
  const pose: Partial<Pose> = { ...share.pose }
  if (pose.pitch !== undefined) pose.pitch = Math.max(0, Math.min(PITCH_MAX, pose.pitch))
  rig.setPose(pose)
  if (pose.pitch) rig.restoreTilt(pose.pitch)
  if (share.fovDeg !== null) rig.fovDeg = Math.max(2, Math.min(60, share.fovDeg))
  if (share.look?.kind === 'sun') { looking = 'sun'; rig.lookToward(SUN_LOOK, false, performance.now(), ephem, canvasAspect()) }
  else if (share.look) { looking = 'earth'; rigLook = share.look.w; rig.setLookBlend(share.look.w, resolveLook('earth')) }
  else if (share.free) rig.setFreeOrientation(share.free)
}

/**
 * Quality sheet test button: Apollo 17 craters at a ~7 degree Sun (docs pose 4, 2026-10-30 01:30 UTC), no typing needed. It opens the same
 * link a ?pin=a17 share does (a fresh load): moving in place left the fine patch levels unrequested (the adaptive loop sleeps and demand is
 * only issued from drawn frames). Other URL choices (shadows, class, horizons) are kept; a shadow mode picked in the sheet is stored and survives.
 */
function gotoView(set: Record<string, string>): void {
  const u = new URL(location.href)
  for (const k of ['view', 'lon', 'lat', 'dist', 'pitch', 'roll', 'fov', 'pin', 't', 'g', 'look', 'moment', 'start', 'aim', 'off', 'flyt', 'vp', 'panorama']) u.searchParams.delete(k)
  for (const [k, v] of Object.entries(set)) u.searchParams.set(k, v)
  location.assign(u.href)
}
const gotoA17LowSun = (): void => gotoView({ view: 'fly', auto: '0', pin: 'a17', lon: '30.796886', lat: '20.158127', dist: '1.00020663', pitch: '0', roll: '0', fov: '30', t: '2026-10-30T01:30:00Z' })
/** The Sun is 3 deg up and rising over the test pose (lon -3.7, lat 19) at this time, so the pose sits just lit of the day-night line (the old 2026-12-18 06:00 had it 15 deg up, a plain lit plain). scripts/viewpoint-list.test.mts checks it. */
const TERMINATOR_TEST_TIME = '2026-12-17T04:50:00Z'
const gotoTerminator = (): void => {
  clearPendingPanorama()
  pendingLanding = null
  cancelRoute()
  stopMoments()
  if (groundMode?.active) { leaveGround(false, gotoTerminator); return }
  const d = new Date(TERMINATOR_TEST_TIME)
  beginDateChange(d, FADE_HOLD_MS)
  time = d; live = false; ephem = clockSet(d); looking = 'moon'; rig.auto = false
  flyTo({ pose: { lon: -3.7, lat: 19, dist: 1.0345, roll: 0, pitch: 65 }, fovDeg: 30, look: 0 }, performance.now())
  markMoved()
}

/** Tells the pill which Apollo 17 view the visitor stands in: Eye level, Beside the module, or (neither, the link left both) Apollo 17 dimmed. */
function noteGroundView(): void {
  navApi?.noteSelected(viewpoint === 'eye' ? { kind: 'ground', id: 'eye' } : { kind: 'pin', id: 'pin-apollo17' })
  if (!viewpoint) navApi?.away()
}

/**
 * The start of a ?pin= link: loads the site, then places the camera exactly where the link says (the orbital pose, or the Apollo 17
 * ground view). A visitor who has already touched the view keeps what they did.
 */
/** Waits before the automatic 2nd and 3rd try of a ?pin= link's site (ms); the caption's Retry chip stays for the rest. */
const PIN_START_RETRY_MS = [3000, 9000]
let pinStartShown = false
async function startAtPin(share: ShareStart, siteId: string, fromLink = false, attempt = 0): Promise<void> {
  await ensurePatch(siteId)
  if (pinStartShown && (touched || patchState === 'ready')) { pinStartShown = false; caption.clear() }
  if (touched && !fromLink) return
  if (patchState !== 'ready' || patchSiteId !== siteId) {
    // A failure used to leave the visitor hovering over the site with no word: say so, try again a couple of times, and keep a Retry.
    if (patchState === 'failed' && patchSiteId === siteId && PATCH_SITES[siteId]) {
      const again = (): void => { caption.clear(); dropPatch(); void startAtPin(share, siteId, fromLink, 0) }
      pinStartShown = true
      caption.show(`Could not load ${PATCH_SITES[siteId].name}`, 'Your connection may have dropped.', { label: 'Retry', run: again }, true)
      const wait = PIN_START_RETRY_MS[attempt]
      if (wait !== undefined) setTimeout(() => { if ((!touched || fromLink) && patchState === 'failed' && patchSiteId === siteId) { caption.clear(); dropPatch(); void startAtPin(share, siteId, fromLink, attempt + 1) } }, wait)
    }
    return
  }
  // A warm link (B5) flies to the pin, never cuts: the site's own pin flight, or the link's exact pose when it names one (carry).
  if (fromLink) {
    const site = PATCH_SITES[siteId]
    const p = share.pose
    const pose = p.lon !== undefined && p.lat !== undefined && p.dist !== undefined ? { lon: p.lon, lat: p.lat, dist: p.dist } : null
    flyToPoint(pose?.lon ?? site.lon, pose?.lat ?? site.lat, site.name, '', siteId, pose?.dist, pose ? carryOf(share) : undefined)
    return
  }
  const gv = share.ground
  const g = gv && siteId === 'a17' ? ensureGround() : null
  if (g && gv) {
    if (!g.active && !enterGround()) return
    g.cam.view = { pos: new THREE.Vector3(gv.e, gv.n, gv.z), headingDeg: gv.heading, pitchDeg: gv.pitch, rollDeg: gv.roll, tanHalf: gv.tanHalf }
    g.cam.cancelGlide()
    g.cam.setMode(gv.walk ? 'walk' : 'fly')
    g.preset = null
    viewpoint = share.viewpoint
    // The pill knows where the visitor stands: Apollo 17 · Eye level or Beside the module (or Apollo 17, dimmed, when the link left both).
    noteGroundView()
  } else {
    applyShareView(share)
    rig.lastInputAt = performance.now()
  }
  markMoved()
}

/** Draw the Moon from the colour image alone and stream the rest after the first frame (see init). Captures (?still=1) keep the old order. */
const FAST_FIRST = !STILL && params.get('fastfirst') !== '0'
/** A link that can have the Earth in its first frame (a pose, a look, a moment) waits for the Earth's maps, so the globe never arrives after the picture. */
const EARTH_IN_FIRST_FRAME = ['view', 'look', 'start', 'moment', 'lon', 'lat', 'dist', 'roll', 'pin', 'off', 'g'].some((k) => params.has(k))
let earthLoading: Promise<void> | null = null
const HEIGHT_FADE_MS = 900

/** Swaps the 4k heights in for the flat stand-in and eases them in over HEIGHT_FADE_MS (uHeightMix 0 to 1): the relief arrives as a fade, not a pop. */
function applyHeights(h: HeightMap): void {
  if (!maps.height.pending) { h.texture.dispose(); return }
  const old = maps.height
  maps.height = h
  moon.uniforms.uHeight.value = h.texture
  moon.uniforms.uHeightLevels.value = h.levels
  old.texture.dispose()
  api.heightGpuBytes = h.gpuBytes
  api.heightHalfErrorM = h.halfErrorM
  const t0 = performance.now()
  const step = (now: number): void => {
    const k = Math.max(0, Math.min(1, (now - t0) / HEIGHT_FADE_MS))
    moon.uniforms.uHeightMix.value = k * k * (3 - 2 * k)
    markMoved()
    if (k < 1) requestAnimationFrame(step)
    else { api.heightsReadyAt = performance.now(); api.heightsReady = true }
  }
  requestAnimationFrame(step)
}

/** After the first frame: the heights and the Earth's maps. Their requests start now, not before the Moon is on screen. */
function startDeferredLoads(): void {
  api.firstFrameAt = performance.now()
  // The Gazetteer table (9,080 names) is a lazy chunk, fetched after the Moon is on screen; the label search, close-up names and centre caption read it once it lands.
  void loadGazetteer().catch(() => undefined)
  // Telemetry (src/telemetry): a dynamic import after the first frame, and only in a build made with a key. Without one this line is dead code.
  if (import.meta.env.VITE_SENTRY_DSN || import.meta.env.VITE_POSTHOG_KEY) setTimeout(() => void import('./telemetry/boot').then((m) => m.startTelemetry(canvas, api)).catch(() => undefined), 2000)
  if (maps.height.pending) loadHeight().then(applyHeights).catch((e: unknown) => fail(`Could not load the heights: ${String((e as Error)?.message ?? e)}`))
  else { api.heightsReady = true; api.heightsReadyAt = api.firstFrameAt }
  earthLoading?.then(() => { api.earthReadyAt = performance.now() }).catch((e: unknown) => console.warn('Earth maps unavailable:', String((e as Error)?.message ?? e)))
}

async function init(): Promise<void> {
  hud.setHidden(STILL)
  hud.setVisibilityState(null)
  const common3 = common as unknown as Record<string, THREE.IUniform>
  // First frame on a slow link: the colour image (1.3 MB) draws the Moon at once; the 6.2 MB heights and the Earth's maps follow once a frame is up
  // (startDeferredLoads), the heights eased in. ?fastfirst=0 is the old order (everything before the first frame) for a before/after measurement.
  const m = FAST_FIRST ? await loadMoonMapsColorFirst(renderer.capabilities.getMaxAnisotropy()) : await loadMoonMaps(renderer.capabilities.getMaxAnisotropy())
  maps = m
  if (!m.height.pending) { api.heightGpuBytes = m.height.gpuBytes; api.heightHalfErrorM = m.height.halfErrorM }
  // Only a mode the visitor chose (or the URL named) is applied at start: every default and preset path draws exactly as before Baked existed.
  if (isExplicit('shadows')) applyShadowMode(getQuality().shadows)
  moon = new MoonPass(common3, maps, '', SHADOW_POLICY === 'fixed')
  moon.setMetadataWanted(metadataWarm)
  // quality.ceilingBytes, not the profile's: after a loss the start runs at the lowered ceiling (contextRecovery.ts rule 1).
  moon.configureBaked(renderer, quality.detected.cls, quality.ceilingBytes, markDirty)
  onShadowModeChange((sm) => { moon.setShadowMode(sm); markDirty() })
  glare = new GlarePass(common3)
  final = new FinalPass(SEED)
  final.setGlow(getQuality().glow)
  sun = new SunPass(common3)
  ridgePass = new RidgePass(common3)
  ridgePass.haze = RIDGE_HAZE
  if (FAST_FIRST && !EARTH_IN_FIRST_FRAME) {
    const d = EarthPass.loadDeferred(common3, time, renderer.capabilities.getMaxAnisotropy())
    earth = d.pass
    earthLoading = d.loaded
  } else earth = await EarthPass.load(common3, time, renderer.capabilities.getMaxAnisotropy())
  earth.onLoaded = () => { markDirty() }
  bodyPasses.push(
    {
      update: (f) => {
        const glare = sunGlareScale(f.cam, f.width / f.height, f.exposure.hdr)
        sun.update(f.ephem, f.cam, f.width, f.height, f.tanPerPx, f.exposure.preExpose, smoothSunGlareScale(glare.target, f.now, glare.continuous), f.exposure.white * f.exposure.preExpose, sunForeground, sunCoverage)
      },
      render: (r) => { if (params.get('nosun') !== '1') sun.render(r) },
    },
    { update: (f) => earth.update(f.ephem, f.cam, f.tanPerPx), render: (r) => { if (params.get('noearth') !== '1') earth.render(r) } },
  )

  // The opening is Home: an orbit pose over the sub-Earth point, so the first drag works on the first frame. The view from the
  // Earth's centre and the dolly zoom out of it remain only for ?view=earth and ?flyt= captures (the archive), never for a gesture.
  const lon = num('lon'), lat = num('lat'), dist = num('dist'), roll = num('roll')
  if ((dist !== undefined && dist < D_MIN) || params.get('moment') === 'surface') await ensureTiles()
  applyFloor()
  const wantsEarth = params.get('view') === 'earth' || params.get('start') === 'earth'
  const wantsFly = params.get('view') === 'fly' || (!wantsEarth && (lon ?? lat ?? dist ?? roll) !== undefined)
  rig.setPose(homePose(ephem))
  rig.lastInputAt = performance.now()
  // Home keeps the Moon clear of the caption and the bar (the aim shift follows what stands over the frame), unless a URL names the exact view.
  layoutAimOn = !wantsFly && !wantsEarth
  homeAimMinimal = FLIGHT_FEEL && layoutAimOn
  if (wantsEarth) {
    // The Earth view is a pose now: far out, narrow lens.
    rig.setPose(subEarthPose(ephem, EARTH_VIEW_DIST))
    rig.fovDeg = EARTH_VIEW_FOV_DEG
  }
  const share = readShare((k) => params.get(k))
  if (wantsFly) {
    applyShareView(share)
    // The sharer's layout framing follows this device's bar and caption, but the distance is the one in the link.
    homeFrame = false
    if (share.aim) { layoutAimOn = true; homeAimMinimal = false }
  }
  // ?pin=a11|a17: the link's view is at a landing site, so the site's pictures load first and the view is placed again exactly once they are in.
  if (share.pin && PATCH_BASE && PATCH_SITES[share.pin]) {
    // A ground-view link has no orbital pose: wait over the site, not at Home, while its pictures arrive.
    if (!wantsFly && share.ground) { rig.setPose({ lon: PATCH_SITES[share.pin].lon, lat: PATCH_SITES[share.pin].lat, dist: 1.3 }); homeFrame = false; layoutAimOn = true; homeAimMinimal = false }
    void startAtPin(share, share.pin)
  }

  // The ridge opening is archived (?start=ridge keeps it working); Home is the opening.
  if (params.get('start') === 'ridge') {
    startRidge(num('journey') ?? 0, false)
    api.ridge = true
  }
  // The opening is the real sky now: around new Moon it is nearly black, and the note says so.
  if (homeFrame && layoutAimOn && !share.pin && !ridge && !params.has('moment')) maybeShowNewMoonNote()

  cancelPendingWheelZoom = attachControls(canvas, rig, {
    moved: () => { cancelRoute(); markMoved() },
    // The visitor flew the camera by hand with a key (W A S D Q E R): the view has left the viewpoint, like a drag or an arrow key.
    manual: () => navApi?.away(),
    pointerCount: (count) => { navPointerCount = count },
    context: () => ({ e: ephem, aspect: frameAspect || canvasAspect() }),
    turnMoonBy: (dx, dy, now) => {
      const cam = rig.camera(ephem, canvasAspect(), now)
      const north = moonSurfaceTurn.baseNorth(clockEphemerisAt(time).moonZ)
      // The ground under the camera keeps up with the finger at every height: one CSS pixel spans (height x tanHalf) / half the canvas height of
      // surface, in Moon radii, which is that many radians of turn (review: a disc-size rate ran 26x ahead of the finger at 5 km).
      const radPerPx = Math.max(1e-7, cam.pos.length() - 1) * cam.tanHalf / Math.max(1, canvas.clientHeight / 2)
      // The tilt is bounded on the north axis's own tilt toward the viewer (it may start tilted), not on the turn alone.
      const tilt0 = Math.atan2(north.dot(cam.back), north.dot(cam.up))
      if (moonSurfaceTurn.dragBy(dx * radPerPx, dy * radPerPx, now, cam.right, north, [-MOON_TURN_PITCH_MAX - tilt0, MOON_TURN_PITCH_MAX - tilt0])) { moonTurnMotion = true; applyMoonSurfaceTurn(now) }
    },
    turnMoon: (cameraTurn, now) => {
      const cam = rig.camera(ephem, canvasAspect(), now)
      if (moonSurfaceTurn.drag(cameraTurn, now, cam.right, cam.up, clockEphemerisAt(time).moonZ)) { moonTurnMotion = true; applyMoonSurfaceTurn(now) }
    },
    stopMoonTurn: (now, phase) => { if (phase === 'down') moonSurfaceTurn.rebase(); else if (phase === 'cancel') moonSurfaceTurn.stopInertia(); else moonSurfaceTurn.release(now) },
    home: () => goHome(),
    escape: () => {
      // Escape peels one layer at a time: a sheet or the notes; then the archive's ridge, flight and ground view; then a viewpoint journey
      // (a cinematic flight, a fly-to, a descent, or one still loading) STOPS where the camera is, like a grab does, and the pill offers Return;
      // only with none of them running does an idle Escape go Home (the long-standing rule, unchanged). So Escape twice from a flight is Home.
      if (bar?.closeSheets() || hud.closeNotes()) return
      if (routeFlight) { cancelRoute(); return }
      if (ridge) { skipRidge(); return }
      if (flight) { stopFlight(false); return }
      if (groundMode?.active) { leaveGround(); return }
      if (viewpointJourneyRunning()) { takeCurrentScriptCamera('other'); navApi?.away(); return }
      goHome()
    },
    skyDragMatch: () => SKY_DRAG_MATCH,
    now: () => setClock(new Date(), true),
    notes: () => hud.toggleNotes(),
    share: () => { void shareLink() },
    timeStep: (dir) => bar?.timeStep(dir),
    extraKey: (e) => {
      if ((e.key === 'c' || e.key === 'C') && !e.shiftKey && !groundMode?.active && touchControlsUi) { touchControlsUi.toggle(); return true }
      const n = e.key.length === 1 && e.key >= '1' && e.key <= '9' ? Number(e.key) - 1 : -1
      const h = hotspotList[n]
      if (!h || e.shiftKey) return false
      playPin(h)
      return true
    },
    flyTo: (nx, ny) => {
      const now = performance.now()
      const target = rig.doubleTapPose(nx, ny, ephem, canvasAspect(), now)
      if (!target) return
      takeCurrentScriptCamera()
      navApi?.away()
      rig.glideTo(target, now, undefined, 1500)
      markMoved()
    },
  })
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
    // Left and Right step the navigator while focus is in its pill or list: they are not camera keys there.
    if (e.target instanceof Element && e.target.closest('.nav-pill, .nav-caption, #bar-viewpoints') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(e.key)) return
    takeCurrentScriptCamera('grab')
    resumable = null
    navApi?.away()
  }, { capture: true })
  window.addEventListener('resize', () => {
    markDirty()
    needsRefine = true
  })
  attachGroundControls(canvas, { mode: () => (groundMode?.active ? groundMode : null), moved: markMoved, toggleWalk: () => { groundMode?.cam.setMode(groundMode.cam.mode === 'walk' ? 'fly' : 'walk'); markMoved() } })
  // A touch takes the camera, but a TAP (no drag, no wheel) stopped a pin's journey for nothing: it resumes toward its target.
  let grab: { x: number; y: number; at: number; wheeled: boolean; resume: typeof resumable } | null = null
  canvas.addEventListener('pointerdown', (ev) => {
    takeCurrentScriptCamera('grab')
    grab = { x: ev.clientX, y: ev.clientY, at: performance.now(), wheeled: false, resume: resumable }
    touched = true; tourSite = null; hintSeen()
  }, { capture: true })
  const endGrab = (ev: PointerEvent): void => {
    const g = grab
    grab = null
    if (!g || ev.type === 'pointercancel') return
    // A drag (or a held press) moves the view away from the viewpoint; a tap does not.
    if (!isTap({ x: g.x, y: g.y, at: g.at }, { x: ev.clientX, y: ev.clientY, at: performance.now() }, g.wheeled)) navApi?.away()
    if (afterGrab(isTap({ x: g.x, y: g.y, at: g.at }, { x: ev.clientX, y: ev.clientY, at: performance.now() }, g.wheeled), !!g.resume) === 'resume' && g.resume && !tween && !descent && !groundMode?.active) {
      flyTo(g.resume.end, performance.now(), g.resume.ms)
      resumable = null
      markMoved()
    }
  }
  canvas.addEventListener('pointerup', endGrab)
  canvas.addEventListener('pointercancel', endGrab)
  canvas.addEventListener('wheel', () => { if (grab) grab.wheeled = true; takeCurrentScriptCamera('grab'); resumable = null; hintSeen(); navApi?.away() }, { passive: true, capture: true })
  // The one bar mounts with the first frame: it is the only control surface, and it never waits for the site probe.
  if (!STILL) {
    bar = mountBar(document.getElementById('ui') as HTMLElement, {
      getTime: () => time,
      setTime: (d, isLive) => setClock(d, isLive),
      isLive: () => live,
      home: () => goHome(),
      onChange: (cb) => { changeListeners.push(cb) },
    })
    // The navigator pill sits directly above the bar and is tappable from the first frame: a tap before the site probe is done is queued.
    navApi = mountNavigator(document.getElementById('ui') as HTMLElement, bar, {
      has: navHas,
      run: runNavAction,
      status: navStatus,
      stopMoment: () => toursApi?.stop(),
      // ‹ at Eye level on the Apollo 17 ground climbs out over the site (#10); the card offers the flight again as its own chip.
      onGround: onApollo17Ground,
    })
    // The Labels layer (src/ui/labels.ts): off by default, the bar's Labels button (and ?labels=1) turns it on.
    labelsApi = mountLabels(document.getElementById('ui') as HTMLElement, {
      select: flyToShownLabel,
      search: flyToLabel,
      highlight: (l) => setHighlight(l, false),
    }, params.get('labels') === '1')
    const labelsBtn = bar.addItem({ id: 'labels', label: 'Labels', ariaLabel: 'Names on the Moon', icon: tablerIcon('mapPin'), order: 20, onClick: () => labelsApi?.setOn(!labelsApi.isOn()) })
    labelsBtn.setAttribute('aria-pressed', String(labelsApi.isOn()))
    labelsApi.onChange((on) => { labelsBtn.setAttribute('aria-pressed', String(on)); if (!on) setHighlight(null, true); updateLabelsDom(); markDirty() })
    // Credits in the More sheet too (with Quality and Relief), beside the brand line's own link: it presses that link, so the panel and its five-press secret stay one thing (hud.ts).
    bar.addItem({ id: 'credits', label: 'Credits', ariaLabel: 'About, credits and sources', icon: tablerIcon('infoCircle'), order: 56, overflow: true, onClick: () => document.querySelector<HTMLButtonElement>('#credit .credit-link')?.click() })
  }
  // Quality: the sheet on the bar (More on a phone) and what its choices change right now. Shadows apply through runtime uniforms (quality/apply.ts).
  if (bar) mountQualitySheet(document.getElementById('ui') as HTMLElement, bar)
  onQualityChange((q) => {
    refreshReduced()
    applyShadowMode(q.shadows)
    knobs = motionKnobs(quality.profile, q.preset)
    motionCapsOn = motionCapsFor()
    setFixedShare(params.get('fixedshare') !== null ? Number(params.get('fixedshare')) : knobs.motionFixedShare ?? 0)
    moon?.refreshDetailGain()
    final?.setGlow(q.glow)
    markDirty()
  })
  // The catalogue loads after the first frame, never before it; a captured still (no bar) waits for it instead, so its stars are in the picture.
  if (starsOn) { if (STILL) await ensureStars(); else setTimeout(() => void ensureStars(), 1500) }
  // The first frame does not wait for the site probe (two small requests, with retries): the Moon is drawn now, the chips mount after.
  intro?.start(introHost())
  if (intro) api.introSeek = (u: number | null) => intro.seek(u)
  loopRunning = true
  requestAnimationFrame(frameLoop)
  // A link that opens the running app (B5): a moment plays and a pose flies, with the same calls a pin or a moment selection makes (no reload).
  // A link that opens the running app: the panorama viewer closes first (its frame loop is paused while it is open),
  // the ground view is left, the same guards flyToPoint and playMoment run are applied, and then the moment plays or the view flies carrying the
  // link's time, roll, pitch, lens and Earth look. A pin flies through flyToPoint (fromLink skips the touched gate). Nothing cuts.
  const applyLinkInPlace = (query: string): void => {
    const route = linkRoute(query, (id) => momentById(id) !== undefined)
    const steps = warmLinkSteps(route.kind, !!panoramaUi?.isOpen(), !!groundMode?.active)
    if (steps.length === 0) return
    if (steps[0] === 'closePanorama') panoramaUi?.close()
    if (steps.includes('leaveGround')) { leaveGround(false, () => applyLinkInPlace(query)); return }
    clearPendingPanorama()
    cancelRoute()
    stopMoments()
    if (flight) stopFlight(true)
    if (route.kind === 'moment') { const m = momentById(route.id); if (m) playMoment(m); return }
    const share = readShare((k) => new URLSearchParams(query).get(k))
    const t = parseTime(new URLSearchParams(query).get('t'))
    if (t) applyLinkTime(t)
    if (share.pin && PATCH_BASE && PATCH_SITES[share.pin]) { void startAtPin(share, share.pin, true); return }
    const { lon, lat, dist } = share.pose
    if (lon !== undefined && lat !== undefined && dist !== undefined) flyTo(carryEnd(lon, lat, dist, carryOf(share)), performance.now())
  }
  if (nativeHost) wireNativeShell(nativeHost, {
    applyLink: applyLinkInPlace,
    onPause: () => { nativePaused = true; clearHealthyResetTimer(); healthyRecoveryAt = null; healthyLastFrameAt = null; tiles?.abortInFlight() },
    onResume: () => {
      nativePaused = false
      if (healthyRecoveryPending) { healthyRecoveryAt = null; healthyLastFrameAt = null }
      if (contextLost) void recoverContext(lossGeneration)
      if (!loopRunning) { idleSleeping = false; loopRunning = true; requestAnimationFrame(frameLoop) }
      markDirty()
    },
    onNetwork: (status) => { api.network = status; markDirty() },
    overlayOpen: () => openOverlay(overlayFlags()) !== null,
    atHome: () => homeFrame,
    // The panorama viewer closes through its own close; the sheets, notes and Credits through the same Escape keydown the desktop sends.
    closeOverlay: () => {
      if (openOverlay(overlayFlags()) === 'panorama') panoramaUi?.close()
      else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    },
    goHome: () => goHome(),
    currentView: () => new URL(shareUrl()).search,
    store: localStorage,
  })
  // The surface tour needs tiles; without a tile base it is not offered.
  // A site tour is offered only when that site's manifest is not definitely absent.
  await probePatchSites()
  for (let i = MOMENTS.length - 1; i >= 0; i--) {
    const need = MOMENTS[i].needsPatch
    if ((MOMENTS[i].needsTiles && !TILE_BASE) || (need && !patchSitesFound.has(need)) || (MOMENTS[i].needsTier && need && !tierSitesFound.has(need))) MOMENTS.splice(i, 1)
  }
  // The hotspots offered are the ones whose data is there (a site needs its patch, a surface view the tiles).
  hotspotList = HOTSPOTS.filter((h) => !((h.needsTiles && !TILE_BASE) || (h.needsPatch && !patchSitesFound.has(h.needsPatch)) || (h.needsTier && h.needsPatch && !tierSitesFound.has(h.needsPatch))))
  if (!STILL && bar) pinsApi = mountPins(document.getElementById('ui') as HTMLElement, { list: () => hotspotList, select: (h) => { setUsageSource('pin'); playPin(h) }, keep: (h) => !!h.needsPatch && patchSiteId === h.needsPatch && patchState === 'failed' })
  // First-visit hotspots: first load only, never on a shared link, ?still=1, the archive or the debug sheet (ui/firstHotspots.ts); ?hotspots=1 forces, =0 turns off.
  if (!STILL && bar) {
    const mode = hotspotsMode({ params, still: STILL, archive: ARCHIVE, debug: debugEnabled(location.search), automated: navigator.webdriver === true, seen: readRemembered(() => localStorage).seen })
    if (mode !== 'off') {
      window.addEventListener('resize', () => { if (firstHotspotsApi) { firstHotspotsApi.place(); markDirty() } })
      firstHotspotsApi = createFirstHotspots(document.getElementById('ui') as HTMLElement, {
        list: () => hotspotList, select: (h) => { setUsageSource('hotspot'); playPin(h) }, store: () => localStorage, forced: mode === 'forced',
        extraBlocked: () => { const r = centreUi?.rect(); return r ? [[r.left - 6, r.top - 6, r.right + 6, r.bottom + 6]] : [] },
      })
    }
  }
  // The Labels layer (names of seas, craters and ranges; every landing site with its agency's badge). The Alps ridge is an entry of the navigator's list.
  if (!STILL && bar) {
    routesApi = mountRoutes(document.getElementById('ui') as HTMLElement, { fly: startRouteFlight })
    if (CAPTION_ON) {
      const uiRoot = document.getElementById('ui') as HTMLElement
      if (LABEL_STYLE === 'lock') centreUi = centreLock = mountLockLabel(uiRoot, canvas)
      else centreUi = mountCentreCaption(uiRoot)
      centreCtl = new CentreCaption(centreHost)
      // Background time cannot satisfy the pause: the clock restarts when the tab hides and when it returns.
      document.addEventListener('visibilitychange', () => centreCtl?.resetStill(performance.now()))
    }
  }
  // ?debug=1 (or ?heat=1): the photograph-resolution map from the coverage data, a click on green flies in.
  // The tuning slider is the owner's, behind ?debug=1 (it overlapped the tour card of a ?moment= link on every visitor view).
  mountReviewLabel(location.search)
  // The hidden debug sheet (five presses of the Credits link within three seconds): star brightness, fine quality rows, measurement and text overlays, test views.
  if (DEV_TOOLS && !STILL && bar) {
    const ui = document.getElementById('ui') as HTMLElement
    debugSheet = mountDebugSheet(ui, {
      starBoost,
      onStarBoost: (b) => { starBoost = b; try { saveBoost(b, localStorage) } catch { /* no storage */ } markDirty() },
      toggles: [
        { id: 'hud-text', label: 'Text overlays', note: 'The top-left readout lines of the ground view and the Apollo 17 descent.', get: () => hud.textVisible, set: (on) => { hud.setTextVisible(on); markDirty() } },
        { id: 'perf-hud', label: 'Performance readout', note: 'GPU timing, pacing and shadow cache (?perfhud=1).', get: () => perfHud.isVisible(), set: (on) => perfHud.setVisible(on) },
        { id: 'quality-readout', label: 'Quality and GPU memory readout', note: 'Device class, quality line and GPU ledger (?debug=1).', get: () => !!qualityReadout?.isVisible(), set: (on) => qualityReadout?.setVisible(on) },
        { id: 'apollo-routes', label: 'Apollo paths', note: 'The Apollo 17 powered-descent line, the landing dot and the tap-to-fly label in free views.', get: () => routesShown, set: (on) => { routesShown = on; markDirty() } },
        { id: 'coverage-heat', label: 'Photo resolution map', note: 'Tints the Moon by the finest photograph under each pixel; a click on green flies in (?heat=1).', get: () => !!heatApi, set: (on) => {
          if (on && !heatApi) heatApi = mountDebugHeat(ui, canvas, { flyTo: flyToCoverage })
          else if (!on && heatApi) { heatApi.destroy(); heatApi = null }
          markDirty()
        } },
      ],
      gotos: [
        { action: 'goto-a17-low-sun', label: 'Go to Apollo 17 (low Sun)', title: 'The Apollo 17 crater field at a 7 degree Sun: long crater shadows, to compare the Shadows modes.', run: gotoA17LowSun },
        { action: 'goto-terminator', label: 'Go to the terminator', title: 'Montes Apenninus just lit of the day-night line: the heavy case for shadows and motion.', run: gotoTerminator },
      ],
    }, () => hud.focusCreditsLink())
    hud.onSecretTap(() => { bar?.closeSheets(); debugSheet?.open() })
    if (DEBUG) hud.setTextVisible(true)
  }
  if (DEV_TOOLS && debugEnabled(location.search)) void import('./debug/panel').then((m) => { switchesApi = m.mountSwitches(); if (captureSession) switchesApi.setHidden(true) }, () => undefined)
  if (DEV_TOOLS && !STILL && (DEBUG || params.get('heat') === '1')) heatApi = mountDebugHeat(document.getElementById('ui') as HTMLElement, canvas, { flyTo: flyToCoverage })
  for (const root of coverageRoots([TILE_BASE, PATCH_BASE])) void loadRemoteCoverage(root)
  if (import.meta.env.DEV) void loadInternalCoverage()
  // Cinematic controls live in Viewpoints, including shared moment links. The archive retains its standalone row.
  if (!STILL || ARCHIVE || params.has('moment')) toursApi = mountTours(document.getElementById('ui') as HTMLElement, {
    play: playMoment,
    unavailable: momentUnavailable,
    progress: momentProgress,
    retry: retryMoment,
    stop: stopMoments,
    isLive: () => live,
    arrived: (m) => journey.state?.id === m.id && journey.state.status === 'arrived',
    backToNow: () => { time = new Date(); live = !STILL; lastLiveTick = performance.now(); ephem = clockSet(time); markMoved() },
    onGrab: (cb) => canvas.addEventListener('pointerdown', cb),
    onSelect: (m) => {
      if (m) navApi?.noteSelected({ kind: 'moment', id: m.id })
      else if (navApi?.current()?.kind === 'moment') navApi.clear()
    },
  }, params.get('moment'), !STILL && !ARCHIVE ? navApi?.cardSlot ?? null : null, !STILL && !ARCHIVE ? navApi?.cardSlot ?? null : null)
  if (!STILL && pinsApi) {
    const ui = document.getElementById('ui') as HTMLElement
    panoramaUi = mountPanoramaViewer(document.body, {
      // The app bounds the tier by the class (iOS app: 4096); the website keeps main's device rule alone.
      classMaxWidth: nativeHost ? quality.profile.panoMax : undefined,
      onOpen: () => { takeCurrentScriptCamera('other', true); toursApi?.demote(); navApi?.closeSheet(); ui.inert = true; canvas.inert = true },
      onClose: () => {
        ui.inert = false; canvas.inert = false; markDirty()
        // The address stops naming the panorama, or a reload would reopen it (review F15).
        try { const href = stripOverlayParams(location.href); if (href !== location.href) history.replaceState(history.state, '', href) } catch { /* replaceState can be refused */ }
        // Back in the ground scene: the pill leaves "ALSEP panorama" for the view the visitor is standing in.
        if (navApi?.current()?.kind === 'panorama') noteGroundView()
        // A level the open panorama aborted must not stay marked failed or half-loaded: the Eye level that follows needs the site's ground.
        patch?.retryRefinement()
        // The ground pose under the panorama is kept: closing it shows that view again, no travel (#10). Only a panorama opened from orbit (a link) flies out over the site.
        if (!onApollo17Ground()) flyOutOverSite()
      },
    })
    const wanted = APOLLO17_PANORAMAS.find((p) => p.id === params.get('panorama'))
    if (wanted) openPanoramaFlight(wanted.id, true)
  }
  // The visitor's ground view has two viewpoints on the bar; the preset panel, the flight panel and the G key are the archive's.
  if (!STILL) {
    let lastTake = -1e9
    // A held button steps every frame; whatever script runs is stopped by the first step, not re-cancelled on each one.
    // A script that STARTS inside the 500 ms (Home's fly-to, a pin) is taken at the next step too: the guard alone let a running tween overwrite the button's zoom.
    // The take settles the camera at the pose on screen, so the hand-over is continuous in position.
    const camStep = (fn: (now: number) => void): void => { const now = performance.now(); if (now - lastTake > 500 || tween || descent || cinematicFlight || orbitJourney || flight || ridge) { takeCurrentScriptCamera(); lastTake = now } fn(now); cancelRoute(); navApi?.away(); markMoved() }
    touchControlsUi = mountTouchControls(document.getElementById('ui') as HTMLElement, {
      zoom: (f) => camStep((now) => rig.zoomCentre(f, ephem, canvasAspect(), now)),
      // Look up or down: the orbital rig's tilt (its own pitch limits); on the ground the view turns by the angle those px span (groundControls.ts' drag rate; look's dy is positive downward).
      tilt: (px) => camStep((now) => {
        const gm = groundMode?.active ? groundMode : null
        if (gm) gm.cam.look(0, -px * 2 * Math.atan(gm.cam.view.tanHalf) * 180 / Math.PI / Math.max(1, canvas.clientHeight))
        else rig.tilt(px, Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight)), now)
      }),
      roll: (deg) => camStep((now) => rig.turnHeading(deg, now)),
      move: (px) => camStep((now) => rig.moveForward(px, Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight)), ephem, canvasAspect(), now)),
      frame: () => ({ shortCss: Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight)), fovDeg: rig.fovDeg }),
      // The zoom and tilt halves are stepped inside the frame loop (touchControlsUi.frame), so the camera change and the drawn frame are one frame.
      wake: markDirty,
    })
  }
  if (!STILL) zoomTapeUi = mountZoomTape(document.getElementById('ui') as HTMLElement)
  if (!STILL) siteRingUi = mountSiteRing(document.getElementById('ui') as HTMLElement)
  // With the pill the two ground views are the Apollo 17 entry's first two steps: no second control that names them.
  if (!STILL && !(navApi && navHas({ kind: 'ground', id: 'eye' }))) viewpointsUi = mountViewpoints(document.getElementById('ui') as HTMLElement, { select: goViewpoint })
  // Sheets and notes close on the first outside tap. Their opener buttons are excluded because this capture handler runs
  // before the click that opens them; the same pointerdown must never immediately dismiss a newly opened sheet.
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Element | null
    if (!target || panoramaUi?.isOpen()) return
    const insidePanel = !!target.closest('.bar-sheet, .hud-notes')
    const opener = !!target.closest('.bar [aria-controls], .hud-i, .nav-pill [aria-controls], .nav-caption')
    if (insidePanel || opener) return
    bar?.closeSheets()
    hud.closeNotes()
  }, true)
  if (!STILL) {
    if (ARCHIVE) groundUi = mountGroundUi(document.getElementById('ui') as HTMLElement, {
      enter: () => { enterGround() },
      leave: () => leaveGround(),
      preset: (id) => { groundMode?.cam.setMode('fly'); groundMode?.goPreset(id, performance.now()); markMoved() },
      free: () => { if (groundMode) { groundMode.preset = null; groundMode.cam.cancelGlide(); groundMode.cam.setMode('fly') } markMoved() },
      toggleWalk: () => { groundMode?.cam.setMode(groundMode.cam.mode === 'walk' ? 'fly' : 'walk'); if (groundMode) groundMode.preset = null; markMoved() },
      toggleOrigin: () => { if (groundMode) groundMode.origin = !groundMode.origin; markMoved() },
      toggleTilt: () => { groundMode?.setTilt(groundMode.lmTilt === 'reported' ? 'fit' : 'reported'); markMoved() },
    })
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return
      if (ARCHIVE && (e.key === 'g' || e.key === 'G')) { if (groundMode?.active) leaveGround(); else if (canEnterGround()) enterGround() }
    })
    // A visitor's slider lives in the navigator pill and shows for a moment's flight, its lead-in and a few seconds after it ends; a plain fly-to (a pin, Home) has none.
    if (ARCHIVE) scrubUi = mountJourneyScrub((document.querySelector('.tours') ?? document.getElementById('ui')) as HTMLElement, scrub, markMoved)
    else if (navApi) scrubUi = mountJourneyScrub(navApi.sliderSlot, scrub, markMoved, (h) => scrubHandleShown(h.id))
    ridgeUi = mountRidgeUi(document.getElementById('ui') as HTMLElement, { lift: liftOff, pause: pauseRidge, skip: skipRidge })
  }
  // Everything a step can need is probed and mounted: the list is trimmed to what exists and a tap made meanwhile runs now.
  // A ground view the link opened before the pill was mounted.
  if (groundMode?.active && !navApi?.current()) noteGroundView()
  navApi?.setReady()
  scheduleIdlePrefetch()
}

/** Where the hotspots land (selenographic degrees): their coarse tiles are fetched while the browser is idle. Views from far out need no tiles. */
function pinPrefetchTargets(): PrefetchTarget[] {
  return (hotspotList.length ? hotspotList : HOTSPOTS).filter((h) => h.viewDist < 3 || h.needsTiles || h.needsPatch).map((h) => h.pin(ephem))
}
const connection = (): { saveData?: boolean; effectiveType?: string } | undefined => (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection
/** Fetches the coarse tiles of `targets` ahead of need, one at a time, replacing any earlier list; nothing on save-data, 2g/3g or ?prefetch=off. */
function prefetch(targets: PrefetchTarget[]): Promise<void> {
  if (!TILE_BASE || (STILL && !captureSession) || !prefetchAllowed(connection(), location.search)) return Promise.resolve()
  return prefetcherFor(TILE_BASE).prefetch(targets, undefined, undefined, 'idle', 'low')
}
let flightPrefetchController: AbortController | null = null
function prefetchFlight(targets: PrefetchTarget[]): Promise<void> {
  if (!TILE_BASE || (STILL && !captureSession) || !prefetchAllowed(connection(), location.search)) return Promise.resolve()
  flightPrefetchController?.abort()
  const controller = new AbortController()
  flightPrefetchController = controller
  return prefetcherFor(TILE_BASE).prefetch(targets, controller.signal, undefined, 'flight').finally(() => {
    if (flightPrefetchController === controller) flightPrefetchController = null
  })
}
/**
 * Idle prefetch of the next and previous viewpoints' first views (net/nextViewPrefetch.ts): while the visitor rests on a viewpoint, the tiles that
 * the first frame of a press of Next or Back needs are fetched at low priority, a bounded set, and any input cancels it. Checked with the navigator's update.
 */
let nextViewKey = ''
let nextViewArmedAt = 0
let nextViewDone = ''
/** The pose a step first shows when it is a low view over the tiles; null for the far views, the sites and the ridge (nothing to warm). */
function firstViewOf(a: NavAction): { pose: Pose; fovDeg: number } | null {
  const m: Moment | undefined = a.kind === 'pin' ? hotspotList.find((h) => h.id === a.id)
    : a.kind === 'moment' ? MOMENTS.find((x) => x.id === a.id)
    : undefined
  if (!m || m.camera.at !== 'fly') return null
  return { pose: { lon: m.camera.lon, lat: m.camera.lat, dist: m.camera.dist, roll: 0, pitch: m.camera.pitch ?? 0 }, fovDeg: m.fovDeg ?? FLY_FOV_DEG }
}
function cancelNextViewPrefetch(): void {
  nextViewDone = ''
  nextViewArmedAt = performance.now()
  if (TILE_BASE) prefetcherFor(TILE_BASE).cancel(NEXT_VIEW_OWNER)
}
function nextViewTick(now: number): void {
  // ?nextprefetch=0 turns this one idle fetch off (A/B of Next with and without it, in one build).
  if (!TILE_BASE || STILL || !navApi || params.get('nextprefetch') === '0' || !prefetchAllowed(connection(), location.search)) return
  const st = navApi.state()
  const cur = navApi.current()
  const key = cur && st.state.pos && !st.state.away ? actionKey(cur) : ''
  if (key !== nextViewKey) { nextViewKey = key; cancelNextViewPrefetch(); return }
  if (!key || nextViewDone === key) return
  // A pin's held tween stays set (and its journey 'travelling') after the camera has stopped, so the move is judged by the tween's own clock.
  const moving = !!(tween && now < tween.t0 + tween.plan.ms + 300) || !!(cinematicFlight || routeFlight || ridge || flight || groundMode?.active || rig.gliding() || routeStarting)
  if (!nextViewReady({ msSinceInput: now - rig.lastInputAt, moving, inflight: tiles?.inflight ?? 0, armedForMs: now - nextViewArmedAt })) return
  nextViewDone = key
  const targets: PrefetchTarget[] = []
  for (const p of neighbourPositions(st.entries, st.state.pos)) {
    const v = firstViewOf(st.entries[p.entry].steps[p.step].action)
    if (v) targets.push(...capTargets(buildFlightPrefetchTargets(() => v, 1000, { aspect: canvasAspect(), samples: 40 })))
  }
  if (targets.length) void prefetcherFor(TILE_BASE).prefetch(targets, undefined, undefined, NEXT_VIEW_OWNER, 'low')
}
for (const type of ['pointerdown', 'wheel', 'keydown', 'touchstart'] as const) window.addEventListener(type, () => cancelNextViewPrefetch(), { passive: true, capture: true })
api.nextView = { state: () => ({ key: nextViewKey, done: nextViewDone, armedForMs: Math.round(performance.now() - nextViewArmedAt), sinceInputMs: Math.round(performance.now() - rig.lastInputAt), moving: { journey: journey.state?.status ?? null, tween: !!tween && performance.now() < tween.t0 + tween.plan.ms + 300, cin: !!cinematicFlight, route: !!routeFlight, ridge: !!ridge, flight: !!flight, ground: !!groundMode?.active, glide: rig.gliding(), starting: routeStarting }, inflight: tiles?.inflight ?? 0, stats: TILE_BASE ? { ...prefetcherFor(TILE_BASE).stats } : null }) }

function cancelFlightPrefetch(): void {
  if (!flightPrefetchController) return
  flightPrefetchController.abort()
  flightPrefetchController = null
  if (TILE_BASE) prefetcherFor(TILE_BASE).cancel('flight')
}
api.prefetch = prefetch

/**
 * After the first frame: the tiles manifest (one small request, shared with the streamer's create), then, when the
 * browser is idle, the two coarsest tile levels over every pin and the Apollo 17 and 11 patch manifests. Never before
 * the first frame, never on save-data or a 2g/3g connection. The patches' rasters are camera-demanded (PatchLayer).
 */
function scheduleIdlePrefetch(): void {
  if (STILL) return
  // The tile shader variants compile in the background once the page is idle: compiled on the first draw after a tap they freeze the page.
  // Local work, no network, so the data-saver gate below does not apply.
  if (TILE_BASE) compileQueue.enqueue('tiles', () => moon.prepareTiles(renderer))
  if (!prefetchAllowed(connection(), location.search)) return
  if (TILE_BASE) requestAnimationFrame(() => requestAnimationFrame(() => { void loadManifest(TILE_BASE).catch(() => { manifestFailed = true; syncOfflineNote() }) }))
  const run = (): void => {
    if (TILE_BASE) void prefetch(pinPrefetchTargets())
    if (!PATCH_BASE || patchState === 'loading') return
    if (patchSitesFound.has('a17')) prefetchLanderAssets()
    for (const id of ['a17', 'a11']) if (patchSitesFound.has(id)) void import('./moon/patch/PatchLayer').then((m) => m.prefetchPatch(`${PATCH_BASE}${id}/`))
  }
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback
  setTimeout(() => (idle ? idle(run, { timeout: 4000 }) : run()), 1500)
}

init().catch((e: unknown) => fail(String((e as Error)?.message ?? e)))
