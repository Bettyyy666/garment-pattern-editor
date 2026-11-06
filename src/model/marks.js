// User-drawn points, lines and curves ("marks") that design operations consume.
import { closestOnPoly, crSample, pip, pointAtFrac } from '../geometry.js';
import { panelPts } from './panels.js';
import { app, nid } from '../state.js';

export const markPts = (m) => (m.type === 'curve' ? crSample(m.pts, 12) : m.pts);
export const markRef = (m) => (m.type === 'point' ? m.pts[0] : pointAtFrac(markPts(m), 0.5));
export function addMark(type, pts, label) {
  const m = {
    id: nid('m'),
    type,
    pts,
    label:
      label ||
      (type === 'point' ? 'Point ' : type === 'line' ? 'Line ' : 'Curve ') +
        (app.state.marks.filter((x) => x.type === type).length + 1),
  };
  m.panelId = findPanelFor(m);
  app.state.marks.push(m);
  return m;
}
export function findPanelFor(m) {
  const r = markRef(m);
  for (let i = app.state.panels.length - 1; i >= 0; i--)
    if (pip(r, panelPts(app.state.panels[i]))) return app.state.panels[i].id;
  let best = null;
  for (const p of app.state.panels) {
    const c = closestOnPoly(r, panelPts(p));
    if (!best || c.d < best.d) best = { d: c.d, id: p.id };
  }
  return best && best.d < 2 ? best.id : null;
}
export function moveMarksOf(pid, fn) {
  app.state.marks.forEach((m) => {
    if (m.panelId === pid) m.pts = m.pts.map(fn);
  });
}
