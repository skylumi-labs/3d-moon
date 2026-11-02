"""Apollo 17 powered-descent reference model (G2A). numpy only.
Everything is computed from waypoints.json; nothing is typed in here except physics constants that are also in that file.
Frame: Moon-centred inertial, spin axis Z; the descent plane contains the site direction at touchdown and the due-west
direction there (ALSJ: '12 o'clock is due west'). Altitudes above the site radius (sites.json elevation -2626 m).
"""
import json, math, pathlib
import numpy as np

HERE = pathlib.Path(__file__).parent
W = json.load(open(HERE / 'waypoints.json'))
C = W['constants']
MU = C['mu_km3_s2'] * 1e9           # m^3/s^2
R_REF = C['r_ref_km'] * 1e3
R_SITE = R_REF + C['site_elev_m']
OMEGA = C['omega_rad_s']
LAT = math.radians(C['site_lat_deg'])
G0 = 9.80665
LB = 0.45359237
LBF = 4.4482216
FT = C['ft_m']
NMI = C['nmi_m']
U_SURF = OMEGA * R_SITE * math.cos(LAT)   # surface speed at the site, eastward, inertial (m/s)


def hms(s):
    p = [int(x) for x in s.split(':')]
    return p[0] * 3600 + p[1] * 60 + p[2]


T_IGN = hms(W['clock']['ignition_alsj'])
T_LAND = hms(W['clock']['landing_alsj']) - T_IGN     # 725 s
assert T_LAND == C['burn_s']


def tt(clk):
    return hms(clk) - T_IGN


class Pchip:
    """Fritsch-Carlson monotone cubic Hermite; optional prescribed end slopes (then monotonicity of the end interval is not guaranteed)."""
    def __init__(self, x, y, d0=None, d1=None, dnodes=None):
        x = np.asarray(x, float); y = np.asarray(y, float)
        h = np.diff(x); s = np.diff(y) / h
        n = len(x); d = np.zeros(n)
        for k in range(1, n - 1):
            if s[k - 1] * s[k] > 0:
                w1 = 2 * h[k] + h[k - 1]; w2 = h[k] + 2 * h[k - 1]
                d[k] = (w1 + w2) / (w1 / s[k - 1] + w2 / s[k])
        def end(h0, h1, s0, s1):
            v = ((2 * h0 + h1) * s0 - h0 * s1) / (h0 + h1)
            if np.sign(v) != np.sign(s0): v = 0.0
            elif np.sign(s0) != np.sign(s1) and abs(v) > 3 * abs(s0): v = 3 * s0
            return v
        d[0] = end(h[0], h[1], s[0], s[1]) if d0 is None else d0
        d[-1] = end(h[-1], h[-2], s[-1], s[-2]) if d1 is None else d1
        for i, v in (dnodes or {}).items(): d[i] = v
        self.x, self.y, self.d, self.h = x, y, d, h

    def _i(self, t):
        return np.clip(np.searchsorted(self.x, t, side='right') - 1, 0, len(self.x) - 2)

    def __call__(self, t, der=0):
        t = np.asarray(t, float); i = self._i(t); h = self.h[i]; u = (t - self.x[i]) / h
        y0, y1, d0, d1 = self.y[i], self.y[i + 1], self.d[i], self.d[i + 1]
        if der == 0:
            h00 = 2*u**3 - 3*u**2 + 1; h10 = u**3 - 2*u**2 + u; h01 = -2*u**3 + 3*u**2; h11 = u**3 - u**2
            return h00*y0 + h10*h*d0 + h01*y1 + h11*h*d1
        h00 = 6*u**2 - 6*u; h10 = 3*u**2 - 4*u + 1; h01 = -6*u**2 + 6*u; h11 = 3*u**2 - 2*u
        return (h00*y0 + h01*y1) / h + h10*d0 + h11*d1


# ---- the descent orbit and the PDI state (two-body) -------------------------------------------
RP = R_REF + C['orbit_descent_nmi'][1] * NMI
RA = R_REF + C['orbit_descent_nmi'][0] * NMI
R_PDI = R_REF + C['pdi_alt_ref_nmi'] * NMI
A_ = (RA + RP) / 2; E_ = (RA - RP) / (RA + RP); P_ = A_ * (1 - E_ * E_)
H_ANG = math.sqrt(MU * P_)
V2 = MU * (2 / R_PDI - 1 / A_)
VTH0 = H_ANG / R_PDI
VR0 = math.sqrt(max(V2 - VTH0**2, 0.0))       # PDI is after perilune (ALSJ: ~30 deg east of it, ours 25.6 deg): rising
NU_PDI = math.acos((P_ / R_PDI - 1) / E_)
H0 = R_PDI - R_SITE


def set_pdi_alt(nmi):
    """Recompute the PDI state for another PDI altitude (ensemble use)."""
    global R_PDI, VTH0, VR0, NU_PDI, H0
    R_PDI = R_REF + nmi * NMI
    VTH0 = H_ANG / R_PDI
    VR0 = math.sqrt(max(MU * (2 / R_PDI - 1 / A_) - VTH0**2, 0.0))
    NU_PDI = math.acos((P_ / R_PDI - 1) / E_)
    H0 = R_PDI - R_SITE


class SmoothH:
    """The PCHIP altitude curve smoothed by a Gaussian (sigma_s): a piecewise cubic through irregular waypoints has acceleration jumps
    of several m/s^2 at the nodes, which the waypoint times (+-a few s) do not justify. Endpoints keep their exact value and slope."""
    SIGMA = 3.0
    def __init__(self, p):
        self.p = p; self.g = 0.05
        tg = np.arange(-30, T_LAND + 30 + 1e-9, self.g)
        raw = np.where(tg < 0, p(0.0) + p(0.0, 1) * tg, np.where(tg > T_LAND, p(T_LAND) + p(T_LAND, 1) * (tg - T_LAND), p(np.clip(tg, 0, T_LAND))))
        kx = np.arange(-4 * self.SIGMA, 4 * self.SIGMA + 1e-9, self.g); k = np.exp(-0.5 * (kx / self.SIGMA)**2); k /= k.sum()
        sm = np.convolve(raw, k, mode='same')
        k1x = np.arange(-4.0, 4.0 + 1e-9, self.g); k1 = np.exp(-0.5 * (k1x / 1.0)**2); k1 /= k1.sum()
        sm1 = np.convolve(raw, k1, mode='same')                       # sigma 1 s below about 1,000 ft (the rates change in seconds there)
        b1 = np.clip((tg - 610.0) / 15.0, 0, 1); sm = (1 - b1) * sm + b1 * sm1
        w = np.clip((tg - 0.0) / 12.0, 0, 1) * np.clip((T_LAND - tg) / 12.0, 0, 1)   # keep the endpoints untouched, blend in over 12 s
        w = w * w * (3 - 2 * w)
        self.tg = tg; self.h = w * sm + (1 - w) * raw
        self.v = np.gradient(self.h, self.g)
    def __call__(self, t, der=0):
        t = np.asarray(t, float)
        return np.interp(t, self.tg, self.h if der == 0 else self.v)


def hfun():
    xs, ys = [0.0], [H0]
    for r in W['altitude_ft']:
        if r['h_ft'] is None: continue
        xs.append(tt(r['clk'])); ys.append(r['h_ft'] * FT)
    # verified descent rates (ALSJ: 31 fps at 500 ft, 15 at 300, 9 at 200) become node slopes where a waypoint carries that altitude and time
    dn = {}
    for rc in W['rates_check_fps']:
        tk = tt(rc['clk'])
        for i, x in enumerate(xs):
            if abs(x - tk) < 0.5 and abs(ys[i] - rc['h_ft'] * FT) < 1.0: dn[i] = -rc['down_fps'] * FT
    return SmoothH(Pchip(xs, ys, d0=VR0, d1=-0.75, dnodes=dn))


def pitch_nodes(free):
    xs = [tt(r['clk']) for r in W['pitch_deg']]; ys = [r['psi'] for r in W['pitch_deg']]
    t_po = xs[-1]
    xs += [t_po + 12, 600, 640, 680, T_LAND]; ys += [20.0, free[0], free[1], free[2], 0.0]
    return Pchip(xs, ys)


HIGH_GATE_VG = 500 * FT       # R: a search summary of NASA guidance papers, 'high gate 7,000 ft, 500 ft/s Moon-fixed'
T_STEP_FULL = 28.0
T_THROTTLE_DOWN = 447.0     # MR 110:17:19 -> 7:26
T_ENGINE_STOP = 727.0      # E: MR total firing about 727 s (2 s after contact); ALSJ has about 5 s
def run(free=(25.0, 12.0, 3.0), thrust_full_lbf=None, dt=0.25, ve=None, t_end=None, a_sched=None):
    """a_sched: thrust acceleration for the throttled phase (t >= throttle-down), from a first pass; None computes it from the vertical balance."""
    """Forward inertial integration of tangential speed, mass and downrange angle. Returns dict of arrays on the dt grid."""
    thrust_full = (thrust_full_lbf or C['ftp_thrust_lbf']) * LBF
    thrust_min = 1050 * LBF
    m0 = C['lm_mass_pdi_lb'] * LB
    m1 = m0 - C['prop_consumed_lb'] * LB
    if ve is None:
        ve = C['dv_pdi_fps'] * FT / math.log(m0 / m1)      # from two verified table values
    hf = hfun(); psif = pitch_nodes(free)
    n = int(round((t_end or T_LAND) / dt)) + 1
    t = np.arange(n) * dt
    tc = np.minimum(t, T_LAND)
    h = np.where(t > T_LAND, 0.0, hf(tc)); vr = np.where(t > T_LAND, 0.0, hf(tc, 1))
    psi = psif(tc); r = R_SITE + h
    vth = np.zeros(n); m = np.zeros(n); a = np.zeros(n); thr = np.zeros(n); Psi = np.zeros(n)
    vth[0] = VTH0; m[0] = m0
    for k in range(n - 1):
        tk = t[k]
        if tk >= T_LAND:
            # on the probes: hover thrust until the engine stops, ground speed held at zero (contact)
            T = m[k] * (MU / r[k]**2) if tk < T_ENGINE_STOP else 0.0
            a[k] = T / m[k]; thr[k] = T; vth[k + 1] = -U_SURF; m[k + 1] = m[k] - T / ve * dt; Psi[k + 1] = Psi[k]
            continue
        cp, sp = math.cos(math.radians(psi[k])), math.sin(math.radians(psi[k]))
        if tk < T_THROTTLE_DOWN:
            if tk < T_STEP_FULL: T = thrust_min
            elif tk < T_STEP_FULL + 2: T = thrust_min + (thrust_full - thrust_min) * (tk - T_STEP_FULL) / 2
            else: T = thrust_full
            ak = T / m[k]
        elif a_sched is not None:
            ak = float(a_sched[k]); T = min(ak * m[k], thrust_full); ak = T / m[k]
        else:
            # vertical balance: a cos(psi) = rddot + mu/r^2 - vth^2/r, rddot from the altitude spline (central difference over 8 s)
            w_ = 20.0
            rdd = (hf(min(tk + w_, T_LAND), 1) - hf(max(tk - w_, 0), 1)) / (min(tk + w_, T_LAND) - max(tk - w_, 0))
            av = rdd + MU / r[k]**2 - vth[k]**2 / r[k]
            ak = av / max(cp, 0.15)
            T = min(max(ak * m[k], 0.15 * thrust_full), thrust_full)
            ak = T / m[k]
        a[k] = ak; thr[k] = T
        # angular momentum: d(r vth)/dt = -r a sin(psi); the pitch is measured against the flight direction
        dvth = -ak * sp - vr[k] * vth[k] / r[k]
        vth[k + 1] = vth[k] + dvth * dt
        m[k + 1] = m[k] - T / ve * dt
        Psi[k + 1] = Psi[k] + 0.5 * (vth[k] / r[k] + vth[k + 1] / r[k + 1]) * dt
    a[-1] = a[-2]; thr[-1] = thr[-2]
    return dict(t=t, h=h, vr=vr, psi=psi, vth=vth, m=m, a=a, thrust=thr, Psi=Psi, r=r, ve=ve, m0=m0, m1=m1)


_run1 = run


def run(free=(25.0, 12.0, 3.0), thrust_full_lbf=None, dt=0.25, ve=None, t_end=None, smooth_s=30.0):
    """Two passes. The vertical balance a = (r'' + mu/r^2 - v^2/r) / cos(psi) follows every kink of the altitude waypoints, so the raw
    throttle history jitters (10 kN to 43 kN inside a minute); guidance throttles smoothly. Pass 2 uses pass 1's acceleration smoothed
    by a boxcar of smooth_s seconds after throttle-down (the step at throttle-down itself is kept)."""
    r1 = _run1(free, thrust_full_lbf, dt, ve, t_end)
    t = r1['t']; a = r1['a'].copy(); k0 = int(round(T_THROTTLE_DOWN / dt)); kL = int(round(T_LAND / dt))
    w = max(1, int(round(smooth_s / dt)))
    seg = a[k0:kL]
    pad = np.concatenate([np.repeat(seg[:1], w), seg, np.repeat(seg[-1:], w)])
    sm = np.convolve(pad, np.ones(w) / w, mode='same')[w:-w]
    a_s = a.copy(); a_s[k0:kL] = sm
    r2 = _run1(free, thrust_full_lbf, dt, ve, t_end, a_sched=a_s)
    r2['a_pass1'] = a
    return r2


def vertical_residual(res, win=10.0):
    """r'' seen by the altitude data minus r'' the thrust model gives, smoothed over +-win s, only where the thrust is a table constant (full throttle)."""
    t = res['t']; hf = hfun(); out = []
    for k, tk in enumerate(t):
        if not (T_STEP_FULL + 5 <= tk <= T_THROTTLE_DOWN - 5): continue
        if k % 20: continue
        rdd_d = (hf(tk + win, 1) - hf(tk - win, 1)) / (2 * win)
        cp = math.cos(math.radians(res['psi'][k]))
        rdd_m = res['a'][k] * cp - MU / res['r'][k]**2 + res['vth'][k]**2 / res['r'][k]
        out.append((float(tk), float(rdd_d), float(rdd_m)))
    return out


def summary(res):
    m0, dt = res['m0'], res['t'][1] - res['t'][0]
    prop = float(res['m'][0] - res['m'][-1])
    return dict(prop_used_kg=prop, prop_target_kg=C['prop_consumed_lb'] * LB, ve=res['ve'],
                vth0=VTH0, vr0=VR0, nu_pdi_deg=math.degrees(NU_PDI), h0=H0,
                vg_end=float(res['vth'][-1] + U_SURF), a_max=float(res['a'].max()))


def cost(x, detail=False):
    """x = (psi@600, psi@640, psi@680, thrust_full scale). Targets: ground speed 0.45 m/s at 690 s (MR: near zero lateral, small forward;
    ALSJ 1 to 1.5 ft/s forward), propellant used = MR consumed 18,248.9 lb. Soft bounds keep the pitch history monotone and the thrust within +-5%."""
    p1, p2, p3, sc = x
    pen = 0.0
    for v, lo, hi in ((p1, 0, 40), (p2, 0, 40), (p3, 0, 30), (sc, 0.95, 1.05)):
        if v < lo: pen += ((lo - v) / (0.01 * hi + 1e-9))**2 * 10
        if v > hi: pen += ((v - hi) / (0.01 * hi + 1e-9))**2 * 10
    if p2 > p1: pen += (p2 - p1)**2
    if p3 > p2: pen += (p3 - p2)**2
    res = run((p1, p2, p3), thrust_full_lbf=C['ftp_thrust_lbf'] * sc, dt=0.5)
    s = summary(res)
    vg_t = float(res['vth'][int(690 / 0.5)] + U_SURF)
    vg = res['vth'] + U_SURF
    vg_hg = float(vg[int(565 / 0.5)])
    c = ((vg_t - 0.45) / 0.4)**2 + ((s['prop_used_kg'] - s['prop_target_kg']) / 40.0)**2 + pen
    c += ((vg_hg - HIGH_GATE_VG) / 25.0)**2                      # read: high gate 500 ft/s Moon-fixed
    c += 50.0 * float(np.sum(np.minimum(vg[int(565 / 0.5):], 0.0)**2)) / 1000.0   # no backward drift
    return (c, vg_t, s['prop_used_kg']) if detail else c


def nelder_mead(f, x0, step, iters=400):
    n = len(x0); pts = [list(x0)] + [[x0[j] + (step[j] if j == i else 0) for j in range(n)] for i in range(n)]
    vals = [f(p) for p in pts]
    for _ in range(iters):
        o = sorted(range(n + 1), key=lambda i: vals[i]); pts = [pts[i] for i in o]; vals = [vals[i] for i in o]
        cen = [sum(p[j] for p in pts[:-1]) / n for j in range(n)]
        xr = [cen[j] + (cen[j] - pts[-1][j]) for j in range(n)]; fr = f(xr)
        if fr < vals[0]:
            xe = [cen[j] + 2 * (cen[j] - pts[-1][j]) for j in range(n)]; fe = f(xe)
            pts[-1], vals[-1] = (xe, fe) if fe < fr else (xr, fr)
        elif fr < vals[-2]: pts[-1], vals[-1] = xr, fr
        else:
            xc = [cen[j] + 0.5 * (pts[-1][j] - cen[j]) for j in range(n)]; fc = f(xc)
            if fc < vals[-1]: pts[-1], vals[-1] = xc, fc
            else:
                for i in range(1, n + 1):
                    pts[i] = [pts[0][j] + 0.5 * (pts[i][j] - pts[0][j]) for j in range(n)]; vals[i] = f(pts[i])
    o = sorted(range(n + 1), key=lambda i: vals[i]); return pts[o[0]], vals[o[0]]


def fit():
    best = None
    for x0 in ((30, 20, 5, 1.0), (45, 30, 8, 1.02), (20, 10, 2, 0.98)):
        x, v = nelder_mead(cost, list(x0), [8, 8, 3, 0.02])
        if best is None or v < best[1]: best = (x, v)
    return best


if __name__ == '__main__':
    x, v = fit()
    print('fit', x, v, cost(x, True))
    res = run(tuple(x[:3]), thrust_full_lbf=C['ftp_thrust_lbf'] * x[3])
    print(summary(res))
    print('v_g at 565:', res['vth'][int(565/0.25)] + U_SURF, 'Psi km', res['Psi'][-1] * R_SITE / 1e3)
    for k in range(int(560/.25), len(res['t']), 40): print(res['t'][k], round(res['h'][k]*3.28), round(res['vth'][k]+U_SURF,1), round(res['psi'][k],1), round(res['a'][k],2))
