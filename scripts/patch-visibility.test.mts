// A retained site shader is useful only while its patch cap can intersect
// the current camera frustum; off-screen views can use the full global tile detail shader.
import assert from 'node:assert/strict'
import { Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { patchFootprintRadius, sphericalCapInFrustum } from '../src/moon/patch/visibility.ts'

const levels = [{
  name: 'photo', w: 1000, h: 500, texelM: 8, eastM: -5000, northM: 2500,
  texelEastM: 10, texelNorthM: 10, detail: 'photo.bin',
}]
const radius = patchFootprintRadius(levels)
assert.ok(radius > 0.003 && radius < 0.004, 'cap encloses the full patch rectangle')
const rotated = patchFootprintRadius([{ ...levels[0], axisEastPerTexelM: [8, 6], axisSouthPerTexelM: [6, -8] }])
assert.ok(rotated > radius * 0.9, 'rotated patch grid bounds are included')

const camera = new PerspectiveCamera(30, 16 / 9, 0.1, 100)
camera.position.set(0, 0, 3)
camera.lookAt(0, 0, 0)
camera.updateMatrixWorld(true)
const inverse = new Matrix4().multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse)
const cameraPosition = camera.position.clone()
assert.equal(sphericalCapInFrustum(cameraPosition, inverse, new Vector3(0, 0, 1), radius), true, 'site cap in the view uses patch material')

camera.lookAt(3, 0, 3)
camera.updateMatrixWorld(true)
const lookingAway = new Matrix4().multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse)
assert.equal(sphericalCapInFrustum(cameraPosition, lookingAway, new Vector3(0, 0, 1), radius), false, 'off-screen site restores normal global detail material')
assert.equal(sphericalCapInFrustum(cameraPosition, inverse, new Vector3(0, 0, 1), Math.PI), true, 'a globe-sized visible bound retains the patch shader')

console.log('patch visibility ok')
