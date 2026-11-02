import { allDefaults, isDevBuild, nonDefault, panelRows, withSwitch, SWITCHES, type PanelRow, type SwitchDef } from './switches'

/**
 * The debug "Switches" panel: every registered URL switch, grouped by area, with the value in force and the default. A button sets the URL parameter
 * and reloads the page; a small input does the same for a value with no button; "Reset all" returns every setting to its default and keeps the debug
 * gate and the view; "Copy A/B links" copies the current link and the all-defaults link. It is a lazy chunk: nothing here is fetched without `?debug=1`.
 */
export interface SwitchesOptions {
  /** Test seams: the document, the page URL, dev-build flag, the switch list, navigation and clipboard. */
  doc?: Document
  href?: string
  dev?: boolean
  switches?: readonly SwitchDef[]
  navigate?: (url: string) => void
  copy?: (text: string) => Promise<void>
}
export interface SwitchesApi { readonly element: HTMLElement; setHidden(hidden: boolean): void; destroy(): void }

export const STYLE = `
#moon-switches{position:fixed;left:8px;top:8px;z-index:40;font:12px/1.35 system-ui,sans-serif;color:#e8ecf5;max-width:min(360px,calc(100vw - 16px));pointer-events:auto;text-shadow:none}
#moon-switches[hidden]{display:none}
#moon-switches button{font:inherit;color:inherit;cursor:pointer;min-height:28px;padding:2px 9px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.22)}
#moon-switches button[aria-pressed=true]{background:rgba(169,200,245,.28);border-color:rgba(169,200,245,.7);color:#fff;font-weight:600}
#moon-switches input[type=search],#moon-switches input[type=text]{font:inherit;color:inherit;min-height:26px;padding:2px 8px;border-radius:8px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.22);min-width:0}
#moon-switches input[type=text]{width:9em}
#moon-switches button:focus-visible,#moon-switches summary:focus-visible,#moon-switches input:focus-visible{outline:2px solid #a9c8f5;outline-offset:2px}
#moon-switches .sw-body{margin-top:4px;padding:8px;max-height:70vh;overflow-y:auto;background:rgba(10,12,16,.9);border:1px solid rgba(255,255,255,.18);border-radius:12px}
#moon-switches .sw-body[hidden],#moon-switches [data-hide]{display:none}
#moon-switches details{border-top:1px solid rgba(255,255,255,.1);padding:4px 0}
#moon-switches summary{cursor:pointer;font-weight:600;letter-spacing:.04em;text-transform:uppercase;font-size:11px;opacity:.85}
#moon-switches .sw-row{margin:6px 0}
#moon-switches .sw-name{font-family:ui-monospace,monospace}
#moon-switches .sw-meta{opacity:.65;margin-left:6px}
#moon-switches .sw-note{opacity:.7;font-size:11px}
#moon-switches .sw-btns,#moon-switches .sw-tools,#moon-switches .sw-foot{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:2px}
#moon-switches .sw-tools{margin:0 0 6px}
#moon-switches .sw-foot{gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.18)}
`

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  if (text !== undefined) e.textContent = text
  return e
}

/** Typed text lives in the element's value; the panel reads the `value` attribute, so copy it over on each event. */
function syncValue(input: HTMLElement, e: Event): void {
  const t = e.target as { value?: unknown } | null | undefined
  if (t && typeof t.value === 'string') input.setAttribute('value', t.value)
}

export function mountSwitches(opts: SwitchesOptions = {}): SwitchesApi {
  const doc = opts.doc ?? document
  const href = opts.href ?? doc.defaultView?.location.href ?? location.href
  const dev = opts.dev ?? isDevBuild()
  const all = opts.switches ?? SWITCHES
  const go = opts.navigate ?? ((u: string) => { location.assign(u) })
  const copy = opts.copy ?? ((t: string) => navigator.clipboard.writeText(t))
  const search = new URL(href).search

  const style = el(doc, 'style', { 'data-switches-style': '' }, STYLE)
  const root = el(doc, 'div', { id: 'moon-switches', 'data-switches': '' })
  // The review badge (?label=) sits top-left too: start below it.
  if (doc.getElementById?.('review-label')) root.setAttribute('style', 'top:44px')
  const changed = nonDefault(href)
  const toggle = el(doc, 'button', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'moon-switches-body', 'data-switches-toggle': '' }, `Switches${changed.length ? ` (${changed.length} changed)` : ''}`)
  const body = el(doc, 'div', { id: 'moon-switches-body', class: 'sw-body', role: 'region', 'aria-label': 'Switches' })
  body.hidden = true
  const note = el(doc, 'span', { role: 'status', class: 'sw-note' })

  const tools = el(doc, 'div', { class: 'sw-tools' })
  const filter = el(doc, 'input', { type: 'search', placeholder: 'Filter switches', 'aria-label': 'Filter switches', 'data-switches-filter': '' })
  const onlyChanged = el(doc, 'button', { type: 'button', 'aria-pressed': 'false', 'data-switches-changed': '' }, 'Changed only')
  tools.append(filter, onlyChanged)
  body.append(tools)

  const rowFacts: { row: HTMLElement; text: string; changed: boolean }[] = []
  const groups: { d: HTMLElement; rows: typeof rowFacts }[] = []

  const rowEl = (r: PanelRow): HTMLElement => {
    const s = r.def
    const row = el(doc, 'div', { class: 'sw-row', role: 'group', 'aria-label': `${s.name}: ${s.effect}`, title: s.effect, 'data-switch-row': s.name })
    const head = el(doc, 'div')
    head.append(el(doc, 'span', { class: 'sw-name' }, `?${s.name}`), el(doc, 'span', { class: 'sw-meta' }, `default ${s.def ?? 'automatic'}, reloads`))
    row.append(head)
    if (r.offered) {
      const btns = el(doc, 'div', { class: 'sw-btns' })
      const add = (label: string, value: string | null, pressed: boolean): void => {
        const b = el(doc, 'button', { type: 'button', 'aria-pressed': String(pressed), 'data-switch': s.name, 'data-value': value ?? '' }, label)
        b.addEventListener('click', () => go(withSwitch(href, s.name, value)))
        btns.append(b)
      }
      // "default" removes the parameter; an explicit value equal to the default does the same, so it is not listed twice.
      add(s.def === null ? 'default' : `default (${s.def})`, null, r.current === s.def && r.other === null)
      for (const v of s.values) if (v !== s.def) add(v, v, r.current === v)
      row.append(btns)
    } else {
      row.append(el(doc, 'div', { class: 'sw-note' }, `${s.effect} URL only.`))
    }
    if (!r.offered || s.custom) {
      // Any other value: typed here, set on Enter or Set (empty removes the parameter).
      const line = el(doc, 'div', { class: 'sw-btns' })
      const input = el(doc, 'input', { type: 'text', 'aria-label': `${s.name} value`, 'data-switch-input': s.name, placeholder: s.custom ? 'other value' : 'value' })
      if (r.other !== null) input.setAttribute('value', r.other)
      const apply = (): void => { const v = input.getAttribute('value')?.trim() ?? ''; go(withSwitch(href, s.name, v === '' ? null : v)) }
      input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { syncValue(input, e); apply() } })
      input.addEventListener('input', (e) => syncValue(input, e))
      const set = el(doc, 'button', { type: 'button', 'data-switch-set': s.name }, 'Set')
      set.addEventListener('click', apply)
      line.append(input, set)
      row.append(line)
    }
    if (r.other !== null && r.offered && !s.custom) row.append(el(doc, 'div', { class: 'sw-note' }, `URL has ${r.other}, which is not an option here; it acts as the default.`))
    rowFacts.push({ row, text: `${s.name} ${s.effect} ${s.group}`.toLowerCase(), changed: r.other !== null || r.current !== s.def })
    return row
  }

  for (const g of panelRows(search, dev, all)) {
    if (g.rows.length === 0) continue
    const n = g.rows.filter((r) => r.other !== null || r.current !== r.def.def).length
    const d = el(doc, 'details', { 'data-switch-group': g.group })
    if (n > 0) d.setAttribute('open', '')
    d.append(el(doc, 'summary', {}, `${g.group} (${g.rows.length}${n ? `, ${n} changed` : ''})`))
    const start = rowFacts.length
    for (const r of g.rows) d.append(rowEl(r))
    groups.push({ d, rows: rowFacts.slice(start) })
    body.append(d)
  }

  /** Text filter and "changed only": hide rows that do not match, and groups left empty. A filter opens the groups it leaves visible. */
  let onlyOn = false
  const applyFilter = (): void => {
    const q = (filter.getAttribute('value') ?? '').trim().toLowerCase()
    for (const f of rowFacts) {
      const show = (!q || f.text.includes(q)) && (!onlyOn || f.changed)
      if (show) f.row.removeAttribute('data-hide'); else f.row.setAttribute('data-hide', '')
    }
    for (const g of groups) {
      const any = g.rows.some((f) => !f.row.hasAttribute('data-hide'))
      if (any) g.d.removeAttribute('data-hide'); else g.d.setAttribute('data-hide', '')
      if (any && (q || onlyOn)) g.d.setAttribute('open', '')
    }
  }
  filter.addEventListener('input', (e) => { syncValue(filter, e); applyFilter() })
  onlyChanged.addEventListener('click', () => { onlyOn = !onlyOn; onlyChanged.setAttribute('aria-pressed', String(onlyOn)); applyFilter() })

  const foot = el(doc, 'div', { class: 'sw-foot' })
  const reset = el(doc, 'button', { type: 'button', 'data-switches-reset': '' }, 'Reset all')
  reset.addEventListener('click', () => go(allDefaults(href)))
  const cp = el(doc, 'button', { type: 'button', 'data-switches-copy': '' }, 'Copy A/B links')
  cp.addEventListener('click', () => {
    copy(`A (current): ${href}\nB (all defaults): ${allDefaults(href)}`).then(() => { note.textContent = 'Copied A/B links' }, () => { note.textContent = 'Copy failed' })
  })
  foot.append(reset, cp, note)
  body.append(foot)

  const setOpen = (open: boolean): void => { body.hidden = !open; toggle.setAttribute('aria-expanded', String(open)) }
  toggle.addEventListener('click', () => setOpen(Boolean(body.hidden)))
  root.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape' && !body.hidden) { setOpen(false); toggle.focus() } })
  root.append(toggle, body)
  doc.head.append(style)
  doc.body.append(root)
  return {
    element: root,
    setHidden: (h) => { root.hidden = h },
    destroy: () => { root.remove(); style.remove() },
  }
}
