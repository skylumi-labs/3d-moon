/**
 * Whether the loaded landing-site patch is on screen, for the credits.
 *
 * The patch is drawn as soon as it is bound (`moon.boundLevels > 0`). Its revision moves on every level that arrives, and the
 * bound revision lags it until the next layout has finished its background compile; during that window the old layout is still
 * drawn. Credits must not drop (or wait on the compile) while the patch is on screen, so the revision is not part of the test.
 */
export interface PatchDrawnInput {
  hasPatch: boolean
  patchState: 'off' | 'idle' | 'loading' | 'ready' | 'failed'
  boundLevels: number
}

export function patchIsDrawn(i: PatchDrawnInput): boolean {
  return i.hasPatch && i.patchState === 'ready' && i.boundLevels > 0
}
