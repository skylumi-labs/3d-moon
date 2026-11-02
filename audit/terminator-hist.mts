// Terminator band histogram of a still (MOON-UX-REDESIGN 5.2 acceptance): which grey bins between 2 and 20 of 255 are empty in a band across the terminator.
// Usage: node --import tsx audit/terminator-hist.mts <still.png> [halfBandPx=60] [terminatorX=W/2]
import sharp from 'sharp'
const [file, hb = '60', tx] = process.argv.slice(2)
const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true })
const W = info.width, H = info.height
const cx = W / 2, cy = H / 2
const x0 = Math.round(Number(tx ?? cx) - Number(hb)), x1 = Math.round(Number(tx ?? cx) + Number(hb))
/** The disc radius at the recorder's 960x600 @2x view (audit/flicker.mts prints it as geo.R); pass another with the 4th argument. */
const DISC_R = Number(process.argv[5] ?? 510)
const DISC_FRACTION = 0.9
const hist = new Array(256).fill(0)
for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) {
  if (Math.hypot(x - cx, y - cy) > DISC_FRACTION * DISC_R) continue
  hist[data[y * W + x]]++
}
const empty: number[] = []
for (let g = 2; g <= 20; g++) if (hist[g] === 0) empty.push(g)
console.log(JSON.stringify({ file, band: [x0, x1], emptyBinsBetween2And20: empty, counts2to20: hist.slice(2, 21) }))
