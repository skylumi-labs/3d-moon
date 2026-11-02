import assert from 'node:assert/strict'
import fs from 'node:fs'
import sourceCredits from '../src/earth/credits.json'

// The bundled attribution metadata and generated public record must agree.
// The builder adds a concrete grid, cloud-conversion exponent and file sizes.
const generated = JSON.parse(fs.readFileSync(new URL('../public/earth/credits.json', import.meta.url), 'utf8')) as typeof sourceCredits & {
  files: { file: string; bytes: number }[]
}
assert.equal(generated.note, sourceCredits.note)
assert.deepEqual(generated.sources, sourceCredits.sources)
assert.deepEqual(generated.maps['albedo-MM.jpg'], sourceCredits.maps['albedo-MM.jpg'])
assert.deepEqual(generated.maps['lights.jpg'], sourceCredits.maps['lights.jpg'])
assert.deepEqual(generated.maps['water.png'], sourceCredits.maps['water.png'])
assert.equal(generated.maps['clouds.jpg'], 'Cloud cover 0..1, stored linearly (not sRGB). c = (DN/255)^1. A single moment in 2002, not the current weather.')
assert.match(generated.grid, /^2048 x 1024 plate carree,/)
assert.deepEqual(generated.sources.map((source) => source.id), ['bmng', 'clouds', 'black-marble', 'water-mask'])
assert.ok(generated.files.length > 0 && generated.files.every((file) => file.bytes > 0), 'public record retains built-file sizes')
console.log('earth-credits ok')
