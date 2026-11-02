import sharp from 'sharp'
import fs from 'node:fs'
const root = process.argv[2]
for (const d of fs.readdirSync(root).filter((x) => fs.statSync(`${root}/${x}`).isDirectory())) {
  const fs_ = fs.readdirSync(`${root}/${d}`).filter((f) => /^f-\d+\.png$/.test(f)).sort()
  const L: number[] = []
  for (const f of fs_) { const s = await sharp(`${root}/${d}/${f}`).stats(); L.push((s.channels[0].mean + s.channels[1].mean + s.channels[2].mean) / 3) }
  let worst = 0, at = 0, black = 0
  for (let i = 1; i < L.length; i++) { const j = Math.abs(L[i] - L[i - 1]); if (j > worst) { worst = j; at = i } }
  for (const l of L) if (l < 3) black++
  console.log(d, 'frames', L.length, 'max step', worst.toFixed(1), 'at', at, 'black', black, L.map((x) => Math.round(x)).join(','))
}
