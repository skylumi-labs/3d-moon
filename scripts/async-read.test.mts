/** AsyncTexelRead: never blocks (a zero-timeout wait), fills the result only once the fence has signalled, refuses a second read while one is in flight. */
import assert from 'node:assert/strict'
import { AsyncTexelRead, type ReadGl } from '../src/ground/asyncRead'
import { GroundMode } from '../src/ground/GroundMode.ts'
import { GroundPass } from '../src/ground/GroundPass.ts'

const calls: string[] = []
const bufferA = {}, bufferB = {}, bufferC = {}, syncA = {}, syncB = {}, syncC = {}
let buffersMade = 0, syncsMade = 0
const signalAfter = 3
let polls = 0, lastTimeout = -1
const gl: ReadGl = {
  PIXEL_PACK_BUFFER: 1, STREAM_READ: 2, RGBA: 3, FLOAT: 4, SYNC_GPU_COMMANDS_COMPLETE: 5, ALREADY_SIGNALED: 10, CONDITION_SATISFIED: 11,
  createBuffer: () => { calls.push('createBuffer'); return [bufferA, bufferB, bufferC][buffersMade++] },
  deleteBuffer: (b) => { calls.push(`deleteBuffer:${b === bufferA ? 'a' : b === bufferB ? 'b' : 'unknown'}`) }, bindBuffer: (t, b) => { calls.push(b ? 'bind' : 'unbind') },
  bufferData: (_t, size) => { calls.push(`bufferData:${size}`) },
  readPixels: (_x, _y, w, h, _f, _t, offset) => { calls.push(`readPixels:${w}x${h}@${offset}`) },
  fenceSync: () => { calls.push('fenceSync'); return [syncA, syncB, syncC][syncsMade++] }, deleteSync: (s) => { calls.push(`deleteSync:${s === syncA ? 'a' : s === syncB ? 'b' : 'c'}`) }, flush: () => { calls.push('flush') },
  clientWaitSync: (_s, _f, timeout) => { lastTimeout = timeout; polls++; return polls >= signalAfter ? 10 : 12 },
  getBufferSubData: (_t, _o, dst) => { calls.push('getBufferSubData'); dst.set([7.5, 1, 0, 0]) },
}
const r = new AsyncTexelRead(), out = new Float32Array(4)
assert.equal(r.poll(gl, out), false, 'nothing in flight')
assert.equal(r.begin(gl, 1, 1), true)
assert.ok(calls.includes('bufferData:16') && calls.includes('readPixels:1x1@0') && calls.includes('flush'), calls.join())
assert.equal(r.begin(gl, 1, 1), false, 'one read at a time')
assert.equal(r.poll(gl, out), false); assert.equal(r.poll(gl, out), false)
assert.equal(lastTimeout, 0, 'a poll never waits')
assert.equal(out[0], 0, 'unfinished read leaves the result alone')
assert.equal(r.poll(gl, out), true)
assert.equal(out[0], 7.5)
assert.equal(r.pending, false)
assert.ok(calls.some((x) => x.startsWith('deleteSync:')) && calls.some((x) => x.startsWith('deleteBuffer:')), 'sync and buffer released')
assert.equal(r.begin(gl, 1, 1), true, 'next read allowed')
const deletesBeforeRelease = calls.filter((x) => x.startsWith('deleteSync:') || x.startsWith('deleteBuffer:')).length
r.release(gl); assert.equal(r.pending, false)
assert.equal(calls.filter((x) => x.startsWith('deleteSync:') || x.startsWith('deleteBuffer:')).length, deletesBeforeRelease + 2, 'disposing an unfinished read deletes its fence and PBO with a live context')
// The point probe (`?gprobe=async`, GroundPass.probeBegin) reads the whole 32 x 2 probe target: 1 KB a read, both rows.
assert.equal(r.begin(gl, 32, 2), true)
assert.ok(calls.includes('bufferData:1024') && calls.includes('readPixels:32x2@0'), calls.join())
r.release(gl)
// Both pending reads are owned by GroundPass. GroundMode.dispose must pass its live renderer through; context loss passes null and skips GL deletes.
{
  const deleted: string[] = []
  const disposalGl: ReadGl = {
    ...gl,
    createBuffer: () => ({}), fenceSync: () => ({}),
    deleteBuffer: () => { deleted.push('buffer') }, deleteSync: () => { deleted.push('sync') },
    bindBuffer: () => {}, bufferData: () => {}, readPixels: () => {}, flush: () => {},
  }
  const pass = new GroundPass({ uniforms: {} } as never, 1, 1)
  const reads = pass as unknown as { pointRead: AsyncTexelRead; rangeRead: AsyncTexelRead }
  assert.equal(reads.pointRead.begin(disposalGl, 1, 1), true)
  assert.equal(reads.rangeRead.begin(disposalGl, 1, 1), true)
  const renderer = { getContext: () => disposalGl }
  GroundMode.prototype.dispose.call({ lm: null, pass, renderer } as never)
  assert.deepEqual(deleted.sort(), ['buffer', 'buffer', 'sync', 'sync'], 'GroundMode disposal deletes both pending reads with the live context')

  const lostPass = new GroundPass({ uniforms: {} } as never, 1, 1)
  const lostReads = lostPass as unknown as { pointRead: AsyncTexelRead; rangeRead: AsyncTexelRead }
  lostReads.pointRead.begin(disposalGl, 1, 1); lostReads.rangeRead.begin(disposalGl, 1, 1)
  const beforeLoss = deleted.length
  lostPass.dispose(null)
  assert.equal(deleted.length, beforeLoss, 'context loss skips GL deletes')
}
console.log('async-read: ok')
