// The ground view keys its Sun probe and its module shadow maps on the lighting, not only the date: a pick's date carry (journey/ephemCarry.ts) moves
// the Sun while every carried ephemeris already has the destination's date, and the Apollo 17 direct arrival can enter ground mode mid-carry (review 2026-10-29).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ephemerisAt } from '../src/ephemeris.ts'
import { blendEphemeris } from '../src/journey/ephemCarry.ts'
import { lightingKey } from '../src/ground/GroundMode.ts'

const a = ephemerisAt(new Date('2026-10-29T15:35:06Z')), b = ephemerisAt(new Date('1972-12-13T12:00:00Z'))
const keys = [0.3, 0.6, 1].map((w) => lightingKey(blendEphemeris(a, b, w)))
assert.equal(new Set(keys).size, 3, 'three carried lightings with one date are three keys')
assert.equal(lightingKey(b), lightingKey(ephemerisAt(new Date(b.date.getTime()))), 'the same ephemeris is the same key')
const src = fs.readFileSync(new URL('../src/ground/GroundMode.ts', import.meta.url), 'utf8')
assert.match(src, /const t = lightingKey\(e\)/, 'GroundMode.render keys the probe and the shadow maps on lightingKey')
assert.doesNotMatch(src, /const t = e\.date\.getTime\(\)/)
console.log('ground-lighting-key: ok')
