#!/usr/bin/env node
/**
 * Stage a local NASA SVS 2025 4k sRGB color map without touching live assets.
 * Usage: node scripts/terrain/stage_svs_color.mjs --src /path/lroc_color_16bit_srgb_4k.tif --out .moon-svs-color-candidate/run-name
 * The PNG preserves 16-bit sRGB values; the JPEG is a controlled 8-bit browser-sized comparison copy.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

export const SOURCE_NAME = 'lroc_color_16bit_srgb_4k.tif'
export const SOURCE_URL = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_4k.tif'
export const SVS_URL = 'https://svs.gsfc.nasa.gov/4720/'
const EXPECTED = { width: 4096, height: 2048, channels: 3 }
const MAX_PIXELS = EXPECTED.width * EXPECTED.height
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export function validateSourceMetadata(file, metadata) {
  if (path.basename(file) !== SOURCE_NAME) throw new Error(`source must be named exactly ${SOURCE_NAME}`)
  if (metadata.format !== 'tiff') throw new Error('source must be a TIFF, not an EXR or converted image')
  if (metadata.pages !== 1) throw new Error(`expected a single-page TIFF, got ${metadata.pages} pages`)
  if (metadata.orientation !== 1) throw new Error(`expected default orientation 1, got ${metadata.orientation}`)
  if (metadata.hasAlpha) throw new Error('expected an opaque RGB source without alpha')
  if (metadata.width !== EXPECTED.width || metadata.height !== EXPECTED.height || metadata.channels !== EXPECTED.channels) {
    throw new Error(`expected ${EXPECTED.width}x${EXPECTED.height} RGB TIFF, got ${metadata.width}x${metadata.height} with ${metadata.channels} channels`)
  }
  if (metadata.depth !== 'ushort') throw new Error(`expected 16-bit source samples, got ${metadata.depth}`)
  // libvips reports this NASA 16-bit TIFF as rgb16 (with an embedded ICC profile),
  // while 8-bit sRGB inputs are reported as srgb.
  const iccText = metadata.icc?.toString('latin1') ?? ''
  if (/linear/i.test(metadata.xmpAsString ?? '')) throw new Error('source metadata declares linear transfer, expected sRGB')
  if (!['rgb16', 'srgb'].includes(metadata.space) || !metadata.hasProfile || !metadata.icc
    || !/sRGB/i.test(iccText) || !/61966-2\.1/.test(iccText)) {
    throw new Error(`expected a profiled sRGB TIFF, got ${metadata.space} with profile=${!!metadata.hasProfile}`)
  }
  return true
}

export function validateOutputPath(out) {
  const resolved = path.resolve(repoRoot, out)
  const relative = path.relative(repoRoot, resolved)
  const first = relative.split(path.sep)[0]
  if (relative.startsWith('..') || path.isAbsolute(relative) || first !== '.moon-svs-color-candidate') {
    throw new Error('output must be inside the ignored .moon-svs-color-candidate directory')
  }
  if (resolved === path.join(repoRoot, '.moon-svs-color-candidate')) throw new Error('choose a fresh child directory under .moon-svs-color-candidate')
  return resolved
}

async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function cliArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--src' || argv[i] === '--out') {
      const key = argv[i].slice(2)
      if (!argv[i + 1] || argv[i + 1].startsWith('--') || args[key]) throw new Error(`expected one value after --${key}`)
      args[key] = argv[++i]
    } else throw new Error(`unknown argument ${argv[i]}`)
  }
  if (!args.src || !args.out) throw new Error(`usage: node scripts/terrain/stage_svs_color.mjs --src /path/${SOURCE_NAME} --out .moon-svs-color-candidate/run-name`)
  return args
}

export async function stageColor({ src, out }) {
  const source = path.resolve(src)
  const output = validateOutputPath(out)
  if (source === output || source.startsWith(`${output}${path.sep}`)) throw new Error('source cannot be inside the candidate output directory')
  const inputMeta = await sharp(source, { limitInputPixels: MAX_PIXELS }).metadata()
  validateSourceMetadata(source, inputMeta)
  const sourceHash = await sha256(source)

  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.mkdir(output, { recursive: false })
  try {
    sharp.concurrency(1)
    const pngName = 'moon-color-2025-4k-16bit.png'
    const jpegName = 'moon-color-2025-4k-q88.jpg'
    const pngPath = path.join(output, pngName)
    const jpegPath = path.join(output, jpegName)
    // rgb16 keeps the encoded sRGB channel values at 16 bits through the PNG writer.
    await sharp(source, { limitInputPixels: MAX_PIXELS })
      .toColourspace('rgb16')
      .withIccProfile('srgb')
      .png({ bitdepth: 16, compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toFile(pngPath)
    // This companion matches the old base map's nominal JPEG quality while making chroma subsampling explicit.
    await sharp(source, { limitInputPixels: MAX_PIXELS })
      .toColourspace('srgb')
      .withIccProfile('srgb')
      .jpeg({ quality: 88, chromaSubsampling: '4:4:4', progressive: false, mozjpeg: false })
      .toFile(jpegPath)

    const pngMeta = await sharp(pngPath).metadata()
    if (pngMeta.width !== EXPECTED.width || pngMeta.height !== EXPECTED.height || pngMeta.depth !== 'ushort' || pngMeta.channels !== 3) {
      throw new Error(`16-bit PNG validation failed: ${pngMeta.width}x${pngMeta.height}, ${pngMeta.depth}, ${pngMeta.channels} channels`)
    }
    const jpegMeta = await sharp(jpegPath).metadata()
    if (jpegMeta.width !== EXPECTED.width || jpegMeta.height !== EXPECTED.height || jpegMeta.depth !== 'uchar' || jpegMeta.channels !== 3) {
      throw new Error(`JPEG validation failed: ${jpegMeta.width}x${jpegMeta.height}, ${jpegMeta.depth}, ${jpegMeta.channels} channels`)
    }
    const provenance = {
      product: 'NASA SVS CGI Moon Kit, 2025 4k color map',
      source: { file: SOURCE_NAME, url: SOURCE_URL, page: SVS_URL, sha256: sourceHash, width: inputMeta.width, height: inputMeta.height, channels: inputMeta.channels, depth: inputMeta.depth, transfer: 'sRGB encoded (NASA product description; embedded ICC profile present)' },
      outputs: [
        { file: pngName, sha256: await sha256(pngPath), width: pngMeta.width, height: pngMeta.height, channels: pngMeta.channels, depth: pngMeta.depth, transfer: 'sRGB encoded', profile: 'sRGB ICC', settings: { output: 'PNG', colourspace: 'rgb16', bitdepth: 16, compressionLevel: 9, adaptiveFiltering: false, palette: false } },
        { file: jpegName, sha256: await sha256(jpegPath), width: jpegMeta.width, height: jpegMeta.height, channels: jpegMeta.channels, depth: jpegMeta.depth, transfer: 'sRGB encoded', profile: 'sRGB ICC', settings: { output: 'JPEG', quality: 88, chromaSubsampling: '4:4:4', progressive: false, mozjpeg: false } },
      ],
      credit: "NASA's Scientific Visualization Studio; Visualizer: Ernie Wright (USRA); Scientist: Noah Petro (NASA/GSFC). Color source adapted from the LROC Hapke Normalized WAC Mosaic (LRO Camera team / Arizona State University).",
      note: 'Aesthetic color map, not a scientific reflectance product; SVS documents lower-resolution monochrome LDAM fill poleward of the WAC coverage.',
      convertedAt: new Date().toISOString(),
      converter: { file: 'scripts/terrain/stage_svs_color.mjs', sharp: sharp.versions.sharp, libvips: sharp.versions.vips, policy: 'local input only; no downloads; one Sharp worker; output must be an ignored candidate path' },
    }
    await fs.writeFile(path.join(output, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, { flag: 'wx' })
    return provenance
  } catch (error) {
    await fs.rm(output, { recursive: true, force: true })
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = await cliArgs(process.argv.slice(2))
    const result = await stageColor(args)
    console.log(JSON.stringify({ output: path.resolve(repoRoot, args.out), outputs: result.outputs }, null, 2))
  } catch (error) {
    console.error(`stage_svs_color: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
