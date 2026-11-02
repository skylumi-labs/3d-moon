import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { assertSharedAssets } from './scripts/shared-assets'
import { devRedirect, devTcBase } from './src/moon/tiles/devRedirect'
import { renderIndexHtml } from './src/build/indexHtml'
import { launchPlugins } from './scripts/launch-build'

// The app imports the Moon maps and the star list from the project's shared-assets/: name any missing file now, not as a resolve error later.
assertSharedAssets()

// The native shell (skylumi-labs/3d-moon-native, scripts/build.mts) builds this same config with its overrides on top:
// a relative base, its data hosts, its host module and its stubs. Nothing here knows about it.

/**
 * Every build and the dev server: index.html's placeholders (src/build/indexHtml.ts). The CSP names the telemetry hosts of the build's keys
 * and no others (none without keys); the title comes from src/branding.ts. Runs first, before Vite's own %ENV% replacement.
 */
function indexHtml(env: Record<string, string>): Plugin {
  return { name: 'moon-index-html', transformIndexHtml: { order: 'pre', handler: (html) => renderIndexHtml(html, env) } }
}

/**
 * The web's answer for `virtual:moon-native-host` (src/native/host.ts): the no-op default, so the dev server's dependency scan and
 * a module request resolve it. The build never asks (host.ts imports it only in a native build); the native shell's own resolver
 * runs before this one (`enforce: 'pre'`) and points the id at its host.
 */
function defaultNativeHost(): Plugin {
  const file = path.resolve('src/native/nativeHostDefault.ts')
  return { name: 'moon-default-native-host', resolveId: (source) => (source === 'virtual:moon-native-host' ? file : null) }
}

// Served at skylumi.app/moon (a rewrite in SkyLumi's vercel.json), so every
// asset URL is under /moon/. The Moon maps are shared with the moon-v1
// prototype in shared-assets/ (NASA public domain); the dev server may read
// them because the project root is allowed below.

/**
 * Dev only: serves a built tile set (scripts/build-tiles-m2.mts) at
 * /moon/tiles/ from $MOON_TILES_DIR (default ./.tiles, gitignored). Tiles are
 * never part of the repository or the build; production takes them from the
 * host named by VITE_MOON_TILES (DESIGN-M2.md section 5).
 */
function devTiles(): Plugin {
  const mounts: [string, string][] = [
    ['/moon/tiles', path.resolve(process.env.MOON_TILES_DIR ?? '.tiles')],
    ['/moon/mid-patch', path.resolve(process.env.MOON_MID_PATCH_DIR ?? '.mid-patch')],
    ['/moon/patch', path.resolve(process.env.MOON_PATCH_DIR ?? '.patch')],
    // Restricted-licence coverage rows (coverage-internal.json). Local only, git-ignored; the plugin is apply:'serve', so a build never carries it.
    ['/moon/internal', path.resolve(process.env.MOON_INTERNAL_DIR ?? '.internal')],
  ]
  const types: Record<string, string> = { '.json': 'application/json', '.webp': 'image/webp', '.gz': 'application/octet-stream' }
  return {
    name: 'moon-dev-tiles',
    apply: 'serve',
    configureServer: (server) => mountAll(server.middlewares),
    // `vite preview` of a bundle built with VITE_MOON_TILES=/moon/tiles/ (and the patch variables) serves the same directories.
    configurePreviewServer: (server) => mountAll(server.middlewares),
  }
  function mountAll(middlewares: { use: (route: string, fn: (req: IncomingMessage, res: ServerResponse, next: (e?: unknown) => void) => void) => void }): void {
      for (const [mount, root] of mounts) middlewares.use(mount, (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0])
        const file = path.join(root, rel)
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          // Dev only: deeper-level tiles (h/-3/..., c/-2/...) that are not on disk are loaded by the BROWSER from a public host
          // (MOON_DEEP_REDIRECT=<base url>), or any missing tile or patch file from MOON_REMOTE_BASE (src/moon/tiles/devRedirect.ts); nothing is saved here.
          const to = devRedirect(mount, rel, process.env)
          if (to) {
            res.statusCode = 302
            res.setHeader('Location', to)
            res.end()
            return
          }
          res.statusCode = 404
          res.end('no such tile')
          return
        }
        res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream')
        // A length lets the audit bound a manifest before reading it (a piped stream is chunked and has none).
        res.setHeader('Content-Length', String(fs.statSync(file).size))
        res.setHeader('Cache-Control', 'public, max-age=3600')
        res.setHeader('Access-Control-Allow-Origin', '*')
        fs.createReadStream(file).on('error', next).pipe(res)
      })
  }
}

const buildIdentity = (() => {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim()
    return { commit, dirty: !!status }
  } catch { return { commit: 'unknown', dirty: true } }
})()
export default defineConfig(({ command, mode }) => {
  // MOON_* may also come from a .env file (.env.example lists them); the shell's environment wins. Vite itself reads only VITE_* from it.
  for (const [k, v] of Object.entries(loadEnv(mode, process.cwd(), 'MOON_'))) process.env[k] ??= v
  // Dev server: the Terrain Camera layer from the hosted set when MOON_REMOTE_BASE names one (src/moon/tiles/tcDetail.ts); a build sets VITE_MOON_TC itself.
  if (command === 'serve' && process.env.VITE_MOON_TC === undefined) {
    const tc = devTcBase(process.env)
    if (tc) process.env.VITE_MOON_TC = tc
  }
  const viteEnv = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    define: { __MOON_BUILD__: JSON.stringify(buildIdentity) },
    base: '/moon/',
    // MOON_INDEXABLE=1 (the launch publish only) drops the noindex meta and adds robots.txt and sitemap.xml (scripts/launch-build.ts).
    plugins: [indexHtml(viteEnv), devTiles(), defaultNativeHost(), ...launchPlugins(process.env)],
    server: { fs: { allow: ['.'] } },
    // MOON_SOURCEMAP=hidden (the publish scripts): maps are written for the Sentry upload, carry no sourceMappingURL comment and are deleted before any upload to the bucket.
    build: {
      target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 1500, sourcemap: process.env.MOON_SOURCEMAP === 'hidden' ? 'hidden' : false,
    },
  }
})
