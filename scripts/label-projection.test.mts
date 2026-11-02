import assert from 'node:assert/strict'
import type { MoonLabel } from '../src/labels/data.ts'
import { labelDepthStyle, placeLabelCandidates } from '../src/labels/declutter.ts'
import { projectLabelSurface } from '../src/labels/projection.ts'

const camera = {
  pos: { x: 0, y: 0, z: 3 },
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  back: { x: 0, y: 0, z: 1 },
  tanHalf: 0.5,
}
const center = projectLabelSurface(camera as never, 1, { x: 0, y: 0, z: 1 }, 1, 1000, 800)
assert.deepEqual(center, { x: 500, y: 400 }, 'a point beneath the camera projects to screen center')
assert.equal(projectLabelSurface(camera as never, 1, { x: 0, y: 0, z: -1 }, 1, 1000, 800), null, 'far-side surface point is occluded')
const oblique = { x: Math.sqrt(0.75), y: 0, z: 0.5 }
assert.equal(projectLabelSurface(camera as never, 1, oblique, 1.51, 1000, 800), null, 'terrain radius participates in limb occlusion')
const low = projectLabelSurface(camera as never, 1, oblique, 1, 1000, 800)
assert.ok(low && low.x > 800, 'visible surface point projects toward the right edge')

const crater: MoonLabel = { id: 'crater', name: 'Crater', kind: 'crater', sizeKm: 100, lat: 0, lon: 0, source: 'test' }
const nearStyle = labelDepthStyle(crater, 2, 1, 500)
const limbStyle = labelDepthStyle(crater, 2, 1.7, 500)
assert.ok(nearStyle.scale > limbStyle.scale, 'nearer terrain receives a modestly larger label')
assert.ok(nearStyle.opacity > limbStyle.opacity, 'nearer terrain receives stronger contrast')
for (const style of [nearStyle, limbStyle]) assert.ok(style.scale >= 0.88 && style.scale <= 1.08 && style.opacity >= 0.58 && style.opacity <= 0.96)

const bounded = placeLabelCandidates(Array.from({ length: 500 }, (_, i) => ({ id: `${i}`, x: i * 2, y: 100, w: 70, h: 40, rank: i })), [], [0, 0, 900, 500], 24, 100)
assert.ok(bounded.size <= 24, 'visible label count remains capped')
for (const at of bounded.values()) assert.ok(at.x >= 35 && at.x <= 865 && at.y >= 20 && at.y <= 480, 'placements stay inside the viewport')

console.log('label-projection.test ok')
