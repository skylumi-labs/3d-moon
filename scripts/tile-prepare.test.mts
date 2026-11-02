import assert from 'node:assert/strict'
import { scheduleTilePrepare } from '../src/net/tilePrepare'

// 1. The compile runs once the deferral fires, and only once.
{
  const q: Array<() => void> = []
  let n = 0
  const h = scheduleTilePrepare((cb) => q.push(cb), async () => { n++ })
  assert.equal(n, 0, 'nothing runs before the page is idle')
  assert.equal(h.started, false)
  q[0](); q[0]()
  assert.equal(n, 1, 'one compile however often the callback fires')
  assert.equal(h.started, true)
}
// 2. A cancel before idle means no compile.
{
  const q: Array<() => void> = []
  let n = 0
  const h = scheduleTilePrepare((cb) => q.push(cb), async () => { n++ })
  h.cancel(); q[0]()
  assert.equal(n, 0)
}
// 3. A rejected compile is swallowed (the first draw compiles the same program).
{
  const q: Array<() => void> = []
  let unhandled = false
  const onU = (): void => { unhandled = true }
  process.on('unhandledRejection', onU)
  scheduleTilePrepare((cb) => q.push(cb), () => Promise.reject(new Error('no GPU')))
  q[0]()
  await new Promise((r) => setTimeout(r, 20))
  process.off('unhandledRejection', onU)
  assert.equal(unhandled, false)
}
console.log('tile-prepare: ok')
