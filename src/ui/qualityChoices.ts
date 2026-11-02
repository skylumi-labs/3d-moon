import type { QualityPreset } from '../quality/settings'

/**
 * The one visible Quality choice: three plain presets. Each line says what the preset changes, as src/quality/settings.ts
 * (PRESET_DEFAULTS: Battery is Fast shadows and reduced surface detail; Auto and Best are Full shadows and full detail) and the
 * pixel-ratio caps (Battery capped low, Best up to 2) set it. The order is lowest power first.
 */
export const QUALITY_CHOICES: ReadonlyArray<{ value: QualityPreset; title: string; line: () => string }> = [
  { value: 'battery', title: 'Battery saver', line: () => 'Saves power and heat. Crater shadows are approximate (edges a little harder), the finest surface texture is left out and the picture is a little less sharp.' },
  { value: 'auto', title: 'Balanced', line: () => 'Follows this device. Full crater shadows and surface texture; sharpness and smoothness match what the screen can handle.' },
  { value: 'high', title: 'Best', line: () => 'Full crater shadows and surface texture at the sharpest resolution, whatever the device. Uses the most power.' },
]
