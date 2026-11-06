// Design operation: split panels along a drawn line or curve, keeping stitches in sync.
import { TINTS } from '../config.js';
import {
  centroid,
  closestOnPoly,
  extendEnds,
  mul,
  norm,
  pip,
  splitOnce,
  splitPolygon,
  sub,
} from '../geometry.js';
import { markPts, markRef } from '../model/marks.js';
import { panelPts, translatePanel, uniqueName } from '../model/panels.js';
import { cutPanel } from '../model/stitches.js';
import { app, getMark, pushHistory, restore } from '../state.js';
import { renderAll } from '../ui/inspector.js';
import { toast } from '../ui/toast.js';
import { setTool } from '../ui/tools.js';

export function resolveCut() {
  let m = null;
  if (app.sel && app.sel.kind === 'mark') {
    const x = getMark(app.sel.id);
    if (x && x.type !== 'point') m = x;
  }
  if (!m && app.sel && app.sel.kind === 'panel') {
    const c = app.state.marks.filter((x) => x.type !== 'point' && x.panelId === app.sel.id);
    if (c.length === 1) m = c[0];
  }
  if (!m) {
    const c = app.state.marks.filter((x) => x.type !== 'point');
    if (c.length === 1) m = c[0];
  }
  return m;
}
export function splitTargets(m) {
  const cut = markPts(m);
  return app.state.panels
    .map((p) => ({ p, pieces: splitPolygon(panelPts(p), cut) }))
    .filter((r) => r.pieces.length > 1);
}
export function doSplit() {
  const m = resolveCut();
  if (!m) {
    toast('Draw a line or curve across a panel first, then select it.', true);
    return;
  }
  const T = splitTargets(m);
  if (!T.length) {
    toast(`${m.label} doesn't cross a panel edge twice. Extend it past both edges.`, true);
    return;
  }
  pushHistory();
  const cutRaw = markPts(m),
    cut = extendEnds(cutRaw, 0.3),
    isCurve = m.type === 'curve',
    made = [],
    stBefore = app.state.stitches.length;
  app.state.marks = app.state.marks.filter((x) => x.id !== m.id);
  for (const { p } of T) {
    if (!app.state.panels.includes(p)) continue;
    const base = p.name,
      origId = p.id;
    let pieces = [p];
    // every inside stretch of the cut is found once on the original outline, then applied to the piece that holds it
    for (const c of splitOnce(panelPts(p), cut, true)) {
      const q = pieces.find((x) => {
        const P = panelPts(x);
        return pip(c.mid, P) && closestOnPoly(c.mid, P).d > 1e-4;
      });
      if (!q) continue;
      const r = cutPanel(q, c, isCurve);
      if (r) pieces.splice(pieces.indexOf(q), 1, ...r);
    }
    if (pieces.length < 2) continue;
    pieces.forEach((q, k) => {
      q.name = uniqueName(`${base}_${'abcdefghijkl'[k] || k}`, q);
      q.tint = k === 0 ? p.tint : app.tintN++ % TINTS.length;
    });
    app.state.marks.forEach((x) => {
      if (x.panelId !== origId) return;
      const r = markRef(x);
      let tgt = pieces.find((q) => pip(r, panelPts(q)));
      if (!tgt) {
        let bd = Infinity;
        pieces.forEach((q) => {
          const d = closestOnPoly(r, panelPts(q)).d;
          if (d < bd) {
            bd = d;
            tgt = q;
          }
        });
      }
      x.panelId = tgt.id;
    });
    pieces.forEach((q) => {
      const c = centroid(panelPts(q)),
        near = closestOnPoly(c, cutRaw, false);
      translatePanel(q, mul(norm(sub(c, near.pt)), 0.8));
    });
    made.push({ base, n: pieces.length, first: pieces[0].id });
  }
  if (!made.length) {
    restore(app.undoStack.pop());
    toast('The cut could not split any panel.', true);
    renderAll();
    return;
  }
  app.sel = { kind: 'panel', id: made[0].first };
  setTool('select');
  renderAll();
  toast(
    `Split ${made.map((x) => x.base).join(', ')} into ${made.reduce((a, x) => a + x.n, 0)} pieces. Stitches: ${stBefore} → ${app.state.stitches.length}. Save to update the specification.`,
  );
}
