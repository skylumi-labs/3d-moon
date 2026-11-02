/**
 * What the Share button writes and what a link's start reads back, as pure functions (the round trip is tested: scripts/share-view.test.mts).
 *
 * A link carries the view as seen: the time, the pose (to a metre, because the landing-site close-ups are a few hundred metres up),
 * the lens, which way the camera is turned (the Earth, the Sun, or a free turn) and, at a landing site, `pin=<site id>` so the start
 * loads that site's pictures before it places the camera, and `g=` for the Apollo 17 ground view. Nothing here names an archive
 * moment: a link never brings the tour card or the chip row.
 */
export interface SharePose { lon: number; lat: number; dist: number; roll: number; pitch: number }
/** The ground camera as the visitor left it (frame metres, degrees, the lens as a tangent), and whether it walks. */
export interface GroundShare { e: number; n: number; z: number; heading: number; pitch: number; roll: number; tanHalf: number; walk: boolean }
export type ShareLook = { kind: 'earth'; w: number } | { kind: 'sun' }

export interface ShareState {
  /** The page was opened with ?auto=0 (no idle orbit): kept. */
  autoOff: boolean
  live: boolean
  time: Date
  /** The layout frames the subject clear of the bar and the caption (the aim shift follows the device). */
  layoutAim: boolean
  pose: SharePose
  fovDeg: number
  defaultFovDeg: number
  /** Whether the pose's pitch is felt at this distance (reliefShare > 0). */
  pitchFelt: boolean
  look: ShareLook | null
  /** A free orientation (x, y, z, w) a mid-flight grab left. */
  free: [number, number, number, number] | null
  /** The patch site to load before placing the camera ('a11', 'a17'), or null for a pose that reopens on its own. */
  pin: string | null
  /** The ground view, when ground mode has the camera. */
  ground: GroundShare | null
  /** The ground viewpoint on screen ('hover' or 'eye'), or null once the visitor has moved off both. */
  viewpoint: 'hover' | 'eye' | null
}

const f = (v: number, d: number): string => String(Number(v.toFixed(d)))

/** The query parameters of a link to this view (insertion order is the URL's order). */
export function shareParams(s: ShareState): Array<[string, string]> {
  const out: Array<[string, string]> = []
  if (s.autoOff) out.push(['auto', '0'])
  if (!s.live) out.push(['t', s.time.toISOString().slice(0, 19) + 'Z'])
  if (s.pin) out.push(['pin', s.pin])
  if (s.ground) {
    const g = s.ground
    out.push(['g', [f(g.e, 3), f(g.n, 3), f(g.z, 3), f(g.heading, 3), f(g.pitch, 3), f(g.roll, 3), f(g.tanHalf, 5), g.walk ? 1 : 0].join(',')])
    if (s.viewpoint) out.push(['vp', s.viewpoint])
    return out
  }
  out.push(['view', 'fly'])
  if (Math.abs(s.fovDeg - s.defaultFovDeg) > 0.05) out.push(['fov', f(s.fovDeg, 2)])
  out.push(['lon', f(s.pose.lon, 5)], ['lat', f(s.pose.lat, 5)], ['dist', f(s.pose.dist, 6)])
  // Always, 0 too: the page opens on Home's pose (its roll is not 0) and a link's missing roll kept it, so a levelled view reopened turned
  // by Home's roll (rig 2026-10-29, orbit-spin d-fly-share: 17.4 deg).
  out.push(['roll', f(s.pose.roll || 0, 2)])
  if (s.pose.pitch && s.pitchFelt) out.push(['pitch', f(s.pose.pitch, 2)])
  if (s.look) out.push(['look', s.look.kind === 'sun' ? 'sun' : s.look.w >= 0.999 ? 'earth' : f(s.look.w, 3)])
  else if (s.free && Math.abs(s.free[3]) < 0.999999) out.push(['off', s.free.map((x) => f(x, 6)).join(',')])
  if (s.layoutAim) out.push(['aim', '1'])
  return out
}

/** What a link's start puts back, besides the plain fly pose the page already reads. */
export interface ShareStart {
  pin: string | null
  ground: GroundShare | null
  viewpoint: 'hover' | 'eye' | null
  look: ShareLook | null
  free: [number, number, number, number] | null
  aim: boolean
  /** The fly pose and lens the link names (missing fields absent). */
  pose: Partial<SharePose>
  fovDeg: number | null
}

const nums = (s: string | null, n: number): number[] | null => {
  if (!s) return null
  const a = s.split(',').map(Number)
  return a.length >= n && a.every(Number.isFinite) ? a : null
}

export function readShare(get: (k: string) => string | null): ShareStart {
  const g = nums(get('g'), 7)
  const lookRaw = get('look')
  let look: ShareLook | null = null
  if (lookRaw === 'sun') look = { kind: 'sun' }
  else if (lookRaw === 'earth') look = { kind: 'earth', w: 1 }
  else if (lookRaw && Number.isFinite(Number(lookRaw)) && Number(lookRaw) > 0 && Number(lookRaw) < 1) look = { kind: 'earth', w: Number(lookRaw) }
  const off = nums(get('off'), 4)
  const vp = get('vp')
  const pin = get('pin')
  const one = (k: string): number | undefined => { const v = get(k); return v === null || v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v) }
  const pose: Partial<SharePose> = {}
  for (const k of ['lon', 'lat', 'dist', 'roll', 'pitch'] as const) { const v = one(k); if (v !== undefined) pose[k] = v }
  return {
    pose, fovDeg: one('fov') ?? null,
    pin: pin && /^[a-z0-9]{1,16}$/.test(pin) ? pin : null,
    ground: g && g[6] > 0 ? { e: g[0], n: g[1], z: g[2], heading: g[3], pitch: g[4], roll: g[5], tanHalf: g[6], walk: g[7] === 1 } : null,
    viewpoint: vp === 'hover' || vp === 'eye' ? vp : null,
    look,
    free: off ? [off[0], off[1], off[2], off[3]] : null,
    aim: get('aim') === '1',
  }
}

/** Below the camera floor a link can place without the site's pictures, a fly pose reopens at the floor and not at the site. */
export interface SiteShareState {
  /** The loaded site patch ('a11', 'a17') and whether it is drawn. */
  patchSite: string | null
  patchReady: boolean
  /** The ground view (Apollo 17) is on the camera: it needs the patch whatever the distance. */
  ground: boolean
  /** The camera is over the site (within the arc the patch is prewarmed for): a pose elsewhere reopens on the tiles alone. */
  near: boolean
  /** The camera's distance now and the floor a fresh page applies before any patch has loaded (Moon radii). */
  dist: number
  floor: number
}

/**
 * The site a link must load before it places the camera, or null when the pose reopens faithfully on its own.
 * Apollo 11's pin sits at 0.9994 radii; a fly link with that distance reopened at the floor (1.057, 100 km up) and showed another place.
 */
export function sitePin(s: SiteShareState): string | null {
  if (!s.patchSite || !s.patchReady) return null
  return s.ground || (s.near && s.dist < s.floor) ? s.patchSite : null
}
