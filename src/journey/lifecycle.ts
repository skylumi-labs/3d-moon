import { joinLeadDecay } from './join'
export type JourneyStatus = 'loading' | 'travelling' | 'arrived' | 'cancelled' | 'failed'
export interface JourneyState {
  generation: number; id: string; label: string; subject: 'moon' | 'earth' | 'sun' | 'ground'
  status: JourneyStatus; phase: string; progress: number; startedAt: number; arrivalAt: number | null
  orbitAngleDeg: number
}
/** One generation across loading, approach, travel and arrival. New intent invalidates all old continuations. */
export class JourneyLifecycle {
  private generation = 0
  state: JourneyState | null = null
  begin(id: string, label: string, subject: JourneyState['subject'], now: number): number {
    const generation = ++this.generation
    this.state = { generation, id, label, subject, status: 'loading', phase: 'loading', progress: 0, startedAt: now, arrivalAt: null, orbitAngleDeg: 0 }
    return generation
  }
  current(generation: number): boolean { return generation === this.generation && !!this.state && !['cancelled', 'failed'].includes(this.state.status) }
  sample(generation: number, phase: string, progress: number, orbitAngleDeg = 0): void {
    if (!this.current(generation) || this.state!.status === 'arrived') return
    this.state!.phase = phase
    this.state!.status = phase === 'loading' ? 'loading' : 'travelling'
    this.state!.progress = Math.max(0, Math.min(1, progress))
    this.state!.orbitAngleDeg = orbitAngleDeg
  }
  arrive(generation: number, now: number): boolean {
    if (!this.current(generation) || this.state!.status === 'arrived') return false
    this.state!.status = 'arrived'; this.state!.phase = 'arrival'; this.state!.progress = 1; this.state!.arrivalAt = now
    return true
  }
  cancel(): void {
    this.generation++
    if (this.state) this.state.status = 'cancelled'
  }
  fail(generation: number): void { if (this.current(generation)) this.state!.status = 'failed' }
}
/** The longest any flight or orbit may last, s (owner 2026-10-22, final: 25-30 s max, after 20 s cost smoothness on the rig); a test pins every flight and the orbit to it. */
export const MAX_FLIGHT_SECONDS = 30
/** 25 s: with the 4-5 s approach from Home the click-to-end stays under 30 s, and the extra 5 s over 20 go to the slow sunset and sunrise. */
export const ORBIT_SECONDS = 25
/**
 * Where the orbit starts: this many degrees east of the subsolar point, so the first frame is a lit Moon (owner 2026-10-22, fly-around option a: the
 * start is under 90 deg from the Sun, never the old 138 that opened on a thin crescent and a starfield). From there the camera runs on east
 * across the lit side; the Sun goes behind the limb after ORBIT_SUNSET_AFTER_DEG more (it hides from 168.5 deg at 5 radii) and comes out
 * ORBIT_SUNRISE_AFTER_DEG later; the orbit closes where it began, on a lit view.
 */
export const ORBIT_START_ARC_DEG = 50
export const ORBIT_SUNSET_AFTER_DEG = 168.5 - ORBIT_START_ARC_DEG
export const ORBIT_SUNRISE_AFTER_DEG = 191.5 - ORBIT_START_ARC_DEG
/**
 * The orbit's pace, [progress, relative speed] knots joined by smoothstep: a quick run over the lit side, a slow stretch across the sunset and the
 * sunrise behind the limb (owner 2026-10-20: slow down just there so the Sun is seen setting on both sides), then fast again round the far side.
 * Both ends are at rest. In 25 s the Sun sets at ~7.6 s and is out again at ~12.4 s (4.8 s behind the Moon, at most 7.1 deg/s); the slow stretch
 * never drops below 4.8 deg/s (1.7 with the join's lead-in paying back), so the audit's freeze check does not read it as a stall.
 */
const ORBIT_PACE: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.06, 0.9], [0.24, 1], [0.3, 0.24], [0.52, 0.24], [0.6, 1], [0.96, 1], [1, 0],
]
const ORBIT_TABLE_N = 4096
let orbitTable: Float64Array | null = null
/** Cumulative share of the turn by progress: the integral of the pace, built once. */
function orbitCumulative(): Float64Array {
  if (orbitTable) return orbitTable
  const speed = (t: number): number => {
    for (let i = 0; i < ORBIT_PACE.length - 1; i++) {
      const [t0, v0] = ORBIT_PACE[i], [t1, v1] = ORBIT_PACE[i + 1]
      if (t <= t1) { const k = (t - t0) / (t1 - t0); return v0 + (v1 - v0) * k * k * (3 - 2 * k) }
    }
    return 0
  }
  const c = new Float64Array(ORBIT_TABLE_N + 1)
  for (let i = 1; i <= ORBIT_TABLE_N; i++) c[i] = c[i - 1] + (speed((i - 0.5) / ORBIT_TABLE_N))
  const total = c[ORBIT_TABLE_N]
  for (let i = 0; i <= ORBIT_TABLE_N; i++) c[i] /= total
  orbitTable = c
  return c
}
/** Literal one-turn, unwrapped winding with the pace above. */
export function orbitAngleDeg(progress: number, lead = 0): number {
  const t = Math.max(0, Math.min(1, progress))
  if (t === 1) return 360
  return orbitBaseAngleDeg(t) + 360 * joinLeadDecay(t, lead, ORBIT_SECONDS)
}
function orbitBaseAngleDeg(t: number): number {
  const c = orbitCumulative()
  const x = t * ORBIT_TABLE_N, i = Math.min(ORBIT_TABLE_N - 1, Math.floor(x))
  return 360 * (c[i] + (c[i + 1] - c[i]) * (x - i))
}
