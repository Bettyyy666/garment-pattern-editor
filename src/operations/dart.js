// Add a dart (intrinsic-dart cone point with the demo's default settings): from a selected point (cut toward the
// nearest edge), from a selected line (apex at its start, cut toward its end), or with the Insert dart tool.
// The dart's opening is solved for the 2D and 3D views; the solver view only opens on request.
import { dist, pip } from '../geometry.js';
import { nearestBoundary, rayCut } from '../model/intrinsic.js';
import { panelPts } from '../model/panels.js';
import { app, getMark, nid, pushHistory } from '../state.js';
import { renderAll } from '../ui/inspector.js';
import { openSection } from '../ui/sections.js';
import { toast } from '../ui/toast.js';

export const DART_DEFECT_DEG = 20;

// Input for Add dart: the selected point or line mark, its panel, the apex and the cut angle.
export function resolveDart() {
  const m = app.sel && app.sel.kind === 'mark' && getMark(app.sel.id);
  if (!m || (m.type !== 'point' && m.type !== 'line'))
    return {
      err: 'Select a point inside a panel, or a line drawn from the dart apex to the panel edge, to add a dart.',
    };
  const at = m.pts[0],
    p = [...app.state.panels].reverse().find((q) => pip(at, panelPts(q)));
  if (!p)
    return {
      err:
        m.type === 'line'
          ? 'The line must start inside a panel: its start point is the dart apex.'
          : 'The selected point is not inside a panel.',
    };
  const V = panelPts(p);
  let cut;
  if (m.type === 'line') {
    const end = m.pts[m.pts.length - 1];
    if (dist(end, at) < 1e-6) return { err: 'The line is too short to set the cut direction.' };
    cut = Math.atan2(end[1] - at[1], end[0] - at[0]);
  } else {
    const q = nearestBoundary(V, at).q;
    cut = Math.atan2(q[1] - at[1], q[0] - at[0]);
  }
  if (!rayCut(V, at, cut)) return { err: 'The dart apex is too close to the panel edge.' };
  return { m, p, at, cut, fromLine: m.type === 'line' };
}

// Add a dart with default settings to panel p and select it for editing in Selection > Darts.
function placeDart(p, at, cut) {
  pushHistory();
  if (!p.darts) p.darts = [];
  const d = { id: nid('d'), at: at.slice(), defect: (DART_DEFECT_DEG * Math.PI) / 180, cut };
  p.darts.push(d);
  app.sel = { kind: 'panel', id: p.id };
  app.dartSel = d.id;
  openSection('Selection');
  return d;
}

export function addDart() {
  const r = resolveDart();
  if (r.err) {
    toast(r.err, true);
    return;
  }
  placeDart(r.p, r.at, r.cut);
  app.state.marks = app.state.marks.filter((x) => x !== r.m);
  app.sel = { kind: 'panel', id: r.p.id };
  renderAll();
  toast(`Added a ${DART_DEFECT_DEG}° dart to ${r.p.name}. Adjust the opening under Selection › Darts.`);
}

// Dart tool (ui/pointer.js): a dart with its apex at `at` and its cut toward `toward`, ending on the boundary.
// Returns an error message, or null once the dart is added and selected for editing in the Darts section.
export function insertDart(p, at, toward) {
  const V = panelPts(p);
  if (!pip(at, V)) return 'Place the dart apex inside a panel.';
  const cut = Math.atan2(toward[1] - at[1], toward[0] - at[0]);
  if (!(dist(toward, at) > 1e-6) || !rayCut(V, at, cut))
    return 'The cut must run from the apex to the panel edge.';
  placeDart(p, at, cut);
  renderAll();
  toast(`Added a ${DART_DEFECT_DEG}° dart to ${p.name}. Adjust the opening under Selection › Darts.`);
  return null;
}

// Delete dart d of panel p (Erase tool on its apex in 2D or 3D, or the Darts block's Delete button). A sewn dart's
// stitched legs stay in the pattern; only the cone dart goes.
export function deleteDart(p, d) {
  pushHistory();
  p.darts = p.darts.filter((x) => x !== d);
  if (app.dartSel === d.id) app.dartSel = null;
  renderAll();
  toast(`Deleted a ${((d.defect * 180) / Math.PI).toFixed(0)}° dart from ${p.name}.`);
}

// Move dart d (apex and cut together, cut angle kept) to apex `at` while dragging it in 2D or 3D. The apex must stay
// inside the panel with its cut still reaching the edge; otherwise it stays at its last valid position. Returns
// whether it moved. The caller re-renders and records one undo step for the whole drag.
export function moveDartTo(p, d, at) {
  const V = panelPts(p);
  if (!pip(at, V) || !rayCut(V, at, d.cut)) return false;
  d.at = at;
  return true;
}
