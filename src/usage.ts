/**
 * Usage events: the one-line hook the viewer calls where an action is already handled. It only dispatches a window event (`moon:usage`);
 * src/telemetry/boot.ts listens for it after the first frame and, when telemetry is on, builds the payload with the fixed builders in
 * src/telemetry/events.ts. With telemetry off nobody listens and the call costs one event dispatch. Nothing here imports src/telemetry
 * (scripts/telemetry.test.mts: no static import) and nothing here carries free text: the name and a few short enum values.
 */

export type UsageName =
  | 'viewpoint_open' | 'ground_enter' | 'ground_exit' | 'panorama_open' | 'time_change'
  | 'share' | 'credits_open' | 'quality_change'

export type UsageSource = 'list' | 'pin' | 'hotspot' | 'next' | 'prev' | 'link'

let pendingSource: { s: UsageSource; at: number } | null = null

/** The way the next viewpoint was chosen (a pin tap). Read once by the next viewpoint_open within 3 s; unset or stale means a link. */
export function setUsageSource(s: UsageSource): void { pendingSource = { s, at: Date.now() } }
export function takeUsageSource(): UsageSource | null { const p = pendingSource; pendingSource = null; return p && Date.now() - p.at < 3000 ? p.s : null }

export function trackUsage(name: UsageName, detail: Record<string, string | number | boolean | null> = {}): void {
  try { window.dispatchEvent(new CustomEvent('moon:usage', { detail: { ...detail, name } })) } catch { /* diagnostics only */ }
}
