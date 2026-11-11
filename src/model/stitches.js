// Stitches ({ sid, e: [eidA, eidB], cut? }) and the edge-level cut that keeps them consistent.
import { VEPS } from '../config.js';
import { area, dist, pip } from '../geometry.js';
import { edgeLen, edgeRev, edgeSplit, fitCubic, fracAtParam, paramAtFrac, paramAtPoint } from './edges.js';
import { panelPts } from './panels.js';
import { app, nid } from '../state.js';

export function edgeIndex() {
  const M = new Map();
  app.state.panels.forEach((p) => p.edges.forEach((e, i) => M.set(e.eid, { p, i, e })));
  return M;
}
export function findEdge(eid) {
  for (const p of app.state.panels) {
    const i = p.edges.findIndex((e) => e.eid === eid);
    if (i >= 0) return { p, i, e: p.edges[i] };
  }
  return null;
}
// Make sure panel p has a vertex at P. Splitting an edge also splits every edge stitched to it at the matching
// arc-length fraction (stitched edges run in opposite directions in GarmentCode) and rewires the stitch.
export function insertVertex(p, P) {
  let best = null;
  p.edges.forEach((e, i) => {
    const r = paramAtPoint(e, P);
    if (!best || r.d < best.d) best = { i, ...r };
  });
  const e = p.edges[best.i],
    L = edgeLen(e),
    f = fracAtParam(e, best.t);
  if (f * L < VEPS || (1 - f) * L < VEPS) return;
  const [A, B] = edgeSplit(e, best.t);
  p.edges.splice(best.i, 1, A, B);
  const touched = app.state.stitches.filter((s) => s.e.includes(e.eid));
  app.state.stitches = app.state.stitches.filter((s) => !s.e.includes(e.eid));
  for (const st of touched) {
    const side = st.e.indexOf(e.eid),
      partner = st.e[1 - side],
      loc = findEdge(partner);
    if (!loc) continue;
    const [Y1, Y2] = edgeSplit(loc.e, paramAtFrac(loc.e, 1 - f));
    loc.p.edges.splice(loc.i, 1, Y1, Y2);
    const s1 = { sid: nid('s'), e: [] },
      s2 = { sid: nid('s'), e: [] };
    s1.e[side] = A.eid;
    s1.e[1 - side] = Y2.eid;
    s2.e[side] = B.eid;
    s2.e[1 - side] = Y1.eid;
    if (st.cut) {
      s1.cut = s2.cut = true;
    }
    app.state.stitches.push(s1, s2);
  }
}
export function cutPanel(q, c, isCurve) {
  insertVertex(q, c.E);
  insertVertex(q, c.X);
  const vi = (P) => {
    let bi = 0,
      bd = Infinity;
    q.edges.forEach((e, i) => {
      const d = dist(e.a, P);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    return bi;
  };
  const iE = vi(c.E),
    iX = vi(c.X);
  if (iE === iX) return null;
  const n = q.edges.length;
  const seq = (i, j) => {
    const o = [];
    for (let k = i; k !== j; k = (k + 1) % n) o.push(q.edges[k]);
    return o;
  };
  const inner = c.inner.slice();
  inner[0] = q.edges[iE].a;
  inner[inner.length - 1] = q.edges[iX].a;
  const g = isCurve ? fitCubic(inner) : { k: 'line', a: inner[0], b: inner[inner.length - 1] };
  const cutB = { ...g, eid: nid('e') },
    cutA = { ...edgeRev(g), eid: nid('e') };
  const mk = (edges) => ({
    id: nid('p'),
    name: q.name,
    edges,
    tint: q.tint,
    place: { ...q.place },
    label: q.label || null,
    src: q.src || q.id,
  });
  const A = mk([...seq(iE, iX), cutA]),
    B = mk([...seq(iX, iE), cutB]);
  if (Math.abs(area(panelPts(A))) < 0.05 || Math.abs(area(panelPts(B))) < 0.05) return null;
  // A stitched dart goes with its legs; a free cone point with the piece that contains it.
  const inA = new Set(A.edges.map((e) => e.eid));
  A.darts = (q.darts || []).filter((d) => (d.legs ? inA.has(d.legs[0]) : pip(d.at, panelPts(A))));
  B.darts = (q.darts || []).filter((d) => !A.darts.includes(d));
  app.state.panels.splice(app.state.panels.indexOf(q), 1, A, B);
  app.state.stitches.push({ sid: nid('s'), e: [cutA.eid, cutB.eid], cut: true });
  return [A, B];
}
