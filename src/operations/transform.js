// Design operations: mirror, rotate, duplicate, delete.
import { TINTS } from '../config.js';
import { add, centroid } from '../geometry.js';
import { edgeMap, edgeRev } from '../model/edges.js';
import { moveMarksOf } from '../model/marks.js';
import { bbox, panelPts, uniqueName } from '../model/panels.js';
import { app, getPanel, nid, pushHistory } from '../state.js';
import { renderAll } from '../ui/inspector.js';

export function transformPanel(fn, reflect) {
  const p = app.sel && app.sel.kind === 'panel' && getPanel(app.sel.id);
  if (!p) return;
  pushHistory();
  const c = centroid(panelPts(p));
  p.edges = p.edges.map((e) => edgeMap(e, (q) => fn(q, c), reflect));
  if (reflect) p.edges = p.edges.reverse().map(edgeRev);
  (p.darts || []).forEach((t) => {
    const a = fn(t.at, c),
      b = fn(add(t.at, [Math.cos(t.cut), Math.sin(t.cut)]), c);
    t.at = a;
    t.cut = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (reflect && t.legs) t.legs = t.legs.slice().reverse(); // the loop runs the other way now
  });
  moveMarksOf(p.id, (q) => fn(q, c));
  renderAll();
}
export const mirror = () => transformPanel((q, c) => [2 * c[0] - q[0], q[1]], true);
export const rotate = () => transformPanel((q, c) => [c[0] - (q[1] - c[1]), c[1] + (q[0] - c[0])], false);
export function duplicate() {
  const p = app.sel && app.sel.kind === 'panel' && getPanel(app.sel.id);
  if (!p) return;
  pushHistory();
  const b = bbox([panelPts(p)]),
    off = [b.x1 - b.x0 + 4, 0];
  const q = {
    id: nid('p'),
    name: uniqueName(p.name + '_copy'),
    edges: p.edges.map((e) => ({ ...edgeMap(e, (v) => add(v, off)), eid: nid('e') })),
    darts: [],
    tint: app.tintN++ % TINTS.length,
    place: { ...p.place },
    label: p.label,
  };
  const eidOf = new Map(p.edges.map((e, i) => [e.eid, q.edges[i].eid]));
  q.darts = (p.darts || []).map((t) => ({
    ...t,
    id: nid('d'),
    at: add(t.at, off),
    ...(t.legs ? { legs: t.legs.map((e) => eidOf.get(e)) } : {}),
  }));
  app.state.panels.push(q);
  app.sel = { kind: 'panel', id: q.id };
  renderAll();
}
export function delSel() {
  if (!app.sel) return;
  pushHistory();
  if (app.sel.kind === 'panel') {
    const p = getPanel(app.sel.id);
    if (p) {
      const ids = new Set(p.edges.map((e) => e.eid));
      app.state.stitches = app.state.stitches.filter((s) => !s.e.some((e) => ids.has(e)));
    }
    app.state.panels = app.state.panels.filter((x) => x.id !== app.sel.id);
    app.state.marks = app.state.marks.filter((m) => m.panelId !== app.sel.id);
  } else app.state.marks = app.state.marks.filter((m) => m.id !== app.sel.id);
  app.sel = null;
  renderAll();
}
