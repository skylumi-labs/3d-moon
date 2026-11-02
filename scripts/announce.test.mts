/**
 * Flight announcements: the sentences, and that a burst of events speaks once.
 *   node --import tsx scripts/announce.test.mts
 */
import assert from 'node:assert/strict'
import { Debouncer, announcementFor, type Timers } from '../src/ui/announce.ts'

assert.equal(announcementFor({ kind: 'start', title: 'Tycho Crater', count: '4 of 9' }), 'Flying to Tycho Crater, 4 of 9')
assert.equal(announcementFor({ kind: 'start', title: 'Home' }), 'Flying to Home')
assert.equal(announcementFor({ kind: 'arrive', title: 'Tycho Crater' }), 'Tycho Crater')
assert.equal(announcementFor({ kind: 'stop' }), 'Stopped; you can fly back')
assert.match(announcementFor({ kind: 'moved', title: 'Earthrise' }), /moved off Earthrise.*flies back/)
assert.equal(announcementFor({ kind: 'hint', text: 'A hint.' }), 'A hint.')

let now = 0
const jobs = new Map<number, { at: number; fn: () => void }>()
let next = 1
const timers: Timers = {
  set(fn, ms) { const id = next++; jobs.set(id, { at: now + ms, fn }); return id },
  clear(h) { jobs.delete(h as number) },
}
const advance = (ms: number): void => {
  now += ms
  for (const [id, j] of [...jobs]) if (j.at <= now) { jobs.delete(id); j.fn() }
}
const said: string[] = []
const d = new Debouncer((t) => said.push(t), timers, 300)
d.say('a'); advance(100); d.say('b'); advance(100); d.say('c')
assert.deepEqual(said, [])
advance(299); assert.deepEqual(said, [])
advance(1); assert.deepEqual(said, ['c'])
d.say('d'); advance(300)
assert.deepEqual(said, ['c', 'd'])
console.log('announce: ok')
