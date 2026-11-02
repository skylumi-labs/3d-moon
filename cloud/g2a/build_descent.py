#!/usr/bin/env python3
"""Builds ../../data/apollo17/descent-track.json from waypoints.json with descent_model.py.
  python3 build_descent.py            # write the JSON
  python3 build_descent.py --check    # rebuild in memory and compare with the committed JSON (exit 1 on difference)
"""
import json, math, sys, pathlib, time
import numpy as np
import descent_model as M
from descent_model import W, C, R_SITE, R_REF, OMEGA, MU, FT, NMI, T_LAND, T_IGN, tt, hms

OUT = M.HERE.parent.parent / 'data' / 'apollo17' / 'descent-track.json'
PROBE_M = 60 * 0.0254          # Apollo 16/17 contact probes: 60 in (R: web search summary of collectSPACE/Wikipedia, not read at source)
G_MOON = MU / R_SITE**2
T_ENGINE_STOP = 727.0          # E: MR total firing 727 s; ALSJ ~730
T_PAD_DOWN = T_ENGINE_STOP + math.sqrt(2 * PROBE_M / G_MOON)
DT_FINE = 0.25
T_END = 732.0
FTP_N = C['ftp_thrust_lbf'] * M.LBF
TARGET_EN = (230.0, 60.0)      # target relative to the LM (E, N), brief/ALSJ; direction wording conflicts, see notes


def divmod_hms(s):
    return (s // 3600, (s % 3600) // 60, s % 60)


def smooth(u):
    u = min(max(u, 0.0), 1.0); return u * u * (3 - 2 * u)


def variants():
    """Ensemble around the base fit: each entry perturbs one assumption and REFITS the approach pitch, so touchdown still closes."""
    return [
        ('base', {}),
        ('high gate speed 127 m/s', {'hg': 127.0}),
        ('high gate speed 177 m/s', {'hg': 177.0}),
        ('end speed 0 m/s', {'vend': 0.0}),
        ('end speed 1.5 m/s', {'vend': 1.5}),
        ('pitch waypoints +2 deg', {'dpsi': 2.0}),
        ('pitch waypoints -2 deg', {'dpsi': -2.0}),
        ('full thrust -3 pct', {'sc_fix': 0.97 * 0.98}),
        ('full thrust +3 pct', {'sc_fix': 1.03 * 0.98}),
        ('exhaust speed -1 pct', {'ve_scale': 0.99}),
        ('exhaust speed +1 pct', {'ve_scale': 1.01}),
        ('PDI altitude 8.2 nmi', {'pdi_alt': 8.2}),
        ('PDI altitude 9.2 nmi', {'pdi_alt': 9.2}),
    ]


def solve(kw, x0=None):
    """Fit the approach pitch (psi at 600, 640, 680 s) and the full-throttle thrust scale to: propellant = MR consumed, ground speed 0.45 m/s at 690 s,
    the read high-gate speed and the two read distances. kw perturbs one assumption: hg (high-gate speed), vend, dpsi (pitch waypoints),
    sc_fix (thrust scale held), ve_scale (exhaust speed), pdi_alt (nmi)."""
    saved_hg = M.HIGH_GATE_VG
    if 'hg' in kw: M.HIGH_GATE_VG = kw['hg'] * 1.0
    if 'pdi_alt' in kw: M.set_pdi_alt(kw['pdi_alt'])
    dpsi = kw.get('dpsi', 0.0)
    orig_nodes = M.pitch_nodes
    if dpsi:
        def pn(free):
            xs = [tt(r['clk']) for r in W['pitch_deg']]; ys = [r['psi'] + dpsi for r in W['pitch_deg']]
            t_po = xs[-1]; xs += [t_po + 12, 600, 640, 680, T_LAND]; ys += [20.0, free[0], free[1], free[2], 0.0]
            return M.Pchip(xs, ys)
        M.pitch_nodes = pn
    vend = kw.get('vend', 0.45)
    m0 = C['lm_mass_pdi_lb'] * M.LB; m1 = m0 - C['prop_consumed_lb'] * M.LB
    ve0 = C['dv_pdi_fps'] * FT / math.log(m0 / m1) * kw.get('ve_scale', 1.0)
    sc_fix = kw.get('sc_fix')
    def unpack(x): return (x[0], x[1], x[2], sc_fix if sc_fix is not None else x[3])
    def cost(x):
        p1, p2, p3, sc = unpack(x)
        pen = 0.0
        for v, lo, hi in ((p1, 0, 40), (p2, 0, 40), (p3, 0, 30), (sc, 0.95, 1.05)):
            if v < lo: pen += ((lo - v) / (0.01 * hi))**2 * 10
            if v > hi: pen += ((v - hi) / (0.01 * hi))**2 * 10
        if p2 > p1: pen += (p2 - p1)**2
        if p3 > p2: pen += (p3 - p2)**2
        res = M.run((p1, p2, p3), thrust_full_lbf=C['ftp_thrust_lbf'] * sc, dt=0.5, ve=ve0)
        s = M.summary(res); vg = res['vth'] + M.U_SURF
        c = ((vg[int(690 / 0.5)] - vend) / 0.4)**2 + ((s['prop_used_kg'] - s['prop_target_kg']) / 40.0)**2 + pen
        c += ((vg[int(565 / 0.5)] - M.HIGH_GATE_VG) / 25.0)**2
        Ec = geometry(res)['E']
        c += ((Ec[int(tt('112:58:40') / 0.5)] - 8650.0) / 700.0)**2 + ((Ec[int(tt('112:55:59') / 0.5)] - 69300.0) / 6000.0)**2   # R: '5 miles east' and '40 miles east' (ALSJ; statute vs nautical band)
        c += 50.0 * float(np.sum(np.minimum(vg[int(565 / 0.5):], 0.0)**2)) / 1000.0
        return c
    starts = [x0] if x0 else [(30, 20, 5, 1.0), (40, 18, 0, 0.99), (20, 10, 2, 0.98)]
    best = None
    for s0 in starts:
        x, v = M.nelder_mead(cost, list(s0), [8, 8, 3, 0.02], iters=250 if x0 else 400)
        if best is None or v < best[1]: best = (x, v)
    x = unpack(best[0])
    res = M.run(tuple(x[:3]), thrust_full_lbf=C['ftp_thrust_lbf'] * x[3], dt=DT_FINE, ve=ve0)
    res['fit'] = [float(v) for v in x]; res['fit_cost'] = float(best[1])
    M.HIGH_GATE_VG = saved_hg; M.pitch_nodes = orig_nodes
    if 'pdi_alt' in kw: M.set_pdi_alt(C['pdi_alt_ref_nmi'])
    return res


def geometry(res):
    """Inertial 3D placement. Returns E,N,U (m) of the LM from the moving site, per fine step, and the local basis vectors."""
    t = res['t']; r = res['r']
    Psi = res['Psi'] - res['Psi'][-1]                         # 0 at contact; negative before (east of the site)
    lat = math.radians(C['site_lat_deg'])
    n0 = np.array([math.cos(lat), 0, math.sin(lat)])           # site at touchdown: lon 0 in the inertial frame
    east0 = np.array([0, 1.0, 0]); north0 = np.array([-math.sin(lat), 0, math.cos(lat)])
    w0 = -east0
    p = r[:, None] * (np.cos(Psi)[:, None] * n0 + np.sin(Psi)[:, None] * w0)
    tau = -np.sin(Psi)[:, None] * n0 + np.cos(Psi)[:, None] * w0    # direction of motion in the plane (unit)
    ang = OMEGA * (t - T_LAND)
    ca, sa = np.cos(ang), np.sin(ang)
    def rotz(v):
        return np.stack([ca * v[..., 0] - sa * v[..., 1], sa * v[..., 0] + ca * v[..., 1], v[..., 2] * np.ones_like(ca)], -1)
    site = R_SITE * rotz(np.tile(n0, (len(t), 1)))
    e_t = rotz(np.tile(east0, (len(t), 1))); n_t = rotz(np.tile(north0, (len(t), 1))); u_t = rotz(np.tile(n0, (len(t), 1)))
    d = p - site
    E = np.sum(d * e_t, 1); N = np.sum(d * n_t, 1); U = np.sum(d * u_t, 1)
    return dict(E=E, N=N, U=U, p=p, tau=tau, e_t=e_t, n_t=n_t, u_t=u_t, Psi=Psi)


def crossrange(t):
    """N offset (m) of the track from the LM's north line: the aim point is the target 60 m north of the LM until the first
    redesignation (MR: 112:59:26, +11 s = t 573 with the ALSJ clock), then it slides to the LM by 640 s. E: absorbed by the downrange fit
    (the overshoot is inside the integrated speed history). The pre-PDI crossrange is unknown; 0 here with a wide band."""
    t0 = tt('112:59:26'); t1 = 640.0
    return TARGET_EN[1] * (1 - np.array([smooth((x - t0) / (t1 - t0)) for x in np.atleast_1d(t)]))


def attitude(res, geo, dt_grid):
    """Body basis (forward, left, up) in ENU per fine step; thrust axis = up, tilted psi from the vertical against the direction of motion,
    yaw about the thrust axis (left positive), roll about the forward axis (left-side-down positive)."""
    t = res['t']
    ys = [(tt(r['clk']), r['yaw']) for r in W['yaw_left_deg']]
    yawf = M.Pchip([a for a, _ in ys], [b for _, b in ys])
    yaw = yawf(np.clip(t, ys[0][0], ys[-1][0])); yaw = np.where(t < ys[0][0], ys[0][1], yaw)
    psi = res['psi'].copy()
    # after contact: the module hangs on the engine to T_ENGINE_STOP, then settles to the resting attitude (4.5 deg pitch up, 2 deg roll left; MR)
    settle = np.array([smooth((x - T_ENGINE_STOP) / 1.5) for x in t])
    pitch_up = 4.5 * settle; roll = 2.0 * settle
    quat = []; heading = []; nose = []
    for k in range(len(t)):
        up0 = geo['u_t'][k]; east = geo['e_t'][k]; north = geo['n_t'][k]
        # local vertical at the LM (not the site): use the LM position direction
        lm_up = geo['p'][k] / np.linalg.norm(geo['p'][k])
        tau = geo['tau'][k]
        if t[k] > T_LAND:                       # on the surface: heading west, hold the last flight direction
            tau = geo['tau'][int(T_LAND / DT_FINE)]
        ps = math.radians(psi[k]); ey = math.radians(yaw[k])
        u = math.cos(ps) * lm_up - math.sin(ps) * tau
        f0 = math.cos(ps) * tau + math.sin(ps) * lm_up
        f = math.cos(ey) * f0 + math.sin(ey) * np.cross(u, f0)
        l = np.cross(u, f)
        # resting attitude: nose up 4.5 (forward tilts up), left-side-down 2
        if settle[k] > 0:
            pu = math.radians(pitch_up[k]); rl = math.radians(roll[k])
            f = f * math.cos(pu) + lm_up * math.sin(pu); u = np.cross(f, l); u /= np.linalg.norm(u); l = np.cross(u, f)
            l, u = l * math.cos(rl) - u * math.sin(rl), u * math.cos(rl) + l * math.sin(rl)   # left side down: left axis tips down (toward -up)
        # express in the site ENU at time t
        R = np.stack([geo['e_t'][k], geo['n_t'][k], geo['u_t'][k]])   # rows = ENU axes in inertial
        fe, le, ue = R @ f, R @ l, R @ u
        m = np.stack([fe, le, ue], 1)   # columns: forward, left, up in ENU
        quat.append(quat_of(m)); heading.append(math.degrees(math.atan2(fe[0], fe[1])) % 360); nose.append(math.degrees(math.asin(max(-1, min(1, fe[2])))))
    return np.array(quat), np.array(heading), np.array(nose), yaw


def quat_of(m):
    tr = m[0, 0] + m[1, 1] + m[2, 2]
    if tr > 0:
        s = math.sqrt(tr + 1) * 2; q = [0.25 * s, (m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2]) * 2; q = [(m[2, 1] - m[1, 2]) / s, 0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s]
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2]) * 2; q = [(m[0, 2] - m[2, 0]) / s, (m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s]
    else:
        s = math.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1]) * 2; q = [(m[1, 0] - m[0, 1]) / s, (m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s]
    q = np.array(q); q /= np.linalg.norm(q)
    if q[0] < 0: q = -q
    return q


def wp_unc_alt(t):
    """1-sigma-ish band on altitude (m): waypoint altitude band interpolated, plus timing band times descent rate."""
    ws = [(tt(r['clk']), r.get('unc_ft', 0) * FT, r.get('unc_t_s', 2), r['h_ft']) for r in W['altitude_ft'] if r['h_ft'] is not None]
    ts = np.array([w[0] for w in ws]); us = np.array([w[1] for w in ws]); uts = np.array([w[2] for w in ws])
    return np.interp(t, ts, us), np.interp(t, ts, uts)


def prov_alt(t):
    codes = []
    ws = [(tt(r['clk']), r['prov']) for r in W['altitude_ft'] if r['h_ft'] is not None]
    for x in t:
        code = 'I'
        for tw, pv in ws:
            if abs(x - tw) <= 0.6: code = 'V' if pv == 'V' else ('R' if pv in ('R',) else 'E')
        codes.append(code)
    return codes


def prov_att(t):
    ws = [(tt(r['clk']), 'V') for r in W['pitch_deg']]
    t_last = ws[-1][0]
    out = []
    for x in t:
        if x <= t_last: out.append('V' if any(abs(x - a) <= 0.6 for a, _ in ws) else 'I')
        else: out.append('E')
    return out



def freeze_after_contact(geo, kL):
    for key in ('E', 'N', 'U', 'Psi'):
        geo[key][kL + 1:] = geo[key][kL]
    for key in ('p', 'tau', 'e_t', 'n_t', 'u_t'):
        geo[key][kL + 1:] = geo[key][kL]
    return geo


def orbit_segments(res, geo_base):
    """Coarse (60 s) two-body segments before PDI, in the same site ENU frame. State at PDI from the descent orbit elements (MR, verified);
    integrated backwards with RK4. The DOI-2 burn (7 ft/s retrograde, MR) is undone at its time. Plane: contains the site direction at touchdown and
    due west there (est; the real plane is not in the sources)."""
    lat = math.radians(C['site_lat_deg'])
    n0 = np.array([math.cos(lat), 0, math.sin(lat)]); east0 = np.array([0, 1.0, 0]); north0 = np.array([-math.sin(lat), 0, math.cos(lat)]); w0 = -east0
    Psi_pdi = geo_base['Psi'][0]
    ct, st = math.cos(Psi_pdi), math.sin(Psi_pdi)
    er = ct * n0 + st * w0; et = -st * n0 + ct * w0
    pos = M.R_PDI * er; vel = M.VR0 * er + M.VTH0 * et
    t_pdi = 0.0
    t_doi2 = hms('109:22:42') + 9600 - T_IGN      # ALSJ clock relative to ignition
    t_undock = hms('107:47:56') + 9600 - T_IGN
    def acc(p): return -MU * p / np.linalg.norm(p)**3
    def rk4(p, v, dt):
        k1v = acc(p); k1p = v
        k2v = acc(p + 0.5 * dt * k1p); k2p = v + 0.5 * dt * k1v
        k3v = acc(p + 0.5 * dt * k2p); k3p = v + 0.5 * dt * k2v
        k4v = acc(p + dt * k3p); k4p = v + dt * k3v
        return p + dt / 6 * (k1p + 2 * k2p + 2 * k3p + k4p), v + dt / 6 * (k1v + 2 * k2v + 2 * k3v + k4v)
    rows = []; p, v = pos.copy(), vel.copy(); t = t_pdi
    step = -1.0
    doi_done = False
    ts = [];
    out = []
    while t > t_undock - 1e-9:
        out.append((t, p.copy(), v.copy(), 'descent-orbit' if not doi_done else 'pre-DOI2-orbit'))
        if not doi_done and t + step < t_doi2:
            # undo DOI-2: v_pre = v_post + 7 ft/s along the velocity direction
            v = v + 7 * FT * v / np.linalg.norm(v); doi_done = True
        p, v = rk4(p, v, step); t += step
    out.reverse()
    def enu(p, v, t):
        ang = OMEGA * (t - T_LAND)
        ca, sa = math.cos(ang), math.sin(ang)
        rot = lambda a: np.array([ca * a[0] - sa * a[1], sa * a[0] + ca * a[1], a[2]])
        site = R_SITE * rot(n0); e, n, u = rot(east0), rot(north0), rot(n0)
        d = p - site
        vs = np.cross(np.array([0, 0, OMEGA]), site)
        dv = v - vs
        return [float(d @ e), float(d @ n), float(d @ u)], [float(dv @ e), float(dv @ n), float(dv @ u)]
    def elements(p, v):
        r = np.linalg.norm(p); en = np.dot(v, v) / 2 - MU / r; a = -MU / (2 * en)
        h = np.cross(p, v); e = np.cross(v, h) / MU - p / r; ecc = np.linalg.norm(e)
        return a * (1 - ecc) - R_REF, a * (1 + ecc) - R_REF
    segs = []
    for name in ('pre-DOI2-orbit', 'descent-orbit'):
        pts = [x for x in out if x[3] == name]
        rp, ra = elements(pts[-1][1], pts[-1][2])
        seg = dict(name=name, t_start=pts[0][0], t_end=pts[-1][0], dt_s=60, perilune_km=rp / 1e3, apolune_km=ra / 1e3, rows=[])
        for (tt_, p_, v_, _) in pts[::60]:
            pe, ve = enu(p_, v_, tt_)
            seg['rows'].append([round(tt_, 1), *[round(x, 1) for x in pe], *[round(x, 3) for x in ve], round(float(np.linalg.norm(p_) - R_SITE), 1)])
        segs.append(seg)
    return segs


def build(fast=False):
    base = solve({})
    res = M.run(tuple(base['fit'][:3]), thrust_full_lbf=C['ftp_thrust_lbf'] * base['fit'][3], dt=DT_FINE, t_end=T_END)
    geo = geometry(res); kL = int(round(T_LAND / DT_FINE)); geo = freeze_after_contact(geo, kL)
    geo_base = geometry(base)
    envs = []
    if not fast:
        for label, kw in variants()[1:]:
            r2 = solve(kw, x0=base['fit'] if not ({'dpsi', 'pdi_alt'} & set(kw)) else None)
            g2 = geometry(r2)
            envs.append(dict(label=label, vg=r2['vth'] + M.U_SURF, E=g2['E'], fit=r2['fit'], cost=r2['fit_cost'], prop=float(r2['m'][0] - r2['m'][-1])))
    return base, res, geo, geo_base, envs, kL


def col(a, nd):
    return [round(float(x), nd) for x in a]


def compose(fast=False):
    base, res, geo, geo_base, envs, kL = build(fast)
    t = res['t']; nfine = len(t)
    N = geo['N'] + crossrange(t); N[kL + 1:] = 0.0
    E, U = geo['E'], geo['U'].copy()
    vg = res['vth'] + M.U_SURF
    vg[kL + 1:] = 0.0
    if envs:
        vgs = np.stack([e['vg'] for e in envs] + [vg[:kL + 1]]); Es = np.stack([e['E'] for e in envs] + [geo['E'][:kL + 1]])
        vg_band = np.maximum(vgs.max(0) - vg[:kL + 1], vg[:kL + 1] - vgs.min(0)); E_band = np.maximum(Es.max(0) - geo['E'][:kL + 1], geo['E'][:kL + 1] - Es.min(0))
        gap = abs(vg[int(565 / DT_FINE)] - M.HIGH_GATE_VG)
        w = np.clip(1 - np.abs(t[:kL + 1] - 565.0) / 75.0, 0, 1)             # the read high-gate speed applies near 565 s, tapering to 0 by +-75 s
        vg_band = np.maximum(vg_band, gap * w)
        vg_band = np.concatenate([vg_band, np.zeros(nfine - kL - 1)]); E_band = np.concatenate([E_band, np.zeros(nfine - kL - 1)])
    else:
        vg_band = np.zeros(nfine); E_band = np.zeros(nfine)
    quat, heading, nose, yaw = attitude(res, geo, DT_FINE)
    alt_called = res['h'].copy(); pad = alt_called + PROBE_M
    for k, x in enumerate(t):
        if x > T_LAND:
            alt_called[k] = 0.0
            pad[k] = PROBE_M if x <= T_ENGINE_STOP else max(0.0, PROBE_M - 0.5 * G_MOON * (x - T_ENGINE_STOP)**2)
    # E/N/U used for velocity: U here is the tangent-plane height; add pad/probe reference only for the surface rows
    Uo = U.copy()
    # velocities (ground-relative, ENU) by central difference of the fine grid
    def cd(a):
        d = np.gradient(a, DT_FINE); return d
    vE, vN, vU = cd(E), cd(N), cd(Uo)
    vU[kL + 1:] = 0.0; vE[kL + 1:] = 0.0; vN[kL + 1:] = 0.0
    hz = np.hypot(vE, vN)
    sel = np.arange(0, nfine, int(round(1 / DT_FINE)))
    ts = t[sel]
    # uncertainty bands
    ua_m, ut = wp_unc_alt(ts)
    vr = res['vr'][sel]
    alt_unc = np.sqrt(ua_m**2 + (ut * np.abs(vr))**2)
    hz_unc = vg_band[sel] + 0.3
    hz_unc[ts > T_LAND] = 0.0
    pos_unc = E_band[sel]
    # provenance
    p_alt = prov_alt(ts); p_att = prov_att(ts)
    ev = {tt(e['clk']): e for e in W['events']}
    thr = res['thrust'][sel]
    frac = thr / FTP_N
    engine = []
    for x, f in zip(ts, frac):
        if x < 0: engine.append('ullage')
        elif x >= T_ENGINE_STOP: engine.append('off')
        elif x < M.T_STEP_FULL: engine.append('minimum')
        elif x < M.T_THROTTLE_DOWN: engine.append('full')
        else: engine.append('throttled')
    def dust(h_m, x):
        # rendering index 0..1, est: 0 above 110 ft; knots from the call table (ALSJ/MR); NOT a measurement
        knots = [(110 * FT + PROBE_M * 0, 0.0), (80 * FT, 0.12), (65 * FT, 0.2), (40 * FT, 0.3), (35 * FT, 0.5), (0.0, 1.0)]
        hs = [k[0] for k in knots][::-1]; vs = [k[1] for k in knots][::-1]
        return float(np.interp(h_m, hs, vs))
    dust_idx = [dust(h, x) if x < T_ENGINE_STOP else (1.0 if x < T_ENGINE_STOP + 6 else 1.0) for h, x in zip(alt_called[sel], ts)]
    get_alsj = ts + T_IGN
    get_mr = get_alsj - 9600
    launch = np.datetime64('1972-12-07T05:33:00')
    utc = [str(launch + np.timedelta64(int(round(g * 1000)), 'ms')) + 'Z' for g in get_mr]
    prov_vh = ['E' if x <= T_LAND else 'V' for x in ts]
    prov_vv = ['V' if any(abs(x - tt(r['clk'])) <= 0.6 for r in W['rates_check_fps']) else 'I' for x in ts]
    prov_thr = ['V' if x < M.T_THROTTLE_DOWN else 'E' for x in ts]
    cols = {
        't_s': col(ts, 2), 'get_mr_s': col(get_mr, 2), 'get_alsj_s': col(get_alsj, 2), 'utc': utc,
        'alt_m': col(alt_called[sel], 2), 'pad_alt_m': col(pad[sel], 3),
        'E_m': col(E[sel], 1), 'N_m': col(N[sel], 1), 'U_m': col(Uo[sel], 1),
        'vE_ms': col(vE[sel], 3), 'vN_ms': col(vN[sel], 3), 'vU_ms': col(vU[sel], 3), 'v_ground_ms': col(vg[sel], 3),
        'psi_deg': col(res['psi'][sel], 2), 'yaw_left_deg': col(yaw[sel], 2),
        'quat_wxyz': [[round(float(c), 5) for c in q] for q in quat[sel]],
        'heading_deg': col(heading[sel], 2), 'nose_elev_deg': col(nose[sel], 2),
        'thrust_N': col(thr, 0), 'throttle_of_ftp': col(frac, 3), 'mass_kg': col(res['m'][sel], 1), 'engine': engine,
        'dust_index': [round(x, 3) for x in dust_idx],
        'prov': {'alt': p_alt, 'vv': prov_vv, 'vh': prov_vh, 'pos': ['E'] * len(ts), 'att': p_att, 'thr': prov_thr, 'dust': ['E'] * len(ts)},
        'unc': {'alt_m': col(alt_unc, 1), 'v_horizontal_ms': col(hz_unc, 2), 'pos_E_m': col(pos_unc, 0), 'pos_N_m': col(np.where(ts < 0.5, 2000.0, np.where(ts <= T_LAND, 300.0, 0.0)), 0), 'att_deg': col(np.where(np.array(p_att) == 'E', 8.0, 2.5), 1)},
    }
    return base, res, geo, geo_base, envs, cols, kL



def checks(base, res, geo, geo_base, envs, cols, kL):
    t = res['t']
    out = {}
    m0 = res['m0']
    dv = float(np.sum(res['a'][:kL]) * DT_FINE)
    out['delta_v_model_mps'] = round(dv, 1); out['delta_v_mr_mps'] = round(C['dv_pdi_fps'] * FT, 1)
    out['propellant_model_kg'] = round(float(res['m'][0] - res['m'][kL]), 1); out['propellant_mr_kg'] = round(C['prop_consumed_lb'] * M.LB, 1)
    out['ve_derived_ms'] = round(res['ve'], 1); out['isp_derived_s'] = round(res['ve'] / M.G0, 1)
    out['thrust_full_fit_N'] = round(C['ftp_thrust_lbf'] * M.LBF * base['fit'][3], 0)
    out['thrust_full_published_N'] = round(FTP_N, 0)
    vr = M.vertical_residual(res)
    rr = [d - m for _, d, m in vr]
    out['vertical_accel_residual_rms_ms2'] = round(float(np.sqrt(np.mean(np.square(rr)))), 3); out['vertical_accel_residual_max_ms2'] = round(float(np.max(np.abs(rr))), 3)
    rc = []
    for r in W['rates_check_fps']:
        k = int(np.argmin(np.abs(res['h'][:kL + 1] - r['h_ft'] * FT))); rc.append({'clk_reported': r['clk'], 'clk_track': '%d:%02d:%02d' % divmod_hms(int(round(res['t'][k] + T_IGN))), 'h_ft': r['h_ft'], 'reported_down_fps': r['down_fps'], 'track_down_fps': round(float(-res['vr'][k] / FT), 1)})
    out['rates_check'] = rc
    out['horizontal_speed_at_high_gate_ms'] = round(float(res['vth'][int(565 / DT_FINE)] + M.U_SURF), 1)
    out['horizontal_speed_at_high_gate_read_ms'] = round(M.HIGH_GATE_VG, 1)
    d = lambda clk: math.hypot(geo['E'][int(tt(clk) / DT_FINE)], (geo['N'] + crossrange(t))[int(tt(clk) / DT_FINE)]) / 1e3
    out['distance_to_site_km'] = {'112:55:59': round(d('112:55:59'), 1), '112:58:40': round(d('112:58:40'), 1), 'pdi': round(math.hypot(geo['E'][0], geo['N'][0]) / 1e3, 1)}
    out['distance_reads_km'] = {g['clk']: g['range_km'] for g in W['geometry_reads']}
    out['pdi_state'] = {'alt_above_site_m': round(M.H0, 0), 'v_tangential_ms': round(M.VTH0, 1), 'v_radial_ms': round(M.VR0, 1), 'true_anomaly_deg': round(math.degrees(M.NU_PDI), 1), 'ecc': round(M.E_, 4)}
    out['fit'] = {'psi600': round(base['fit'][0], 1), 'psi640': round(base['fit'][1], 1), 'psi680': round(base['fit'][2], 1), 'thrust_scale': round(base['fit'][3], 4), 'cost': round(base['fit_cost'], 2)}
    out['ensemble'] = [{'label': e['label'], 'v_ground_at_high_gate_ms': round(float(e['vg'][int(565 / DT_FINE)]), 1), 'E_pdi_km': round(float(e['E'][0]) / 1e3, 1), 'propellant_kg': round(e['prop'], 0), 'fit_cost': (round(e['cost'], 1) if e['cost'] == e['cost'] else None)} for e in envs]
    # continuity: max |dv| between 1 s samples
    v = np.array([cols['vE_ms'], cols['vN_ms'], cols['vU_ms']]).T
    acc = np.diff(v, axis=0)
    out['max_accel_ms2'] = round(float(np.max(np.linalg.norm(acc, axis=1))), 3)
    out['max_accel_change_per_s_ms2'] = round(float(np.max(np.linalg.norm(np.diff(acc, axis=0), axis=1))), 3)
    return out


def sun_unc_note():
    return 'filled by scripts/emit-descent-sun.mts (the app ephemeris); see sun{} in the JSON'


def write(fast=False):
    base, res, geo, geo_base, envs, cols, kL = compose(fast)
    segs = orbit_segments(res, geo_base)
    ck = checks(base, res, geo, geo_base, envs, cols, kL)
    doc = {
        'schema': 'skylumi.moon.apollo17.descent-track/1',
        'title': 'Apollo 17 lunar module powered descent, reference track',
        'built_by': 'cloud/g2a/build_descent.py from cloud/g2a/waypoints.json (descent_model.py)',
        'clock': {**W['clock'], 't_definition': 't_s = seconds since DPS ignition on the Mission Report clock (110:09:53 MR = 112:49:53 ALSJ). get_mr_s / get_alsj_s are GET seconds on the two clocks; utc = launch 1972-12-07T05:33:00Z + get_mr_s.', 'contact_t_s': T_LAND, 'engine_stop_t_s': T_ENGINE_STOP, 'pads_down_t_s_est': round(T_PAD_DOWN, 2)},
        'frame': {
            'origin': 'the Apollo 17 lunar module rest position (Haase LROC control point + patch shift +12.7 E / +7.2 N, src/ground/site17.ts), at ground level',
            'axes': 'east, north, up at the origin, metres; the origin MOVES with the Moon (ground-fixed), so E,N,U and velocities are ground-relative. U is height above the TANGENT PLANE at the origin (negative and large far away: -61 km at PDI); alt_m is height above the local ground (site radius) as called by the crew.',
            'site_radius_m': R_SITE, 'moon_radius_ref_m': R_REF,
            'attitude': 'quat_wxyz rotates body (X forward through the windows, Y left, Z up along the descent-engine thrust axis, right-handed) into ENU. psi_deg = angle of the thrust axis from local vertical, tilted AGAINST the flight direction (ALSJ pitch, 0 = vertical; 108 at ignition). yaw_left_deg = rotation about the thrust axis (MR yaw 290 = 70 left). roll is 0 before contact (est). heading_deg = compass bearing of the forward axis, nose_elev_deg = its elevation (past 90 the nose points over the zenith: windows up).',
            'g1_conversion': 'G1 model space (lmPlacement.ts attitudeQuat) is three axes (east, up, south) with model +z front, +y up, +x left: three.x = E, three.y = U, three.z = -N; model (x,y,z) = (left, up, forward).',
        },
        'provenance_codes': {'V': 'verified table or text value read in this session (source in waypoints.json)', 'R': 'read second-hand or from a summary, not re-checked at source', 'I': 'interpolated between V/R waypoints by monotone PCHIP', 'E': 'estimated by the model, band given'},
        'columns_doc': 'one entry per second, t_s from 0 (ignition) to 732 (5 s after engine stop); parallel arrays. prov.* and unc.* give the tag and band of each value group.',
        'powered': cols,
        'orbit_segments': segs,
        'events': [{'t_s': tt(e['clk']), 'clk_alsj': e['clk'], 'event': e['ev'], 'prov': e['prov'], 'src': e['src']} for e in W['events']],
        'dust_and_contact': {
            'table': W['dust'],
            'rendering_index': 'dust_index in powered{} is a 0..1 rendering scale interpolated over the call table: 0 above 110 ft, 0.12 at 80 ft, 0.2 at 65 ft (MR: first seen 60 to 70 ft), 0.3 at 40 ft, 0.5 at 35 ft (film: easily visible), 1.0 at contact. E. Not a physical dust density. The MR says the radar did not lock onto dust.',
            'contact_probes_m': round(PROBE_M, 3), 'contact_probes_prov': 'R (60 in on Apollo 16 and 17, web summary of collectSPACE/Wikipedia; not read at source)',
            'contact_light': 'lit when a probe tip touches, so at contact the pad plane is about probe-length above the ground; alt_m is 0 there, pad_alt_m is the pad plane height',
            'engine_bell_height': 'UNKNOWN in the sources read; needs the LM-12 descent-stage drawing (the J-mission extended skirt). No number given.',
            'thrust_near_contact': 'throttle_of_ftp and thrust_N are E; at contact the thrust is about hover weight (mass * lunar g)',
            'landing_gear': 'MR: rear strut rested near the bottom of a 3 to 4 m crater, attitude after shutdown 4 to 5 deg pitch up and 0 roll, near zero yaw (ALSJ adds about 2 deg left roll); harder-than-anticipated aft impact: pivot on the forward strut.',
        },
        'touchdown': {
            'origin_lonlat_haase_plus_shift': 'origin = LM_HAASE (30.7716815 E, 20.1909097 N) + 12.7 m E, +7.2 N (patch frame, see site17.ts)',
            'mr_photomap_coordinates': {'lat': 20.165278, 'lon': 30.765833, 'note': 'MR 20 09 55 N, 30 45 57 E on the 1:25,000 Taurus-Littrow photomap; before the LROC controlled position, so about 0.8 km SSW of the Haase position'},
            'target_offset_records': {'brief': 'landing about 230 m W and 60 m S of the target; target = LM + (230 E, 60 N)', 'mr': 'eight redesignations, ending several hundred metres south of the targeted point (Mission Report 10.7); +3400 ft downrange target update early in the burn', 'alsj': W['targets']['offset_alsj_text'], 'used_in_track': list(TARGET_EN)},
            'track_end': {'E_m': cols['E_m'][725], 'N_m': cols['N_m'][725], 'alt_m': cols['alt_m'][725]},
        },
        'checks': ck,
        'sun': {'note': sun_unc_note()},
        'window_geometry': {
            'facts': [
                'Ignition: yaw 70 deg left, thrust axis 108 deg from vertical (pointing east, 18 deg below the horizon), windows face the sky (crew on their backs, heads east).',
                'Yaw 70 -> 20 left at 112:54:07 (MR: 290 -> 340 with landing radar lock); yaw 0 at about 112:56:33, "windows up" (ALSJ). The Earth was in the front window at 112:55:04 and left it at 112:56:33.',
                'During the braking phase the forward axis is elevated 74 deg (5:08) to 60 deg (8:21) above the horizon toward the flight direction: the windows show sky, not ground.',
                'Pitchover at 112:59:15 (P64): psi 60 -> about 20; the surface comes into the window ("filled the window"), South Massif visible out the bottom of the commander window at 13,000 ft (MR) / 16,000 ft (ALSJ 112:58:17).',
                'Final approach: near vertical (psi about 0 by 680 s in the fit, E), windows look west, forward and down through the lower part of the window (MR: extra effort to look out the bottom half).',
                'Rest: nose 4.5 deg up, left roll 2 deg (heading is not in the sources; ALSJ: 12 oclock is due west on approach).',
            ],
            'prov': 'V for the attitude angles at waypoints, E after the pitchover',
        },
        'estimated_or_unknown': [
            'Horizontal velocity and downrange at every time: E (model, bands in unc.v_horizontal_ms / unc.pos_E_m from the ensemble in checks.ensemble). Not in any source read.',
            'Approach-phase pitch history 577..725 s: E (three fitted values, checks.fit). Only "60 -> about 20 deg" at pitchover and "about zero at shutdown" are sourced.',
            'Pre-PDI crossrange and orbit plane: E (plane through the site containing due west at the site; the orbit inclination follows, about the site latitude). The Mission Report tables were not found for the ground track.',
            'PDI altitude 8.7 nmi: R (search summary of the Mission Report, not in the text layer I read).',
            'Thrust 9,710 lbf and the min throttle 1,050 lbf: E (published values, not in the report); the fit changes the full thrust by under 1 percent.',
            'Engine-stop time (+2 s MR, +5 s ALSJ), pad touchdown time (free fall from probe length), engine bell height: E / unknown.',
            'ALSJ clock vs MR clock: ignition 3 s apart (112:49:56 vs 112:49:53).',
            'Moon rotation is included (site moves east 4.3 m/s inertially); libration and gravity harmonics are not.',
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    return doc


def strip_bands(doc):
    d = json.loads(json.dumps(doc))
    d['powered'].pop('unc', None); d['checks'].pop('ensemble', None)
    return d


if __name__ == '__main__':
    fast = '--fast' in sys.argv or '--check' in sys.argv
    doc = write(fast)
    if '--check' in sys.argv:
        cur = json.load(open(OUT))
        a, b = strip_bands(doc), strip_bands(cur)
        ok = True
        for k in ('powered',):
            for c in a[k]:
                if a[k][c] != b[k][c]:
                    # tolerate 1e-6 relative in numeric columns
                    try:
                        if np.allclose(np.array(a[k][c], float), np.array(b[k][c], float), rtol=1e-6, atol=1e-6): continue
                    except Exception: pass
                    print('column differs:', c); ok = False
        print('check', 'OK' if ok else 'DIFFERENT'); sys.exit(0 if ok else 1)
    json.dump(doc, open(OUT, 'w'), separators=(',', ':'), allow_nan=False)
    print('wrote', OUT, OUT.stat().st_size, 'bytes'); print(json.dumps(doc['checks'], indent=1))
