// Toolbox: active tool and drawing drafts.
import { dist, pathLen } from '../geometry.js';
import { addMark } from '../model/marks.js';
import { app, pushHistory } from '../state.js';
import { $, svg } from './dom.js';
import { renderAll } from './inspector.js';
import { render } from './render.js';

export const HINTS = {
  select:
    'Click a panel to select it, drag to move it on the layout. Click a line to choose it as the cut. Drag empty space to pan.',
  pan: 'Drag to pan. Scroll or pinch to zoom.',
  point: 'Click to place a point. Points snap to panel vertices and edges.',
  line: 'Click a start point, then an end point. Draw across the panel edges to make a cut. Shift locks to 45°.',
  curve: 'Click to add points along the curve. Double-click or press Enter to finish. Esc cancels.',
  erase: 'Click a point or line to delete it.',
  dart: 'Click inside a panel to place the dart apex, then click toward the edge where the dart opens. Esc cancels.',
};
export function setTool(t) {
  app.tool = t;
  app.draft = null;
  app.snapInfo = null;
  document.querySelectorAll('.tool').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === t));
  svg.className.baseVal = ['point', 'line', 'curve', 'dart'].includes(t)
    ? 'draw'
    : t === 'pan'
      ? 'pan'
      : t === 'erase'
        ? 'erase'
        : '';
  $('#hint').textContent = HINTS[t];
  render();
}

export function finishDraft(extra) {
  if (!app.draft) return;
  let pts = app.draft.pts.slice();
  if (extra) pts.push(extra);
  pts = pts.filter((p, i) => !i || dist(p, pts[i - 1]) > 1e-4);
  const type = app.draft.type;
  app.draft = null;
  if (pts.length < 2 || pathLen(pts) < 0.2) {
    render();
    return;
  }
  pushHistory();
  const m = addMark(type, pts);
  app.sel = { kind: 'mark', id: m.id };
  renderAll();
}
