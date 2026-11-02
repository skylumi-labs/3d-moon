/**
 * The visitor's viewpoint list and the pure state of the navigator pill above the bar (owner decisions, 2026-10-11).
 *
 * The list is curated: each entry is one place or one subject with a still or a flight that starts on something visible. An entry
 * has one or more steps. Step 0 is the entry itself; further steps are its sub-views (Apollo 17's Eye level
 * and panoramas). "Next" steps through the current entry's steps and then flies on to the next entry; "Back" does the reverse and
 * lands on the first step of the entry before. Everything here is data and pure functions; main.ts supplies what an action does.
 */

export type NavActionKind = 'pin' | 'moment' | 'ridge' | 'panorama' | 'ground' | 'orbit'
/**
 * What a step does: play a hotspot (`pin-*`), a moment (`moments.ts`), the Alps ridge opening, an Apollo 17 panorama, or a ground viewpoint. `orbit` is no
 * step of the list: it is what ‹ runs from the ground at an entry's first step (prevMoveFrom), the climb to the overview over the site, and its id is the entry's.
 */
export interface NavAction { kind: NavActionKind; id: string }
export interface NavStep {
  /** The sub-view's name, or null for the entry's own first view. */
  label: string | null
  action: NavAction
}
export interface NavEntry {
  /** Also the `data-row` of its line in the list. */
  id: string
  name: string
  /** One line under the name in the list. */
  caption: string
  steps: NavStep[]
}

const pin = (id: string, label: string | null = null): NavStep => ({ label, action: { kind: 'pin', id } })
const moment = (id: string, label: string | null = null): NavStep => ({ label, action: { kind: 'moment', id } })

/** The visitor's list, in prev/next order: far to near, then the two landing sites, then the Earth as we see it (the evening behind an Alpine ridge is hidden, see HIDDEN_ENTRIES). */
export const VIEWPOINT_ENTRIES: readonly NavEntry[] = [
  { id: 'fly-around', name: 'Fly around the Moon', caption: 'One turn round the Moon in 25 seconds, slowing as the Sun sets behind the limb.', steps: [moment('fly-around')] },
  { id: 'pin-earthrise', name: 'Earthrise', caption: 'The Earth over the far-side limb, computed for this moment.', steps: [moment('earthrise')] },
  { id: 'solar-eclipse', name: 'Solar eclipse', caption: 'The total eclipse of 2 August 2027 from the Moon: the Sun, the Moon, then its shadow on the Earth.', steps: [moment('solar-eclipse')] },
  { id: 'pin-tycho', name: 'Tycho Crater', caption: '85 km across, with rays that reach across much of the near side. A 30-second flight round it.', steps: [moment('tycho-rim')] },
  { id: 'pin-copernicus', name: 'Copernicus Crater', caption: 'A flight over the crater and its terraced wall.', steps: [moment('surface')] },
  {
    id: 'sunrise-terminator', name: 'Long shadows at the terminator', caption: 'A low flight in the first light after lunar dawn.',
    steps: [moment('terminator-run')],
  },
  { id: 'pin-apollo11', name: 'Apollo 11 landing zone', caption: 'Tranquility Base on the 2011 orbiter photograph.', steps: [pin('pin-apollo11')] },
  {
    id: 'pin-apollo17', name: 'Apollo 17', caption: 'Challenger in the Taurus-Littrow valley, with three panoramas.',
    steps: [
      // Owner 2026-10-14 (R2 3:37): only the module's eye level and the panoramas; the 'Beside the module' view left the list.
      { label: 'Eye level', action: { kind: 'ground', id: 'eye' } },
      { label: 'ALSEP panorama', action: { kind: 'panorama', id: 'alsep' } },
      { label: 'Station 4 panorama', action: { kind: 'panorama', id: 'station4' } },
      { label: 'Station 6 panorama', action: { kind: 'panorama', id: 'station6' } },
    ],
  },
  { id: 'pin-earth', name: 'View from Earth', caption: 'The Moon as it looks from the Earth right now.', steps: [pin('pin-earth')] },
]

/** Entries kept out of the visitor's list so they can return; their actions still run (`?start=ridge`, `?moment=`). They are not in the ring, so `locate` misses them and the navigator names nothing while one plays (the pill and caption stay blank). */
export const HIDDEN_ENTRIES: readonly NavEntry[] = [
  { id: 'alps-ridge', name: 'The Moon behind a ridge', caption: 'An evening behind a ridge in the Alps, then lift-off to the Moon.', steps: [{ label: null, action: { kind: 'ridge', id: 'alps-ridge' } }] },
]

/** The pins whose list entry is a flight: a tap on the pin on the Moon plays that moment, so the pill names the flight and the still is not shown first. */
export const PIN_MOMENT: Readonly<Record<string, string>> = {
  'pin-tycho': 'tycho-rim', 'pin-copernicus': 'surface', 'pin-earthrise': 'earthrise',
}

export const actionKey = (a: NavAction): string => `${a.kind}:${a.id}`

/**
 * The list with only what this build can show: a step whose data is not there (no tiles, no Apollo patch) is dropped, and an entry with
 * no step left goes with it. The first step that remains stands in as the entry's own view.
 */
export function availableEntries(all: readonly NavEntry[], has: (a: NavAction) => boolean): NavEntry[] {
  const out: NavEntry[] = []
  for (const e of all) {
    const steps = e.steps.filter((s) => has(s.action))
    if (steps.length) out.push({ ...e, steps })
  }
  return out
}

export interface NavPos { entry: number; step: number }

/** Where an action sits in the list, or null when it is not a viewpoint (a pin that only lives on the Moon, a moment of the archive). */
export function locate(entries: readonly NavEntry[], action: NavAction): NavPos | null {
  const key = actionKey(action)
  for (let entry = 0; entry < entries.length; entry++) {
    const step = entries[entry].steps.findIndex((s) => actionKey(s.action) === key)
    if (step >= 0) return { entry, step }
  }
  // The Apollo 17 pin on the Moon (and the 'beside the module' ground view) is no step of the list: the pill names the entry with no sub-view (step -1;
  // Next goes to Eye level, the first step).
  if (action.kind === 'pin' && action.id === 'pin-apollo17') {
    const entry = entries.findIndex((e) => e.id === 'pin-apollo17')
    if (entry >= 0) return { entry, step: -1 }
  }
  return null
}

export function stepAt(entries: readonly NavEntry[], pos: NavPos | null): NavStep | null {
  return pos ? entries[pos.entry]?.steps[pos.step] ?? null : null
}

/**
 * The position "Next" goes to: the next sub-view of this entry, else the first step of the next entry; after the last entry it wraps to the
 * first (the list is a ring). From nothing it is the first entry. Null only when there is nowhere else to go.
 */
export function nextPos(entries: readonly NavEntry[], pos: NavPos | null): NavPos | null {
  if (!entries.length) return null
  if (!pos) return { entry: 0, step: 0 }
  const e = entries[pos.entry]
  if (!e) return null
  if (pos.step + 1 < e.steps.length) return { entry: pos.entry, step: pos.step + 1 }
  const entry = (pos.entry + 1) % entries.length
  return entry === pos.entry ? null : { entry, step: 0 }
}

/**
 * The position "Back" goes to: the previous sub-view of this entry, else the first step of the entry before; from the first entry it wraps to
 * the first step of the last. Null from nothing (there is no viewpoint to go back from) or when there is nowhere else to go.
 */
export function prevPos(entries: readonly NavEntry[], pos: NavPos | null): NavPos | null {
  if (!pos || !entries[pos.entry]) return null
  if (pos.step > 0) return { entry: pos.entry, step: pos.step - 1 }
  const entry = (pos.entry - 1 + entries.length) % entries.length
  return entry === pos.entry ? null : { entry, step: 0 }
}

/**
 * What ‹ does from `pos` (owner complaint 10, 2026-10-23: "it's strange that we fly again after clicking back; stay on the moon"). On the ground (`onGround`:
 * the Apollo 17 ground view or one of its panoramas is open) at an entry's first step it does NOT fly to the entry before: it runs `{ kind: 'orbit' }` for that
 * entry (main.ts: up to the overview over the site, and stop there), and the pill keeps naming the entry's first step. From a later step it is the step before,
 * ground-local in main.ts. From orbit it is prevPos, and only there does the ring wrap. Null where prevPos is null.
 */
export type NavMove = { kind: 'step'; pos: NavPos } | { kind: 'orbit'; pos: NavPos; action: NavAction }
export function prevMoveFrom(entries: readonly NavEntry[], pos: NavPos | null, onGround: boolean): NavMove | null {
  if (!pos || !entries[pos.entry]) return null
  if (onGround && pos.step <= 0) return { kind: 'orbit', pos: { entry: pos.entry, step: 0 }, action: { kind: 'orbit', id: entries[pos.entry].id } }
  const p = prevPos(entries, pos)
  return p ? { kind: 'step', pos: p } : null
}
/** The position ‹ lands on: prevPos, except on the ground at an entry's first step, where it stays on that step (prevMoveFrom says what runs). The default keeps the old rule for a navigator that does not pass `onGround`. */
export function prevPosFrom(entries: readonly NavEntry[], pos: NavPos | null, onGround = false): NavPos | null {
  return prevMoveFrom(entries, pos, onGround)?.pos ?? null
}

/** What the navigator is at: nothing yet, or a viewpoint step, and whether the visitor has since moved away from it. */
export interface NavState { pos: NavPos | null; away: boolean }
export const NAV_IDLE: NavState = { pos: null, away: false }

/** A viewpoint was reached (or asked for): the pill names it and is live again. */
export const navArrive = (_s: NavState, pos: NavPos): NavState => ({ pos, away: false })
/** The visitor dragged, zoomed or turned away: the name stays, dimmed, with the way back. Nothing to dim before a viewpoint. */
export const navAway = (s: NavState): NavState => (s.pos && !s.away ? { pos: s.pos, away: true } : s)
/** Something else took the camera (Home, a place that is not a viewpoint): the pill has no current viewpoint. */
export const navClear = (): NavState => NAV_IDLE
/** The step "Return" flies back to: the viewpoint the pill still names, only while the visitor is away from it. */
export function navReturnStep(entries: readonly NavEntry[], s: NavState): NavStep | null {
  return s.away ? stepAt(entries, s.pos) : null
}

export interface NavView {
  /** The pill's name line: `Apollo 17 · Eye level`, `Copernicus Crater`; empty before any viewpoint (the caption is then not shown at all: a "Viewpoints · 9 places" line said nothing, owner review 2026-10-23). The sub-view is told by the dots, never by a second counter. */
  title: string
  /** The small line under it: `11 of 11`; empty before any viewpoint. */
  count: string
  /** Steps of the current entry (dots), 0 when it has only one view. */
  dots: number
  dotIndex: number
  dimmed: boolean
  canReturn: boolean
  canPrev: boolean
  canNext: boolean
}

export function describeNav(entries: readonly NavEntry[], s: NavState): NavView {
  const e = s.pos ? entries[s.pos.entry] : undefined
  const canNext = nextPos(entries, s.pos) !== null
  const canPrev = prevPos(entries, s.pos) !== null
  if (!s.pos || !e) {
    return { title: '', count: '', dots: 0, dotIndex: 0, dimmed: false, canReturn: false, canPrev, canNext }
  }
  const step = e.steps[s.pos.step]
  const many = e.steps.length > 1
  const sub = step?.label ? ` · ${step.label}` : ''
  return {
    title: `${e.name}${sub}`,
    count: `${s.pos.entry + 1} of ${entries.length}`,
    dots: many ? e.steps.length : 0,
    dotIndex: s.pos.step,
    dimmed: s.away,
    canReturn: s.away && !!step,
    canPrev,
    canNext,
  }
}

/**
 * Which tapped step to run once the data is ready: a tap in the first second or two (the Apollo patch sites are still being probed)
 * is kept, the last one wins, and it is dropped if its step is not in the available list.
 */
export function resolveQueued(queued: NavAction | null, entries: readonly NavEntry[]): NavPos | null {
  return queued ? locate(entries, queued) : null
}

/** m:ss for a progress readout. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The first sentence of a description: the short line the caption keeps under the pill's place name. */
export function firstSentence(text: string): string {
  const m = /^.*?[.!?](?=\s|$)/.exec(text.trim())
  return (m ? m[0] : text.trim()).trim()
}

/** Where a flight the visitor left was (by journey id and progress 0..1). */
export interface FlightLeft { id: string; u: number }
/** The progress "Return" restarts a flight at: where the visitor left that flight, but a flight left in its first moments or its last stretch starts afresh. */
export function resumeProgress(left: FlightLeft | null, id: string): number {
  if (!left || left.id !== id || !Number.isFinite(left.u)) return 0
  return left.u > 0.02 && left.u < 0.97 ? left.u : 0
}
