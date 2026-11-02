// Issue #206: the Earth maps the shader reads one channel of are uploaded as R8 (a quarter of RGBA8), and the ledger counts them that way.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { textureBytes } from '../src/quality/ledger.ts'

const pass = readFileSync(new URL('../src/earth/EarthPass.ts', import.meta.url), 'utf8')
const shader = readFileSync(new URL('../src/earth/earthShader.ts', import.meta.url), 'utf8')

// The set, as written in EarthPass.ts.
const m = pass.match(/EARTH_SINGLE_CHANNEL[^=]*= new Set\(\[([^\]]*)\]\)/)
assert.ok(m, 'EARTH_SINGLE_CHANNEL is a literal set')
const names = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
assert.deepEqual(names.sort(), ['clouds.jpg', 'lights.jpg', 'water.png'])

// Each of them is sampled for .r only in the shader (a second channel read would see 0 from an R8 texture), and the albedo stays RGBA.
const uniformOf: Record<string, string> = { 'clouds.jpg': 'uClouds', 'lights.jpg': 'uLights', 'water.png': 'uWater' }
for (const n of names) {
  const u = uniformOf[n]
  const reads = [...shader.matchAll(new RegExp(String.raw`texture(?:Lod)?\(${u}\b[^;]*?\)(\.\w+)?`, 'g'))]
  assert.ok(reads.length > 0, `${u} is sampled`)
  for (const r of reads) assert.equal(r[1], '.r', `${u} is read through .r only: ${r[0]}`)
}
assert.ok(!names.includes('albedo-01.jpg'))

// Format and ledger follow the set.
assert.match(pass, /if \(EARTH_SINGLE_CHANNEL\.has\(name\)\) \{ t\.format = THREE\.RedFormat; t\.type = THREE\.UnsignedByteType \}/)
assert.match(pass, /trackGpu\('earth', name, earthTextureBytes\(name, img\.width, img\.height\), t\)/)
assert.ok(Math.abs(textureBytes(2048, 1024, 1, { mips: true }) * 4 - textureBytes(2048, 1024, 4, { mips: true })) <= 4, 'an R8 map is a quarter of the RGBA8 one')
console.log('earth-r8: ok')
