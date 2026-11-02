/** Silent failure states (issue 191). main.ts cannot be imported in Node, so these pin the wiring in its source, as flight-join.test does. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const fn = (name: string): string => {
  const i = main.indexOf(name)
  assert.ok(i >= 0, `${name} exists`)
  return main.slice(i, i + 2600)
}

// 1. A ?pin= link whose patch fails says so, retries a bounded number of times, and keeps a Retry chip.
{
  const body = fn('async function startAtPin')
  assert.match(body, /patchState === 'failed'/)
  assert.match(body, /caption\.show\(`Could not load/)
  assert.match(body, /label: 'Retry'/)
  assert.match(main, /const PIN_START_RETRY_MS = \[\d+, \d+\]/, 'the automatic retries are bounded')
}
// 2. A lunar module that fails to load in landing offers a retry, momentUnavailable knows it, and a failed patch drops the pending landing.
{
  const body = fn('function beginLanding')
  assert.match(body, /lmLoadFailed = true/)
  assert.match(body, /showLmFailure\(g, kind\)/)
  assert.match(fn('function momentUnavailable'), /m\.groundEnd && lmLoadFailed/)
  assert.match(fn('function retryMoment'), /lmLoadFailed = false/)
  assert.match(fn('function stepDescent'), /if \(patchState === 'failed'\) pendingLanding = null/)
}
// 3. The star catalogue is retried with a backoff, then the visitor is told.
{
  const body = fn('function ensureStars')
  assert.match(main, /const STARS_RETRY_MS = \[\d+, \d+, \d+\]/)
  assert.match(body, /setTimeout\(\(\) => void ensureStars\(\), wait\)/)
  assert.match(body, /caption\.flash\('The star field did not load'/)
}
console.log('silent-failures.test: ok')
