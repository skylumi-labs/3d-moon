/**
 * The bottom control row (bar.css): the closed bar is ONE flex row at every width: [prev, list, next, reserved Back] | [Home, Labels, Time, More, toggle], in one glass container.
 * The open pad is always complete ([look up | down] | [- +] | [stick], with the bar's thin dividers). src/ui/dockRow.ts models the sizes and decides where it stands: in the bar's row where the whole
 * row fits one bar (a 52 rem bar from 1024 px), else in a glass row of its own right above the bar (owner decision 2026-10-24, option A). It also says how much of the bar moves
 * into More while a flight's slider is in the row. This checks that the model and the CSS agree, then sweeps 320 to 1440 px x safe-area insets x text sizes.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FLIGHT_RANGE_MIN_PX, FLIGHT_SLIDER_PAD_PX, MIN_TARGET_PX, PAD_CAPS, PAD_SEPS, SEP_PX, SMALL_VIEWPORT_PX, TIGHT_VIEWPORT_PX,
  barCompactLevel, barMaxPx, barMaxRem, closedBtn, closedNeedPx, flightCompactLevel, flightNeedPx, flightRowNeedPx, padFitsRow, padRowNeedPx, padRowSizes, padWidthPx, rowNeedPx, rowSizes, sliderZonePx, targetPx, WIDE_VIEWPORT_PX,
} from '../src/ui/dockRow.ts'

const read = (p: string): string => readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8')
const tc = read('touchControls.css')
const bar = read('bar.css')
const dock = read('dock.css')
const nav = read('navigator.css')

/** The px value of a custom property in the :root block, or in the tight media block. */
function size(block: 'base' | 'tight', name: string): number {
  const root = tc.slice(tc.indexOf(':root {'), tc.indexOf('}', tc.indexOf(':root {')))
  const at = tc.indexOf('@media (max-width: 399px)')
  const tight = tc.slice(at, tc.indexOf('}', at + 30))
  const m = new RegExp(`${name}:\\s*(\\d+)px`).exec(block === 'base' ? root : tight)
  assert.ok(m, `${name} (${block}) is declared in px`)
  return Number(m![1])
}
assert.equal(TIGHT_VIEWPORT_PX, 400)
assert.equal(SMALL_VIEWPORT_PX, 360)
// The tight block overrides only the stick, its knob and the gap: the height, the halves and the caps' extra width are the base ones everywhere.
for (const [vw, block] of [[500, 'base'], [411, 'base'], [399, 'tight']] as const) {
  const s = rowSizes(vw)
  assert.equal(size('base', '--tc-h'), s.h, `${vw}: pad height`)
  assert.equal(size('base', '--tc-cap-extra'), s.capExtra, `${vw}: cap extra`)
  assert.equal(size('base', '--tc-half'), s.half, `${vw}: half`)
  assert.equal(size(block, '--tc-stick'), s.stick, `${vw}: stick`)
  assert.equal(size(block, '--tc-gap'), s.gap, `${vw}: gap`)
}
assert.equal(size('base', '--tc-half'), 40)
assert.equal(size('tight', '--tc-stick'), 42)
assert.doesNotMatch(tc, /@media \(min-width: 480px\)/, 'no roomy block: the halves are 40 px at every width in the bar\'s row')
// The pad is complete at every width (owner decision 2026-10-24): no width or orientation moves the tilt pair into More. The Orbit | Turn switch went on 2026-10-31.
assert.equal(PAD_CAPS, 2, 'look up | down, zoom - | +')
assert.equal(PAD_SEPS, 2, 'a divider between the tilt pair and zoom, and between zoom and the stick')
assert.equal(SEP_PX, 1)
assert.equal(padWidthPx(560), 2 * (2 * 40 + 2) + 48 + 2 * 1 + 4 * 6)
assert.equal(padWidthPx(320), 2 * (2 * 40 + 2) + 42 + 2 * 1 + 4 * 4)
assert.doesNotMatch(tc, /\.bar-more \.touch-ctl-mode|\.bar-more \.tc-cap/, 'no pad group has a style in the More sheet')
const tcTs = read('touchControls.ts')
assert.doesNotMatch(tcTs, /ROOMY_VIEWPORT_PX|TILT_VIEWPORT_PX|SHORT_LANDSCAPE_PX|modeInMore|tiltInRow|flightPadFitsRow|placeMode/, 'touchControls.ts has no width exception for a pad group')
assert.match(tcTs, /pad\.append\(tiltCap, sep\(\), zoomCap, sep\(\), flyStick\)/, 'the pad is built whole')
assert.match(tcTs, /\.dock > \.bar-padrow/, 'touchControls.ts finds the pad row in the dock')
// The pad row: the bar\'s own glass, radius and width, in the dock directly above the bar; its sizes are the model\'s.
assert.match(bar, /\.bar, \.bar-padrow \{[^}]*width: min\(100%, 36rem\)[^}]*backdrop-filter[^}]*border-radius: 26px/, 'the pad row is the bar\'s glass, radius and width')
assert.match(tc, /\.bar-padrow \.touch-ctl-pad \{[^}]*justify-content: space-evenly/, 'its groups spread evenly across the row: no dead space')
assert.match(tc, /\.bar-padrow \{ --tc-half: 44px; --tc-h: 44px; --tc-stick: 44px; \}/, 'the pad row\'s halves and stick are 44 px: the row is the bar\'s 48 px tall')
assert.doesNotMatch(tc, /\.bar-padrow \{ --tc-half: 40px/, 'at every width (item E: 44 px targets; two pairs fit from 320 px)')
assert.match(tc, /@media \(max-width: 359px\) \{ \.bar-padrow \{ --tc-gap: 2px; \} \}/)
assert.match(bar, /@media \(max-width: 359px\) \{ \.bar-padrow \{ padding: 1px; \} \}/)
assert.deepEqual([320, 359, 360, 399, 400, 1440].map((v) => padRowSizes(v).half), [44, 44, 44, 44, 44, 44])
assert.deepEqual([320, 360, 400].map((v) => padRowSizes(v).gap), [2, 4, 6])
const barTs = read('bar.ts')
assert.match(barTs, /dock\.append\(sheet, padRow, bar\)/, 'the pad row stands before the bar in the DOM too: Tab meets the pad first')
assert.match(barTs, /dock\.insertBefore\(more, padRow\)/, 'the sheets open above the pad row')
const navCss = read('navigator.css')
const orderOf = (sel: string): number => Number(new RegExp(`\\.dock > ${sel} \\{[^}]*order: (\\d+)`).exec(navCss)?.[1])
assert.ok(orderOf('\\.nav-caption') < orderOf('\\.bar-padrow') && orderOf('\\.bar-padrow') < orderOf('\\.bar'), 'visual order: viewpoint caption, then the pad row, then the bar (the pad row sits directly on the bar)')
assert.match(navCss, /\.dock > \.bar-padrow \{[^}]*margin-bottom: -3px/, 'a 5 px gap between the pad row and the bar (the dock gap is 8)')
assert.match(read('dock.css'), /flex-direction: column/, 'the dock stacks the pad row and the bar')
assert.match(bar, /\.bar, \.bar-padrow \{\s*--bar-btn: 44px;/, 'the base button width is the model\'s (44)')
assert.match(bar, /@media \(max-width: 399px\) \{ \.bar \{ --bar-btn: 40px; \} \}/)
assert.match(bar, /@media \(max-width: 359px\) \{ \.bar \{ --bar-btn: 36px; \} \}/)
assert.doesNotMatch(bar, /\.bar\.padrow \{ --bar-btn/, 'the pad in the row no longer shrinks the buttons')
assert.match(bar, /\.bar button \{\s*flex: 1 1 var\(--bar-btn, 44px\); min-width: 0; max-width: 48px;/, 'buttons stay round (at most 48 px); the row spreads the space between them')
assert.match(bar, /\.bar \.nav-pill > button, \.bar-icons > button \{ min-width: var\(--bar-btn, 44px\); \}/, 'buttons keep the bar model\'s minimum width')
assert.deepEqual([320, 359, 360, 399, 400, 479, 480, 1440].map(closedBtn), [36, 36, 40, 40, 44, 44, 44, 44])
assert.deepEqual([320, 399, 400, 479, 480, 1440].map((v) => rowSizes(v).btn), [40, 40, 44, 44, 44, 44])
for (const vw of [360, 399, 400, 1440]) assert.equal(rowSizes(vw).btn, closedBtn(vw), `${vw}: the pad in the row keeps the closed button size`)
// Tap targets: every bar button is at least 40 px (44 px from 400 px), Return and pause the same, the pad's halves 40 x 40 px everywhere.
for (const vw of [360, 399]) assert.ok(closedBtn(vw) >= MIN_TARGET_PX, `${vw}: bar buttons are at least 40`)
for (const vw of [400, 411, 1440]) assert.equal(closedBtn(vw), 44, `${vw}: bar buttons are 44`)
for (const vw of [320, 411, 1440]) assert.ok(rowSizes(vw).h >= MIN_TARGET_PX, `${vw}: pad halves are 40 px tall (the pad is 42, less its border)`)
for (const vw of [320, 360, 399, 400, 479, 480, 1440]) assert.equal(rowSizes(vw).half, 40, `${vw}: pad halves are 40 px wide`)
assert.equal(targetPx(36), 40)
assert.equal(targetPx(44), 44)

// One row: no wrapping anywhere, one glass container, and the old second row (name + slider) is gone.
assert.match(bar, /\.bar, \.bar-padrow \{[^}]*flex-wrap: nowrap/, 'the bar is a single non-wrapping row')
assert.doesNotMatch(nav, /\.nav-row/, 'the pill has no row of its own to wrap')
assert.doesNotMatch(nav, /flex: 1 0 100%/, 'the Return button no longer takes a line of its own')
assert.match(nav, /\.bar \.nav-return \{[^}]*width: max\(var\(--bar-btn, 44px\), 40px\)[^}]*height: max\(var\(--bar-btn, 44px\), 40px\)/, 'Back is an icon in the row, at least 40 px')
assert.match(nav, /\.bar \.nav-return:not\(\.available\) \{ visibility: hidden;/, 'Back reserves its slot while away changes during a drag')
assert.match(nav, /\.bar \.nav-stop \{[^}]*width: max\(var\(--bar-btn, 44px\), 40px\); height: max\(var\(--bar-btn, 44px\), 40px\)/, 'Stop has the bar button tap target')
assert.match(nav, /\.js-pause \{[^}]*width: max\(var\(--bar-btn, 44px\), 40px\); height: max\(var\(--bar-btn, 44px\), 40px\)/, 'pause is at least 40 px')
assert.match(bar, /\.bar, \.bar-padrow \{[^}]*backdrop-filter/, 'the bar is the one glass container')
assert.match(tc, /\.bar \.touch-ctl-pad \{ margin: 0; \}/, 'the pad has no margin in the row: the model counts none')
assert.doesNotMatch(tc, /dock-row|--tc-pill-w|--tc-bar-w/, 'the side-by-side grid of pill and bar is gone')
assert.match(dock, /bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 8px\)/, 'the dock stands 8 px over the safe area (no credit band)')
// A flight keeps Back beside its slider; the caption keeps the picker available while its duplicate row button leaves.
assert.match(nav, /\.bar\.flying \.nav-prev \{ order: -1; \}/, 'Back stays first, before the slider')
assert.doesNotMatch(nav, /\.bar-padslot|\.bar-icons/, 'a flight keeps the pad slot and icon row in the layout')
assert.match(nav, new RegExp(`min-width: calc\\(2 \\* max\\(var\\(--bar-btn, 44px\\), 40px\\) \\+ ${FLIGHT_SLIDER_PAD_PX}px \\+ ${FLIGHT_RANGE_MIN_PX}px\\)`), 'the slider fits Stop, pause, padding and the model range')
assert.match(nav, new RegExp(`\\.js-range \\{[^}]*min-width: ${FLIGHT_RANGE_MIN_PX}px`), 'the scrub range keeps the model minimum')
assert.match(nav, /\.bar\.flying \.nav-list \{ display: none; \}/, 'the caption keeps the picker available while its redundant row button leaves during a flight')
assert.doesNotMatch(nav, /bar-sep/, 'there is no separator between the navigation and action buttons')
assert.match(nav, /@media \(max-width: 359px\) \{ \.bar\.flying \[data-bar="more"\] \{ display: none; \} \}/, 'below 360 px the flight temporarily gives the last row slot to navigation')
assert.equal(sliderZonePx(44), 190)
assert.equal(sliderZonePx(36), 182)

let n = 0
for (const vw of [320, 340, 350, 360, 375, 390, 393, 399, 400, 411, 430, 479, 480, 520, 667, 760, 768, 844, 900, 1023, 1024, 1440]) {
  for (const inset of [0, 24, 47, 59]) {
    for (const rem of [16, 20, 32]) {
      n++
      const room = barMaxPx(vw, rem, inset, inset)
      assert.ok(room > 0 && room <= vw - 16 + 1e-6, `${vw}/${inset}/${rem}: the bar is inside the safe area`)
      // With Back reserved, the bar moves Labels and Time into More where needed; its selected compact level must fit.
      if (inset === 0) {
        const level = barCompactLevel(vw, room, false, false, true)
        const kept = level === 0 ? 5 : level === 1 ? 3 : 2
        const needed = 4 * closedBtn(vw) + kept * closedBtn(vw) + 9
        assert.ok(needed <= room + 1e-6, `${vw}/${rem}: the closed row (level ${level}, ${needed}) fits ${room}`)
      }
      // One row only where the closed bar, the complete pad AND a flight's slider fit it; else the pad has its own row, which must hold the complete pad on its own.
      if (padFitsRow(vw, rem, inset, inset)) {
        assert.ok(rowNeedPx(vw) <= room + 1e-6 && flightRowNeedPx(vw) <= room + 1e-6, `${vw}/${inset}/${rem}: the single row fits`)
        assert.ok(flightCompactLevel(vw, room - padWidthPx(vw)) === 0, `${vw}/${inset}/${rem}: nothing folds into More with the pad in the row`)
      } else if (inset === 0 || (vw >= 568 && inset <= 59)) {
        // The dock's width less the side padding (at least 8 px) is the pad row's.
        assert.ok(padRowNeedPx(vw) <= vw - 2 * Math.max(8, inset) + 1e-6, `${vw}/${inset}: the complete pad (${padRowNeedPx(vw)}) fits its own row`)
      }
      // The flight row: whatever the width asks of the icons, what stays fits the bar (level 2 keeps More and the toggle and fits from 320 px).
      if (inset === 0) {
        const level = flightCompactLevel(vw, room)
        const kept = level === 0 ? 4 : level === 1 ? 2 : vw < SMALL_VIEWPORT_PX ? 0 : 1
        assert.ok(flightNeedPx(vw, kept) <= room + 1e-6, `${vw}/${rem}: the flight row (level ${level}, ${kept} icons, ${flightNeedPx(vw, kept)}) fits ${room}`)
      }
    }
  }
}
// The pad is complete everywhere, one row from the width where the whole row fits, two rows below (text 100%, no insets): 1024 px is where the 52 rem bar starts.
const widths = [320, 360, 390, 412, 768, 1024, 1440]
for (const vw of widths) {
  assert.equal(PAD_CAPS, 2, `${vw}: look up | down and zoom - | + are both in the pad (and the stick)`)
  assert.ok(padRowNeedPx(vw) <= vw - 16, `${vw}: the complete pad fits a row of its own (${padRowNeedPx(vw)})`)
  assert.equal(padFitsRow(vw, 16, 0, 0), vw >= 1024, `${vw}: ${vw >= 1024 ? 'one row' : 'two rows'}`)
}
assert.equal(padFitsRow(1023, 16, 0, 0), false)
assert.equal(padFitsRow(1024, 16, 0, 0), true)
assert.equal(padFitsRow(1024, 16, 59, 59), true)
assert.equal(padFitsRow(1024, 32, 0, 0), true, '200% text: the bar may be 52 rem, which the screen caps')
assert.equal(padFitsRow(1024, 8, 0, 0), false, 'a tiny root size: 52 rem is too narrow for the row, so the pad has its own')
// Exact arithmetic of the key cases.
assert.equal(rowNeedPx(1440), closedNeedPx(1440) + 238)
assert.equal(closedNeedPx(1440), 9 * 44 + 9)
assert.equal(rowNeedPx(1440), 643)
assert.equal(flightRowNeedPx(1440), 736, 'the flight row with every row icon and the complete pad')
assert.equal(barMaxPx(1440, 16, 0, 0), 832)
assert.equal(barMaxPx(1023, 16, 0, 0), 576, 'under 1024 px the cap is still 36 rem')
assert.equal(padRowNeedPx(411), 2 * 90 + 44 + 2 * 1 + 4 * 6 + 2 * 7 + 2)
assert.equal(padRowNeedPx(320), 2 * 90 + 44 + 2 * 1 + 4 * 2 + 2 + 2)
assert.equal(barMaxRem(WIDE_VIEWPORT_PX - 1), 36)
assert.equal(barMaxRem(WIDE_VIEWPORT_PX), 52)
// What the owner's phones get while a flight plays: Back stays (V9), so a 411 px and a 360 px phone keep More and the toggle; Home is in More. The pad row is not part of this.
assert.equal(flightCompactLevel(411, barMaxPx(411, 16, 0, 0)), 2)
assert.equal(flightCompactLevel(360, barMaxPx(360, 16, 0, 0)), 2)
assert.equal(flightCompactLevel(1440, barMaxPx(1440, 16, 0, 0)), 0, 'a wide screen keeps every icon during a flight')
// The bar row is exactly the closed bar with the pad in its own row: the pad adds nothing to the level (only a pad IN the bar's row takes its width).
for (const vw of [320, 360, 390, 412, 768, 1023]) for (const flying of [false, true]) {
  const room = barMaxPx(vw, 16, 0, 0)
  assert.equal(padFitsRow(vw, 16, 0, 0), false)
  assert.equal(barCompactLevel(vw, room, flying, false), flying ? flightCompactLevel(vw, room) : 0, `${vw}: the bar row is the same with the pad open in its own row as with it closed`)
}
assert.equal(barCompactLevel(1440, 832, true, true), 0, 'wide: the pad in the row and every icon, flying')
assert.equal(barCompactLevel(1440, 832, false, true), 0, 'wide: the pad in the row, nothing moves')
// The CSS cap and the model agree.
assert.match(bar, new RegExp(`@media \\(min-width: ${WIDE_VIEWPORT_PX}px\\) \\{ \\.bar\\.padrow, \\.bar\\.flying \\{ width: min\\(100%, ${barMaxRem(WIDE_VIEWPORT_PX)}rem\\); \\} \\}`), 'the wide cap is the model\'s')
assert.equal(flightNeedPx(360, 1), 2 * 40 + FLIGHT_SLIDER_PAD_PX + FLIGHT_RANGE_MIN_PX + 3 * 40 + 40)
assert.ok(flightNeedPx(360, 1) <= barMaxPx(360, 16, 0, 0), 'the compact flight row fits a 360 px phone')
assert.ok(flightNeedPx(320, 0) <= barMaxPx(320, 16, 0, 0), 'the flight row fits below 360 px with More temporarily hidden')
assert.equal(FLIGHT_RANGE_MIN_PX, 96)
assert.equal(FLIGHT_SLIDER_PAD_PX, 6)
// The Moon's framing keeps clear of the pad row like the bar, and the labels and the centre caption read the dock, which holds it.
assert.match(read('../main.ts'), /add\('\.bar-padrow', 'bottom'\)/, 'the pad row is an occluder')
// Away from a viewpoint, the list and arrows stay while Back is added and the caption is cleared.
const navTs = read('navigator.ts')
assert.match(navTs, /nameB\.hidden = false/, 'the viewpoint picker stays visible while away')
assert.doesNotMatch(navTs, /prevB\.hidden = v\.canReturn|nextB\.hidden = v\.canReturn/, 'the arrows do not disappear while away')
assert.match(navTs, /const hideCaption = !state\.pos \|\| state\.away/, 'the caption clears while away')
assert.match(navTs, /stopB\.addEventListener\('click', \(\) => host\.stopMoment\?\.\(\)\)/, 'the bar Stop control delegates to the moment controller')
assert.match(navTs, /caption\.setAttribute\('aria-label', 'Viewpoints list'\)/, 'the caption is the list button, named Viewpoints list')
console.log(`touch-layout: ${n} layouts ok`)

// Item E (owner 2026-10-31): in the bar's rows the pad has the lower bar's look: no pills, the bar's icon size, stroke, colour, press fill and dividers.
assert.match(tc, /\.bar \.tc-surface, \.bar-padrow \.tc-surface \{ background: none; border-color: transparent; \}/, 'no grey pills in the rows')
assert.match(tc, /\.bar \.tc-cap, \.bar-padrow \.tc-cap \{ border-width: 0; \}/, 'the pairs drop their border: the halves fill the 44 px height')
assert.match(tc, /\.bar \.tc-half svg, \.bar-padrow \.tc-half svg \{ width: 22px; height: 22px;/, 'the bar\'s 22 px icons')
assert.match(bar, /\.bar button svg \{ width: 22px; height: 22px;/, 'the same as the bar\'s own icons')
assert.match(tc, /\.bar \.tc-half\[data-down\], \.bar-padrow \.tc-half\[data-down\] \{ background: rgba\(169, 200, 245, 0\.22\); color: #fff; \}/, 'the bar\'s pressed fill')
assert.match(bar, /\.bar button\[aria-pressed='true'\], \.bar button\[aria-expanded='true'\] \{ color: #fff; background: rgba\(169, 200, 245, 0\.22\); \}/, 'which is the bar\'s own active state')
assert.match(tc, /\.bar \.tc-half, \.bar-padrow \.tc-half \{ color: #e8ecf5; border-radius: 22px; \}/, 'the bar\'s ink and round buttons')
const sepRule = /\.tc-sep \{ flex: none; width: 1px; align-self: stretch; margin: 10px 0; background: rgba\(255, 255, 255, 0\.14\);/
assert.match(tc, sepRule, 'the pad keeps its dividers between tilt, zoom and globe controls')
assert.doesNotMatch(bar, /\.bar-sep/, 'the bar has no divider between navigation and action buttons')
assert.match(tcTs, /stroke-width="\$\{TABLER_STROKE\}"/, 'the tilt icons use the bar\'s stroke')
assert.match(tcTs, /tablerIcon\('plus', 22\)/)
for (const vw of [320, 360, 390, 399, 400, 412, 1440]) assert.ok(padRowSizes(vw).half >= 44 && padRowSizes(vw).h >= 44, `${vw}: pad row targets are 44 px`)
console.log('touch-layout: item E look ok')
