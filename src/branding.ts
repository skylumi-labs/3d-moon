/**
 * Every product name, maker line and brand URL the viewer shows, in one place. A fork rebrands here and nowhere else (TRADEMARKS.md):
 * the page title (index.html, through vite.config.ts), the brand line under the controls and the About text (hud.ts), and the
 * "processed by" lines in the credits (ui/credits.ts). The names are trademarks of their owner; the code around them is not.
 *
 * Plain constants with no imports, so vite.config.ts can read them at build time and scripts/branding.test.mts in Node.
 */

/** The product name, as it appears in the title and in the credits. */
export const PRODUCT_NAME = 'SkyLumi'

/** The browser tab title. */
export const PAGE_TITLE = `The Moon · ${PRODUCT_NAME}`

/** The public home of this viewer. */
export const SITE_URL = 'https://skylumi.org/3d-moon/'

/** The brand line under the controls: the site address without scheme or trailing slash, followed by "(Credits)". */
export const BRAND_LINE = SITE_URL.replace(/^https:\/\//, '').replace(/\/$/, '')

/** The last line of the About text. */
export const MADE_BY = `Made by ${PRODUCT_NAME}.`

/** Who processed or adapted a source for the viewer (credits: "processed by …", "adapted by …"). */
export const PROCESSED_BY = PRODUCT_NAME

/** The credit for the parts of the picture that are modelled, not measured. */
export const RENDERING_MODEL_CREDIT = `${PRODUCT_NAME} rendering model`
