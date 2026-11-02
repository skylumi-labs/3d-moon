/**
 * A selector lookup that is repeated every drawn frame for an element that lives as long as the page: the element is found once and kept
 * while it is still in the document, found again if it was replaced or removed. Same element as `document.querySelector` returns.
 * (The rect is still read each time: it moves with layout, and reading it is what the callers need.)
 */
export function cachedQuery(root: ParentNode, selector: string): (() => Element | null) {
  let el: Element | null = null
  return () => {
    if (el && el.isConnected) return el
    el = root.querySelector(selector)
    return el
  }
}
