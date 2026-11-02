// Dev only: a tile directory for the deeper-level path built from a pipeline's `deeper.partial.<layer>.json` files (moon-terrain's sample blocks,
// TILE-CONTRACT.md 1b). The built three levels are symlinked from an existing set; the deeper tiles are NOT copied: run the dev server with
// MOON_DEEP_REDIRECT=<the sample's public base> and the browser loads them from there.
//   node --import tsx scripts/make-sample-manifest.mts <existing tiles dir> <out dir> <deeper.partial.sldem.json> [deeper.partial.wac.json]
import fs from 'node:fs'
import path from 'node:path'
const [src, out, sldem, wac] = process.argv.slice(2)
const man = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'))
fs.mkdirSync(path.join(out, 'h'), { recursive: true }); fs.mkdirSync(path.join(out, 'c'), { recursive: true })
for (const l of [0, 1, 2]) for (const k of ['h', 'c']) { const d = path.join(out, k, String(l)); if (!fs.existsSync(d)) fs.symlinkSync(path.resolve(src, k, String(l)), d) }
const h = JSON.parse(fs.readFileSync(sldem, 'utf8')) as { stepM: number; levels: Record<string, { presentRle: Array<[number, number]> }> }
const c = wac ? JSON.parse(fs.readFileSync(wac, 'utf8')) as typeof h : null
man.deeper = Object.keys(h.levels).map(Number).sort((a, b) => b - a).map((level) => ({
  level, tileDeg: 5 * 2 ** level, ppd: 64 * 2 ** -level, texelKm: man.height.texelKm * 2 ** level, stepM: h.stepM,
  presentRle: h.levels[String(level)].presentRle,
  ...(c?.levels[String(level)] ? { color: { presentRle: c.levels[String(level)].presentRle, bakedSun: true } } : {}),
  regions: ['sample-a11-block'], source: 'moon-terrain sample block (SLDEM2015 heights, WAC colour)',
}))
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(man))
console.log('deeper levels:', man.deeper.map((e: { level: number }) => e.level).join(', '))
