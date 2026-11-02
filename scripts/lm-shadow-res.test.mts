// R46: the lander's shadow resolution follows the startup class, and the Reduced chip prints the size that is allocated.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CLASS_TABLE, type QualityClass } from '../src/quality/startupClass.ts'
import { reducedReasons, type ReducedInput } from '../src/quality/reduced.ts'
import { LM_SHADE_GLSL, LM_SHADOW_RES, lmShadowBytes, lmShadowSize } from '../src/ground/lmShadow.ts'

const classes = Object.keys(CLASS_TABLE) as QualityClass[]
const input = (cls: QualityClass): ReducedInput => ({
  cls, profile: CLASS_TABLE[cls], ceilingBytes: CLASS_TABLE[cls].ceilingBytes, contextLosses: 0, nativeDpr: 2, dprCap: CLASS_TABLE[cls].dprCap, preset: 'balanced',
})

// 1. Every class row is a size the renderer allocates as written (no silent clamp), and the desktop row is today's 2048.
for (const c of classes) assert.equal(lmShadowSize(CLASS_TABLE[c].lmShadowRes), CLASS_TABLE[c].lmShadowRes, `${c}: the class row is the allocated side`)
assert.equal(lmShadowSize(CLASS_TABLE.desktop.lmShadowRes), LM_SHADOW_RES)
assert.equal(lmShadowSize(NaN), LM_SHADOW_RES, 'a bad value falls back to full size')
assert.equal(lmShadowSize(4096), LM_SHADOW_RES, 'never above the full map')

// 2. The chip's number is the allocated side. The chip appears only for a class below 2048 and quotes the class row.
for (const c of classes) {
  const side = lmShadowSize(CLASS_TABLE[c].lmShadowRes)
  const line = reducedReasons(input(c)).find((r) => r.axis === 'shadow')
  if (side < LM_SHADOW_RES) {
    assert.ok(line, `${c}: a smaller map is stated`)
    assert.ok(line.text.startsWith(`The lander's shadow map is ${side} pixels, not ${LM_SHADOW_RES}`), `${c}: chip says ${line.text}`)
  } else assert.equal(line, undefined, `${c}: full size says nothing`)
}
assert.equal(lmShadowSize(CLASS_TABLE['phone-android'].lmShadowRes), 1024)
assert.equal(lmShadowSize(CLASS_TABLE.ios.lmShadowRes), 1024)

// 3. Both GPU maps are sized from the one side, and the ledger estimate follows it (1024: a quarter of 2048).
assert.deepEqual(lmShadowBytes(2048), { target: 2048 * 2048 * 12, sunMap: 2048 * 2048 * 8 })
assert.equal(lmShadowBytes(1024).target * 4, lmShadowBytes(2048).target)
assert.equal(lmShadowBytes(1024).sunMap * 4, lmShadowBytes(2048).sunMap)
const lm = readFileSync(new URL('../src/ground/LunarModule.ts', import.meta.url), 'utf8')
assert.ok(/new THREE\.WebGLRenderTarget\(res, res,/.test(lm) && /new THREE\.DepthTexture\(res, res,/.test(lm), 'depth target uses the class side')
assert.ok(/this\.sun\.shadow\.mapSize\.set\(res, res\)/.test(lm), "the Sun light's map uses the class side")
assert.ok(/lmShadowBytes\(res\)/.test(lm), 'the ledger entries use the class side')
assert.ok(!/\b2048\b/.test(lm.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'no literal 2048 left in LunarModule code')
assert.ok(!/LM_SHADOW_RES, LM_SHADOW_RES/.test(lm), 'the depth target is not allocated at the full size')

// 4. The class reaches the module: main passes the profile to GroundMode, which passes it to load().
assert.ok(/new GroundMode\([^)]*quality\.profile\.lmShadowRes\)/.test(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')), 'main passes the class size')
assert.ok(/LM\.load\([^)]*this\.lmShadowRes[,)]/.test(readFileSync(new URL('../src/ground/GroundMode.ts', import.meta.url), 'utf8')), 'GroundMode passes it to load()')

// 5. The shader scales texel and bias to the bound map, so a 1024 map keeps a two-texel bias and the same penumbra width in metres.
assert.ok(/float lmK = 2048\.0 \* ts\.x;/.test(LM_SHADE_GLSL), 'scale is reference side over bound side')
assert.ok(/LM_BIAS \* lmK/.test(LM_SHADE_GLSL) && /LM_TEXEL_M \* lmK/.test(LM_SHADE_GLSL))
assert.ok(!/- LM_BIAS\)/.test(LM_SHADE_GLSL), 'the raw 2048 bias is not compared against a smaller map')
console.log('lm-shadow-res: ok')
