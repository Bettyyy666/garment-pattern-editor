// 2D vector / polygon math and the polygon-level cut used to find where a cut line crosses a panel.
// All points are [x, y] arrays in canvas coordinates (cm, y down).
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]],
  add = (a, b) => [a[0] + b[0], a[1] + b[1]],
  mul = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1],
  len = (a) => Math.hypot(a[0], a[1]),
  dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
export function area(P) {
  let s = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i],
      b = P[(i + 1) % P.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
export function perimeter(P) {
  let s = 0;
  for (let i = 0; i < P.length; i++) s += dist(P[i], P[(i + 1) % P.length]);
  return s;
}
export function pathLen(P) {
  let s = 0;
  for (let i = 1; i < P.length; i++) s += dist(P[i - 1], P[i]);
  return s;
}
export function centroid(P) {
  const A = area(P);
  if (Math.abs(A) < 1e-9) {
    const s = P.reduce((a, p) => add(a, p), [0, 0]);
    return mul(s, 1 / P.length);
  }
  let cx = 0,
    cy = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i],
      b = P[(i + 1) % P.length],
      f = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * f;
    cy += (a[1] + b[1]) * f;
  }
  return [cx / (6 * A), cy / (6 * A)];
}
export function pip(pt, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i],
      b = P[j];
    if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0])
      c = !c;
  }
  return c;
}
export function closestOnSeg(p, a, b) {
  const ab = sub(b, a),
    l2 = dot(ab, ab);
  let t = l2 ? dot(sub(p, a), ab) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = add(a, mul(ab, t));
  return { pt: q, t, d: dist(p, q) };
}
export function closestOnPoly(p, P, closed = true) {
  let best = null;
  const n = P.length,
    m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const r = closestOnSeg(p, P[i], P[(i + 1) % n]);
    if (!best || r.d < best.d) best = { ...r, edge: i };
  }
  return best;
}
export function segInt(a, b, c, d) {
  const r = sub(b, a),
    s = sub(d, c),
    den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const ca = sub(c, a),
    t = (ca[0] * s[1] - ca[1] * s[0]) / den,
    u = (ca[0] * r[1] - ca[1] * r[0]) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u >= 1 - 1e-9) return null;
  return { t, u: Math.max(0, u), pt: [a[0] + r[0] * t, a[1] + r[1] * t] };
}
export function crSample(P, steps = 12) {
  // Catmull-Rom through all points
  if (P.length < 3) return P.slice();
  const out = [P[0]];
  for (let i = 0; i < P.length - 1; i++) {
    const p1 = P[i],
      p2 = P[i + 1];
    const p0 = i > 0 ? P[i - 1] : sub(mul(p1, 2), p2);
    const p3 = i + 2 < P.length ? P[i + 2] : sub(mul(p2, 2), p1);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps,
        t2 = t * t,
        t3 = t2 * t;
      out.push(
        [0, 1].map(
          (j) =>
            0.5 *
            (2 * p1[j] +
              (-p0[j] + p2[j]) * t +
              (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 +
              (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3),
        ),
      );
    }
  }
  return out;
}
export function pointAtParam(C, s) {
  const j = Math.max(0, Math.min(C.length - 2, Math.floor(s))),
    t = s - j;
  return add(C[j], mul(sub(C[j + 1], C[j]), t));
}
export function pointAtFrac(C, f) {
  const L = pathLen(C) * f;
  let acc = 0;
  for (let i = 1; i < C.length; i++) {
    const d = dist(C[i - 1], C[i]);
    if (acc + d >= L) return add(C[i - 1], mul(sub(C[i], C[i - 1]), d ? (L - acc) / d : 0));
    acc += d;
  }
  return C[C.length - 1];
}
export function clean(P) {
  const out = [];
  for (const p of P) {
    if (!out.length || dist(out[out.length - 1], p) > 1e-6) out.push(p);
  }
  while (out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-6) out.pop();
  return out;
}
export function extendEnds(C, e) {
  const C2 = C.slice();
  const d0 = norm(sub(C[0], C[1])),
    d1 = norm(sub(C[C.length - 1], C[C.length - 2]));
  C2[0] = add(C[0], mul(d0, e));
  C2[C2.length - 1] = add(C[C.length - 1], mul(d1, e));
  return C2;
}
export function corners(P) {
  const out = [],
    n = P.length;
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n],
      b = P[i],
      c = P[(i + 1) % n],
      u = sub(b, a),
      v = sub(c, b),
      lu = len(u),
      lv = len(v);
    if (lu && lv && dot(u, v) / (lu * lv) < Math.cos(Math.PI / 9)) out.push(b);
  }
  return out;
}

export function walk(P, from, to) {
  const n = P.length,
    out = [from.pt];
  if (!(from.edge === to.edge && to.u > from.u)) {
    let i = (from.edge + 1) % n;
    for (let g = 0; g <= n; g++) {
      out.push(P[i]);
      if (i === to.edge) break;
      i = (i + 1) % n;
    }
  }
  out.push(to.pt);
  return out;
}
export function splitOnce(P, cut, all) {
  const n = P.length,
    hits = [],
    pairs = [];
  for (let j = 0; j < cut.length - 1; j++)
    for (let i = 0; i < n; i++) {
      const r = segInt(cut[j], cut[j + 1], P[i], P[(i + 1) % n]);
      if (r) hits.push({ s: j + r.t, edge: i, u: r.u, pt: r.pt });
    }
  hits.sort((a, b) => a.s - b.s);
  const H = [];
  for (const h of hits) {
    if (!H.length || dist(H[H.length - 1].pt, h.pt) > 1e-6) H.push(h);
  }
  for (let k = 0; k < H.length - 1; k++) {
    const h1 = H[k],
      h2 = H[k + 1];
    const mid = pointAtParam(cut, (h1.s + h2.s) / 2);
    if (!pip(mid, P) || closestOnPoly(mid, P).d < 1e-4) continue;
    const inner = [h1.pt];
    for (let j = Math.floor(h1.s) + 1; j < h2.s; j++) if (j > h1.s) inner.push(cut[j]);
    inner.push(h2.pt);
    const mids = inner.slice(1, -1);
    const A = clean([...walk(P, h1, h2), ...mids.slice().reverse()]);
    const B = clean([...walk(P, h2, h1), ...mids]);
    if (A.length >= 3 && B.length >= 3 && Math.abs(area(A)) > 0.01 && Math.abs(area(B)) > 0.01) {
      const r = Object.assign([A, B], { E: h1.pt, X: h2.pt, inner, mid });
      if (!all) return r;
      pairs.push(r);
    }
  }
  return all ? pairs : null;
}
export function splitPolygon(P, cutRaw) {
  const cut = extendEnds(cutRaw, 0.3);
  let pieces = [P];
  for (let it = 0; it < 12; it++) {
    let changed = false;
    const next = [];
    for (const Q of pieces) {
      const r = splitOnce(Q, cut);
      if (r) {
        next.push(r[0], r[1]);
        changed = true;
      } else next.push(Q);
    }
    pieces = next;
    if (!changed) break;
  }
  return pieces;
}

export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const perpL = (e) => [-e[1], e[0]];
export function bezier(pts, n = 20) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    let P = pts.slice(),
      t = i / n;
    while (P.length > 1) {
      const Q = [];
      for (let k = 0; k < P.length - 1; k++) Q.push(lerp(P[k], P[k + 1], t));
      P = Q;
    }
    out.push(P[0]);
  }
  return out;
}
