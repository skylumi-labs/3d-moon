// The runtime data-base overrides are limited to the build's data origins (VITE_MOON_DATA_ORIGINS; the publish scripts name the project bucket),
// loopback and the build's own base (#197).
import assert from 'node:assert/strict'
import { dataBaseAllowed, parseDataOrigins, resolveDataBase } from '../src/moon/dataBase.ts'
import { tileBase } from '../src/moon/tiles/config.ts'
import { patchBase, midPatchBase } from '../src/moon/patch/config.ts'
import { horizonBase } from '../src/moon/baked/format.ts'
import { tcBase } from '../src/moon/tiles/tcDetail.ts'

const B = 'https://storage.googleapis.com/example-mirror/moon/'
// The data origin our publish scripts bake (VITE_MOON_DATA_ORIGINS).
const origins = ['https://storage.googleapis.com/example-mirror/']
const bucketPage = { origin: 'https://storage.googleapis.com', hostname: 'storage.googleapis.com', dev: false, origins }
const sitePage = { origin: 'https://skylumi.org', hostname: 'skylumi.org', dev: false, origins }
const ok = (raw: string, env = bucketPage, cfg = '') => dataBaseAllowed(raw, cfg, env)

// Allowed.
assert.ok(ok(`${B}tiles/`))
assert.ok(ok('/example-mirror/moon/tiles/'), 'origin-relative under the bucket, page on the bucket')
assert.ok(ok('http://localhost:5195/tiles/'))
assert.ok(ok('http://127.0.0.1:5190/moon/tiles/'))
assert.ok(ok('http://[::1]:5190/x/'))
assert.ok(ok('https://cdn.example/moon/tiles/', sitePage, 'https://cdn.example/moon/'), 'the build\'s own base')

// Refused: the exploit link, lookalikes, other buckets, traversal, credentials, other schemes.
assert.equal(ok('https://attacker.example/t/'), false)
assert.equal(ok('//attacker.example/t/'), false, 'protocol-relative to a foreign host')
assert.equal(ok('https://storage.googleapis.com/other-bucket/moon/'), false, 'another bucket on the same host')
assert.equal(ok('/other-bucket/moon/'), false, 'origin-relative path into another bucket')
assert.equal(ok('/moon/tiles/'), false, 'a bare /moon/ path on the bucket origin names a different bucket')
assert.equal(ok('https://storage.googleapis.com/example-mirror/../evil/'), false, 'dot segments are resolved before the check')
assert.equal(ok('https://storage.googleapis.com/example-mirror/%2e%2e/evil/'), false, 'encoded dot segments too')
assert.equal(ok('https://storage.googleapis.com.evil.example/example-mirror/'), false)
assert.equal(ok('https://localhost.evil.example/x/'), false)
assert.equal(ok('https://u:p@storage.googleapis.com/example-mirror/x/'), false)
assert.equal(ok('data:text/plain,x'), false)
assert.equal(ok('javascript:alert(1)'), false)
assert.equal(ok('https://other.example/', sitePage, 'https://cdn.example/moon/'), false)
assert.equal(ok('https://cdn.example/other/', sitePage, 'https://cdn.example/moon/'), false, 'same host as the build base but outside its path')

// A build with no data origins (a fork, or no env at all) knows no bucket: only loopback and its own base pass.
const bare = { origin: 'https://storage.googleapis.com', hostname: 'storage.googleapis.com', dev: false, origins: [] }
assert.equal(ok(`${B}tiles/`, bare), false, 'no data origins, no bucket')
assert.equal(ok('/example-mirror/moon/tiles/', bare), false)
assert.ok(ok('http://localhost:5195/tiles/', bare))
assert.ok(ok(`${B}tiles/`, bare, `${B}`), 'the build\'s own base still passes')
assert.equal(ok(`${B}../other/`, bare, `${B}`), false)
// An origin-relative data origin resolves against the page; several origins may be listed.
assert.ok(ok(`${B}tiles/`, { ...bare, origins: ['/example-mirror/'] }))
assert.equal(ok(`${B}tiles/`, { ...sitePage, origins: ['/example-mirror/'] }), false, 'relative to skylumi.org it names another host')
assert.ok(ok('https://cdn.example/m/t/', { ...bare, origins: ['https://mirror.example/', 'https://cdn.example/m'] }))
assert.equal(ok('https://cdn.example/mx/t/', { ...bare, origins: ['https://cdn.example/m'] }), false, 'a path prefix is a directory, not a string prefix')
assert.equal(ok('https://x.example/', { ...bare, origins: ['not a url', ''] }), false, 'an unparsable origin allows nothing')
assert.deepEqual(parseDataOrigins(undefined), [])
assert.deepEqual(parseDataOrigins(''), [])
assert.deepEqual(parseDataOrigins(' https://a.example/x/, https://b.example/\n/c/ ,,'), ['https://a.example/x/', 'https://b.example/', '/c/'])

// The dev server accepts anything.
assert.ok(dataBaseAllowed('https://attacker.example/t/', '', { dev: true }))

// resolveDataBase: off values, trailing slash, refusal does not fall back to the default.
const warn = console.warn
let warned = 0
console.warn = () => { warned++ }
assert.equal(resolveDataBase('tiles', 'off', B, bucketPage), null)
assert.equal(resolveDataBase('tiles', '', B, bucketPage), null)
assert.equal(resolveDataBase('tiles', '0', B, bucketPage), null)
assert.equal(resolveDataBase('tiles', null, '', bucketPage), null)
assert.equal(resolveDataBase('tiles', null, `${B}tiles`, bucketPage), `${B}tiles/`, 'the build default needs no check')
assert.equal(resolveDataBase('tiles', `${B}tiles`, '', bucketPage), `${B}tiles/`)
assert.equal(resolveDataBase('tiles', 'https://attacker.example/t', `${B}tiles/`, bucketPage), null)
assert.equal(warned, 1, 'a refusal is announced')
console.warn = warn

// The five call sites go through it (node has no page, so only absolute URLs can pass; the exploit link yields nothing).
// Node has no VITE_MOON_DATA_ORIGINS, so the call sites run as a bare build: the bucket is refused there, loopback passes.
const evil = '?tiles=https://attacker.example/t/&patch=https://attacker.example/p/&midpatch=https://attacker.example/m/&horizons=https://attacker.example/h/&tc=https://attacker.example/tc/'
console.warn = () => {}
assert.equal(tileBase(evil), null)
assert.equal(patchBase(evil), null)
assert.equal(midPatchBase(evil), null)
assert.equal(horizonBase(evil), null)
assert.equal(tcBase(evil), null)
console.warn = warn
const L = 'http://localhost:5195/moon/'
const good = `?tiles=${L}tiles/&patch=${L}patch/&midpatch=${L}mid-patch/&horizons=${L}horizons/baked-a&tc=${L}tc/v3`
assert.equal(tileBase(good), `${L}tiles/`)
assert.equal(patchBase(good), `${L}patch/`)
assert.equal(midPatchBase(good), `${L}mid-patch/`)
assert.equal(horizonBase(good), `${L}horizons/baked-a/`)
assert.equal(tcBase(good), `${L}tc/v3/`)
console.warn = () => {}
const bucket = `?tiles=${B}tiles/&patch=${B}patch/&midpatch=${B}mid-patch/&horizons=${B}horizons/baked-a&tc=${B}tc/v3`
for (const f of [tileBase, patchBase, midPatchBase, horizonBase, tcBase]) assert.equal(f(bucket), null, `${f.name}: no data origins in this build, the bucket is refused`)
console.warn = warn
assert.equal(tileBase('?tiles=http://localhost:5195/tiles'), 'http://localhost:5195/tiles/')
console.log('data-base.test: ok')
