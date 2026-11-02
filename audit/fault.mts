/**
 * Which requests the G7 fault injection may abort: a site patch's DATA files (<base>/patch/<site>/<file>, not the manifest).
 * The earlier pattern was `/\/patch\/.*\.ext/` over the whole URL, which on the Vite dev server also matched the app's own module
 * `/moon/src/moon/patch/PatchLayer.ts`: aborting it stopped the app booting, and `__moon.ready` never came (L4 run: "robust ... not true in 90 s").
 */
export function isPatchDataRequest(url: string): boolean {
  let path: string
  try { path = new URL(url).pathname } catch { return false }
  if (/\/(?:src|node_modules|assets|@[a-z]+)\//.test(path)) return false
  return /\/patch\/[A-Za-z0-9_-]+\/[^/]+\.(?!json$)[A-Za-z0-9]+$/.test(path)
}
