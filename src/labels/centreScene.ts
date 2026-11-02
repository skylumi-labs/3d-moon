import type { CamSample } from './centreCaptionCore'

/**
 * Which camera belongs to the scene on screen. A frame SELECTS a camera early (main.ts picks the ground, flight, ridge, intro or rig camera), but only
 * some frames draw a new scene, and only some of those present it:
 *  - a buildOnly frame (cache catch-up) selects a camera and returns without drawing or presenting;
 *  - a band sequence draws one scene over several frames: the first band's camera is the scene's, the later bands and the unfinished ones present nothing;
 *  - a final-only redraw re-runs the final pass over the scene already drawn, so the scene on screen is still the earlier one.
 * `presented` is therefore the only value the centre caption may read as "the camera that is on screen".
 */
export class PresentedScene {
  private pending: CamSample | null = null
  private onScreen: CamSample | null = null
  private hitDrawn: { cam: CamSample; gen: number; w: number; h: number } | null = null
  /** The surface generation: one per scene drawn. A hit belongs to the generation of the frame that wrote it. */
  private gen = 0
  private pendingGen = 0
  private onScreenGen = -1

  /** A frame chose its camera. `skipScene` is main's buildOnly || continuation band || final-only; only a frame that draws a scene starts a new one. */
  selected(skipScene: boolean, make: () => CamSample): void {
    if (!skipScene) { this.pending = make(); this.pendingGen = ++this.gen }
  }

  /** The Moon was drawn by a whole frame (not a band): `shared` is whether its hit target now holds this scene's surface. */
  drewMoon(shared: boolean, w = 0, h = 0): void {
    this.hitDrawn = shared && this.pending ? { cam: this.pending, gen: this.pendingGen, w, h } : null
  }

  /** The frame passed the presentation gates (the final pass ran). Returns the camera of the scene now on screen. */
  presented(finalOnly: boolean): CamSample | null {
    if (!finalOnly && this.pending) { this.onScreen = this.pending; this.onScreenGen = this.pendingGen }
    return this.onScreen
  }

  /** The surface generation of the scene on screen. */
  get generation(): number { return this.onScreenGen }
  /** The camera of the scene on screen, or null before the first presentation. */
  get current(): CamSample | null { return this.onScreen }
  /**
   * The hit target that belongs to the scene on screen: the camera that wrote it and the target's size then. Null when the scene on screen was
   * drawn without sharing its hit (a banded scene, a ground frame), even if an earlier frame at the same camera did. A final-only redraw presents
   * no new scene, so the hit of the scene it redraws stays.
   */
  get hit(): { cam: CamSample; w: number; h: number } | null { return this.hitDrawn && this.hitDrawn.gen === this.onScreenGen ? this.hitDrawn : null }
}
