import type { SwitchDef } from './switches'

/**
 * Switches that exist in the panel on the dev server only: they can load restricted-licence data. switches.ts spreads this array under
 * `import.meta.env.DEV`, so a production build drops it and its text; the production panel never names these. Tests import it directly.
 */
export const DEV_SWITCHES: readonly SwitchDef[] = [
  { name: 'internal', group: 'Data layers', values: ['1'], def: null, apply: 'reload', restricted: true, effect: 'Keep the restricted-licence coverage regions in the coverage map.' },
]
