import assert from 'node:assert/strict'
import { serveShares, classifyServePixel, parseShadowDebug, SERVE_CATEGORIES, SERVE_DBG_VALUE, summariseServe } from '../src/moon/shadowServe'
import { diagnosticViewEnabled } from '../src/post/final'
import { moonFragment } from '../src/moon/moonShader'

assert.equal(parseShadowDebug('?shadowdebug=serve'), 'serve')
assert.equal(parseShadowDebug('?shadowdebug=other'), null)
assert.equal(parseShadowDebug(''), null)
assert.equal(diagnosticViewEnabled('?shadowdebug=serve'), true, 'the serving view draws through the diagnostic (no tone mapping) route')

// Every category colour survives the sRGB conversion and classifies back to itself; black is off-Moon.
const srgb = (c: number): number => Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255)
SERVE_CATEGORIES.forEach((c, i) => {
  const [r, g, b] = c.rgb.map(srgb)
  assert.equal(classifyServePixel(r, g, b), i, c.key)
  assert.equal(classifyServePixel(Math.min(255, r + 6), Math.max(0, g - 6), b), i, `${c.key} tolerates a few counts of noise`)
})
assert.equal(classifyServePixel(0, 0, 0), -1)
assert.equal(classifyServePixel(10, 8, 12), -1)

const buf = new Uint8Array([0, 255, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255])
const counts = summariseServe(buf)
assert.equal(counts.total, 4)
assert.equal(counts.exact, 2)
assert.equal(counts.offMoon, 1)
assert.equal(counts.live, 1)

// Off by default: the shipped shader source carries no serving-mask code at all.
for (const fixed of [false, true]) {
  const plain = moonFragment(360, 23040, '', true, null, false, -3, false, undefined, false, false, fixed)
  assert.ok(!plain.includes('gServe') && !plain.includes('serveDebugColour'), `no mask code without ?shadowdebug=serve (fixed=${fixed})`)
}
const g = globalThis as { location?: unknown }
const savedLocation = g.location
g.location = { search: '?shadowdebug=serve' }
// The shader: both policies write gServe, and the debug view colours it.
for (const fixed of [false, true]) {
  const shader = moonFragment(360, 23040, '', true, null, false, -3, false, undefined, false, false, fixed)
  assert.match(shader, /float gServe = 0\.0;/)
  assert.match(shader, new RegExp(`uDbg > ${SERVE_DBG_VALUE - 0.5} && uDbg < ${SERVE_DBG_VALUE + 0.5}\\) \\{ fragColor = vec4\\(serveDebugColour\\(gServe\\), 1\\.0\\)`))
  assert.match(shader, fixed ? /valid\) \{ gServe = 1\.0;\s+return h; \}/ : /gServe = w >= 0\.999 \? 1\.0 : 8\.0;/)
}
const fixedShader = moonFragment(360, 23040, '', true, null, false, -3, false, undefined, false, false, true)
assert.match(fixedShader, /\} else \{ gServe = 5\.0;\s*\}/)
// Under fixed, every non-exact pixel marches live, as legacy does: no coarse map, no parent read.
assert.ok(!fixedShader.includes('uShCoarse'))
assert.doesNotMatch(fixedShader, /gServe = min\(2\.0/)
assert.ok(!SERVE_CATEGORIES.some((c) => /coarse/i.test(c.key)), 'no serving category maps to the coarse map')
const sh = serveShares({ exact: 90, liveMiss: 5, liveGate: 3, live: 2, analytic: 500, offMoon: 100 })
assert.equal(sh.read, 100)
assert.equal(sh.exactShare, 0.9)
assert.equal(sh.marchedShare, 0.1)
assert.equal(serveShares({}).marchedShare, null)
g.location = savedLocation
console.log('shadow-serve ok')
