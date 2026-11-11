// Pointer input on the canvas: select, drag, draw, pan, pinch, wheel zoom.
import { dist, len, sub } from '../geometry.js';
import { addMark, findPanelFor } from '../model/marks.js';
import { translatePanel } from '../model/panels.js';
import { app, getMark, getPanel, pushHistory, snapshot } from '../state.js';
import { $, svg } from './dom.js';
import { renderAll, renderInspector } from './inspector.js';
import { render } from './render.js';
import { placePoint, snap } from './snapping.js';
import { toast } from './toast.js';
import { finishDraft } from './tools.js';
import { insertDart } from '../operations/dart.js';
import { rect, toWorld, zoomAt } from './viewport.js';

export const pointers = new Map();
export function pinchState() {
  const [a, b] = [...pointers.values()];
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
}
export function endPointer(e) {
  pointers.delete(e.pointerId);
  if (app.drag && app.drag.mode === 'pinch') {
    if (pointers.size < 2) app.drag = null;
    return;
  }
  if (app.drag && (app.drag.mode === 'panel' || app.drag.mode === 'mark') && app.drag.moved) {
    app.undoStack.push(app.drag.snap);
    app.redoStack = [];
    if (app.drag.mode === 'mark') {
      const m = getMark(app.drag.id);
      m.panelId = findPanelFor(m);
    }
    renderInspector();
  }
  app.drag = null;
  svg.classList.remove('panning');
}

export function initPointer() {
  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      app.drag = { mode: 'pinch', start: pinchState(), view: { ...app.view } };
      return;
    }
    const w = toWorld(e);
    app.lastEvt = e;
    if (e.button === 1 || app.spaceDown || app.tool === 'pan') {
      app.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, ox: app.view.ox, oy: app.view.oy };
      svg.classList.add('panning');
      return;
    }
    if (e.button !== 0) return;
    const t = e.target.closest && e.target.closest('[data-pid],[data-mid]');
    // Clicking a dart apex (any tool but erase) selects that dart for editing.
    const dt = e.target.closest && e.target.closest('[data-did]');
    if (dt && app.tool !== 'erase' && !(app.draft && app.draft.type === 'dart')) {
      app.sel = { kind: 'panel', id: dt.dataset.dpid };
      app.dartSel = dt.dataset.did;
      renderAll();
      return;
    }
    if (app.tool === 'dart') {
      if (!app.draft) {
        const pid = t && t.dataset.pid;
        if (!pid) return toast('Click inside a panel to place the dart apex.', true);
        app.draft = { type: 'dart', pid, pts: [w] };
      } else {
        const err = insertDart(getPanel(app.draft.pid), app.draft.pts[0], w);
        if (err) toast(err, true);
        app.draft = null;
      }
      render();
      return;
    }
    if (app.tool === 'select') {
      if (t && t.dataset.mid) {
        app.sel = { kind: 'mark', id: t.dataset.mid };
        const m = getMark(app.sel.id);
        if (m.type === 'point') app.drag = { mode: 'mark', id: m.id, snap: snapshot(), moved: false };
        renderAll();
        return;
      }
      if (t && t.dataset.pid) {
        app.sel = { kind: 'panel', id: t.dataset.pid };
        app.drag = { mode: 'panel', id: app.sel.id, last: w, snap: snapshot(), moved: false };
        renderAll();
        return;
      }
      app.sel = null;
      app.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, ox: app.view.ox, oy: app.view.oy };
      svg.classList.add('panning');
      renderAll();
      return;
    }
    if (app.tool === 'erase') {
      if (t && t.dataset.mid) {
        pushHistory();
        const m = getMark(t.dataset.mid);
        app.state.marks = app.state.marks.filter((x) => x.id !== m.id);
        if (app.sel && app.sel.id === m.id) app.sel = null;
        renderAll();
        toast(`Deleted ${m.label}.`);
      }
      return;
    }
    const p = placePoint(w, e);
    if (app.tool === 'point') {
      pushHistory();
      const m = addMark('point', [p]);
      app.sel = { kind: 'mark', id: m.id };
      renderAll();
      return;
    }
    if (app.tool === 'line') {
      if (!app.draft) app.draft = { type: 'line', pts: [p] };
      else finishDraft(p);
      render();
      return;
    }
    if (app.tool === 'curve') {
      const now = performance.now(),
        dbl =
          app.lastDown &&
          now - app.lastDown.t < 400 &&
          Math.hypot(e.clientX - app.lastDown.x, e.clientY - app.lastDown.y) < 6;
      app.lastDown = { t: now, x: e.clientX, y: e.clientY };
      if (app.draft && dbl) {
        finishDraft();
        return;
      }
      if (!app.draft) app.draft = { type: 'curve', pts: [p] };
      else if (dist(p, app.draft.pts[app.draft.pts.length - 1]) > 3 / app.view.s) app.draft.pts.push(p);
      render();
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    app.lastEvt = e;
    const w = toWorld(e);
    app.hover = w;
    $('#pos').textContent = `x ${w[0].toFixed(1)}  y ${w[1].toFixed(1)} cm`;
    if (app.drag) {
      if (app.drag.mode === 'pinch' && pointers.size === 2) {
        const c = pinchState(),
          r = rect(),
          v = app.drag.view,
          k = c.d / app.drag.start.d;
        const wx = (app.drag.start.cx - r.left - v.ox) / v.s,
          wy = (app.drag.start.cy - r.top - v.oy) / v.s,
          ns = Math.max(2, Math.min(80, v.s * k));
        app.view.s = ns;
        app.view.ox = c.cx - r.left - wx * ns;
        app.view.oy = c.cy - r.top - wy * ns;
        render();
        return;
      }
      if (app.drag.mode === 'pan') {
        app.view.ox = app.drag.ox + e.clientX - app.drag.sx;
        app.view.oy = app.drag.oy + e.clientY - app.drag.sy;
        render();
        return;
      }
      if (app.drag.mode === 'panel') {
        const d = sub(w, app.drag.last);
        if (len(d) === 0) return;
        translatePanel(getPanel(app.drag.id), d);
        app.drag.last = w;
        app.drag.moved = true;
        render();
        return;
      }
      if (app.drag.mode === 'mark') {
        const m = getMark(app.drag.id),
          s = snap(w, m.id);
        m.pts = [s ? s.pt : w];
        app.drag.moved = true;
        render();
        return;
      }
      return;
    }
    app.snapInfo = ['point', 'line', 'curve'].includes(app.tool) && !e.shiftKey ? snap(w) : null;
    render();
  });
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('pointerleave', () => {
    app.hover = null;
    app.snapInfo = null;
    if (!app.drag) render();
  });
  svg.addEventListener('dblclick', (e) => {
    if (app.draft && app.draft.type === 'curve') {
      e.preventDefault();
      finishDraft();
    }
  });
  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = rect();
      if (e.ctrlKey || (!e.shiftKey && Math.abs(e.deltaX) < 1) || e.deltaMode) {
        zoomAt(
          e.clientX - r.left,
          e.clientY - r.top,
          app.view.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)),
        );
      } else {
        app.view.ox -= e.deltaX;
        app.view.oy -= e.deltaY;
      }
      render();
    },
    { passive: false },
  );
  svg.addEventListener('contextmenu', (e) => {
    if (app.draft) {
      e.preventDefault();
      if (app.draft.type === 'curve') finishDraft();
      else {
        app.draft = null;
        render();
      }
    }
  });
}
