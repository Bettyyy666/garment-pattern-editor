// 3D view (canvas). With a body loaded (io/body.js) every panel is moved, flat, next to the body part its name names
// (model/body-place.js); without one, panels sit rigidly at their GarmentCode frame (translation + rotation). Darted
// panels are intrinsic-dart cone surfaces either way, bulging away from the body. Body and fabric triangles are
// depth-sorted and painted back to front; clicks are picked in JS. Moving panels in 2D only changes
// place.ox/oy, which world3D() ignores, so it never moves anything here.
import { STITCH_COLORS, TINTS } from '../config.js';
import { pointAtFrac } from '../geometry.js';
import { dartResult, solvedPose } from '../io/dart-results.js';
import { panelMesh } from '../io/panel-mesh.js';
import { arrange } from '../model/body-place.js';
import { coneSamples } from '../model/cone3d.js';
import { edgeSample } from '../model/edges.js';
import { add3, cross3, dot3, eulerToMat, mul3, sub3, world3D } from '../model/frame3d.js';
import { panelPts } from '../model/panels.js';
import { panelOutline, toCanvas } from '../model/dart-solve.js';
import { rayCut } from '../model/intrinsic.js';
import { deleteDart, insertDart, moveDartTo } from '../operations/dart.js';
import { edgeIndex } from '../model/stitches.js';
import { app, snapshot } from '../state.js';
import { $ } from './dom.js';
import { fit } from './viewport.js';
import { renderAll, renderInspector } from './inspector.js';
import { render } from './render.js';
import { toast } from './toast.js';

const HINT3D =
  'Drag to orbit · drag a dart apex to move the dart · Shift-drag to pan · wheel to zoom · click a panel or apex to select it';
const LIGHT = [0.3, 0.6, 0.74]; // world light direction for facet shading
const PART = { torso: 'torso', arm: 'arm', leg: 'leg' };

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
  const ce = Math.cos(v.el),
    se = Math.sin(v.el);
  return [-Math.sin(v.yaw) * ce, se, Math.cos(v.yaw) * ce];
};
const hexRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  const n = m ? parseInt(m[1], 16) : 0xcccccc;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const shade = (rgb, k) => `rgb(${rgb.map((x) => Math.round(Math.min(255, x * k))).join(',')})`;

// Next to a body, cone triangles (points: [x, y, offset] on the panel) are cut so no edge is much longer than
// MAX_EDGE: the long apex-to-boundary fan triangles would otherwise sort wrongly against the small body triangles.
// A thin fan triangle is cut in strips across its long sides, any other into a barycentric grid.
const MAX_EDGE = 3;
function subdivide(A, B, C) {
  const L = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]),
    e = [L(B, C), L(C, A), L(A, B)],
    k = Math.min(16, Math.ceil(Math.max(...e) / MAX_EDGE));
  if (k <= 1) return [[A, B, C]];
  const mix = (p, q, t) => p.map((x, i) => x + (q[i] - x) * t),
    out = [];
  if (Math.min(...e) <= MAX_EDGE) {
    const i = e.indexOf(Math.min(...e)),
      [O, P, Q] = [
        [A, B, C],
        [B, C, A],
        [C, A, B],
      ][i];
    for (let j = 0; j < k; j++) {
      const p0 = mix(O, P, j / k),
        q0 = mix(O, Q, j / k),
        p1 = mix(O, P, (j + 1) / k),
        q1 = mix(O, Q, (j + 1) / k);
      if (j) out.push([p0, p1, q0]);
      out.push([q0, p1, q1]);
    }
    return out;
  }
  const at = (i, j) => [0, 1, 2].map((c) => A[c] + ((B[c] - A[c]) * i) / k + ((C[c] - A[c]) * j) / k);
  for (let i = 0; i < k; i++)
    for (let j = 0; i + j < k; j++) {
      out.push([at(i, j), at(i + 1, j), at(i, j + 1)]);
      if (i + j + 1 < k) out.push([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
    }
  return out;
}

// Barycentric coordinates of q in triangle (a, b, c) (2D), or null when it is degenerate.
function bary(q, a, b, c) {
  const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(det) < 1e-12) return null;
  const l1 = ((q[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (q[1] - a[1])) / det,
    l2 = ((b[0] - a[0]) * (q[1] - a[1]) - (q[0] - a[0]) * (b[1] - a[1])) / det;
  return [1 - l1 - l2, l1, l2];
}

// Every panel in 3D: { p, cls?, toW(canvas point, normal offset), outline (world), tris: [[A, B, C, pocket, w]]
// (w: the corners' 2D canvas points, so a click in 3D maps back to the 2D pattern), poly + polyW (world outline and
// its 2D points, drawn as one flat face when there is no mesh), cone, height(w) (cone height at a 2D point, else 0)}.
function scene() {
  const body = app.body,
    items = app.state.panels.map((p) => ({ p, W: panelPts(p).map((q) => world3D(p, q)) }));
  if (body) arrange(items, body);
  return items.map((it) => {
    const { p } = it,
      R = eulerToMat(p.place.rot),
      n = [R[0][2], R[1][2], R[2][2]],
      lift = [0, app.view3d.lift || 0, 0], // the Height slider: every panel up or down, view only
      toW = body
        ? (w, hn = 0) => add3(it.map(world3D(p, w), hn), lift)
        : (w, hn = 0) => add3(add3(world3D(p, w), mul3(n, hn)), lift),
      D = p.darts || [],
      d = D.find((x) => x.id === app.dartSel) || D[0],
      res = d && dartResult(p, d).res,
      s = {
        p,
        cls: it.cls,
        toW,
        outline: panelPts(p).map((w) => toW(w)),
        tris: null,
        poly: null,
        cone: false,
        height: () => 0,
      };
    if (res && res.surf) {
      const S = coneSamples(p, { ...d, at: solvedPose(p, res).at }, res.surf); // where it was solved
      if (body) {
        const X = S.pts.map((w, i) => [w[0], w[1], S.hn[i]]),
          W = (x) => toW([x[0], x[1]], x[2]);
        s.tris = res.surf.faces.flatMap((f, i) =>
          subdivide(X[f[0]], X[f[1]], X[f[2]]).map((t) => [
            ...t.map(W),
            res.surf.pocket[i],
            t.map((x) => [x[0], x[1]]),
          ]),
        );
      } else {
        const Q = S.pts.map((w, i) => toW(w, S.hn[i]));
        s.tris = res.surf.faces.map((f, i) => [
          Q[f[0]],
          Q[f[1]],
          Q[f[2]],
          res.surf.pocket[i],
          f.map((k) => S.pts[k]),
        ]);
      }
      s.cone = true;
      // Height of the cone above a 2D point: interpolated in the surface triangle (chart = 2D outline) holding it.
      s.height = (w) => {
        for (const f of res.surf.faces) {
          const b = bary(w, S.pts[f[0]], S.pts[f[1]], S.pts[f[2]]);
          if (b && b.every((x) => x > -1e-6))
            return b[0] * S.hn[f[0]] + b[1] * S.hn[f[1]] + b[2] * S.hn[f[2]];
        }
        return 0;
      };
    } else {
      const m = body && panelMesh(p);
      if (m) {
        const Q = m.pts.map((w) => toW(w));
        s.tris = m.tris.map((f) => [Q[f[0]], Q[f[1]], Q[f[2]], false, f.map((k) => m.pts[k])]);
      } else {
        s.poly = s.outline;
        s.polyW = panelPts(p);
      }
    }
    return s;
  });
}

export function fit3d() {
  const v = app.view3d,
    S = scene(),
    pts = S.flatMap((s) => s.outline);
  if (app.body) for (const q of app.body.mesh.verts) pts.push(q);
  if (!pts.length) return render3d();
  const P = pts.map((q) => project(q, v)),
    xs = P.map((q) => q[0]),
    ys = P.map((q) => q[1]);
  v.c = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  v.half = 0.56 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 10);
  v.fitted = true;
  render3d();
}

let frame = 0,
  timer = 0,
  picks = [], // drawn faces, back to front: { pid | null, P: projected polygon, W: its 2D canvas points }
  apexes = []; // drawn dart apexes: { X: projected, pid, did, sel }
// Redraw on the next animation frame (2D pointer moves call this often; one draw per frame is enough). The timeout
// is a fallback for when animation frames are throttled (hidden window), so the view never stays stale.
export function render3d() {
  if (frame) return;
  frame = requestAnimationFrame(draw);
  timer = setTimeout(draw, 120);
}

function draw() {
  cancelAnimationFrame(frame);
  clearTimeout(timer);
  frame = 0;
  const cv = $('#view3d'),
    v = app.view3d,
    dpr = window.devicePixelRatio || 1,
    wpx = cv.clientWidth || 1,
    hpx = cv.clientHeight || 1;
  if (cv.width !== Math.round(wpx * dpr) || cv.height !== Math.round(hpx * dpr)) {
    cv.width = Math.round(wpx * dpr);
    cv.height = Math.round(hpx * dpr);
  }
  const ctx = cv.getContext('2d'),
    asp = wpx / hpx,
    hw = v.half * Math.max(1, asp),
    hv = v.half * Math.max(1, 1 / asp),
    u = (2 * hw) / wpx; // world units per CSS pixel
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.setTransform(dpr / u, 0, 0, dpr / u, (-(v.c[0] - hw) * dpr) / u, (-(v.c[1] - hv) * dpr) / u);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  picks = [];
  const S = scene(),
    body = app.body;
  if (!S.length && !body) {
    $('#hint3d').textContent = 'No panels. Open a GarmentCode specification to see its 3D placement.';
    return;
  }
  const flat = !body && app.state.panels.every((p) => !p.place.t[2] && !p.place.rot.some(Boolean));
  let hint = (flat ? 'This pattern has no 3D placement (every panel lies in z = 0). ' : '') + HINT3D;

  // Floor grid (10 cm) under everything, and the vertical axis through the origin.
  const all = S.flatMap((s) => s.outline);
  if (body) all.push(...body.mesh.verts.filter((_, i) => i % 50 === 0));
  const ext = (k) => [Math.min(...all.map((q) => q[k])), Math.max(...all.map((q) => q[k]))],
    y0 = body ? 0 : ext(1)[0] - 5,
    [xa, xb] = ext(0),
    [za, zb] = ext(2),
    g0 = (a) => Math.floor((a - 10) / 10) * 10,
    g1 = (b) => Math.ceil((b + 10) / 10) * 10,
    line = (a, b) => {
      const A = project(a, v),
        B = project(b, v);
      ctx.moveTo(A[0], A[1]);
      ctx.lineTo(B[0], B[1]);
    };
  ctx.strokeStyle = css('--mat-major');
  ctx.lineWidth = u;
  ctx.beginPath();
  for (let x = g0(xa); x <= g1(xb); x += 10) line([x, y0, g0(za)], [x, y0, g1(zb)]);
  for (let z = g0(za); z <= g1(zb); z += 10) line([g0(xa), y0, z], [g1(xb), y0, z]);
  ctx.stroke();
  if (!body) {
    ctx.setLineDash([4 * u, 4 * u]);
    ctx.beginPath();
    line([0, y0, 0], [0, ext(1)[1] + 5, 0]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const fr = project([0, y0, g1(zb)], v);
  ctx.fillStyle = css('--mat-major');
  ctx.font = `${11 * u}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('front (+z)', fr[0], fr[1] + 14 * u);

  // Faces: { d (depth), P (projected), fill, stroke?, lw?, pid }. Body faces are culled when facing away.
  const cd = camDir(v),
    F = [],
    selId = app.sel && app.sel.kind === 'panel' ? app.sel.id : null,
    ink = css('--ink'),
    pocket = hexRgb(css('--pocket-face'));
  if (body) {
    const V = body.mesh.verts,
      PV = V.map((q) => project(q, v)),
      skin = hexRgb(css('--body-face'));
    for (const f of body.mesh.faces) {
      const a = V[f[0]],
        nn = cross3(sub3(V[f[1]], a), sub3(V[f[2]], a)),
        ln = Math.hypot(...nn) || 1;
      if (dot3(nn, cd) <= 0) continue;
      const k = 0.55 + 0.45 * Math.abs(dot3(nn, LIGHT) / ln),
        c = shade(skin, k);
      F.push({
        d: (PV[f[0]][2] + PV[f[1]][2] + PV[f[2]][2]) / 3,
        P: [PV[f[0]], PV[f[1]], PV[f[2]]],
        fill: c,
        stroke: c,
        lw: 0.6 * u,
        pid: null,
      });
    }
  }
  let cones = 0;
  for (const s of S) {
    const tint = hexRgb(TINTS[s.p.tint % TINTS.length]),
      pid = s.p.id;
    if (s.cone) cones++;
    if (s.tris)
      for (const [A, B, C, pk, W] of s.tris) {
        const nn = cross3(sub3(B, A), sub3(C, A)),
          ln = Math.hypot(...nn) || 1,
          facing = dot3(nn, cd) / ln,
          k = (0.62 + 0.38 * Math.abs(dot3(nn, LIGHT) / ln)) * (facing < 0 ? 0.82 : 1),
          P = [A, B, C].map((q) => project(q, v)),
          c = shade(pk ? pocket : tint, k);
        // Fabric sits a little in front of the body faces beside it (painter's order by centroid depth).
        F.push({ d: (P[0][2] + P[1][2] + P[2][2]) / 3 + 0.3, P, W, fill: c, stroke: c, lw: 0.5 * u, pid });
      }
    else {
      const P = s.poly.map((q) => project(q, v)),
        R = eulerToMat(s.p.place.rot),
        back = R[0][2] * cd[0] + R[1][2] * cd[1] + R[2][2] * cd[2] < 0;
      F.push({
        d: P.reduce((a, q) => a + q[2], 0) / P.length,
        P,
        W: s.polyW,
        fill: shade(tint, back ? 0.8 : 1),
        stroke: ink,
        lw: (pid === selId ? 2.6 : 1.3) * u,
        alpha: 0.92,
        pid,
      });
    }
  }
  // Stitched edges as coloured strokes, one segment per item so they sort with the faces around them.
  const EI = app.opts.stitch ? edgeIndex() : null,
    byPid = new Map(S.map((s) => [s.p.id, s]));
  if (EI)
    app.state.stitches.forEach((st, si) => {
      if (!st.e.every((e) => EI.get(e))) return;
      const col = STITCH_COLORS[si % STITCH_COLORS.length];
      for (const eid of st.e) {
        const { p, e } = EI.get(eid),
          s = byPid.get(p.id),
          P = edgeSample(e).map((q) => project(s.toW(q), v));
        for (let i = 0; i + 1 < P.length; i++)
          F.push({ d: (P[i][2] + P[i + 1][2]) / 2 + 0.6, P: [P[i], P[i + 1]], line: col, lw: 3 * u });
      }
    });
  // Darts: each cut line from the apex to the edge, on the panel as drawn (on the cone surface of a cone panel; its
  // main dart where it was solved), plus the apex. The dart being inserted (shared with 2D) is previewed the same way.
  const danger = css('--danger'),
    gold = css('--dart-gold'),
    // The cut runs across the reference outline, where sewn darts are closed (as the solver casts it); a sewn
    // dart's apex lies on the pre-cut outline, so a ray across that would find no edge. Returns the apex projected.
    cutLine = (s, a, ang, col, lw, dash) => {
      const r = rayCut(panelOutline(s.p).vertices.map(toCanvas), a, ang),
        A = project(s.toW(a, s.height(a)), v);
      if (!r) return A;
      const N = 16,
        P = [];
      for (let i = 0; i <= N; i++) {
        const w = [a[0] + ((r.point[0] - a[0]) * i) / N, a[1] + ((r.point[1] - a[1]) * i) / N];
        P.push(project(s.toW(w, s.height(w)), v));
      }
      for (let i = 0; i < N; i++)
        F.push({ d: (P[i][2] + P[i + 1][2]) / 2 + 0.8, P: [P[i], P[i + 1]], line: col, lw, dash });
      return A;
    };
  apexes = [];
  for (const s of S)
    for (const d of s.p.darts || []) {
      const res = dartResult(s.p, d).res,
        main = s.cone && d === ((s.p.darts || []).find((x) => x.id === app.dartSel) || s.p.darts[0]),
        pose = main && res && res.pose ? solvedPose(s.p, res) : d,
        sel = d.id === app.dartSel,
        A = cutLine(s, pose.at, pose.cut, sel ? gold : danger, (sel ? 3 : 2) * u, !main);
      apexes.push({ X: A, pid: s.p.id, did: d.id, sel, d: A[2] });
    }
  const dr = app.draft && app.draft.type === 'dart' ? app.draft : null,
    ds = dr && S.find((s) => s.p.id === dr.pid);
  if (ds) {
    const a = dr.pts[0],
      h = app.hover,
      A =
        h &&
        Math.hypot(h[0] - a[0], h[1] - a[1]) > 1e-6 &&
        cutLine(ds, a, Math.atan2(h[1] - a[1], h[0] - a[0]), gold, 2.5 * u, true);
    apexes.push({
      X: A || project(ds.toW(a, ds.height(a)), v),
      pid: ds.p.id,
      did: null,
      sel: true,
      draft: true,
    });
  }
  // Dart apexes sort with the faces (a back panel's apex hides behind the body); the draft's stays on top.
  for (const a of apexes) if (!a.draft) F.push({ d: a.d + 1, dot: a });
  F.sort((a, b) => a.d - b.d);
  for (const f of F) {
    if (f.dot) {
      const a = f.dot;
      ctx.beginPath();
      ctx.arc(a.X[0], a.X[1], (a.sel ? 5 : 4) * u, 0, 2 * Math.PI);
      ctx.fillStyle = a.sel ? gold : danger;
      ctx.fill();
      ctx.lineWidth = 1.2 * u;
      ctx.strokeStyle = css('--paper');
      ctx.stroke();
      a.after = picks.length; // faces drawn after it may cover it (see pickApex)
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(f.P[0][0], f.P[0][1]);
    for (let i = 1; i < f.P.length; i++) ctx.lineTo(f.P[i][0], f.P[i][1]);
    if (f.line) {
      ctx.strokeStyle = f.line;
      ctx.lineWidth = f.lw;
      if (f.dash) ctx.setLineDash([3 * u, 2.5 * u]);
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    ctx.closePath();
    ctx.globalAlpha = f.alpha || 1;
    ctx.fillStyle = f.fill;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = f.stroke;
    ctx.lineWidth = f.lw;
    ctx.stroke();
    picks.push({ pid: f.pid, P: f.P, W: f.W });
  }

  // Overlays: outline of the selected panel and of every cone panel, stitch connectors, labels.
  for (const s of S) {
    const sel = s.p.id === selId;
    if (!sel && !(s.cone && !body)) continue;
    const P = s.outline.map((q) => project(q, v));
    ctx.beginPath();
    P.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.closePath();
    ctx.strokeStyle = sel ? css('--sel') : ink;
    ctx.globalAlpha = sel ? 1 : 0.55;
    ctx.lineWidth = (sel ? 2 : 1) * u;
    ctx.setLineDash([4 * u, 3 * u]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  if (EI)
    app.state.stitches.forEach((st, si) => {
      const [A, B] = st.e.map((e) => EI.get(e));
      if (!A || !B) return;
      const col = STITCH_COLORS[si % STITCH_COLORS.length],
        PA = edgeSample(A.e),
        PB = edgeSample(B.e),
        sa = byPid.get(A.p.id),
        sb = byPid.get(B.p.id);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6 * u;
      ctx.setLineDash([5 * u, 4 * u]);
      ctx.beginPath();
      for (const f of [0, 0.5, 1]) line(sa.toW(pointAtFrac(PA, f)), sb.toW(pointAtFrac(PB, 1 - f)));
      ctx.stroke();
      ctx.setLineDash([]);
      const m = project(sa.toW(pointAtFrac(PA, 0.5)), v),
        m2 = project(sb.toW(pointAtFrac(PB, 0.5)), v),
        c = [(m[0] + m2[0]) / 2, (m[1] + m2[1]) / 2];
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(c[0], c[1], 8.5 * u, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${(si >= 99 ? 8 : 10) * u}px system-ui, sans-serif`;
      ctx.fillText(String(si + 1), c[0], c[1] + 3.5 * u);
    });
  ctx.font = `600 ${11 * u}px system-ui, sans-serif`;
  ctx.lineWidth = 3 * u;
  ctx.strokeStyle = css('--bg');
  ctx.fillStyle = css('--fg');
  for (const s of S) {
    const c = project(
      [0, 1, 2].map((k) => s.outline.reduce((a, q) => a + q[k], 0) / s.outline.length),
      v,
    );
    ctx.strokeText(s.p.name, c[0], c[1]);
    ctx.fillText(s.p.name, c[0], c[1]);
  }

  for (const a of apexes.filter((x) => x.draft)) {
    ctx.beginPath();
    ctx.arc(a.X[0], a.X[1], (a.sel ? 5 : 4) * u, 0, 2 * Math.PI);
    ctx.fillStyle = a.sel ? gold : danger;
    ctx.fill();
    ctx.lineWidth = 1.2 * u;
    ctx.strokeStyle = css('--paper');
    ctx.stroke();
  }

  if (body) {
    const n = { torso: 0, arm: 0, leg: 0 };
    for (const s of S) n[s.cls.part]++;
    const parts = Object.entries(n)
      .filter(([, k]) => k)
      .map(([k, c]) => `${c} ${PART[k]}`)
      .join(', ');
    hint = `Body ${body.id}${body.levels.source === 'measurements' ? '' : ' (heights estimated, no measurements)'}: ${parts} panels placed by name${cones ? `, ${cones} darted as cones` : ''}. ${HINT3D}`;
  } else if (cones)
    hint = `${cones} panel${cones > 1 ? 's' : ''} shown as intrinsic-dart cone surfaces (dashed: flat panel). ${hint}`;
  if (app.tool === 'dart')
    hint = dr
      ? 'Insert dart: click toward the edge where the dart opens (in either view). Esc cancels.'
      : 'Insert dart: click the apex on a panel, here or in 2D. Drag still orbits.';
  if (app.tool === 'erase') hint = 'Erase: click a dart apex to delete the dart. Drag still orbits.';
  if (app.bodyNote) hint = `${app.bodyNote} ${hint}`;
  $('#hint3d').textContent = hint;
  pick.u = u;
  pick.o = [v.c[0] - hw, v.c[1] - hv];
}

// Topmost drawn face under a canvas point (CSS px): { pid (null for the body), w (the 2D canvas point there, on
// fabric), to2d (screen px -> 2D canvas point on that face's plane, valid beyond the face) }, or null for empty space.
// The camera is orthographic, so screen and panel plane are related affinely: barycentric coordinates carry over.
function pick(x, y) {
  const X = pick.o[0] + x * pick.u,
    Y = pick.o[1] + y * pick.u;
  for (let i = picks.length - 1; i >= 0; i--) {
    const P = picks[i].P;
    let inside = false;
    for (let a = 0, b = P.length - 1; a < P.length; b = a++)
      if (
        P[a][1] > Y !== P[b][1] > Y &&
        X < ((P[b][0] - P[a][0]) * (Y - P[a][1])) / (P[b][1] - P[a][1]) + P[a][0]
      )
        inside = !inside;
    if (!inside) continue;
    const { pid, W } = picks[i];
    if (!pid || !W) return { pid, w: null, to2d: null };
    // The widest corner triple (a polygon is planar, so any non-degenerate one gives the same map).
    let best = null,
      ba = 0;
    for (let j = 1; j + 1 < P.length; j++) {
      const ar = Math.abs(
        (P[j][0] - P[0][0]) * (P[j + 1][1] - P[0][1]) - (P[j + 1][0] - P[0][0]) * (P[j][1] - P[0][1]),
      );
      if (ar > ba) ((ba = ar), (best = j));
    }
    if (!best) return { pid, w: null, to2d: null };
    const T = [0, best, best + 1],
      to2d = (sx, sy) => {
        const b = bary([pick.o[0] + sx * pick.u, pick.o[1] + sy * pick.u], ...T.map((k) => P[k]));
        return b && [0, 1].map((c) => b[0] * W[T[0]][c] + b[1] * W[T[1]][c] + b[2] * W[T[2]][c]);
      };
    return { pid, w: to2d(x, y), to2d };
  }
  return null;
}
// Whether a face painted after apex a covers it (it is hidden behind fabric or the body).
function covered(a) {
  for (let i = a.after ?? picks.length; i < picks.length; i++) {
    const P = picks[i].P;
    let inside = false;
    for (let j = 0, k = P.length - 1; j < P.length; k = j++)
      if (
        P[j][1] > a.X[1] !== P[k][1] > a.X[1] &&
        a.X[0] < ((P[k][0] - P[j][0]) * (a.X[1] - P[j][1])) / (P[k][1] - P[j][1]) + P[j][0]
      )
        inside = !inside;
    if (inside) return true;
  }
  return false;
}
// Dart apex under a canvas point (CSS px), topmost first, within 8 px.
function pickApex(x, y) {
  const X = pick.o[0] + x * pick.u,
    Y = pick.o[1] + y * pick.u;
  let best = null;
  for (const a of apexes)
    if (a.did && Math.hypot(a.X[0] - X, a.X[1] - Y) < 8 * pick.u && (!best || a.d > best.d) && !covered(a))
      best = a;
  return best;
}
pick.u = 1;
pick.o = [0, 0];

// Show or hide the 3D pane. Both panes change size, so both are refitted.
export function setView3d(on) {
  app.view3d.on = on;
  document.querySelector('main').classList.toggle('show3d', on);
  $('#view-3d').setAttribute('aria-pressed', on);
  fit();
  renderAll();
}

// A click (no orbit) in 3D: the Insert dart tool places the apex, then the cut; the Erase tool deletes the dart whose
// apex it hits; otherwise a dart apex selects that dart, a panel selects the panel. Everything edits app.state / app.draft, so the 2D view follows.
function click(x, y) {
  const dr = app.draft && app.draft.type === 'dart' ? app.draft : null;
  if (app.tool === 'erase') {
    const ap = pickApex(x, y),
      p = ap && app.state.panels.find((q) => q.id === ap.pid),
      d = p && p.darts.find((q) => q.id === ap.did);
    if (d) deleteDart(p, d);
    return;
  }
  if (app.tool === 'dart') {
    const hit = pick(x, y);
    if (!dr) {
      if (!hit || !hit.pid || !hit.w) return toast('Click on a panel to place the dart apex.', true);
      app.draft = { type: 'dart', pid: hit.pid, pts: [hit.w], to2d: hit.to2d };
      app.hover = null;
      return render();
    }
    // Toward the cursor on the apex's panel plane (also off the panel), or a point on that panel when the draft was
    // started in 2D.
    const toward = dr.to2d ? dr.to2d(x, y) : hit && hit.pid === dr.pid ? hit.w : null;
    if (!toward) return toast('Click on the same panel, toward the edge where the dart opens.', true);
    const err = insertDart(
      app.state.panels.find((p) => p.id === dr.pid),
      dr.pts[0],
      toward,
    );
    if (err) toast(err, true);
    app.draft = null;
    return render();
  }
  const ap = pickApex(x, y);
  if (ap) {
    app.sel = { kind: 'panel', id: ap.pid };
    app.dartSel = ap.did;
    return renderAll();
  }
  const hit = pick(x, y);
  app.sel = hit && hit.pid ? { kind: 'panel', id: hit.pid } : null;
  renderAll();
}

export function initView3d() {
  const cv = $('#view3d'),
    v = app.view3d;
  $('#view-3d').onclick = () => setView3d(!v.on);
  $('#fit3d').onclick = () => fit3d();
  // Height slider: moves every panel up or down in 3D (view state, not an edit: no undo step, the pattern and its
  // exported placement are unchanged). The reset button under it (or a double-click) puts it back to 0.
  const lift = $('#lift3d'),
    liftVal = $('#lift3d-val'),
    setLift = (cm) => {
      v.lift = cm;
      lift.value = cm;
      liftVal.innerHTML = `${cm > 0 ? '+' : ''}${cm.toFixed(1)}<br>cm`;
      render3d();
    };
  lift.addEventListener('input', () => setLift(parseFloat(lift.value) || 0));
  lift.addEventListener('dblclick', () => setLift(0));
  $('#lift3d-reset').onclick = () => setLift(0);
  setLift(v.lift || 0);
  new ResizeObserver(() => app.view3d.on && render3d()).observe(cv);
  let drag = null;
  cv.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: false, pan: e.shiftKey || e.button === 1 };
    // Pressing a dart apex (any tool but erase, no dart being inserted) selects the dart; dragging it moves the whole
    // dart, as in 2D (same app.drag, one undo step, live re-solve) instead of orbiting.
    const dr = app.draft && app.draft.type === 'dart';
    if (!drag.pan && e.button === 0 && app.tool !== 'erase' && !dr) {
      const [x, y] = local(e),
        ap = pickApex(x, y),
        p = ap && app.state.panels.find((q) => q.id === ap.pid),
        d = p && p.darts.find((q) => q.id === ap.did),
        hit = d && pick(x, y),
        to2d = hit && hit.pid === p.id && hit.to2d;
      if (d) {
        app.sel = { kind: 'panel', id: p.id };
        app.dartSel = d.id;
        // The grab offset keeps the apex where it was under the cursor; to2d is the fallback map off the panel.
        const w = to2d ? to2d(x, y) : d.at;
        drag.dart = { p, d, to2d, grab: [w[0] - d.at[0], w[1] - d.at[1]] };
        app.drag = { mode: 'dart', pid: p.id, did: d.id, snap: snapshot(), moved: false };
        renderAll();
      }
    }
    try {
      cv.setPointerCapture(e.pointerId);
    } catch {
      // synthetic event without an active pointer
    }
    cv.classList.add('dragging');
  });
  const local = (e) => {
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  cv.addEventListener('pointermove', (e) => {
    // Inserting a dart: the cursor, mapped onto the draft's panel plane, is the shared hover point (2D previews it).
    if (!drag || !drag.moved) {
      const dr = app.draft && app.draft.type === 'dart' ? app.draft : null;
      if (dr) {
        const [x, y] = local(e),
          hit = dr.to2d ? null : pick(x, y),
          w = dr.to2d ? dr.to2d(x, y) : hit && hit.pid === dr.pid ? hit.w : null;
        if (w) {
          app.hover = w;
          render();
        }
      }
    }
    if (!drag) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.dart) {
      // The 2D point under the cursor on the dart's panel (exact on its faces, else the plane of the pressed face).
      const { p, d, to2d, grab } = drag.dart,
        [x, y] = local(e),
        hit = pick(x, y),
        w = hit && hit.pid === p.id && hit.w ? hit.w : to2d && to2d(x, y);
      if (w && moveDartTo(p, d, [w[0] - grab[0], w[1] - grab[1]])) {
        app.drag.moved = true;
        render();
      }
      return;
    }
    if (drag.pan) {
      const r = cv.getBoundingClientRect(),
        upx = (2 * v.half) / Math.min(r.width, r.height);
      v.c = [v.c[0] - dx * upx, v.c[1] - dy * upx];
    } else {
      v.yaw -= dx * 0.008;
      v.el = Math.min(Math.PI / 2 - 0.01, Math.max(-Math.PI / 2 + 0.01, v.el + dy * 0.008));
    }
    render3d();
  });
  const end = (e) => {
    if (!drag) return;
    cv.classList.remove('dragging');
    if (drag.dart) {
      // One undo step for the whole drag, as in 2D (ui/pointer.js endPointer).
      if (app.drag && app.drag.moved) {
        app.undoStack.push(app.drag.snap);
        app.redoStack = [];
        renderInspector();
      }
      app.drag = null;
    } else if (!drag.moved && e.type === 'pointerup') click(...local(e));
    drag = null;
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      v.half = Math.min(5000, Math.max(5, v.half * Math.exp(e.deltaY * 0.0015)));
      render3d();
    },
    { passive: false },
  );
}
