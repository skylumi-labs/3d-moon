/**
 * Why the picture carries less detail than a desktop's (SPEC section 3.1, the "Reduced detail" chip). Pure: main.ts feeds it the class, the profile, what
 * was actually allocated and the visitor's Quality preset, and the chip lists what comes back.
 *
 * Wording rules: say what is missing, never "optimised" or "best for your device". A Battery saver choice is the visitor's own and is said as such;
 * it never hides a memory line, and `high` does not remove memory cuts (the ledger ceiling is not a preset).
 */
import { CLASS_TABLE, type ClassProfile, type QualityClass } from './startupClass'
import type { QualityPreset } from './settings'
import { dprFor } from './dpr'

export type ReducedAxis = 'dpr' | 'tc' | 'tiles' | 'pano' | 'shadow' | 'memory' | 'battery'
export type ReducedWhy = 'device class at start' | 'your Quality setting' | 'memory' | 'memory (the graphics context was lost)' | 'Memory' | 'Battery saver is on'
export interface ReducedReason { axis: ReducedAxis; why: ReducedWhy; text: string }

export interface ReducedInput {
  cls: QualityClass
  profile: ClassProfile
  /** The ceiling in force now (a lost context lowers it below `profile.ceilingBytes`). */
  ceilingBytes: number
  contextLosses: number
  /** OS memory warnings this session (native shell): each lowers the ceiling, and the chip says so with the reason "Memory". */
  memoryWarnings?: number
  /** Tile layers actually allocated after the ledger fit; undefined until the streamer exists. */
  allocatedTiles?: number
  /** window.devicePixelRatio. */
  nativeDpr: number
  /** The pixel-ratio caps in force after the Quality preset (`motionKnobs`), not the class row: High and Battery change them on a phone. */
  dprCap: number
  /** Close-in cap (`motionKnobs`), applied by dprFor when `dist` is at or under CLOSE_DPR_FROM. */
  closeDprCap?: number
  /** Camera distance in Moon radii as the renderer passes it to dprFor (0 in ground mode or a flight frame); omitted: the far ratio. */
  dist?: number
  /** Rest-frame cap, when the class/preset draws a finer canvas at rest than while moving (phone-android: 2). */
  restDprCap?: number
  /** `?dpr=` taken verbatim by the renderer; when set the preset and class caps do not apply. */
  dprOverride?: number
  preset: QualityPreset
}

const FULL = CLASS_TABLE.desktop
const fmt = (n: number): string => String(Math.round(n * 100) / 100)

/** The ratios main.ts draws at (render(): dprFor far end, then the rest cap): moving, and at rest. The close-in ramp comes from dprFor at the current camera distance. */
function dprReason(i: ReducedInput): ReducedReason | undefined {
  const native = i.nativeDpr
  if (i.dprOverride !== undefined) return undefined
  // Same function and arguments as main.ts render(), so the chip cannot state a ratio the renderer does not draw.
  const moving = dprFor({ native, cap: i.dprCap, closeCap: i.closeDprCap, dist: i.dist ?? Number.NaN })
  const rest = i.restDprCap !== undefined ? Math.max(moving, Math.min(native, i.restDprCap)) : moving
  if (rest >= native) return undefined
  const why: ReducedWhy = i.preset === 'battery' ? 'Battery saver is on' : i.preset === 'high' ? 'your Quality setting' : 'device class at start'
  const text = moving < rest
    ? `The picture is drawn at ${fmt(rest)} of the screen's ${fmt(native)} pixels per point at rest, ${fmt(moving)} while moving`
    : `The picture is drawn at ${fmt(rest)} of the screen's ${fmt(native)} pixels per point`
  return { axis: 'dpr', why, text }
}

export function reducedReasons(i: ReducedInput): ReducedReason[] {
  const out: ReducedReason[] = []
  const lost = i.contextLosses > 0 && i.ceilingBytes < i.profile.ceilingBytes
  if (lost) out.push({ axis: 'memory', why: 'memory (the graphics context was lost)', text: 'Graphics memory capped after a lost graphics context' })
  // A warning that lowered the ceiling counts as a memory cut, whatever the class: desktop's infinite ceiling is lowered too.
  const warned = (i.memoryWarnings ?? 0) > 0 && i.ceilingBytes < i.profile.ceilingBytes
  if (warned) out.push({ axis: 'memory', why: 'Memory', text: 'Graphics memory capped after a memory warning' })
  const tilesWant = i.profile.tiles
  const tiles = i.allocatedTiles ?? tilesWant
  if (tiles < tilesWant) out.push({ axis: 'tiles', why: 'memory', text: `Fewer map tiles are kept: ${tiles} of ${tilesWant} (desktop: ${FULL.tiles})` })
  else if (tilesWant < FULL.tiles) out.push({ axis: 'tiles', why: 'device class at start', text: `Fewer map tiles are kept: ${tiles} of ${FULL.tiles}` })
  if (!i.profile.tc) out.push({ axis: 'tc', why: 'device class at start', text: 'The finest surface texture (JAXA TC) is not loaded' })
  const dprLine = dprReason(i)
  if (dprLine) out.push(dprLine)
  if (i.profile.panoMax < FULL.panoMax) out.push({ axis: 'pano', why: 'device class at start', text: `Panoramas load at up to ${i.profile.panoMax} pixels wide, not ${FULL.panoMax}` })
  if (i.profile.lmShadowRes < FULL.lmShadowRes) out.push({ axis: 'shadow', why: 'device class at start', text: `The lander's shadow map is ${i.profile.lmShadowRes} pixels, not ${FULL.lmShadowRes}` })
  if (i.preset === 'battery') out.push({ axis: 'battery', why: 'Battery saver is on', text: 'Battery saver is on (your Quality setting)' })
  return out
}
