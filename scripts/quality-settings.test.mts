// The Quality settings store (src/quality/settings.ts) and its adapter (src/quality/apply.ts).
import assert from 'node:assert/strict'
import { _resetForTest, getQuality, isExplicit, onQualityChange, parseSearch, parseStored, resetQuality, setQuality, STORAGE_KEY } from '../src/quality/settings.ts'
import { BATTERY_KNOBS, describeQuality, motionKnobs, motionShaderFor, shadowAblation } from '../src/quality/apply.ts'
import { CLASS_TABLE } from '../src/quality/startupClass.ts'

const g = globalThis as unknown as Record<string, unknown>
function fakeStorage(init: Record<string, string> = {}): Storage & { data: Record<string, string> } {
  const data = { ...init }
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v }, removeItem: (k: string) => { delete data[k] }, clear: () => {}, key: () => null, length: 0 } as unknown as Storage & { data: Record<string, string> }
}
function fresh(search = '', ls: Storage | null = fakeStorage()): void {
  _resetForTest()
  g.location = { search }
  if (ls) g.localStorage = ls; else delete g.localStorage
}

// defaults
fresh()
assert.deepEqual(getQuality(), { preset: 'auto', shadows: 'full', detail: 'full', glow: true, motion: 'smooth' })
assert.equal(getQuality(), getQuality(), 'same object until something changes')

// persistence round trip
{
  const ls = fakeStorage()
  fresh('', ls)
  setQuality({ preset: 'battery', glow: false })
  assert.ok(ls.data[STORAGE_KEY], 'written')
  fresh('', ls)
  assert.deepEqual(getQuality(), { preset: 'battery', shadows: 'fast', detail: 'reduced', glow: false, motion: 'smooth' })
}

// the preset fills unset rows; an explicit row beats the preset, in either order
fresh()
setQuality({ preset: 'battery' })
assert.equal(getQuality().shadows, 'fast')
assert.equal(isExplicit('shadows'), false)
setQuality({ shadows: 'full' })
assert.equal(getQuality().shadows, 'full', 'explicit beats Battery')
setQuality({ preset: 'high' })
setQuality({ preset: 'battery' })
assert.equal(getQuality().shadows, 'full', 'still explicit after the preset changes')
assert.equal(getQuality().detail, 'reduced', 'unset rows follow the preset')
resetQuality()
assert.equal(getQuality().shadows, 'fast', 'reset hands the rows back to the preset')

// auto never turns shadows off by itself
for (const p of ['auto', 'high'] as const) { fresh(); setQuality({ preset: p }); assert.equal(getQuality().shadows, 'full') }
fresh(); setQuality({ preset: 'battery' }); assert.notEqual(getQuality().shadows, 'off', 'Battery is Fast, not Off')

// URL overrides, not persisted; touching the control wins afterwards
{
  const ls = fakeStorage()
  fresh('?quality=high&shadows=off&detail=reduced&glow=0', ls)
  assert.deepEqual(getQuality(), { preset: 'high', shadows: 'off', detail: 'reduced', glow: false, motion: 'smooth' })
  assert.equal(ls.data[STORAGE_KEY], undefined, 'a URL override alone writes nothing')
  setQuality({ shadows: 'full' })
  assert.equal(getQuality().shadows, 'full', 'the visitor’s touch beats the URL')
  assert.equal(getQuality().glow, false, 'the other URL values stay')
}
fresh('?quality=nonsense&shadows=maybe&detail=0.5&glow=2')
assert.deepEqual(getQuality(), { preset: 'auto', shadows: 'full', detail: 'full', glow: true, motion: 'smooth' }, 'invalid values and the old numeric ?detail= are ignored')
fresh('?quality=battery&shadows=baked')
assert.equal(getQuality().shadows, 'baked', 'the internal benchmark URL mode is retained')
fresh('', fakeStorage({ [STORAGE_KEY]: JSON.stringify({ preset: 'auto', shadows: 'baked' }) }))
assert.equal(getQuality().shadows, 'full', 'a stored Baked value falls back to the default preset mode')
assert.deepEqual(parseSearch('?glow=on').explicit, { glow: true })
assert.deepEqual(parseSearch('?glow=off').explicit, { glow: false })
assert.ok(parseSearch('?detail=0.5').explicit.detail === undefined)
// URL beats stored
fresh('?shadows=fast', fakeStorage({ [STORAGE_KEY]: JSON.stringify({ preset: 'auto', shadows: 'off' }) }))
assert.equal(getQuality().shadows, 'fast')

// broken localStorage: reads throw, writes throw, missing, garbage
{
  const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') } } as unknown as Storage
  fresh('', throwing)
  assert.equal(getQuality().preset, 'auto')
  assert.doesNotThrow(() => setQuality({ glow: false }))
  assert.equal(getQuality().glow, false, 'the choice holds for this visit')
  fresh('', null)
  assert.doesNotThrow(() => setQuality({ preset: 'high' }))
  assert.equal(getQuality().preset, 'high')
  Object.defineProperty(g, 'localStorage', { configurable: true, get() { throw new Error('SecurityError') } })
  _resetForTest()
  assert.doesNotThrow(() => getQuality())
  assert.doesNotThrow(() => setQuality({ glow: true }))
  delete g.localStorage
}
for (const raw of ['{not json', 'null', '[]', '"x"', '{"preset":7,"shadows":"bogus","detail":1,"glow":"yes"}', '']) {
  assert.deepEqual(parseStored(raw).explicit, {}, `garbage ${raw}`)
  assert.equal(parseStored(raw).preset, 'auto')
}
assert.deepEqual(parseStored('{"preset":"battery","glow":false,"extra":1}'), { preset: 'battery', explicit: { glow: false } })

// listeners: fire on change only, unsubscribe, a throwing listener does not stop the next
{
  fresh()
  const seen: string[] = []
  const off = onQualityChange((q) => seen.push(q.preset))
  onQualityChange(() => { throw new Error('bad listener') })
  onQualityChange((q) => seen.push('b:' + q.preset))
  setQuality({ preset: 'high' })
  setQuality({ preset: 'high' })
  assert.deepEqual(seen, ['high', 'b:high'], 'no event when nothing changed; a throwing listener is isolated')
  off()
  setQuality({ preset: 'battery' })
  assert.deepEqual(seen, ['high', 'b:high', 'b:battery'])
  setQuality({ preset: 'nope' as never, shadows: 'nope' as never })
  assert.equal(getQuality().preset, 'battery', 'invalid patch values are ignored')
}

// adapter
{
  const phone = CLASS_TABLE['phone-android']
  assert.equal(motionKnobs(phone, 'auto').dprCap, 1.5, 'auto = the detected class')
  assert.equal(motionKnobs(phone, 'auto').motionCaps, true)
  const high = motionKnobs(phone, 'high')
  assert.equal(high.dprCap, CLASS_TABLE.desktop.dprCap, 'High forces the desktop constants')
  assert.equal(high.motionCaps, undefined)
  assert.equal(high.motionStart, undefined)
  const b = motionKnobs(CLASS_TABLE.desktop, 'battery')
  assert.equal(b.dprCap, 1.25)
  assert.equal(b.closeDprCap, 1.25)
  assert.equal(b.motionCaps, true)
  assert.equal(b.motionStart, BATTERY_KNOBS.motionStart)
  assert.ok(motionKnobs({ ...phone, dprCap: 1 }, 'battery').dprCap <= 1, 'Battery never raises a lower class')
  assert.deepEqual([shadowAblation('full'), shadowAblation('fast'), shadowAblation('off')], [0, 2, 1])
}
// numeric ?detail=0 reads as Reduced; other numbers stay the old dial
fresh('?detail=0'); assert.equal(getQuality().detail, 'reduced')
fresh('?detail=1'); assert.equal(getQuality().detail, 'full')

// touching a control drops its URL parameter, so a reload cannot bring the URL value back
{
  const loc = { href: 'http://x/moon/?shadows=off&glow=0&t=2026-10-29T00:00:00Z', search: '?shadows=off&glow=0&t=2026-10-29T00:00:00Z' }
  _resetForTest(); g.localStorage = fakeStorage(); g.location = loc
  g.history = { state: null, replaceState: (_s: unknown, _t: string, u: URL) => { loc.href = String(u); loc.search = u.search } }
  assert.equal(getQuality().shadows, 'off')
  setQuality({ shadows: 'full' })
  assert.ok(!loc.search.includes('shadows'), 'shadows param dropped')
  assert.ok(loc.search.includes('glow=0') && loc.search.includes('t='), 'other params stay')
  delete g.history
}
// Motion detail (phone-term): Smooth by default on every class; ?phonemotion seeds it; a tap applies at once, persists, and beats the URL
{
  const ls = fakeStorage()
  fresh('', ls)
  assert.equal(getQuality().motion, 'smooth')
  assert.equal(isExplicit('motion'), false)
  let seen = ''
  onQualityChange((q) => { seen = q.motion })
  setQuality({ motion: 'classic' })
  assert.equal(seen, 'classic', 'listeners hear it at once')
  assert.equal(isExplicit('motion'), true)
  fresh('', ls); assert.equal(getQuality().motion, 'classic', 'persisted')
  resetQuality(); assert.equal(getQuality().motion, 'smooth', 'Follow the preset clears it')
  fresh('?phonemotion=0'); assert.equal(getQuality().motion, 'classic')
  fresh('?phonemotion=1', fakeStorage({ [STORAGE_KEY]: JSON.stringify({ motion: 'classic' }) })); assert.equal(getQuality().motion, 'smooth', 'URL over stored')
  assert.equal(parseStored('{"motion":"bogus"}').explicit.motion, undefined)
  fresh('?phonemotion=0'); setQuality({ motion: 'smooth' }); assert.equal(getQuality().motion, 'smooth', 'touched control beats URL')
}
// the shader switch follows the row on every device class; ?motionshader seeds it too and a tap beats it
{
  for (const cls of ['ios', 'phone-android', 'tablet', 'desktop']) {
    fresh(`?class=${cls}`); assert.equal(motionShaderFor(getQuality()), true, `${cls}: Smooth by default`)
    setQuality({ motion: 'classic' }); assert.equal(motionShaderFor(getQuality()), false, `${cls}: Classic is off`)
  }
  fresh('?motionshader=0'); assert.equal(motionShaderFor(getQuality()), false)
  setQuality({ motion: 'smooth' }); assert.equal(motionShaderFor(getQuality()), true, 'tap beats ?motionshader')
  fresh('?motionshader=1&phonemotion=0'); assert.equal(getQuality().motion, 'smooth', 'motionshader wins when both are given')
  assert.ok(describeQuality(getQuality(), 'desktop').includes('motion smooth'))
}
{
  const loc = { href: 'http://x/moon/?motionshader=0&phonemotion=0&t=1', search: '?motionshader=0&phonemotion=0&t=1' }
  _resetForTest(); g.localStorage = fakeStorage(); g.location = loc
  g.history = { state: null, replaceState: (_s: unknown, _t: string, u: URL) => { loc.href = String(u); loc.search = u.search } }
  getQuality(); setQuality({ motion: 'smooth' })
  assert.ok(!loc.search.includes('motionshader') && !loc.search.includes('phonemotion') && loc.search.includes('t=1'), 'both motion params dropped')
  delete g.history
}
console.log('quality-settings: ok')
