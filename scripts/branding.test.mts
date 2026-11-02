// src/branding.ts is the one place for the product name, maker line and brand URLs (TRADEMARKS.md): the values, and that the viewer reads them.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { BRAND_LINE, MADE_BY, PAGE_TITLE, PROCESSED_BY, PRODUCT_NAME, RENDERING_MODEL_CREDIT, SITE_URL } from '../src/branding.ts'
import { ABOUT_PARAGRAPHS } from '../src/hud.ts'
import { CREDIT_CATALOG } from '../src/ui/credits.ts'

const root = new URL('..', import.meta.url).pathname
const read = (p: string): string => readFileSync(join(root, p), 'utf8')

// The values the live viewer shows today.
assert.equal(PRODUCT_NAME, 'SkyLumi')
assert.equal(PAGE_TITLE, 'The Moon · SkyLumi')
assert.equal(SITE_URL, 'https://skylumi.org/3d-moon/')
assert.equal(BRAND_LINE, 'skylumi.org/3d-moon')
assert.equal(MADE_BY, 'Made by SkyLumi.')
assert.equal(PROCESSED_BY, 'SkyLumi')
assert.equal(RENDERING_MODEL_CREDIT, 'SkyLumi rendering model')
assert.equal(new URL(SITE_URL).protocol, 'https:')
assert.ok(SITE_URL.endsWith('/'), 'SITE_URL ends in a slash')

// The module stays a leaf of constants, so vite.config.ts and Node can import it without the app.
assert.ok(!/^import /m.test(read('src/branding.ts')), 'src/branding.ts imports nothing')

// The viewer takes the strings from the module.
assert.equal(ABOUT_PARAGRAPHS.at(-1), MADE_BY, 'the About text ends with the maker line')
const credit = (id: string) => CREDIT_CATALOG.find((c) => c.id === id)!
assert.match(credit('jaxa-tc').detail, new RegExp(`processed by ${PROCESSED_BY} `))
assert.match(credit('hyg-stars').detail, new RegExp(`adapted by ${PROCESSED_BY} `))
assert.equal(credit('modelled-light').credit, RENDERING_MODEL_CREDIT)
assert.match(read('src/hud.ts'), /textContent = `\$\{BRAND_LINE\} \(`/, 'the brand line under the controls')
assert.match(read('index.html'), /<title>%MOON_PAGE_TITLE%<\/title>/, 'the page title is filled from PAGE_TITLE at build time')

// No other source file in the web app spells the brand in a string the viewer shows. Comments may name it; src/native/ is the native shell's own.
const BRAND = new RegExp(`${PRODUCT_NAME}|${BRAND_LINE.replace(/[.]/g, '\\.')}`)
function* files(dir: string): Generator<string> {
  for (const n of readdirSync(join(root, dir))) {
    const p = `${dir}/${n}`
    if (statSync(join(root, p)).isDirectory()) { if (p !== 'src/native') yield* files(p) } else if (/\.(ts|css|html)$/.test(n)) yield p
  }
}
const strip = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const offenders = [...files('src'), 'index.html'].filter((p) => p !== 'src/branding.ts' && BRAND.test(strip(read(p))))
assert.deepEqual(offenders, [], 'brand strings live in src/branding.ts')
console.log('branding.test: ok')
