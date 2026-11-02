import { createRetry, probeWebGL2, type RetryController } from '../quality/gpuReset'

/**
 * The native app's card after a GPU reset (quality/gpuReset.ts): the message and a Try again button, drawn in the page's #err overlay
 * (index.html), which sits above the canvas and the HUD. `reload` runs once a fresh WebGL2 context is granted.
 */
export function showGpuRetry(reload: () => void, firstMessage?: string): RetryController | null {
  const el = document.getElementById('err')
  if (!el) return null
  // index.html's start-up fatal() would replace the card on the throw that follows a failed start.
  ;(window as { __moonHoldErr?: boolean }).__moonHoldErr = true
  el.textContent = ''
  const box = document.createElement('div')
  box.style.cssText = 'display:grid;gap:16px;justify-items:center;max-width:340px'
  const msg = document.createElement('p')
  msg.style.cssText = 'margin:0;white-space:pre-wrap;line-height:1.4'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.style.cssText = 'font:inherit;color:inherit;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.35);border-radius:999px;padding:10px 22px;min-height:44px'
  box.append(msg, btn)
  el.append(box)
  el.style.display = 'grid'
  el.style.zIndex = '100'
  const ctl = createRetry({
    probe: () => probeWebGL2(() => document.createElement('canvas')),
    reload,
    render: (v) => {
      msg.textContent = v.message
      btn.hidden = v.button === null
      if (v.button !== null) btn.textContent = v.button
      btn.disabled = v.busy
      btn.style.opacity = v.busy ? '0.5' : '1'
    },
    schedule: (fn, ms) => { setTimeout(fn, ms) },
  })
  btn.addEventListener('click', () => ctl.press())
  ctl.show(firstMessage)
  return ctl
}
