// Intrinsic panel shape, after intrinsic-dart (github.com/panangam/intrinsic-dart): a boundary is edge lengths
// plus signed turning angles at the vertices, and a dart is a cone point { at, defect, cut }. Pure, no DOM.
//
// Ported from intrinsic-dart:
//   turningAngles  <- geometry2d.turning_angles
//   nearestBoundary<- geometry2d.nearest_boundary
//   rayCut         <- cone_dart.geometry.ray_cut
//   developLoop    <- the direction accumulation and closure correction in cone_dart.development.develop
//
// Conventions: canvas cm, y down. turn[i] is the signed exterior angle at vertex i, between edge i-1 and edge i,
// atan2(cross, dot) evaluated in canvas coordinates (positive = clockwise on screen). The winding is kept as is,
// unlike the Python code, which normalises to CCW. turn[0] is not used for reconstruction: the start direction
// `dir` and closure fix it, as in develop().
import { pip } from '../geometry.js';

const cross = (a, b) => a[0] * b[1] - a[1] * b[0],
  dotp = (a, b) => a[0] * b[0] + a[1] * b[1],
  sub = (a, b) => [a[0] - b[0], a[1] - b[1]],
  hyp = (a) => Math.hypot(a[0], a[1]);

export function turningAngles(V) {
  const n = V.length;
  return V.map((v, i) => {
    const prev = sub(v, V[(i - 1 + n) % n]),
      next = sub(V[(i + 1) % n], v);
    return Math.atan2(cross(prev, next), dotp(prev, next));
  });
}

// Chord-relative curvature, so edges keep their shape when their length or direction changes.
function relPt(c, a, b) {
  const E = sub(b, a),
    L2 = dotp(E, E) || 1,
    d = sub(c, a);
  return [dotp(d, E) / L2, cross(E, d) / L2];
}
function absPt(r, a, b) {
  const E = sub(b, a);
  return [a[0] + E[0] * r[0] - E[1] * r[1], a[1] + E[1] * r[0] + E[0] * r[1]];
}
function edgeCurve(e) {
  if (e.k === 'quad') return { k: 'quad', c: [relPt(e.c1, e.a, e.b)] };
  if (e.k === 'cubic') return { k: 'cubic', c: [relPt(e.c1, e.a, e.b), relPt(e.c2, e.a, e.b)] };
  if (e.k === 'arc') {
    const L = hyp(sub(e.b, e.a)) || 1,
      m = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
    return { k: 'arc', rr: e.r / L, side: cross(sub(e.b, e.a), sub(e.ctr, m)) >= 0 ? 1 : -1, ccw: !!e.ccw };
  }
  return null;
}
function applyCurve(e, cv) {
  if (!cv) return e;
  if (cv.k === 'quad') return { ...e, k: 'quad', c1: absPt(cv.c[0], e.a, e.b) };
  if (cv.k === 'cubic')
    return { ...e, k: 'cubic', c1: absPt(cv.c[0], e.a, e.b), c2: absPt(cv.c[1], e.a, e.b) };
  const E = sub(e.b, e.a),
    L = hyp(E),
    r = Math.max(cv.rr * L, L / 2),
    h = Math.sqrt(Math.max(0, r * r - (L * L) / 4)) / (L || 1),
    m = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
  return { ...e, k: 'arc', r, ccw: cv.ccw, ctr: [m[0] - E[1] * h * cv.side, m[1] + E[0] * h * cv.side] };
}

// Edge loop -> { start, dir, len, turn, curve }.
export function shapeFromEdges(edges) {
  const V = edges.map((e) => e.a),
    e0 = sub(edges[0].b, edges[0].a);
  return {
    start: V[0].slice(),
    dir: Math.atan2(e0[1], e0[0]),
    len: edges.map((e) => hyp(sub(e.b, e.a))),
    turn: turningAngles(V),
    curve: edges.map(edgeCurve),
  };
}

// Lengths + turns -> closed polygon. Directions accumulate the turns from `dir`; the lengths are then corrected
// by the smallest change, weighted by 1/reference length, that closes the loop: minimise
// sum((x - l)^2 / l) / 2 subject to sum(x_i * d_i) = 0 (develop() with zero defect). Edges listed in `fixed`
// get a near-zero weight so they keep their length.
export function developLoop(shape, fixed = []) {
  const n = shape.len.length,
    ang = [shape.dir];
  for (let i = 1; i < n; i++) ang.push(ang[i - 1] + shape.turn[i]);
  const D = ang.map((t) => [Math.cos(t), Math.sin(t)]),
    R = shape.len.map((l, i) => (fixed.includes(i) ? l * 1e-9 : l));
  let g00 = 0,
    g01 = 0,
    g11 = 0,
    z0 = 0,
    z1 = 0;
  D.forEach((d, i) => {
    g00 += R[i] * d[0] * d[0];
    g01 += R[i] * d[0] * d[1];
    g11 += R[i] * d[1] * d[1];
    z0 += shape.len[i] * d[0];
    z1 += shape.len[i] * d[1];
  });
  const det = g00 * g11 - g01 * g01;
  if (!(det > 1e-12 * (g00 + g11) ** 2)) throw new Error('Edge directions are ill-conditioned for closure.');
  const y0 = (-z0 * g11 + z1 * g01) / det,
    y1 = (z0 * g01 - z1 * g00) / det,
    len = shape.len.map((l, i) => l + R[i] * (D[i][0] * y0 + D[i][1] * y1));
  if (len.some((l) => !(l > 0))) throw new Error('Closure needs a non-positive edge length.');
  const pts = [shape.start.slice()];
  for (let i = 0; i < n - 1; i++) pts.push([pts[i][0] + len[i] * D[i][0], pts[i][1] + len[i] * D[i][1]]);
  return { pts, len };
}

// Rebuild canvas edges from a shape, keeping each old edge's eid and label so stitches survive.
export function edgesFromShape(shape, old, fixed) {
  const { pts } = developLoop(shape, fixed),
    n = pts.length;
  return pts.map((a, i) => {
    const { eid, label } = old[i],
      e = { eid, k: 'line', a, b: pts[(i + 1) % n] };
    if (label) e.label = label;
    return applyCurve(e, shape.curve[i]);
  });
}

export function nearestBoundary(V, p) {
  let best = null;
  V.forEach((a, i) => {
    const E = sub(V[(i + 1) % V.length], a),
      t = Math.min(1, Math.max(0, dotp(sub(p, a), E) / (dotp(E, E) || 1))),
      q = [a[0] + t * E[0], a[1] + t * E[1]],
      d = hyp(sub(q, p));
    if (!best || d < best.d) best = { d, q, edge: i, t };
  });
  return best;
}

// First positive hit of the ray from p at `angle` with the polygon V: { point, edge, t, length, angle }, or null when
// p is not strictly inside or nothing is hit.
export function rayCut(V, p, angle) {
  if (!Number.isFinite(angle) || !pip(p, V) || nearestBoundary(V, p).d <= 1e-9) return null;
  const dir = [Math.cos(angle), Math.sin(angle)];
  let best = null;
  V.forEach((a, i) => {
    const E = sub(V[(i + 1) % V.length], a),
      den = cross(dir, E);
    if (Math.abs(den) <= 1e-14 * hyp(E)) return;
    const ap = sub(a, p),
      s = cross(ap, E) / den,
      t = cross(ap, dir) / den;
    if (s > 0 && t >= -1e-12 && t <= 1 + 1e-12 && (!best || s < best.length))
      best = { edge: i, t: Math.min(1, Math.max(0, t)), length: s };
  });
  if (!best) return null;
  if (best.t >= 1 - 1e-12) {
    best.edge = (best.edge + 1) % V.length;
    best.t = 0;
  } else if (best.t <= 1e-12) best.t = 0;
  best.angle = angle;
  best.point = [p[0] + best.length * dir[0], p[1] + best.length * dir[1]];
  return best;
}
