import assert from 'node:assert/strict'
import { escapeReachesPage } from '../src/camera/controls'

// Sliders keep Escape working for the page: the time slider, the eclipse scrubber and the star boost are all inputs.
assert.equal(escapeReachesPage({ tagName: 'INPUT', type: 'range' } as unknown as EventTarget), true)
assert.equal(escapeReachesPage({ tagName: 'BUTTON' } as unknown as EventTarget), true)
assert.equal(escapeReachesPage(null), true)
// Typed-into fields and pickers keep it.
assert.equal(escapeReachesPage({ tagName: 'INPUT', type: 'datetime-local' } as unknown as EventTarget), false)
assert.equal(escapeReachesPage({ tagName: 'INPUT', type: 'text' } as unknown as EventTarget), false)
assert.equal(escapeReachesPage({ tagName: 'TEXTAREA' } as unknown as EventTarget), false)
assert.equal(escapeReachesPage({ tagName: 'SELECT' } as unknown as EventTarget), false)
console.log('escape-key: ok')
