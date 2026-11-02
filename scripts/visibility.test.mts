import assert from 'node:assert/strict'
import { applyVisibilityGrey, visibilityGrey, validateCalibration, VISIBILITY_GLSL, type VisibilityCalibration } from '../src/post/visibility.ts'
import { moonFragment } from '../src/moon/moonShader.ts'
import { FINAL_FRAGMENT } from '../src/post/final.ts'
import { groundFragment } from '../src/ground/groundShader.ts'
const policy: VisibilityCalibration = { id: 'synthetic math fixture, not production calibration', bundleSha256: '1'.repeat(64), baselineEarthshineSha256: '2'.repeat(64), mariaGrey: 0.05, highlandGrey: 0.07, skyGrey: 0.01, minContrastGrey: 0.02, minDetailGrey: 0.01, earthshineMinimumGrey: 0.08 }
validateCalibration(policy)
assert.throws(() => validateCalibration({ ...policy, earthshineMinimumGrey: 0.06 }), /Earthshine/)
assert.throws(() => validateCalibration({ ...policy, bundleSha256: '' }), /identity/)
for (let phase = 0; phase <= 180; phase++) for (const coverage of [0, 0.1, 0.5, 1]) for (const baseline of [0, 1e-8, 0.03, 0.08, 0.3, 1]) for (const template of [0.35, 0.65, 1]) {
  const night = phase / 180
  const y = applyVisibilityGrey(baseline, coverage, night, template, policy)
  assert.ok(Number.isFinite(y) && y >= baseline && y <= 1)
  assert.equal(applyVisibilityGrey(baseline, 0, night, template, policy), baseline, 'sky/foreground unaffected')
  assert.equal(applyVisibilityGrey(baseline, coverage, 0, template, policy), baseline, 'sunlit crater shadows unaffected')
  assert.equal(applyVisibilityGrey(baseline, coverage, night, template, null), baseline, 'uncalibrated display stays baseline')
  if (baseline >= policy.highlandGrey) assert.equal(y, baseline, 'accepted Earthshine never brightens')
}
assert.ok(applyVisibilityGrey(0, 1, 1, 1, policy) > applyVisibilityGrey(0, 1, 1, 0.35, policy), 'zero radiance keeps albedo structure')
assert.equal(applyVisibilityGrey(0, 1, 1, 1, policy), visibilityGrey(1, policy), 'production math floor is necessary at zero radiance')
assert.match(FINAL_FRAGMENT, /s = applyVisibility\(s, texture\(uMoonMetadata, vUv\)/)
assert.match(VISIBILITY_GLSL, /max\(baseline, vec3\(target\)\)/)
const meta = moonFragment(180, 4096, '', true, [{ h: true, r: true, fadeM: 400 }], true)
assert.match(meta, /terrainResolve\(rr, b, p, hitPos, cover\)/)
assert.match(meta, /earthT < moonT/)
assert.match(meta, /vec4\(cover, night \* cover/)
assert.doesNotMatch(meta, /fragColor = vec4\(col, sunKey\)/)
assert.match(groundFragment('metadata', 180, 4096, [{ h: true, r: true, fadeM: 400 }]), /vec4\(cover, night \* cover/)
console.log('visibility.test.mts: displayed-output phase sweep and independent shader metadata contract: ok (uncalibrated)')
