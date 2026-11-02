// The ground shader's measurement switches (?gsteps ?gshadow ?ghitx) read location.search at import: with them set the text changes as documented.
import assert from 'node:assert/strict'

;(globalThis as { location?: { search: string } }).location = { search: '?gsteps=24&gshadow=0&ghitx=3' }
const { groundFragment } = await import('../src/ground/groundShader.ts')
const sh = groundFragment('shade', 180, 4096, [{ h: true, r: true, fadeM: 40, shade: true }])
assert.ok(sh.includes('i < 24') && !sh.includes('i < 384'), 'gsteps caps the march')
assert.ok(/float sunVisibility\(vec3 P, vec3 s, float t0\) \{ return 1\.0;/.test(sh), 'gshadow=0 skips the Sun march')
assert.equal((sh.match(/groundHitRay\(o \+ vec3\(uMotion/g) ?? []).length, 2, 'ghitx=3 adds two extra main rays')
// ?surround=1 in ground mode: the modelled surround reaches the albedo; off (the default) the text has none of it.
{
  const layout = [{ h: true, r: true, fadeM: 40, shade: true }]
  const on = groundFragment('shade', 180, 4096, layout, false, false, false, true)
  const off = groundFragment('shade', 180, 4096, layout, false, false, false, false)
  assert.ok(on.includes('float groundSurround(') && on.includes('surrNoise(mEN / 384.0 + 91.1)') && on.includes('exp2(groundDetail(mEN, fpM) + groundSurround(mEN, fpM, sl, uGSunL.xy))'), 'surround on: the octaves and the call')
  assert.ok(on.includes('uniform float uSurround;'), 'the Moon pass uniform table declares uSurround (GroundPass borrows it)')
  assert.ok(!off.includes('groundSurround') && off.includes('exp2(groundDetail(mEN, fpM));'), 'surround off: no trace in the text')
}
console.log('ground-shader-switches ok')
