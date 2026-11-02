// The per-frame CPU memos: an unmoved view does not re-run the wanted-tile sampling or the exposure search; any change in the inputs does.
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { viewKey } from '../src/moon/tiles/wanted.ts'
import { ReliefStore } from '../src/moon/tiles/relief.ts'
import { searchKey } from '../src/post/exposure.ts'

const v = (): Parameters<typeof viewKey>[0] => ({ pos: new THREE.Vector3(0, 0, 1.05), right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), back: new THREE.Vector3(0, 0, 1), tanHalf: 0.27, aspect: 1.6, tanPerPx: 0.0007, moonX: new THREE.Vector3(1, 0, 0), moonY: new THREE.Vector3(0, 1, 0), moonZ: new THREE.Vector3(0, 0, 1) })
const a = v(), b = v()
assert.equal(viewKey(a), viewKey(b))
b.pos.x += 1e-9
assert.equal(viewKey(a), viewKey(b), 'sub-metre drift is the same view')
const d = v(); d.moonX.set(1, 4e-7, 0); d.moonY.set(-4e-7, 1, 0)
assert.equal(viewKey(a), viewKey(d), 'under a second of lunar rotation is the same view')
b.pos.x += 1e-4
assert.notEqual(viewKey(a), viewKey(b), 'a nudged camera is a new view')
const c = v(); c.tanPerPx *= 1.01
assert.notEqual(viewKey(a), viewKey(c), 'a resized canvas is a new view')

const r = new ReliefStore()
const ver0 = r.version
r.add(0, 1, 1, new Float32Array(4))
assert.ok(r.version > ver0, 'a tile arriving changes the relief version')
const v1 = r.version
r.remove(0, 1, 1)
assert.ok(r.version > v1)
const e = { sunDir: new THREE.Vector3(1, 0, 0), earthDir: new THREE.Vector3(0, 1, 0), moonX: new THREE.Vector3(1, 0, 0), moonY: new THREE.Vector3(0, 1, 0), moonZ: new THREE.Vector3(0, 0, 1), sunKm: new THREE.Vector3(1e8, 0, 0), earthKm: new THREE.Vector3(0, 4e5, 0) } as never
const cam = { pos: a.pos, right: a.right, up: a.up, back: a.back, tanHalf: a.tanHalf } as never
const k1 = searchKey(cam, 1.6, e, null, 180, { field: r, canvasHeight: 800 })
const k2 = searchKey(cam, 1.6, e, null, 180, { field: r, canvasHeight: 800 })
assert.equal(k1, k2)
r.add(0, 2, 2, new Float32Array(4))
assert.notEqual(k1, searchKey(cam, 1.6, e, null, 180, { field: r, canvasHeight: 800 }), 'new relief invalidates the exposure memo')
assert.equal(searchKey(cam, 1.6, e, null, 180, { field: { facingTan: () => null }, canvasHeight: 800 }), null, 'a field that cannot say when it changes is never memoised')
console.log('cpu-memo ok')
