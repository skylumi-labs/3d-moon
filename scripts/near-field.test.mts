// ?near=photo (src/ground/nearField.ts): the modelled near-field ground is a compile-time switch of the ground shader. Off, the shader text is the
// frozen default (ground-shader-default.test.mts pins it); on, the near-field GLSL is in the hit, shadow and shade paths and nothing else is added.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { groundFragment, gstepsOf } from '../src/ground/groundShader.ts'
import { LOOK_LABEL, NEAR_LABEL, NEAR_LABEL_DIRECT, NEAR_SWITCHES, NF_GSTEPS, NF_PATHS, NF_ROVER_ARCS, NF_TR0, NF_FLAG_AT, NF_PARK_AT, NEAR_TRACKS, parseBake, parseLook, parseNear, parseTracks } from '../src/ground/nearField.ts'

// Owner decision 2026-10-18: the baked near field is ON by default; near=off is the old ground, and turns every sub-switch off.
assert.equal(parseNear(''), 'photo'); assert.equal(parseNear('?near=photo'), 'photo'); assert.equal(parseNear('?near=off'), 'off')
assert.equal(parseNear('?near=1'), 'photo', 'only near=off turns it off')
assert.equal(parseTracks(''), true, 'trampled ground is on by default (baked)'); assert.equal(parseTracks('?tracks=0'), false)
assert.equal(parseTracks('?near=off'), false, 'tracks is a sub-switch of the near field'); assert.equal(parseTracks('?near=off&tracks=1'), false)
// Baked the trampled ground is on unless tracks=0; the direct path (bake=0) keeps the old opt-in.
assert.equal(parseTracks('?bake=0'), false); assert.equal(parseTracks('?bake=0&tracks=1'), true)
assert.equal(parseBake(''), true); assert.equal(parseBake('?bake=0'), false); assert.equal(parseBake('?near=off'), false, 'bake is a sub-switch of the near field')
assert.equal(parseLook(''), true); assert.equal(parseLook('?nearlook=0'), false); assert.equal(parseLook('?near=off'), false, 'nearlook is a sub-switch of the near field')
for (const k of ['near', 'bake', 'tracks', 'nearlook']) assert.ok(NEAR_SWITCHES.some((x) => x.key === k), `${k} is listed`)
assert.match(NEAR_LABEL_DIRECT, /300 m/); assert.match(NEAR_LABEL, /60 m/); assert.match(LOOK_LABEL, /not a measurement/)
assert.ok(NEAR_SWITCHES.some((s) => s.key === 'near' && s.default === 'photo'))
assert.match(NEAR_LABEL, /modelled/i)
assert.match(NEAR_LABEL, /not photographed or measured/i)

// The march budget: an absent ?gsteps is 0 in a browser (Number(null)) and NaN in Node; both must give the default, never the 8-step floor.
assert.equal(gstepsOf(0, false), 384); assert.equal(gstepsOf(NaN, false), 384); assert.equal(gstepsOf(0, true), NF_GSTEPS); assert.equal(gstepsOf(NaN, true), NF_GSTEPS)
assert.equal(gstepsOf(100, false), 100); assert.equal(gstepsOf(9999, false), 384); assert.equal(gstepsOf(9999, true), NF_GSTEPS); assert.equal(gstepsOf(2, true), 8)
const layout = [{ h: true, r: true, fadeM: 40, shade: true }]
const gold = JSON.parse(fs.readFileSync(new URL('./fixtures/ground-shader-default.json', import.meta.url), 'utf8')) as Record<string, string>
for (const k of ['cover', 'shade', 'probe', 'metadata'] as const) {
  assert.equal(groundFragment(k, 180, 4096, layout, false), gold[k], `${k}: off is the frozen default`)
  const on = groundFragment(k, 180, 4096, layout, true, false, false)
  assert.notEqual(on, gold[k])
  assert.ok(on.includes('float nfDetail('), `${k}: the near-field GLSL is declared`)
  assert.ok(on.includes('float terrainZBase('), `${k}: the measured ground keeps its own function`)
  assert.ok(on.includes('nfStep(c, d.z, tb)'), `${k}: the hit march steps by the near-field rule`)
  assert.ok(on.includes(`i < ${NF_GSTEPS}`), `${k}: the larger march budget`)
  assert.ok(on.includes('(k < 60 ? 1.1 : 1.2)'), `${k}: the finer Sun-visibility march`)
}
const shade = groundFragment('shade', 180, 4096, layout, true, false, false)
assert.ok(shade.includes('nfSurge(phase)') && shade.includes('nfAlbedo(P.xy') && shade.includes('nfRock(P.xy'), 'shade: surge, grain and rocks')
assert.ok(shade.includes('float nfSeg(') === NEAR_TRACKS, 'direct path: the old tracks GLSL is in only with tracks')
const probe = groundFragment('probe', 180, 4096, layout, true, false, false)
assert.ok(probe.includes('float h = terrainH(en, 0.0);'), 'probe: the module is placed on the measured ground')
console.log('near-field ok')

// The rock classes follow one cumulative power law, N(>D) proportional to D^-2.5, from 7 mm to 1.6 m (Surveyor-era sub-metre slopes); the top class is truncated at 1.6 m, so it steepens just below.
{
  const { rocksPerM2Above, NF_ROCKS } = await import('../src/ground/nearField.ts')
  for (const [a, b] of [[0.01, 0.03], [0.03, 0.1], [0.1, 0.3], [0.2, 0.6]]) {
    const slope = Math.log(rocksPerM2Above(b) / rocksPerM2Above(a)) / Math.log(b / a)
    assert.ok(slope < -2.3 && slope > -2.7, `rock SFD slope ${slope.toFixed(2)} between ${a} and ${b} m`)
  }
  // Each class spans a factor of three and the next starts where it ends, so there is no gap or overlap in sizes.
  for (let i = 1; i < NF_ROCKS.length; i++) assert.ok(Math.abs(NF_ROCKS[i][0] / NF_ROCKS[i - 1][0] - 3) < 0.05)
  // A rock's footprint (2.8 radii) fits its grid cell, so no rock is cut by a cell edge.
  for (const [dmin, cell] of NF_ROCKS) assert.ok(2.8 * 1.5 * dmin < cell, `rock class ${dmin} fits its cell`)
  assert.ok(rocksPerM2Above(1.0) < 0.002, 'metre-size blocks stay rare (under one per 500 m^2)')
}

// ---- The baked path (nearBake.ts): the shader text, the levels, the re-bake rule, the GPU object.
{
  const { NB_BYTES_PER_TEXEL, NB_EXTENT_M, NB_LEVELS, NB_REBAKE_FRAC, NB_RES, finestLevel, levelOrigin, levelWeights, levelsToBake, nearBakeBytes, nearBakeFragment, needsRebake, snapCentre, texelM } = await import('../src/ground/nearBake.ts')
  // The ground shader, baked: a texel fetch where the direct path evaluates the procedural field, and none of the procedural field compiled in.
  for (const k of ['cover', 'shade', 'probe', 'metadata'] as const) {
    const b = groundFragment(k, 180, 4096, layout, true, true, true)
    assert.ok(b.includes('uniform highp sampler2DArray uNfTex;') && b.includes('vec2 nfFetch(vec2 p, float fp)'), `${k}: the baked sampler`)
    assert.ok(b.includes('terrainZBase(en, fpM) + nfFetch(en, fpM).x'), `${k}: the measured ground plus the baked height`)
    for (const dead of ['float nfDetail(', 'float nfRocks(', 'float nfCraters(', 'float nfRelief(', 'float nfW(']) assert.ok(!b.includes(dead), `${k}: ${dead} is not compiled into the baked ground shader`)
    assert.ok(b.includes('nfStep(c, d.z, tb)') && b.includes(`i < ${NF_GSTEPS}`), `${k}: the near-field step and budget stay`)
    assert.ok(b.includes('(k < 45 ? 1.12 : (k < 75 ? 1.1 : 1.2))') && b.includes('if (best < -SUN_RAD) break;'), `${k}: the Sun march starts at a centimetre and stops once the Sun is fully hidden`)
    assert.notEqual(b, groundFragment(k, 180, 4096, layout, true, false, false), `${k}: baked differs from direct`)
    assert.equal(groundFragment(k, 180, 4096, layout, false, true, true), gold[k], `${k}: near off ignores bake and look: the frozen default`)
  }
  const bs = groundFragment('shade', 180, 4096, layout, true, true, true)
  assert.ok(bs.includes('nfBump(P.xy, fpM)') && bs.includes('nfGrainFine(P.xy, fpM)') && bs.includes('nfSurge(phase)'), 'shade: sub-texel bump and grain, the surge')
  assert.ok(bs.includes('lookW') && bs.includes('pow(clamp(rr'), 'shade: the film look')
  const nl = groundFragment('shade', 180, 4096, layout, true, true, false)
  assert.ok(!nl.includes('lookW') && !nl.includes('pow(clamp(rr'), 'nearlook=0: no look code')
  const dir = groundFragment('shade', 180, 4096, layout, true, false, false)
  assert.ok(dir.includes('float nfDetail(') && !dir.includes('nfFetch'), 'bake=0: the direct path, no sampler')

  // The bake pass text: nfBake per texel; tracks on adds the trampled ground, off leaves a stub-free text.
  const bt = nearBakeFragment(true), bn = nearBakeFragment(false)
  assert.ok(bt.includes('void nfBake(') && bt.includes('uBakeO') && bt.includes('float nfTrample(') && bt.includes('float nfWheels('), 'bake: with the trampled ground')
  assert.ok(bn.includes('void nfBake(') && !bn.includes('nfTrample(p, fp'), 'bake: tracks=0 has no trampled ground')
  // Round 2: prints and tracks are height with a tread, tracks have lighter churned edges; the soil has creased clods; the 5 to 50 cm rocks are denser.
  assert.ok(bt.includes('(q.x + 0.35 * abs(q.y)) / 0.03') && bt.includes('vec2(0.165, 0.07)'), 'bake: a 33 x 14 cm boot sole with chevron bars 3 cm apart')
  assert.ok(bt.includes('(along + 0.6 * dw) / 0.045') && bt.includes('nfLight = max(nfLight, edge)') && bt.includes('(1.0 + 0.14 * nfLight * wT)'), 'bake: chevron wheel tread 4.5 cm apart, lighter churned edges')
  assert.ok(bt.includes('mix(n, 1.0 - 2.0 * abs(n), 0.5)') && !groundFragment('shade', 180, 4096, layout, true, false, false).includes('1.0 - 2.0 * abs(n)'), 'bake: creased clods; the direct path keeps its relief')
  const { rocksPerM2Above: rocks } = await import('../src/ground/nearField.ts')
  assert.ok(rocks(0.1) > 0.2 && rocks(0.1) < 0.3 && rocks(0.05) > 1, 'round 2 rock density: about 0.24 per m^2 above 10 cm (an estimate)')
  assert.ok(bt.includes('nfCraterAt(p, c0 + vec2(float(i), float(j))'), 'bake: craters overlap their cell (3 x 3 search)')
  assert.ok(!groundFragment('shade', 180, 4096, layout, true, false, false).includes('c0 + vec2(float(i), float(j))'), 'direct: one crater per cell as before')

  // Levels: a factor of four apart, 1024 texels, 12 MiB of RG16F; the first metres at under a centimetre.
  assert.equal(NB_LEVELS, 3); assert.equal(NB_RES, 1024)
  assert.deepEqual([...NB_EXTENT_M], [8, 32, 128])
  for (let l = 1; l < NB_LEVELS; l++) assert.equal(NB_EXTENT_M[l] / NB_EXTENT_M[l - 1], 4)
  assert.ok(Math.abs(texelM(0) - 0.0078125) < 1e-9 && Math.abs(texelM(1) - 0.03125) < 1e-9 && Math.abs(texelM(2) - 0.125) < 1e-9, 'texel sizes 0.78, 3.1 and 12.5 cm')
  assert.equal(NB_BYTES_PER_TEXEL, 4)
  assert.equal(nearBakeBytes(), 3 * 1024 * 1024 * 4); assert.ok(nearBakeBytes() <= 16 * 1024 * 1024, 'the bake fits 16 MiB')
  // A centre sits on its level's texel lattice, so a re-centred level reproduces the old values (the shift is a whole number of texels).
  for (let l = 0; l < NB_LEVELS; l++) {
    const a = snapCentre(3.3137, l), b = snapCentre(-17.912, l)
    const [oa] = levelOrigin(a, 0, l), [ob] = levelOrigin(b, 0, l)
    const shift = (ob - oa) / texelM(l)
    assert.ok(Math.abs(shift - Math.round(shift)) < 1e-6, `level ${l}: re-centring moves a whole number of texels`)
    assert.ok(Math.abs(a - 3.3137) <= texelM(l) / 2 + 1e-12, `level ${l}: the centre is within half a texel of the camera`)
  }
  assert.deepEqual(levelOrigin(0, 0, 0), [-4, -4]); assert.deepEqual(levelOrigin(10, -4, 1), [-6, -20])

  // The re-bake rule: never drawn, or the camera more than a third of the level's width from its centre on either axis.
  assert.equal(NB_REBAKE_FRAC, 1 / 3)
  const at0 = { cx: 0, cy: 0, valid: true }
  assert.equal(needsRebake({ cx: 0, cy: 0, valid: false }, 0, 0, 0), true)
  assert.equal(needsRebake(at0, 2.6, 0, 0), false); assert.equal(needsRebake(at0, 2.7, 0, 0), true, 'the inner level: 2.67 m = a third of 8 m')
  assert.equal(needsRebake(at0, 0, -2.7, 0), true); assert.equal(needsRebake(at0, -2.6, 2.6, 0), false)
  assert.equal(needsRebake(at0, 10.6, 0, 1), false); assert.equal(needsRebake(at0, 10.7, 0, 1), true, 'the middle level: 10.67 m')
  assert.equal(needsRebake(at0, 42.6, 0, 2), false); assert.equal(needsRebake(at0, 42.7, 0, 2), true, 'the outer level: 42.67 m')
  // First frame: every level at once. Afterwards: one level per frame, the finest first.
  const fresh = Array.from({ length: NB_LEVELS }, () => ({ cx: 0, cy: 0, valid: false }))
  assert.deepEqual(levelsToBake(fresh, 0, 0), [0, 1, 2])
  const drawn = Array.from({ length: NB_LEVELS }, () => ({ cx: 0, cy: 0, valid: true }))
  assert.deepEqual(levelsToBake(drawn, 1, 1), [], 'a camera that stays put draws nothing')
  assert.deepEqual(levelsToBake(drawn, 5, 0), [0], 'a 5 m walk redraws the inner level only')
  assert.deepEqual(levelsToBake(drawn, 70, 0), [0], 'three levels due: one per frame, the finest first')
  drawn[0].cx = 70
  assert.deepEqual(levelsToBake(drawn, 70, 0), [1], 'then the next')

  // The level choice: the finest level that holds the point and is not too fine for the pixel (the shader's nfFetch).
  const L = [{ cx: 0, cy: 0, valid: true }, { cx: 0, cy: 0, valid: true }, { cx: 0, cy: 0, valid: true }]
  assert.equal(finestLevel(1, 1, 0.003, L), 0, 'the first metres: the inner level')
  assert.equal(finestLevel(1, 1, 0.01, L), 0)
  assert.equal(finestLevel(1, 1, 0.06, L), 1, 'a 6 cm footprint is eight texels of the inner level: the middle one')
  assert.equal(finestLevel(1, 1, 0.3, L), 2, 'a 30 cm footprint: the outer one')
  assert.equal(finestLevel(10, 0, 0.003, L), 1, 'outside the inner level (beyond 4 m): the middle one')
  assert.equal(finestLevel(30, 0, 0.003, L), 2); assert.equal(finestLevel(70, 0, 0.003, L), -1, 'beyond the outermost level: the measured ground alone')
  assert.deepEqual(levelWeights(0, 0, 0.003, [{ cx: 0, cy: 0, valid: false }, { cx: 0, cy: 0, valid: false }, { cx: 0, cy: 0, valid: false }]), [0, 0, 0], 'undrawn levels carry nothing')
  // Weights fall off smoothly across a level's border and as the footprint passes two texels of it.
  let prev = 2
  for (let e = 0; e <= 4; e += 0.1) { const w = levelWeights(e, 0, 0.001, L)[0]; assert.ok(w <= prev + 1e-12 && w >= 0 && w <= 1, 'inner level weight is monotone toward its border'); prev = w }
  assert.equal(levelWeights(3.1, 0, 0.001, L)[0], 1, 'full to 80 % of the half width'); assert.equal(levelWeights(3.9, 0, 0.001, L)[0], 0, 'gone at 97 %')
  prev = 2
  for (let fp = 0.001; fp < 0.1; fp *= 1.1) { const w = levelWeights(0, 0, fp, L)[0]; assert.ok(w <= prev + 1e-12); prev = w }
  assert.equal(levelWeights(0, 0, 2 * texelM(0), L)[0], 1); assert.equal(levelWeights(0, 0, 4 * texelM(0), L)[0], 0)
  assert.ok(levelWeights(0, 0, 100, L)[2] > 0.99, 'the coarsest level is never faded by the footprint')

  // The modelled places: nothing inside the pads' radius, all within the outer level.
  const pts = [...NF_PATHS.flat(), ...NF_ROVER_ARCS.flat(), NF_FLAG_AT, NF_PARK_AT]
  assert.ok(Math.abs(Math.hypot(...NF_PARK_AT) - 158) < 1 && Math.abs(Math.atan2(NF_PARK_AT[0], NF_PARK_AT[1]) * 180 / Math.PI - 94) < 0.5, 'the parking place is the ALSJ estimate: 158 m at 94 deg')
  for (const [e, n] of pts) assert.ok(Math.hypot(e, n) >= NF_TR0, `(${e}, ${n}) is outside the module's footprint`)
  for (const [e, n] of [...NF_PATHS.flat(), NF_FLAG_AT]) assert.ok(Math.hypot(e, n) < 32, 'routes stay inside the middle level')
  for (const arc of NF_ROVER_ARCS) for (let i = 1; i < arc.length; i++) assert.ok(Math.hypot(arc[i][0] - arc[i - 1][0], arc[i][1] - arc[i - 1][1]) > 5, 'wheel-track segments are long (no mitre gaps)')
}

// ---- NearBakePass with a recording renderer: what is drawn, where, and that it hands the target back and frees on leaving.
{
  const { NearBakePass } = await import('../src/ground/NearBakePass.ts')
  const calls: string[] = []
  let target: unknown = 'scene'
  const renderer = {
    getRenderTarget: () => target, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    setRenderTarget: (t: unknown, face?: number) => { target = t; calls.push(t === 'scene' ? 'restore' : `target:${face}`) },
    render: () => { calls.push('render') },
    compileAsync: async () => undefined,
  }
  const { ledger } = await import('../src/quality/ledger.ts')
  const bake = new NearBakePass()
  await bake.warm(renderer as never)
  // The warm-up binds the shared 1x1 compile-key target only while it queues the programs (net/compileTarget.ts) and hands the old one back.
  assert.equal(target, 'scene')
  calls.length = 0
  assert.equal(bake.uniforms.uNfTex.value, null, 'a warm-up allocates no target: nothing is held until ground mode draws')
  assert.equal(bake.draws, 0)
  assert.equal(bake.update(renderer as never, 0.2, 0.1), 3, 'the first update draws all three levels')
  assert.equal(ledger.byCategory().patch, 3 * 1024 * 1024 * 4, 'the target is ledgered at 12 MiB')
  assert.deepEqual(calls, ['target:0', 'render', 'target:1', 'render', 'target:2', 'render', 'restore'], 'one render per level into its layer, then the old target is back')
  assert.equal(target, 'scene')
  const c = bake.uniforms.uNfC.value
  for (let l = 0; l < 3; l++) assert.ok(c[l].z > 0 && Math.abs(c[l].w - [0.0078125, 0.03125, 0.125][l]) < 1e-9, `level ${l} uniform set`)
  assert.ok(Math.abs(c[0].x - (-4 + 0.2)) < 0.01, 'the inner corner follows the camera (snapped to a texel)')
  assert.equal(bake.update(renderer as never, 1.5, -2), 0, 'a short move redraws nothing')
  assert.equal(bake.update(renderer as never, 6, 0), 1, 'a 6 m walk redraws the inner level')
  assert.equal(bake.draws, 4)
  bake.invalidate()
  assert.ok(c.every((v) => v.z === 0), 'a lost context marks the levels undrawn')
  assert.equal(bake.update(renderer as never, 6, 0), 3)
  bake.release()
  assert.equal(bake.uniforms.uNfTex.value, null); assert.ok(c.every((v) => v.z === 0)); assert.equal(bake.draws, 0)
  assert.equal(ledger.byCategory().patch, 0, 'release frees the ledger entry')
  assert.equal(bake.update(renderer as never, 0, 0), 3, 'entering ground mode again draws them again')
  bake.dispose()
}
console.log('near-field bake ok')

// The default (no arguments, the page's own query: none in Node) is the near field, baked, with the look: its text equals the explicit near-on text, and near off is the frozen fixture.
for (const k of ['cover', 'shade', 'probe', 'metadata'] as const) {
  assert.equal(groundFragment(k, 180, 4096, layout), groundFragment(k, 180, 4096, layout, true, true, true), `${k}: the default is the baked near field`)
  assert.notEqual(groundFragment(k, 180, 4096, layout), gold[k], `${k}: the default is no longer the frozen text`)
}
