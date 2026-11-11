// Dart settings and the panel outline handed to the intrinsic-dart solver (server/dart_server.py). Samples the
// panel outline, converts canvas (y down) to the solver frame (y up, CCW), and maps locks, stored as perimeter
// fractions from vertex 0, to outline vertex indices. Pure: no DOM, no network.
import { closedEdges } from './dart-detect.js';
import { edgeAt, edgeLen, paramAtFrac } from './edges.js';

export const DART_DEFAULTS = {
  defect: (20 * Math.PI) / 180,
  angleW: 1,
  scaleW: 0.1,
  lengthW: 0,
  smooth: 0.1,
  cutMode: 'preserve',
  cutW: 0.1,
  angleLocks: [],
  scaleLocks: [],
};
export const dartSettings = (d) => {
  for (const [k, v] of Object.entries(DART_DEFAULTS))
    if (d[k] === undefined) d[k] = Array.isArray(v) ? [] : v;
  return d;
};
export const toMath = (q) => [q[0], -q[1]],
  toCanvas = (q) => [q[0], -q[1]];

const cache = new Map();
// Solver outline of a panel, with its stitched darts closed (dart-detect.js): { key, vertices (solver frame, CCW),
// frac (perimeter fraction of each vertex), seg (source of each segment i -> i+1: panel edge index, or -1 - k for
// the closed mouth of dart k), corner (outline index of each panel vertex, -1 inside a closed dart) }.
// Every outline vertex is a solver DOF, as in the demo (meshing with split_boundary=False).
export function panelOutline(p) {
  const E = closedEdges(p),
    key =
      p.id +
      JSON.stringify(E.map((e) => [e.k, e.a, e.b, e.c1, e.c2, e.ctr, e.r, e.ccw])) +
      JSON.stringify((p.darts || []).map((d) => d.legs || 0));
  if (cache.has(key)) return cache.get(key);
  const lens = E.map(edgeLen),
    per = lens.reduce((a, b) => a + b, 0),
    h = Math.min(3, Math.max(0.3, per / 120)),
    canvas = [],
    frac = [],
    src = [],
    first = [];
  let s = 0;
  E.forEach((e, i) => {
    const k = Math.max(1, Math.round(lens[i] / h));
    for (let j = 0; j < k; j++) {
      canvas.push(e.k === 'line' ? edgeAt(e, j / k) : edgeAt(e, paramAtFrac(e, j / k)));
      frac.push((s + (lens[i] * j) / k) / per);
      src.push(e.dart !== undefined ? -1 - e.dart : e.src);
      first.push(j === 0 ? e.from : -1);
    }
    s += lens[i];
  });
  let vertices = canvas.map(toMath),
    area = 0;
  vertices.forEach((a, i) => {
    const b = vertices[(i + 1) % vertices.length];
    area += a[0] * b[1] - a[1] * b[0];
  });
  const n = vertices.length,
    rev = area < 0,
    o = (r) => (rev ? (n - r) % n : r), // CCW outline index -> sampling index
    corner = p.edges.map(() => -1);
  if (rev) vertices = vertices.map((_, r) => vertices[o(r)]);
  // Segment r -> r+1 runs along the source of its first vertex, or of its second when the loop was reversed.
  const seg = vertices.map((_, r) => src[o(rev ? (r + 1) % n : r)]);
  vertices.forEach((_, r) => {
    if (first[o(r)] >= 0) corner[first[o(r)]] = r;
  });
  const out = { key, vertices, frac: vertices.map((_, r) => frac[o(r)]), seg, corner };
  cache.set(key, out);
  if (cache.size > 16) cache.delete(cache.keys().next().value);
  return out;
}

export function fracToIndex(frac, f) {
  let best = -1,
    bd = Infinity;
  frac.forEach((g, i) => {
    const d = Math.min(Math.abs(g - f), 1 - Math.abs(g - f));
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}
