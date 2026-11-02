// The ground shader with ?hit=mm: the descent block is there, falls back to the fixed march when its budget runs out (R4 review S2), and has no backtick or '//' comment
// problems for the GLSL compiler. (Executing the GLSL needs a GPU: the rig's rest-frame A/B covers that.)
;(globalThis as { location?: unknown }).location = { search: '?hit=mm' }
const { groundFragment } = await import('../src/ground/groundShader.ts')
const src = groundFragment('cover', 180, 4096, [{ h: true, r: true, fadeM: 400 }], false)
const loops = src.match(/for \(int i = 0; i < 384; i\+\+\)/g)?.length ?? 0
if (loops !== 2) throw new Error(`expected the fixed march twice (fallback and else branch), found ${loops}`)
if (!/if \(!hit && t < G_MAXT\) \{\s*tb = ta;/.test(src)) throw new Error('the descent has no fixed-march fallback when its budget runs out')
if (src.includes('`')) throw new Error('a backtick reached the GLSL')
console.log('ground-shader-mm: ok')
