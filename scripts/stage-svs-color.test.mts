import assert from 'node:assert/strict'
import { validateOutputPath, validateSourceMetadata, SOURCE_NAME, SOURCE_URL } from '../scripts/terrain/stage_svs_color.mjs'

const valid = {
  format: 'tiff', width: 4096, height: 2048, channels: 3, depth: 'ushort', space: 'rgb16',
  pages: 1, orientation: 1, hasAlpha: false,
  hasProfile: true, icc: Buffer.from('sRGB IEC61966-2.1 profile'), xmpAsString: '<transfer>sRGB IEC61966-2.1</transfer>',
}
assert.equal(validateSourceMetadata(`/data/${SOURCE_NAME}`, valid), true)
assert.equal(SOURCE_URL, 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_4k.tif')
assert.throws(() => validateSourceMetadata('/data/moon.exr', { ...valid, format: 'exr' }), /named exactly/)
assert.throws(() => validateSourceMetadata(`/data/${SOURCE_NAME}`, { ...valid, depth: 'float' }), /16-bit source samples/)
assert.throws(() => validateSourceMetadata(`/data/${SOURCE_NAME}`, { ...valid, space: 'scrgb' }), /profiled sRGB/)
assert.throws(() => validateSourceMetadata(`/data/${SOURCE_NAME}`, { ...valid, xmpAsString: '<transfer>linear</transfer>' }), /declares linear transfer/)
assert.throws(() => validateSourceMetadata(`/data/${SOURCE_NAME}`, { ...valid, icc: Buffer.from('linear RGB profile'), xmpAsString: '<transfer>sRGB IEC61966-2.1</transfer>' }), /profiled sRGB/)
assert.throws(() => validateSourceMetadata(`/data/${SOURCE_NAME}`, { ...valid, hasProfile: false, icc: undefined }), /profiled sRGB/)
assert.throws(() => validateSourceMetadata(`/data/${SOURCE_NAME}`, { ...valid, width: 8192 }), /expected 4096x2048/)
assert.throws(() => validateSourceMetadata(`/data/${SOURCE_NAME}`, { ...valid, pages: 2 }), /single-page TIFF/)
assert.throws(() => validateSourceMetadata(`/data/${SOURCE_NAME}`, { ...valid, orientation: 6 }), /orientation 1/)
assert.throws(() => validateSourceMetadata(`/data/${SOURCE_NAME}`, { ...valid, hasAlpha: true }), /without alpha/)
assert.throws(() => validateOutputPath('shared-assets/moon-color-4k.jpg'), /ignored .moon-svs-color-candidate/)
assert.throws(() => validateOutputPath('.moon-svs-color-candidate'), /fresh child directory/)
assert.match(validateOutputPath('.moon-svs-color-candidate/run-a'), /\.moon-svs-color-candidate\/run-a$/)
console.log('stage-svs-color: ok')
