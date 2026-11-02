import { VIEW_KEYS } from '../intro/parse'

/**
 * First-visit hotspots (MOON-UX-REDESIGN.md 3.2, owner 2026-10-24): animated rings on the Moon's places for a visitor's first load only.
 * This file is the pure part: when they show, what is remembered, and where they and their labels go. No DOM, no clock.
 */

export const SEEN_KEY = 'moon.hotspots.seen.v1'
export const VISITED_KEY = 'moon.hotspots.visited.v1'

export interface StoreLike { getItem(k: string): string | null; setItem(k: string, v: string): void }
/** Returns the storage or null; may throw (blocked storage): callers pass `() => localStorage`. */
export type StoreGetter = () => StoreLike | null

export interface Remembered { seen: boolean; visited: string[] }

/** What the browser remembers. Any failure (blocked storage, bad JSON) reads as a first load with nothing visited. */
export function readRemembered(getStore: StoreGetter): Remembered {
  let seen = false
  let visited: string[] = []
  try {
    const s = getStore()
    if (s) {
      seen = s.getItem(SEEN_KEY) === '1'
      const raw = s.getItem(VISITED_KEY)
      if (raw) {
        const v: unknown = JSON.parse(raw)
        if (Array.isArray(v)) visited = v.filter((x): x is string => typeof x === 'string')
      }
    }
  } catch { seen = false; visited = [] }
  return { seen, visited }
}

export function writeSeen(getStore: StoreGetter): boolean {
  try { const s = getStore(); if (!s) return false; s.setItem(SEEN_KEY, '1'); return true } catch { return false }
}

export function writeVisited(getStore: StoreGetter, ids: Iterable<string>): boolean {
  try { const s = getStore(); if (!s) return false; s.setItem(VISITED_KEY, JSON.stringify([...ids])); return true } catch { return false }
}

export interface GateInput {
  params: URLSearchParams
  still: boolean
  archive: boolean
  /** ?debug=1 (the debug sheet and panel). */
  debug: boolean
  /** navigator.webdriver: the rig and the audits get the bare page as before unless ?hotspots=1. */
  automated: boolean
  seen: boolean
}

/** Other query keys that open a specific view or moment: a shared link is not a first look at the Moon. */
export const SHARED_EXTRA = ['vp', 'fov', 'pitch', 'aim', 'panorama', 'journey', 't', 'moment']

export function isSharedLink(params: URLSearchParams): boolean {
  return VIEW_KEYS.some((k) => params.has(k)) || SHARED_EXTRA.some((k) => params.has(k))
}

export type HotspotsMode = 'off' | 'first' | 'forced'

/** `forced` (?hotspots=1) ignores what is remembered and writes nothing. */
export function hotspotsMode(g: GateInput): HotspotsMode {
  const flag = g.params.get('hotspots')
  if (flag === '0') return 'off'
  if (g.still) return 'off'
  if (flag === '1') return g.archive || g.debug ? 'off' : 'forced'
  if (g.archive || g.debug || g.automated || g.seen) return 'off'
  if (isSharedLink(g.params)) return 'off'
  return 'first'
}

export interface Pt { id: string; x: number; y: number; labelW: number }
export type Rect = readonly [number, number, number, number]
export interface Placed { id: string; x: number; y: number; left: boolean; label: boolean }

const hit = (a: Rect, b: Rect): boolean => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]

/**
 * Which hotspots stay and where their labels go. `pts` is in priority order. A ring whose 44 px target meets a blocked rectangle (caption, bar, offline
 * note) or lies under 56 px from an earlier ring is dropped, never moved. A label goes right of the ring, left when the right edge has no room, and
 * is left off (the ring stays) when it would meet a blocked rectangle, an earlier ring or an earlier label.
 */
export function layoutHotspots(pts: readonly Pt[], w: number, blocked: readonly Rect[], minSpacing = 56, target = 44): Placed[] {
  const out: Placed[] = []
  const rings: Rect[] = []
  const labels: Rect[] = []
  const half = target / 2
  for (const p of pts) {
    const ring: Rect = [p.x - half, p.y - half, p.x + half, p.y + half]
    if (blocked.some((b) => hit(ring, b))) continue
    if (rings.some((r) => Math.hypot((r[0] + r[2]) / 2 - p.x, (r[1] + r[3]) / 2 - p.y) < minSpacing)) continue
    const lw = p.labelW + 8
    const right: Rect = [p.x + 20, p.y - 10, p.x + 20 + lw, p.y + 10]
    const left: Rect = [p.x - 20 - lw, p.y - 10, p.x - 20, p.y + 10]
    const fits = (b: Rect): boolean => b[0] >= 6 && b[2] <= w - 6 && !blocked.some((x) => hit(b, x)) && !rings.some((x) => hit(b, x)) && !labels.some((x) => hit(b, x))
    const useLeft = !fits(right) && fits(left)
    const box = useLeft ? left : right
    const label = fits(box)
    rings.push(ring)
    if (label) labels.push(box)
    out.push({ id: p.id, x: p.x, y: p.y, left: useLeft, label })
  }
  return out
}

/** True when a ring must be (re)positioned: never placed yet (NaN), or moved by more than 0.05 px. A NaN comparison is false, so it is tested the other way round. */
export function needsMove(prevX: number, prevY: number, x: number, y: number): boolean {
  return !(Math.abs(prevX - x) <= 0.05 && Math.abs(prevY - y) <= 0.05)
}
