// Every generated Moon program that contains the shared tile march must declare the motion-march names that march reads. #82 added uMStride, uMLite and
// gHzStopDeg to moonFragment only; the shadow cache's build program (shadowCacheFragment) includes the same march, failed to compile ("undeclared
// identifier"), and drew every cache layer from an invalid program: tile-sized rectangles of wrong shadow. Text check here; the rig confirms a clean compile.
import assert from 'node:assert/strict'
import { moonCoverFragment, moonFragment, shadowCacheFragment } from '../src/moon/moonShader.ts'

const NAMES = ['uMotion', 'uMStride', 'uMLite', 'uMTerr', 'gHzStopDeg']
const programs: Array<[string, string]> = []
for (const deepest of [0, -1, -2, -3]) {
  programs.push([`shadowCacheFragment(${deepest})`, shadowCacheFragment(180, 4096, deepest)])
  programs.push([`moonFragment(${deepest})`, moonFragment(180, 4096, '', true, null, false, deepest)])
  programs.push([`moonCoverFragment(${deepest})`, moonCoverFragment(180, 4096, null, deepest)])
}
let checked = 0
for (const [label, src] of programs) {
  for (const n of NAMES) {
    // a use is any mention outside a comment line; a declaration is `[uniform] float NAME`
    const uses = src.split('\n').filter((l) => !l.trim().startsWith('//')).some((l) => new RegExp(`\\b${n}\\b`).test(l.replace(/\/\/.*$/, '')))
    if (!uses) continue
    checked++
    assert.ok(new RegExp(`(uniform\\s+)?float\\s+${n}\\b`).test(src), `${label} reads ${n} but does not declare it`)
  }
}
assert.ok(checked > 10, `the check found only ${checked} uses`)
console.log(`shader-motion-uniforms: ${checked} uses declared across ${programs.length} programs`)
