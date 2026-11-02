/** The Labels layer's layout (src/labels/postLayout.ts) and rows (src/labels/curated.ts). tsx scripts/label-layout.test.mts */
import assert from 'node:assert/strict'
import { APPEAR_DELAY_MS, CENTRE_FILL, CENTRE_MIN, FACING, FADE_IN_MS, FADE_OUT_MS, FILL_SPAN, PLACE_MS, TIER_SPAN, apart, centreFill, fillCellAt, fillCells, drawnBox, eligible, fillEligible, settleMoves, segmentHits, leavingBoxes, limbAlpha, overlaps, placeOrReuse, placePosts, postLength, shownSlots, slotsFor, stepLives, type Box, type DropReason, type Life, type PostCandidate } from '../src/labels/postLayout.ts'
import { CURATED } from '../src/labels/curated.ts'
import type { Tier } from '../src/labels/curated.ts'

// 1. The rows: unique ids, positions in range, a fact on every major row, none longer than a line.
{
  const ids = new Set<string>()
  for (const l of CURATED) {
    assert.ok(!ids.has(l.id), `unique id ${l.id}`); ids.add(l.id)
    assert.ok(l.lon >= -180 && l.lon <= 180 && l.lat >= -90 && l.lat <= 90, `${l.id} in range`)
    assert.ok(l.fact.length <= 72, `${l.id}: a fact fits a line (${l.fact.length})`)
    if (l.tier === 1) assert.ok(l.fact.length > 0, `${l.id}: a major row has its context line`)
    if (l.kind === 'mission') assert.ok(l.year && l.agency && l.status, `${l.id}: a mission has its year, agency and outcome`)
    assert.ok(l.source.length > 20, `${l.id} cites its source`)
  }
  for (const id of ['oceanus-procellarum', 'mare-imbrium', 'tycho', 'copernicus', 'apollo-11', 'apollo-17', 'change-4', 'south-pole', 'north-pole', 'highest-point', 'antoniadi', 'mons-huygens'])
    assert.equal(CURATED.find((l) => l.id === id)?.tier, 1, `${id} is major`)
}

// 2. Eligibility: tier 1 always; tiers 2 and 3 appear below one span and leave only above a larger one; the limb has hysteresis.
{
  assert.ok(eligible(1, 1e5, 0.5, false), 'tier 1 at any zoom')
  for (const tier of [2, 3] as const) {
    const t = TIER_SPAN[tier]
    assert.ok(!eligible(tier, t.appear + 1, 0.5, false), `tier ${tier} does not appear above its span`)
    assert.ok(eligible(tier, t.appear - 1, 0.5, false), `tier ${tier} appears below it`)
    assert.ok(eligible(tier, (t.appear + t.leave) / 2, 0.5, true), `tier ${tier} stays between the two`)
    assert.ok(!eligible(tier, t.leave + 1, 0.5, true), `tier ${tier} leaves above the leave span`)
  }
  assert.ok(!eligible(1, 0, (FACING.appear + FACING.leave) / 2, false) && eligible(1, 0, (FACING.appear + FACING.leave) / 2, true), 'limb hysteresis')
  // The centre fill's own spans: a notable name may fill at any zoom; a minor one out to a little past the home view, with hysteresis; never a major one.
  assert.ok(!fillEligible(1, 100, 0.5, false), 'tier 1 is never a fill')
  for (const tier of [2, 3] as const) {
    const t = FILL_SPAN[tier]
    assert.ok(Number.isFinite(t.leave) && t.leave > t.appear, `tier ${tier} fills have a finite leave span above the appear span`)
    assert.ok(fillEligible(tier, t.appear - 1, 0.5, false) && !fillEligible(tier, t.appear + 1, 0.5, false), `a tier ${tier} fill appears below its span`)
    assert.ok(fillEligible(tier, t.leave - 1, 0.5, true) && !fillEligible(tier, t.leave + 1, 0.5, true), 'and leaves above a larger one')
  }
  assert.ok(FILL_SPAN[2].appear >= TIER_SPAN[2].leave, 'a notable fill may join only once the ordinary tier-2 names have left')
  assert.ok(FILL_SPAN[3].appear > TIER_SPAN[2].appear, 'the home view (about 2,400 km) keeps a minor fill')
  assert.ok(!fillEligible(3, 100, (FACING.appear + FACING.leave) / 2, false) && fillEligible(3, 100, (FACING.appear + FACING.leave) / 2, true), 'the limb rule with hysteresis')
  assert.equal(limbAlpha(FACING.leave), 0); assert.equal(limbAlpha(FACING.appear), 1)
  assert.ok(postLength(1, 1) > postLength(1, 0) && postLength(1, 0) > 0 && postLength(1, 1) > postLength(3, 1), 'posts lean and scale by tier')
}

// A scene generator: n labels scattered over a frame, sized like names.
let seed = 7
const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const W = 1280, H = 800, BOUNDS: Box = [0, 0, W, H]
function scene(n: number, scale = 1, cx = W / 2, cy = H / 2): PostCandidate[] {
  seed = 11
  return Array.from({ length: n }, (_, i) => {
    const tier = (1 + (i % 3)) as Tier
    const x = cx + (rnd() - 0.5) * 900 * scale, y = cy + (rnd() - 0.5) * 600 * scale
    const a = Math.atan2(y - cy, x - cx)
    return { id: `l${i}`, tier, order: i, base: { x, y }, dir: { x: Math.cos(a), y: Math.sin(a) }, postPx: postLength(tier, 0.7), w: 60 + rnd() * 120, h: tier === 1 ? 34 : 18, nameH: 18 }
  })
}
const run = (cands: PostCandidate[], lives: Map<string, Life>, now: number, dt = 16): string[] => {
  const placed = placePosts(cands, shownSlots(lives), leavingBoxes(lives), [], BOUNDS)
  return stepLives(lives, placed, now, dt)
}

// 3. No two placed labels overlap, and none covers another's icon or leaves the frame.
{
  for (const n of [10, 40, 120]) {
    const placed = placePosts(scene(n), new Map(), [], [[400, 700, 880, 800]], BOUNDS)
    const boxes = [...placed.values()]
    for (let i = 0; i < boxes.length; i++) for (let j = 0; j < boxes.length; j++) {
      if (i !== j) assert.ok(!overlaps(boxes[i].slot.rect, boxes[j].slot.rect), `labels ${boxes[i].id} and ${boxes[j].id} overlap (n=${n})`)
      if (i !== j) assert.ok(!overlaps(boxes[i].slot.rect, boxes[j].icon), `label ${boxes[i].id} covers icon ${boxes[j].id}`)
    }
    for (const b of boxes) assert.ok(!overlaps(b.slot.rect, [400, 700, 880, 800]), 'clear of the bar')
    for (const b of boxes) assert.ok(b.slot.rect[0] >= 8 && b.slot.rect[2] <= W - 8 && b.slot.rect[1] >= 8 && b.slot.rect[3] <= H - 8, 'inside the frame')
  }
}

// 3b. Posts: a segment test, and no placed post runs through another label's icon.
{
  assert.ok(segmentHits({ x: 0, y: 0 }, { x: 10, y: 10 }, [4, 4, 6, 6]), 'a diagonal through a box')
  assert.ok(!segmentHits({ x: 0, y: 0 }, { x: 10, y: 0 }, [4, 2, 6, 6]), 'a line beside a box')
  assert.ok(!segmentHits({ x: 0, y: 0 }, { x: 3, y: 3 }, [4, 4, 6, 6]), 'a segment that stops short')
  assert.ok(segmentHits({ x: 5, y: 0 }, { x: 5, y: 10 }, [4, 4, 6, 6]), 'a vertical line through a box')
  assert.ok(segmentHits({ x: 5, y: 5 }, { x: 50, y: 50 }, [4, 4, 6, 6]), 'a segment that starts inside')
  assert.ok(!segmentHits({ x: 0, y: 10 }, { x: 10, y: 0 }, [8, 8, 10, 10]), 'a diagonal that misses the corner')
  const cands = scene(60)
  const placed = placePosts(cands, new Map(), [], [], BOUNDS)
  for (const p of placed.values()) {
    const c = cands.find((x) => x.id === p.id)!
    if (p.slot.lf === 0) continue
    for (const q of placed.values()) if (q.id !== p.id) assert.ok(!segmentHits(c.base, p.slot.tip, q.icon), `the post of ${p.id} crosses the icon of ${q.id}`)
  }
}

// 3c. The frame's budget: newcomers stop at it, names on screen keep their place up to two over it.
{
  const cands = scene(60)
  assert.ok(placePosts(cands, new Map(), [], [], BOUNDS, 5).size <= 5, 'newcomers stop at the budget')
  const full = placePosts(cands, new Map(), [], [], BOUNDS)
  const shownNow = new Map([...full.values()].slice(0, 7).map((p) => [p.id, p.slot.key]))
  assert.equal(placePosts(cands, shownNow, [], [], BOUNDS, 5).size, 7, 'names on screen keep their place up to two over it')
}

// 4. A label never sits on its own post: it goes to the side its post leans to.
{
  const c: PostCandidate = { id: 'x', tier: 1, order: 0, base: { x: 300, y: 400 }, dir: { x: -1, y: 0 }, postPx: 40, w: 120, h: 34, nameH: 18 }
  const s = slotsFor(c)[0]
  assert.equal(s.side, 'l', 'a post leaning left puts its name on the left')
  assert.ok(s.rect[2] < 300 - 40, 'and the name is beyond the tip, clear of the icon')
}

// 5. Zooming in never removes a label: scale the scene outward step by step (anchors spread, as when the camera comes closer);
// the set on screen only grows. Zooming back out may remove, but never flickers: no label leaves and returns within a sweep.
{
  const lives = new Map<string, Life>()
  let now = 0
  const visible = (): Set<string> => new Set([...lives].filter(([, l]) => l.target === 1).map(([id]) => id))
  for (let i = 0; i < 40; i++) { now += 16; run(scene(60, 1), lives, now) }
  let prev = visible()
  assert.ok(prev.size > 5, `a populated start (${prev.size})`)
  for (let k = 0; k <= 60; k++) {
    now += 16
    const snapShown = shownSlots(lives), snapLeaving = leavingBoxes(lives)
    run(scene(60, 1 + k * 0.03), lives, now)
    const cur = visible()
    for (const id of prev) {
      const c = scene(60, 1 + k * 0.03).find((x) => x.id === id)!
      // A point in the band along the frame's edge is about to leave the frame: there a squeeze may push a smaller name out
      // (it fades, it never flickers). Everywhere else, zooming in keeps every name.
      if (c.base.x < 80 || c.base.x > W - 80 || c.base.y < 80 || c.base.y > H - 80) continue
      if (!cur.has(id) && process.env.DEBUG_LAYOUT) {
        const sc = scene(60, 1 + k * 0.03)
        const me = sc.find((x) => x.id === id)!
        const placed = placePosts(sc, snapShown, snapLeaving, [], BOUNDS)
        console.log('dropped', id, 'tier', me.tier, 'base', me.base, 'w', me.w, 'prev slot', snapShown.get(id))
        for (const p of placed.values()) if (p.id !== id) console.log('   placed', p.id, sc.find((x) => x.id === p.id)!.tier, snapShown.has(p.id) ? 'shown' : 'new', p.slot.key, p.slot.rect.map(Math.round).join(','))
        for (const sl of slotsFor(me)) {
          const hits = [...placed.values()].filter((p) => overlaps(sl.rect, p.slot.rect) || overlaps(sl.rect, p.icon)).map((p) => p.id)
          console.log(' ', sl.key, sl.rect.map(Math.round).join(','), 'hits', hits.join(' '))
        }
      }
      assert.ok(cur.has(id), `zooming in dropped ${id} at step ${k}`)
    }
    prev = cur
  }
  const gone = new Set<string>(), back: string[] = []
  for (let k = 60; k >= 0; k--) {
    now += 16
    run(scene(60, 1 + k * 0.03), lives, now)
    const cur = visible()
    for (const id of prev) if (!cur.has(id)) gone.add(id)
    for (const id of cur) if (gone.has(id) && !prev.has(id)) back.push(id)
    prev = cur
  }
  assert.ok(back.length <= 2, `zooming out does not flicker labels off and on (${back.join(', ')})`)
}

// 6. Stability: a still scene settles and then never changes slots.
{
  const lives = new Map<string, Life>()
  let now = 0
  for (let i = 0; i < 60; i++) { now += 16; run(scene(80), lives, now) }
  const before = JSON.stringify([...shownSlots(lives)])
  for (let i = 0; i < 60; i++) { now += 16; run(scene(80), lives, now) }
  assert.equal(JSON.stringify([...shownSlots(lives)]), before, 'a still scene keeps every slot')
}

// 7. Appear and leave: a new label waits APPEAR_DELAY_MS, fades in over FADE_IN_MS; a removed one fades out over FADE_OUT_MS
// and reserves its box against newcomers meanwhile.
{
  const lives = new Map<string, Life>()
  const one: PostCandidate[] = [{ id: 'a', tier: 2, order: 0, base: { x: 600, y: 400 }, dir: { x: 1, y: 0 }, postPx: 30, w: 100, h: 18, nameH: 18 }]
  let now = 0
  run(one, lives, now)
  assert.equal(lives.get('a')!.alpha, 0, 'not on the first frame')
  for (now = 16; now < APPEAR_DELAY_MS; now += 16) run(one, lives, now)
  assert.equal(lives.get('a')!.alpha, 0, 'not before the delay')
  for (; now < APPEAR_DELAY_MS + FADE_IN_MS + 64; now += 16) run(one, lives, now)
  assert.equal(lives.get('a')!.alpha, 1, 'fully in after the fade')
  run([], lives, now += 16)
  assert.ok(lives.get('a')!.alpha > 0 && leavingBoxes(lives).length === 1, 'fading out, its box reserved')
  const rival: PostCandidate[] = [{ ...one[0], id: 'b' }]
  const placed = placePosts(rival, shownSlots(lives), leavingBoxes(lives), [], BOUNDS)
  assert.ok(!placed.has('b') || !overlaps(placed.get('b')!.slot.rect, leavingBoxes(lives)[0]), 'a newcomer keeps off a leaving name')
  for (let t = 0; t < FADE_OUT_MS + 32; t += 16) run([], lives, now += 16)
  assert.ok(!lives.has('a'), 'gone after the fade')
}

// 8. Hierarchy and pinning: a major label always wins a contested place over a minor one already on screen; a pinned label
// keeps its slot even when everything else wants it.
{
  const base = { base: { x: 600, y: 400 }, dir: { x: 1, y: 0 }, postPx: 30, w: 140, h: 18, nameH: 18 }
  const minor: PostCandidate = { id: 'minor', tier: 3, order: 0, ...base }
  const major: PostCandidate = { id: 'major', tier: 1, order: 0, ...base, base: { x: 604, y: 402 } }
  const placed = placePosts([minor, major], new Map([['minor', 'r1']]), [], [], BOUNDS)
  assert.ok(placed.has('major'), 'the major label is placed')
  const pinned = placePosts([{ ...minor, pinned: true }, major], new Map([['minor', 'r1'], ['major', 'r1']]), [], [], BOUNDS)
  assert.equal(pinned.get('minor')?.slot.key, 'r1', 'the pinned label keeps its slot')
}
// A moving camera reuses the collision layout for at most 100 ms, while dropping labels no longer in the candidate set.
{
  const original = placePosts(scene(8), new Map(), [], [], BOUNDS)
  let calls = 0
  const prev = { at: 100, placed: original }
  const reused = placeOrReuse(prev, 100 + PLACE_MS, new Set(['l0', 'l1']), () => { calls++; return new Map() })
  assert.equal(reused.reused, true)
  assert.deepEqual([...reused.placed.keys()], ['l0', 'l1'])
  assert.equal(calls, 0)
  const fresh = placeOrReuse(prev, 101 + PLACE_MS, new Set(['l0']), () => { calls++; return new Map() })
  assert.equal(fresh.reused, false)
  assert.equal(calls, 1)
  // A reused layout holds only while the names, followed to where their tips are now, still stand apart (the overlap at the limb, 2026-10-22).
  const ids = new Set(original.keys())
  const still = placeOrReuse(prev, 150, ids, () => { calls++; return new Map() }, (id, p) => ({ rect: p.slot.rect, icon: p.icon }))
  assert.equal(still.reused, true, 'boxes where they were placed: reused')
  const squeezed = placeOrReuse(prev, 150, ids, () => { calls++; return new Map() }, (_id, p) => ({ rect: [600, 400, 600 + (p.slot.rect[2] - p.slot.rect[0]), 418], icon: p.icon }))
  assert.equal(squeezed.reused, false, 'boxes that have converged: placed afresh')
  assert.equal(calls, 2)
  assert.ok(apart([{ rect: [0, 0, 10, 10], icon: [2, 2, 4, 4] }, { rect: [20, 0, 30, 10], icon: [22, 2, 24, 4] }]) && !apart([{ rect: [0, 0, 10, 10], icon: [2, 2, 4, 4] }, { rect: [5, 0, 30, 10], icon: [22, 2, 24, 4] }]) && !apart([{ rect: [0, 0, 10, 10], icon: [2, 2, 4, 4] }, { rect: [20, 0, 30, 10], icon: [8, 2, 12, 4] }]), 'apart: rects and points')
  // Leaving names (`others`) count against the layout's boxes, not against each other.
  assert.ok(!apart([{ rect: [0, 0, 10, 10], icon: [2, 2, 4, 4] }], [[5, 5, 15, 15]]) && apart([{ rect: [0, 0, 10, 10], icon: [2, 2, 4, 4] }], [[20, 0, 30, 10], [25, 0, 35, 10]]), 'apart: others')
  const fading = placeOrReuse(prev, 150, ids, () => { calls++; return new Map() }, (_id, p) => ({ rect: p.slot.rect, icon: p.icon }), [original.get('l0')!.slot.rect])
  assert.equal(fading.reused, false, 'a leaving name drawn over a reused box: placed afresh')
}

// 9. Region fill: roughly square cells are clipped by the projected Moon disc; short cells get one best fill each.
{
  const name = (id: string, tier: Tier, x: number, y: number, fill = false, order = 0): PostCandidate => ({ id, tier, order, base: { x, y }, dir: { x: 0, y: -1 }, postPx: postLength(tier, 0.5), w: 90, h: 18, nameH: 18, ...(fill ? { fill: true } : {}) })
  const disc = { center: { x: W / 2, y: H / 2 }, radius: 600 }
  const cells = fillCells(BOUNDS, disc)
  assert.ok(cells.length > 4 && cells.some((c) => c.id === '1:1'), 'disc includes center and surrounding cells')
  const clipped = fillCells(BOUNDS, { ...disc, radius: 300 })
  assert.ok(!clipped.some((c) => c.id === '0:0'), 'a corner cell whose centre is outside the visible disc is omitted')
  // Ordinary names at the top and bottom of the middle strip leave both the center and left-middle cells short.
  const ordinary = [name('top-middle', 1, 600, 140), name('bottom-middle', 2, 700, 660)]
  const options = [name('center-fill', 3, 610, 400, true), name('left-fill', 2, 180, 400, true), name('left-extra', 3, 200, 410, true)]
  const chosen = centreFill([...ordinary, ...options], BOUNDS, () => false, () => 'new', cells)
  assert.deepEqual(chosen.filter((c) => c.fill).map((c) => c.id).sort(), ['center-fill', 'left-fill'], 'center and left-middle short cells fill once each')
  assert.notEqual(fillCellAt(ordinary[0].base, cells)?.id, '1:1', 'top-middle name is outside the center cell')
  assert.notEqual(fillCellAt(ordinary[1].base, cells)?.id, '1:1', 'bottom-middle name is outside the center cell')
  // Every disc cell has an ordinary name: no fill is offered even if extra candidates exist.
  const full = [...cells.map((cell, i) => name(`ordinary-${i}`, 1, cell.center.x, cell.center.y)), ...options]
  assert.equal(centreFill(full, BOUNDS, () => false, () => 'new', cells).filter((c) => c.fill).length, 0, 'full disc grid takes no fill')
  // One fill per cell, global budget, and deterministic preference ordering.
  const many = cells.map((cell, i) => name(`candidate-${i}`, 3, cell.center.x, cell.center.y, true, i))
  const budgeted = centreFill(many, BOUNDS, () => false, () => 'new', cells)
  assert.equal(budgeted.filter((c) => c.fill).length, CENTRE_FILL, 'fresh fills stop at the global budget')
  // A shown fill remains offered after the ordinary count recovers; it still leaves when off frame.
  const shownCandidate = name('sticky', 3, 610, 400, true)
  const recovered = centreFill([...ordinary, name('center-name', 1, 620, 390), shownCandidate], BOUNDS, (id) => id === 'sticky', () => 'placed', cells)
  assert.ok(recovered.some((c) => c.id === 'sticky'), 'shown fill survives count recovery')
  assert.equal(centreFill([name('gone', 3, -30, 400, true)], BOUNDS, () => true, () => 'new', cells).some((c) => c.id === 'gone'), false, 'off-frame shown fill is released')
  // Candidates in cells outside the Moon-disc mask are never offered.
  assert.equal(centreFill([name('off-disc', 2, 20, 20, true)], BOUNDS, () => false, () => 'new', clipped).some((c) => c.fill), false)
  assert.equal(CENTRE_MIN, 1)
  // The terminator's label does not hold a cell: the middle of a half-lit Moon still gets a name (owner 2026-10-24).
  const centre = fillCellAt({ x: 610, y: 400 }, cells)!
  const withTerminator = centreFill([name('terminator', 1, centre.center.x, centre.center.y), name('centre-fill', 3, centre.center.x + 5, centre.center.y + 5, true)], BOUNDS, () => false, () => 'new', cells)
  assert.ok(withTerminator.some((c) => c.id === 'centre-fill'), 'a cell holding only the terminator label takes a fill')
}

// 9b. Names on the move: a box is drawn at its tip plus the slot's offset; a name easing to a new slot that would cross another
// drawn box (a fading one included) jumps to its slot instead; a name already at its slot, and a leaving name, never jump.
{
  const c = { base: { x: 100, y: 100 }, dir: { x: 0, y: -1 }, postPx: 40 }
  assert.deepEqual(drawnBox(c, 1, { x: 6, y: -9 }, 50, 18), [106, 51, 156, 69])
  assert.deepEqual(drawnBox(c, 0, { x: 6, y: -9 }, 50, 18), [106, 91, 156, 109])
  const settled: Box = [0, 0, 50, 18], movingNow: Box = [40, 0, 90, 18], movingAt: Box = [200, 0, 250, 18], leaving: Box = [80, 5, 130, 23]
  assert.deepEqual([...settleMoves([{ id: 'a', now: settled, at: settled }, { id: 'b', now: movingNow, at: movingAt }])], ['b'], 'the mover jumps, the settled name stays')
  assert.deepEqual([...settleMoves([{ id: 'b', now: movingNow, at: movingAt }, { id: 'f', now: leaving, at: null }])], ['b'], 'crossing a fading name: the mover jumps, the fading name cannot')
  assert.deepEqual([...settleMoves([{ id: 'a', now: settled, at: settled }, { id: 'b', now: movingAt, at: movingAt }])], [], 'apart: nothing jumps')
  const aNow: Box = [0, 0, 10, 10], aAt: Box = [20, 0, 30, 10]
  const bNow: Box = [5, 0, 15, 10], bAt: Box = [50, 0, 60, 10]
  const cNow: Box = [20, 0, 30, 10], cAt: Box = [80, 0, 90, 10]
  assert.deepEqual([...settleMoves([{ id: 'a', now: aNow, at: aAt }, { id: 'b', now: bNow, at: bAt }, { id: 'c', now: cNow, at: cAt }])], ['a', 'b', 'c'], 'after A and B snap clear their crossing, A lands on C, so C snaps too')
  const revisited = [{ id: 'c', now: cNow, at: cAt }, { id: 'a', now: aNow, at: aAt }, { id: 'b', now: bNow, at: bAt }]
  const jumps = settleMoves(revisited)
  assert.deepEqual([...jumps].sort(), ['a', 'b', 'c'], 'ordered [c, a, b], the earlier c/a pair must be revisited after a and b snap')
  const settledBoxes = revisited.map((d) => jumps.has(d.id) && d.at ? d.at : d.now)
  for (let i = 0; i < settledBoxes.length; i++) for (let j = i + 1; j < settledBoxes.length; j++)
    assert.ok(!overlaps(settledBoxes[i], settledBoxes[j]), `settled labels ${revisited[i].id} and ${revisited[j].id} do not overlap`)
}

// 10. Drop reasons, and a leaving name's box is closed to a shown label too: it moves rather than cross-fading over it.
{
  const a: PostCandidate = { id: 'a', tier: 1, order: 0, base: { x: 600, y: 400 }, dir: { x: 1, y: 0 }, postPx: 30, w: 100, h: 18, nameH: 18 }
  const first = placePosts([a], new Map(), [], [], BOUNDS).get('a')!
  const moved = placePosts([a], new Map([['a', first.slot.key]]), [first.slot.rect], [], BOUNDS).get('a')
  assert.ok(moved && moved.slot.key !== first.slot.key && !overlaps(moved.slot.rect, first.slot.rect), 'a shown name steps off a leaving box')
  const pinnedKeeps = placePosts([{ ...a, pinned: true }], new Map([['a', first.slot.key]]), [first.slot.rect], [], BOUNDS).get('a')
  assert.equal(pinnedKeeps?.slot.key, first.slot.key, 'a pinned name keeps its slot over a leaving box')
  const why = new Map<string, DropReason>()
  const cands: PostCandidate[] = [a, { ...a, id: 'off', base: { x: -50, y: 400 } }, { ...a, id: 'under', base: { x: 602, y: 401 }, tier: 2 }, { ...a, id: 'late', base: { x: 300, y: 300 }, tier: 3 }, { ...a, id: 'later', base: { x: 300, y: 600 }, tier: 3 }]
  const out = placePosts(cands, new Map(), [], [], BOUNDS, 2, why)
  assert.deepEqual([...out.keys()].sort(), ['a', 'late'])
  assert.equal(why.get('off'), 'off-frame'); assert.equal(why.get('under'), 'point-covered'); assert.equal(why.get('later'), 'budget'); assert.equal(why.get('a'), undefined)
  const boxed = new Map<string, DropReason>()
  // The point itself stays clear (a 20 px window around it); every slot runs into the chrome around that window.
  placePosts([a], new Map(), [], [[0, 0, W, 390], [0, 410, W, H], [0, 390, 590, 410], [610, 390, W, 410]], BOUNDS, Infinity, boxed)
  assert.equal(boxed.get('a'), 'no-slot', 'a point in a window in the chrome has no slot')
}
console.log('label-layout.test ok')
