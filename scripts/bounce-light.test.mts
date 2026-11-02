// The lunar module's ground bounce on a phone: one ambient term, no PMREM environment (ground/bounceLight.ts, LunarModule.ts).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ambientForBounce, bounceAmbientIntensity, bounceLighting } from '../src/ground/bounceLight.ts'

test('the phone classes light the bounce with the ambient term, the others keep the environment', () => {
  assert.equal(bounceLighting(true), 'ambient')
  assert.equal(bounceLighting(false), 'pmrem', 'desktop and web keep the PMREM environment')
})

test('the ambient term is the lit half of the bounce sphere, scaled by pre-exposure', () => {
  assert.equal(ambientForBounce(0, 1), 0)
  assert.ok(Math.abs(ambientForBounce(0.1, 1) - 0.1 * Math.PI * 0.5) < 1e-12)
  assert.ok(Math.abs(ambientForBounce(0.1, 2) - 2 * ambientForBounce(0.1, 1)) < 1e-12)
  assert.equal(ambientForBounce(-1, 1), 0, 'never negative')
})

test('a phone build never creates the PMREM environment (the branch is before the PMREM generator)', () => {
  const src = readFileSync(new URL('../src/ground/LunarModule.ts', import.meta.url), 'utf8')
  const branch = src.indexOf("bounceLighting(this.phone) === 'ambient'")
  const pmrem = src.indexOf('new THREE.PMREMGenerator(renderer)')
  assert.ok(branch > 0 && pmrem > branch, 'the phone branch returns before the PMREM generator is made')
})

test('the ambient is 0 wherever the PMREM environment is kept (no double fill on desktop and tablet)', () => {
  assert.equal(bounceAmbientIntensity(false, 0.1, 1), 0, 'desktop/tablet: the environment carries the bounce')
  assert.equal(bounceAmbientIntensity(false, 0.5, 3), 0)
  assert.equal(bounceAmbientIntensity(true, 0.1, 2), ambientForBounce(0.1, 2), 'phone path: the ambient stands in for the environment')
  const src = readFileSync(new URL('../src/ground/LunarModule.ts', import.meta.url), 'utf8')
  assert.ok(!/bounceAmbient\.intensity = ambientForBounce/.test(src), 'LunarModule sets the ambient only through bounceAmbientIntensity (phone-gated)')
  assert.equal((src.match(/bounceAmbient\.intensity = bounceAmbientIntensity\(this\.phone,/g) ?? []).length, 2, 'both writes pass the phone flag')
})
