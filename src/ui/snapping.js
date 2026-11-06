// Snapping of drawn points to marks, panel vertices and edges.
import { add, closestOnPoly, dist, len, sub } from '../geometry.js';
import { panelPts } from '../model/panels.js';
import { app } from '../state.js';

export function snap(w, excludeId) {
  const tol = 12 / app.view.s;
  let best = null;
  const consider = (pt, kind) => {
    const d = dist(w, pt);
    if (d < tol && (!best || d < best.d)) best = { pt, d, kind };
  };
  for (const m of app.state.marks) {
    if (m.id === excludeId) continue;
    consider(m.pts[0], 'point');
    if (m.type !== 'point') consider(m.pts[m.pts.length - 1], 'point');
  }
  if (best) return best;
  for (const p of app.state.panels) for (const e of p.edges) consider(e.a, 'corner');
  if (best) return best;
  for (const p of app.state.panels) {
    const c = closestOnPoly(w, panelPts(p));
    if (c.d < tol && (!best || c.d < best.d)) best = { pt: c.pt, d: c.d, kind: 'edge' };
  }
  return best;
}
export function constrain(from, w) {
  const v = sub(w, from),
    a = Math.atan2(v[1], v[0]),
    st = Math.PI / 4,
    ra = Math.round(a / st) * st,
    l = len(v);
  return add(from, [Math.cos(ra) * l, Math.sin(ra) * l]);
}
export function placePoint(w, e) {
  if (e && e.shiftKey && app.draft && app.draft.pts.length)
    return constrain(app.draft.pts[app.draft.pts.length - 1], w);
  const s = snap(w);
  return s ? s.pt : w;
}
