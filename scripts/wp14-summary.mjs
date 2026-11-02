// Flight smoothness summary: node scripts/wp14-summary.mjs <dir|file.json> [auto|drag|flights] [--hz N]
// Reads <tag>-<arm>-r<n>.json written by a GPU-rig flight run, or moon-sample-*.json saved by the ?sampler=1 recorder (src/perf/flightSampler.ts).
// Presented % uses the display rate of each file (--hz, else the file's displayHz, else 60 for rig files that have no `ua`); N/A when unknown.
// mode auto (default) takes each file's own `mode`. hz is estimated per analysed window (a mixed-rate file shows in its rateMix field).
// pres/cv/zeroSlots are against the app's paced cadence (pcad, set when the app holds motion below the display rate); presRaw/cvRaw/zeroRaw count every rAF slot. s2/s3/s6 = gaps of >= 2/3/6 display slots.
import fs from 'node:fs';
const argv = process.argv.slice(2); const hzI = argv.indexOf('--hz');
const HZ_ARG = hzI >= 0 ? Number(argv[hzI + 1]) : null; if (hzI >= 0) argv.splice(hzI, 2);
const dir = argv[0]; const MODE_ARG = argv[1] ?? 'auto';
if (!dir) { console.error('usage: node scripts/wp14-summary.mjs <dir|file.json> [auto|drag|flights] [--hz N]'); process.exit(2); }
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r1 = (x) => (x === null || x === undefined || Number.isNaN(x) ? 'N/A' : (+x).toFixed(1));
const ang = (a, b) => { const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; const na = Math.hypot(...a), nb = Math.hypot(...b); return Math.acos(Math.min(1, Math.max(-1, d / (na * nb)))); };
// Per-tick displayed camera: carry the last drawn position forward. Returns slot steps (rad) and rAF intervals.
function slots(s) {
  let cur = null; const out = []; let drawn = 0;
  for (let i = 0; i < s.length; i++) {
    const adv = i > 0 && s[i][2] !== s[i - 1][2];
    let step = 0;
    if (s[i][3]) { if (cur && adv) step = ang(cur, s[i][3]); cur = s[i][3]; }
    if (adv) drawn++;
    out.push({ t: s[i][0], pn: s[i][1], dt: i ? s[i][0] - s[i - 1][0] : 0, step, adv });
  }
  return { out, drawn };
}
const HZ_STEPS = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];
// Refresh rate of the window itself (a ProMotion display adapts, so the whole-file figure can be the wrong mode). Same rule as flightSampler.ts.
function estHz(iv) {
  const ok = iv.filter((x) => x > 2 && x <= 40); if (ok.length < 20) return null;
  const hz = 1000 / q(ok, 0.5); for (const st of HZ_STEPS) if (Math.abs(hz - st) / st < 0.04) return st; return Math.round(hz);
}
// The cadence the app itself holds motion to (pacing tier 1 = 60 Hz, 2 = 30 Hz on faster displays; paceCadenceHz in the 200 ms polls). null when the file has no such poll fields.
function paced(polls, a, b) {
  const p = (polls ?? []).filter((x) => x.t >= a && x.t <= b);
  const cad = q(p.map((x) => x.pcad).filter((x) => Number.isFinite(x) && x > 0), 0.5); const tier = q(p.map((x) => x.tier).filter((x) => Number.isFinite(x)), 0.5);
  return { cad: cad ?? (tier === 1 ? 60 : tier === 2 ? 30 : null), tier };
}
const cvOf = (a) => { if (a.length < 2) return null; const m = a.reduce((x, y) => x + y, 0) / a.length; const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); return m > 0 ? sd / m : null; };
// hzFile: the file's displayHz (or 60 for rig files); pace: { cad, tier } from paced(). Columns pres/cv/zeroSlots are against the PACED cadence when the app paced below the display rate;
// presRaw/cvRaw/zeroRaw always count every rAF slot (a healthy tier-1 drag on a 120 Hz display reads ~50 % presRaw).
function stats(s, t0, t1, hzFile, pace) {
  const w = s.filter((x) => x[0] >= t0 && x[0] <= t1); if (w.length < 5) return null;
  const { out, drawn } = slots(w); const iv = out.slice(1).map((o) => o.dt); const st = out.slice(1).map((o) => o.step);
  const hz = HZ_ARG ?? estHz(iv) ?? hzFile ?? null;
  const dur = w[w.length - 1][0] - w[0][0];
  const stalls = st.filter((x) => x === 0).length;
  const isPaced = !!(hz && pace.cad && pace.cad < hz * 0.99);
  const pc = isPaced ? pace.cad : hz;
  const adv = out.slice(1).filter((o) => o.adv);
  let missed = 0; if (pc) { let lastT = null; for (const o of out) { if (!o.adv) continue; if (lastT !== null) missed += Math.max(0, Math.round((o.t - lastT) * pc / 1000) - 1); lastT = o.t; } }
  const slotGap = (n) => (hz ? iv.filter((x) => x >= n * 1000 / hz).length : null);
  const presRaw = hz ? Math.min(100, drawn * 1000 / hz / dur * 100) : null; const cvRaw = cvOf(st); const zeroRaw = stalls / st.length * 100;
  return { dur, n: iv.length, hz, pcad: isPaced ? pace.cad : null, tier: pace.tier, p50: q(iv, 0.5), p95: q(iv, 0.95), p99: q(iv, 0.99), max: Math.max(...iv), g50: iv.filter((x) => x >= 50).length, g100: iv.filter((x) => x >= 100).length, g25: iv.filter((x) => x >= 25).length,
    s2: slotGap(2), s3: slotGap(3), s6: slotGap(6), presRaw, cvRaw, zeroRaw,
    pres: isPaced ? (pc ? Math.min(100, drawn * 1000 / pc / dur * 100) : null) : presRaw, cv: isPaced ? cvOf(adv.map((o) => o.step)) : cvRaw, zeroSlots: isPaced ? (drawn + missed > 0 ? missed / (missed + drawn) * 100 : null) : zeroRaw };
}
const isFile = fs.statSync(dir).isFile();
const files = isFile ? [dir] : fs.readdirSync(dir).filter((f) => /-r\d+\.json$/.test(f) || /^moon-sample-.*\.json$/.test(f)).map((f) => `${dir}/${f}`);
const rowsBy = { drag: {}, flights: {} };
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(f)); if (r.error) { console.log('ERR', f, r.error); continue; }
  const mode = MODE_ARG === 'auto' ? (r.mode === 'flights' ? 'flights' : 'drag') : MODE_ARG; const rows = rowsBy[mode];
  const hz = Number.isFinite(r.displayHz) && r.displayHz > 0 ? r.displayHz : (r.ua ? null : 60);
  if (mode === 'drag') {
    for (const tr of r.trials ?? (r.data ? [{ data: r.data }] : [])) {
      const d = tr.data; if (!d.moves.length) continue;
      const t0 = d.moves[0][0], t1 = d.moves[d.moves.length - 1][0];
      const st = stats(d.s, t0, t1, hz, paced(d.polls, t0 - 300, t1 + 300)); if (!st) continue;
      // lag proxy: event timeStamp -> post-draw task of the first drawn frame whose sampling task ran after the handler
      const lags = [];
      for (const m of d.moves) { for (let i = 1; i < d.s.length; i++) { if (d.s[i][2] !== d.s[i - 1][2] && d.s[i][1] >= m[1]) { lags.push(d.s[i][1] - m[0]); break; } } }
      const lt = d.lt.filter(([s]) => s >= t0 && s <= t1).map((x) => x[1]);
      (rows[r.replayDrag ? `${r.arm}:replay` : r.ua ? `${r.arm}:manual` : r.arm] ??= []).push({ ...st, lagp50: q(lags, 0.5), lagp95: q(lags, 0.95), lagmax: lags.length ? Math.max(...lags) : null, ltN: lt.length, ltMax: lt.length ? Math.max(...lt) : 0, scale: q(d.polls.map((p) => p.scale).filter((x) => x != null), 0.5), held: (d.polls.at(-1)?.holds ?? 0) - (d.polls[0]?.holds ?? 0) });
    }
  } else if (r.data && r.started !== null && r.started !== undefined) {
    // flights: window on the performance.now clock (s[1]); rAF timestamp clock differs by a constant offset
    const s = r.data.s; const off = s.length ? s[0][0] - s[0][1] : 0; const t0 = r.started + off, t1 = (r.ended ?? r.started + 1e9) + off;
    const w = s.filter((x) => x[0] >= t0 && x[0] <= t1); const st = stats(s, t0, t1, hz, paced(r.data.polls, r.started, r.ended ?? 1e12)); if (!st) continue;
    const { out } = slots(w); const bySec = {};
    for (const o of out.slice(1)) { const k = Math.floor((o.t - w[0][0]) / 1000); (bySec[k] ??= []).push(o); }
    const secCv = Object.entries(bySec).filter(([, a]) => a.length > 30).map(([k, a]) => { const m = a.reduce((x, o) => x + o.step, 0) / a.length; const sd = Math.sqrt(a.reduce((x, o) => x + (o.step - m) ** 2, 0) / a.length); return [+k, m > 0 ? sd / m : 0, Math.max(...a.map((o) => o.dt)), a.filter((o) => o.step === 0).length]; });
    const worst = secCv.sort((a, b) => b[1] - a[1])[0] ?? [null, null, null, null];
    const sc = w.length ? r.data.polls.filter((p) => p.t >= r.started && p.t <= (r.ended ?? 1e12)).map((p) => p.scale) : [];
    let scaleChanges = 0; for (let i = 1; i < sc.length; i++) if (sc[i] !== sc[i - 1]) scaleChanges++;
    const lt = r.data.lt.filter(([a]) => a >= r.started && a <= (r.ended ?? 1e12)).map((x) => x[1]);
    const big = out.filter((o) => o.dt >= 25).map((o) => [+((o.t - w[0][0]) / 1000).toFixed(1), +o.dt.toFixed(0)]);
    (rows[`${r.arm}|${r.moment}`] ??= []).push({ ...st, flightS: (r.ended - r.started) / 1000, worstSec: worst[0], worstCv: worst[1], worstGap: worst[2], scaleChanges, scaleMin: sc.some((x) => x != null) ? Math.min(...sc.filter((x) => x != null)) : null, ltN: lt.length, ltMax: lt.length ? Math.max(...lt) : 0, bigGaps: big.length, gapList: big.slice(0, 12), gpu: /NVIDIA/.test(JSON.stringify(r.gpu ?? '')) });
  }
}
{
  const rows = rowsBy.flights;
  if (Object.keys(rows).length) {
  const cols = ['flightS', 'n', 'p50', 'p95', 'p99', 'max', 'hz', 'pcad', 'tier', 'g25', 'g50', 'g100', 's2', 's3', 's6', 'pres', 'presRaw', 'cv', 'cvRaw', 'zeroSlots', 'zeroRaw', 'worstCv', 'scaleChanges', 'scaleMin', 'ltN', 'ltMax'];
  console.log('| arm | flight | runs | ' + cols.join(' | ') + ' |'); console.log('|' + '---|'.repeat(cols.length + 3));
  for (const [k, a] of Object.entries(rows).sort()) {
    const med = (c) => q(a.map((x) => x[c]).filter((x) => x !== null && x !== undefined && Number.isFinite(x)), 0.5);
    const mx = (c) => Math.max(...a.map((x) => x[c] ?? 0));
    console.log(`| ${k.replace('|', ' | ')} | ${a.length} | ` + cols.map((c) => `${r1(med(c))} (${r1(mx(c))})`).join(' | ') + ' |');
  }
  console.log('cells: median across runs (max across runs)');
  if (argv.includes('gaps')) for (const [k, a] of Object.entries(rows).sort()) console.log(k, JSON.stringify(a.map((x) => x.gapList)));
  }
}
{
  const rows = rowsBy.drag;
  if (Object.keys(rows).length) {
  const cols = ['n', 'p50', 'p95', 'p99', 'max', 'hz', 'pcad', 'tier', 'g25', 'g50', 'g100', 's2', 's3', 's6', 'pres', 'presRaw', 'lagp50', 'lagp95', 'lagmax', 'cv', 'cvRaw', 'zeroSlots', 'zeroRaw', 'ltN', 'ltMax', 'scale', 'held'];
  console.log('| arm | trials | ' + cols.join(' | ') + ' |'); console.log('|' + '---|'.repeat(cols.length + 2));
  for (const [arm, a] of Object.entries(rows)) {
    const med = (k) => q(a.map((x) => x[k]).filter((x) => x !== null && x !== undefined), 0.5);
    const mx = (k) => Math.max(...a.map((x) => x[k] ?? 0));
    console.log(`| ${arm} | ${a.length} | ` + cols.map((k) => `${r1(med(k))} (${r1(mx(k))})`).join(' | ') + ' |');
  }
  console.log('cells: median across trials (max across trials)');
}
}
