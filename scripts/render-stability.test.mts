/**
 * WP4 rendering stability (MOON-UX-REDESIGN 5.1 / 5.2): the motion grid is chosen once per gesture, the refine is a crossfade, the shader carries the
 * penumbra, the wider sub-pixel band, the modelled fill and the 15 degree limb cap, and an anchor pins the exposure.
 *   npm test
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { FIT, MOTION_STEPS, SAMPLES_DOWN, SAMPLES_UP, frameBudgetMs, ladderStep, predictMs, startScale, emergencyStep, EMERGENCY_MS, needsHandBack } from '../src/post/motionGrid.ts'
import { REFINE_CROSSFADE_MS, previousSize } from '../src/post/final.ts'
import { LIMB_CAP_DEG, SHADOW_FILL, SHADOW_FILL_NOTE, moonFragment } from '../src/moon/moonShader.ts'
import { computeExposure } from '../src/post/exposure.ts'
import { ephemerisAt } from '../src/ephemeris.ts'
import { earthViewCamera } from '../src/camera/pose.ts'

// 1. The grid follows the GPU's time against the display's frame budget: down fast, up slowly and inside the budget, never oscillating.
{
  const b60 = frameBudgetMs(60), b120 = frameBudgetMs(120)
  assert.ok(Math.abs(b60 - 16.667) < 0.01 && Math.abs(b120 - 8.333) < 0.01, 'the budget is the refresh interval')
  assert.equal(frameBudgetMs(0), b60, 'unmeasured display: 60 Hz')
  assert.equal(predictMs(10, 0.5, 0.25), 2.5, 'cost follows pixel count')
  // Over budget: down within SAMPLES_DOWN frames, straight to the step predicted to fit.
  assert.equal(ladderStep(60, 0.7, 1, b60), null, 'one frame is not evidence')
  const dn = ladderStep(60, 0.7, SAMPLES_DOWN, b60)
  assert.ok(dn !== null && dn < 0.7 && predictMs(60, 0.7, dn) <= FIT * b60, 'down to a step that fits')
  assert.equal(ladderStep(500, 0.25, 50, b60), null, 'bottom of the table')
  // Under budget: up only after SAMPLES_UP frames and only to a step predicted well inside the budget.
  assert.equal(ladderStep(2, 0.25, SAMPLES_UP - 1, b60), null, 'up needs time')
  assert.equal(ladderStep(2, 0.25, SAMPLES_UP, b60), 0.35)
  assert.equal(ladderStep(2, 0.7, 99, b60), null, 'top of the table')
  // F4: an orbit/tween/eclipse mover never calls markMoved; the falling edge of `moving` still releases the gesture.
  assert.equal(needsHandBack(false, true, false), true, 'gesture on, nothing moving, no refine flag: hand back')
  assert.equal(needsHandBack(true, true, false), false, 'still moving: hold')
  assert.equal(needsHandBack(false, false, false), false, 'idle')
  assert.equal(needsHandBack(false, false, true), true, 'a refine already due')
  assert.ok(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').includes('needsHandBack(moving, gestureOn, needsRefine)'), 'the loop uses the edge')
  // F3: the refine crossfade's previous frame is kept at canvas size, so it starts from the sharpened picture the viewer saw.
  assert.deepEqual(previousSize(720, 450, { w: 1440, h: 900 }), [1440, 900])
  assert.deepEqual(previousSize(1440, 900, { w: 1440, h: 900 }), [1440, 900])
  assert.deepEqual(previousSize(720, 450), [720, 450], 'date transitions keep the frame size')
  // F2: the fence/none path is rAF-only: two-vsync frames (33 ms, 120 Hz quantisation) never leave the grid, only a stall does, and nothing goes up.
  let g = 0.5
  for (let i = 0; i < 200; i++) { const st = emergencyStep(33, g, i); if (st !== null) g = st }
  assert.equal(g, 0.5, 'two-vsync frames do not ratchet the grid')
  assert.equal(emergencyStep(EMERGENCY_MS + 1, 0.5, SAMPLES_DOWN), 0.35, 'a stall steps down one')
  assert.equal(emergencyStep(EMERGENCY_MS + 1, 0.5, 1), null, 'one frame is not evidence')
  assert.equal(emergencyStep(2, 0.25, 99), null, 'never up')
  assert.equal(emergencyStep(500, 0.25, 99), null, 'bottom of the table')
  assert.equal(ladderStep(b60 * 0.6, 0.5, 99, b60), null, 'a step up predicted over the hysteresis share stays put')
  // No oscillation: from any starting step and any steady cost, the ladder settles within the table and stops moving.
  for (const cost1 of [8, 20, 40, 90, 200, 600]) for (const start of MOTION_STEPS) for (const budget of [b60, b120]) {
    let cur = start, moves = 0
    for (let f = 0; f < 400; f++) {
      const nxt = ladderStep(predictMs(cost1, 1, cur), cur, 99, budget)
      if (nxt === null) continue
      assert.ok(MOTION_STEPS.includes(nxt))
      cur = nxt; moves++
    }
    assert.ok(moves <= 4, `settles (cost ${cost1}, start ${start}, ${moves} moves)`)
    const last = ladderStep(predictMs(cost1, 1, cur), cur, 99, budget)
    assert.equal(last, null, 'rests')
  }
  assert.equal(startScale(0, b60, 0.5), 0.5, 'no history: the fallback')
  assert.ok(startScale(30, b60, 0.5) < startScale(10, b60, 0.5), 'a heavier frame starts coarser')
  assert.ok(REFINE_CROSSFADE_MS >= 100 && REFINE_CROSSFADE_MS <= 250, 'the refine is a short crossfade, not a snap and not a slow fade')
}

// External dirties must abandon a partial band, while render-internal dirties
// (e.g. a crossfade asking for its next frame) preserve the current sequence.
{
  const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.ES2022, true)
  const declaration = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'markDirty')
  assert.ok(declaration, 'production markDirty exists')
  const body = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const create = new Function('state', `let { dirty, inRender, fadeOnly, bandState } = state; const idleSleeping = false; const wakeLoop = () => {}; ${body}; return { markDirty, get: () => ({dirty, fadeOnly, bandState}), setRender: (v) => { inRender = v } }`)
  const outside = create({ dirty: false, inRender: false, fadeOnly: { scale: 1 }, bandState: { k: 2 } }) as { markDirty: () => void; get: () => { dirty: boolean; fadeOnly: unknown; bandState: unknown } }
  outside.markDirty()
  assert.deepEqual(outside.get(), { dirty: true, fadeOnly: null, bandState: null }, 'external scene changes restart from band zero and disable final-only reuse')
  const inside = create({ dirty: false, inRender: true, fadeOnly: { scale: 1 }, bandState: { k: 1 } }) as typeof outside & { setRender: (v: boolean) => void }
  inside.markDirty()
  assert.equal(inside.get().dirty, true)
  assert.deepEqual(inside.get().bandState, { k: 1 }, 'render-internal continuation retains its current band')
  assert.deepEqual(inside.get().fadeOnly, { scale: 1 }, 'render-internal crossfade can continue reusing its scene')

  const advanceDecl = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'completeBand')
  assert.ok(advanceDecl, 'production completeBand exists')
  const advanceBody = ts.transpileModule(advanceDecl.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const advance = new Function('state', `let { dirty, bandState } = state; ${advanceBody}; return { completeBand, getBand: () => bandState, selectBand: () => bandState, isDirty: () => dirty, clearDirty: () => { dirty = false } }`)
  const initialBand = { k: 0, n: 3, scale: 1, cw: 10, ch: 10, exposure: null, tilesBusy: false }
  const loop = advance({ dirty: false, bandState: initialBand }) as {
    completeBand: (band: typeof initialBand) => boolean; getBand: () => typeof initialBand | null
    selectBand: () => typeof initialBand | null; isDirty: () => boolean; clearDirty: () => void
  }
  for (let k = 0; k < initialBand.n; k++) {
    const band = loop.selectBand()
    assert.equal(band?.k, k, `continuation selects band ${k}`)
    loop.clearDirty() // the selected band is now drawn
    const continues = loop.completeBand(band!)
    assert.equal(continues, k < initialBand.n - 1)
    if (continues) {
      assert.equal(loop.isDirty(), true, 'the next band is scheduled without external invalidation')
      assert.equal(loop.getBand(), initialBand, 'partial rows remain available for continuation')
    } else assert.equal(loop.getBand(), null, 'completed band sequence is released')
  }
  assert.match(source, /else if \(bandState\) \{\s*\/\/ A budgeted frame in progress:[^\n]*\n\s*scale = bandState\.scale\s*\}/, 'continuation selection does not call external markDirty')
  assert.match(source, /if \(band\) completeBand\(band\)/, 'each rendered band advances through production completion logic')
}

// 2. main.ts reads the GPU timer for the ladder, and a gesture's grid is re-chosen only through the ladder (no every-N-frames re-choice).
{
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.ok(!/frameCount\s*\+\+\s*%\s*12/.test(src) && !/\+\+frameCount\s*%\s*12/.test(src), 'no re-choice every 12 frames')
  assert.ok(src.includes('ladderStep(gpuTimer.smoothed, motionScale'), 'the ladder steps from the timed frame cost')
  assert.ok(src.includes("gpuTimer.source === 'query' && gpuTimer.fresh > 0") && src.includes('emergencyStep(rafMs'), 'only the timer query feeds the ladder; rAF is the emergency brake')
  assert.ok(src.includes('beginDateTransition(renderer, targets.get(pendingFade.w, pendingFade.h), last!.exposure, now, REFINE_CROSSFADE_MS, { w: pendingFade.cw, h: pendingFade.ch })'), 'the refine crossfades from the last motion frame')
}

// 3. The shader: the modelled fill, the 15 degree cap, the penumbra from the texel, and a band that grows with the view.
{
  assert.equal(SHADOW_FILL, 0.03)
  assert.ok(/3 %/.test(SHADOW_FILL_NOTE) && /modelled/.test(SHADOW_FILL_NOTE))
  assert.equal(LIMB_CAP_DEG, 15)
  for (const [tiles, patch] of [[false, null], [true, null]] as const) {
    const fs = moonFragment(360, 4096, '', tiles, patch)
    const legacy = moonFragment(360, 4096, '', tiles, patch, false, 0, false, 'legacy')
    assert.ok(fs.includes('const float SHADOW_FILL = 0.030;'), 'fill constant reaches the shader')
    assert.ok(fs.includes('max(dot(p, uS), 0.0) * SHADOW_FILL * fillRamp * (1.0 - lit)'), 'shadow is lit by the fill, keyed on the sphere elevation and faded with the exposure key, not black')
    assert.ok(fs.includes('smoothstep(15.0, 0.0, elevV)'), 'limb cap band is 15 degrees')
    assert.ok(!fs.includes('smoothstep(8.0, 0.0, elevV)'), 'the 8 degree step is gone')
    assert.ok(fs.includes('float penumbraDeg'), 'texel penumbra')
    assert.ok(fs.includes('abs(elevS) < bandDeg'), 'sub-pixel band is a function of the view')
    assert.ok(!fs.includes('abs(elevS) < 2.0'), 'the fixed 2 degree band is gone')
    assert.ok(fs.includes('shadowMargin[k] = es - hzs;'), 'the production margin mode captures signed sample margins')
    assert.ok(fs.includes('smoothstep(vec4(-wSun), vec4(wSun), shadowMargin)'), 'the production margin mode applies the penumbra to all lanes')
    assert.ok(fs.includes('fwidth(shadowMargin)'), 'the production margin derivative is evaluated after the varying branch')
    assert.ok(legacy.includes('smoothstep(-wSun, wSun, es - hzs)'), 'the explicit legacy mode retains the sub-pixel penumbra')
  }
}

// 4. An anchor of weight 1 pins the white: two different frames of the same Moon at the same time get the same white (subject-locked exposure).
{
  const e = ephemerisAt(new Date('2026-10-10T12:00:00Z'))
  const cam = earthViewCamera(e, 1.6)
  const base = { cam, aspect: 1.6, canvasHeight: 900, ephem: e, albedo: null, lonSpan: 360, preExposeOn: true } as const
  const free = computeExposure({ ...base })
  const pinned = computeExposure({ ...base, anchor: { white: 0.2, weight: 1 } })
  assert.ok(free.search.hits > 0)
  assert.ok(Math.abs(Math.log2(pinned.white / 0.2)) < 1e-9, 'the anchor sets the white')
  // The cap: an anchor far above the frame's own white is held to capStops above it.
  const capped = computeExposure({ ...base, anchor: { white: 0.2, weight: 1, capStops: 1.6 } })
  assert.ok(Math.abs(Math.log2(capped.white / free.white) - 1.6) < 1e-9, 'a thin frame is not left more than capStops dark')
  // The mirror: an anchor far below the frame's own white is held to floorStops below it (the lock must not clip a frame that has moved on).
  const floored = computeExposure({ ...base, anchor: { white: free.white / 64, weight: 1, floorStops: 1 } })
  assert.ok(Math.abs(Math.log2(floored.white / free.white) + 1) < 1e-9, 'a frame is not left more than floorStops bright')
  assert.ok(Math.abs(free.frameBrightest * (free.white / free.frameBrightest) - free.white) < 1e-12 && free.frameBrightest > 0, 'the frame search value is reported')
  assert.ok(Math.abs(capped.frameBrightest - free.frameBrightest) < 1e-12, 'frameBrightest is the value before any anchor')
  const loose = computeExposure({ ...base, anchor: { white: free.white * 1.2, weight: 1, capStops: 1.6 } })
  assert.ok(Math.abs(loose.white / (free.white * 1.2) - 1) < 1e-9, 'within the cap the lock holds')
}
console.log('render-stability.test.mts: ok')
