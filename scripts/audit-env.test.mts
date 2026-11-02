/** Report header, served-manifest policy and the shared-asset precondition (L4 run 2026-10-02 findings). */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describeBrowser, isSoftwareRenderer, chromeArgs } from '../audit/env.mts'
import { detectServedMode, manifestBodyPolicy } from '../audit/identity.mts'
import { missingSharedAssets, assertSharedAssets, SHARED_ASSETS } from './shared-assets.ts'

// The header names the browser and renderer that ran, not a hard-coded "Linux Chromium, SwiftShader".
const gpu = describeBrowser({ name: 'chromium', version: '141.0.7390.37', executable: '/usr/bin/google-chrome', platform: 'linux', args: ['--use-angle=gl-egl'] })
assert.match(gpu, /141\.0\.7390\.37/)
assert.match(gpu, /gl-egl/)
assert.doesNotMatch(gpu, /SwiftShader/i)
assert.match(describeBrowser({ name: 'chromium', version: '1', executable: null, platform: 'linux', args: ['--use-angle=swiftshader'] }), /swiftshader/i)
assert.equal(isSoftwareRenderer('ANGLE (NVIDIA Corporation, NVIDIA L4/PCIe/SSE2, OpenGL ES 3.2)'), false)
assert.equal(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'), true)
assert.equal(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)'), true)
assert.deepEqual(chromeArgs({ platform: 'linux', gpu: false, extra: '' }).filter((a) => a.includes('angle')), ['--use-angle=swiftshader'])
assert.ok(chromeArgs({ platform: 'linux', gpu: true, extra: '' }).includes('--use-angle=gl-egl'))
assert.ok(!chromeArgs({ platform: 'linux', gpu: true, extra: '' }).some((a) => /swiftshader/.test(a)))
assert.ok(chromeArgs({ platform: 'linux', gpu: false, extra: '--foo --bar=1' }).includes('--bar=1'))

// Served mode and the manifest body rule.
assert.equal(detectServedMode('<script type="module" src="/moon/@vite/client"></script>'), 'vite-dev')
assert.equal(detectServedMode('<script type="module" crossorigin src="/moon/assets/index-AbC123.js"></script>'), 'built-bundle')
const noLen = {}, withLen = { 'content-length': '1200' }
assert.throws(() => manifestBodyPolicy(noLen, { development: false, mode: 'built-bundle' }), /Content-Length/)
assert.throws(() => manifestBodyPolicy(noLen, { development: false, mode: 'vite-dev' }), /npm run preview/)
assert.equal(manifestBodyPolicy(withLen, { development: false, mode: 'built-bundle' }), 'header')
// A development run on the dev server reads the body (bounded after the fact) instead of erroring on every manifest.
assert.equal(manifestBodyPolicy(noLen, { development: true, mode: 'vite-dev' }), 'post-read')
assert.throws(() => manifestBodyPolicy({ 'content-length': String(5 * 1024 * 1024) }, { development: true, mode: 'vite-dev' }), /exceeds/)

// Packaging: the app imports shared-assets/; a checkout that lacks it must say so.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moon-root-'))
assert.deepEqual(missingSharedAssets(root), SHARED_ASSETS.map((f) => path.join('shared-assets', f)))
assert.throws(() => assertSharedAssets(root), (e: Error) => /moon-maps\.json/.test(e.message) && /shared-assets|git checkout/i.test(e.message))
fs.mkdirSync(path.join(root, 'shared-assets'), { recursive: true })
for (const f of SHARED_ASSETS) fs.writeFileSync(path.join(root, 'shared-assets', f), 'x')
assert.deepEqual(missingSharedAssets(root), [])
assertSharedAssets(root)
fs.rmSync(root, { recursive: true, force: true })
// And in the real checkout the files exist.
assertSharedAssets()
console.log('audit-env.test.mts: ok')
