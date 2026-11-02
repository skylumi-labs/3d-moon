// Fails when a built dist/ carries restricted coverage data: the dev-only internal file path, or a credit or source string of any
// 'internal-only' row (the bundled list, plus a local .internal/coverage-internal.json when one exists). Run by `npm run build`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEV_ONLY_STRINGS = ['coverage-internal', '/moon/internal']

export function restrictedStrings(files) {
  const out = []
  for (const f of files) {
    if (!existsSync(f)) continue
    for (const r of JSON.parse(readFileSync(f, 'utf8')).regions ?? []) {
      if (r.licence === 'internal-only') for (const k of ['credit', 'source']) if (typeof r[k] === 'string' && r[k].length >= 4) out.push(r[k])
    }
  }
  return out
}

function* walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(js|mjs|css|html|json|map)$/.test(n)) yield p
  }
}

/** Returns "file: string" for every forbidden string found under dir. */
export function scanDist(dir, extra = []) {
  const bad = []
  const needles = [...DEV_ONLY_STRINGS, ...extra]
  for (const f of walk(dir)) {
    const text = readFileSync(f, 'utf8')
    for (const n of needles) if (text.includes(n)) bad.push(`${f}: ${n}`)
  }
  return bad
}

export function distNeedles(root) {
  return restrictedStrings([join(root, 'src/coverage/regions.json'), join(root, '.internal/coverage-internal.json')])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), '../..')
  const dist = join(root, 'dist')
  if (!existsSync(dist)) { console.error('assert-dist-public: no dist/'); process.exit(1) }
  const bad = scanDist(dist, distNeedles(root))
  if (bad.length) { console.error('assert-dist-public: restricted coverage data in the build:\n' + bad.join('\n')); process.exit(1) }
  console.log('assert-dist-public ok')
}
