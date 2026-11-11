// Single-cone dart dialog for one dart of one panel: the intrinsic-dart demo's three panes (reference outline with
// distortion and locks, developed boundary, 3D cone surface), its controls, statistics and status line.
import { DIVERGING } from '../config.js';
import { pip } from '../geometry.js';
import { solveDart } from '../io/dart-server.js';
import { DART_DEFAULTS, dartSettings, fracToIndex, toCanvas, toMath } from '../model/dart-solve.js';
import { nearestBoundary } from '../model/intrinsic.js';
import { app, getPanel, snapshot } from '../state.js';
import { $ } from './dom.js';
import { renderAll } from './inspector.js';
import { f3 } from '../util.js';

const DEG = 180 / Math.PI;
let res = null,
  raf = 0,
  inflight = false,
  pending = false,
  lastViz = 'scale';

function hexRgb(h) {
  h = h.trim().replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
export function colormap(t) {
  const A = DIVERGING.map(hexRgb),
    x = Math.min(1, Math.max(0, t)) * (A.length - 1),
    i = Math.min(A.length - 2, Math.floor(x)),
    u = x - i;
  return `rgb(${A[i].map((c, k) => Math.round(c + (A[i + 1][k] - c) * u)).join(',')})`;
}
const gradient = `linear-gradient(90deg, ${DIVERGING.join(', ')})`;
const pt = (q) => `${f3(q[0])} ${f3(q[1])}`;

function cur() {
  const v = app.dartView,
    p = v && getPanel(v.pid),
    d = p && (p.darts || []).find((x) => x.id === v.did);
  return p && d ? { p, d, v } : null;
}

export function openDart(pid, did) {
  app.dartView = {
    pid,
    did,
    viz: lastViz,
    mesh: false,
    coords: false,
    lock: 'angle',
    edges: false,
    cam: { yaw: -0.7, el: 0.45, c: [0, 0], half: 1 },
    snap: snapshot(),
    drag: null,
    marq: null,
    fitted: false,
  };
  const c = cur();
  if (!c) return;
  dartSettings(c.d);
  res = null;
  $('#dd-panel').textContent = c.p.name;
  $('#dartdlg').hidden = false;
  syncControls();
  drawAll();
  $('#dd-status').textContent = 'Solving with intrinsic-dart…';
  update();
}
function closeDart() {
  const v = app.dartView;
  $('#dartdlg').hidden = true;
  if (!v) return;
  if (snapshot() !== v.snap) {
    app.undoStack.push(v.snap);
    app.redoStack = [];
  }
  lastViz = v.viz;
  app.dartView = null;
  renderAll();
}
const isOpen = () => !$('#dartdlg').hidden && cur();

function syncControls() {
  const { d, v } = cur();
  $('#dd-defect').value = Math.round(d.defect * DEG);
  $('#dd-defect-v').textContent = `+${Math.round(d.defect * DEG)}°`;
  $('#dd-angle').value = d.angleW;
  $('#dd-scale').value = d.scaleW;
  $('#dd-length').value = d.lengthW;
  $('#dd-smooth').value = d.smooth;
  $('#dd-cutmode').value = d.cutMode;
  $('#dd-cutw').value = d.cutW;
  $('#dd-cutw').disabled = d.cutMode !== 'optimize';
  $('#dd-viz').value = v.viz;
  $('#dd-mesh').checked = v.mesh;
  $('#dd-coords').checked = v.coords;
  $('#dd-edges').checked = v.edges;
  document.querySelectorAll('input[name="dd-lock"]').forEach((r) => (r.checked = r.value === v.lock));
}

const request = () => {
  if (!raf)
    raf = setTimeout(() => {
      raf = 0;
      if (isOpen()) update();
    }, 16);
};
// One request in flight; while it runs, further changes only mark the next solve, which uses the latest settings.
async function update() {
  if (inflight) {
    pending = true;
    return;
  }
  inflight = true;
  try {
    do {
      pending = false;
      const c = cur();
      if (!isOpen() || !c) break;
      const r = await solveDart(c.p, c.d, c.v.mesh || c.v.coords);
      if (!isOpen() || (cur() !== null && cur().d !== c.d)) break;
      res = r;
      if (res.surf && !app.dartView.fitted) {
        fit3d();
        app.dartView.fitted = true;
      }
      drawAll();
    } while (pending);
  } finally {
    inflight = false;
  }
}
function drawAll() {
  drawRef();
  drawDev();
  draw3d();
  drawText();
}

// ---- shared svg helpers
function setView(svg, xs, ys, pad = 0.08) {
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    y0 = Math.min(...ys),
    y1 = Math.max(...ys),
    w = x1 - x0 || 1,
    h = y1 - y0 || 1,
    m = Math.max(w, h) * pad;
  svg.setAttribute('viewBox', `${f3(x0 - m)} ${f3(y0 - m)} ${f3(w + 2 * m)} ${f3(h + 2 * m)}`);
  const r = svg.getBoundingClientRect();
  return Math.max((w + 2 * m) / (r.width || 1), (h + 2 * m) / (r.height || 1)); // units per screen px
}
function capture(el, e) {
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    // no active pointer (synthetic event): dragging still works while the pointer stays over the pane
  }
}
function svgPoint(svg, e) {
  const P = svg.createSVGPoint();
  P.x = e.clientX;
  P.y = e.clientY;
  const q = P.matrixTransform(svg.getScreenCTM().inverse());
  return [q.x, q.y];
}
function colorbar(id, lo, hi, digits = 3) {
  $(`#${id}-grad`).style.background = gradient;
  $(`#${id}-min`).textContent = lo === null ? '' : lo.toFixed(digits);
  $(`#${id}-max`).textContent = hi === null ? '' : hi.toFixed(digits);
}

// ---- pane 1: reference outline, distortion, locks, cone and ray handles
const VIZ = {
  angle: ['Angle distortion', 'turning-angle change (°)'],
  scale: ['Scale factor', 'log scale'],
  length: ['Edge-length distortion', 'relative edge-length change'],
};
function refValues() {
  const { metric, pm } = res,
    v = app.dartView.viz;
  if (!metric) return null;
  if (v === 'angle') return metric.curvatureChange.map((x) => x * DEG);
  if (v === 'scale') return [...metric.eta];
  return metric.targetLengths.map((t, i) => t / pm.model.originalLengths[i] - 1);
}
function drawRef() {
  const svg = $('#dd-ref'),
    { d, v } = cur();
  $('#dd-ref-title').textContent = 'Reference · ' + VIZ[v.viz][0];
  if (!res || !res.pm) {
    svg.innerHTML = '';
    colorbar('dd-ref', null, null);
    return;
  }
  const M = res.pm.model,
    B = M.vertices.map(toCanvas),
    n = B.length,
    u = setView(
      svg,
      B.map((q) => q[0]),
      B.map((q) => q[1]),
    ),
    diag = Math.hypot(
      Math.max(...B.map((q) => q[0])) - Math.min(...B.map((q) => q[0])),
      Math.max(...B.map((q) => q[1])) - Math.min(...B.map((q) => q[1])),
    );
  app.dartView.u = u;
  app.dartView.diag = diag;
  let h = '';
  const st = M.mesh && { meshPts: M.mesh.pts, tris: M.mesh.tris };
  if (st && (v.mesh || v.coords)) {
    let path = '';
    const seen = new Set();
    for (const t of st.tris)
      for (let k = 0; k < 3; k++) {
        const a = t[k],
          b = t[(k + 1) % 3],
          key = a < b ? a + ',' + b : b + ',' + a;
        if (seen.has(key)) continue;
        seen.add(key);
        path += `M${pt(toCanvas(st.meshPts[a]))}L${pt(toCanvas(st.meshPts[b]))}`;
      }
    h += `<path class="dd-mesh" d="${path}" stroke-width="${u * 0.8}"/>`;
    if (v.mesh)
      for (const key of seen) {
        const [a, b] = key.split(',').map(Number),
          A = toCanvas(st.meshPts[a]),
          Bp = toCanvas(st.meshPts[b]),
          L = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]);
        h += `<text class="dd-lab" x="${f3((A[0] + Bp[0]) / 2)}" y="${f3((A[1] + Bp[1]) / 2)}" font-size="${f3(7 * u)}" text-anchor="middle">${L.toPrecision(3)}</text>`;
      }
    if (v.coords)
      for (const q of st.meshPts) {
        const c = toCanvas(q);
        h += `<text class="dd-coord" x="${f3(c[0])}" y="${f3(c[1])}" font-size="${f3(7 * u)}">(${c[0].toPrecision(3)}, ${c[1].toPrecision(3)})</text>`;
      }
  }
  if (v.mesh) {
    // Signed exterior turning angles of the reference boundary (solver frame, CCW positive).
    const V = M.vertices;
    M.originalTurns.forEach((turn, i) => {
      const a = V[i],
        inc = [a[0] - V[(i - 1 + n) % n][0], a[1] - V[(i - 1 + n) % n][1]],
        out = [V[(i + 1) % n][0] - a[0], V[(i + 1) % n][1] - a[1]],
        r = Math.min(0.035 * diag, 0.22 * Math.hypot(...inc), 0.22 * Math.hypot(...out)),
        s0 = Math.atan2(inc[1], inc[0]),
        arc = Array.from({ length: 13 }, (_, k) =>
          toCanvas([a[0] + r * Math.cos(s0 + (turn * k) / 12), a[1] + r * Math.sin(s0 + (turn * k) / 12)]),
        ),
        cls = turn >= 0 ? 'dd-turn-pos' : 'dd-turn-neg',
        mid = toCanvas([a[0] + 0.7 * r * Math.cos(s0 + turn / 2), a[1] + 0.7 * r * Math.sin(s0 + turn / 2)]);
      h += `<path class="${cls}" d="M${pt(toCanvas(a))}${arc.map((q) => 'L' + pt(q)).join('')}Z" stroke-width="${u}"/>`;
      if (Math.abs(turn) > 1e-3)
        h += `<text class="${cls}-t dd-lab" x="${f3(mid[0])}" y="${f3(mid[1])}" font-size="${f3(8 * u)}" text-anchor="middle">${turn >= 0 ? '+' : ''}${(turn * DEG).toFixed(1)}°</text>`;
    });
  }
  const vals = refValues(),
    lim = vals ? Math.max(1e-6, ...vals.map(Math.abs)) : 1,
    col = (x) => colormap((x / lim + 1) / 2);
  colorbar('dd-ref', vals ? -lim : null, vals ? lim : null, v.viz === 'angle' ? 2 : 4);
  if (v.viz === 'length' && vals)
    B.forEach((a, i) => {
      h += `<path d="M${pt(a)}L${pt(B[(i + 1) % n])}" stroke="${col(vals[i])}" stroke-width="${3 * u}" stroke-linecap="round"/>`;
    });
  else {
    h += `<path class="dd-ref" d="M${B.map(pt).join('L')}Z" stroke-width="${1.5 * u}"/>`;
    const aL = res.pm.model.angleLocked,
      sL = res.pm.model.scaleLocked,
      prev = v.marq ? marqueeHits(v.marq) : null;
    B.forEach((q, i) => {
      h += `<circle class="dd-vtx${aL.has(i) ? ' alock' : ''}" cx="${f3(q[0])}" cy="${f3(q[1])}" r="${f3(4.5 * u)}" fill="${vals ? col(vals[i]) : 'var(--dd-ref)'}" stroke-width="${f3((aL.has(i) ? 2.5 : 1) * u)}"/>`;
      if (sL.has(i))
        h += `<rect class="dd-slock" x="${f3(q[0] - 8 * u)}" y="${f3(q[1] - 8 * u)}" width="${f3(16 * u)}" height="${f3(16 * u)}" stroke-width="${f3(2 * u)}"/>`;
      if (prev && prev.has(i))
        h += `<circle cx="${f3(q[0])}" cy="${f3(q[1])}" r="${f3(7.5 * u)}" fill="none" stroke="var(${v.marq.lock ? '--dart-gold' : '--lock-blue'})" stroke-width="${f3(2 * u)}"/>`;
    });
  }
  if (res.dev) {
    const hit = toCanvas(res.dev.cut.point),
      s = 5 * u;
    h += `<path class="dd-gold" d="M${pt(d.at)}L${pt(hit)}M${pt([hit[0] - s, hit[1] - s])}L${pt([hit[0] + s, hit[1] + s])}M${pt([hit[0] - s, hit[1] + s])}L${pt([hit[0] + s, hit[1] - s])}" stroke-width="${2 * u}"/>`;
  }
  const hd = [d.at[0] + 0.22 * diag * Math.cos(d.cut), d.at[1] + 0.22 * diag * Math.sin(d.cut)],
    r = 6.5 * u;
  h += `<path class="dd-handle" data-h="handle" d="M${pt([hd[0], hd[1] - r])}L${pt([hd[0] + r, hd[1]])}L${pt([hd[0], hd[1] + r])}L${pt([hd[0] - r, hd[1]])}Z" stroke-width="${u}"/>`;
  h += `<circle class="dd-cone" data-h="cone" cx="${f3(d.at[0])}" cy="${f3(d.at[1])}" r="${f3(6.5 * u)}" stroke-width="${u}"/>`;
  if (v.marq) {
    const [a, b] = [v.marq.a, v.marq.b];
    h += `<rect class="dd-marq" x="${f3(Math.min(a[0], b[0]))}" y="${f3(Math.min(a[1], b[1]))}" width="${f3(Math.abs(b[0] - a[0]))}" height="${f3(Math.abs(b[1] - a[1]))}" stroke="var(${v.marq.lock ? '--dart-gold' : '--lock-blue'})" stroke-width="${u}"/>`;
  }
  svg.innerHTML = h;
}
function marqueeHits(m) {
  const B = res.pm.model.vertices.map(toCanvas),
    x0 = Math.min(m.a[0], m.b[0]),
    x1 = Math.max(m.a[0], m.b[0]),
    y0 = Math.min(m.a[1], m.b[1]),
    y1 = Math.max(m.a[1], m.b[1]),
    s = new Set();
  B.forEach((q, i) => {
    if (q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1) s.add(i);
  });
  return s;
}
// Edit only the selected lock type; locks are stored as perimeter fractions so they survive re-meshing.
function setLocks(indices, locking) {
  const { d, v } = cur(),
    key = v.lock === 'angle' ? 'angleLocks' : 'scaleLocks',
    frac = res.pm.frac,
    have = new Set(d[key].map((f) => fracToIndex(frac, f)));
  indices.forEach((i) => (locking ? have.add(i) : have.delete(i)));
  d[key] = [...have].sort((a, b) => a - b).map((i) => +frac[i].toFixed(6));
  update();
}

// ---- pane 2: developed boundary coloured by closure correction
function drawDev() {
  const svg = $('#dd-dev');
  if (!res || !res.dev) {
    svg.innerHTML = '';
    colorbar('dd-dev', null, null);
    return;
  }
  const { d } = cur(),
    a = -d.cut,
    c = Math.cos(a),
    s = Math.sin(a),
    P = res.dev.boundary.map(([x, y]) => toCanvas([x * c - y * s, x * s + y * c])),
    u = setView(svg, [0, ...P.map((q) => q[0])], [0, ...P.map((q) => q[1])]),
    adj = res.dev.segmentCorrectedLengths.map((x, i) => x / res.dev.segmentTargetLengths[i] - 1),
    lim = Math.max(1e-6, ...adj.map(Math.abs));
  colorbar('dd-dev', -lim, lim, 5);
  let h = '';
  adj.forEach((x, i) => {
    h += `<path d="M${pt(P[i])}L${pt(P[i + 1])}" stroke="${colormap((x / lim + 1) / 2)}" stroke-width="${3 * u}" stroke-linecap="round"/>`;
  });
  const A = P[0],
    Z = P.at(-1),
    r = 5.5 * u;
  h += `<path class="dd-gold" d="M${pt(A)}L0 0L${pt(Z)}" stroke-width="${2 * u}"/>`;
  h += `<circle class="dd-end0" cx="${f3(A[0])}" cy="${f3(A[1])}" r="${f3(r)}" stroke-width="${u}"/>`;
  h += `<rect class="dd-end1" x="${f3(Z[0] - r)}" y="${f3(Z[1] - r)}" width="${f3(2 * r)}" height="${f3(2 * r)}" stroke-width="${u}"/>`;
  const star = Array.from({ length: 10 }, (_, k) => {
    const rr = (k % 2 ? 3.5 : 8) * u,
      t = -Math.PI / 2 + (k * Math.PI) / 5;
    return pt([rr * Math.cos(t), rr * Math.sin(t)]);
  });
  h += `<path class="dd-cone" d="M${star.join('L')}Z" stroke-width="${u}"/>`;
  svg.innerHTML = h;
}

// ---- pane 3: faceted cone surface, turntable orbit
function project(q, cam) {
  const cy = Math.cos(cam.yaw),
    sy = Math.sin(cam.yaw),
    ce = Math.cos(cam.el),
    se = Math.sin(cam.el),
    x1 = cy * q[0] - sy * q[1],
    y1 = sy * q[0] + cy * q[1];
  return [x1, -(y1 * se + q[2] * ce), -y1 * ce + q[2] * se]; // screen x, screen y (down), depth toward camera
}
function fit3d() {
  const v = app.dartView;
  if (!res || !res.surf || !v) return;
  const P = res.surf.verts.map((q) => project(q, v.cam)),
    xs = P.map((p) => p[0]),
    ys = P.map((p) => p[1]);
  v.cam.c = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  v.cam.half = 0.58 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
}
function shade(token, k) {
  const c = hexRgb(getComputedStyle($('#dartdlg')).getPropertyValue(token) || '#cccccc');
  return `rgb(${c.map((x) => Math.round(Math.min(255, x * k))).join(',')})`;
}
function draw3d() {
  const svg = $('#dd-3d'),
    v = app.dartView;
  if (!v) return;
  if (!res || !res.surf) {
    svg.innerHTML = '';
    $('#dd-3d-info').textContent = res && res.surfError ? `3D preview unavailable: ${res.surfError}` : '';
    $('#dd-3d-info').classList.toggle('warn-text', !!(res && res.surfError));
    return;
  }
  const { verts, faces, pocket, pitch, fans, pockets } = res.surf,
    cam = v.cam,
    r = svg.getBoundingClientRect(),
    asp = (r.width || 1) / (r.height || 1),
    hh = cam.half,
    hw = hh * Math.max(1, asp),
    hv = hh * Math.max(1, 1 / asp);
  svg.setAttribute('viewBox', `${f3(cam.c[0] - hw)} ${f3(cam.c[1] - hv)} ${f3(2 * hw)} ${f3(2 * hv)}`);
  const P = verts.map((q) => project(q, cam)),
    u = (2 * hw) / (r.width || 1),
    L = [0.3, -0.5, 0.81],
    order = faces
      .map((f, i) => ({ f, i, z: (P[f[0]][2] + P[f[1]][2] + P[f[2]][2]) / 3 }))
      .sort((a, b) => a.z - b.z);
  let h = '';
  for (const { f, i } of order) {
    const [a, b, c] = f.map((k) => P[k]),
      e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
      nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]],
      ln = Math.hypot(...nn) || 1,
      lam = Math.abs((nn[0] * L[0] + nn[1] * L[1] + nn[2] * L[2]) / ln),
      fill = shade(pocket[i] ? '--pocket-face' : '--cone-face', 0.45 + 0.6 * lam);
    h += `<path d="M${pt(a)}L${pt(b)}L${pt(c)}Z" fill="${fill}" stroke="${v.edges ? 'var(--ink)' : fill}" stroke-opacity="${v.edges ? 0.4 : 1}" stroke-width="${f3(0.6 * u)}" stroke-linejoin="round"/>`;
  }
  svg.innerHTML = h;
  $('#dd-3d-info').classList.remove('warn-text');
  $('#dd-3d-info').textContent =
    `Pitch ${(pitch * DEG).toFixed(1)}° · ${fans} fans · ${pockets} pockets · ${faces.length} triangles`;
}

// ---- statistics and status, as in the demo
function drawText() {
  const st = $('#dd-status'),
    stats = $('#dd-stats');
  if (!res) {
    stats.textContent = '';
    return;
  }
  st.classList.toggle('err', !!res.error);
  if (res.error) {
    st.textContent = res.offline ? res.error : `Invalid configuration: ${res.error}`;
    stats.textContent = '';
    return;
  }
  const d = res.dev.diagnostics,
    m = res.metric.diagnostics,
    e = (x) => x.toExponential(1),
    ms = res.pm.model.stats;
  stats.textContent =
    `Edge factors min / median / max: ${d.factor_min.toFixed(5)} / ${d.factor_median.toFixed(5)} / ${d.factor_max.toFixed(5)}   ·   ` +
    `Absolute deviation (%): ${d.absolute_percent_min.toFixed(3)} / ${d.absolute_percent_median.toFixed(3)} / ${d.absolute_percent_max.toFixed(3)}   ·   ` +
    `Log scale: [${m.log_scale_min.toFixed(4)}, ${m.log_scale_max.toFixed(4)}]   ·   ` +
    `Mesh: ${ms.boundary_vertices} boundary + ${ms.interior_vertices} interior vertices, ${ms.triangles} triangles`;
  st.textContent =
    `OK · source sum ${m.source_normalization.toFixed(10)} · Gauss–Bonnet ${e(m.gauss_bonnet_residual)} · ` +
    `angle lock ${e(m.angle_lock_residual)} · scale lock ${e(m.scale_lock_residual)} · closure ${e(d.closure_residual)} · ` +
    `reference cut ${d.reference_cut_length.toFixed(5)} · cut length ${d.cut_length.toFixed(5)} (error ${e(d.cut_length_residual)}) · ` +
    `cut rotation error ${e(d.cut_angle_residual)} rad · KKT condition ${m.solver_condition.toPrecision(2)}`;
}

// ---- wiring
export function initDartView() {
  $('#dd-done').onclick = closeDart;
  $('#dartdlg').addEventListener('click', (e) => {
    if (e.target.id === 'dartdlg') closeDart();
  });
  addEventListener(
    'keydown',
    (e) => {
      if ($('#dartdlg').hidden) return;
      if (e.key === 'Escape') closeDart();
      e.stopPropagation(); // keep editor shortcuts (delete, tools, operations) away while the dialog is open
    },
    true,
  );
  const num = (id, key, conv = (x) => x, ok = (x) => x >= 0) =>
    $(id).addEventListener('input', () => {
      const x = parseFloat($(id).value),
        c = cur();
      if (!c || !Number.isFinite(x) || !ok(x)) return;
      c.d[key] = conv(x);
      if (key === 'defect') $('#dd-defect-v').textContent = `+${Math.round(x)}°`;
      request();
    });
  num('#dd-defect', 'defect', (x) => x / DEG);
  num('#dd-angle', 'angleW');
  num('#dd-scale', 'scaleW');
  num('#dd-length', 'lengthW');
  num('#dd-smooth', 'smooth');
  num('#dd-cutw', 'cutW');
  $('#dd-cutmode').addEventListener('change', () => {
    cur().d.cutMode = $('#dd-cutmode').value;
    $('#dd-cutw').disabled = $('#dd-cutmode').value !== 'optimize';
    update();
  });
  $('#dd-reset').onclick = () => {
    const { d, v } = cur();
    for (const [k, val] of Object.entries(DART_DEFAULTS)) d[k] = Array.isArray(val) ? [] : val;
    v.viz = 'scale';
    v.lock = 'angle';
    v.fitted = false;
    syncControls();
    update();
  };
  const view = (id, key, after = update) =>
    $(id).addEventListener('change', () => {
      app.dartView[key] = $(id).type === 'checkbox' ? $(id).checked : $(id).value;
      after();
    });
  view('#dd-viz', 'viz', drawRef);
  // The mesh is fetched from the server only when an overlay needs it.
  const overlay = () => (res && res.pm && !res.pm.model.mesh ? update() : drawRef());
  view('#dd-mesh', 'mesh', overlay);
  view('#dd-coords', 'coords', overlay);
  view('#dd-edges', 'edges', draw3d);
  document.querySelectorAll('input[name="dd-lock"]').forEach((r) =>
    r.addEventListener('change', () => {
      app.dartView.lock = r.value;
    }),
  );
  $('#dd-fit3d').onclick = () => {
    fit3d();
    draw3d();
  };

  // Pane 1: drag cone / ray handle; right-click toggles a lock; Shift-drag locks, Ctrl-drag unlocks.
  const ref = $('#dd-ref');
  ref.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!res || !res.pm) return;
    const w = svgPoint(ref, e),
      u = app.dartView.u,
      B = res.pm.model.vertices.map(toCanvas);
    let best = -1,
      bd = Infinity;
    B.forEach((q, i) => {
      const dd = (Math.abs(q[0] - w[0]) + Math.abs(q[1] - w[1])) / u;
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    });
    if (bd <= 16) {
      const { d, v } = cur(),
        key = v.lock === 'angle' ? 'angleLocks' : 'scaleLocks',
        on = d[key].some((f) => fracToIndex(res.pm.frac, f) === best);
      setLocks([best], !on);
    }
  });
  ref.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !res || !res.pm) return;
    const v = app.dartView,
      w = svgPoint(ref, e),
      hnd = e.target.dataset && e.target.dataset.h;
    if (hnd) v.drag = hnd;
    else if (e.shiftKey || e.ctrlKey || e.metaKey) v.marq = { a: w, b: w, lock: e.shiftKey };
    else return;
    capture(ref, e);
    e.preventDefault();
  });
  ref.addEventListener('pointermove', (e) => {
    const v = app.dartView;
    if (!v || (!v.drag && !v.marq)) return;
    const w = svgPoint(ref, e),
      { d } = cur();
    if (v.drag === 'cone') {
      const V = res.pm.model.vertices,
        m = toMath(w);
      if (pip(m, V) && nearestBoundary(V, m).d > 1e-8 * v.diag) {
        d.at = w;
        request();
      }
    } else if (v.drag === 'handle') {
      const dx = w[0] - d.at[0],
        dy = w[1] - d.at[1];
      if (Math.hypot(dx, dy) > 1e-10 * v.diag) {
        d.cut = Math.atan2(dy, dx);
        request();
      }
    } else if (v.marq) {
      v.marq.b = w;
      drawRef();
    }
  });
  const endRef = () => {
    const v = app.dartView;
    if (!v) return;
    if (v.marq) {
      const hits = marqueeHits(v.marq),
        lock = v.marq.lock;
      v.marq = null;
      if (hits.size) setLocks([...hits], lock);
      else drawRef();
    }
    v.drag = null;
  };
  ref.addEventListener('pointerup', endRef);
  ref.addEventListener('pointercancel', endRef);

  // Pane 3: turntable orbit (fixed vertical axis), Ctrl/middle-drag pan, wheel zoom.
  const s3 = $('#dd-3d');
  let orbit = null;
  s3.addEventListener('pointerdown', (e) => {
    orbit = { x: e.clientX, y: e.clientY, pan: e.button === 1 || e.ctrlKey || e.metaKey };
    capture(s3, e);
    e.preventDefault();
  });
  s3.addEventListener('pointermove', (e) => {
    const v = app.dartView;
    if (!orbit || !v) return;
    const dx = e.clientX - orbit.x,
      dy = e.clientY - orbit.y,
      r = s3.getBoundingClientRect(),
      upx = (2 * v.cam.half) / Math.min(r.width, r.height);
    orbit.x = e.clientX;
    orbit.y = e.clientY;
    if (orbit.pan) v.cam.c = [v.cam.c[0] - dx * upx, v.cam.c[1] - dy * upx];
    else {
      v.cam.yaw -= dx * 0.01;
      v.cam.el = Math.min(Math.PI / 2, Math.max(-Math.PI / 2, v.cam.el + dy * 0.01));
    }
    draw3d();
  });
  s3.addEventListener('pointerup', () => (orbit = null));
  s3.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      app.dartView.cam.half *= Math.exp(e.deltaY * 0.0015);
      draw3d();
    },
    { passive: false },
  );
}
