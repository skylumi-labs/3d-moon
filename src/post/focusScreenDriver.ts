import type * as THREE from 'three'
import { FocusScreenPass } from './focusScreenPass'
import { focusMatteTraced, indicatorErr, loadingOf, newVisibility, opticsErr, stepVisibility, visible, type FocusVisibility } from '../quality/focusScreen'
import { focusPullOn, focusSearch } from '../moon/tiles/focusPull'

/**
 * What the tile streamer says of the frame: the share still drawn coarser than wanted with a finer level on its way, how much detail that part lacks (px per
 * 640 px of width), and the share of the wanted detail tiles (WAC, Terrain Camera) still on their way.
 */
export interface FocusMeasure { coarse: number; lackPer640: number; detail?: number }


/**
 * The split-prism indicator of the focus pull (off by default since 2026-11-01, `?focuspull=1` on), one call per drawn frame from main.ts after the final image. It owns the visibility state
 * (quality/focusScreen.ts), builds the GL pass on first use and skips it entirely while the indicator is invisible. Returns true while it still needs
 * frames (the fade out after the last tile landed): the page is drawn on demand, so a fade with nothing else to draw must ask for them.
 */
/** Below this change of opacity or err per frame the indicator is steady. */
const CHANGE_EPS = 1e-3

export class FocusScreenDriver {
  private state: FocusVisibility = newVisibility()
  private pass: FocusScreenPass | null = null
  private last = -1
  private loading = false
  private drawn = 0
  private lastMeasure: FocusMeasure | null = null

  /** For the rig (`__moon.focusPull()`): what the indicator is doing now and how many frames it drew. */
  snapshot(): { vis: number; err: number; loading: boolean; drawn: number; coarse: number; lackPer640: number; detail: number } {
    return { vis: this.state.vis, err: this.state.err, loading: this.loading, drawn: this.drawn, coarse: this.lastMeasure?.coarse ?? 0, lackPer640: this.lastMeasure?.lackPer640 ?? 0, detail: this.lastMeasure?.detail ?? 0 }
  }

  frame(renderer: THREE.WebGLRenderer, nowMs: number, m: FocusMeasure | null, enabled: boolean): boolean {
    if (!focusPullOn()) return false
    const dt = this.last < 0 ? 0 : (nowMs - this.last) / 1000
    this.last = nowMs
    const loading = enabled && loadingOf(m)
    this.loading = loading
    this.lastMeasure = m
    const prev = this.state
    this.state = stepVisibility(prev, dt, loading, indicatorErr(m))
    if (!visible(this.state)) return false
    if (enabled) {
      this.pass ??= new FocusScreenPass(focusMatteTraced(focusSearch()))
      this.pass.draw(renderer, opticsErr(this.state), this.state.vis)
      this.drawn++
    }
    // Frames are asked for only while the indicator changes (its fade in, the split following err, the hold and fade out after loading): a steady
    // indicator over a load waits for the tile arrivals' own redraws, so it does not redraw the scene at vsync rate and eat the loading's CPU headroom.
    return !loading || Math.abs(this.state.vis - prev.vis) > CHANGE_EPS || Math.abs(this.state.err - prev.err) > CHANGE_EPS
  }
}
