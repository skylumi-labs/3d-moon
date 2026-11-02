/**
 * The panorama's sky stays clean above the photograph (V11: a faint dashed line where the top row met the sky). Shader text checks.
 *   npm test
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../src/ui/panorama.ts', import.meta.url), 'utf8')
assert.ok(/float texelV = 1\.0 \/ float\(textureSize\(uPano, 0\)\.y\)/.test(src), 'the texel height comes from the bound texture')
assert.ok(/if \(u >= 1\.0 \|\| v < 1\.5 \* texelV\)/.test(src), 'black above the photograph and in its top 1.5 texels')
assert.ok(/clamp\(v, 1\.5 \* texelV, 1\.0\)/.test(src), 'sampled rows never reach the clamped top edge')
console.log('panorama sky ok')
