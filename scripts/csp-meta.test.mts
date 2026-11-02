// index.html carries a Content-Security-Policy meta (the bucket cannot send headers) and it stays tight (#197). The policy checked is the one a
// build writes (src/build/indexHtml.ts): telemetry hosts only when the build has keys.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderIndexHtml } from '../src/build/indexHtml.ts'
import { PAGE_TITLE } from '../src/branding.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'index.html'), 'utf8')
// The source names no telemetry host; the build writes the hosts of its keys into connect-src (src/build/indexHtml.ts, vite.config.ts).
assert.ok(!/sentry|posthog/i.test(source), 'index.html itself names no Sentry or PostHog host')
const cspOf = (h: string): Map<string, string[]> => {
  const mm = h.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)
  assert.ok(mm, 'index.html has a Content-Security-Policy meta')
  const out = new Map<string, string[]>()
  for (const part of mm![1].split(';').map((p) => p.trim()).filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/)
    out.set(name, values)
  }
  return out
}

// A build without keys: no telemetry host at all, nothing left of the placeholder, the rest of connect-src as with keys.
const bare = renderIndexHtml(source, {})
const barePolicy = cspOf(bare)
assert.ok(!/sentry|posthog|MOON_TELEMETRY|%/i.test(bare.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)![0]), 'no keys, no telemetry host in the CSP')
assert.deepEqual(barePolicy.get('connect-src'), ["'self'", 'blob:', 'https://storage.googleapis.com', 'http://localhost:*', 'http://127.0.0.1:*', 'ws://localhost:*', 'ws://127.0.0.1:*'])
assert.deepEqual(cspOf(renderIndexHtml(source, { VITE_SENTRY_DSN: '', VITE_POSTHOG_KEY: '', VITE_POSTHOG_HOST: 'https://eu.i.posthog.com' })).get('connect-src'), barePolicy.get('connect-src'), 'a host without a key adds nothing')

// A build with our keys (the shape of the publish scripts' env): the PostHog and Sentry ingest hosts, in that order, before loopback.
const html = renderIndexHtml(source, { VITE_SENTRY_DSN: 'https://abc@o1000000000000001.ingest.us.sentry.io/1000000000000002', VITE_POSTHOG_KEY: 'phc_x', VITE_POSTHOG_HOST: '' })
const policy = cspOf(html)
const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)
assert.deepEqual(policy.get('connect-src'), ["'self'", 'blob:', 'https://storage.googleapis.com', 'https://us.i.posthog.com', 'https://o1000000000000001.ingest.us.sentry.io', 'http://localhost:*', 'http://127.0.0.1:*', 'ws://localhost:*', 'ws://127.0.0.1:*'])
for (const d of ['default-src', 'script-src', 'img-src', 'worker-src', 'style-src', 'object-src', 'base-uri']) assert.deepEqual(policy.get(d), barePolicy.get(d), `${d} does not depend on the keys`)
assert.deepEqual(cspOf(renderIndexHtml(source, { VITE_POSTHOG_KEY: 'k', VITE_POSTHOG_HOST: 'https://eu.i.posthog.com/' })).get('connect-src')!.filter((v) => /posthog|sentry/.test(v)), ['https://eu.i.posthog.com'], 'PostHog host from VITE_POSTHOG_HOST, as an origin')
assert.throws(() => renderIndexHtml(source, { VITE_SENTRY_DSN: 'not a dsn' }), /VITE_SENTRY_DSN/, 'a malformed DSN fails the build')
assert.throws(() => renderIndexHtml(source, { VITE_POSTHOG_KEY: 'k', VITE_POSTHOG_HOST: 'http://ph.example' }), /https/, 'a plain-http telemetry host fails the build')
assert.throws(() => renderIndexHtml('<title>x</title>', {}), /placeholder/, 'a lost placeholder fails the build')
assert.match(html, new RegExp(`<title>${PAGE_TITLE}</title>`), 'the title comes from src/branding.ts')
const has = (d: string, v: string) => assert.ok(policy.get(d)?.includes(v), `${d} includes ${v}`)
const bucket = 'https://storage.googleapis.com'

// Tight where it matters.
assert.deepEqual(policy.get('default-src'), ["'self'"])
assert.ok(policy.get('script-src')!.every((v) => v === "'self'" || v === "'wasm-unsafe-eval'" || v.startsWith("'sha256-")), 'script-src: self, wasm and hashes only, no JS eval, no third-party host')
// The lunar module's Draco decoder is WebAssembly: without 'wasm-unsafe-eval' Chrome refuses to compile it and the lander never loads (rig, 2026-10-17).
// 'wasm-unsafe-eval' allows WebAssembly compilation only; JavaScript eval stays blocked.
has('script-src', "'wasm-unsafe-eval'")
assert.deepEqual(policy.get('object-src'), ["'none'"])
assert.deepEqual(policy.get('base-uri'), ["'self'"])
assert.ok(!/(?<!wasm-)unsafe-eval|unsafe-inline.*script-src/.test(m![1]), 'no unsafe-eval')
assert.ok(!policy.has('frame-ancestors'), 'frame-ancestors is ignored in a meta')
for (const [d, values] of policy) assert.ok(!values.includes('*') && !values.includes('https:') && !values.includes('http:'), `${d} names hosts, never a wildcard scheme`)

// Open where the viewer needs it: tiles and patches from the bucket, telemetry, workers, decoded bitmaps and blobs.
has('connect-src', bucket); has('connect-src', 'blob:'); has('connect-src', 'https://us.i.posthog.com')
assert.ok(policy.get('connect-src')!.some((v) => /^https:\/\/[a-z0-9]+\.ingest\.us\.sentry\.io$/.test(v)), 'connect-src names the Sentry ingest host')
has('img-src', bucket); has('img-src', 'data:'); has('img-src', 'blob:')
has('worker-src', "'self'"); has('worker-src', 'blob:')
has('style-src', "'unsafe-inline'")

// index.html carries no inline script: the boot guard (#187) is public/boot-guard.js, because skylumi.org's /3d-moon CSP header knows no hash.
// Any inline script that appears must still be allowed by its sha256 in script-src, never by 'unsafe-inline'.
// A JSON-LD data block (type="application/ld+json", the launch head) is not script and CSP does not apply to it.
for (const mm of html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/gi)) {
  const hash = `'sha256-${createHash('sha256').update(mm[1]).digest('base64')}'`
  assert.ok(policy.get('script-src')!.includes(hash), `inline script is allowed by ${hash} in script-src`)
}
assert.ok(!policy.get('script-src')!.includes("'unsafe-inline'"), "script-src has no 'unsafe-inline'")
assert.ok(!/\son(click|load|error)=/i.test(html), 'no inline event handler')
// The artifact preview drops the meta (its boot script is inline). It is a private helper, absent from the public tree (public-tree/manifest.txt).
const artifactPreview = join(root, 'scripts', 'artifact-preview.mjs')
if (existsSync(artifactPreview)) assert.ok(readFileSync(artifactPreview, 'utf8').includes('Content-Security-Policy'), 'artifact-preview removes the CSP meta')
console.log('csp-meta.test: ok')
