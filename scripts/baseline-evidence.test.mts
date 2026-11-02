import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { verifyBaseline } from '../audit/baseline.mts'
import { applyVisibilityMetadataGrey, VISIBILITY_GLSL, type VisibilityCalibration } from '../src/post/visibility.ts'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moon-baseline-test-')), hash = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const pixels = new Uint8Array(16 * 16 * 3).fill(64), mask = new Uint8Array(16 * 16 * 4)
for (let i = 0; i < 256; i++) mask.set([255, 255, 220, 20], i * 4)
const png = await sharp(pixels, { raw: { width: 16, height: 16, channels: 3 } }).png().toBuffer()
const metadata = Buffer.from(JSON.stringify({ frameId: 1, width: 16, height: 16, commit: 'a'.repeat(40), metadataBase64: Buffer.from(mask).toString('base64') }))
fs.writeFileSync(path.join(dir, 'baseline.png'), png); fs.writeFileSync(path.join(dir, 'mask.json'), metadata)
const record = { commit: 'a'.repeat(40), imageFile: 'baseline.png', imageSha256: hash(png), metadataFile: 'mask.json', metadataSha256: hash(metadata) }
fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify(record))
const p: VisibilityCalibration = { id: 'synthetic bytes test', bundleSha256: 'b'.repeat(64), baselineEarthshineSha256: hash(png), mariaGrey: .05, highlandGrey: .1, skyGrey: .01, minContrastGrey: .02, minDetailGrey: .01, earthshineMinimumGrey: .12 }
assert.equal(await verifyBaseline(path.join(dir, 'record.json'), p), hash(png))
await assert.rejects(verifyBaseline(path.join(dir, 'record.json'), { ...p, baselineEarthshineSha256: 'f'.repeat(64) }), /hashes mismatch/)
await assert.rejects(verifyBaseline(path.join(dir, 'record.json'), { ...p, mariaGrey: .3, highlandGrey: .4 }), /brighten/)
fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({ ...record, metadataSha256: 'c'.repeat(64) }))
await assert.rejects(verifyBaseline(path.join(dir, 'record.json'), p), /hashes mismatch/)
// The actual shader uses premultiplied meta.g once, and applies to partial coverage/night too.
assert.match(VISIBILITY_GLSL, /visibilityGrey\(meta.b \/ max\(meta.r, 1e-6\), levels\) \* meta.g/)
const partialPolicy = { ...p, highlandGrey: .102 }
const writeEvidence = async (rgb: Uint8Array, rgba: Uint8Array): Promise<VisibilityCalibration> => {
 const image = await sharp(rgb, { raw: { width: 16, height: 16, channels: 3 } }).png().toBuffer()
 const meta = Buffer.from(JSON.stringify({ frameId: 1, width: 16, height: 16, commit: record.commit, metadataBase64: Buffer.from(rgba).toString('base64') }))
 fs.writeFileSync(path.join(dir, 'baseline.png'), image); fs.writeFileSync(path.join(dir, 'mask.json'), meta)
 fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({ ...record, imageSha256: hash(image), metadataSha256: hash(meta) }))
 return { ...partialPolicy, baselineEarthshineSha256: hash(image) }
}
const almostFull = new Uint8Array(16 * 16 * 4)
for (let i = 0; i < 256; i++) almostFull.set([250, 250, 250, 20], i * 4)
const almostPolicy = await writeEvidence(new Uint8Array(16 * 16 * 3).fill(25), almostFull)
assert.equal(Math.round(applyVisibilityMetadataGrey(25 / 255, 250 / 255, 250 / 255, 250 / 255, almostPolicy) * 255 + 1e-12), 26)
await assert.rejects(verifyBaseline(path.join(dir, 'record.json'), almostPolicy), /brighten/, '250/255 coverage is not multiplied twice')
const limbPixels = new Uint8Array(16 * 16 * 3).fill(64), limbMask = mask.slice()
limbPixels.fill(1, 0, 3); limbMask.set([128, 128, 128, 20], 0)
const limbPolicy = await writeEvidence(limbPixels, limbMask)
assert.equal(Math.round(applyVisibilityMetadataGrey(1 / 255, 128 / 255, 128 / 255, 128 / 255, limbPolicy) * 255), 13)
await assert.rejects(verifyBaseline(path.join(dir, 'record.json'), limbPolicy), /brighten/, 'all affected limb pixels are validated alongside good interiors')
for (const coverByte of [1, 64, 128, 250, 255]) for (const nightByte of [1, Math.min(64, coverByte), coverByte]) {
 const c = coverByte / 255, g = nightByte / 255
 assert.equal(applyVisibilityMetadataGrey(0, c, g, c, partialPolicy), partialPolicy.highlandGrey * g, 'production premultiplied output formula')
}
console.log('baseline-evidence.test.mts: actual lossless bytes/mask identity and per-channel accepted-baseline preservation negatives: ok (synthetic, not calibration)')
