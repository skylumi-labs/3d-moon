// node --import tsx audit/contact-sheet.mts DIR OUT.png [cols] [tileWidth] [every]
import fs from 'node:fs'
import sharp from 'sharp'
const [dir, out, colsA, twA, everyA] = process.argv.slice(2)
const cols = Number(colsA ?? 5), tw = Number(twA ?? 320), every = Number(everyA ?? 1)
const files = fs.readdirSync(dir).filter((f) => /^f-\d+\.png$/.test(f)).sort().filter((_, i) => i % every === 0)
const bufs = await Promise.all(files.map((f) => sharp(`${dir}/${f}`).resize({ width: tw }).toBuffer()))
const th = (await sharp(bufs[0]).metadata()).height ?? tw
const rows = Math.ceil(bufs.length / cols)
await sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: '#222' } })
  .composite(bufs.map((input, i) => ({ input, left: (i % cols) * tw, top: Math.floor(i / cols) * th }))).png().toFile(out)
console.log(out, bufs.length, 'frames')
