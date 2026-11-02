// A build made with no VITE_* or MOON_* variables (a fork, a fresh clone) carries nothing of ours: no bucket name, no Sentry or PostHog host,
// no email address but third-party copyright lines. A build with the publish scripts' variables still bakes them all (CSP hosts, data origins, TC base).
// Both are real `vite build`s into temporary directories (about two seconds each).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reportSkip } from './test-skip.mts'

const root = new URL('..', import.meta.url).pathname
const TEST = 'env-free build'

function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!/^(VITE|MOON)_/.test(k)) env[k] = v
  return { ...env, ...extra }
}

function build(env: NodeJS.ProcessEnv): string {
  const out = mkdtempSync(join(tmpdir(), 'moon-envfree-'))
  const r = spawnSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { cwd: root, env, encoding: 'utf8' })
  assert.equal(r.status, 0, `vite build failed:\n${r.stdout}\n${r.stderr}`)
  return out
}

function* textFiles(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) yield* textFiles(p)
    else if (/\.(js|mjs|css|html|json|txt|svg|webmanifest|xml)$/.test(n)) yield p
  }
}

// Vite would read a local .env into the build; this test is about a build with nothing set.
const dotenv = ['.env', '.env.local', '.env.production', '.env.production.local'].filter((f) => existsSync(join(root, f)))
if (dotenv.length > 0) {
  reportSkip(TEST, 'data', `a local ${dotenv.join(', ')} would feed the build; move it aside to run this check (CI has none)`)
} else {
  // 1. Nothing set.
  const bare = build(cleanEnv())
  try {
    const bad: string[] = []
    for (const f of textFiles(bare)) {
      const text = readFileSync(f, 'utf8')
      const rel = f.slice(bare.length + 1)
      for (const [what, re] of [
        ['the bucket name', new RegExp('skylumi-moon' + '-serve')],
        ['a bucket path on storage.googleapis.com', /storage\.googleapis\.com\/[a-z0-9]/],
        ['a Sentry host', /sentry\.io/i],
        ['a PostHog host', /posthog\.com/i],
        ['an owner domain', new RegExp('corsierlabs|kiru' + 'na', 'i')],
      ] as const) if (re.test(text)) bad.push(`${rel}: ${what}`)
      for (const line of text.split('\n')) {
        for (const email of line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[a-z]{2,}/g) ?? []) {
          // Third-party notices keep their authors' copyright lines; nothing else may carry an address.
          if (!(rel === 'THIRD-PARTY-NOTICES.txt' && /copyright/i.test(line))) bad.push(`${rel}: email ${email}`)
        }
      }
    }
    assert.deepEqual(bad, [], 'a build with no env carries nothing of ours')
    const index = readFileSync(join(bare, 'index.html'), 'utf8')
    assert.ok(!index.includes('%MOON_'), 'every index.html placeholder is filled')
    assert.match(index, /<title>The Moon · SkyLumi<\/title>/)
    // The launch head's local links (public/icons, public/manifest.webmanifest) are written absolute; the build must prefix the base (/moon/ here, /3d-moon/ for the website),
    // or they 404 when the app is served under a path. The bucket and the website both do.
    for (const h of ['/moon/icons/favicon-32.png', '/moon/icons/apple-touch-icon.png', '/moon/manifest.webmanifest']) assert.ok(index.includes(`href="${h}"`), `the build prefixes the base on ${h}`)
    assert.ok(!/href="\/(icons|manifest\.webmanifest)/.test(index), 'no icon or manifest link is left without the base')
    assert.match(index, /connect-src 'self' blob: https:\/\/storage\.googleapis\.com http:\/\/localhost:\*/, 'connect-src: no telemetry host between the data host and loopback')
  } finally { rmSync(bare, { recursive: true, force: true }) }

  // 2. The publish scripts' variables (stand-in keys of the real shape).
  const B = '/example-mirror/moon'
  const ours = build(cleanEnv({
    VITE_MOON_TILES: `${B}/tiles/`, VITE_MOON_PATCH: `${B}/patch/`, VITE_MOON_MID_PATCH: `${B}/mid-patch/`, VITE_MOON_TC: `${B}/tc/v3/`, VITE_MOON_HORIZONS: `${B}/horizons/baked-a/`,
    VITE_MOON_DATA_ORIGINS: 'https://storage.googleapis.com/example-mirror/',
    VITE_SENTRY_DSN: 'https://abc@o1000000000000001.ingest.us.sentry.io/1000000000000002', VITE_POSTHOG_KEY: 'phc_test', VITE_POSTHOG_HOST: 'https://us.i.posthog.com',
  }))
  try {
    const index = readFileSync(join(ours, 'index.html'), 'utf8')
    assert.match(index, /connect-src 'self' blob: https:\/\/storage\.googleapis\.com https:\/\/us\.i\.posthog\.com https:\/\/o1000000000000001\.ingest\.us\.sentry\.io http:\/\/localhost:\*/, 'our CSP as before')
    const js = [...textFiles(join(ours, 'assets'))].filter((f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8')).join('\n')
    for (const s of [`${B}/tiles/`, `${B}/patch/`, `${B}/mid-patch/`, `${B}/tc/v3/`, `${B}/horizons/baked-a/`, 'https://storage.googleapis.com/example-mirror/']) assert.ok(js.includes(s), `the bundle bakes ${s}`)
  } finally { rmSync(ours, { recursive: true, force: true }) }
}
console.log('env-free-build.test: ok')
