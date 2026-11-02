import { ledger, textureBytes, type LedgerCategory } from './ledger'

/** Anything three.js can dispose: it dispatches a 'dispose' event (Texture, WebGLRenderTarget). Structural, so this file needs no three import. */
interface Disposable { addEventListener(type: 'dispose', listener: () => void): void }

let seq = 0

/**
 * Registers an allocation in the ledger and releases it when the object is disposed. `name` says what it is; the key is made unique
 * so a rebuilt target of the same name replaces nothing it should not. Returns the key (for a manual release).
 */
export function trackGpu(category: LedgerCategory, name: string, bytes: number, object?: Disposable): string {
  const key = `${name}#${++seq}`
  ledger.set(category, key, bytes)
  object?.addEventListener('dispose', () => { ledger.release(category, key) })
  return key
}

/** Bytes of a three DataTexture or Texture from its type/format/size: components x component size, +1/3 with a mip chain. */
export function dataTextureBytes(t: { image: { width: number; height: number }; format: number; type: number; generateMipmaps?: boolean; mipmaps?: unknown[] }, formats: { rg: number; rgba: number; float: number; half: number }, extra: { mips?: boolean } = {}): number {
  const channels = t.format === formats.rg ? 2 : t.format === formats.rgba ? 4 : 1
  const per = t.type === formats.float ? 4 : t.type === formats.half ? 2 : 1
  return textureBytes(t.image.width, t.image.height, channels * per, { mips: extra.mips ?? !!t.generateMipmaps })
}

/** A set of allocations owned by one object (a streamer's arrays and page table), released together on dispose, lost context or not. */
export class GpuGroup {
  private readonly keys: Array<[LedgerCategory, string]> = []
  constructor(private readonly category: LedgerCategory) {}
  add(name: string, bytes: number): void {
    this.keys.push([this.category, trackGpu(this.category, name, bytes)])
  }
  releaseAll(): void {
    for (const [c, k] of this.keys) ledger.release(c, k)
    this.keys.length = 0
  }
}
