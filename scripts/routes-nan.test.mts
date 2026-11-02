import assert from 'node:assert/strict'
import { projectPin, routesCannotDraw } from '../src/ui/pinMath'

const v = (x: number, y: number, z: number) => ({ x, y, z })
const cam = (tanHalf: number) => ({ pos: v(0, 0, 3), back: v(0, 0, 1), right: v(1, 0, 0), up: v(0, 1, 0), tanHalf }) as never
const dir = v(0, 0, 1)

// Healthy projection still works.
const ok = projectPin(cam(0.5), 1, dir, 800, 600)
assert.ok(ok && Number.isFinite(ok.x) && Number.isFinite(ok.y))
// Non-finite camera, zero aspect and zero-size canvas must give null, never NaN.
assert.equal(projectPin(cam(NaN), 1, dir, 800, 600), null)
assert.equal(projectPin(cam(0), 1, dir, 800, 600), null)
assert.equal(projectPin(cam(0.5), 0, dir, 800, 600), null)
assert.equal(projectPin(cam(0.5), NaN, dir, 800, 600), null)
assert.equal(projectPin(cam(0.5), 1, dir, NaN, 600), null)
assert.equal(projectPin(cam(0.5), 1, v(NaN, 0, 1), 800, 600), null)
// The overlay skips drawing for 0x0 and hidden pages.
assert.equal(routesCannotDraw(0, 0, false), true)
assert.equal(routesCannotDraw(800, 0, false), true)
assert.equal(routesCannotDraw(800, 600, true), true)
assert.equal(routesCannotDraw(NaN, 600, false), true)
assert.equal(routesCannotDraw(800, 600, false), false)
console.log('routes-nan: ok')
