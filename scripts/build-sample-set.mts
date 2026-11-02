// Builds the offline sample set (plan 3c, owner decision D4): levels 0..2 from the NASA SVS rasters with level 0 limited to one block,
// the deeper SLDEM heights and WAC detail of that block copied from a local copy of the hosted tiles, and optionally the Apollo 11 patch.
// Public-cleared layers only; anything tagged internal-only, or under an internal prefix, stops the run. Writes a sample manifest,
// a SHA256SUMS file and a copy of DATA-LICENSES.md next to the data, then (with --tar) one archive for the release asset.
// It never uploads: the upload is a separate, manual step (see the PR that added this script).
//
//   node --import tsx scripts/build-sample-set.mts --svs <dir> --out <dir> [--deeper <tiles dir>] [--patch <patch/a11 dir>]
//        [--region lon0,lon1,lat0,lat1] [--max-mb 50] [--assume-public] [--tar] [--dry-run]
//
// --svs     ldem64.raw and color_full.tif, as scripts/build-tiles-m2.mts reads them (NASA SVS 4720)
// --deeper  a tiles folder with the hosted manifest.json (its `deeper` block) and h/<L>/, d/<L>/ tiles for the block (levels -1..-3)
// --patch   a folder holding a site patch (manifest.json with licence "public"); copied to patch/<site>/
// --region  default 20,25,0,5: the 5 degree block around Apollo 11
// --need   print the deeper tile paths the region needs (from --deeper's manifest.json alone) and stop: the download list
// --assume-public  count a --patch manifest that names no licence as NASA/USGS public data (as scripts/build-coverage.mts does); one tagged
//           internal-only is still refused
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SAMPLE_NAME = 'moon-sample-v1'
export const DEFAULT_REGION: Region = [20, 25, 0, 5]
export const DEFAULT_MAX_MB = 50
export const DEEPER_LEVELS = [-1, -2, -3]
export const DETAIL_LEVELS = [-1, -2]
export type Region = [number, number, number, number]

/** The only layers a sample set may hold, with the Credits rows (DATA-LICENSES.md) that cover them. */
export const PUBLIC_LAYERS: Readonly<Record<string, readonly string[]>> = {
  'tiles/h': ['moon-base', 'lunar-tiles'],
  'tiles/c': ['moon-base'],
  'tiles/d': ['lunar-tiles'],
  'patch/a11': ['apollo-11'],
  'patch/a17': ['apollo-17'],
}
/** Files a sample set holds besides its layers. */
export const SAMPLE_FILES = ['tiles/manifest.json', 'tiles/build-summary.json', 'sample-manifest.json', 'SHA256SUMS', 'DATA-LICENSES.md']
/** Path segments that mark restricted data (own prefixes and layer ids). */
export const INTERNAL_SEGMENT = /^(\.?internal|internal-only|restricted)$/i

export class SampleSetError extends Error {}
const fail = (msg: string): never => { throw new SampleSetError(msg) }

/** Refuses a source folder whose path names an internal prefix. */
export function assertPublicPath(p: string, what: string): void {
  const bad = path.resolve(p).split(path.sep).find((s) => INTERNAL_SEGMENT.test(s))
  if (bad) fail(`${what} ${p} is under an internal-only prefix ("${bad}"); a sample set takes public-cleared layers only`)
}

/** Refuses a manifest (or any object in it) tagged internal-only, and, when `required`, one that does not say licence "public". */
export function assertPublicManifest(json: unknown, where: string, required = false): void {
  const walk = (v: unknown, at: string): void => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${at}[${i}]`)); return }
    if (!v || typeof v !== 'object') return
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if ((k === 'licence' || k === 'license') && x === 'internal-only') fail(`${where}${at}: tagged internal-only; a sample set takes public-cleared layers only`)
      walk(x, `${at}.${k}`)
    }
  }
  walk(json, '')
  const top = json as { licence?: unknown; license?: unknown }
  if (required && (top.licence ?? top.license) !== 'public') fail(`${where}: names no licence "public"; only manifests that say so go into a sample set`)
}

/** Does tile (tx, ty) of `level` (5 * 2^level degrees) touch the region box? */
export function tileTouches(level: number, tx: number, ty: number, [lon0, lon1, lat0, lat1]: Region): boolean {
  const d = 5 * 2 ** level
  const tl0 = -180 + tx * d, tb1 = 90 - ty * d
  return tl0 + d > lon0 && tl0 < lon1 && tb1 > lat0 && tb1 - d < lat1
}

interface Presence { present?: string; presentRle?: Array<[number, number]> }
const nxOf = (level: number): number => 360 / (5 * 2 ** level)
const nyOf = (level: number): number => 180 / (5 * 2 ** level)

/** Tile indices (ty * nx + tx) a presence block marks present. */
export function presentIndices(p: Presence | undefined, level: number): number[] {
  if (!p) return []
  if (typeof p.present === 'string') return [...p.present].flatMap((c, i) => (c === '1' ? [i] : []))
  return (p.presentRle ?? []).flatMap(([s, n]) => Array.from({ length: n }, (_, k) => s + k)).filter((i) => i < nxOf(level) * nyOf(level))
}

export function toRle(indices: readonly number[]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const i of [...indices].sort((a, b) => a - b)) {
    const last = out.at(-1)
    if (last && last[0] + last[1] === i) last[1]++
    else out.push([i, 1])
  }
  return out
}

export interface DeeperEntry extends Presence { level: number; stepM?: number; detail?: Presence & { path: string; format: string; mid: number; perOctave: number }; licence?: string }
export interface CopyItem { from: string; to: string }
export interface DeeperPlan { stepM: number; heights: Record<string, number[]>; detail: Record<string, number[]>; detailMeta?: DeeperEntry['detail']; copies: CopyItem[] }

/** The deeper tiles of the region that the hosted manifest lists and the local folder holds. */
export function planDeeper(deeperDir: string, region: Region, requireFiles = true): DeeperPlan {
  assertPublicPath(deeperDir, '--deeper')
  const manPath = path.join(deeperDir, 'manifest.json')
  if (!fs.existsSync(manPath)) fail(`--deeper ${deeperDir}: no manifest.json`)
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8')) as { deeper?: DeeperEntry[] }
  assertPublicManifest(man, manPath)
  const plan: DeeperPlan = { stepM: 0, heights: {}, detail: {}, copies: [] }
  for (const e of man.deeper ?? []) {
    if (!DEEPER_LEVELS.includes(e.level)) continue
    const inBlock = (i: number): boolean => tileTouches(e.level, i % nxOf(e.level), Math.floor(i / nxOf(e.level)), region)
    const take = (kind: 'h' | 'd', ext: string, indices: number[]): number[] => indices.filter(inBlock).filter((i) => {
      const rel = `${kind}/${e.level}/${i % nxOf(e.level)}_${Math.floor(i / nxOf(e.level))}.${ext}`
      const from = path.join(deeperDir, rel)
      if (requireFiles && !fs.existsSync(from)) fail(`--deeper: the manifest lists ${rel} but ${deeperDir} does not hold it`)
      plan.copies.push({ from, to: `tiles/${rel}` })
      return true
    })
    plan.heights[String(e.level)] = take('h', 'bin.gz', presentIndices(e, e.level))
    plan.stepM ||= e.stepM ?? 0
    if (e.detail && DETAIL_LEVELS.includes(e.level)) {
      if (e.detail.path !== 'd') fail(`--deeper: level ${e.level} detail path "${e.detail.path}" is not the public WAC detail layer "d"`)
      plan.detail[String(e.level)] = take('d', 'webp', presentIndices(e.detail, e.level))
      plan.detailMeta = { path: e.detail.path, format: e.detail.format, mid: e.detail.mid, perOctave: e.detail.perOctave }
    }
  }
  if (!Object.values(plan.heights).some((v) => v.length)) fail(`--deeper ${deeperDir}: no deeper height tiles inside the region`)
  if (!plan.stepM) fail(`--deeper ${deeperDir}: the deeper entries name no stepM`)
  return plan
}

export interface Options { svs: string; out: string; deeper?: string; patch?: string; region: Region; maxMb: number; tar: boolean; dryRun: boolean; assumePublic: boolean }

export function parseArgs(argv: readonly string[]): Options {
  const arg = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined }
  const svs = arg('svs'), out = arg('out')
  if (!svs || !out) fail('usage: --svs <dir> --out <dir> [--deeper <tiles dir>] [--patch <dir>] [--region lon0,lon1,lat0,lat1] [--max-mb 50] [--assume-public] [--tar] [--dry-run]')
  const region = (arg('region')?.split(',').map(Number) ?? DEFAULT_REGION) as Region
  if (region.length !== 4 || region.some((v) => !Number.isFinite(v)) || region[0] >= region[1] || region[2] >= region[3]) fail('--region lon0,lon1,lat0,lat1')
  const maxMb = Number(arg('max-mb') ?? DEFAULT_MAX_MB)
  if (!(maxMb > 0)) fail('--max-mb must be a positive number')
  return { svs: svs!, out: out!, deeper: arg('deeper'), patch: arg('patch'), region, maxMb, tar: argv.includes('--tar'), dryRun: argv.includes('--dry-run'), assumePublic: argv.includes('--assume-public') }
}

export interface Plan { options: Options; steps: string[][]; deeper?: DeeperPlan; patch?: { from: string; site: string } }

/** Checks every source and lists what a run would do; reads, never writes. */
export function makePlan(o: Options): Plan {
  assertPublicPath(o.svs, '--svs')
  for (const f of ['ldem64.raw', 'color_full.tif']) if (!fs.existsSync(path.join(o.svs, f))) fail(`--svs ${o.svs}: no ${f} (see scripts/build-tiles-m2.mts)`)
  if (fs.existsSync(o.out) && fs.readdirSync(o.out).length) fail(`--out ${o.out} exists and is not empty; use a fresh folder`)
  const stage = path.join(o.out, '.stage')
  const steps: string[][] = [['node', '--import', 'tsx', 'scripts/build-tiles-m2.mts', '--src', o.svs, '--out', path.join(o.out, 'tiles'), '--region', o.region.join(',')]]
  const plan: Plan = { options: o, steps }
  if (o.deeper) {
    plan.deeper = planDeeper(o.deeper, o.region)
    steps.push(['node', '--import', 'tsx', 'scripts/make-sample-manifest.mts', path.join(o.out, 'tiles'), path.join(stage, 'manifest'), path.join(stage, 'deeper.partial.sldem.json')])
  }
  if (o.patch) {
    assertPublicPath(o.patch, '--patch')
    const manPath = path.join(o.patch, 'manifest.json')
    if (!fs.existsSync(manPath)) fail(`--patch ${o.patch}: no manifest.json`)
    assertPublicManifest(JSON.parse(fs.readFileSync(manPath, 'utf8')), manPath, !o.assumePublic)
    const site = path.basename(path.resolve(o.patch))
    if (!PUBLIC_LAYERS[`patch/${site}`]) fail(`--patch ${o.patch}: site "${site}" is not a public sample layer (${Object.keys(PUBLIC_LAYERS).filter((k) => k.startsWith('patch/')).join(', ')})`)
    plan.patch = { from: o.patch, site }
  }
  return plan
}

const walkFiles = (dir: string, base = dir): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name)
  return d.isDirectory() ? walkFiles(p, base) : [path.relative(base, p).split(path.sep).join('/')]
})

/** The layer a sample file belongs to, or null for one of the fixed files; throws for anything else. */
export function layerOf(rel: string): string | null {
  if (SAMPLE_FILES.includes(rel)) return null
  const layer = Object.keys(PUBLIC_LAYERS).find((l) => rel.startsWith(`${l}/`))
  if (!layer || rel.split('/').some((s) => INTERNAL_SEGMENT.test(s))) fail(`${rel}: not a public sample layer; refusing to package it`)
  return layer!
}

export const sha256 = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

/** Writes sample-manifest.json and SHA256SUMS for a finished folder; returns the total bytes. */
export function finalise(out: string, info: { region: Region; steps: string[][]; gitCommit: string; maxMb: number }): number {
  fs.copyFileSync(path.join(ROOT, 'DATA-LICENSES.md'), path.join(out, 'DATA-LICENSES.md'))
  const files = walkFiles(out).filter((f) => f !== 'sample-manifest.json' && f !== 'SHA256SUMS').sort()
  const layers = new Map<string, { files: number; bytes: number }>()
  let total = 0
  for (const f of files) {
    const bytes = fs.statSync(path.join(out, f)).size
    total += bytes
    const l = layerOf(f)
    if (l) { const s = layers.get(l) ?? { files: 0, bytes: 0 }; s.files++; s.bytes += bytes; layers.set(l, s) }
  }
  const tilesMan = path.join(out, 'tiles', 'manifest.json')
  if (fs.existsSync(tilesMan)) assertPublicManifest(JSON.parse(fs.readFileSync(tilesMan, 'utf8')), 'tiles/manifest.json')
  if (total > info.maxMb * 1e6) fail(`sample set is ${(total / 1e6).toFixed(1)} MB, over --max-mb ${info.maxMb}; drop --patch or narrow --region`)
  const manifest = {
    schema: 'moon-sample-set/1', name: SAMPLE_NAME, gitCommit: info.gitCommit, region: info.region,
    licence: 'public', licences: 'DATA-LICENSES.md', checksums: 'SHA256SUMS',
    layers: [...layers].sort().map(([p, s]) => ({ path: p, creditIds: PUBLIC_LAYERS[p], ...s })),
    totalBytes: total, builtWith: info.steps.map((s) => s.join(' ')),
  }
  fs.writeFileSync(path.join(out, 'sample-manifest.json'), JSON.stringify(manifest, null, 1) + '\n')
  const sums = [...files, 'sample-manifest.json'].sort().map((f) => `${sha256(path.join(out, f))}  ${f}\n`).join('')
  fs.writeFileSync(path.join(out, 'SHA256SUMS'), sums)
  return total
}

function run(cmd: string[]): void {
  const r = spawnSync(cmd[0] === 'node' ? process.execPath : cmd[0], cmd.slice(1), { cwd: ROOT, stdio: 'inherit' })
  if (r.status !== 0) fail(`${cmd.join(' ')} failed (exit ${r.status ?? r.signal})`)
}

export function build(plan: Plan): void {
  const o = plan.options
  fs.mkdirSync(o.out, { recursive: true })
  const stage = path.join(o.out, '.stage')
  run(plan.steps[0])
  if (plan.deeper) {
    const d = plan.deeper
    for (const c of d.copies) { fs.mkdirSync(path.dirname(path.join(o.out, c.to)), { recursive: true }); fs.copyFileSync(c.from, path.join(o.out, c.to)) }
    fs.mkdirSync(stage, { recursive: true })
    const partial = { stepM: d.stepM, levels: Object.fromEntries(Object.entries(d.heights).filter(([, v]) => v.length).map(([l, v]) => [l, { presentRle: toRle(v) }])) }
    fs.writeFileSync(path.join(stage, 'deeper.partial.sldem.json'), JSON.stringify(partial))
    run(plan.steps[1])
    const man = JSON.parse(fs.readFileSync(path.join(stage, 'manifest', 'manifest.json'), 'utf8')) as { deeper: Array<DeeperEntry & { source: string; regions: string[] }> }
    for (const e of man.deeper) {
      e.source = 'sample block: SLDEM2015 heights (LOLA + SELENE Terrain Camera); LROC WAC detail ratio'
      e.regions = ['sample-block']
      const det = d.detail[String(e.level)]
      if (det?.length && d.detailMeta) e.detail = { ...d.detailMeta, presentRle: toRle(det) }
    }
    fs.writeFileSync(path.join(o.out, 'tiles', 'manifest.json'), JSON.stringify(man))
    fs.rmSync(stage, { recursive: true, force: true })
  }
  if (plan.patch) fs.cpSync(plan.patch.from, path.join(o.out, 'patch', plan.patch.site), { recursive: true })
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
  const total = finalise(o.out, { region: o.region, steps: plan.steps, gitCommit: git, maxMb: o.maxMb })
  console.log(`${SAMPLE_NAME}: ${(total / 1e6).toFixed(1)} MB in ${o.out}`)
  if (o.tar) {
    const tarPath = path.join(path.dirname(path.resolve(o.out)), `${SAMPLE_NAME}.tar.gz`)
    const r = spawnSync('tar', ['-czf', tarPath, '-C', o.out, '.'], { stdio: 'inherit' })
    if (r.status !== 0) fail('tar failed')
    console.log(`${tarPath}  sha256 ${sha256(tarPath)}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2)
    if (argv.includes('--need')) {
      const o = parseArgs(argv)
      if (!o.deeper) fail('--need reads the manifest.json in --deeper')
      for (const c of planDeeper(o.deeper!, o.region, false).copies) console.log(c.to.replace(/^tiles\//, ''))
      process.exit(0)
    }
    const plan = makePlan(parseArgs(argv))
    if (plan.options.dryRun) {
      console.log(JSON.stringify({
        dryRun: true, out: plan.options.out, region: plan.options.region, steps: plan.steps.map((s) => s.join(' ')),
        deeperCopies: plan.deeper?.copies.length ?? 0, deeperHeights: plan.deeper?.heights, deeperDetail: plan.deeper?.detail,
        patch: plan.patch ?? null, layers: PUBLIC_LAYERS,
      }, null, 1))
    } else build(plan)
  } catch (e) {
    if (e instanceof SampleSetError) { console.error(`build-sample-set: ${e.message}`); process.exit(1) }
    throw e
  }
}
