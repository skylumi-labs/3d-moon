/**
 * Screen-reader announcements for flights: one visually hidden polite live region, written at three moments
 * (a flight starts, arrives, is stopped), once when the visitor moves off a viewpoint, and a one-time hint (lowEndHint.ts).
 * `announcementFor` and `Debouncer` are pure (tested in scripts/announce.test.mts); `announce` is the DOM part.
 */

export type AnnounceEvent =
  | { kind: 'start'; title: string; count?: string }
  | { kind: 'arrive'; title: string }
  | { kind: 'stop' }
  | { kind: 'moved'; title: string }
  | { kind: 'hint'; text: string }

/** The sentence a screen reader hears for an event. */
export function announcementFor(ev: AnnounceEvent): string {
  switch (ev.kind) {
    case 'start': return ev.count ? `Flying to ${ev.title}, ${ev.count}` : `Flying to ${ev.title}`
    case 'arrive': return ev.title
    case 'stop': return 'Stopped; you can fly back'
    case 'moved': return `You moved off ${ev.title}; the return button flies back`
    case 'hint': return ev.text
  }
}

export interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

/** Keeps only the last text said within `ms`, so spamming Next speaks once. */
export class Debouncer {
  private handle: unknown = null
  constructor(private readonly write: (text: string) => void, private readonly timers: Timers, private readonly ms = 300) {}
  say(text: string): void {
    if (this.handle !== null) this.timers.clear(this.handle)
    this.handle = this.timers.set(() => { this.handle = null; this.write(text) }, this.ms)
  }
}

let region: HTMLElement | null = null
let debouncer: Debouncer | null = null
let flip = false

function write(text: string): void {
  if (typeof document === 'undefined') return
  if (!region || !region.isConnected) {
    region = document.createElement('div')
    region.className = 'sr-announce'
    region.setAttribute('role', 'status')
    region.setAttribute('aria-live', 'polite')
    region.setAttribute('aria-atomic', 'true')
    region.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0'
    document.body.append(region)
  }
  // An identical sentence twice in a row is not re-read by most readers; a trailing non-breaking space makes it a change.
  flip = !flip
  region.textContent = flip ? text : `${text} `
}

/** Says an event politely, after a short debounce. */
export function announce(ev: AnnounceEvent): void {
  debouncer ??= new Debouncer(write, { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) })
  debouncer.say(announcementFor(ev))
}
