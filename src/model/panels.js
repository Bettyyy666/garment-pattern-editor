// Panel model: { id, name, edges, tint, place, label }. `place` keeps the GarmentCode frame
// (translation, rotation) plus a 2D layout offset (ox, oy) so moving panels on the canvas never changes 3D placement.
import { TINTS } from '../config.js';
import { add, clean, dist, mul, sub } from '../geometry.js';
import { arcSpan, edgeMap, edgeSample } from './edges.js';
import { addMark, moveMarksOf } from './marks.js';
import { TEMPLATES } from './templates.js';
import { app, nid, snapshot } from '../state.js';
import { f3 } from '../util.js';

export function panelPts(p) {
  const o = [];
  for (const e of p.edges) o.push(...edgeSample(e).slice(0, -1));
  return clean(o);
}
export const P2 = (q) => `${f3(q[0])} ${f3(q[1])}`;
export function dPanel(p) {
  let d = 'M' + P2(p.edges[0].a);
  for (const e of p.edges) {
    if (e.k === 'quad') d += `Q${P2(e.c1)} ${P2(e.b)}`;
    else if (e.k === 'cubic') d += `C${P2(e.c1)} ${P2(e.c2)} ${P2(e.b)}`;
    else if (e.k === 'arc') {
      const sp = arcSpan(e)[1];
      d += `A${f3(e.r)} ${f3(e.r)} 0 ${Math.abs(sp) > Math.PI ? 1 : 0} ${e.ccw ? 1 : 0} ${P2(e.b)}`;
    } else d += 'L' + P2(e.b);
  }
  return d + 'Z';
}
export function defaultPlace(edges) {
  const b = bbox([edges.map((e) => e.a)]);
  return { t: [b.x0, -b.y1, 0], rot: [0, 0, 0], ox: 0, oy: 0 };
}
export function translatePanel(p, d) {
  p.edges = p.edges.map((e) => edgeMap(e, (q) => add(q, d)));
  p.place.ox += d[0];
  p.place.oy += d[1];
  moveMarksOf(p.id, (q) => add(q, d));
}
export function fromLocal(pl, v) {
  const rz = ((pl.rot[2] || 0) * Math.PI) / 180,
    c = Math.cos(rz),
    s = Math.sin(rz);
  return [c * v[0] - s * v[1] + pl.t[0] + pl.ox, -(s * v[0] + c * v[1] + pl.t[1]) + pl.oy];
}
export function toLocal(pl, w) {
  const q = [w[0] - pl.ox - pl.t[0], -(w[1] - pl.oy) - pl.t[1]],
    rz = (-(pl.rot[2] || 0) * Math.PI) / 180,
    c = Math.cos(rz),
    s = Math.sin(rz);
  return [c * q[0] - s * q[1], s * q[0] + c * q[1]];
}
export function lineEdges(pts) {
  return pts.map((a, i) => ({ eid: nid('e'), k: 'line', a, b: pts[(i + 1) % pts.length] }));
}
export function uniqueName(base, self) {
  const names = new Set(app.state.panels.filter((p) => p !== self).map((p) => p.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(base + '_' + i)) i++;
  return base + '_' + i;
}
export function bbox(Ps) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const P of Ps)
    for (const p of P) {
      x0 = Math.min(x0, p[0]);
      y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]);
      y1 = Math.max(y1, p[1]);
    }
  return { x0, y0, x1, y1 };
}
export const allBox = () => bbox(app.state.panels.map(panelPts));
export function buildEdges(shape, at) {
  const E = [];
  let cur;
  for (const [k, v] of shape) {
    if (k === 'M') {
      cur = v;
      continue;
    }
    if (k === 'L') {
      E.push({ k: 'line', a: cur, b: v });
      cur = v;
      continue;
    }
    const P = [cur, ...v];
    for (let i = 0; i < P.length - 1; i++) {
      const p1 = P[i],
        p2 = P[i + 1],
        p0 = i ? P[i - 1] : sub(mul(p1, 2), p2),
        p3 = i + 2 < P.length ? P[i + 2] : sub(mul(p2, 2), p1);
      E.push({
        k: 'cubic',
        a: p1,
        b: p2,
        c1: add(p1, mul(sub(p2, p0), 1 / 6)),
        c2: sub(p2, mul(sub(p3, p1), 1 / 6)),
      });
    }
    cur = v[v.length - 1];
  }
  if (dist(cur, shape[0][1]) > 1e-9) E.push({ k: 'line', a: cur, b: shape[0][1] });
  return E.map((e) => edgeMap({ ...e, eid: nid('e') }, (q) => add(q, at)));
}
export function addTemplate(key, at) {
  const t = TEMPLATES[key];
  if (!at) {
    const b = app.state.panels.length ? allBox() : { x1: -6, y0: 0 };
    at = [b.x1 + 6, b.y0];
  }
  const edges = buildEdges(t.spec, at);
  const p = {
    id: nid('p'),
    name: uniqueName(t.name),
    edges,
    tint: app.tintN++ % TINTS.length,
    place: defaultPlace(edges),
    label: null,
  };
  app.state.panels.push(p);
  return p;
}
export function loadSample() {
  app.state = { panels: [], marks: [], stitches: [] };
  app.underlay = null;
  app.uid = 1;
  app.tintN = 0;
  app.sel = null;
  app.draft = null;
  addTemplate('front', [0, 0]);
  addTemplate('back', [32, 0]);
  const m = addMark(
    'curve',
    [
      [20.9, 12.4],
      [16.6, 17.6],
      [13.1, 23],
      [11.5, 27.7],
    ],
    'Princess line',
  );
  app.sel = { kind: 'mark', id: m.id };
  app.spec = {
    name: 'specification.json',
    version: 0,
    savedAt: null,
    text: '',
    snap: snapshot(),
    extra: null,
  };
}
