// The sample-set builder on fixtures: the dry run writes nothing, internal-only sources and layers are refused, the manifest and
// checksum file describe exactly what is packaged, and the deeper block goes through the real make-sample-manifest.mts.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_REGION, ROOT, SampleSetError, assertPublicManifest, assertPublicPath, build, finalise, layerOf, makePlan, parseArgs, planDeeper,
  presentIndices, sha256, tileTouches, toRle, type Plan,
} from './build-sample-set.mts'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-set-'))
const write = (p: string, body: string | Buffer = 'x'): void => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body) }
const refuses = (fn: () => unknown, re: RegExp): void => assert.throws(fn, (e: unknown) => e instanceof SampleSetError && re.test(e.message))

// Geometry and presence helpers.
assert.equal(tileTouches(0, 40, 17, DEFAULT_REGION), true, 'level-0 tile 20..25 E, 0..5 N is the block')
assert.equal(tileTouches(0, 41, 17, DEFAULT_REGION), false)
assert.equal(tileTouches(-1, 80, 34, DEFAULT_REGION), true)
assert.equal(tileTouches(-1, 82, 34, DEFAULT_REGION), false)
assert.deepEqual(toRle([5, 3, 4, 9]), [[3, 3], [9, 1]])
assert.deepEqual(presentIndices({ presentRle: [[3, 3], [9, 1]] }, 0), [3, 4, 5, 9])
assert.deepEqual(presentIndices({ present: '0110' }, 0), [1, 2])

// Fixture: SVS inputs (empty), and a local tiles folder with a hosted-style deeper block at level -1 (four tiles in the block, one outside).
const svs = path.join(tmp, 'svs'); write(path.join(svs, 'ldem64.raw')); write(path.join(svs, 'color_full.tif'))
const deeper = path.join(tmp, 'hosted-tiles')
const nx1 = 144
const block = [34 * nx1 + 80, 34 * nx1 + 81, 35 * nx1 + 80, 35 * nx1 + 81]
const outside = 10 * nx1 + 10
const deeperMan = {
  version: 1, height: { texelKm: 0.4738 },
  deeper: [{ level: -1, tileDeg: 2.5, stepM: 1, presentRle: toRle([...block, outside]), regions: ['sldem-60'],
    detail: { path: 'd', format: 'webp-u8-ratio', mid: 128, perOctave: 40, presentRle: toRle(block.slice(0, 2)) } }],
}
write(path.join(deeper, 'manifest.json'), JSON.stringify(deeperMan))
for (const i of block) write(path.join(deeper, 'h', '-1', `${i % nx1}_${Math.floor(i / nx1)}.bin.gz`), `h${i}`)
for (const i of block.slice(0, 2)) write(path.join(deeper, 'd', '-1', `${i % nx1}_${Math.floor(i / nx1)}.webp`), `d${i}`)

{
  const p = planDeeper(deeper, DEFAULT_REGION)
  assert.deepEqual(p.heights['-1'], block, 'only the block is taken; the outside tile is not needed on disk')
  assert.deepEqual(p.detail['-1'], block.slice(0, 2))
  assert.equal(p.copies.length, 6)
  assert.ok(p.copies.every((c) => c.to.startsWith('tiles/h/-1/') || c.to.startsWith('tiles/d/-1/')))
}

// The dry run checks everything and writes nothing.
{
  const out = path.join(tmp, 'dry-out')
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/build-sample-set.mts', '--svs', svs, '--out', out, '--deeper', deeper, '--dry-run'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const plan = JSON.parse(r.stdout)
  assert.equal(plan.dryRun, true)
  assert.equal(plan.deeperCopies, 6)
  assert.match(plan.steps[0], /scripts\/build-tiles-m2\.mts .*--region 20,25,0,5/)
  assert.match(plan.steps[1], /scripts\/make-sample-manifest\.mts/)
  assert.equal(fs.existsSync(out), false, 'a dry run creates no output folder')
  const bad = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/build-sample-set.mts', '--svs', svs, '--out', out, '--deeper', path.join(tmp, 'none'), '--dry-run'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /build-sample-set: --deeper .*no manifest\.json/)
}

// Internal-only sources, layers and manifests are refused.
{
  refuses(() => assertPublicPath('/data/.internal/tiles', '--deeper'), /internal-only prefix/)
  refuses(() => assertPublicPath('/bucket/moon/restricted/x', '--patch'), /internal-only prefix/)
  assertPublicPath('/bucket/moon/tiles', '--deeper')
  refuses(() => assertPublicManifest({ deeper: [{ level: -1, licence: 'internal-only' }] }, 'm.json'), /m\.json\.deeper\[0\]: tagged internal-only/)
  refuses(() => assertPublicManifest({ levels: [] }, 'patch.json', true), /names no licence "public"/)
  assertPublicManifest({ licence: 'public' }, 'patch.json', true)

  const internalDeeper = path.join(tmp, 'internal', 'tiles')
  fs.cpSync(deeper, internalDeeper, { recursive: true })
  refuses(() => planDeeper(internalDeeper, DEFAULT_REGION), /internal-only prefix/)
  const tagged = path.join(tmp, 'tagged-tiles')
  fs.cpSync(deeper, tagged, { recursive: true })
  write(path.join(tagged, 'manifest.json'), JSON.stringify({ ...deeperMan, deeper: [{ ...deeperMan.deeper[0], licence: 'internal-only' }] }))
  refuses(() => planDeeper(tagged, DEFAULT_REGION), /tagged internal-only/)
  const otherDetail = path.join(tmp, 'other-detail')
  fs.cpSync(deeper, otherDetail, { recursive: true })
  write(path.join(otherDetail, 'manifest.json'), JSON.stringify({ ...deeperMan, deeper: [{ ...deeperMan.deeper[0], detail: { ...deeperMan.deeper[0].detail, path: 'x-detail' } }] }))
  refuses(() => planDeeper(otherDetail, DEFAULT_REGION), /not the public WAC detail layer/)
  const missing = path.join(tmp, 'missing-tiles')
  fs.cpSync(deeper, missing, { recursive: true })
  fs.rmSync(path.join(missing, 'h', '-1', '80_34.bin.gz'))
  refuses(() => planDeeper(missing, DEFAULT_REGION), /lists h\/-1\/80_34\.bin\.gz but/)
  const need = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/build-sample-set.mts', '--svs', svs, '--out', path.join(tmp, 'o0'), '--deeper', missing, '--need'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(need.status, 0, need.stderr)
  assert.deepEqual(need.stdout.trim().split('\n'), ['h/-1/80_34.bin.gz', 'h/-1/81_34.bin.gz', 'h/-1/80_35.bin.gz', 'h/-1/81_35.bin.gz', 'd/-1/80_34.webp', 'd/-1/81_34.webp'],
    '--need lists the download, missing files included, from the manifest alone')

  const patchNoLicence = path.join(tmp, 'p1', 'a11'); write(path.join(patchNoLicence, 'manifest.json'), '{"levels":[]}')
  const base = ['--svs', svs, '--out', path.join(tmp, 'o1')]
  refuses(() => makePlan(parseArgs([...base, '--patch', patchNoLicence])), /names no licence "public"/)
  assert.equal(makePlan(parseArgs([...base, '--patch', patchNoLicence, '--assume-public'])).patch?.site, 'a11')
  const patchX = path.join(tmp, 'p2', 'zz9'); write(path.join(patchX, 'manifest.json'), '{"licence":"public"}')
  refuses(() => makePlan(parseArgs([...base, '--patch', patchX])), /site "zz9" is not a public sample layer/)
  const patchTagged = path.join(tmp, 'p3', 'a17'); write(path.join(patchTagged, 'manifest.json'), '{"licence":"public","levels":[{"licence":"internal-only"}]}')
  refuses(() => makePlan(parseArgs([...base, '--patch', patchTagged, '--assume-public'])), /tagged internal-only/)
  refuses(() => parseArgs(['--svs', svs]), /usage/)
  refuses(() => parseArgs([...base, '--region', '5,1,0,1']), /--region/)
  refuses(() => makePlan(parseArgs(['--svs', path.join(tmp, 'nosvs'), '--out', path.join(tmp, 'o2')])), /no ldem64\.raw/)

  assert.equal(layerOf('tiles/h/0/1_1.bin.gz'), 'tiles/h')
  assert.equal(layerOf('patch/a11/L0.bin.gz'), 'patch/a11')
  assert.equal(layerOf('SHA256SUMS'), null)
  refuses(() => layerOf('tc/v3/d/-3/1_1.webp'), /not a public sample layer/)
  refuses(() => layerOf('tiles/h/internal/x.bin.gz'), /not a public sample layer/)
  refuses(() => layerOf('patch/zz9/L0.bin'), /not a public sample layer/)
}

// A build with the SVS step stubbed: the deeper tiles are copied, make-sample-manifest.mts adds the deeper block, and the manifest and
// SHA256SUMS describe every packaged file.
{
  const out = path.join(tmp, 'out')
  const o = parseArgs(['--svs', svs, '--out', out, '--deeper', deeper, '--max-mb', '1'])
  const plan: Plan = makePlan(o)
  const fakeTiles = `const fs=require('fs');const p=${JSON.stringify(path.join(out, 'tiles'))};fs.mkdirSync(p+'/h/0',{recursive:true});fs.mkdirSync(p+'/c/0',{recursive:true});`
    + `fs.mkdirSync(p+'/h/1',{recursive:true});fs.mkdirSync(p+'/c/1',{recursive:true});fs.mkdirSync(p+'/h/2',{recursive:true});fs.mkdirSync(p+'/c/2',{recursive:true});`
    + `fs.writeFileSync(p+'/h/0/40_17.bin.gz','h');fs.writeFileSync(p+'/c/0/40_17.webp','c');`
    + `fs.writeFileSync(p+'/manifest.json',JSON.stringify({version:1,tileDeg:5,height:{texelKm:0.4738},present:[],source:'NASA SVS 4720 (public domain)'}));fs.writeFileSync(p+'/build-summary.json','{}')`
  plan.steps[0] = ['node', '-e', fakeTiles]
  const log = console.log
  console.log = () => {}
  try { build(plan) } finally { console.log = log }
  const man = JSON.parse(fs.readFileSync(path.join(out, 'tiles', 'manifest.json'), 'utf8'))
  assert.deepEqual(man.deeper.map((e: { level: number }) => e.level), [-1])
  assert.deepEqual(man.deeper[0].presentRle, toRle(block), 'deeper presence lists exactly the copied tiles')
  assert.deepEqual(man.deeper[0].detail.presentRle, toRle(block.slice(0, 2)))
  assert.equal(man.deeper[0].detail.path, 'd')
  assert.deepEqual(man.deeper[0].regions, ['sample-block'])
  assert.equal(fs.existsSync(path.join(out, '.stage')), false, 'the staging folder is removed')
  for (const i of block) assert.ok(fs.existsSync(path.join(out, 'tiles', 'h', '-1', `${i % nx1}_${Math.floor(i / nx1)}.bin.gz`)))
  assert.equal(fs.existsSync(path.join(out, 'tiles', 'h', '-1', `${outside % nx1}_${Math.floor(outside / nx1)}.bin.gz`)), false)

  const sample = JSON.parse(fs.readFileSync(path.join(out, 'sample-manifest.json'), 'utf8'))
  assert.equal(sample.schema, 'moon-sample-set/1')
  assert.equal(sample.licence, 'public')
  assert.deepEqual(sample.layers.map((l: { path: string }) => l.path), ['tiles/c', 'tiles/d', 'tiles/h'])
  assert.deepEqual(sample.layers.find((l: { path: string }) => l.path === 'tiles/d').creditIds, ['lunar-tiles'])
  assert.equal(fs.readFileSync(path.join(out, 'DATA-LICENSES.md'), 'utf8'), fs.readFileSync(path.join(ROOT, 'DATA-LICENSES.md'), 'utf8'))
  const sums = fs.readFileSync(path.join(out, 'SHA256SUMS'), 'utf8').trim().split('\n').map((l) => l.split('  '))
  const listed = sums.map(([, f]) => f)
  assert.deepEqual(listed, [...listed].sort(), 'SHA256SUMS is sorted')
  assert.ok(listed.includes('sample-manifest.json') && listed.includes('tiles/manifest.json') && !listed.includes('SHA256SUMS'))
  for (const [h, f] of sums) assert.equal(h, sha256(path.join(out, f)), `${f} checksum`)
  const files: string[] = []
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name))
      else files.push(path.relative(out, path.join(d, e.name)))
    }
  }
  walk(out)
  assert.deepEqual(files.filter((f) => f !== 'SHA256SUMS').sort(), [...listed].sort(), 'every packaged file is checksummed')

  write(path.join(out, 'tc', 'v3', 'tc.json'), '{}')
  refuses(() => finalise(out, { region: DEFAULT_REGION, steps: [], gitCommit: 'x', maxMb: 1 }), /tc\/v3\/tc\.json: not a public sample layer/)
  fs.rmSync(path.join(out, 'tc'), { recursive: true })
  refuses(() => finalise(out, { region: DEFAULT_REGION, steps: [], gitCommit: 'x', maxMb: 1e-6 }), /over --max-mb/)
  refuses(() => makePlan(o), /exists and is not empty/)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('sample-set ok')
