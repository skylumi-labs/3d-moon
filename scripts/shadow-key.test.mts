import assert from 'node:assert/strict'

async function shaderFor(search: string, tag: string): Promise<string> {
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { search } })
  const url = new URL(`../src/moon/moonShader.ts?${tag}`, import.meta.url)
  const moon = await import(url.href) as typeof import('../src/moon/moonShader.ts')
  return moon.moonFragment(360, 4096, '', false, null)
}
const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}
const key = (mu0: number, sunOverEarthshine: number, directEarthLight = 1, legacyMode = false): number => {
  const rad = smoothstep(0.75, 4, sunOverEarthshine)
  const sphere = smoothstep(-0.008, 0.02, mu0)
  return Math.max(legacyMode ? rad : Math.max(sphere, rad), 0) * smoothstep(0.003, 0.03, directEarthLight)
}

const candidate = await shaderFor('?look=a', 'candidate')
const legacy = await shaderFor('?look=a&shadowkey=legacy', 'legacy')
assert.match(candidate, /mix\(smoothstep\(-0\.03, 0\.12, dot\(p, uS\)\), max\(smoothstep\(-0\.008, 0\.020, dot\(p, uS\)\), radKey\), lookW\)/)
assert.match(legacy, /mix\(smoothstep\(-0\.03, 0\.12, dot\(p, uS\)\), radKey, lookW\)/)
assert.ok(candidate.includes('sun *= sunLight;') && candidate.includes('fillT *= sunLight;'), 'the exposure key leaves direct and refracted eclipse lighting intact')
// At the reported pose the sphere Sun elevation is 3.04 degrees. A crater
// shadow can have very little local solar radiance despite that hemisphere
// being sunlit: its candidate key follows the sphere while legacy keeps the
// shadow on its long exposure.
const dayCraterMu = Math.sin(3.0408 * Math.PI / 180)
assert.equal(key(dayCraterMu, 0), 1, 'day-side crater shadows use the short exposure')
assert.equal(key(dayCraterMu, 0, 1, true), 0, 'legacy keeps low-radiance crater shadows on long exposure')
// A night-side crest with real direct illumination still uses the short
// exposure through the radiance key. Earth eclipse gating continues to force
// the long exposure when the direct solar beam is blocked.
assert.equal(key(-0.01, 4), 1, 'radiance still selects short exposure for a lit night-side crest')
assert.equal(key(-0.01, 4, 0), 0, 'totality still selects long exposure')
console.log('shadow-key.test.mts: ok')
