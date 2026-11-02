import './dock.css'
import { bandPx } from './touchControlsLogic'

/**
 * The bottom stack: the caption, any sheet that opens in place, and the one bar, in that order from the top, centred on
 * phones and with the caption on the left on wide screens. One element, shared by the caption and the bar.
 */
export function getDock(root: HTMLElement): HTMLElement {
  let dock = root.querySelector<HTMLElement>(':scope > .dock')
  if (!dock) {
    dock = document.createElement('div')
    dock.className = 'dock'
    root.append(dock)
    trackDockTop(root, dock)
  }
  return dock
}

/**
 * Publish --caption-h: the height of the captions standing in the dock (each plus the 8 px gap, 0 when none is shown), the way the
 * navigator publishes --nav-h. The flight pad sits above this band so it never shares it with the caption, the New Moon note or the
 * "Show it lit" chip. Call once per caption element; the sum covers every visible `.caption` in the dock.
 */
export function trackCaptionBand(dock: HTMLElement, el: HTMLElement): void {
  const update = (): void => {
    let total = 0
    for (const c of dock.querySelectorAll<HTMLElement>(':scope > .caption')) total += bandPx(c.offsetHeight, Boolean(c.hidden))
    document.documentElement.style.setProperty('--caption-h', `${total}px`)
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(el)
  if (typeof MutationObserver !== 'undefined') new MutationObserver(update).observe(el, { attributes: true, attributeFilter: ['hidden'] })
  update()
}

/**
 * Publish --dock-top: how far the top of the dock (caption, any open sheet, pill and bar) stands above the bottom of the screen.
 * The flight pad never goes lower than this, so a sheet that opens in the dock lifts the pad's toggle clear of it instead of
 * covering the sheet's corner.
 */
function trackDockTop(root: HTMLElement, dock: HTMLElement): void {
  const update = (): void => {
    const parent = dock.offsetParent ?? root
    const px = Math.max(0, parent.clientHeight - dock.offsetTop)
    document.documentElement.style.setProperty('--dock-top', `${px}px`)
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(dock)
  if (typeof window !== 'undefined') window.addEventListener('resize', update)
  update()
}
