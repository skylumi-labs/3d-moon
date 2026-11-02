/**
 * The HUD line budget: three lines in every mode, and every label that used to be printed is still reachable.
 *   tsx scripts/hud.test.mts
 */
import assert from 'node:assert/strict'
import { HUD_MAX_LINES, planHud, visibilityFloorNote, type HudInfo } from '../src/hud.ts'

// The DOM is not needed: planHud and its helpers are pure.
const exposure = {
  search: { sunlitFraction: 0.4, esMax: 0.05, hits: 500, samples: 900, eclipseLevel: 0 },
  hdr: 1, esLevel: 1, esLevelView: 1,
} as unknown as HudInfo['exposure']
const base: HudInfo = {
  mode: 'fly', date: new Date('2026-10-20T19:00:00Z'), distKm: 5000, under: { lon: -20, lat: 9 }, phaseFromCameraDeg: 70, illuminatedFraction: 0.4,
  libration: { lon: 1, lat: -2 }, earthshine: 4e-5, shadow: 'none', exposure, resolution: { pxKm: 0.3, heightKm: 0.474, colourKm: 0.4 }, groundKm: 0, patchLine: null,
}
const ground: NonNullable<HudInfo['ground']> = { presetName: 'Follow', walking: false, aglM: 12, origin: true, fillInView: true, lm: null, rangeM: 30 }
const flight = {
  get: '110:00:00', utc: '19:00:00', t: 0, rate: 1, paused: false, regime: 'orbit', cam: 'chase', altM: 5000, altProv: 'V', altBandM: 50, vHorizMs: 100, vHorizProv: 'R', vHorizBandMs: 5,
  vRateMs: -10, vRateProv: 'R', engine: 'on', attKnown: true, psiDeg: 10, attProv: 'R', attBandDeg: 2, dust: 0, sunElDeg: 10, sunAzDeg: 90, origin: true, plume: false, blending: false, coasting: false,
} as unknown as NonNullable<HudInfo['flight']>

const cases: Array<[string, HudInfo]> = [
  ['earth', { ...base, mode: 'earth' }],
  ['fly', base],
  ['fly far', { ...base, distKm: 40000 }],
  ['ground', { ...base, ground, archive: true }],
  ['ground origin off', { ...base, ground: { ...ground, origin: false }, archive: true }],
  ['flight', { ...base, flight }],
  ['flight origin off', { ...base, flight: { ...flight, origin: false } }],
]
for (const narrow of [false, true]) for (const [name, info] of cases) {
  const p = planHud(info, narrow)
  assert.ok(p.lines.length <= HUD_MAX_LINES, `${name}: ${p.lines.length} lines`)
  // An ordinary view of the Moon has one caption title and no text block; ground mode and the flight keep their readout lines.
  if (info.ground || info.flight) { assert.ok(p.lines.length >= 2, `${name}: title and status`); assert.equal(p.caption, null, `${name}: no caption`) }
  else { assert.equal(p.lines.length, 0, `${name}: the caption replaces the text block`); assert.equal(p.caption, null, `${name}: no state caption (the "The Moon on ..." line is gone)`) }
}

// A visitor's ground view has no text block: the three lines are behind the i button; ?archive=1 keeps them on screen.
{
  const v = planHud({ ...base, ground }, false)
  assert.equal(v.lines.length, 0, 'visitor: no HUD text on the ground')
  assert.ok(v.notes.some((n) => /On the ground at Apollo 17/.test(n)) && v.notes.some((n) => /above the ground/.test(n)), 'visitor: the three lines are in the notes')
  assert.ok(planHud({ ...base, ground, archive: true }, false).lines.length >= 2, 'archive: the lines stay on screen')
}
// Labels are moved, not dropped: the exposure and the origin lines are in the notes.
{
  const p = planHud({ ...base, mode: 'earth' }, false)
  assert.ok(p.notes.some((n) => /modelled/.test(n)), 'earth: the modelled earthlight label is in the notes')
  assert.ok(p.notes.some((n) => /Libration/.test(n)), 'earth: libration is in the notes')
  const g = planHud({ ...base, ground }, false)
  assert.ok(g.notes.some((n) => /LROC photograph/.test(n)), 'ground: origin lines are in the notes')
  assert.equal(g.openNotes, true, 'the Origin toggle opens the notes')
  assert.equal(planHud({ ...base, ground: { ...ground, origin: false } }, false).openNotes, false)
  assert.ok(planHud({ ...base, flight }, false).notes.some((n) => /generic lunar module/.test(n)), 'flight: model note in the notes')
}
// No always-visible controls hint or home caption; the camera details remain available to the retained notes hook.
{
  for (const live of [true, false]) assert.equal(planHud({ ...base, live, waxing: true }, false).caption, null, 'no home caption')
  assert.equal(planHud({ ...base, hint: true }, true).caption, null)
  assert.equal(planHud({ ...base, hint: true }, false).caption, null)
  // Where the camera is stays reachable, behind the i.
  assert.ok(planHud(base, false).notes.some((n) => /km from the centre/.test(n)), 'the camera line moved into the notes')
}
// The i panel names the night-side visibility floor, honestly: a look choice, not a measurement; pending while uncalibrated; absent without a night side.
{
  const night = { ...exposure, search: { ...exposure.search, sunlitFraction: 0.2 } } as HudInfo['exposure']
  const pending = planHud({ ...base, exposure: night, visibilityFloor: 'pending' }, false).notes.join(' | ')
  assert.doesNotMatch(pending, /calibration|visibility floor/, 'a floor that is not applied says nothing to a visitor')
  const applied = planHud({ ...base, exposure: night, visibilityFloor: 'applied', nightFloorApplied: true }, false).notes.join(' | ')
  assert.match(applied, /visibility floor: a display look choice/)
  assert.match(applied, /not a measured brightness/)
  const full = { ...exposure, search: { ...exposure.search, sunlitFraction: 1 } } as HudInfo['exposure']
  assert.equal(visibilityFloorNote(full, 'applied'), null, 'no night side in view: no claim')
  assert.equal(visibilityFloorNote({ ...exposure, search: { ...exposure.search, hits: 0 } } as HudInfo['exposure'], 'pending'), null, 'no Moon in view: no claim')
  assert.equal(visibilityFloorNote(night, undefined), null)
}
// The caption note follows the renderer's actual floor applicability, so a partial eclipse on geometric day does not claim an unlit display floor.
{
  const dayDuringEclipse = { ...exposure, search: { ...exposure.search, sunlitFraction: 0.2 }, hdr: 0.2 } as HudInfo['exposure']
  const withoutFloor = planHud({ ...base, exposure: dayDuringEclipse, nightFloorApplied: false }, false).notes.join(' | ')
  assert.doesNotMatch(withoutFloor, /night side lifted/, 'no floor note when the renderer has no floor on visible night ground')
  const withFloor = planHud({ ...base, exposure: dayDuringEclipse, nightFloorApplied: true }, false).notes.join(' | ')
  assert.match(withFloor, /night side lifted/, 'the renderer tells the HUD when the display floor applies')
  const groundMode = planHud({ ...base, exposure: dayDuringEclipse, ground, nightFloorApplied: false }, false).notes.join(' | ')
  assert.doesNotMatch(groundMode, /night side lifted/, 'ground mode does not caption a Moon floor it does not render')
}
console.log('hud.test ok')
