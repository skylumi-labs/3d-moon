/** The boot guard in index.html (issue 187): an early failure replaces the splash with a message; a failure after the first frame leaves the page alone. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
// The guard is a file (public/boot-guard.js), loaded as a classic blocking script: an inline guard is blocked by skylumi.org's CSP header.
assert.match(html, /<script id="boot-guard" src="\/boot-guard\.js"><\/script>/, 'index.html loads the boot guard file')
assert.ok(!/<script id="boot-guard">/.test(html), 'the guard is not inline')
const m = [null, readFileSync(new URL('../public/boot-guard.js', import.meta.url), 'utf8')] as const
assert.ok(html.indexOf('id="boot-guard"') < html.indexOf('type="module"'), 'the guard runs before the module script')

function run(opts: { webgl2: boolean; gl?: object; moon?: { ready?: boolean; error?: string | null } }) {
  const listeners: Record<string, Array<(e: unknown) => void>> = {}
  const removed: string[] = []
  const err = { textContent: '', style: {} as Record<string, string> }
  const splash = { parentNode: { removeChild: (n: unknown) => { removed.push(n === splash ? 'splash' : 'other') } } }
  const win: Record<string, unknown> = {
    addEventListener: (t: string, fn: (e: unknown) => void) => { (listeners[t] ??= []).push(fn) },
    ...(opts.moon ? { __moon: opts.moon } : {}),
  }
  const doc = {
    getElementById: (id: string) => (id === 'err' ? err : null),
    createElement: () => ({ getContext: (k: string) => (k === 'webgl2' && opts.webgl2 ? (opts.gl ?? {}) : null) }),
    querySelectorAll: () => [splash],
    body: { classList: { remove: () => {} } },
  }
  vm.runInNewContext(m![1], { window: win, document: doc })
  return { err, removed, win, fire: (t: string, e: unknown) => { for (const fn of listeners[t] ?? []) fn(e) } }
}

// No WebGL2: the message is up before the module even runs, and the splash is gone.
{
  const r = run({ webgl2: false })
  assert.equal(r.err.style.display, 'grid')
  assert.match(r.err.textContent, /WebGL2/)
  assert.deepEqual(r.removed, ['splash'])
}
// The probe gives its context back, and a failure to do so never blocks the page.
{
  let lost = 0
  const r = run({ webgl2: true, gl: { getExtension: (n: string) => (n === 'WEBGL_lose_context' ? { loseContext: () => { lost++ } } : null) } })
  assert.equal(lost, 1, 'the probe context is released')
  assert.equal(r.err.style.display, undefined)
  const t = run({ webgl2: true, gl: { getExtension: () => { throw new Error('no extension') } } })
  assert.equal(t.err.style.display, undefined, 'a throwing release is not a fatal error')
  const n = run({ webgl2: true, gl: { getExtension: () => null } })
  assert.equal(n.err.style.display, undefined, 'no lose-context extension is fine')
}
// An uncaught error before the first frame.
{
  const r = run({ webgl2: true })
  assert.equal(r.err.style.display, undefined, 'a capable browser sees nothing at boot')
  r.fire('error', { message: 'boom', target: r.win })
  assert.equal(r.err.style.display, 'grid')
  assert.match(r.err.textContent, /boom/)
  assert.equal(r.err.style.zIndex, '100')
}
// An unhandled rejection, and a module script that failed to load (the error fires on the element).
{
  const r = run({ webgl2: true })
  r.fire('unhandledrejection', { reason: new Error('import failed') })
  assert.match(r.err.textContent, /import failed/)
  const s = run({ webgl2: true })
  s.fire('error', { target: { tagName: 'SCRIPT', src: '/assets/index.js' } })
  assert.match(s.err.textContent, /Could not load \/assets\/index\.js/)
  const img = run({ webgl2: true })
  img.fire('error', { target: { tagName: 'IMG' } })
  assert.equal(img.err.style.display, undefined, 'a failed image is not fatal')
}
// After the first frame the page is never replaced.
{
  const r = run({ webgl2: true, moon: { ready: true } })
  r.fire('error', { message: 'late', target: r.win })
  assert.equal(r.err.style.display, undefined)
}
// main.ts's own fail() message is the one shown.
{
  const r = run({ webgl2: true, moon: { ready: false, error: 'needs float targets' } })
  r.fire('error', { message: 'Error: needs float targets', target: r.win })
  assert.match(r.err.textContent, /needs float targets/)
}
// main.ts routes renderer construction through fail().
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
assert.match(main, /try \{\s*return new THREE\.WebGLRenderer[\s\S]*?catch \(err\) \{\s*(\/\/[^\n]*\n\s*)*if \(NATIVE_BUILD && showGpuRetry\(reloadAtHome, START_MESSAGE\)\) throw err\s*return fail\(/, 'renderer construction failure goes to fail() (the app first offers the GPU-reset retry card, issue #206)')
console.log('boot-guard.test: ok')
