import { createHash } from 'node:crypto'
export interface AuditIdentity {
  commit: string; bundleSha256: string; dataManifestSha256: string; development: boolean
}
export interface ServedIdentity { commit: string; dirty: boolean; bundleSha256: string }
export function hashManifests(entries: Record<string, string>): string {
  return createHash('sha256').update(JSON.stringify(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)))).digest('hex')
}
export function verifyServedIdentity(expected: AuditIdentity, actual: ServedIdentity): void {
  if (expected.development) return
  if (actual.commit !== expected.commit || actual.dirty || actual.bundleSha256 !== expected.bundleSha256)
    throw new Error('Served candidate commit/clean state/entry bundle does not match release identity')
}
export function verifyDataIdentity(expected: AuditIdentity, manifests: Record<string, string>): void {
  if (expected.development) throw new Error('Development diagnostics are incomplete release evidence')
  if (!Object.keys(manifests).length || hashManifests(manifests) !== expected.dataManifestSha256)
    throw new Error('Observed served data manifests do not match release identity')
}

export type ServedMode = 'vite-dev' | 'built-bundle' | 'unknown'
/** How the page under audit is served, from its entry HTML: the dev server injects /@vite/client; a build references hashed assets. */
export function detectServedMode(html: string): ServedMode {
  if (/\/@vite\/client/.test(html)) return 'vite-dev'
  if (/src="[^"]*assets\/[^"]*-[A-Za-z0-9_-]{6,}\.js"/.test(html)) return 'built-bundle'
  return 'unknown'
}
export const SERVED_MODE_LABEL: Record<ServedMode, string> = {
  'vite-dev': 'Vite dev server (HMR, unbundled modules, no Content-Length: diagnostics only)',
  'built-bundle': 'built bundle (static, Content-Length)',
  unknown: 'unknown',
}
export const MANIFEST_BODY_CAP = 4 * 1024 * 1024
/**
 * Whether a served manifest's body may be read, and how its size is bounded. A release run needs the server's Content-Length (the cap is
 * enforced before reading); the Vite dev server streams chunked and sends none, so a development run reads the body and checks the cap
 * after. Throws with the supported way out.
 */
export function manifestBodyPolicy(headers: Record<string, string>, o: { development: boolean; mode: ServedMode }): 'header' | 'post-read' {
  const length = Number(headers['content-length'])
  if (length > MANIFEST_BODY_CAP) throw new Error(`Served manifest exceeds the ${MANIFEST_BODY_CAP / 1024 / 1024} MiB cap (Content-Length ${length})`)
  if (length > 0) return 'header'
  if (o.development) return 'post-read'
  throw new Error(`Unbounded served manifest body: the server sent no Content-Length (served as: ${SERVED_MODE_LABEL[o.mode]}). A release audit must run against a built bundle: npm run build && npm run preview (http://localhost:5191/moon/index.html), or any static server that sends Content-Length.`)
}
