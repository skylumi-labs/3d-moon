/**
 * Turns the settings (settings.ts) into the knobs the renderer reads. main.ts calls these adapters and owns the redraw.
 */
import { CLASS_TABLE, type ClassProfile } from './startupClass'
import type { QualityPreset, QualitySettings, ShadowMode } from './settings'
import { setShadowMode } from '../moon/shadowMode'
import { currentSharp, sharpGestureStart, type SharpConfig } from './sharp'

/** The motion and pixel-ratio rows of the class profile after the preset. Memory rows (tiles, ceiling, TC, targets) are never touched: they are fixed at start. */
export type MotionKnobs = Pick<ClassProfile, 'dprCap' | 'closeDprCap' | 'restDprCap' | 'motionDprCap' | 'motionDprFromPx' | 'motionStart' | 'motionCaps' | 'motionFixedShare'>

/** Battery: pixel ratio 1.25 and the phone motion caps (the march caps and the 4-level glare chain on moving frames), at the phone grid start. */
export const BATTERY_KNOBS: MotionKnobs = { dprCap: 1.25, closeDprCap: 1.25, restDprCap: undefined, motionStart: 0.35, motionCaps: true }

/**
 * Auto: the device class as detected. High: the desktop class's motion and pixel-ratio constants whatever the device
 * (a phone asked for High draws what a desktop draws, and pays for it in heat). Battery: BATTERY_KNOBS.
 */
export function motionKnobs(profile: ClassProfile, preset: QualityPreset, sharp: SharpConfig = currentSharp()): MotionKnobs {
  const pick = (p: ClassProfile): MotionKnobs => ({ dprCap: p.dprCap, closeDprCap: p.closeDprCap, restDprCap: p.restDprCap, motionDprCap: p.motionDprCap, motionDprFromPx: p.motionDprFromPx, motionStart: p.motionStart, motionCaps: p.motionCaps, motionFixedShare: p.motionFixedShare })
  if (preset === 'high') return sharpKnobs(pick(CLASS_TABLE.desktop), sharp)
  if (preset === 'battery') {
    // Never raise a class that is already lower than Battery.
    return { ...BATTERY_KNOBS, dprCap: Math.min(BATTERY_KNOBS.dprCap, profile.dprCap), closeDprCap: Math.min(BATTERY_KNOBS.closeDprCap ?? Infinity, profile.closeDprCap ?? Infinity), motionFixedShare: profile.motionFixedShare }
  }
  return sharpKnobs(pick(profile), sharp)
}

/**
 * ?sharp=1 on a touch class (quality/sharp.ts): a gesture's first grid is 0.5 or more. The pixel-ratio rows are NOT touched: gestures keep their caps
 * (the flight grid is handled in main.ts render), and the Best preset is never applied to a phone (it recreates the V1 close-up collapse in drags).
 */
export function sharpKnobs(k: MotionKnobs, sharp: SharpConfig): MotionKnobs {
  if (!sharp.on) return k
  return { ...k, motionStart: sharpGestureStart(sharp, k.motionStart ?? 0) }
}

/** Runtime adapter shared by the sheet, startup, and availability changes. */
export function applyShadowMode(mode: ShadowMode): boolean { setShadowMode(mode); return true }
export function shadowNeedsReload(): boolean { return false }

/**
 * The existing compile-time ablations (moonShader.ts ABL_SHADOW): 0 full, 1 no horizon-shadow march (slopes still lit by the Sun's angle),
 * 2 one shadow sample at rest quality. Fast maps to 2, Off to 1.
 */
export function shadowAblation(mode: ShadowMode): 0 | 1 | 2 { return mode === 'off' ? 1 : (mode === 'fast' || mode === 'baked') ? 2 : 0 }

/** Whether gesture frames run the cheap motion shader: the Motion detail row (Smooth), on every device class. ?motionshader=0|1 seeds the row in settings.ts. */
export function motionShaderFor(q: Pick<QualitySettings, 'motion'>): boolean { return q.motion === 'smooth' }

/** The words for the HUD and perf readout. */
export function describeQuality(q: QualitySettings, cls: string): string {
  return `quality ${q.preset} (${cls}) | shadows ${q.shadows} | detail ${q.detail} | glow ${q.glow ? 'on' : 'off'} | motion ${q.motion}`
}
