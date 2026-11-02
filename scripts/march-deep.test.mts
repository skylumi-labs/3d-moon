// The shadow march at depth (review P1-7): the GLSL schedule, not only its CPU twin. The generated shader text is parsed and the
// level formula in it is evaluated, then compared with march.ts for a range of distances and depths.
import assert from 'node:assert/strict'
import { H_TEXEL_KM } from '../src/moon/tiles/grid.ts'
import { MARCH_DEEP_NEAR_N, MARCH_DEEP_NEAR_START_KM, MARCH_LINEAR_STEP_KM, MARCH_MIP, marchDeepNearDistanceKm, marchLevel } from '../src/moon/march.ts'
import { moonCoverFragment, moonFragment } from '../src/moon/moonShader.ts'

/** Evaluates a GLSL expression made of clamp/int/floor/log2/max/min and the named constants. */
function glsl(expr: string, env: Record<string, number>): number {
  const f = new Function(...Object.keys(env), 'clamp', 'int', 'floor', 'log2', 'max', 'min', 'lvScale', 'exp2', `return ${expr.replace(/float\(([^()]*)\)/g, '($1)')}`)
  return f(...Object.values(env), (x: number, a: number, b: number) => Math.min(b, Math.max(a, x)), Math.trunc, Math.floor, Math.log2, Math.max, Math.min,
    (l: number) => (l >= 0 ? 2 ** l : 2 ** l), Math.pow.bind(null, 2)) as number
}
const between = (s: string, a: string, b: string): string => { const i = s.indexOf(a); assert.ok(i >= 0, `missing ${a}`); const j = s.indexOf(b, i + a.length); assert.ok(j > i); return s.slice(i + a.length, j) }

for (const deepest of [-1, -2, -3]) {
  const frag = moonFragment(180, 4096, '', true, null, false, deepest)
  const fragP = moonFragment(180, 4096, '', true, [{ h: true, r: false, fadeM: 10 }], false, deepest)
  assert.ok(frag.includes(`const int TL_MIN = ${deepest};`))
  // marchLevel: the GLSL expression, evaluated, equals the twin at every distance of the schedule (40 linear + 24 geometric + the deep near ones).
  const expr = between(frag, 'int marchLevel(float dKm) {\n  return ', ';\n}')
  const dists = [...Array(MARCH_DEEP_NEAR_N)].map((_, k) => marchDeepNearDistanceKm(k)).concat([...Array(40)].map((_, k) => 0.25 * (k + 1)), [11, 25, 60, 150, 300])
  const levels = new Set<number>()
  for (const d of dists) {
    const g = glsl(expr, { TL_MIN: deepest, TM_MIP: MARCH_MIP, dKm: d, TH_KM: H_TEXEL_KM })
    assert.equal(g, marchLevel(d, H_TEXEL_KM, 3, deepest), `marchLevel(${d} km) at depth ${deepest}`)
    levels.add(g)
  }
  assert.ok(levels.has(deepest) && levels.has(2), `the schedule reaches ${deepest} at the origin and 2 at the horizon (${[...levels]})`)
  // The near samples are in the shader: with and without a patch, constants equal the twin's, and the loop reads the same fused ground.
  for (const [name, g] of [['plain', frag], ['patch', fragP]] as const) {
    assert.ok(g.includes(`const int TM_DNEAR = ${MARCH_DEEP_NEAR_N};`), `${name}: TM_DNEAR`)
    assert.ok(g.includes(`const float TM_DNEAR0 = ${MARCH_DEEP_NEAR_START_KM.toFixed(4)};`), `${name}: TM_DNEAR0`)
    assert.ok(g.includes('d = TM_DNEAR0 * pow(TM_STEP / TM_DNEAR0, float(k) / float(TM_DNEAR))'), `${name}: the geometric schedule of marchDeepNearDistanceKm`)
    assert.ok(g.includes('marchHQ(q, max(lmin0, marchLevel(d)), lodG, 0.0)'), `${name}: reads marchLevel(d) like the linear samples`)
  }
  assert.ok(fragP.includes('} else {\n    for (int k = 0; k < (((uMotion > 0.5 && uMLite > 0.5) || uShMode > 0.5) ? 0 : TM_DNEAR)'), 'with a patch the deep near loop runs where the patch near loop does not')
  assert.ok(MARCH_DEEP_NEAR_START_KM <= 0.0592 * 1.1 && marchDeepNearDistanceKm(MARCH_DEEP_NEAR_N) === MARCH_LINEAR_STEP_KM, 'from one level -3 texel to the first linear step')
  // terrainResolve's level and the horizon's: floor at TL_MIN, evaluated.
  const lmExpr = between(frag, 'int lm = clamp(', ';\n  float lodG').replace(/^/, 'clamp(')
  assert.equal(glsl(lmExpr, { TL_MIN: deepest, TH_KM: H_TEXEL_KM, fpKm: 1e-4 }), deepest, 'a tiny footprint reads the deepest level')
  assert.equal(glsl(lmExpr, { TL_MIN: deepest, TH_KM: H_TEXEL_KM, fpKm: 50 }), 2)
  // Pass 1 and pass 2 are one depth.
  assert.ok(moonCoverFragment(180, 4096, null, deepest).includes(`const int TL_MIN = ${deepest};`))
}
// No deeper level: the twin is what it was, and no deep near loop is compiled.
assert.equal(marchLevel(0.001, H_TEXEL_KM), 0); assert.equal(marchLevel(300, H_TEXEL_KM), 2)
assert.ok(!moonFragment(180, 4096, '', true).includes('TM_DNEAR'))
// The first geometric step is below the first linear one, so the schedule is increasing.
assert.ok(marchDeepNearDistanceKm(0) < marchDeepNearDistanceKm(1) && marchDeepNearDistanceKm(MARCH_DEEP_NEAR_N - 1) < MARCH_LINEAR_STEP_KM)
console.log('march-deep ok')
