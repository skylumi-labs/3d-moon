// The launch switch for skylumi.org/3d-moon.
//
// Every build is noindex by default: index.html carries <meta name="robots" content="noindex, nofollow" />.
// MOON_INDEXABLE=1 drops that meta and adds robots.txt and sitemap.xml to dist/. Only the site's launch publish sets it;
// the preview publish refuses it, and this plugin refuses any base but /3d-moon/ and the native build, so the preview bucket page
// and the store shell can never be built indexable.
import type { Plugin } from 'vite'
import { SITE_URL } from '../src/branding'

/** The public address (src/branding.ts) is what the canonical link, og:url and the sitemap name. */
export const SITE_BASE = '/3d-moon/'
/** The social card (1280x640), made on the GPU rig and committed under public/ before launch; the launch publish refuses a dist without it. */
export const SOCIAL_IMAGE = 'social/moon-1280x640.jpg'

/** MOON_INDEXABLE: '1' is on, unset or empty is off, anything else is a mistake and throws. */
export function indexableFlag(value: string | undefined): boolean {
  if (value === undefined || value === '') return false
  if (value === '1') return true
  throw new Error(`MOON_INDEXABLE must be 1 or unset, got '${value}'`)
}

const ROBOTS_META = /[ \t]*<meta name="robots" content="noindex[^"]*"\s*\/?>\r?\n?/

/** index.html without its robots noindex meta. Throws when there is none, so a reworded meta cannot pass unnoticed. */
export function dropNoindex(html: string): string {
  if (!ROBOTS_META.test(html)) throw new Error('index.html has no robots noindex meta to drop')
  const out = html.replace(ROBOTS_META, '')
  if (/name="robots"[^>]*noindex/.test(out)) throw new Error('index.html has more than one robots noindex meta')
  return out
}

/**
 * dist/robots.txt (served at skylumi.org/3d-moon/robots.txt). Crawlers read robots.txt only at the host root, which belongs to
 * SkyLumi's Vercel deployment, so this file does nothing by itself: it is the block the root robots.txt must carry.
 */
export function robotsTxt(): string {
  return [
    '# skylumi.org/3d-moon. Crawlers only read robots.txt at the host root: https://skylumi.org/robots.txt must not',
    '# disallow /3d-moon/ and should carry the Sitemap line below.',
    'User-agent: *',
    'Allow: /3d-moon/',
    '',
    `Sitemap: ${SITE_URL}sitemap.xml`,
    '',
  ].join('\n')
}

/** dist/sitemap.xml: the one page. A sitemap under /3d-moon/ may only list URLs under /3d-moon/ (sitemaps.org), which this does. */
export function sitemapXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <url><loc>${SITE_URL}</loc></url>`,
    '</urlset>',
    '',
  ].join('\n')
}

/** The plugins for vite.config.ts: none unless MOON_INDEXABLE=1, then the launch plugin, which refuses a native or non-/3d-moon/ build (VITE_NATIVE_BUILD=true). */
export function launchPlugins(env: Record<string, string | undefined>): Plugin[] {
  if (!indexableFlag(env.MOON_INDEXABLE)) return []
  if (env.VITE_NATIVE_BUILD === 'true') throw new Error('MOON_INDEXABLE=1 is for the skylumi.org build only, not the native shell')
  return [{
    name: 'moon-launch-indexable',
    apply: 'build',
    configResolved(config) {
      if (config.base !== SITE_BASE) throw new Error(`MOON_INDEXABLE=1 needs --base ${SITE_BASE} (skylumi.org); got ${config.base}.`)
    },
    transformIndexHtml: (html) => dropNoindex(html),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt() })
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml() })
    },
  }]
}
