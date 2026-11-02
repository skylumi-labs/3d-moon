import './siteRing.css'
import type { ViewCamera } from '../camera/pose'

/**
 * Apollo 11's marker: the lander is a handful of pixels in the photograph (its shadow is about five pixels wide), so a ring marks
 * the spot instead of a drawn module. The ring is a screen-space overlay anchored at the lander's measured position; it is not
 * part of the picture and says so in its label.
 */
export function projectWorldPoint(cam: ViewCamera, aspect: number, p: { x: number; y: number; z: number }, w: number, h: number): { x: number; y: number } | null {
  const vx = p.x - cam.pos.x, vy = p.y - cam.pos.y, vz = p.z - cam.pos.z
  const depth = -(vx * cam.back.x + vy * cam.back.y + vz * cam.back.z)
  if (depth <= 0) return null
  const nx = (vx * cam.right.x + vy * cam.right.y + vz * cam.right.z) / (depth * cam.tanHalf * aspect)
  const ny = (vx * cam.up.x + vy * cam.up.y + vz * cam.up.z) / (depth * cam.tanHalf)
  if (Math.abs(nx) > 1.05 || Math.abs(ny) > 1.05) return null
  return { x: (nx + 1) / 2 * w, y: (1 - ny) / 2 * h }
}

export function mountSiteRing(root: HTMLElement): { update(at: { x: number; y: number } | null): void; readonly element: HTMLElement } {
  const el = document.createElement('div')
  el.className = 'site-ring'
  el.hidden = true
  el.setAttribute('aria-hidden', 'true')
  const label = document.createElement('span')
  label.textContent = 'Lander’s shadow'
  el.append(label)
  root.append(el)
  let shown = false
  return {
    element: el,
    update(at) {
      if (!at) { if (shown) { shown = false; el.hidden = true } return }
      if (!shown) { shown = true; el.hidden = false }
      el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`
    },
  }
}
