#!/usr/bin/env node
/**
 * Builds the Earth's maps for the Moon site (public/earth/) from NASA sources.
 *
 *   node scripts/build-earth-maps.mjs [--src <cache dir>] [--out <dir>] [--width 2048]
 *
 * Sources are downloaded once into --src (default: $TMPDIR/skylumi-earth-src),
 * never into the repository. Outputs, each 2048 x 1024 plate carree (180 W at
 * the left edge, 90 N at the top, the same grid as the sources):
 *
 *   albedo-01.jpg .. albedo-12.jpg  surface albedo, linear, sRGB-encoded (one
 *                                   per month; the page loads only the month
 *                                   it shows)
 *   clouds.jpg                      cloud cover, 0..1, linear (grey)
 *   lights.jpg                      night lights, radiance / LIGHTS_REF_NW,
 *                                   sRGB-encoded (grey)
 *   water.png                       water fraction of each pixel, 0..1 (grey)
 *   credits.json                    sources, credit lines, what each map means
 *
 * What each conversion assumes is stated where it is done. Every average is
 * taken in linear units (albedo, radiance, area fraction), never on the
 * encoded 8-bit values.
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const siteRoot = path.resolve(here, '..')
// The source-side record is bundled into EarthPass; public/earth/credits.json
// adds this build's concrete output sizes to the same attribution metadata.
const EARTH_CREDIT_META = JSON.parse(fs.readFileSync(path.join(siteRoot, 'src/earth/credits.json'), 'utf8'))
// sharp is a devDependency of this repo: a build tool, not bundled into the site.
const sharp = createRequire(path.resolve(siteRoot, 'package.json'))('sharp')

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const SRC = path.resolve(arg('--src', path.join(os.tmpdir(), 'skylumi-earth-src')))
const OUT = path.resolve(arg('--out', path.join(siteRoot, 'public/earth')))
const W = Number(arg('--width', '2048'))
const H = W / 2
const ONLY = arg('--only', '') // albedo | clouds | lights | water | credits (debug)

// ---------------------------------------------------------------- sources

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const BMNG = 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng'
const EO = 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords'

const SOURCES = {
  // Blue Marble: Next Generation with Topography and Bathymetry, 8 km (5400 x 2700), 2004.
  ...Object.fromEntries(MONTHS.map((m, i) => {
    const mm = String(i + 1).padStart(2, '0')
    return [`bmng-${mm}`, {
      file: `world.topo.bathy.2004${mm}.3x5400x2700.jpg`,
      url: `${BMNG}/bmng-topography-bathymetry/${m}/world.topo.bathy.2004${mm}.3x5400x2700.jpg`,
    }]
  })),
  // The same without relief shading, for the water pixels (BMNG water does
  // not change with the month, so one month serves all twelve).
  'bmng-plain': {
    file: 'world.200401.3x5400x2700.jpg',
    url: `${BMNG}/bmng-base/january/world.200401.3x5400x2700.jpg`,
    fallback: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73938/world.200401.3x5400x2700.jpg',
  },
  // Blue Marble clouds (2002), 2048 x 1024.
  clouds: {
    file: 'cloud_combined_2048.jpg',
    url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg',
  },
  // Earth at Night (Black Marble) 2016, grey, 3 km (13500 x 6750).
  lights: {
    file: 'BlackMarble_2016_3km_gray.jpg',
    url: `${EO}/144000/144897/BlackMarble_2016_3km_gray.jpg`,
  },
  // MODIS 250 m land-water mask (MOD44W) as rendered by NASA GIBS, fetched at
  // 3x the BMNG grid so each 8 km pixel gets a water fraction. One request for
  // the whole globe times out (504), so it comes as eight 90 x 90 deg tiles.
  ...Object.fromEntries([0, 1, 2, 3].flatMap((i) => [0, 1].map((j) => {
    const lon0 = -180 + 90 * i, lat0 = 90 - 90 * (j + 1)
    return [`water-${i}${j}`, {
      file: `MODIS_Water_Mask_${lon0}_${lat0}_4050.png`,
      url: `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Water_Mask&STYLES=&CRS=EPSG:4326&BBOX=${lat0},${lon0},${lat0 + 90},${lon0 + 90}&WIDTH=4050&HEIGHT=4050&FORMAT=image/png`,
      tile: { i, j },
    }]
  }))),
}

function download(key) {
  const s = SOURCES[key]
  const dest = path.join(SRC, s.file)
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return dest
  fs.mkdirSync(SRC, { recursive: true })
  for (const url of [s.url, s.fallback].filter(Boolean)) {
    try {
      console.log(`fetch ${url}`)
      // curl honours the sandbox proxy; --max-time because some hosts stall
      // instead of failing.
      execFileSync('curl', ['-sSfL', '--retry', '2', '--max-time', '600', '-o', `${dest}.part`, url], { stdio: 'inherit' })
      fs.renameSync(`${dest}.part`, dest)
      return dest
    } catch (e) {
      console.warn(`  failed: ${e.message.split('\n')[0]}`)
    }
  }
  throw new Error(`could not download ${key}`)
}

// ---------------------------------------------------------------- helpers

async function readRaw(file, channels) {
  const img = sharp(file, { limitInputPixels: false })
  const { data, info } = await (channels === 1 ? img.greyscale() : img.removeAlpha()).raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

/**
 * Area-weighted resample of a float plane (w x h, c channels interleaved) to
 * (W2 x H2): each output pixel is the exact area mean of the input pixels it
 * covers. Separable: rows first, then columns.
 */
function resampleArea(src, w, h, c, W2, H2) {
  const weights = (n, n2) => {
    const scale = n / n2
    const out = []
    for (let i = 0; i < n2; i++) {
      const a = i * scale, b = (i + 1) * scale
      const taps = []
      for (let j = Math.floor(a); j < Math.min(n, Math.ceil(b)); j++) {
        const wgt = Math.min(b, j + 1) - Math.max(a, j)
        if (wgt > 1e-9) taps.push([j, wgt / scale])
      }
      out.push(taps)
    }
    return out
  }
  const wx = weights(w, W2), wy = weights(h, H2)
  const tmp = new Float32Array(W2 * h * c)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < W2; x++) {
      for (let k = 0; k < c; k++) {
        let s = 0
        for (const [j, wgt] of wx[x]) s += src[(y * w + j) * c + k] * wgt
        tmp[(y * W2 + x) * c + k] = s
      }
    }
  }
  const out = new Float32Array(W2 * H2 * c)
  for (let y = 0; y < H2; y++) {
    for (let x = 0; x < W2; x++) {
      for (let k = 0; k < c; k++) {
        let s = 0
        for (const [j, wgt] of wy[y]) s += tmp[(j * W2 + x) * c + k] * wgt
        out[(y * W2 + x) * c + k] = s
      }
    }
  }
  return out
}

const srgbDecode = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const srgbEncode = (l) => {
  l = Math.min(1, Math.max(0, l))
  return l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055
}

async function writeImage(file, plane, w, h, c, { encode = (x) => x, format = 'jpeg', quality = 88 } = {}) {
  const buf = Buffer.alloc(w * h * c)
  for (let i = 0; i < w * h * c; i++) buf[i] = Math.round(Math.min(1, Math.max(0, encode(plane[i]))) * 255)
  let img = sharp(buf, { raw: { width: w, height: h, channels: c } })
  if (c === 1) img = img.toColourspace('b-w')
  img = format === 'png'
    ? img.png({ compressionLevel: 9, palette: false })
    : img.jpeg({ quality, mozjpeg: true, chromaSubsampling: c === 1 ? undefined : '4:4:4' })
  await img.toFile(file)
  return fs.statSync(file).size
}

// ------------------------------------------------ Blue Marble -> reflectance

/**
 * BMNG maps MODIS surface reflectance (band 1 620-670 nm, band 4 545-565 nm,
 * band 3 459-479 nm) to 8-bit RGB with a cubic spline through four published
 * knots (Stockli et al. 2005, "The Blue Marble Next Generation", Table 1):
 * 0% -> 0, 25% -> 179, 75% -> 240, 100% -> 255. The spline's exact form is
 * not published; a natural cubic through these knots is not monotonic (it
 * overshoots between 55% and 75%), so this inverts a monotone cubic
 * (Fritsch-Carlson) through the same knots. The narrow MODIS bands sit near
 * the centres of the sRGB primaries, so their reflectances are used as linear
 * sRGB albedo directly: an approximation, not a colour conversion.
 */
function bmngInverseLut() {
  const xs = [0, 0.25, 0.75, 1.0]
  const ys = [0, 179, 240, 255]
  const n = xs.length
  const hs = [], ds = []
  for (let i = 0; i < n - 1; i++) { hs.push(xs[i + 1] - xs[i]); ds.push((ys[i + 1] - ys[i]) / hs[i]) }
  const m = new Array(n)
  m[0] = ((2 * hs[0] + hs[1]) * ds[0] - hs[0] * ds[1]) / (hs[0] + hs[1])
  m[n - 1] = ((2 * hs[n - 2] + hs[n - 3]) * ds[n - 2] - hs[n - 2] * ds[n - 3]) / (hs[n - 2] + hs[n - 3])
  for (let i = 1; i < n - 1; i++) {
    const w1 = 2 * hs[i] + hs[i - 1], w2 = hs[i] + 2 * hs[i - 1]
    m[i] = ds[i - 1] * ds[i] > 0 ? (w1 + w2) / (w1 / ds[i - 1] + w2 / ds[i]) : 0
  }
  const f = (x) => {
    let i = 0
    while (i < n - 2 && x > xs[i + 1]) i++
    const h = hs[i], t = (x - xs[i]) / h
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t
    const h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2
    return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1]
  }
  const lut = new Float32Array(256)
  for (let v = 0; v < 256; v++) {
    let lo = 0, hi = 1
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (f(mid) < v) lo = mid; else hi = mid }
    lut[v] = (lo + hi) / 2
  }
  return lut
}

async function buildWaterFraction() {
  // GIBS renders MOD44W water as an opaque cyan and land as transparent.
  const T = 4050, width = 4 * T, height = 2 * T
  const plane = new Float32Array(width * height)
  for (const [key, s] of Object.entries(SOURCES)) {
    if (!s.tile) continue
    const { data, info } = await sharp(download(key)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (info.width !== T || info.height !== T) throw new Error(`${key}: unexpected tile size`)
    const x0 = s.tile.i * T, y0 = s.tile.j * T
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) plane[(y0 + y) * width + x0 + x] = data[(y * T + x) * 4 + 3] > 127 ? 1 : 0
    }
  }
  return { plane, width, height }
}

async function buildAlbedo(water5400) {
  const lut = bmngInverseLut()
  const plain = await readRaw(download('bmng-plain'), 3)
  const reports = []
  for (let mi = 0; mi < 12; mi++) {
    const mm = String(mi + 1).padStart(2, '0')
    const topo = await readRaw(download(`bmng-${mm}`), 3)
    const { width: w, height: h } = topo
    if (w !== plain.width || w !== water5400.width) throw new Error('grid mismatch')
    const refl = new Float32Array(w * h * 3)
    for (let i = 0; i < w * h; i++) {
      // Land: the relief-shaded month. Water: the unshaded map, because the
      // bathymetric shading is a drawing of the sea floor, not the sea's
      // colour. Deep ocean in BMNG is itself a constant the authors chose
      // (band 1 0.2%, band 4 0.55%, band 3 2%), not an observation.
      const f = water5400.plane[i]
      for (let k = 0; k < 3; k++) {
        refl[i * 3 + k] = (1 - f) * lut[topo.data[i * 3 + k]] + f * lut[plain.data[i * 3 + k]]
      }
    }
    const out = resampleArea(refl, w, h, 3, W, H)
    const file = path.join(OUT, `albedo-${mm}.jpg`)
    const size = await writeImage(file, out, W, H, 3, { encode: srgbEncode, quality: 86 })
    reports.push({ file: path.basename(file), bytes: size })
    console.log(`albedo-${mm}.jpg  ${(size / 1024).toFixed(0)} KB`)
    if (mi === 0) sampleAlbedo(out)
  }
  return reports
}

// Albedo at a few places, as a check on the inversion (January).
function sampleAlbedo(plane) {
  const at = (lat, lon) => {
    const x = Math.floor(((lon + 180) / 360) * W), y = Math.floor(((90 - lat) / 180) * H)
    const i = (y * W + x) * 3
    return [plane[i], plane[i + 1], plane[i + 2]].map((v) => v.toFixed(3)).join(' ')
  }
  const places = {
    'Sahara (Libya, 25N 15E)': [25, 15],
    'Rub al Khali (20N 50E)': [20, 50],
    'Amazon forest (3S 62W)': [-3, -62],
    'Congo forest (0N 22E)': [0, 22],
    'Antarctic plateau (80S 90E)': [-80, 90],
    'Greenland (75N 40W)': [75, -40],
    'Pacific (0N 150W)': [0, -150],
    'Bahamas banks (24N 77.5W)': [24, -77.5],
  }
  for (const [k, [la, lo]] of Object.entries(places)) console.log(`  ${k.padEnd(30)} ${at(la, lo)}`)
}

// ---------------------------------------------------------------- clouds

/**
 * The Blue Marble cloud layer (2002) is a composite of two days of MODIS
 * visible imagery and a day of thermal infrared over the poles, scaled for
 * display. It is used as cloud cover c = (DN/255)^CLOUD_GAMMA, and the shader
 * gives full cover the albedo of a thick cloud deck. CLOUD_GAMMA is the one
 * free parameter: 1.0 keeps the layer as drawn; it is set so the full Earth
 * comes out near its measured geometric albedo (see src/earth/README.md).
 */
const CLOUD_GAMMA = 1.0

async function buildClouds() {
  const src = await readRaw(download('clouds'), 1)
  const plane = new Float32Array(src.width * src.height)
  let sum = 0
  for (let i = 0; i < plane.length; i++) { plane[i] = (src.data[i] / 255) ** CLOUD_GAMMA; sum += plane[i] }
  const out = src.width === W ? plane : resampleArea(plane, src.width, src.height, 1, W, H)
  const file = path.join(OUT, 'clouds.jpg')
  const size = await writeImage(file, out, W, H, 1, { quality: 88 })
  console.log(`clouds.jpg  ${(size / 1024).toFixed(0)} KB  (mean cover ${(sum / plane.length).toFixed(3)}, unweighted by area)`)
  return { file: 'clouds.jpg', bytes: size }
}

// ---------------------------------------------------------------- lights

/**
 * Black Marble 2016 (grey) is a display stretch of VIIRS day/night band
 * radiance whose transfer curve is not published with the image. It is
 * decoded here as a display gamma (sRGB), so DN 255 is taken as
 * LIGHTS_REF_NW and a DN of 20 as ~1/200 of that. The result is stored
 * relative to LIGHTS_REF_NW, sRGB-encoded; the shader turns it into I/F with
 * the conversion documented at LIGHTS_REF_NW in src/earth/earthShader.ts.
 * A modelled calibration: good to a factor of ~2-3, not a measurement.
 */
async function buildLights() {
  const src = await readRaw(download('lights'), 1)
  const lin = new Float32Array(src.width * src.height)
  for (let i = 0; i < lin.length; i++) lin[i] = srgbDecode(src.data[i] / 255)
  const out = resampleArea(lin, src.width, src.height, 1, W, H)
  let max = 0
  for (const v of out) max = Math.max(max, v)
  const file = path.join(OUT, 'lights.jpg')
  const size = await writeImage(file, out, W, H, 1, { encode: srgbEncode, quality: 90 })
  console.log(`lights.jpg  ${(size / 1024).toFixed(0)} KB  (brightest 2048-px cell ${max.toFixed(3)} of the 3 km maximum)`)
  return { file: 'lights.jpg', bytes: size }
}

async function buildWaterOut(waterHi) {
  const out = resampleArea(waterHi.plane, waterHi.width, waterHi.height, 1, W, H)
  const file = path.join(OUT, 'water.png')
  const size = await writeImage(file, out, W, H, 1, { format: 'png' })
  console.log(`water.png  ${(size / 1024).toFixed(0)} KB`)
  return { file: 'water.png', bytes: size }
}

// ---------------------------------------------------------------- credits

function credits(files) {
  return {
    ...EARTH_CREDIT_META,
    grid: `${W} x ${H} plate carree, 180 W at the left edge, 90 N at the top`,
    maps: {
      ...EARTH_CREDIT_META.maps,
      'clouds.jpg': `Cloud cover 0..1, stored linearly (not sRGB). c = (DN/255)^${CLOUD_GAMMA}. A single moment in 2002, not the current weather.`,
    },
    files,
  }
}

// ---------------------------------------------------------------- main

if (ONLY === 'download') {
  for (const k of Object.keys(SOURCES)) download(k)
  process.exit(0)
}
fs.mkdirSync(OUT, { recursive: true })
const files = []
const want = (k) => !ONLY || ONLY === k
const waterHi = (want('albedo') || want('water')) ? await buildWaterFraction() : null
if (want('water')) files.push(await buildWaterOut(waterHi))
if (want('albedo')) {
  // The water fraction on the BMNG grid (5400 x 2700) from the 3x mask.
  const w5400 = { plane: resampleArea(waterHi.plane, waterHi.width, waterHi.height, 1, 5400, 2700), width: 5400 }
  files.push(...await buildAlbedo(w5400))
}
if (want('clouds')) files.push(await buildClouds())
if (want('lights')) files.push(await buildLights())
if (!ONLY) {
  fs.writeFileSync(path.join(OUT, 'credits.json'), JSON.stringify(credits(files), null, 2) + '\n')
  const total = files.reduce((s, f) => s + f.bytes, 0)
  console.log(`total ${(total / 1024 / 1024).toFixed(2)} MB in ${OUT}`)
}
