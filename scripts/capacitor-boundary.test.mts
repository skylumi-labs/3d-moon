// The web package has no Capacitor: the shell lives in skylumi-labs/3d-moon-native, which pins this repo as `web`.
// Fails if any tracked or new file imports a Capacitor package, or if the root package.json or lockfile lists one. No folder is exempt.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = process.cwd()
// Built from parts so this file does not match its own search.
const SCOPE = '@' + 'capacitor/'
const CODE = /\.(?:[cm]?[jt]sx?|mts|cts|vue|svelte|html)$/
const IMPORT = new RegExp(String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"\x60]` + SCOPE.replace('/', '\\/'))

/** The paths whose text imports a Capacitor package. Pure over (path, text) pairs, so the test can feed it fixtures. */
export function capacitorImports(files: { path: string; text: string }[]): string[] {
  return files.filter((f) => CODE.test(f.path) && IMPORT.test(f.text)).map((f) => f.path)
}

/** Every Capacitor package a package.json names, in any dependency field. */
export function capacitorDeps(pkg: Record<string, unknown>): string[] {
  const fields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies']
  return fields.flatMap((k) => Object.keys((pkg[k] as Record<string, string> | undefined) ?? {})).filter((n) => n.startsWith(SCOPE))
}

const repoFiles = (): string[] => execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)

test('the detector finds each import form, in any folder, and ignores mentions', () => {
  const imp = (s: string): string => s.replace('CAP', SCOPE + 'app')
  const found = capacitorImports([
    { path: 'src/a.ts', text: imp("import { App } from 'CAP'") },
    { path: 'src/b.ts', text: imp("const m = await import('CAP')") },
    { path: 'scripts/c.mjs', text: imp('const m = require("CAP")') },
    { path: 'src/d.ts', text: imp("import 'CAP'") },
    { path: 'native/src/host.ts', text: imp("import { App } from 'CAP'") },
    { path: 'src/e.ts', text: imp('// the shell uses CAP through its host') },
    { path: 'docs/f.md', text: imp("import { App } from 'CAP'") },
  ])
  assert.deepEqual(found, ['src/a.ts', 'src/b.ts', 'scripts/c.mjs', 'src/d.ts', 'native/src/host.ts'])
  assert.deepEqual(capacitorDeps({ dependencies: { three: '1', [SCOPE + 'core']: '8' }, devDependencies: { [SCOPE + 'cli']: '8' } }), [SCOPE + 'core', SCOPE + 'cli'])
})

test('no file in the web repository imports a Capacitor package', () => {
  const files = repoFiles().filter((p) => CODE.test(p) && existsSync(join(root, p)))
  assert.ok(files.length > 100, 'the repository files were listed')
  const bad = capacitorImports(files.map((p) => ({ path: p, text: readFileSync(join(root, p), 'utf8') })))
  assert.deepEqual(bad, [], `Capacitor belongs to the native shell (skylumi-labs/3d-moon-native); the web app reaches it only through src/native/host.ts:\n  ${bad.join('\n  ')}`)
})

test('the root package.json and its lockfile list no Capacitor package', () => {
  assert.deepEqual(capacitorDeps(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))), [], 'it belongs in skylumi-labs/3d-moon-native')
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as { packages: Record<string, Record<string, unknown>> }
  const locked = Object.keys(lock.packages).filter((k) => k.includes(`node_modules/${SCOPE}`))
  assert.deepEqual(locked, [], 'regenerate the root lockfile (npm install) after moving the dependency')
  assert.deepEqual(capacitorDeps(lock.packages[''] ?? {}), [])
})

test('the web app reaches the shell only through the injected host module', () => {
  // host.ts imports the virtual id only in a native build; the web's default for it (and its types) is nativeHostDefault.ts.
  const host = readFileSync(join(root, 'src/native/host.ts'), 'utf8')
  assert.match(host, /if \(import\.meta\.env\?\.VITE_NATIVE_BUILD === 'true'\) \{\s*const \{ createNativeHost \} = await import\('virtual:moon-native-host'\)/)
  const ts = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'))
  assert.deepEqual(ts.compilerOptions.paths['virtual:moon-native-host'], ['./src/native/nativeHostDefault.ts'])
  const cfg = readFileSync(join(root, 'vite.config.ts'), 'utf8')
  assert.doesNotMatch(cfg, /NATIVE|from '\.\/(?:src\/)?native/, 'the web config carries no native branch')
  assert.match(cfg, /source === 'virtual:moon-native-host' \? file : null/, 'the web config resolves the id to its default (dev server)')
  assert.match(cfg, /path\.resolve\('src\/native\/nativeHostDefault\.ts'\)/)
})
