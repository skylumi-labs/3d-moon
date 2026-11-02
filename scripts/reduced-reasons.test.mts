// The reduced-detail reasons (src/quality/reduced.ts): what is missing, honestly, per class and cause. The visitor chip is gone; the quality audit still reads them.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CLASS_TABLE, shellProfile } from '../src/quality/startupClass.ts'
import { motionKnobs } from '../src/quality/apply.ts'
import { reducedReasons, type ReducedInput } from '../src/quality/reduced.ts'

const MB = 1048576
const mk = (cls: keyof typeof CLASS_TABLE, over: Partial<ReducedInput> = {}): ReducedInput => {
  const profile = CLASS_TABLE[cls]
  const preset = over.preset ?? 'auto'
  // The caps main.ts passes: the preset's knobs, not the class row.
  const k = motionKnobs(profile, preset)
  return { cls, profile, ceilingBytes: profile.ceilingBytes, contextLosses: 0, nativeDpr: 2, preset, dprCap: k.dprCap, closeDprCap: k.closeDprCap, restDprCap: k.restDprCap, ...over }
}
const axes = (i: ReducedInput): string[] => reducedReasons(i).map((r) => r.axis)

// Desktop at DPR 2 with nothing lost and nothing cut says nothing; `high` changes nothing either.
assert.deepEqual(reducedReasons(mk('desktop')), [])
assert.deepEqual(reducedReasons(mk('desktop', { preset: 'high', allocatedTiles: 128 })), [])
assert.deepEqual(reducedReasons(mk('software')), [], 'software only sets a ceiling')

// iOS at DPR 3: the DPR line and the TC line, each with its cause and the numbers.
const ios = reducedReasons(mk('ios', { nativeDpr: 3 }))
assert.ok(axes(mk('ios', { nativeDpr: 3 })).includes('dpr') && axes(mk('ios', { nativeDpr: 3 })).includes('tc'))
assert.equal(ios.find((r) => r.axis === 'dpr')?.text, "The picture is drawn at 1.5 of the screen's 3 pixels per point")
assert.equal(ios.find((r) => r.axis === 'tc')?.text, 'The finest surface texture (JAXA TC) is not loaded')
assert.ok(ios.every((r) => r.why === 'device class at start'))
assert.equal(ios.find((r) => r.axis === 'tiles')?.text, 'Fewer map tiles are kept: 48 of 128', 'the class default is a device-class cut')
assert.ok(!axes(mk('ios', { nativeDpr: 1 })).includes('dpr'), 'no DPR line when the screen is not above the cap')

// The DPR line states the ratio actually drawn (the preset's caps; phone-android rests at restDprCap), and its cause.
const dprOf = (i: ReducedInput) => reducedReasons(i).find((r) => r.axis === 'dpr')
assert.equal(dprOf(mk('ios', { nativeDpr: 3, preset: 'high' }))?.text, "The picture is drawn at 2 of the screen's 3 pixels per point", 'ios + High is the desktop cap 2')
assert.equal(dprOf(mk('ios', { nativeDpr: 3, preset: 'high' }))?.why, 'your Quality setting')
assert.equal(dprOf(mk('ios', { nativeDpr: 2, preset: 'high' })), undefined, 'ios + High on a DPR 2 screen: nothing cut, no line')
assert.equal(dprOf(mk('ios', { nativeDpr: 3, preset: 'battery' }))?.text, "The picture is drawn at 1.25 of the screen's 3 pixels per point")
assert.equal(dprOf(mk('ios', { nativeDpr: 3, preset: 'battery' }))?.why, 'Battery saver is on')
assert.equal(dprOf(mk('ios', { nativeDpr: 1.25, preset: 'battery' })), undefined)
const and = dprOf(mk('phone-android', { nativeDpr: 2.63 }))
assert.equal(and?.text, "The picture is drawn at 2 of the screen's 2.63 pixels per point at rest, 1.5 while moving")
assert.equal(and?.why, 'device class at start')
// Close-in poses: the line comes from dprFor, as the renderer's does (terminator pose dist 1.12, ground mode and flight frames pass 0).
for (const dist of [1.12, 0]) {
  assert.equal(dprOf(mk('phone-android', { nativeDpr: 2.63, dist }))?.text, "The picture is drawn at 2 of the screen's 2.63 pixels per point at rest, 1.25 while moving", `phone-android Auto at dist ${dist} moves at the close cap`)
}
assert.equal(dprOf(mk('phone-android', { nativeDpr: 2.63, dist: 3.6 }))?.text, and?.text, 'far pose keeps the far cap')
assert.equal(dprOf(mk('phone-android', { nativeDpr: 2 })), undefined, 'phone-android at a DPR 2 screen rests at the full ratio; moving at 1.5 is not a rest-picture cut')
assert.equal(dprOf(mk('phone-android', { nativeDpr: 2.63, dprOverride: 3 })), undefined, '?dpr= is verbatim, the caps do not apply')
const tab = reducedReasons(mk('tablet', { nativeDpr: 2 }))
assert.deepEqual(tab.map((r) => r.axis), ['tiles', 'pano'], 'tablet at DPR 2: tiles (48 of 128) and panorama width; no dpr, tc or shadow line')
assert.equal(tab[0].text, 'Fewer map tiles are kept: 48 of 128')
// iOS on the website keeps main's 8192 panorama width; the iOS app's profile reads the compact 4096 tier.
assert.equal(ios.find((r) => r.axis === 'pano')?.text, 'Panoramas load at up to 8192 pixels wide, not 16384', 'the iOS website reasons say 8192 (main)')
{
  const app = shellProfile('ios', CLASS_TABLE.ios, true)
  const appIos = reducedReasons({ ...mk('ios', { nativeDpr: 3 }), profile: app, ceilingBytes: app.ceilingBytes })
  assert.equal(appIos.find((r) => r.axis === 'pano')?.text, 'Panoramas load at up to 4096 pixels wide, not 16384', 'the iOS app reasons say 4096')
  assert.ok(!appIos.some((r) => r.text.includes('8192')), 'no iOS app reason line says 8192')
}

// The ledger fit cuts below the class count: both numbers, cause memory.
const fit = reducedReasons(mk('ios', { allocatedTiles: 32 })).find((r) => r.axis === 'tiles')
assert.equal(fit?.text, 'Fewer map tiles are kept: 32 of 48 (desktop: 128)')
assert.equal(fit?.why, 'memory')

// A lost context: the memory line, on any class (desktop has an infinite ceiling that the loss lowers).
const lostIos = reducedReasons(mk('ios', { contextLosses: 1, ceilingBytes: 200 * MB })) // below the 255 MB class ceiling: a lowered ceiling
assert.equal(lostIos.find((r) => r.axis === 'memory')?.text, 'Graphics memory capped after a lost graphics context')
assert.equal(lostIos.find((r) => r.axis === 'memory')?.why, 'memory (the graphics context was lost)')
assert.deepEqual(axes(mk('desktop', { contextLosses: 1, ceilingBytes: 300 * MB })), ['memory'])
assert.deepEqual(axes(mk('ios', { contextLosses: 1, ceilingBytes: CLASS_TABLE.ios.ceilingBytes })).includes('memory'), false, 'a loss that did not lower the ceiling adds no memory line')

// A memory warning that lowered the ceiling: the same memory cut, with the reason "Memory" (no context loss needed, any class, desktop included).
const warnIos = reducedReasons(mk('ios', { memoryWarnings: 1, ceilingBytes: 200 * MB }))
assert.equal(warnIos.find((r) => r.axis === 'memory')?.why, 'Memory')
assert.equal(warnIos.find((r) => r.axis === 'memory')?.text, 'Graphics memory capped after a memory warning')
assert.deepEqual(axes(mk('desktop', { memoryWarnings: 1, ceilingBytes: 300 * MB })), ['memory'], 'desktop: its infinite ceiling is lowered, so the line shows')
assert.ok(!axes(mk('ios', { memoryWarnings: 1, ceilingBytes: CLASS_TABLE.ios.ceilingBytes })).includes('memory'), 'a warning that did not lower the ceiling adds no line')
assert.ok(!axes(mk('ios', { memoryWarnings: 0, ceilingBytes: 200 * MB })).includes('memory'), 'no warning, no memory line (the ceiling alone is not the cause)')
assert.equal(reducedReasons(mk('ios', { contextLosses: 1, memoryWarnings: 1, ceilingBytes: 200 * MB })).filter((r) => r.axis === 'memory').length, 2, 'a loss and a warning are two lines')

// Battery saver is the visitor's own choice, its own line, and it never masks a memory line.
const bat = reducedReasons(mk('desktop', { preset: 'battery' }))
assert.deepEqual(bat.map((r) => r.axis), ['dpr', 'battery'], 'Battery also draws 1.25 of a DPR 2 screen, and says so')
assert.equal(bat[0].why, 'Battery saver is on')
assert.equal(bat[1].text, 'Battery saver is on (your Quality setting)')
const both = axes(mk('desktop', { preset: 'battery', contextLosses: 1, ceilingBytes: 300 * MB }))
assert.ok(both.includes('memory') && both.includes('battery'))

// Wording: never a claim of optimisation.
for (const r of [...ios, ...lostIos, ...bat, ...warnIos]) assert.ok(!/optimi[sz]ed|best for your|automatically/i.test(r.text), r.text)
// TDZ guard: main.ts calls refreshReduced() at module load, and reducedNow() reads these three `let`s, so they must be declared above that first call.
const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const firstCall = mainSrc.search(/^refreshReduced\(\)/m)
assert.ok(firstCall > 0, 'main.ts has a top-level refreshReduced() call')
for (const decl of [/^let groundMode\b/m, /^let flight\b/m, /^let flightFrame\b/m]) {
  const at = mainSrc.search(decl)
  assert.ok(at >= 0 && at < firstCall, `${decl} must be declared before the top-level refreshReduced() (temporal dead zone)`)
}
console.log('reduced-reasons: ok')
