/**
 * The "Target lock" centre caption: field formatting and omission, the typing scheduler, the hold that keeps a flight from retyping, the brackets' size rule,
 * the block's clearance at phone and desktop widths and text sizes, and the `?labelstyle=classic` switch.
 *   npm test
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import {
  BRACKET_MS, EXTENT_MIN_PX, HOLD_MS, LockHold, RETICLE_PX, TYPE_GAP_STEPS, TYPE_LINE_CHARS, TYPE_STEP_MS,
  bracketBox, formatCoords, formatDiameter, labelStyleOf, lockFields, lockLines, projectPx, typeWord, typedAt, typingEndsAt, wrapLon,
} from '../src/labels/lockLabelCore.ts'
import { lockRect, placeLock, type LockInput } from '../src/ui/lockLabelLayout.ts'
import type { CamSample } from '../src/labels/centreCaptionCore.ts'
import { LABELS, type MoonLabel } from '../src/labels/data.ts'
import { loadGazetteer } from '../src/labels/gazetteerTable.ts'
await loadGazetteer()

const byName = (n: string): MoonLabel => { const l = LABELS.find((x) => x.name === n); assert.ok(l, n); return l }
const RAD = Math.PI / 180

// ---- Fields: the artboard's lines, from the Gazetteer, and nothing invented ----
{
  const cop = lockFields(byName('Copernicus'))
  assert.deepEqual(lockLines(cop), ['Copernicus', 'LAT  9.62°N  LON 20.08°W', 'Crater  Ø 96 km'])
  assert.equal(cop.spoken, 'Copernicus. latitude 9.62 degrees north, longitude 20.08 degrees west. Crater. diameter 96 kilometres.')
  assert.deepEqual(lockLines(lockFields(byName('Tycho'))), ['Tycho', 'LAT 43.30°S  LON 11.22°W', 'Crater  Ø 85 km'])
  assert.deepEqual(lockLines(lockFields(byName('Mare Imbrium'))), ['Mare Imbrium', 'LAT 34.72°N  LON 14.91°W', 'Mare  Ø 1146 km'])
  // A satellite feature keeps the IAU type as written.
  assert.equal(typeWord('Satellite Feature'), 'Satellite Feature')
  assert.equal(typeWord('Lacus, lacūs'), 'Lacus')
  // No status words anywhere in what can be shown.
  for (const l of LABELS.slice(0, 400)) {
    const all = lockLines(lockFields(l)).join(' ').toUpperCase()
    assert.ok(!/LOCK|ACQUIR|QUERY|TARGET|N\/A|\?\?/.test(all), `${l.name}: no status or placeholder words (${all})`)
  }
}
{
  // Field omission: no diameter, no type, no position: each left out, never a placeholder.
  const base = { name: 'Test', lat: 1, lon: 2, sizeKm: 12, featureType: 'Crater, craters' }
  assert.deepEqual(lockLines(lockFields({ ...base, sizeKm: undefined })), ['Test', 'LAT  1.00°N  LON 2.00°E', 'Crater'])
  assert.deepEqual(lockLines(lockFields({ ...base, sizeKm: 0 })), ['Test', 'LAT  1.00°N  LON 2.00°E', 'Crater'])
  assert.deepEqual(lockLines(lockFields({ ...base, featureType: undefined })), ['Test', 'LAT  1.00°N  LON 2.00°E', 'Ø 12 km'])
  assert.deepEqual(lockLines(lockFields({ ...base, featureType: '', sizeKm: NaN })), ['Test', 'LAT  1.00°N  LON 2.00°E'])
  assert.deepEqual(lockLines(lockFields({ ...base, lat: NaN })), ['Test', 'Crater  Ø 12 km'])
  assert.deepEqual(lockLines(lockFields({ name: 'Only', lat: NaN, lon: NaN, sizeKm: undefined, featureType: undefined })), ['Only'])
  assert.equal(lockFields({ name: 'Only', lat: NaN, lon: NaN }).spoken, 'Only.')
  assert.equal(formatDiameter(2.34), 'Ø 2.3 km'); assert.equal(formatDiameter(96.07), 'Ø 96 km'); assert.equal(formatDiameter(-1), undefined)
  assert.equal(formatCoords(-0.001, 359.99), 'LAT  0.00°N  LON 0.01°W')
  assert.match(lockFields({ name: 'Z', lat: -0.004, lon: -0.001 }).spoken, /latitude 0\.00 degrees north, longitude 0\.00 degrees east/, 'spoken and shown agree at 0.00')
  assert.equal(formatCoords(12.5, 180), 'LAT 12.50°N  LON 180.00°E')
  assert.equal(wrapLon(270), -90); assert.equal(wrapLon(-180), 180)
}

// ---- Typing scheduler ----
{
  const lines = ['Copernicus', 'LAT  9.62°N  LON 20.08°W', 'Crater  Ø 96 km']
  const t0 = 1000
  assert.deepEqual(typedAt(lines, t0, t0 - 5, false).counts, [0, 0, 0], 'nothing before the start')
  assert.deepEqual(typedAt(lines, t0, t0 + 3 * TYPE_STEP_MS, false).counts, [3, 0, 0], 'one letter of the name per step (45 ms)')
  assert.deepEqual(typedAt(lines, t0, t0 + 10 * TYPE_STEP_MS, false).counts, [10, 0, 0])
  assert.deepEqual(typedAt(lines, t0, t0 + (10 + TYPE_GAP_STEPS) * TYPE_STEP_MS, false).counts, [10, 0, 0], 'a short gap after the name')
  assert.deepEqual(typedAt(lines, t0, t0 + (10 + TYPE_GAP_STEPS + 2) * TYPE_STEP_MS, false).counts, [10, 2 * TYPE_LINE_CHARS, 0], 'three characters per step below')
  const mid = typedAt(lines, t0, t0 + (10 + TYPE_GAP_STEPS + 9) * TYPE_STEP_MS, false)
  assert.deepEqual(mid.counts, [10, 24, 3]); assert.equal(mid.cursorLine, 2); assert.equal(mid.done, false)
  const end = typingEndsAt(lines, t0)
  assert.equal(typedAt(lines, t0, end - 1, false).done, false)
  assert.deepEqual(typedAt(lines, t0, end, false), { counts: [10, 24, 15], done: true, cursorLine: 2 })
  // About 1.3 s for Copernicus after the brackets (est from the artboard's rates), never per frame.
  assert.ok(end - t0 > 1000 && end - t0 < 1600, `typing takes ${end - t0} ms`)
  // Reduced motion: everything at once, at the start.
  assert.deepEqual(typedAt(lines, t0, t0, true), { counts: [10, 24, 15], done: true, cursorLine: 2 })
  assert.deepEqual(typedAt(['Only'], t0, t0 + 4 * TYPE_STEP_MS, false), { counts: [4], done: true, cursorLine: 0 })
  assert.deepEqual(typedAt([], t0, t0, false), { counts: [], done: true, cursorLine: 0 })
  assert.equal(BRACKET_MS, 420)
}

// ---- The hold: motion picks replace the old name directly; rest picks still wait for a stable hold ----
{
  const h = new LockHold()
  let v = h.step({ id: 'a', moving: false, suppressed: false, now: 0 })
  assert.equal(v.id, null, 'a new name waits for its hold')
  v = h.step({ id: 'a', moving: false, suppressed: false, now: HOLD_MS - 1 }); assert.equal(v.id, null)
  v = h.step({ id: 'a', moving: false, suppressed: false, now: HOLD_MS }); assert.equal(v.id, 'a')
  const since = v.since
  // Held: the commit time does not change, so nothing retypes.
  for (let t = HOLD_MS; t < 3000; t += 16) assert.equal(h.step({ id: 'a', moving: false, suppressed: false, now: t }).since, since)
  // The old caption disappears as soon as the moving centre no longer has a feature.
  v = h.step({ id: null, moving: true, suppressed: false, now: 3000 }); assert.equal(v.id, null)
  // The next confident pick of the same feature is a fresh, single commit after the null pick cleared it.
  v = h.step({ id: 'a', moving: true, suppressed: false, now: 3125 }); assert.equal(v.id, 'a')
  assert.equal(v.since, 3125)
  const recommit = v.since
  v = h.step({ id: 'a', moving: true, suppressed: false, now: 3250 }); assert.equal(v.since, recommit, 'same id after a null pick commits only once')
  v = h.step({ id: null, moving: true, suppressed: false, now: 3300 }); assert.equal(v.id, null)
  v = h.step({ id: 'b', moving: true, suppressed: false, now: 3500 }); assert.equal(v.id, 'b')
  const movingSince = v.since
  v = h.step({ id: 'b', moving: true, suppressed: false, now: 3750 }); assert.equal(v.since, movingSince, 'same moving pick does not retype')
  // At rest: a new id still waits for the stable hold.
  v = h.step({ id: 'c', moving: false, suppressed: false, now: 6000 }); assert.equal(v.id, 'b')
  v = h.step({ id: 'c', moving: false, suppressed: false, now: 6000 + HOLD_MS }); assert.equal(v.id, 'c')
  assert.equal(h.busy(), false)
  // Suppression (a sheet, the Labels layer, the splash) drops everything at once.
  const s = new LockHold()
  s.step({ id: 'a', moving: false, suppressed: false, now: 0 }); s.step({ id: 'a', moving: false, suppressed: false, now: HOLD_MS })
  assert.equal(s.step({ id: 'a', moving: false, suppressed: true, now: 500 }).id, null)
}

// ---- Brackets: real size only where it is honest ----
/** A nadir camera over (lon, lat) whose vertical field spans `spanKm` of ground, as main publishes (Moon coordinates). */
function camOver(lon: number, lat: number, spanKm: number, aspect = 16 / 9): CamSample {
  const tanHalf = Math.tan(15 * RAD)
  const dist = 1 + spanKm / (2 * tanHalf * 1737.4)
  const la = lat * RAD, lo = lon * RAD
  const u: [number, number, number] = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]
  return { pos: [u[0] * dist, u[1] * dist, u[2] * dist], back: u, up: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)], tanHalf, aspect }
}
{
  const cop = byName('Copernicus')
  const W = 1600, H = 900
  // Projection sanity: the nadir point is the screen centre, north is up, east is right.
  const cam = camOver(cop.lon, cop.lat, 300)
  const c = projectPx(cam, [Math.cos(cop.lat * RAD) * Math.cos(cop.lon * RAD), Math.cos(cop.lat * RAD) * Math.sin(cop.lon * RAD), Math.sin(cop.lat * RAD)], W, H)!
  assert.ok(Math.abs(c[0] - W / 2) < 0.5 && Math.abs(c[1] - H / 2) < 0.5)
  const north = projectPx(cam, [Math.cos((cop.lat + 1) * RAD) * Math.cos(cop.lon * RAD), Math.cos((cop.lat + 1) * RAD) * Math.sin(cop.lon * RAD), Math.sin((cop.lat + 1) * RAD)], W, H)!
  assert.ok(north[1] < H / 2, 'north is up')
  const east = projectPx(cam, [Math.cos(cop.lat * RAD) * Math.cos((cop.lon + 1) * RAD), Math.cos(cop.lat * RAD) * Math.sin((cop.lon + 1) * RAD), Math.sin(cop.lat * RAD)], W, H)!
  assert.ok(east[0] > W / 2, 'east is right')
  // 300 km of ground over 900 px: Copernicus' 96 km rim is about 288 px tall (est, a flat-ground approximation): framed by its extent.
  const b = bracketBox(cop, cam, W, H)
  assert.equal(b.rule, 'extent')
  assert.ok(Math.abs(b.height - 96 / 300 * H) < 0.08 * 96 / 300 * H, `rim box ${b.height.toFixed(0)} px`)
  assert.ok(Math.abs(b.left + b.width / 2 - W / 2) < 2 && Math.abs(b.top + b.height / 2 - H / 2) < 2, 'centred on the crater')
  // Too small on screen, too big, or no camera: the fixed reticle (says nothing about size).
  const small = bracketBox(cop, camOver(cop.lon, cop.lat, 96 * H / (EXTENT_MIN_PX - 5)), W, H)
  assert.equal(small.rule, 'reticle'); assert.equal(small.width, RETICLE_PX)
  assert.equal(bracketBox(cop, camOver(cop.lon, cop.lat, 110), W, H).rule, 'reticle', 'a rim filling the screen is not framed')
  assert.equal(bracketBox(cop, null, W, H).rule, 'reticle')
  // A mare or a range never: their IAU "diameter" is an extent or a length, not a rim.
  const imb = byName('Mare Imbrium')
  assert.equal(bracketBox(imb, camOver(imb.lon, imb.lat, 3000), W, H).rule, 'reticle')
  const range = LABELS.find((l) => l.kind === 'range' && (l.sizeKm ?? 0) > 50)!
  assert.equal(bracketBox(range, camOver(range.lon, range.lat, (range.sizeKm ?? 0) * 3), W, H).rule, 'reticle')
  // A crater whose rim is off-centre past the viewport edge: reticle.
  assert.equal(bracketBox(cop, camOver(cop.lon + 8.5, cop.lat, 300), W, H).rule, 'reticle')
  // Foreshortened near the limb: the box is flatter than it is wide (the real projected rim).
  const tilt: CamSample = (() => {
    const la = cop.lat * RAD, lo = cop.lon * RAD
    const u: [number, number, number] = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]
    const nUp: [number, number, number] = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)]
    // Camera 600 km south of the crater, 300 km up, looking at it.
    const d = 1 + 300 / 1737.4
    const pos: [number, number, number] = [0, 1, 2].map((j) => u[j] * d - nUp[j] * 600 / 1737.4) as [number, number, number]
    const to = [0, 1, 2].map((j) => u[j] - pos[j]); const l = Math.hypot(...to)
    const back = to.map((x) => -x / l) as [number, number, number]
    const dotUp = nUp[0] * back[0] + nUp[1] * back[1] + nUp[2] * back[2]
    const up0 = nUp.map((x, j) => x - dotUp * back[j]); const ul = Math.hypot(...up0)
    return { pos, back, up: up0.map((x) => x / ul) as [number, number, number], tanHalf: Math.tan(15 * RAD), aspect: W / H }
  })()
  const fb = bracketBox(cop, tilt, W, H)
  assert.equal(fb.rule, 'extent'); assert.ok(fb.height < 0.75 * fb.width, `foreshortened ${fb.width.toFixed(0)} x ${fb.height.toFixed(0)}`)
}

// ---- Clearance: phone and desktop widths, 100/150/200 % text ----
{
  // The block's size as lockLabel.css lays it out (Share Tech Mono advances 0.54 em; est): a 1.5 rem name (1.25 rem at 480 px or less) at 0.1 em spacing,
  // 0.8125 rem lines at 0.08 em, 4 px gaps. Stacked: one field per line and the name wrapped at its spaces within `maxW`.
  const blockOf = (lines: string[], rem: number, narrow: boolean, maxW: number): { w: number; h: number } => {
    const nameRem = (narrow ? 1.25 : 1.5) * rem, lineRem = 0.8125 * rem
    const nameCh = 0.64 * nameRem, lineCh = 0.62 * lineRem
    const nameRows: string[] = []
    for (const word of lines[0].split(' ')) {
      const cur = nameRows.at(-1)
      if (cur !== undefined && (cur.length + 1 + word.length) * nameCh <= maxW) nameRows[nameRows.length - 1] = `${cur} ${word}`
      else nameRows.push(word)
    }
    const w = Math.max(...nameRows.map((r) => r.length * nameCh), ...lines.slice(1).map((l) => l.length * lineCh)) + 0.6 * lineRem + 4
    const h = nameRows.length * 1.15 * nameRem + (lines.length - 1) * (1.3 * lineRem + 4)
    return { w: Math.ceil(w), h: Math.ceil(h) }
  }
  let stackedCases = 0, cases = 0
  for (const name of ['Copernicus', 'Oceanus Procellarum', 'Mare Imbrium']) {
    const f = lockFields(byName(name))
    for (const [vw, vh, phone] of [[360, 780, true], [412, 915, true], [780, 360, true], [1440, 900, false], [1920, 1080, false]] as const) {
      for (const scale of [1, 1.5, 2]) {
        const rem = 16 * scale
        const dockH = (phone ? 112 : 64) * scale
        const dock = { left: 0, top: vh - dockH, right: vw, bottom: vh }
        const hud = { left: 14, top: 12, right: 14 + 220 * scale, bottom: 12 + 40 * scale }
        const credit = { left: vw - 240, top: vh - dockH - 24 * scale, right: vw - 12, bottom: vh - dockH - 4 }
        // On a phone the flight pad is a row of the bar (inside the dock); on a desktop it stands above the dock, at the right (touchControls.css).
        const pad = phone ? { left: 0, top: 0, right: 0, bottom: 0 } : { left: vw - 8 - 320 * scale, top: vh - dockH - 8 - 48 * scale, right: vw - 8, bottom: vh - dockH - 8 }
        const rects = [dock, hud, credit, pad]
        const box = { left: vw / 2 - RETICLE_PX / 2, top: vh / 2 - RETICLE_PX / 2, width: RETICLE_PX, height: RETICLE_PX }
        const tag = `${name} ${vw}x${vh} @${scale * 100}%`
        let hit: { p: NonNullable<ReturnType<typeof placeLock>>; w: number; h: number } | null = null
        for (const stacked of [false, true]) {
          const { w, h } = blockOf(lockLines(f, stacked), rem, vw <= 480, vw - 18)
          const p = placeLock({ viewportW: vw, viewportH: vh, insetL: 0, insetR: 0, insetT: 0, insetB: 0, box, textW: w, textH: h, rects })
          if (p) { hit = { p, w, h }; if (stacked) stackedCases++; break }
        }
        cases++
        // Only a short landscape phone at a large text size may have no room (the name is then left out, never drawn over a control).
        if (!hit) { assert.ok(vh <= 400 && scale >= 1.5, `${tag}: no room`); continue }
        const { p, w, h } = hit
        const r = { left: p.left, top: p.top, right: p.left + w, bottom: p.top + h }
        for (const c of rects) if (c.right > c.left) assert.ok(r.right + 8 <= c.left || c.right + 8 <= r.left || r.bottom + 8 <= c.top || c.bottom + 8 <= r.top, `${tag}: block clear of ${JSON.stringify(c)} (${p.side})`)
        assert.ok(r.left >= 8 && r.right <= vw - 8 && r.top >= 8 && r.bottom <= vh - 8, `${tag}: inside the viewport`)
        const lr = lockRect(box, p, w, h)
        assert.ok(lr.left <= Math.min(box.left, r.left) && lr.right >= Math.max(box.left + box.width, r.right))
        if (vw >= 1440 && scale === 1) assert.equal(p.side, 'right', `${tag}: the artboard's arrangement on a desktop`)
      }
    }
  }
  assert.ok(stackedCases > 0 && stackedCases < cases, `the stacked fallback is used where needed (${stackedCases}/${cases})`)
  console.log(`lock-label: clearance ${cases} cases, ${stackedCases} stacked`)
  // The artboard's arrangement on a desktop: the block right of the brackets.
  const base: LockInput = { viewportW: 1440, viewportH: 900, insetL: 0, insetR: 0, insetT: 0, insetB: 0, box: { left: 688, top: 418, width: 64, height: 64 }, textW: 300, textH: 70, rects: [] }
  assert.equal(placeLock(base)?.side, 'right')
  // A control on the right sends it left; a narrow screen below; brackets under a control: nothing.
  assert.equal(placeLock({ ...base, rects: [{ left: 760, top: 300, right: 1440, bottom: 600 }] })?.side, 'left')
  assert.equal(placeLock({ ...base, viewportW: 600, box: { left: 268, top: 418, width: 64, height: 64 } })?.side, 'below')
  assert.equal(placeLock({ ...base, rects: [{ left: 600, top: 400, right: 800, bottom: 500 }] }), null)
  // Safe-area insets count.
  assert.equal(placeLock({ ...base, insetR: 1440 - 760 - 299 })?.side, 'left')
}

// ---- The classic switch and the wiring ----
{
  assert.equal(labelStyleOf(''), 'lock')
  assert.equal(labelStyleOf('?labelstyle=classic'), 'classic')
  assert.equal(labelStyleOf('?x=1&labelstyle=classic'), 'classic')
  assert.equal(labelStyleOf('?labelstyle=lock'), 'lock')
  assert.equal(labelStyleOf('?labelstyle=other'), 'lock')
  const main = readFileSync('src/main.ts', 'utf8')
  assert.match(main, /const LABEL_STYLE = labelStyleOf\(location\.search\)/)
  assert.match(main, /if \(LABEL_STYLE === 'lock'\) centreUi = centreLock = mountLockLabel\(uiRoot, canvas\)\n\s*else centreUi = mountCentreCaption\(uiRoot\)/)
  assert.match(main, /moving: cameraMoving\(\), usable: centreUi\.usable\(\)/, 'the picker tracks the presented camera during motion')
  assert.match(main, /centreLock\s*\? centreLock\.frame\(view, \{\s*moving: cameraMoving\(\)/)
  assert.match(main, /!centreLock\?\.busy\(\)/, 'the loop does not sleep while a name types or waits for its rest hold')
  // Self-hosted font, no font service.
  const css = readFileSync('src/ui/lockLabel.css', 'utf8')
  assert.ok(!css.includes('.lock-label.dim'), 'a moving lock has no dimmed ghost style')
  assert.match(css, /url\('\/fonts\/share-tech-mono-regular\.ttf'\)/)
  assert.ok(existsSync('public/fonts/share-tech-mono-regular.ttf'))
  for (const f of ['index.html', 'src/ui/lockLabel.css', 'src/ui/lockLabel.ts', 'src/main.ts']) assert.ok(!readFileSync(f, 'utf8').includes('fonts.googleapis'), `${f}: no Google Fonts call`)
  assert.match(readFileSync('public/THIRD-PARTY-NOTICES.txt', 'utf8'), /Share Tech Mono 1\.003 {2}\(SIL Open Font License 1\.1\)[\s\S]*Reserved Font Name 'Share'/)
  // Reduced motion: no transitions, no blink; the typing and bracket animation are skipped in lockLabel.ts.
  assert.match(css, /prefers-reduced-motion: reduce\)[\s\S]*\.lock-label\.typed \.lk-cur \{ animation: none; \}/)
  const ts = readFileSync('src/ui/lockLabel.ts', 'utf8')
  assert.match(ts, /if \(reduced \|\| !brackets/)
  assert.match(ts, /typedAt\(lines, typeFrom \+ \(reduced \|\| f\.moving \? 0 : BRACKET_MS\), now, reduced \|\| f\.moving\)/, 'moving locks show complete text immediately')
  // One announcement per settled feature: the live region holds the spoken sentence; the typed characters are aria-hidden.
  assert.match(ts, /vis\.setAttribute\('aria-hidden', 'true'\)/)
  assert.match(ts, /sr\.setAttribute\('aria-live', 'polite'\)/)
  assert.match(ts, /if \(on && fields && announced !== shown\.since\) \{\s*announced = shown\.since; sr\.textContent = fields\.spoken; typeFrom = now/)
  assert.match(ts, /if \(!shown\.id && sr\.textContent\) sr\.textContent = ''/)
  // Typing writes text only: layout is read when told (placeDirty / a control transition), never per frame.
  assert.match(ts, /if \(placeDirty \|\| now < motionUntil\) \{ placeDirty = false; layout\(\) \}/)
  assert.match(ts, /busy: \(\) => hold\.busy\(\) \|\| \(on && !typedDone\)/)
}
console.log('lock-label: ok')
