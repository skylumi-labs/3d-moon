/** Longest `?label=` shown, characters. */
export const REVIEW_LABEL_MAX = 60

/** The `?label=` value of a query string: trimmed, control characters dropped, capped at REVIEW_LABEL_MAX; null when absent or empty. */
export function parseReviewLabel(search: string): string | null {
  const raw = new URLSearchParams(search).get('label')
  if (raw === null) return null
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (clean === '') return null
  return [...clean].slice(0, REVIEW_LABEL_MAX).join('').trim()
}

/** A review-comparison badge: sets the tab title and shows the label top-left. Does nothing without `?label=`. Text goes in by textContent only. */
export function mountReviewLabel(search: string): HTMLElement | null {
  const label = parseReviewLabel(search)
  if (label === null) return null
  document.title = `${label} · The Moon`
  const el = document.createElement('div')
  el.id = 'review-label'
  el.style.cssText = 'position:fixed;z-index:50;pointer-events:none;left:calc(10px + env(safe-area-inset-left, 0px));top:calc(10px + env(safe-area-inset-top, 0px));max-width:calc(100vw - 20px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px));font:600 0.8125rem/1.3 ui-sans-serif,system-ui,sans-serif;color:#fff;background:rgba(10,12,18,.85);padding:5px 9px;border-radius:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
  el.textContent = label
  document.body.append(el)
  return el
}
