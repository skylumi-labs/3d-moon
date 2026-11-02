import { C_SIZE } from './grid'
import { neutraliseNoData } from './detail'
import { colorMipsGrey } from './detailMips'

/** RGBA pixels of a grey detail tile to its uploaded chain: the R channel, no-data (0) to `mid`, then the mips. One implementation for the page and the Worker. */
export function greyMipsFromPixels(px: Uint8ClampedArray, mid: number): Uint8Array[] {
  const grey = new Uint8Array(C_SIZE * C_SIZE)
  for (let i = 0; i < grey.length; i++) grey[i] = px[4 * i]
  neutraliseNoData(grey, mid)
  return colorMipsGrey(grey, C_SIZE)
}
