/**
 * The Apollo 17 powered descent as a function of time (G2b): `DescentPath.sample(t)` reads
 * data/apollo17/descent-track.json (built by cloud/g2a) and gives the lunar module's state at `t`
 * seconds after descent-engine ignition (110:09:53 on the Mission Report clock, 1972-12-11T19:42:53Z; contact is t = 725).
 *
 * Interpolation never overshoots: powered rows (1 s) use cubic Hermite in position with the row velocity as slope, the slopes
 * clamped by the Fritsch-Carlson limit; every scalar column uses PCHIP; the attitude is a spherical interpolation. Before
 * ignition the coarse orbit rows (60 s) use plain Hermite from position and velocity (a conic, no limiter: it must follow the curve).
 *
 * Provenance travels with the numbers: `prov` says whether each group is a verified table value (V), a second-hand read (R),
 * interpolated between those (I) or modelled (E), and `unc` carries the band the track builder computed. Horizontal speed and
 * downrange are modelled in every row (E): no source read has them.
 */
import { Quaternion } from 'three'

export type Engine = 'coast' | 'ullage' | 'minimum' | 'full' | 'throttled' | 'off'
export type ProvCode = 'V' | 'R' | 'I' | 'E'
export type ProvGroup = 'alt' | 'vv' | 'vh' | 'pos' | 'att' | 'thr' | 'dust'

export interface DescentSample {
  /** Seconds since ignition; contact is 725. */
  t: number
  /** Epoch milliseconds (UTC) of the real 1972 moment. */
  utcMs: number
  /** Site ENU metres at the lunar module's rest position; ground-fixed; u is the height above the tangent plane (curvature included). */
  pos: [number, number, number]
  /** Height of the probe tips above the ground as the crew called it (0 at contact light). */
  altAgl: number
  /** Height of the pad plane above the ground (altAgl + 1.52 m until engine stop, then a free fall to 0). */
  padAlt: number
  /** Ground-relative velocity, ENU, m/s. */
  vel: [number, number, number]
  /** Body (X forward through the windows, Y left, Z up along the thrust axis) to ENU, w x y z. */
  quat: [number, number, number, number]
  psiDeg: number
  yawLeftDeg: number
  engine: Engine
  thrustN: number
  throttleOfFtp: number
  massKg: number
  /** 0 to 1 rendering scale for the dust (modelled, not a density). */
  dust: number
  /** False before ignition: the attitude is held at the ignition attitude, not read from any source. */
  attitudeKnown: boolean
  unc: { alt: number; vH: number; posE: number; posN: number; attDeg: number }
  prov: Record<ProvGroup, ProvCode>
}

/** The parts of the track file the sampler reads. */
export interface TrackDoc {
  clock: { contact_t_s: number; engine_stop_t_s: number; pads_down_t_s_est: number }
  powered: {
    t_s: number[]; utc: string[]
    alt_m: number[]; pad_alt_m: number[]; E_m: number[]; N_m: number[]; U_m: number[]
    vE_ms: number[]; vN_ms: number[]; vU_ms: number[]
    psi_deg: number[]; yaw_left_deg: number[]; quat_wxyz: number[][]
    thrust_N: number[]; throttle_of_ftp: number[]; mass_kg: number[]; engine: string[]; dust_index: number[]
    prov: Record<ProvGroup, string[]>
    unc: { alt_m: number[]; v_horizontal_ms: number[]; pos_E_m: number[]; pos_N_m: number[]; att_deg: number[] }
  }
  orbit_segments: Array<{ name: string; t_start: number; t_end: number; dt_s: number; rows: number[][] }>
  events: Array<{ t_s: number; event: string; prov: string; clk_alsj: string }>
  sun: { at_contact: { sun_el_deg: number; sun_az_deg: number; utc: string } }
}

export interface ProvBand { group: ProvGroup | 'orbit'; t0: number; t1: number; code: ProvCode }

/** The hand-over altitude from the orbital rig: the descent orbit crosses 20 km (above the site radius) here. */
export const HANDOVER_T = -990
export const IGNITION_UTC_MS = Date.parse('1972-12-11T19:42:53Z')

const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x))

/** Fritsch-Carlson limit on the two end slopes of a cubic over an interval of width h (y in, slopes per second). */
function limit(y0: number, y1: number, m0: number, m1: number, h: number): [number, number] {
  const d = (y1 - y0) / h
  if (d === 0) return [0, 0]
  let a = m0 / d, b = m1 / d
  if (a < 0) a = 0
  if (b < 0) b = 0
  const r = Math.hypot(a, b)
  if (r > 3) { a = a * 3 / r; b = b * 3 / r }
  return [a * d, b * d]
}
function hermite(y0: number, y1: number, m0: number, m1: number, h: number, s: number): number {
  const u = s / h, u2 = u * u, u3 = u2 * u
  return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * h * m1
}
/** PCHIP slopes (Fritsch-Carlson, uniform spacing) of a column. */
function pchipSlopes(y: number[], dt: number): number[] {
  const n = y.length, m = new Array<number>(n).fill(0)
  if (n < 2) return m
  const d = new Array<number>(n - 1)
  for (let i = 0; i < n - 1; i++) d[i] = (y[i + 1] - y[i]) / dt
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : 2 * d[i - 1] * d[i] / (d[i - 1] + d[i])
  m[0] = d[0]; m[n - 1] = d[n - 2]
  return m
}

class Column {
  private readonly m: number[]
  constructor(readonly y: number[], dt = 1) { this.m = pchipSlopes(y, dt) }
  at(i: number, s: number): number {
    const j = Math.min(i, this.y.length - 2)
    return hermite(this.y[j], this.y[j + 1], this.m[j], this.m[j + 1], 1, s)
  }
}

function slerp(a: number[], b: number[], k: number): [number, number, number, number] {
  const qa = new Quaternion(a[1], a[2], a[3], a[0]).normalize(), qb = new Quaternion(b[1], b[2], b[3], b[0]).normalize()
  qa.slerp(qb, k)
  return [qa.w, qa.x, qa.y, qa.z]
}

interface Knot { t: number; p: [number, number, number]; v: [number, number, number]; alt: number }

export class DescentPath {
  readonly tMin: number
  readonly tMax: number
  readonly contactT: number
  readonly engineStopT: number
  readonly padsDownT: number
  readonly events: TrackDoc['events']
  /** The Sun at contact from the app's ephemeris (the file's sun block), for the captions. */
  readonly sunAtContact: TrackDoc['sun']['at_contact']
  private readonly p: TrackDoc['powered']
  private readonly knots: Knot[]
  private readonly cols: Record<'alt' | 'pad' | 'dust' | 'thrust' | 'thr' | 'mass' | 'psi' | 'yaw' | 'unAlt' | 'unVH' | 'unE' | 'unN' | 'unAtt', Column>
  private readonly slopes: { E: number[]; N: number[]; U: number[] }
  private readonly utc0: number

  private constructor(doc: TrackDoc) {
    const p = doc.powered
    this.p = p
    this.contactT = doc.clock.contact_t_s
    this.engineStopT = doc.clock.engine_stop_t_s
    this.padsDownT = doc.clock.pads_down_t_s_est
    this.events = doc.events
    this.sunAtContact = doc.sun.at_contact
    this.utc0 = Date.parse(p.utc[0]) - p.t_s[0] * 1000
    const knots: Knot[] = []
    for (const seg of doc.orbit_segments) for (const r of seg.rows) knots.push({ t: r[0], p: [r[1], r[2], r[3]], v: [r[4], r[5], r[6]], alt: r[7] })
    knots.sort((a, b) => a.t - b.t)
    // The 1 s rows take over at t = 0.
    knots.push({ t: 0, p: [p.E_m[0], p.N_m[0], p.U_m[0]], v: [p.vE_ms[0], p.vN_ms[0], p.vU_ms[0]], alt: p.alt_m[0] })
    for (let i = 1; i < knots.length; i++) if (!(knots[i].t > knots[i - 1].t)) throw new Error('orbit rows are not increasing in time')
    this.knots = knots
    this.tMin = knots[0].t
    this.tMax = p.t_s[p.t_s.length - 1]
    this.cols = {
      alt: new Column(p.alt_m), pad: new Column(p.pad_alt_m), dust: new Column(p.dust_index), thrust: new Column(p.thrust_N), thr: new Column(p.throttle_of_ftp), mass: new Column(p.mass_kg),
      psi: new Column(p.psi_deg), yaw: new Column(p.yaw_left_deg),
      unAlt: new Column(p.unc.alt_m), unVH: new Column(p.unc.v_horizontal_ms), unE: new Column(p.unc.pos_E_m), unN: new Column(p.unc.pos_N_m), unAtt: new Column(p.unc.att_deg),
    }
    // Limited slopes for the powered position: velocity, clamped so no interval overshoots its two end values.
    const lim = (y: number[], v: number[]): number[] => {
      const m = v.slice()
      const cap = (cur: number, l: number): number => (Math.abs(l) < Math.abs(cur) ? l : cur)
      for (let i = 0; i < y.length - 1; i++) { const [a, b] = limit(y[i], y[i + 1], v[i], v[i + 1], 1); m[i] = cap(m[i], a); m[i + 1] = cap(m[i + 1], b) }
      return m
    }
    this.slopes = { E: lim(p.E_m, p.vE_ms), N: lim(p.N_m, p.vN_ms), U: lim(p.U_m, p.vU_ms) }
  }

  static fromDoc(doc: TrackDoc): DescentPath { return new DescentPath(doc) }

  /** Loads the track file as its own chunk (212 kB) and builds the path. */
  static async load(): Promise<DescentPath> {
    const mod = await import('../../data/apollo17/descent-track.json')
    return new DescentPath((mod.default ?? mod) as unknown as TrackDoc)
  }

  utcMsAt(t: number): number { return this.utc0 + t * 1000 }

  private code(group: ProvGroup, i: number): ProvCode { return (this.p.prov[group][clamp(i, 0, this.p.t_s.length - 1)] as ProvCode) }

  sample(tIn: number): DescentSample {
    const t = clamp(tIn, this.tMin, this.tMax)
    const p = this.p
    const utcMs = this.utcMsAt(t)
    if (t < 0) return this.sampleOrbit(t, utcMs)
    const i = Math.min(Math.floor(t), p.t_s.length - 2), s = t - i
    const pos: [number, number, number] = [
      hermite(p.E_m[i], p.E_m[i + 1], this.slopes.E[i], this.slopes.E[i + 1], 1, s),
      hermite(p.N_m[i], p.N_m[i + 1], this.slopes.N[i], this.slopes.N[i + 1], 1, s),
      hermite(p.U_m[i], p.U_m[i + 1], this.slopes.U[i], this.slopes.U[i + 1], 1, s),
    ]
    const vel: [number, number, number] = [lerp(p.vE_ms[i], p.vE_ms[i + 1], s), lerp(p.vN_ms[i], p.vN_ms[i + 1], s), lerp(p.vU_ms[i], p.vU_ms[i + 1], s)]
    const c = this.cols
    const nearest = Math.round(t)
    const prov = {} as Record<ProvGroup, ProvCode>
    for (const g of ['alt', 'vv', 'vh', 'pos', 'att', 'thr', 'dust'] as ProvGroup[]) prov[g] = this.code(g, nearest)
    return {
      t, utcMs, pos, vel,
      altAgl: Math.max(0, c.alt.at(i, s)), padAlt: Math.max(0, c.pad.at(i, s)),
      quat: slerp(p.quat_wxyz[i], p.quat_wxyz[i + 1], s),
      psiDeg: c.psi.at(i, s), yawLeftDeg: c.yaw.at(i, s),
      engine: p.engine[nearest] as Engine, thrustN: Math.max(0, c.thrust.at(i, s)), throttleOfFtp: Math.max(0, c.thr.at(i, s)), massKg: c.mass.at(i, s),
      dust: clamp(c.dust.at(i, s), 0, 1), attitudeKnown: true,
      unc: { alt: Math.max(0, c.unAlt.at(i, s)), vH: Math.max(0, c.unVH.at(i, s)), posE: Math.max(0, c.unE.at(i, s)), posN: Math.max(0, c.unN.at(i, s)), attDeg: Math.max(0, c.unAtt.at(i, s)) },
      prov,
    }
  }

  private sampleOrbit(t: number, utcMs: number): DescentSample {
    const K = this.knots
    let lo = 0, hi = K.length - 1
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (K[mid].t <= t) lo = mid; else hi = mid }
    const a = K[lo], b = K[hi], h = b.t - a.t, s = t - a.t
    const pos = [0, 1, 2].map((k) => hermite(a.p[k], b.p[k], a.v[k], b.v[k], h, s)) as [number, number, number]
    // Velocity is the derivative of the same cubic (a finite difference over 0.05 s keeps it simple and consistent).
    const e = 0.05
    const at = (tt: number, k: number): number => hermite(a.p[k], b.p[k], a.v[k], b.v[k], h, tt - a.t)
    const vel = [0, 1, 2].map((k) => (at(Math.min(b.t, t + e), k) - at(Math.max(a.t, t - e), k)) / (Math.min(b.t, t + e) - Math.max(a.t, t - e))) as [number, number, number]
    const p = this.p
    const ullage = t >= -8
    return {
      t, utcMs, pos, vel,
      altAgl: hermite(a.alt, b.alt, (b.alt - a.alt) / h, (b.alt - a.alt) / h, h, s), padAlt: hermite(a.alt, b.alt, (b.alt - a.alt) / h, (b.alt - a.alt) / h, h, s),
      quat: slerp(p.quat_wxyz[0], p.quat_wxyz[0], 0),
      psiDeg: p.psi_deg[0], yawLeftDeg: p.yaw_left_deg[0],
      engine: ullage ? 'ullage' : 'coast', thrustN: 0, throttleOfFtp: 0, massKg: p.mass_kg[0], dust: 0, attitudeKnown: false,
      // Orbit rows carry a 10 km altitude band (LOG: the pre-DOI-2 perilune is 8 km off); attitude before ullage is not a source value.
      unc: { alt: 10000, vH: NaN, posE: p.unc.pos_E_m[0], posN: p.unc.pos_N_m[0], attDeg: NaN },
      prov: { alt: 'E', vv: 'E', vh: 'E', pos: 'E', att: 'E', thr: 'E', dust: 'E' },
    }
  }

  /** Runs of constant provenance per quantity, for the HUD's verified / estimated wording. */
  bands(): ProvBand[] {
    const out: ProvBand[] = [{ group: 'orbit', t0: this.tMin, t1: 0, code: 'E' }]
    for (const g of ['alt', 'vv', 'vh', 'pos', 'att', 'thr', 'dust'] as ProvGroup[]) {
      const arr = this.p.prov[g]
      let s = 0
      for (let i = 1; i <= arr.length; i++) if (i === arr.length || arr[i] !== arr[s]) { out.push({ group: g, t0: this.p.t_s[s], t1: this.p.t_s[i - 1], code: arr[s] as ProvCode }); s = i }
    }
    return out
  }

  /** The dust index for a height above the ground in feet, by the call table the track was built from (0 above 110 ft). */
  static dustAtAltM(altM: number): number {
    const ft = altM / 0.3048
    const tab: Array<[number, number]> = [[110, 0], [80, 0.12], [65, 0.2], [40, 0.3], [35, 0.5], [0, 1]]
    if (ft >= tab[0][0]) return 0
    for (let i = 0; i < tab.length - 1; i++) if (ft <= tab[i][0] && ft >= tab[i + 1][0]) return lerp(tab[i][1], tab[i + 1][1], (tab[i][0] - ft) / (tab[i][0] - tab[i + 1][0]))
    return 1
  }
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k
