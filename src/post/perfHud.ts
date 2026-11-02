/** ?perfhud=1: a corner readout of the GPU timing (post/gpuTimer.ts). Measurement aid only, never part of the product. */
export function mountPerfHud(read: () => Record<string, unknown>, visible = true): { setVisible(on: boolean): void; isVisible(): boolean } {
  const el = document.createElement('pre')
  el.style.cssText = 'position:fixed;left:8px;top:calc(env(safe-area-inset-top,0px) + 104px);max-width:calc(100vw - 16px);overflow:hidden;z-index:99999;margin:0;padding:6px 8px;font:11px/1.35 ui-monospace,monospace;color:#9f9;background:rgba(0,0,0,.72);pointer-events:none;white-space:pre'
  el.hidden = !visible
  document.body.appendChild(el)
  const f = (v: unknown, d = 1): string => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : 'n/a')
  setInterval(() => {
    if (el.hidden) return
    const p = read()
    const passes = p.passes as Record<string, number> | null
    const sh = p.shadow as { serving: number; pendingBuild: number; failed: boolean } | null
    const timing = p.latestTiming as { queryMs: number; latencyMs: number; scale: number; at: number } | null
    const details = (passes ? '\n' + Object.entries(passes).filter(([k]) => !k.includes('.')).map(([k, v]) => `${k} ${f(v)}`).join('  ') : '')
      + `\nshadow cache ${sh ? `${sh.serving} serving, ${sh.pendingBuild} pending${sh.failed ? ' FAILED' : ''}` : 'unavailable'}`
    el.textContent = `${p.qualityLine}\nclass ${p.class}  gpu ${p.source}  fence path ${p.fencePath ? 'on' : 'off'}  pacer ${p.paceOn ? 'on' : 'off'} (in flight ${f(p.inFlight, 0)}, held ${f(p.held, 0)})\ngpu ${p.source}  p50 ${f(p.gpuMsP50)} ms  p95 ${f(p.gpuMsP95)} ms\nlatency ${f(p.latencyMs)} ms  presented ${f(p.presentedFps, 0)} fps  display ${f(p.displayHz, 0)} Hz\npaired query ${timing ? `${f(timing.queryMs)} ms / fence ${f(timing.latencyMs)} ms @ ${f(timing.scale, 2)}` : 'n/a'}\nbands ${p.bandsOn ? 'on' : 'off'} ${f(p.bandFrames, 0)}/${f(p.bandedFrames, 0)} full ${f(p.fullCostMs)} ms final ${f(p.finalOnlyFrames, 0)}\ngrid scale ${f(p.motionScale, 2)}  raf ${f(p.rafFrameMs)} ms  refine ${f(p.taggedMs)} ms${details}`
  }, 250)
  return { setVisible(on) { el.hidden = !on }, isVisible: () => !el.hidden }
}
