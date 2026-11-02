import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ArrivalDwell } from '../src/journey/dwell.ts'

// The progress fill must start when the dwell does (arrival), exactly once per arrival.
const d = new ArrivalDwell(14000)
assert.equal(d.consumeStart(), false, 'selection alone never starts the fill')
d.step(0, false); assert.equal(d.consumeStart(), false, 'in flight: no fill')
d.step(20000, true); assert.equal(d.consumeStart(), true, 'arrival starts the fill')
d.step(21000, true); assert.equal(d.consumeStart(), false, 'once per arrival')
d.step(22000, false); d.step(23000, true)
assert.equal(d.consumeStart(), true, 'a new arrival (after leaving) starts it again')

// The production tours.ts must gate the animation on that start, not on selection.
const src = fs.readFileSync(new URL('../src/ui/tours.ts', import.meta.url), 'utf8')
assert.match(src, /consumeStart\(\)/, 'tours.ts reads the dwell start')
assert.match(src, /if \(auto && fillRunning\)/, 'fill animation only runs after arrival')
assert.doesNotMatch(src, /if \(auto\) \{\s*void fill\.offsetWidth/, 'no selection-time fill start')
assert.match(src, /fillRunning = false\s*\n\s*const m = MOMENTS\[index\]/, 'selection resets the fill')
console.log('dwell-fill.test.mts: fill starts at arrival, once: ok')
