// 3D view: every panel placed rigidly by its GarmentCode frame (translation + rotation), no simulation.
// Stitched edges are coloured and joined by dashed connector lines. Turntable orbit around the vertical (y) axis.
// Shown in its own pane beside the 2D canvas. Moving panels in 2D only changes place.ox/oy, which world3D() ignores.
import { STITCH_COLORS, TINTS } from '../config.js';
import { pointAtFrac } from '../geometry.js';
import { edgeSample } from '../model/edges.js';
import { eulerToMat, world3D } from '../model/frame3d.js';
import { panelPts } from '../model/panels.js';
import { edgeIndex } from '../model/stitches.js';
import { app } from '../state.js';
import { $ } from './dom.js';
import { fit } from './viewport.js';
import { renderAll } from './inspector.js';
import { esc, f3 } from '../util.js';

const HINT3D = 'Drag to orbit · Shift-drag to pan · wheel to zoom · click a panel to select it';

// World (cm, y up, z toward the front) -> [screen x, screen y (down), depth toward the camera].
function project(q, v) {
  const cy = Math.cos(v.yaw),
    sy = Math.sin(v.yaw),
    ce = Math.cos(v.el),
    se = Math.sin(v.el),
    x1 = cy * q[0] + sy * q[2],
    z1 = -sy * q[0] + cy * q[2];
  return [x1, -(q[1] * ce - z1 * se), q[1] * se + z1 * ce];
}
const camDir = (v) => {
  // Direction from the scene toward the camera, in world coordinates.
  const ce = Math.cos(v.el),
    se = Math.sin(v.el);
  return [-Math.sin(v.yaw) * ce, se, Math.cos(v.yaw) * ce];
};
const pt = (q) => `${f3(q[0])} ${f3(q[1])}`;

// 3D outline of every panel (sampled edges, canvas -> panel local -> world).
const lifted = () => app.state.panels.map((p) => ({ p, W: panelPts(p).map((q) => world3D(p, q)) }));

export function fit3d() {
  const v = app.view3d,
    L = lifted();
  if (!L.length) return;
  const P = L.flatMap((l) => l.W.map((q) => project(q, v))),
    xs = P.map((q) => q[0]),
    ys = P.map((q) => q[1]);
  v.c = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  v.half = 0.58 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 10);
  v.fitted = true;
  render3d();
}

export function render3d() {
  const svg = $('#view3d'),
    v = app.view3d,
    r = svg.getBoundingClientRect(),
    asp = (r.width || 1) / (r.height || 1),
    hw = v.half * Math.max(1, asp),
    hv = v.half * Math.max(1, 1 / asp),
    u = (2 * hw) / (r.width || 1); // world units per screen pixel
  svg.setAttribute('viewBox', `${f3(v.c[0] - hw)} ${f3(v.c[1] - hv)} ${f3(2 * hw)} ${f3(2 * hv)}`);
  const L = lifted();
  if (!L.length) {
    svg.innerHTML = '';
    $('#hint3d').textContent = 'No panels. Open a GarmentCode specification to see its 3D placement.';
    return;
  }
  const flat = app.state.panels.every((p) => !p.place.t[2] && !p.place.rot.some(Boolean));
  $('#hint3d').textContent = flat
    ? 'This pattern has no 3D placement (every panel lies in z = 0). ' + HINT3D
    : HINT3D;
  let h = '';
  // Floor grid under the panels, 10 cm spacing, and the vertical axis through the origin.
  const all = L.flatMap((l) => l.W),
    y0 = Math.min(...all.map((q) => q[1])) - 5,
    ext = (k) => [Math.min(...all.map((q) => q[k])), Math.max(...all.map((q) => q[k]))],
    [xa, xb] = ext(0),
    [za, zb] = ext(2),
    g0 = (a) => Math.floor((a - 10) / 10) * 10,
    g1 = (b) => Math.ceil((b + 10) / 10) * 10;
  let grid = '';
  for (let x = g0(xa); x <= g1(xb); x += 10)
    grid += `M${pt(project([x, y0, g0(za)], v))}L${pt(project([x, y0, g1(zb)], v))}`;
  for (let z = g0(za); z <= g1(zb); z += 10)
    grid += `M${pt(project([g0(xa), y0, z], v))}L${pt(project([g1(xb), y0, z], v))}`;
  h += `<path class="g3-floor" d="${grid}" stroke-width="${f3(u)}"/>`;
  h += `<path class="g3-axis" d="M${pt(project([0, y0, 0], v))}L${pt(project([0, Math.max(...all.map((q) => q[1])) + 5, 0], v))}" stroke-width="${f3(u)}"/>`;
  const fr = project([0, y0, g1(zb)], v);
  h += `<text class="g3-text" x="${f3(fr[0])}" y="${f3(fr[1] + 14 * u)}" font-size="${f3(11 * u)}" text-anchor="middle">front (+z)</text>`;

  // Panels, far to near. Each panel is planar, so one depth per panel is enough for these layouts.
  const cd = camDir(v),
    EI = app.opts.stitch ? edgeIndex() : null,
    stitchOf = new Map();
  if (EI)
    app.state.stitches.forEach((st, si) => {
      if (st.e.every((e) => EI.get(e))) st.e.forEach((e) => stitchOf.set(e, si));
    });
  const order = L.map((l) => ({ ...l, d: l.W.reduce((s, q) => s + project(q, v)[2], 0) / l.W.length })).sort(
    (a, b) => a.d - b.d,
  );
  for (const { p, W } of order) {
    const R = eulerToMat(p.place.rot),
      n = [R[0][2], R[1][2], R[2][2]],
      back = n[0] * cd[0] + n[1] * cd[1] + n[2] * cd[2] < 0,
      sel = app.sel && app.sel.kind === 'panel' && app.sel.id === p.id;
    h += `<path class="p3${back ? ' back' : ''}${sel ? ' sel' : ''}" data-pid="${p.id}" d="M${W.map((q) => pt(project(q, v))).join('L')}Z" style="fill:${TINTS[p.tint % TINTS.length]}" fill-opacity="0.92" stroke-width="${f3((sel ? 2.6 : 1.3) * u)}"/>`;
    if (EI)
      for (const e of p.edges)
        if (stitchOf.has(e.eid)) {
          const col = STITCH_COLORS[stitchOf.get(e.eid) % STITCH_COLORS.length];
          h += `<path d="M${edgeSample(e)
            .map((q) => pt(project(world3D(p, q), v)))
            .join(
              'L',
            )}" fill="none" stroke="${col}" stroke-width="${f3(3.2 * u)}" stroke-linecap="round" style="pointer-events:none"/>`;
        }
  }
  // Stitch connectors: stitched edges run in opposite directions, so fraction f on A meets 1 - f on B.
  if (EI)
    app.state.stitches.forEach((st, si) => {
      const [A, B] = st.e.map((e) => EI.get(e));
      if (!A || !B) return;
      const col = STITCH_COLORS[si % STITCH_COLORS.length],
        PA = edgeSample(A.e),
        PB = edgeSample(B.e);
      let d = '';
      for (const f of [0, 0.5, 1]) {
        const a = project(world3D(A.p, pointAtFrac(PA, f)), v),
          b = project(world3D(B.p, pointAtFrac(PB, 1 - f)), v);
        d += `M${pt(a)}L${pt(b)}`;
      }
      const m = project(world3D(A.p, pointAtFrac(PA, 0.5)), v),
        m2 = project(world3D(B.p, pointAtFrac(PB, 0.5)), v),
        c = [(m[0] + m2[0]) / 2, (m[1] + m2[1]) / 2];
      h += `<path d="${d}" stroke="${col}" stroke-width="${f3(1.6 * u)}" stroke-dasharray="${f3(5 * u)} ${f3(4 * u)}" style="pointer-events:none"/>`;
      h += `<circle cx="${f3(c[0])}" cy="${f3(c[1])}" r="${f3(8.5 * u)}" fill="${col}" style="pointer-events:none"/><text class="stitch-tag" x="${f3(c[0])}" y="${f3(c[1] + 3.5 * u)}" font-size="${f3((si >= 99 ? 8 : 10) * u)}" text-anchor="middle">${si + 1}</text>`;
    });
  for (const { p, W } of order) {
    const c = project(
      [0, 1, 2].map((k) => W.reduce((s, q) => s + q[k], 0) / W.length),
      v,
    );
    h += `<text class="panel-label" x="${f3(c[0])}" y="${f3(c[1])}" font-size="${f3(11 * u)}" stroke-width="${f3(3 * u)}" text-anchor="middle">${esc(p.name)}</text>`;
  }
  svg.innerHTML = h;
}

// Show or hide the 3D pane. Both panes change size, so both are refitted.
export function setView3d(on) {
  app.view3d.on = on;
  document.querySelector('main').classList.toggle('show3d', on);
  $('#view-3d').setAttribute('aria-pressed', on);
  fit();
  renderAll();
}

export function initView3d() {
  const svg = $('#view3d'),
    v = app.view3d;
  $('#view-3d').onclick = () => setView3d(!v.on);
  $('#fit3d').onclick = () => fit3d();
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: false, pan: e.shiftKey || e.button === 1, target: e.target };
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      // synthetic event without an active pointer
    }
    svg.classList.add('dragging');
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.pan) {
      const r = svg.getBoundingClientRect(),
        upx = (2 * v.half) / Math.min(r.width, r.height);
      v.c = [v.c[0] - dx * upx, v.c[1] - dy * upx];
    } else {
      v.yaw -= dx * 0.008;
      v.el = Math.min(Math.PI / 2 - 0.01, Math.max(-Math.PI / 2 + 0.01, v.el + dy * 0.008));
    }
    render3d();
  });
  const end = () => {
    if (!drag) return;
    svg.classList.remove('dragging');
    if (!drag.moved) {
      const pid = drag.target.dataset && drag.target.dataset.pid;
      app.sel = pid ? { kind: 'panel', id: pid } : null;
      renderAll();
    }
    drag = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      v.half = Math.min(5000, Math.max(5, v.half * Math.exp(e.deltaY * 0.0015)));
      render3d();
    },
    { passive: false },
  );
}
