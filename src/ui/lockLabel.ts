import './lockLabel.css'
import { getDock } from './dock'
import { ROW_SELECTORS, observeRowControls, visibleRect, type CentreCaptionUi } from './centreCaption'
import { TRANSITION_SETTLE_MS, type Rect } from './centreCaptionLayout'
import { lockRect, placeLock, type LockPlacement } from './lockLabelLayout'
import type { CamSample, CaptionView } from '../labels/centreCaptionCore'
import { labelById } from '../labels/centrePick'
import {
  BRACKET_MS, LockHold, RETICLE_PX, bracketBox, lockFields, lockLines, typedAt, type Brackets, type HoldView, type LockFields,
} from '../labels/lockLabelCore'

/** What the frame loop hands the lock label each frame (the plain caption needs only the view). */
export interface LockFrame {
  /** The presented camera is moving: the caption follows its throttled centre pick and shows each new lock complete. */
  moving: boolean
  /** The caption is off for a reason other than motion: nothing is kept. */
  suppressed: boolean
  /** The camera of the scene the name was picked on (Moon coordinates), for the brackets' extent. */
  cam: CamSample | null
}
export interface LockLabelUi extends CentreCaptionUi {
  frame(view: CaptionView, f: LockFrame): boolean
  /** True while a rest hold or typing still needs frames (the loop must not sleep). */
  busy(): boolean
}

/** What stands in the label's way: the dock (the whole bottom bar, sheets included) and the row's controls, plus the HUD's info button. */
const AVOID = ['.dock', ...ROW_SELECTORS, '.hud-i']
const reducedMotion = (): boolean => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }

/** Mounts the lock-style centre caption over the canvas `view` (the brackets are placed in its coordinates). */
export function mountLockLabel(root: HTMLElement, viewEl: HTMLElement): LockLabelUi {
  const dock = getDock(root)
  const el = document.createElement('div')
  el.className = 'lock-label'
  el.id = 'centre-caption'
  const vis = document.createElement('div')
  vis.setAttribute('aria-hidden', 'true')
  const box = document.createElement('div')
  box.className = 'lk-box'
  const corners = (['tl', 'tr', 'bl', 'br'] as const).map((c) => { const s = document.createElement('span'); s.className = `lk-br ${c}`; box.append(s); return s })
  const text = document.createElement('div')
  text.className = 'lk-text'
  const cur = document.createElement('span')
  cur.className = 'lk-cur'
  vis.append(box, text)
  // Screen readers get the name and its data once per settled feature, never the typed characters.
  const sr = document.createElement('div')
  sr.className = 'lk-sr'
  sr.setAttribute('role', 'status')
  sr.setAttribute('aria-live', 'polite')
  el.append(vis, sr)
  root.append(el)
  const probe = document.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)'
  document.body.append(probe)

  const hold = new LockHold()
  /** A control changed (or is moving): re-read the control rects and place again. Cheap: no text is rebuilt or measured. */
  let placeDirty = true
  /** The block's size may have changed (a new name, a resize, the font arriving, a text-size change): rebuild and measure. */
  let measureDirty = true
  let motionUntil = 0
  let fields: LockFields | null = null
  let lines: string[] = []
  let lineEls: HTMLElement[] = []
  let built: boolean | null = null
  /** The full block's size per arrangement (artboard lines, or stacked), measured once per name, text size and font state. */
  let sizes: { flat?: { w: number; h: number }; stack?: { w: number; h: number }; rem: number } = { rem: 0 }
  let shown: HoldView = { id: null, since: 0 }
  let brackets: Brackets | null = null
  let place: LockPlacement | null = null
  let textW = 0, textH = 0
  let counts: number[] = []
  let cursorAt = -1
  let typedDone = false
  let on = false
  let announced = -1
  /** When the shown name's brackets started closing in (its typing starts BRACKET_MS later). */
  let typeFrom = 0
  let lastRect: Rect | null = null
  let rectKey = ''
  let usableNow = true
  let reduced = reducedMotion()
  /** The newest camera (a relayout after a resize places the brackets for the camera now on screen). */
  let cam: CamSample | null = null
  const invalidate = (): void => { placeDirty = true }
  const remeasure = (): void => { measureDirty = true; placeDirty = true }
  observeRowControls(root, dock, el, invalidate, (now) => { motionUntil = now + TRANSITION_SETTLE_MS; placeDirty = true })
  window.addEventListener('resize', remeasure)
  window.visualViewport?.addEventListener('resize', remeasure)
  // The font (43 kB, self-hosted) is fetched at mount, well before a first name can be due (the controller waits 2 s of stillness), so a first name is
  // not typed in the fallback face; if it still arrives late, the block is measured again.
  document.fonts?.addEventListener?.('loadingdone', remeasure)
  void document.fonts?.load?.('1rem "Share Tech Mono"').catch(() => {})

  const rectsNow = (): Rect[] => {
    const out: Rect[] = []
    for (const s of AVOID) for (const n of document.querySelectorAll(s)) { const r = visibleRect(n); if (r) out.push(r) }
    return out
  }
  const insets = (): { insetL: number; insetR: number; insetT: number; insetB: number } => {
    const cs = getComputedStyle(probe)
    return { insetL: parseFloat(cs.paddingLeft) || 0, insetR: parseFloat(cs.paddingRight) || 0, insetT: parseFloat(cs.paddingTop) || 0, insetB: parseFloat(cs.paddingBottom) || 0 }
  }
  /** Writes the block for the name, fully typed, in one arrangement (typing only shortens the lines later, so the placed block never moves while it types). */
  const build = (f: LockFields, stacked: boolean): void => {
    lines = lockLines(f, stacked)
    text.classList.toggle('stack', stacked)
    text.replaceChildren()
    lineEls = lines.map((l, i) => { const d = document.createElement('div'); d.className = i === 0 ? 'lk-name' : 'lk-line'; d.append(document.createTextNode(l)); text.append(d); return d })
    lineEls[lineEls.length - 1]?.append(cur)
    counts = lines.map((l) => l.length)
    cursorAt = lines.length - 1
    built = stacked
  }
  const sizeOf = (f: LockFields, stacked: boolean, vw: number, ins: { insetL: number; insetR: number }): { w: number; h: number } => {
    const k = stacked ? 'stack' : 'flat'
    const have = sizes[k]
    if (have) return have
    build(f, stacked)
    // A stacked name wraps at its spaces within the screen.
    text.style.maxWidth = stacked ? `${Math.max(0, vw - Math.max(8, ins.insetL) - Math.max(8, ins.insetR) - 2)}px` : ''
    const m = { w: Math.ceil(text.offsetWidth) + 2, h: Math.ceil(text.offsetHeight) }
    sizes[k] = m
    return m
  }
  /**
   * Places the brackets and the block. Reads layout only when told (a new name, a control change or transition, a resize, the font): never per frame
   * at rest or in motion. The artboard's lines are tried first, then one field per line (a narrow screen, a large text size).
   */
  const layout = (): void => {
    reduced = reducedMotion()
    const vr = viewEl.getBoundingClientRect()
    const w = vr.width || window.innerWidth, h = vr.height || window.innerHeight
    const vw = window.innerWidth, vh = window.innerHeight
    const ins = insets()
    const rects = rectsNow()
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    if (measureDirty || rem !== sizes.rem) { sizes = { rem }; measureDirty = false }
    // Whether a name could stand here at all (the controller asks before naming): the reticle with a short block (est 8 x 4 rem).
    const ret = { left: w / 2 - RETICLE_PX / 2 + vr.left, top: h / 2 - RETICLE_PX / 2 + vr.top, width: RETICLE_PX, height: RETICLE_PX }
    usableNow = placeLock({ viewportW: vw, viewportH: vh, ...ins, box: ret, textW: 8 * rem, textH: 4 * rem, rects }) !== null
    const label = shown.id ? labelById(shown.id) : undefined
    if (!label || !fields) { brackets = null; place = null; return }
    const b = bracketBox(label, cam, w, h)
    brackets = { ...b, left: b.left + vr.left, top: b.top + vr.top }
    place = null
    let use = false
    for (const stacked of [false, true]) {
      const m = sizeOf(fields, stacked, vw, ins)
      place = placeLock({ viewportW: vw, viewportH: vh, ...ins, box: brackets, textW: m.w, textH: m.h, rects })
      if (place) { use = stacked; textW = m.w; textH = m.h; break }
    }
    if (place && built !== use) {
      build(fields, use)
      text.style.maxWidth = use ? `${Math.max(0, vw - Math.max(8, ins.insetL) - Math.max(8, ins.insetR) - 2)}px` : ''
    }
    box.style.transform = `translate(${brackets.left.toFixed(1)}px, ${brackets.top.toFixed(1)}px)`
    box.style.width = `${brackets.width.toFixed(1)}px`; box.style.height = `${brackets.height.toFixed(1)}px`
    if (place) text.style.transform = `translate(${place.left.toFixed(1)}px, ${place.top.toFixed(1)}px)`
    box.dataset.rule = brackets.rule
  }
  /** Writes the typed counts; only lines whose count changed are touched. */
  const write = (next: number[], nextCursor = cursorAt): void => {
    lineEls.forEach((d, i) => { if (next[i] !== counts[i]) d.firstChild!.textContent = lines[i].slice(0, next[i]) })
    if (nextCursor !== cursorAt || cur.parentElement !== lineEls[nextCursor]) lineEls[nextCursor]?.append(cur)
    counts = next; cursorAt = nextCursor
  }
  const closeIn = (): void => {
    if (reduced || !brackets || typeof corners[0].animate !== 'function') return
    const o = Math.max(28, 0.35 * Math.max(brackets.width, brackets.height))
    const d: Array<[number, number]> = [[-o, -o], [o, -o], [-o, o], [o, o]]
    corners.forEach((c, i) => c.animate([{ transform: `translate(${d[i][0]}px, ${d[i][1]}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: BRACKET_MS, easing: 'cubic-bezier(.2,.8,.2,1)' }))
  }

  return {
    element: el,
    invalidate,
    usable: () => usableNow,
    rect: () => lastRect,
    // Only a name that is on screen and still typing needs frames; one that found no room (or no row) does not hold the loop awake.
    busy: () => hold.busy() || (on && !typedDone),
    apply(view: CaptionView): boolean { return this.frame(view, { moving: false, suppressed: false, cam: null }) },
    frame(view: CaptionView, f: LockFrame): boolean {
      const now = performance.now()
      const prevId = shown.id, prevSince = shown.since
      shown = hold.step({ id: view.visible ? view.id : null, moving: f.moving, suppressed: f.suppressed, now })
      cam = f.cam
      const committed = !!shown.id && (shown.id !== prevId || shown.since !== prevSince)
      if (committed) {
        const label = labelById(shown.id!)
        fields = label ? lockFields(label) : null
        built = null
        remeasure()
        typedDone = false
      }
      if (!shown.id) fields = null
      // Brackets are tied to the feature's projected extent, so keep their cheap placement current on every moving frame.
      if (f.moving) placeDirty = true
      if (placeDirty || now < motionUntil) { placeDirty = false; layout() }
      on = !!shown.id && !!fields && !!place
      el.classList.toggle('on', on)
      // The first frame a committed name is actually shown (at its commit, or later when room appears): it is announced once, the brackets close in and
      // typing starts from here (a name that waited for room does not jump in partway).
      if (on && fields && announced !== shown.since) {
        announced = shown.since; sr.textContent = fields.spoken; typeFrom = now
        if (!reduced && !f.moving) { write(lines.map(() => 0), 0); closeIn() }
      }
      // A dropped name leaves the live region empty, so a later lock (even of the same name) is announced again.
      if (!shown.id && sr.textContent) sr.textContent = ''
      if (on && !typedDone) {
        const t = typedAt(lines, typeFrom + (reduced || f.moving ? 0 : BRACKET_MS), now, reduced || f.moving)
        if (t.counts.some((c, i) => c !== counts[i]) || t.cursorLine !== cursorAt) write(t.counts, t.cursorLine)
        typedDone = t.done
      }
      el.classList.toggle('typed', on && typedDone)
      const r = on && brackets && place ? lockRect(brackets, place, textW, textH) : null
      const key = r ? `${r.left.toFixed(1)}:${r.top.toFixed(1)}:${r.right.toFixed(1)}:${r.bottom.toFixed(1)}` : 'none'
      lastRect = r
      const changed = key !== rectKey
      rectKey = key
      return changed
    },
  }
}
