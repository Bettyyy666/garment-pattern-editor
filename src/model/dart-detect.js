// Darts written as GarmentCode same-panel stitches: two adjacent edges of one panel stitched together are the
// dart legs, their shared vertex is the apex. Reads apex, Ω (wedge angle) and cut direction from coordinates and
// closes the darts to give intrinsic-dart's reference outline. Pure: no DOM.
import { add, len, norm, sub } from '../geometry.js';

// Darts of panel p found among `stitches` ({ e: [eidA, eidB] }), in canvas coordinates:
// { legs: [eid of leg into the apex, eid of leg out of it], at: apex, defect: Ω (rad), cut: bisector angle }.
export function stitchedDarts(p, stitches) {
  const n = p.edges.length,
    pos = new Map(p.edges.map((e, i) => [e.eid, i])),
    out = [];
  for (const st of stitches) {
    const [i, j] = st.e.map((e) => pos.get(e));
    if (i === undefined || j === undefined) continue;
    // Adjacent in loop order: the first leg ends at the apex, the second starts there.
    const [a, b] = (i + 1) % n === j ? [i, j] : (j + 1) % n === i ? [j, i] : [-1, -1];
    if (a < 0) continue;
    const ea = p.edges[a],
      eb = p.edges[b],
      at = ea.b,
      u = sub(ea.a, at),
      v = sub(eb.b, at);
    if (len(u) < 1e-9 || len(v) < 1e-9) continue;
    const nu = norm(u),
      nv = norm(v),
      defect = Math.acos(Math.max(-1, Math.min(1, nu[0] * nv[0] + nu[1] * nv[1]))),
      bis = add(nu, nv);
    if (defect < 1e-6) continue;
    out.push({ legs: [ea.eid, eb.eid], at: at.slice(), defect, cut: Math.atan2(bis[1], bis[0]) });
  }
  return out;
}

// Panel edges with every stitched dart closed: its two legs become one straight mouth edge. Each edge carries
// `src`, the index of the panel edge it came from, or `dart`, the index (in p.darts) of the dart it closes, and
// `from`, the panel edge (its first leg) whose start vertex it starts at.
export function closedEdges(p) {
  const n = p.edges.length,
    pos = new Map(p.edges.map((e, i) => [e.eid, i])),
    mouthAt = new Map(),
    skip = new Set();
  (p.darts || []).forEach((d, k) => {
    if (!d.legs) return;
    const [a, b] = d.legs.map((e) => pos.get(e));
    if (a === undefined || b === undefined || (a + 1) % n !== b) return;
    mouthAt.set(a, k);
    skip.add(b);
  });
  const out = [];
  p.edges.forEach((e, i) => {
    if (skip.has(i)) return;
    if (mouthAt.has(i)) {
      out.push({ k: 'line', a: e.a, b: p.edges[(i + 1) % n].b, dart: mouthAt.get(i), from: i });
    } else out.push({ ...e, src: i, from: i });
  });
  return out;
}
