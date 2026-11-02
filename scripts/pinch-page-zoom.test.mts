import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { safariPinchLogDelta, shouldPreventTouchPageZoom, wheelZoomLogDelta } from '../src/camera/zoomInput.ts'

assert.equal(wheelZoomLogDelta({ deltaY: 50, deltaMode: 0, ctrlKey: true }), 0.4, 'trackpad pinch uses the existing ctrl-wheel sensitivity')
assert.equal(wheelZoomLogDelta({ deltaY: 100, deltaMode: 0, ctrlKey: false }), 0.12, 'ordinary wheel keeps its existing sensitivity')
assert.ok(Math.abs(wheelZoomLogDelta({ deltaY: 1, deltaMode: 1, ctrlKey: false }) - 0.0396) < 1e-12, 'line wheel is scaled to pixels')
assert.ok(safariPinchLogDelta(1, 2) < 0, 'spreading fingers zooms in')
assert.ok(safariPinchLogDelta(1, 0.5) > 0, 'pinching fingers together zooms out')
assert.equal(safariPinchLogDelta(1, 1), 0)
assert.equal(shouldPreventTouchPageZoom(1), false, 'one finger can still scroll a sheet')
assert.equal(shouldPreventTouchPageZoom(2), true, 'multi-touch cannot trigger browser page zoom')

const controls = readFileSync(new URL('../src/camera/controls.ts', import.meta.url), 'utf8')
assert.match(controls, /doc\.addEventListener\('wheel',[\s\S]*?if \(!e\.ctrlKey\) return[\s\S]*?passive: false/, 'document intercepts only ctrl-wheel, non-passively')
assert.match(controls, /queueZoomLogDelta\(wheelZoomLogDelta\(e\)\)/, 'document and canvas use the same zoom input path')
assert.match(controls, /doc\.addEventListener\('gesturechange',[\s\S]*?safariPinchLogDelta/, 'Safari pinch scale reaches the camera')
assert.match(controls, /doc\.addEventListener\('touchstart',[\s\S]*?shouldPreventTouchPageZoom[\s\S]*?passive: false/, 'touch page zoom is prevented only for multitouch')
const pinsCss = readFileSync(new URL('../src/ui/pins.css', import.meta.url), 'utf8')
assert.match(pinsCss, /\.viewpoints-list \{[^}]*touch-action: pan-x;/, 'single-finger sideways sheet scrolling remains native')
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/, 'viewport stays fixed to the device width')
console.log('pinch-page-zoom: ok')
