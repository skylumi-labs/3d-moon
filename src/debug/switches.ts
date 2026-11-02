/**
 * The registry of every URL query switch the viewer reads. It is the inventory behind the debug "Switches" panel (panel.ts) and the guard
 * `scripts/switch-registry.test.mts`, which fails on any query-parameter read in `src/` whose name is not listed here.
 *
 * The readers themselves stay where they are: each is a small parser with its own clamps and a default that depends on the device class, and several run
 * at module load (before any registry import could be ordered). The registry records, per switch, the values worth offering as buttons, the default in force
 * when the parameter is absent, the effect, and whether it needs a reload. Nothing here runs for a visitor: the panel and this module load only in debug mode.
 *
 * `values` are the explicit options offered as buttons; empty means a free-form number, id or list that is not offered (URL only).
 * `def` is the value in force when the parameter is absent; null means the build, the device class or the manifest decides.
 * `restricted`: the switch can load restricted-licence or internal-only data (restricted-licence sources, company lander images, unconfirmed Apollo scans, internal layer ids),
 *   so the panel offers no button for it in a production build. It is shown and offered on the dev server only.
 */
export type SwitchGroup =
  | 'Tiles & streaming'
  | 'Shadows'
  | 'Flight & prefetch'
  | 'Quality & class'
  | 'Motion & pacing'
  | 'Look & post'
  | 'View & moments'
  | 'Data layers'
  | 'Measurement'

export const GROUPS: readonly SwitchGroup[] = [
  'Tiles & streaming', 'Shadows', 'Flight & prefetch', 'Quality & class', 'Motion & pacing', 'Look & post', 'View & moments', 'Data layers', 'Measurement',
]

export interface SwitchDef {
  readonly name: string
  readonly group: SwitchGroup
  readonly values: readonly string[]
  readonly def: string | null
  /** Every switch is read once at start (or on the next load), so changing it reloads the page. `live` is kept for a switch that can honestly apply without one. */
  readonly apply: 'reload' | 'live'
  readonly restricted?: boolean
  readonly effect: string
  /** Besides its buttons, the panel offers a small input for any other value (a number in range). */
  readonly custom?: boolean
}

const sw = (group: SwitchGroup, name: string, values: readonly string[], def: string | null, effect: string, restricted = false): SwitchDef =>
  ({ name, group, values, def, apply: 'reload', effect, ...(restricted ? { restricted: true } : {}) })
/** On unless `=0`. */
const on = (group: SwitchGroup, name: string, effect: string): SwitchDef => sw(group, name, ['0', '1'], '1', effect)
/** Off unless `=1`. */
const off = (group: SwitchGroup, name: string, effect: string): SwitchDef => sw(group, name, ['0', '1'], '0', effect)
/** A number or id typed into the URL; no button. */
const num = (group: SwitchGroup, name: string, effect: string, def: string | null = null): SwitchDef => sw(group, name, [], def, effect)

/** The ids in MOMENTS (src/moments.ts), listed here so this lazy module does not pull the moments table into a shared chunk; scripts/switch-registry.test.mts keeps the two equal. */
export const MOMENT_IDS: readonly string[] = [
  'first-light', 'earthrise', 'solar-eclipse', 'now', 'fly-around', 'far-side', 'surface', 'taurus-littrow-pass', 'apollo11', 'apollo17', 'apollo17-25cm', 'land-lm',
  'land-lm-eye', 'terminator-run', 'earthrise-low', 'plato-rim', 'tycho-rim', 'rille-run', 'pole-limb-sweep', 'bank-turn-a', 'bank-turn-b', 'sunrise-arc-a',
  'sunrise-arc-b', 'limb-glide-a', 'limb-glide-b',
]

const T = 'Tiles & streaming', S = 'Shadows', F = 'Flight & prefetch', Q = 'Quality & class', M = 'Motion & pacing', L = 'Look & post', V = 'View & moments', D = 'Data layers', X = 'Measurement'

import { DEV_SWITCHES } from './devSwitches'

const CUSTOM = new Set(['uploads', 'parkms', 'flightwant', 'pshk'])
const RAW: readonly SwitchDef[] = [
  // Dev-server only entries (restricted data): compiled out of a production build, so their names and text are not in the shipped panel.
  ...(import.meta.env?.DEV ? DEV_SWITCHES : []),
  // ---- Tiles & streaming
  off(T, 'pump', 'Tile pump: a settled fetch/decode admits the next queued job at once, and at rest the uploads per frame follow the frame interval. Opt-in.'),
  on(T, 'reveal', 'Centre-out upload order: of the decoded tiles waiting, the one nearest the middle of the frame (coarse level first) goes to the GPU first. 0 is arrival order.'),
  sw(T, 'uploads', ['1', '2', '4', '8'], null, 'At-rest tile uploads per frame, 1..16 (default 4), with or without the pump.'),
  on(T, 'tileworker', 'Decode tiles in a Worker pool; 0 decodes on the main thread.'),
  on(T, 'greyworker', 'Decode the Terrain Camera and WAC detail tiles in the tile Worker; 0 decodes them on the page thread (needs tileworker on).'),
  num(T, 'tilecache', 'Colour tile cache size in layers (otherwise from the device class).'),
  num(T, 'heightcache', 'Height tile cache size in layers, 8 or more (otherwise from the class).'),
  num(T, 'heightwant', 'Cap on height layers a frame may want, 8 or more (default: the phone-nadir rule).'),
  num(T, 'tccache', 'JAXA Terrain Camera detail cache in layers, 8 or more (default: class, else 96).'),
  num(T, 'tcwant', 'Cap on Terrain Camera tiles a frame may want, 8 or more (default 94).'),
  on(T, 'half', 'Decode Worker hands back half-float height bits, uploaded as HALF_FLOAT (same R16F contents); 0 keeps the Float32 result and upload.'),
  on(T, 'wantshare', 'The tile, detail and Terrain Camera streamers share one ray pass per view when they recompute on the same frame; 0 gives each its own pass.'),
  on(T, 'fadeout', 'A parked tile (and Terrain Camera tile) fades out over its arrival fade instead of dropping to the coarser level in one frame; 0 restores the step.'),
  sw(T, 'fadebatch', ['0', '1', 'cost'], null, 'Tile fades start on an 80 ms grid so arrivals share fade windows, and on phone, tablet and iOS classes a fade-only frame is drawn about every 66 ms. 0 starts every fade at its upload and draws every frame; 1 applies the cadence on every class; cost applies it wherever the measured full-size rest frame is over two vsyncs (rest-to-motion).'),
  off(T, 'focuspull', 'Focus pull (off by default since 2026-11-01, the owner turned the lens effect off for launch; 1 turns it on): a pixel drawn from a colour tile level coarser than its footprint wants is defocused by the detail it lacks and the defocus ramps to 0 over about 350 ms when the finer tile lands (replaces the opacity fade of the colour levels), and a split-prism focusing screen (Nikon F, 55 mm f/1.2) shows at the centre only while such tiles are loading. At rest, with everything resident, the image is the switch-off image.'),
  sw(L, 'focusmatte', ['traced'], null, 'With the focus pull on (the default): traced gives the whole frame the focusing screen matte\'s blur while tiles load (the comparison); absent keeps the frame outside the prism ring as the app draws it.'),
  on(T, 'park', 'Park cache slots that leave the wanted set (kept, not drawn) so a drag back finds them; 0 keeps history paged and drawn.'),
  sw(T, 'parkms', ['0', '1000', '3000'], '1000', 'Milliseconds a slot stays unwanted before it is parked, 0..5000.'),
  on(T, 'cpugate', 'Gate tile decode/upload work on CPU headroom; 0 removes the gate.'),
  sw(T, 'heightinflate', ['main'], null, 'Inflate gzip height tiles on the main thread instead of the Worker.'),
  sw(T, 'hitshare', ['off', 'motion', '1'], null, 'Share the terrain hit between passes: off, motion only, or always (default: always on desktop class, off otherwise).'),
  on(T, 'decontour', 'Tile decode: remove contour banding.'),
  on(T, 'ewaa', 'Tile decode: edge-weighted anti-aliasing.'),
  on(T, 'polarfilter', 'Tile decode: polar filter.'),
  on(T, 'destripe', 'Tile decode: destripe.'),
  sw(T, 'slice', ['off'], null, 'Patch conversion uploads in frame-sliced pieces; off uploads at once.'),
  num(T, 'maxtex', 'Cap on the patch texture side in pixels.'),
  sw(T, 'f32h', ['off'], null, 'off stops using linearly filtered float height textures.'),
  sw(T, 'tier', ['off'], null, 'off hides the Apollo 17 tier (25 cm) layer.'),
  sw(T, 'relief', ['off'], null, 'off hides the relief overlay tiles.'),
  on(T, 'deeper', 'Allow the deeper tile levels; 0 stops at the shallower ones.'),

  // ---- Shadows
  sw(S, 'shadows', ['full', 'baked', 'fast', 'off'], null, 'Shadow mode. Default: the Quality preset (full on desktop and phone). baked is honoured only by the shadow mode module; the Quality settings ignore it.'),
  on(S, 'shcache', 'Shadow cache of per-tile horizon layers; 0 marches every frame.'),
  on(S, 'pshcache', 'Shadow cache for the Apollo patch levels (needs shcache).'),
  on(S, 'pshcatchup', 'Pre-arrival catch-up: build the Apollo patch shadow blocks during the descent or fly-in, at half the rest rate; 0 builds only once the camera rests (needs pshcache).'),
  sw(S, 'shmotion', ['cache'], null, 'cache: use the cached shadows during motion instead of the live march.'),
  sw(S, 'shprobe', ['noupdate'], null, 'noupdate: stop shadow cache updates (measurement).'),
  sw(S, 'shadowpolicy', ['legacy', 'fixed'], null, 'fixed: keep cached shadows during camera motion and build them on motion frames; the Sun alone invalidates them (A/B).'),
  num(S, 'shbudget', 'Fixed shadow layers built per frame, 0..64 (default: adaptive).'),
  num(S, 'pshbudget', 'Fixed patch shadow layers built per frame, 0..64.'),
  num(S, 'shbuildms', 'Fixed-policy global shadow build allowance per frame, 0.25..8 ms; default 1.5 phone / 3 desktop.'),
  num(S, 'pshbuildms', 'Fixed-policy patch shadow build allowance per frame, 0.25..8 ms; default 1.5 phone / 3 desktop.'),
  sw(S, 'pshk', ['1', '2', '4', '8'], null, 'Patch shadow sub-sample factor override.'),
  num(S, 'shcap', 'Shadow cache layer cap, 8 or more (default: class memory cap).'),
  on(S, 'shfix', 'Catch-up sizing of the shadow cache build; 0 restores the older sizing.'),
  on(S, 'shprecompile', 'Precompile the shadow-cache programs in the worker; 0 skips it.'),
  on(S, 'shwarm', 'Warm the shadow cache before ready; 0 skips it.'),
  sw(T, 'precompile', ['0', '1', 'all', 'tiles', 'ground', 'lm', 'meta'], null, 'Background shader compiles, one per idle slot: default tiles, ground, lm; 0 none (the first draw compiles), a comma list only those, all adds the metadata programs.'),
  sw(S, 'lmself', ['0', '1'], null, 'Lunar module self-shadowing (the Sun light\'s shadow map on its own materials): 0 off, 1 on. Default: on, except in the app on a PowerVR GPU (issue #206).'),
  sw(Q, 'lmmat', ['standard', 'physical'], null, 'Lunar module materials: standard PBR (default on phone classes) or physical with the foil clearcoat (default elsewhere).'),
  sw(L, 'lmlook', ['main', 'crisp', 'matte', 'bright'], 'main', 'Lunar module look-dev variant (ground/lmMaterials.ts): albedo scale, foil roughness and metalness, crinkle strength. main is the shipped look.'),
  sw(M, 'gprobe', ['async'], null, 'async: the ground height probe (walking, gliding) read back through a fence and served one frame late within 20 cm; default: synchronous (waits for the GPU on every cache miss).'),
  off(M, 'groundbudget', 'Ground mode learns its own motion-grid start from ground frames (GroundMode.budget). Inert until main.ts calls budget.start / budget.observe.'),
  off(M, 'grefit', 'Ground mode: a lander refit reads its five ground points in one readback and waits (at most 250 ms) for the input to pause.'),
  sw(S, 'shreach', ['300'], null, 'Invalidation reach of a cached layer: default per level; 300 is the flat 300 km.'),
  sw(S, 'shlod', ['foot'], null, 'foot: coarser shadow level of detail at the foot of a slope.'),
  num(S, 'shadowaa', 'Shadow anti-aliasing amount.'),
  sw(S, 'shadowkey', ['legacy'], null, 'legacy: the previous shadow key light.'),
  num(S, 'shadowfill', 'Fill light in shadow, 0.03 original (0.04 under look=a).'),
  num(S, 'fillramp', 'Shadow fill ramp dial.'),
  num(S, 'fillshi', 'Shadow fill high-sun dial.'),
  num(S, 'fillslo', 'Shadow fill low-sun dial.'),
  sw(S, 'horizon', ['off', 'aa4', 'aa', 'lp', 'full'], 'full', 'Skyline sub-pixel rays and far low-pass.'),
  num(S, 'termaa', 'Terminator anti-aliasing width.'),
  num(S, 'bk_far', 'Baked-shadow live march reach in metres, 16..4096 (default 128).'),
  num(S, 'bk_n', 'Baked-shadow live march samples, 4..192 (default 32).'),
  num(S, 'bk_pow', 'Baked-shadow live march spacing power, 1..3 (default 1).'),
  sw(S, 'terrain', ['off'], null, 'off skips the terrain-resolved shadow march.'),
  num(S, 'tsteps', 'Terrain march step budget (128 is the reference).'),
  sw(S, 'march', ['old'], null, 'old: the pre-tile march.'),
  sw(S, 'tierdtm', ['off'], null, 'off: do not shade with the Apollo 17 tier terrain.'),
  off(S, 'surround', 'Fused ground: a modelled (not measured) texture where no photograph reaches, on the Moon pass and, at eye level, the ground view (hills beyond the photograph). Default off.'),
  on(S, 'gshadow', 'Ground-mode shadows; 0 removes them.'),
  num(S, 'gsteps', 'Ground-mode march steps, 8..384 (default 384).'),
  num(S, 'ghitx', 'Repeat the ground hit ray 1..4 times (measurement; image unchanged).'),
  sw(S, 'hit', ['mm'], null, 'mm: max-mip terrain hit (invalidated experiment; see the ledger).'),
  on(S, 'pvariant', 'Patch shader variants; 0 turns them off.'),

  // ---- Flight & prefetch
  sw(F, 'prefetch', ['off'], null, 'off: no prefetching (tiles, patches, lander assets).'),
  off(F, 'prefeat', 'Flight prefetch feature caps (level and size). Opt-in until the rig run.'),
  on(F, 'prefetchlru', 'Evict held prefetch files least recently queued first; 0 restores first-insertion order.'),
  sw(F, 'flightwant', ['1', '4'], '4', 'Flight wanted-set window multiplier, 1..8.'),
  on(F, 'patchpre', 'Selecting an Apollo moment starts the site photograph\'s coarse level downloading at low priority; 0 leaves it to the camera\'s demand.'),
  on(F, 'nextprefetch', 'Prefetch the next moment while one plays; 0 turns it off.'),
  off(F, 'wantprobe', 'Measurement: __moon.exactResidency() recomputes the unthrottled want and counts what is resident.'),

  // ---- Quality & class
  sw(Q, 'class', ['desktop', 'tablet', 'phone-android', 'ios', 'ipad', 'software'], null, 'Force the startup device class (measurement and emulation). Default: detected.'),
  on(Q, 'memcap', 'Memory ceiling enforcement (R54): the website iPhone and iPad patch caps and the shed that releases the off-screen patch, then tiles, when the ledger stays over the class ceiling. 0 restores the layer defaults and no shed.'),
  on(Q, 'cachegrow', 'Adaptive tile cache on phone and tablet classes (W3-M5): starts at the class size and grows one step at rest while memory, frame time and context-loss signals are calm, shrinks at once on pressure. 0 keeps the fixed class size.'),
  sw(Q, 'quality', ['auto', 'high', 'battery'], null, 'Quality preset.'),
  sw(Q, 'detail', ['full', 'reduced'], null, 'Surface detail (a number is the older detail-strength dial: 0 is none).'),
  sw(V, 'descent', ['legacy'], null, 'Pin descents (Apollo 11, Apollo 17): legacy restores the earlier path (short pitch-over, camera backs off along the end heading and returns) and the clock that held at the floor. Default: the smoothed descent.'),
  sw(V, 'a17arrive', ['hold', 'legacy'], 'legacy', 'Apollo 17 arrival (complaint 7, 2026-10-23): hold flies to a held overview of the valley and drops only when the eye view\'s levels, the module, the ground programs and the patch shadow blocks are in (a stall shows a chip, never a drop into a blur); legacy drops on the coarse photograph. Default legacy until the rig check.'),
  sw(Q, 'glow', ['on', 'off'], null, 'Sun and Earth glow.'),
  sw(Q, 'phonemotion', ['0', '1'], null, 'Motion detail row: 1 smooth motion shader, 0 classic.'),
  sw(Q, 'motionshader', ['0', '1'], null, 'The older name of phonemotion (wins when both are given).'),
  num(Q, 'dpr', 'Pixel ratio override, 0..4.'),
  sw(M, 'idle', ['0'], null, 'Rest state: 0 keeps the frame loop asking for a frame at every vsync. Default on: after 2.5 s of nothing moving or loading the loop sleeps (a redraw request, an input or a one-second heartbeat wakes it). Off on the native shell and in stills.'),
  sw(Q, 'sharp', ['0', '1'], '0', 'Sharp first on phone, tablet and iOS classes (WP-G): a flight holds one grid (class and flight; the grid is the only scale), 30 fps flights, Catmull-Rom upscale, gesture grid from 0.5, a larger non-aborting flight prefetch. Default off until the phone A/B.'),
  sw(Q, 'motion', ['default', 'sharp'], 'default', 'Constant-resolution motion (quality/sharpMotion.ts): gestures and flights render at the rest size (grid 1, motion DPR = rest DPR); the grid ladders, remembered coarse grids and emergency/wall steps are off. Over budget: defer shadow-cache builds and tile uploads, cheaper shader variant, then an explicit 30 fps tier; never a lower resolution. Default off until the rig and phone A/B. Also localStorage moon.motionPolicy.'),
  sw(Q, 'flighthz', ['0', '1'], null, 'Scripted-flight frames keep the rest terrain march and the skyline antialiasing (the motion caps of 12 samples and no horizon rays are what terrace a flight skyline). Default off; on under ?sharp=1 unless 0. Not a gesture frame. Unmeasured.'),
  sw(Q, 'upscale', ['bilinear', 'catmull'], null, 'Stage-2 reconstruction of a magnified frame at 1.02 to 2.5x: catmull is the default under ?sharp=1, bilinear otherwise.'),
  num(Q, 'sharpfps', 'Flight frame rate under ?sharp=1: 0 removes the cap, 15..60 sets it. Default 30.'),
  num(Q, 'fps', 'Web frame cap in frames a second: 0 turns it off, 15..240 sets it. Default: 60 on phone, tablet and iOS classes, none on desktop.'),
  sw(Q, 'restdpr', ['off'], null, 'Rest-frame pixel ratio cap; off removes the class default.'),
  sw(Q, 'desktopsharp', ['0', '1'], null, 'Desktop motion policy (quality/phoneSharp.ts DESKTOP_PARAMS): the desktop class draws moving frames at f 1 of the canvas, 0.75 when frames are consistently slow (GPU-time-vetoed trigger), then 30 fps; never under 0.75. Default on; 0 restores the grid ladders.'),
  num(Q, 'motionmp', 'Desktop motion pixel cap (quality/phoneSharp.ts DESKTOP_MOTION_MP): under the desktop motion policy a moving frame keeps at most this many megapixels of render pixels, applied after the f ladder (f goes under 0.75 only on canvases where f 0.75 exceeds the cap, e.g. 5120x2880). 0 removes the cap. Default 8; phones are never capped.', '8'),
  sw(Q, 'phonesharp', ['0', '1'], null, 'Phone motion policy (quality/phoneSharp.ts): touch classes on the web draw every moving frame at one fraction f of the canvas (1.25 px per CSS px, never under half), moments at 30 fps, gestures drop to 30 fps before f drops, native stars, Catmull-Rom, a rest governor that recovers. Default on for ios/ipad/phone-android/tablet; 0 restores the grid ladders.'),
  num(Q, 'phonef', 'Phone motion policy: force f (0.1..1) for a rig A/B. Measurement only.'),
  sw(Q, 'phonehz', ['30', '60'], null, 'Phone motion policy: force the cadence tier for a rig A/B. Measurement only.'),
  sw(Q, 'restgov', ['0', '1'], null, 'Rest-frame DPR governor (lowers the rest ratio after slow rest frames): 0 off, 1 on for any non-desktop class; default on for web phones and the native shell.'),
  sw(Q, 'motioncaps', ['0', '1'], null, 'Force the motion caps on or off (default: the preset).'),
  num(Q, 'motionstart', 'Starting motion grid scale (a step of the motion ladder, which also turns the cost start off), or cost: start from the last gesture\'s measured motion cost, else from the rest cost times ?motionfactor= (rest-to-motion). Default: cost on the desktop class (measured 2026-10-23), the class start on every other class.'),
  num(Q, 'motionfactor', 'Under ?motionstart=cost with no motion cost yet: the live-march motion frame\'s cost as a multiple of the cached rest frame\'s (an estimate; default 1).'),
  num(Q, 'mdpr', 'Motion-only pixel-ratio cap for canvases over 3 Mpx (1.5: motion frames at 1.5, rest frames keep the full ratio). Default: none on every class.'),
  num(Q, 'motionscale', 'Force a fixed motion grid scale, 0.05..1.'),
  num(Q, 'fixedshare', 'Motion cost model fixed share, 0..0.95 (0 is the pure pixel-count model).'),
  num(Q, 'targetcache', 'Kept render sizes, up to 8.'),
  num(Q, 'startcap', 'Desktop drag start cap: 0 removes it, 0.5 the old value (default 0.7).'),
  sw(Q, 'flightscale', ['hyst'], null, 'hyst: hysteresis ladder for the flight scale (default: the old ladder).'),

  // ---- Motion & pacing
  sw(M, 'pace', ['off', 'on', 'rest'], null, 'Frame backpressure. Default: on (every frame fenced) for fence-class phones, rest on the desktop class (rest frames only: one dear frame in flight, a press waits for at most one; gesture frames are never held), off on other classes. off disables it, on/all fences every frame.'),
  sw(M, 'settle', ['stepped'], null, 'stepped: the hand-back\'s full-size frame is one submit only when it fits two vsyncs; a dearer one waits ?settlequiet= ms of no input, then goes in bands of at most ?bandms= (50). Implies ?pace=rest. Default: today\'s single full frame.'),
  num(M, 'settlequiet', 'Under ?settle=stepped: the quiet spell (ms) a dear full frame waits for; 0 draws it at once, in bands. Default 300.'),
  off(M, 'pressyield', 'For 300 ms after a pointerdown the tile uploads and the shadow-cache builds stand down.'),
  num(M, 'wallmem', 'Keep the wall ladder\'s lite latch, cap and the grid the last gesture ended on across rests for this many ms (60000 with no value), and forget them when the canvas size changes. Default: on (60000) on the desktop class, 4000 and no size check on every other class; 0 turns it off.'),
  sw(M, 'pacetier', ['auto', 'off', '60', '30'], 'auto', 'Pacing tier: native, 60 Hz or 30 Hz steady.'),
  num(M, 'pacelight', 'Frame pacer light threshold (ms).'),
  num(M, 'paceold', 'Frame pacer old threshold (ms).'),
  sw(M, 'bands', ['off', 'on'], null, 'Draw expensive frames as bands, one per fence. Default: fence classes only.'),
  num(M, 'bandms', 'Band budget in ms (default 150; 50 under ?settle=stepped).'),
  on(M, 'datecarry', 'A pick carries the sky (Sun, Earth, stars) from the picture on screen to the place\'s date over its move; 0 cuts it on the first frame (before 2026-10-29).'),
  on(M, 'aimrelease', 'A pick that centres the subject eases the layout aim to 0 under its move; 0 drops it on the first frame (before 2026-10-29).'),
  off(M, 'datefade', 'A moment start crossfades the old picture into the moving flight (pre-R4 behaviour); default cuts.'),
  on(M, 'wall', 'Wall-clock backstop for a GPU timer that lags; 0 turns it off.'),
  off(M, 'motiongrid', 'Motion shader follows the grid only (not the gesture).'),
  off(M, 'motionlite', 'Run every motion frame on the lite march.'),
  on(M, 'restcache', 'Build the rest frame in catch-up steps; 0 draws the full frame at once.'),
  num(M, 'restbudget', 'Freeze threshold for the full rest frame in ms.'),
  on(M, 'fastfirst', 'Fast first frame; 0 waits for the full frame.'),
  on(M, 'preexpose', 'Pre-expose before the first frame; 0 turns it off.'),
  on(M, 'coarsegain', 'Gesture exposure coarse-search gain correction; 0 restores the older behaviour.'),
  sw(M, 'fp16flush', ['1', '2'], null, 'Flush the half-float render targets (1 or 2 passes) to work around a driver precision fault (measurement).'),
  sw(M, 'flightexposure', ['coarse'], null, 'coarse: coarse exposure search during flights (default: full).'),
  on(M, 'expsnap', 'Exposure settle and subject anchor; 0 restores the old behaviour.'),

  // ---- Look & post
  sw(L, 'look', ['a', 'alt', 'old'], null, 'Look mode: a uses option A dial values; alt keeps the old altitude blend of the terminator key; old keeps the geometric key. The values sun, earth and 0..1 are not modes: they aim a shared link and are kept on Reset.'),
  on(L, 'sharpen', 'Sharpened reconstruction; 0 keeps plain bilinear.'),
  sw(L, 'shoulder', ['legacy'], null, 'legacy: the previous orbit highlight rolloff.'),
  sw(L, 'hlwash', ['legacy'], null, 'legacy: the hover highlight\'s gold wash at a fixed share of white whatever the ground\'s light (an unlit crater drew as an opaque tan disc); default follows the ground\'s luminance, rim only on unlit ground.'),
  num(L, 'nightfloor', 'Night-side display floor as a share of display white on unlit ground (default 0.008 since 2026-10-24: about 11 to 26 of 255 by albedo; 0 turns it off). A look, not a measured brightness.'),
  sw(L, 'sun', ['legacy'], null, 'legacy: the previous Sun look.'),
  on(L, 'ring', 'Earth ring; 0 removes it.'),
  sw(L, 'starmag', ['auto', 'off'], 'auto', 'Star limiting-magnitude cull: stars too faint to change a pixel at the current exposure are not drawn (auto). off draws the whole V 6.5 catalogue; a number 0..8 pins a fixed limit.'),
  num(L, 'starboost', 'Star brightness boost, 0..1 (default: stored choice).'),
  sw(L, 'skystars', ['on', '0'], 'on', 'Sky-star lift: stars stay faintly visible beside a sunlit Moon (display-space, final pass). 0 shows the physical sky (black there).'),
  num(L, 'starlift', 'Minimum star lift in the exposure, 0..1 (rig switch).'),
  sw(L, 'stars', ['native', 'scene', '0'], null, 'Star draw path: native-resolution dots or scene sprites; 0 hides stars. Default: native on the desktop class (moment-FWHM 1.62 px on every drag frame against 3.1 px for the sprites, L4 rig), scene on every other class. scene is the opt-out.'),
  sw(L, 'noearth', ['1'], null, 'Hide the Earth.'),
  sw(L, 'nosun', ['1'], null, 'Hide the Sun.'),
  sw(L, 'a10thin', ['0', '2'], null, 'Thin-feature clamp: 0 off, 2 also two-texel features. Default on.'),
  num(L, 'a10ratio', 'Thin-feature clamp start ratio.'),
  on(L, 'a10peak', 'Also clamp isolated lit peaks; 0 is the pre-fix behaviour.'),
  off(L, 'a10keep', 'Keep a clamped texel\'s excess shared over the magnification.'),
  on(L, 'normalfilter', 'Filtered normals; 0 uses raw normals.'),
  on(L, 'pedge', 'Patch edge fix; 0 removes it.'),
  off(L, 'nfmotion', 'Normal filter during motion.'),
  num(L, 'althi', 'Albedo high dial.'),
  num(L, 'altlo', 'Albedo low dial.'),
  num(L, 'radhi', 'Radiance high dial.'),
  num(L, 'radkey', 'Radiance key dial.'),
  num(L, 'radlo', 'Radiance low dial.'),
  num(L, 'sunkeyhi', 'Sun key high dial.'),
  num(L, 'sunkeylo', 'Sun key low dial.'),
  num(L, 'tcgain', 'Terrain Camera detail gain, 0..8 (default 2).'),
  sw(L, 'tcuv', ['0', '1', '2'], '0', 'Where the Terrain Camera is looked up: 0 terrain hit, 1 smoothed ground, 2 sphere hit.'),
  sw(L, 'near', ['off', 'photo'], 'photo', 'Ground mode: modelled near-field relief, rocks, craters, grain, trampled ground and opposition surge around the camera, baked once per standing spot (modelled, not measured).'),
  sw(L, 'bake', ['0', '1'], null, 'With near=photo: 0 evaluates the modelled ground per march step in the shader (the first prototype) instead of the baked textures.'),
  sw(L, 'tracks', ['0', '1'], null, 'With near=photo: the modelled trampled ground, boot prints and rover tracks (on by default when baked; not the real ones).'),
  sw(L, 'nearlook', ['0', 'film'], null, 'With near=photo: a look tweak toward the Apollo 17 Hasselblad frames (contrast, a darker browner soil); not a physical claim. 0 turns it off.'),
  num(L, 'dbg', 'Moon shader diagnostic view number.'),
  sw(L, 'shadowdebug', ['serve'], null, 'Dev builds, rig only: colour each pixel by what served its Sun horizon (exact tile, live march, patch cache); __moon.serveSummary() counts them.'),
  sw(L, 'ghcache', ['0'], null, 'Fixed shadow policy: 0 keeps the live 4k-map march (no horizon envelope), for A/B.'),
  sw(L, 'sunbake', ['0'], null, 'Fixed shadow policy: 0 leaves out the Sun-keyed 4k horizon bake (per-cell lo / hi horizon toward the fixed Sun; skips the 4k Sun march lit and shadowed), for A/B.'),
  num(L, 'sbmargin', 'Fixed shadow policy: degrees added to both sides of the Sun-keyed 4k bake\'s sampled horizon range (default 1; rig knob for the bound\'s reliability).'),
  num(L, 'sbgrid', 'Fixed shadow policy: side of the position grid the Sun-keyed 4k bake samples per cell (2..7; default 3).'),
  num(L, 'ghsub','Fixed shadow policy: degrees of margin for the terminator sub-pixel taps to reuse the first tap\'s horizon (default 0 = off: march all four; an estimate, not a bound).'),
  sw(L, 'tenv', ['0'], null, 'Fixed shadow policy: 0 keeps the live tile march (no per-tile horizon envelope), for A/B.'),
  num(L, 'ghaz', 'Fixed shadow policy: azimuth samples of the 4k-map horizon envelope (a multiple of 8, 8..96; default 32).'),
  num(L, 'ghpts', 'Fixed shadow policy: side of the cell sample grid the 4k envelope uses for its fine lods (3..9; default 3).'),
  num(L, 'envblocks', 'Dev, software-GL runs: build this many horizon-envelope blocks a frame in both envelope caches whatever the GPU budget says.'),
  num(L, 'tenvaz', 'Fixed shadow policy: azimuths per sample point of the per-tile horizon envelope (default 24, 4..64).'),
  sw(L, 'tenvpts', ['5', '9'], null, 'Fixed shadow policy: sample points per cell of the per-tile horizon envelope: 9 (3 x 3 out to 0.75 cell, default) or 5 (centre and corners).'),
  num(L, 'tenvmargin', 'Fixed shadow policy: degrees added to the per-tile horizon envelope (default 2).'),
  sw(L, 'tapshare', ['0'], null, 'Fixed shadow policy: 0 turns off the exact sub-pixel tap shortcuts (a shadowed tap stops its tile march at the Sun, and the Sun skip uses a tighter certificate), for A/B.'),
  num(L, 'ghsubt', 'Fixed shadow policy: like ghsub for pixels that carry tile ground (default 0 = off).'),
  num(L, 'dbgkill', 'Moon shader term kill mask (diagnostic).'),

  // ---- View & moments
  sw(V, 'view', ['fly', 'earth'], null, 'Open on the fly view or the Earth view instead of home.'),
  sw(V, 'skydrag', ['damped'], null, 'A drag over the sky (owner 2026-10-31): by default it turns the Moon as fast as a grab of the disc\'s centre (camera/grab.ts skyDragGain); damped keeps the older, slower sky rate (altitude / sqrt(1 + altitude)).'),
  sw(V, 'flooredge', ['0', '1'], '1', 'Camera floor past a block of finer height or Terrain Camera data (coverage.ts deeperFloorAt): 1 the cone from the block\'s edge (continuous, owner item 7); 0 the old ladder whose cone starts at the search rung (steps up to a third of the distance).'),
  sw(V, 'moment', MOMENT_IDS, null, 'Open a moment (a real date with a camera and a tour card).'),
  sw(V, 'start', ['ridge', 'earth'], null, 'Start in the ridge view or the Earth view.'),
  sw(V, 'intro', ['0', '1'], null, 'The title splash and flyby: 0 off, 1 on whatever else holds. Default: on for a bare page in a real browser.'),
  sw(V, 'introplace', ['legacy'], null, 'legacy: the previous opening placement (default: sunrise).'),
  on(V, 'caption', 'Centre caption (feature name under the screen centre); 0 turns it off.'),
  sw(V, 'labelstyle', ['classic'], null, 'Centre caption look: absent is the "Target lock" style (corner brackets, typed name, LAT/LON, IAU type and diameter); classic restores the plain name above the dock.'),
  sw(V, 'controls', ['0', '1'], null, 'On-screen flight controls open (1) or closed (0). Default: remembered choice.'),
  sw(V, 'auto', ['0', '1'], null, 'Idle orbit: 0 never, 1 on. Default: per view.'),
  num(V, 't', 'Fix the time (an ISO date); the clock stops.'),
  num(V, 'lon', 'Fly pose: longitude, degrees east.'),
  num(V, 'lat', 'Fly pose: latitude, degrees.'),
  num(V, 'dist', 'Fly pose: distance in Moon radii.'),
  num(V, 'roll', 'Fly pose: roll, degrees.'),
  num(V, 'pitch', 'Fly pose: tilt from straight down, degrees.'),
  num(V, 'fov', 'Lens field of view, degrees.'),
  num(V, 'pin', 'Place the camera at a site pin (a11, a17).'),
  num(V, 'g', 'Ground view pose (seven or eight comma-separated numbers).'),
  num(V, 'off', 'Free camera offset (four comma-separated numbers).'),
  sw(V, 'vp', ['hover', 'eye'], null, 'Viewpoint height in the ground view.'),
  sw(V, 'aim', ['1'], null, 'Keep the aim in a shared link.'),
  num(V, 'panorama', 'Open an Apollo 17 panorama by id.'),
  num(V, 'journey', 'Ridge view journey progress, 0..1.'),
  num(V, 'seed', 'Random seed for the opening and scatter, 1 or more.'),
  num(V, 'label', 'Review badge text shown top-left and in the tab title (60 characters).'),
  sw(V, 'archive', ['1'], null, 'Show the archived moments row.'),
  sw(V, 'hotspots', ['0', '1'], null, 'First-visit hotspots (animated rings on the Moon\'s places): 1 forces them on every load (review, rig; remembers nothing), 0 turns them off. Default: first load only, never on a shared link.'),

  // ---- Data layers
  sw(D, 'tiles', ['off'], null, 'Moon tile base. off turns streamed tiles off. Another base is URL only (bucket, loopback or the build base; refused otherwise).'),
  sw(D, 'patch', ['off'], null, 'Apollo patch base. off turns the patches off. Another base is URL only (gated like tiles).'),
  sw(D, 'midpatch', ['off'], null, 'Mid-resolution patch base. off turns it off. Another base is URL only.'),
  sw(D, 'horizons', ['off'], null, 'Baked horizon table base. off turns it off. Another base is URL only.'),
  sw(D, 'tc', ['off'], null, 'JAXA Terrain Camera base (public, credited ISAS/JAXA (modified)). off turns it off. Another base is URL only.'),
  sw(D, 'heat', ['1'], null, 'Photo resolution map overlay.'),
  off(D, 'labels', 'The Labels layer (names on posts, the area highlight, the terminator) on at start, as the bar\'s Labels button.'),
  on(M, 'labelfast', 'Labels layer write path: only changed values are written, on the device-pixel grid, with no layout read inside a frame, and the layer is contained. 0 restores every write every frame.'),
  on(M, 'labelthin', 'Keep the highest-priority names during camera motion, then fade the full set back after 250 ms at rest. 0 disables motion thinning.'),
  on(M, 'labelspread', 'Centre fill of the Labels layer: when the middle third of the frame holds fewer than 3 names, curated rows the zoom keeps out and the region\'s largest Gazetteer features there join (owner complaint 2026-10-22). 0 leaves the middle third as the tiers alone fill it; it is the coverage A/B only (the motion fixes of the same change, leaving boxes closed to all and the reuse check, run in both arms; the full baseline is the base build).'),

  // ---- Measurement
  sw(X, 'debug', ['1'], null, 'Debug mode: text overlays, quality readout, resolution map, and this Switches panel.'),
  sw(X, 'still', ['1'], null, 'Capture mode: no chrome, no live clock, no panel. Used by captures and films.'),
  off(X, 'perf', 'Frame-time and GC counters on __moon.perf.'),
  off(X, 'perfhud', 'Performance readout.'),
  off(X, 'passes', 'Per-pass GPU timing.'),
  on(X, 'gputimer', 'GPU timer queries; 0 turns them off.'),
  sw(X, 'gpusource', ['fence'], null, 'fence: time frames by fences instead of timer queries.'),
  off(X, 'sampler', 'Flight sampler recording (also turns telemetry off).'),
  sw(X, 'exptrace', ['1', 'full'], null, 'Exposure trace in the console.'),
  sw(X, 'telemetry', ['0', '1'], null, 'Telemetry: 0 off, 1 on even with ?sampler=1.'),
  sw(X, 'abl', [], null, 'Comma list of ablations (shadow0, glare0, dom0, ...). Honoured only with ablok=1.'),
  sw(X, 'ablok', ['1'], null, 'Allow abl.'),
  sw(X, 'ablate', [], null, 'Dev builds only (ignored in production): comma list of shadows, viewhz, glare, detail, coverage, shading; removes one piece of the frame for the rig\'s incremental pass costs.'),
]

export const SWITCHES: readonly SwitchDef[] = RAW.map((d) => (CUSTOM.has(d.name) ? { ...d, custom: true } : d))

/** Reads inside shared-link and helper code that the scan cannot see by name; registered above, listed here so the test can check them. */
export const SHARE_KEYS: readonly string[] = ['g', 'look', 'off', 'vp', 'pin', 'lon', 'lat', 'dist', 'roll', 'pitch', 'fov', 'aim']

const BY_NAME = new Map(SWITCHES.map((s) => [s.name, s]))
export const switchDef = (name: string): SwitchDef | undefined => BY_NAME.get(name)

/** True on the dev server; false in a production build and under the test runner (no `import.meta.env`). */
export const isDevBuild = (): boolean => !!import.meta.env?.DEV

/** Whether the panel offers this switch: a restricted one only on the dev server. */
export const switchOffered = (s: SwitchDef, dev: boolean = isDevBuild()): boolean => !s.restricted || dev

export { debugEnabled } from './gate'

const valueIn = (s: SwitchDef, search: string): string | null => {
  const v = new URLSearchParams(search).get(s.name)
  if (v === null) return s.def
  return s.values.length === 0 || s.values.includes(v) ? v : s.def
}

/** The value a switch has in this query string: the parameter when it is one the switch offers (any text for a free-form one), else the default. */
export function readSwitch(name: string, search: string): string | null {
  const s = BY_NAME.get(name)
  if (!s) throw new Error(`unregistered switch: ${name}`)
  return valueIn(s, search)
}

/** The raw text of a parameter that is present but not one of the offered values (shown as-is in the panel), else null. */
const otherIn = (s: SwitchDef, search: string): string | null => {
  const v = new URLSearchParams(search).get(s.name)
  return v !== null && !s.values.includes(v) ? v : null
}

/** The URL with one switch set (null, or the default value, removes it). Other parameters and the hash are kept. */
export function withSwitch(href: string, name: string, value: string | null): string {
  const s = BY_NAME.get(name)
  const u = new URL(href)
  if (value === null || (s && value === s.def)) u.searchParams.delete(name); else u.searchParams.set(name, value)
  return u.toString()
}

/**
 * Parameters kept by "Reset all": the debug gate, the capture flag, the camera and time of the view (an A/B compares settings at the same place),
 * and the opening/idle settings intro, auto and seed (a B arm must not start playing the flyby or the idle orbit). `look` is kept only when it is a
 * framing value (sun, earth, or a number between 0 and 1); a, alt and old are look modes and are reset.
 */
const KEEP = new Set(['debug', 'still', ...SHARE_KEYS.filter((k) => k !== 'look'), 't', 'view', 'moment', 'start', 'panorama', 'journey', 'label', 'archive', 'intro', 'auto', 'seed'])
export function keptOnReset(name: string, value: string | null = null): boolean {
  if (name === 'look') { const n = Number(value); return value === 'sun' || value === 'earth' || (value !== null && value.trim() !== '' && n > 0 && n < 1) }
  return KEEP.has(name)
}

/** The same page with every switch parameter at its default: all registered parameters removed except the kept ones above. */
export function allDefaults(href: string): string {
  const u = new URL(href)
  for (const s of SWITCHES) if (!keptOnReset(s.name, u.searchParams.get(s.name))) u.searchParams.delete(s.name)
  return u.toString()
}

/** Registered setting parameters present in the URL with a non-default value (the view and gate parameters are not counted). */
export function nonDefault(href: string): string[] {
  const q = new URL(href).searchParams
  return SWITCHES.filter((s) => !keptOnReset(s.name, q.get(s.name)) && q.has(s.name) && q.get(s.name) !== s.def).map((s) => s.name)
}

/** What the panel shows: switches grouped by area, with whether each is offered as buttons here. */
export interface PanelRow { def: SwitchDef; offered: boolean; current: string | null; other: string | null }
export function panelRows(search: string, dev: boolean = isDevBuild(), all: readonly SwitchDef[] = SWITCHES): { group: SwitchGroup; rows: PanelRow[] }[] {
  return GROUPS.map((group) => ({
    group,
    // A restricted switch is not listed at all in a production build: the panel never names it.
    rows: all.filter((s) => s.group === group && switchOffered(s, dev)).map((def) => ({
      def,
      offered: def.values.length > 0,
      current: valueIn(def, search),
      other: otherIn(def, search),
    })),
  }))
}
