import assert from 'node:assert/strict'
import { isPatchDataRequest } from '../audit/fault.mts'
// Data files of a patch: aborted once by G7.
for (const u of ['http://localhost:5190/moon/patch/a17/level0.bin.gz', 'https://host.example/moon/patch/a17/tile-3.webp?x=1', 'https://host.example/patch/a11/albedo.png']) assert.equal(isPatchDataRequest(u), true, u)
// Never the manifest, never the app's own modules (they contain /patch/ in the dev server's source paths).
for (const u of ['http://localhost:5190/moon/patch/a17/manifest.json', 'http://localhost:5190/moon/src/moon/patch/PatchLayer.ts', 'http://localhost:5190/moon/src/moon/patch/config.ts?t=1', 'http://localhost:5190/moon/assets/patch-AbCdEf.js', 'http://localhost:5190/moon/index.html', 'not a url'])
  assert.equal(isPatchDataRequest(u), false, u)
console.log('audit-fault.test.mts: ok')
