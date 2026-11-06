// Edge model. Edges are { eid, k: "line" | "quad" | "cubic" | "arc", a, b, c1?, c2?, ctr?, r?, ccw?, label? }
// stored in canvas coordinates (cm, y down). Sampling, splitting, reversing and transforming edges.
import { add, closestOnSeg, dist, lerp, mul, sub } from '../geometry.js';
import { nid } from '../state.js';

export function arcSpan(e) {
  const ta = Math.atan2(e.a[1] - e.ctr[1], e.a[0] - e.ctr[0]),
    tb = Math.atan2(e.b[1] - e.ctr[1], e.b[0] - e.ctr[0]);
  let sp = tb - ta;
  if (e.ccw) {
    while (sp <= 1e-9) sp += 2 * Math.PI;
  } else {
    while (sp >= -1e-9) sp -= 2 * Math.PI;
  }
  return [ta, sp];
}
export function edgeAt(e, t) {
  if (t <= 0) return e.a;
  if (t >= 1) return e.b;
  if (e.k === 'quad') return lerp(lerp(e.a, e.c1, t), lerp(e.c1, e.b, t), t);
  if (e.k === 'cubic') {
    const p = lerp(e.a, e.c1, t),
      q = lerp(e.c1, e.c2, t),
      r = lerp(e.c2, e.b, t);
    return lerp(lerp(p, q, t), lerp(q, r, t), t);
  }
  if (e.k === 'arc') {
    const [ta, sp] = arcSpan(e),
      th = ta + sp * t;
    return [e.ctr[0] + e.r * Math.cos(th), e.ctr[1] + e.r * Math.sin(th)];
  }
  return lerp(e.a, e.b, t);
}
export const edgeN = (e) =>
  e.k === 'line'
    ? 1
    : e.k === 'arc'
      ? Math.max(8, Math.ceil(Math.abs(arcSpan(e)[1]) / (Math.PI / 36)))
      : e.k === 'quad'
        ? 16
        : 24;
export function edgeSample(e) {
  const n = edgeN(e),
    o = [];
  for (let i = 0; i <= n; i++) o.push(edgeAt(e, i / n));
  return o;
}
export function edgeTable(e) {
  const n = e.k === 'line' ? 1 : 64,
    pts = [],
    cum = [0];
  for (let i = 0; i <= n; i++) {
    pts.push(edgeAt(e, i / n));
    if (i) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  }
  return { n, pts, cum, L: cum[n] };
}
export const edgeLen = (e) => edgeTable(e).L;
export function fracAtParam(e, t) {
  const T = edgeTable(e),
    x = t * T.n,
    i = Math.min(T.n - 1, Math.floor(x)),
    u = x - i;
  return T.L ? (T.cum[i] + (T.cum[i + 1] - T.cum[i]) * u) / T.L : t;
}
export function paramAtFrac(e, f) {
  const T = edgeTable(e),
    s = f * T.L;
  for (let i = 1; i <= T.n; i++)
    if (T.cum[i] >= s - 1e-12) {
      const g = T.cum[i] - T.cum[i - 1];
      return (i - 1 + (g ? (s - T.cum[i - 1]) / g : 0)) / T.n;
    }
  return 1;
}
export function paramAtPoint(e, P) {
  const T = edgeTable(e);
  let best = null;
  for (let i = 0; i < T.n; i++) {
    const r = closestOnSeg(P, T.pts[i], T.pts[i + 1]);
    if (!best || r.d < best.d) best = { d: r.d, t: (i + r.t) / T.n };
  }
  return best;
}
export function edgeSplit(e, t) {
  const P = edgeAt(e, t),
    A = { ...e, eid: nid('e'), b: P },
    B = { ...e, eid: nid('e'), a: P };
  if (e.k === 'quad') {
    A.c1 = lerp(e.a, e.c1, t);
    B.c1 = lerp(e.c1, e.b, t);
  }
  if (e.k === 'cubic') {
    const p01 = lerp(e.a, e.c1, t),
      p12 = lerp(e.c1, e.c2, t),
      p23 = lerp(e.c2, e.b, t);
    A.c1 = p01;
    A.c2 = lerp(p01, p12, t);
    B.c1 = lerp(p12, p23, t);
    B.c2 = p23;
  }
  return [A, B];
}
export function edgeRev(e) {
  const r = { ...e, a: e.b, b: e.a };
  if (e.k === 'cubic') {
    r.c1 = e.c2;
    r.c2 = e.c1;
  }
  if (e.k === 'arc') r.ccw = !e.ccw;
  return r;
}
export function edgeMap(e, fn, reflect) {
  const r = { ...e, a: fn(e.a), b: fn(e.b) };
  if (e.c1) r.c1 = fn(e.c1);
  if (e.c2) r.c2 = fn(e.c2);
  if (e.ctr) r.ctr = fn(e.ctr);
  if (reflect && e.k === 'arc') r.ccw = !e.ccw;
  return r;
}
export function fitCubic(P) {
  const a = P[0],
    b = P[P.length - 1];
  if (P.length < 3) return { k: 'line', a, b };
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + dist(P[i - 1], P[i]));
  const L = cum[cum.length - 1] || 1;
  let s11 = 0,
    s12 = 0,
    s22 = 0,
    r1 = [0, 0],
    r2 = [0, 0];
  P.forEach((p, i) => {
    const u = cum[i] / L,
      m = 1 - u,
      A1 = 3 * m * m * u,
      A2 = 3 * m * u * u,
      R = sub(p, add(mul(a, m * m * m), mul(b, u * u * u)));
    s11 += A1 * A1;
    s12 += A1 * A2;
    s22 += A2 * A2;
    r1 = add(r1, mul(R, A1));
    r2 = add(r2, mul(R, A2));
  });
  const det = s11 * s22 - s12 * s12;
  if (Math.abs(det) < 1e-12) return { k: 'line', a, b };
  const c1 = [(s22 * r1[0] - s12 * r2[0]) / det, (s22 * r1[1] - s12 * r2[1]) / det],
    c2 = [(s11 * r2[0] - s12 * r1[0]) / det, (s11 * r2[1] - s12 * r1[1]) / det];
  const dev = Math.max(...P.map((p) => closestOnSeg(p, a, b).d));
  return dev < 0.02 ? { k: 'line', a, b } : { k: 'cubic', a, b, c1, c2 };
}
