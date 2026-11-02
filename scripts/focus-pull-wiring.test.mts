// Focus pull wiring: main.ts only calls the driver; dropping a call site fails here (source match, as "rest governor wiring" in phoneSharp.test.mts).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p: string): string => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const main = read('main.ts')

// main.ts: one driver, built at module level, fed after the final image of every drawn frame.
assert.match(main, /import \{ FocusScreenDriver \} from '\.\/post\/focusScreenDriver'/)
assert.equal((main.match(/new FocusScreenDriver\(\)/g) ?? []).length, 1, 'one driver')
const fin = main.indexOf('span(\'final\', () => final.render(renderer, t, exposure))')
const call = main.indexOf('focusScreen.frame(renderer, performance.now(), tiles ? tiles.focusMeasure(cw) : null,')
const last = main.indexOf('last = { cam, ephem, exposure, w, h, cw, ch }')
assert.ok(fin > 0 && call > fin && call < last, 'the indicator is drawn after final.render and before the frame bookkeeping')
const line = main.slice(call, main.indexOf('\n', call))
assert.match(line, /!STILL && !captureSession && !capture\)/, 'never in a still or a capture')
assert.match(line, /\{ markDirty\(\); because\('focusScreen'\) \}/, 'the fade out asks for frames')
assert.ok(main.slice(fin, call).includes('renderer.setRenderTarget(null)'), 'drawn onto the default framebuffer')

assert.match(main, /focusPull: \(\) => focusScreen\.snapshot\(\),/, 'the rig reads the indicator through __moon.focusPull()')

// The driver: off without the switch, skips the pass while invisible, measures only what the streamer reports.
const drv = read('post/focusScreenDriver.ts')
assert.match(drv, /if \(!focusPullOn\(\)\) return false/)
assert.match(drv, /if \(!visible\(this\.state\)\) return false/)
// Loading: colour coarse, or the detail tiles on their way (2026-10-31, quality/focusScreen.ts loadingOf / indicatorErr, unit-tested in focus-screen.test.mts).
assert.match(drv, /const loading = enabled && loadingOf\(m\)/)
assert.match(drv, /this\.state = stepVisibility\(prev, dt, loading, indicatorErr\(m\)\)/)
// Review (2026-10-30): frames only while the indicator changes, never a steady redraw at vsync over a load; off, nothing is measured.
assert.match(drv, /return !loading \|\| Math\.abs\(this\.state\.vis - prev\.vis\) > CHANGE_EPS \|\| Math\.abs\(this\.state\.err - prev\.err\) > CHANGE_EPS/)
assert.match(main, /if \(focusPullOn\(\) && focusScreen\.frame\(renderer, performance\.now\(\), tiles \? tiles\.focusMeasure\(cw\) : null,/, 'the measure runs only with the switch on')
assert.match(drv, /this\.pass\.draw\(renderer, opticsErr\(this\.state\), this\.state\.vis\)/)
assert.match(drv, /new FocusScreenPass\(focusMatteTraced\(focusSearch\(\)\)\)/, 'the pass is built on first use')
assert.doesNotMatch(drv, /HUNT|Math\.sin/, 'no hunt: the split follows the loading steadily')
// Moving alone never shows it: the driver has no camera input.
assert.ok(!/gesture|moving|speed/i.test(drv.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'no movement input')

// The streamer: pending marks, the ramp length, the measure.
const ts = read('moon/tiles/TileStreamer.ts')
assert.match(ts, /const fadeMs = \(\): number => tileFadeMs\(OPACITY_FADE_MS\)/)
assert.ok((ts.match(/fadeMs\(\)/g) ?? []).length >= 4, "every fade site reads the switchable length")
assert.match(ts, /if \(focusPullOn\(\) && this\.markPending\(wanted, now\)\) fading = true\n\s*this\.focusFading = fading\n\s*this\.flushPage\(\)/, 'marks (and the released ramps) are written before the page is flushed, and a ramp keeps frames coming')
assert.match(ts, /focusMeasure\(canvasW: number, now = performance\.now\(\)\)/)
assert.match(ts, /this\.scripted = !!\(v\.flight \|\| v\.scripted\)/, 'the detail signal knows a scripted move')
assert.match(read('main.ts'), /flight: !!\(tween \|\| cinematicFlight \|\| intro\?\.moving\), scripted: cameraOwned\(\),/, 'every camera the app owns counts as scripted: the hover over a site and the descents too (review of #414)')
assert.match(ts, /const detail = this\.scripted \? 0 : Math\.max\(this\.detail\?\.missingShare\(now\) \?\? 0, this\.tc\?\.missingShare\(now\) \?\? 0\)/, "the indicator reads the WAC and TC detail on its way")
assert.ok(!/\bFADE_MS\b/.test(ts), 'no fixed fade length left')

// The shader: the colour block is chosen once, by the switch.
const sh = read('moon/moonShader.ts')
assert.match(sh, /\$\{tiles \? tileColorBlock\(\) : ''\}/)
assert.match(sh, /const tileColorBlock = \(\): string => \(focusPullOn\(\) \? TILE_COLOR_FOCUS : TILE_COLOR\)/)

// The switches are registered (focuspull off by default since 2026-11-01, ?focuspull=1 on; focusmatte absent).
const sw = read('debug/switches.ts')
assert.match(sw, /off\(T, 'focuspull'/); assert.match(sw, /sw\(L, 'focusmatte', \['traced'\], null/)
console.log('focus-pull-wiring: ok')
