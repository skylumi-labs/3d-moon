import assert from 'node:assert/strict'
import { diagnosticViewEnabled, FINAL_FRAGMENT, GLARE_GAIN } from '../src/post/final'
import { moonFragment } from '../src/moon/moonShader'

assert.equal(diagnosticViewEnabled('?dbg=1'), true)
assert.equal(diagnosticViewEnabled('?dbg=10'), true)
assert.equal(diagnosticViewEnabled('?dbg=0'), false)
assert.equal(diagnosticViewEnabled('?dbg=bad'), false)
assert.equal(diagnosticViewEnabled(''), false)
assert.equal(GLARE_GAIN, 0.007, 'glare gain reflects the requested reduction')
assert.match(FINAL_FRAGMENT, /float halo = 0\.036 \* pow\(/, 'Sun lens glow is reduced with the glare pyramid')

const shader = moonFragment(360, 23040, '', true, null, false, -3, false)
const diagnosticStart = shader.indexOf('// Diagnostic channels are bounded linear display values.')
const diagnosticEnd = shader.indexOf('\n  }', diagnosticStart)
assert.ok(diagnosticStart >= 0 && diagnosticEnd > diagnosticStart)
const diagnosticBody = shader.slice(diagnosticStart, diagnosticEnd)
assert.doesNotMatch(diagnosticBody, /uPreExpose/)
assert.match(diagnosticBody, /clamp\(nrm \* 0\.5 \+ 0\.5, 0\.0, 1\.0\)/)
assert.match(diagnosticBody, /clamp\(dot\(albedo,/)
assert.match(diagnosticBody, /clamp\(vec3\(wn2, wn1, w0\), 0\.0, 1\.0\)/)

// Diagnostic kill modes isolate the deeper ladders without changing the
// default shader: 1 removes both -1/-2, 2 removes -1 only, and 3 removes -2 only.
assert.match(shader, /wn1 \*= \(\(uDbgKill > 0\.5 && uDbgKill < 2\.5\) \? 0\.0 : 1\.0\)/)
assert.match(shader, /wn2 \*= \(\(uDbgKill > 0\.5 && uDbgKill < 1\.5\) \|\| \(uDbgKill > 2\.5 && uDbgKill < 3\.5\) \? 0\.0 : 1\.0\)/)
assert.match(shader, /wn3 = tileWeight\(tn3, -3, fpTile, tGate\)/)
assert.doesNotMatch(shader, /wn3 \*= .*uDbgKill/)
assert.doesNotMatch(shader, /w0 \*= .*uDbgKill/)

const bypass = FINAL_FRAGMENT.slice(FINAL_FRAGMENT.indexOf('if (uDiagnosticView > 0.5)'), FINAL_FRAGMENT.indexOf('vec3 c = sc.rgb'))
assert.match(bypass, /toSrgb\(clamp\(sc\.rgb, 0\.0, 1\.0\)\)/)
assert.doesNotMatch(bypass, /uWhite|uHdr|uLongMax|uShoulder|uGlareGain/)

console.log('shader-debug: bounded linear diagnostic channels bypass scene exposure and tone mapping')
