import assert from 'node:assert/strict'
import * as THREE from 'three'
import { rayHitsSphere, sphereRayDiscriminant } from '../src/sun/occlusion.ts'

const inside = (angle: number) => new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle))
const centre = new THREE.Vector3(0, 0, 6)
const limbAngle = Math.asin(1 / centre.length())

assert.ok(rayHitsSphere(centre, new THREE.Vector3(0, 0, -1)), 'central solar ray is blocked by the Moon')
assert.ok(rayHitsSphere(centre, inside(limbAngle * 0.999)), 'ray just inside the lunar limb is blocked')
assert.ok(!rayHitsSphere(centre, inside(limbAngle * 1.001)), 'ray just outside the lunar limb remains visible')
assert.ok(Math.abs(sphereRayDiscriminant(centre, inside(limbAngle))) < 1e-6, 'the apparent lunar limb is the tangent ray')

// A grazing, off-axis view uses the same camera-ray/sphere test. A projected
// circle approximation can fail here because the projected cap is stretched.
const horizonCamera = new THREE.Vector3(6, 0, 0)
const grazingAngle = Math.asin(1 / horizonCamera.length())
const towardBody = (angle: number) => new THREE.Vector3(-Math.cos(angle), Math.sin(angle), 0)
assert.ok(rayHitsSphere(horizonCamera, towardBody(grazingAngle * 0.999)), 'off-axis ray just inside the limb is blocked')
assert.ok(!rayHitsSphere(horizonCamera, towardBody(grazingAngle * 1.001)), 'off-axis ray just outside the limb is visible')

const horizon = new THREE.Vector3(0, 1, 0)
assert.ok(!rayHitsSphere(centre, horizon), 'a ray exactly along the horizon misses the Moon')
console.log('sun-occultation.test: all checks passed')
