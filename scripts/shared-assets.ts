// The Moon app imports the Moon maps and the star list from shared-assets/ (NASA SVS 4720, public domain; asteroid-stars.json is the star list).
// If one is missing, Vite fails with an unrelated-looking resolve error and every audit scenario after the first dies.
// This names the files instead.
import fs from 'node:fs'
import path from 'node:path'

export const SHARED_ASSETS = ['moon-maps.json', 'moon-color-4k.jpg', 'moon-height-4k.bin.gz', 'asteroid-stars.json']
const REL = 'shared-assets'
/** The repository root: scripts/.. */
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

export function missingSharedAssets(root: string = REPO_ROOT): string[] {
  return SHARED_ASSETS.map((f) => path.join(REL, f)).filter((f) => !fs.existsSync(path.join(root, f)))
}

export function assertSharedAssets(root: string = REPO_ROOT): void {
  const missing = missingSharedAssets(root)
  if (!missing.length) return
  throw new Error(`The Moon app needs these files from ${REL}/ under ${root}:\n  ${missing.join('\n  ')}\nRestore them from git (git checkout -- ${REL}), then retry.`)
}
