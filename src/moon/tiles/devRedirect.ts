/**
 * Dev server only (vite.config.ts): where a request for a file that is not on disk is sent instead of a 404.
 * MOON_REMOTE_BASE=<public base of the hosted set, ending in /moon/> answers every missing file under /moon/tiles, /moon/patch and /moon/mid-patch
 * with a redirect to the hosted copy (the browser loads it; nothing is saved). Without it a dev server with no local .patch directory 404s
 * on patch/<site>/manifest.json and the Apollo sites draw from the global tiles alone. MOON_DEEP_REDIRECT (the older variable, tiles only,
 * levels below 0 only) still works.
 */
export function devRedirect(mount: string, rel: string, env: { MOON_REMOTE_BASE?: string; MOON_DEEP_REDIRECT?: string; MOON_TILES_REMOTE?: string }): string | null {
  if (mount === '/moon/internal') return null // restricted rows are local only, never redirected to a hosted copy
  const remote = env.MOON_REMOTE_BASE
  if (remote) return remote.replace(/\/?$/, '/') + mount.replace(/^\/moon\//, '') + rel
  // MOON_TILES_REMOTE=<tiles base>: every missing tile, the manifest included (the GPU rig has no local .tiles).
  if (env.MOON_TILES_REMOTE && mount === '/moon/tiles') return env.MOON_TILES_REMOTE.replace(/\/?$/, '/') + rel.slice(1)
  const deep = env.MOON_DEEP_REDIRECT
  if (deep && mount === '/moon/tiles' && /^\/[hc]\/-\d/.test(rel)) return deep.replace(/\/?$/, '/') + rel.slice(1)
  return null
}

/** The Terrain Camera build under the hosted set, relative to MOON_REMOTE_BASE (the publish scripts bake the same path). */
export const TC_REMOTE_PATH = 'tc/v3/'

/** Dev server only: the VITE_MOON_TC a dev build gets when none is set, the hosted TC build under MOON_REMOTE_BASE; undefined without one. */
export function devTcBase(env: { MOON_REMOTE_BASE?: string }): string | undefined {
  return env.MOON_REMOTE_BASE ? env.MOON_REMOTE_BASE.replace(/\/?$/, '/') + TC_REMOTE_PATH : undefined
}
