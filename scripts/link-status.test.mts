import assert from 'node:assert/strict'
import { linkOutcome, type LinkGl, type LinkRenderer } from '../src/moon/linkStatus.ts'

// #192: a program the GPU refused must never be reported usable; compileAsync resolves either way.
const LINK = 35714
const prog = {}
const material = {}
const gl = (ok: boolean | 'throws'): LinkGl => ({ LINK_STATUS: LINK, getProgramParameter: (p, n) => { if (ok === 'throws') throw new Error('lost'); assert.equal(p, prog); assert.equal(n, LINK); return ok } })
const renderer = (g: LinkGl | null, hasProgram = true): LinkRenderer => ({
  properties: { get: (o) => { assert.equal(o, material); return hasProgram ? { currentProgram: { program: prog } } : {} } },
  getContext: g ? () => g : undefined,
})
assert.equal(linkOutcome(renderer(gl(true)), material), 'ok')
assert.equal(linkOutcome(renderer(gl(false)), material), 'failed')
assert.equal(linkOutcome(renderer(gl(true), false), material), 'unknown', 'no program attached yet')
assert.equal(linkOutcome(renderer(null), material), 'unknown', 'no context')
assert.equal(linkOutcome(renderer(gl('throws')), material), 'unknown', 'a lost context does not throw out of the check')
assert.equal(linkOutcome({}, material), 'unknown')
console.log('link-status: ok')
