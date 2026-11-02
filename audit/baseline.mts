import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { applyVisibilityMetadataGrey, type VisibilityCalibration } from '../src/post/visibility.ts'
/** A baseline is real lossless pixels + same-frame independent metadata, not a merely well-formed hash label. */
export async function verifyBaseline(file: string, calibration: VisibilityCalibration): Promise<string> {
 const record = JSON.parse(fs.readFileSync(file, 'utf8'))
 if (!/^[a-f0-9]{40}$/.test(record.commit) || !record.imageFile || !record.metadataFile) throw new Error('Baseline candidate/image/mask identity incomplete')
 const read = (name: string, max: number): Buffer => {
  const p = path.resolve(path.dirname(file), name)
  if (fs.statSync(p).size > max) throw new Error('Baseline evidence exceeds byte cap')
  return fs.readFileSync(p)
 }
 const image = read(record.imageFile, 32 * 1024 * 1024), metadata = read(record.metadataFile, 32 * 1024 * 1024)
 const imageSha = createHash('sha256').update(image).digest('hex'), maskSha = createHash('sha256').update(metadata).digest('hex')
 if (imageSha !== record.imageSha256 || imageSha !== calibration.baselineEarthshineSha256 || maskSha !== record.metadataSha256) throw new Error('Lossless baseline pixels/mask hashes mismatch')
 const format = await sharp(image).metadata()
 if (format.format !== 'png') throw new Error('Baseline must be lossless PNG')
 const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true })
 const mask = JSON.parse(metadata.toString('utf8'))
 if (mask.frameId < 1 || mask.width !== info.width || mask.height !== info.height || mask.commit !== record.commit) throw new Error('Baseline frame/geometry mismatch')
 const rgba = Buffer.from(mask.metadataBase64, 'base64')
 if (rgba.length !== info.width * info.height * 4) throw new Error('Baseline metadata size mismatch')
 let sampled = 0
 for (let i = 0; i < info.width * info.height; i++) {
  const coverage = rgba[i * 4] / 255, night = rgba[i * 4 + 1] / 255
  if (coverage <= 0 || night <= 0) continue
  sampled++
  const templateCoverage = rgba[i * 4 + 2] / 255
  for (let c = 0; c < info.channels; c++) {
   const baseline = data[i * info.channels + c] / 255
   if (applyVisibilityMetadataGrey(baseline, coverage, night, templateCoverage, calibration) > baseline + 1 / 65535)
    throw new Error('Visibility envelope would brighten accepted baseline pixels')
  }
 }
 if (sampled < 64) throw new Error('Baseline lacks eligible independent night-side samples')
 return imageSha
}
