// Add a dart: an intrinsic-dart cone point at the selected point mark, cut toward the nearest panel edge.
// Only stores and shows the dart; the boundary is not re-optimised yet.
import { pip } from '../geometry.js';
import { nearestBoundary, rayCut } from '../model/intrinsic.js';
import { panelPts } from '../model/panels.js';
import { app, getMark, getPanel, nid, pushHistory } from '../state.js';
import { renderAll } from '../ui/inspector.js';
import { openDart } from '../ui/dart-view.js';
import { toast } from '../ui/toast.js';

export const DART_DEFECT_DEG = 20;

export function resolveDart() {
  const m = app.sel && app.sel.kind === 'mark' && getMark(app.sel.id);
  if (!m || m.type !== 'point')
    return { err: 'Place a point inside a panel and select it to add a dart there.' };
  const p = m.panelId && getPanel(m.panelId),
    at = m.pts[0],
    V = p && panelPts(p);
  if (!p || !pip(at, V)) return { err: 'The selected point is not inside a panel.' };
  const q = nearestBoundary(V, at).q,
    cut = Math.atan2(q[1] - at[1], q[0] - at[0]);
  if (!rayCut(V, at, cut)) return { err: 'The selected point is too close to the panel edge.' };
  return { m, p, at, cut };
}

export function addDart() {
  const r = resolveDart();
  if (r.err) {
    toast(r.err, true);
    return;
  }
  pushHistory();
  if (!r.p.darts) r.p.darts = [];
  r.p.darts.push({ id: nid('d'), at: r.at.slice(), defect: (DART_DEFECT_DEG * Math.PI) / 180, cut: r.cut });
  app.state.marks = app.state.marks.filter((x) => x !== r.m);
  app.sel = { kind: 'panel', id: r.p.id };
  renderAll();
  openDart(r.p.id, r.p.darts.at(-1).id);
  toast(
    `Added a ${DART_DEFECT_DEG}° dart to ${r.p.name}. Edit its angle and cut direction in the inspector.`,
  );
}
