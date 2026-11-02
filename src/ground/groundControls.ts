import type { GroundMode } from './GroundMode'

/**
 * Pointer, wheel and keys for the ground camera (G1): drag to look around, wheel to move along the line of sight
 * (flying) or the ground (walking), W A S D or the arrow keys to move, Q and E (or Space and C) to rise and sink,
 * Shift for faster, V to walk at eye level and back, Escape to go back up (handled by main.ts).
 */
export interface GroundHooks {
  /** The active ground mode, or null. */
  mode(): GroundMode | null
  /** The camera changed. */
  moved(): void
  /** V: walk or fly. */
  toggleWalk(): void
}

const RAD = 180 / Math.PI

export function attachGroundControls(canvas: HTMLCanvasElement, hooks: GroundHooks): void {
  let drag: { id: number; x: number; y: number } | null = null
  canvas.addEventListener('pointerdown', (e) => {
    if (!hooks.mode()) return
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY }
  })
  canvas.addEventListener('pointermove', (e) => {
    const gm = hooks.mode()
    if (!gm || !drag || drag.id !== e.pointerId) return
    const degPerPx = 2 * Math.atan(gm.cam.view.tanHalf) * RAD / Math.max(1, canvas.clientHeight)
    // Dragging the ground: the view turns the other way, as the orbital camera's drag does.
    gm.cam.look(-(e.clientX - drag.x) * degPerPx, -(e.clientY - drag.y) * degPerPx)
    drag.x = e.clientX
    drag.y = e.clientY
    hooks.moved()
  })
  for (const type of ['pointerup', 'pointercancel'] as const) canvas.addEventListener(type, (e) => { if (drag?.id === e.pointerId) drag = null })
  canvas.addEventListener('wheel', (e) => {
    const gm = hooks.mode()
    if (!gm) return
    gm.cam.dolly(Math.exp(e.deltaY * 0.0012))
    hooks.moved()
  }, { passive: true })

  const set = (e: KeyboardEvent, down: boolean): void => {
    const gm = hooks.mode()
    if (!gm || e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return
    const k = gm.cam.keys
    const v = down ? 1 : 0
    switch (e.key.toLowerCase()) {
      case 'w': case 'arrowup': k.fwd = v; break
      case 's': case 'arrowdown': k.fwd = -v; break
      case 'd': case 'arrowright': k.right = v; break
      case 'a': case 'arrowleft': k.right = -v; break
      case 'q': case ' ': k.up = v; break
      case 'e': case 'c': k.up = -v; break
      case 'shift': k.fast = down; break
      case 'v': if (down && !e.repeat) hooks.toggleWalk(); return
      default: return
    }
    if (down) gm.cam.cancelGlide()
    hooks.moved()
    e.preventDefault()
  }
  window.addEventListener('keydown', (e) => set(e, true))
  window.addEventListener('keyup', (e) => set(e, false))
  window.addEventListener('blur', () => { const gm = hooks.mode(); if (gm) Object.assign(gm.cam.keys, { fwd: 0, right: 0, up: 0, fast: false }) })
}
