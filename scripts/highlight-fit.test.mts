/** The hover highlight's fade as the area fills the frame (src/labels/highlightFit.ts). npx tsx scripts/highlight-fit.test.mts */
import assert from 'node:assert/strict'
import { HIGHLIGHT_WASH_GLSL, HL_FILL, HL_LIFT, HL_RIM, HL_RIM_DARK_PROP, HL_RIM_DARK_WHITE, HL_RIM_MAX_PX, HL_WASH_LUM_FULL, HL_WASH_LUM_ZERO, HL_WASH_WHITE, highlightFit, highlightWash, highlightWashProp } from '../src/labels/highlightFit.ts'
import { moonFragment } from '../src/moon/moonShader.ts'
import { HighlightGate, highlightAnimating } from '../src/labels/highlightMotion.ts'

const R_KM = 1737.4
const TAN = Math.tan(15 * Math.PI / 180)
const id = { moonX: { x: 1, y: 0, z: 0 }, moonY: { x: 0, y: 1, z: 0 }, moonZ: { x: 0, y: 0, z: 1 } }
// The Moon turned a quarter round its axis: Moon-fixed x points along world y.
const turned = { moonX: { x: 0, y: 1, z: 0 }, moonY: { x: -1, y: 0, z: 0 }, moonZ: { x: 0, y: 0, z: 1 } }
const tycho: [number, number, number] = [1, 0, 0]
const r = 42.5 / R_KM

// Far away the whole highlight shows; 100 km above an 85 km crater it is gone.
assert.equal(highlightFit(tycho, r, { x: 3.6, y: 0, z: 0 }, TAN, id), 1, 'home: full')
assert.equal(highlightFit(tycho, r, { x: 1 + 100 / R_KM, y: 0, z: 0 }, TAN, id), 0, 'close: gone')
// The same close view with the Moon turned: the camera above the crater in the WORLD frame. The 2026-10-18 bug compared the
// world camera with the Moon-fixed centre, measured about 1.4 radii, and left the gold wash on (Tycho at 104 km, owner's report).
assert.equal(highlightFit(tycho, r, { x: 0, y: 1 + 100 / R_KM, z: 0 }, TAN, turned), 0, 'close, Moon turned: still gone')
assert.equal(highlightFit(tycho, r, { x: 1 + 100 / R_KM, y: 0, z: 0 }, TAN, turned), 1, 'and a camera over another place is far from it')
// It fades smoothly in between, monotone in distance.
let prev = 0
for (let km = 60; km <= 2000; km += 20) {
  const f = highlightFit(tycho, r, { x: 1 + km / R_KM, y: 0, z: 0 }, TAN, id)
  assert.ok(f >= prev - 1e-12 && f >= 0 && f <= 1, `monotone at ${km} km (${f})`)
  prev = f
}
// A sea keeps its glow at the zooms that show it: Mare Imbrium (about 1,100 km) from 2.2 radii fills the frame's height and stays
// fully lit; from 150 km up, inside the sea, it is gone.
const imbrium = 1100 / 2 / R_KM
assert.equal(highlightFit(tycho, imbrium, { x: 2.2, y: 0, z: 0 }, TAN, id, true), 1, 'a sea at 2.2 R: lit')
assert.ok(highlightFit(tycho, imbrium, { x: 2.2, y: 0, z: 0 }, TAN, id) < 0.05, 'the same size as a disc would be gone')
assert.equal(highlightFit(tycho, imbrium, { x: 1 + 150 / R_KM, y: 0, z: 0 }, TAN, id, true), 0, 'inside the sea: gone')
// Portrait screens use the narrower horizontal half-angle; landscape keeps the vertical half-angle.
const portrait = highlightFit(tycho, r, { x: 1 + 180 / R_KM, y: 0, z: 0 }, TAN, id, false, 390 / 844)
const landscape = highlightFit(tycho, r, { x: 1 + 180 / R_KM, y: 0, z: 0 }, TAN, id, false, 844 / 390)
assert.ok(portrait < landscape, 'portrait fade starts earlier because its horizontal half-angle is narrower')
assert.equal(highlightAnimating('tycho', 'tycho', 1, false), false, 'a settled hover lets the render loop sleep')
assert.equal(highlightAnimating('tycho', 'tycho', 0.6, false), true, 'a highlight fade keeps animating')
assert.equal(highlightAnimating(null, 'tycho', 0.6, false), true, 'a fade out keeps animating')
assert.equal(highlightAnimating('tycho', 'tycho', 1, true), true, 'a sticky highlight keeps its hold timer')
const gate = new HighlightGate()
assert.equal(gate.changed([1, 1, 0, 0, r, -1]), true, 'first uniforms are sent')
assert.equal(gate.changed([1, 1, 0, 0, r, -1]), false, 'resting uniforms do not request a redraw')
assert.equal(gate.changed([0.9, 1, 0, 0, r, -1]), true, 'a changed fade value requests a redraw')

// The wash (owner, 2026-10-23: a hovered Korolev at night was an opaque tan disc). The 2026-10-17 form, for comparison: a fixed share of white.
const legacy = (white: number, fill: number, rim: number, on = 1) => { const ha = Math.max(0, Math.min(1, 0.5 * fill + 0.65 * rim)) * on; return { lift: 1 + 0.25 * ha, add: 0.16 * white * ha, key: ha } }
const WHITE = 0.2
// The final pass's short exposure, toe and sRGB: a day-side pixel's level of 255, so "unchanged" is said in levels.
const level = (groundIF: number, w: { lift: number; add: number }) => { const x = (groundIF * w.lift + w.add) / WHITE; const y = 0.02 + 0.98 * Math.pow(x, 0.9); const l = y * y * (3 - 2 * y) * 0.25 + 0.75 * y; return 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055) }
// Unlit ground (the far side at night: 1e-7 I/F of earthshine, 2e-9 of white): zero interior wash, the pixel left on its long exposure.
const dark = highlightWash(1e-7, WHITE, 1, 0)
assert.equal(dark.add, 0, 'no interior wash on unlit ground')
assert.equal(dark.key, 0, 'an unlit interior is not moved to the short exposure')
assert.equal(dark.lift, legacy(WHITE, 1, 0).lift, 'the lift is the old one (nothing to lift there)')
assert.equal(highlightWash(0, WHITE, 1, 0).add, 0, 'black ground')
assert.equal(highlightWash(HL_WASH_LUM_ZERO * WHITE, WHITE, 1, 0).add, 0, 'and ground at the zero edge')
// The rim alone keeps a thin floor on dark ground: 0.04 of white, with the key moved by the same share.
const rimDark = highlightWash(1e-7, WHITE, 0.5, 1)
assert.ok(Math.abs(rimDark.add / WHITE - HL_RIM_DARK_WHITE) < 1e-12, `rim on black ground is ${HL_RIM_DARK_WHITE} white (${rimDark.add / WHITE})`)
assert.ok(rimDark.key > 0 && rimDark.key < 0.3, 'the rim moves a little to the short exposure')
assert.ok(HL_RIM_DARK_WHITE <= 0.04 && HL_RIM_MAX_PX <= 4, 'thin')
// Lit ground: from HL_WASH_LUM_FULL of white up the wash is the old one exactly, so the day side is unchanged (0 levels, not 2).
for (const lum of [HL_WASH_LUM_FULL, 0.3, 0.5, 0.8, 1]) for (const [fill, rim] of [[1, 0], [0.5, 1], [0.2, 0.6], [1, 1]]) {
  const w = highlightWash(lum * WHITE, WHITE, fill, rim), l = legacy(WHITE, fill, rim)
  assert.ok(Math.abs(w.add - l.add) < 1e-12 && Math.abs(w.lift - l.lift) < 1e-12 && Math.abs(w.key - l.key) < 1e-12, `day side unchanged at ${lum} white, fill ${fill} rim ${rim}`)
  assert.ok(Math.abs(level(lum * WHITE, w) - level(lum * WHITE, l)) < 1e-9, 'identical display level')
}
// Copernicus by day (its floor and walls at 0.3 to 0.9 of white): within 2 levels of the old wash, here 0.
assert.ok(Math.abs(level(0.3 * WHITE, highlightWash(0.3 * WHITE, WHITE, 1, 0)) - level(0.3 * WHITE, legacy(WHITE, 1, 0))) <= 2)
// Between: monotone in the ground's light, never above the old value, and the strength scales everything.
let prevAdd = -1
for (let lum = 0; lum <= 0.2; lum += 0.0025) {
  const w = highlightWash(lum * WHITE, WHITE, 1, 0.3)
  assert.ok(w.add >= prevAdd - 1e-15 && w.add <= legacy(WHITE, 1, 0.3).add + 1e-15, `monotone and bounded at ${lum}`)
  prevAdd = w.add
}
const half = highlightWash(0.5 * WHITE, WHITE, 1, 0, 0.5), full = highlightWash(0.5 * WHITE, WHITE, 1, 0, 1)
assert.ok(Math.abs(half.add - full.add / 2) < 1e-12 && Math.abs(half.key - full.key / 2) < 1e-12, 'the fade scales the wash')
assert.equal(highlightWashProp(HL_WASH_LUM_ZERO), 0); assert.equal(highlightWashProp(HL_WASH_LUM_FULL), 1); assert.equal(highlightWashProp(2), 1)
assert.ok(Math.abs(highlightWashProp((HL_WASH_LUM_ZERO + HL_WASH_LUM_FULL) / 2) - 0.5) < 1e-12, 'linear between')
// The shader carries the twin: the GLSL function, its use on the ground's light before the floor, the constants, the rim cap, and the key by the same share.
const frag = moonFragment(180, 4096)
assert.ok(frag.includes(HIGHLIGHT_WASH_GLSL.trim().split('\n')[1]), 'hlWashProp in the shader')
assert.ok(frag.includes('float hlProp = hlWashProp(groundLum);'), 'both sea and disc washes follow ground radiance')
assert.ok(frag.includes(`float haRad = clamp((hw - hwRim) * hlProp + hwRim * max(hlProp, ${HL_RIM_DARK_PROP.toFixed(4)}), 0.0, 1.0) * uHlOn;`))
assert.ok(frag.includes(`col = col * (1.0 + ${HL_LIFT.toFixed(2)} * ha) + flush16(uHlTint * (${HL_WASH_WHITE.toFixed(2)} * uTopoWhiteIF * haRad) * cover * uPreExpose);`))
assert.ok(frag.includes('sunKey = mix(sunKey, max(sunKey, cover), haRad);'), 'the key follows the radiance-weighted share')
assert.ok(frag.includes(`edge = min(edge, ${HL_RIM_MAX_PX.toFixed(1)} * length(uCamPos - hitPos) * uTileTanPerPx / 1.3);`), 'rim width bounded in output pixels, including its 1.3 smoothstep extent')
// The cap is measured in the canvas grid at rest and during motion. A target-grid scale of 0.5 doubles the old render-pixel cap;
// the canvas-pixel cap remains three pixels across all scales and distances.
for (const gridScale of [1, 0.5, 0.25]) for (const distance of [1.1, 2, 3.6]) {
  const canvasTanPerPx = TAN / 540
  const renderTanPerPx = canvasTanPerPx / gridScale
  const cap = 3 * distance * canvasTanPerPx / 1.3
  const halfWidthPx = cap * 1.3 / (distance * canvasTanPerPx)
  assert.ok(Math.abs(halfWidthPx - 3) < 1e-12, `rim cap is three canvas pixels at grid ${gridScale}, distance ${distance}`)
  assert.ok(renderTanPerPx >= canvasTanPerPx, 'render grid may scale independently of the output cap')
}
assert.ok(frag.includes(`hwRim = ${HL_RIM.toFixed(2)} * (1.0 - smoothstep(0.0, edge * 1.3, abs(hd - hr)));`) && frag.includes(`hw = ${HL_FILL.toFixed(2)} * (1.0 - smoothstep(hr - edge, hr + edge, hd)) + hwRim;`), 'the old shape')
assert.ok(!frag.includes('(0.16 * uTopoWhiteIF * ha)'), 'the fixed share of white is gone')
// ?hlwash=legacy compiles the 2026-10-17 lines for A/B.
Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '?hlwash=legacy' } })
const legacyShader = await import(new URL('../src/moon/moonShader.ts?hlwash-legacy', import.meta.url).href) as typeof import('../src/moon/moonShader.ts')
const legacyFrag = legacyShader.moonFragment(180, 4096)
assert.ok(legacyFrag.includes('col = col * (1.0 + 0.25 * ha) + flush16(uHlTint * (0.16 * uTopoWhiteIF * ha) * cover * uPreExpose);') && legacyFrag.includes('sunKey = mix(sunKey, max(sunKey, cover), ha);'), 'legacy wash')
assert.ok(!legacyFrag.includes('hlWashProp(groundLum)') && !legacyFrag.includes('kmPerPx / R_KM'), 'legacy has no radiance term and no rim cap')
console.log('highlight-fit.test: ok')
