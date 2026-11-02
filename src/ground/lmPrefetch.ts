import type { Moment } from '../moments'

/**
 * Early, low-priority fetch of everything the Apollo 17 arrival waits for besides the photograph: the lunar module's glTF (0.7 MB), the Draco decoder
 * it is compressed with, and the code chunk that parses it. Before this the model started loading only once the Apollo 17 patch was `ready`
 * (main.ts), so the arrival's hold-for-the-module (stepDescent, up to ARRIVAL_WAIT_MS) sat behind the patch download and then behind the module's own
 * download and decode: a first visit paused at the end of the descent. Bytes only: the parse and the shader link stay where they were (GroundMode.loadLm,
 * which links in the background with compileAsync), so no main-thread work is added to the opening. The browser's HTTP cache serves the real load.
 */
export const LM_MODEL_FILE = 'lm/apollo-lunar-module.glb'
export const LM_DRACO_DIR = 'draco/'
/** The decoder files DRACOLoader asks for (wasm path); the .js fallback is not prefetched. */
export const LM_DRACO_FILES = ['draco_wasm_wrapper.js', 'draco_decoder.wasm']

/** Whether selecting this moment is going to need the lunar module: it lands beside it, or it is the Apollo 17 site zoom. */
export function momentNeedsLander(m: Pick<Moment, 'id' | 'groundEnd'>): boolean {
  return !!m.groundEnd || m.id === 'apollo17'
}

export interface LanderPrefetchDeps {
  base: string
  fetchImpl: (url: string, init?: RequestInit & { priority?: 'low' | 'high' | 'auto' }) => Promise<unknown>
  importChunk: () => Promise<unknown>
}

const startedBases = new Set<string>()

/** Starts the fetches once per base (a second call is a no-op). Never rejects. Resolves when all are done. */
export function prefetchLander(deps: LanderPrefetchDeps): Promise<void> {
  if (startedBases.has(deps.base)) return Promise.resolve()
  startedBases.add(deps.base)
  const urls = [`${deps.base}${LM_MODEL_FILE}`, ...LM_DRACO_FILES.map((f) => `${deps.base}${LM_DRACO_DIR}${f}`)]
  const jobs: Promise<unknown>[] = urls.map((u) => Promise.resolve().then(() => deps.fetchImpl(u, { priority: 'low' })).catch(() => undefined))
  jobs.push(Promise.resolve().then(deps.importChunk).catch(() => undefined))
  return Promise.all(jobs).then(() => undefined)
}

/** Forgets what was started (tests). */
export function resetLanderPrefetch(): void { startedBases.clear() }

/**
 * The lunar module parsed and linked ahead of the arrival (R50). The bytes are already fetched by `prefetchLander`; this takes the next two steps in the
 * same prefetch window, one compile-queue slot each: parse the glTF and build the module, then link its programs. `GroundMode.loadLm` takes the result
 * (`takeLanderPreload`) instead of loading again, so the arrival finds a module whose shaders are in the driver. Only the moment-driven prefetch starts it,
 * never the idle one: the module owns a shadow target, and a visitor who never lands should not pay for it.
 * Generic over the module type so the test runs it with fakes.
 */
let preload: Promise<unknown | null> | null = null
let preloadTimer: ReturnType<typeof setTimeout> | null = null
let preloadDispose: ((lm: never) => void) | null = null
/** How long a settled preload waits to be taken before it is freed (the shadow target and textures are GPU memory on a phone). */
export const LANDER_PRELOAD_TTL_MS = 60_000

function clearPreloadTimer(): void { if (preloadTimer !== null) { clearTimeout(preloadTimer); preloadTimer = null } }

/**
 * Starts the preload once. `load` builds the module, `link` compiles its programs (both may fail: the arrival then loads as before). Resolves with the module or null.
 * `dispose` frees a module nobody took: after `ttlMs` once it settled, or at once on `discardLanderPreload` (the moment was cancelled or replaced).
 */
export function startLanderPreload<T>(load: () => Promise<T>, link: (lm: T) => Promise<unknown>, dispose?: (lm: T) => void, ttlMs = LANDER_PRELOAD_TTL_MS): Promise<T | null> {
  if (preload) return preload as Promise<T | null>
  preloadDispose = (dispose as ((lm: never) => void) | undefined) ?? null
  const p: Promise<T | null> = Promise.resolve().then(load).then(async (lm) => {
    try { await link(lm) } catch { /* the first draw links it */ }
    if (preload === p) {
      preloadTimer = setTimeout(() => { if (preload === p) void discardLanderPreload() }, ttlMs)
      ;(preloadTimer as { unref?: () => void }).unref?.()
    }
    return lm
  }).catch(() => null)
  preload = p
  return p
}
/** The preload in flight or done, handed over once; null when none was started (or it was already taken). */
export function takeLanderPreload<T>(): Promise<T | null> | null {
  const p = preload as Promise<T | null> | null
  preload = null
  preloadDispose = null
  clearPreloadTimer()
  return p
}
/** Frees a preload nobody took (a cancelled or replaced moment, or the timeout). A preload still loading is freed when it settles. */
export async function discardLanderPreload(): Promise<void> {
  const p = preload
  const dispose = preloadDispose
  preload = null
  preloadDispose = null
  clearPreloadTimer()
  if (!p || !dispose) return
  const lm = await p
  if (lm) { try { dispose(lm as never) } catch { /* already gone */ } }
}
/** Whether a preload has been started and not yet taken (the rig reads it). */
export function landerPreloadStarted(): boolean { return preload !== null }
export function resetLanderPreload(): void { preload = null; preloadDispose = null; clearPreloadTimer() }

/**
 * Whether the module's materials are the standard PBR program: the phone classes (`ios`, `ipad`, `phone-android`; kept out of the class profile, which the
 * website copy must equal), overridden by `?lmmat=standard|physical`.
 */
export function lmMaterialLite(search: string, cls: string): boolean {
  const v = new URLSearchParams(search).get('lmmat')
  return v === 'standard' ? true : v === 'physical' ? false : cls === 'ios' || cls === 'ipad' || cls === 'phone-android'
}
