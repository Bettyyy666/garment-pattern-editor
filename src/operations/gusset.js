// Design operation: insert a gusset. Opens the seams that meet at a corner and sews in a diamond
// (four-panel junction such as the underarm: sleeve seam + side seam) or a triangle (seam that ends at a hem).
import { TINTS, VEPS } from '../config.js';
import { add, centroid, dist, mul, norm, sub } from '../geometry.js';
import { edgeLen, edgeSplit, paramAtFrac, paramAtPoint } from '../model/edges.js';
import { add3, cross3, dot3, matToEuler, mid3, mul3, norm3, sub3, world3D } from '../model/frame3d.js';
import { fromLocal, lineEdges, panelPts, translatePanel, uniqueName } from '../model/panels.js';
import { findEdge } from '../model/stitches.js';
import { saveSpec } from '../spec.js';
import { app, getMark, nid, pushHistory } from '../state.js';
import { $ } from '../ui/dom.js';
import { renderAll } from '../ui/inspector.js';
import { toast } from '../ui/toast.js';
import { esc } from '../util.js';
import { setTool } from '../ui/tools.js';

// A corner is { p, e, end }: edge e of panel p touches the corner at its `end` ('a' or 'b').
const cornerPt = (c) => c.e[c.end];
const stitchOf = (eid) => app.state.stitches.find((s) => s.e.includes(eid));
function other(c) {
  const n = c.p.edges.length,
    i = c.p.edges.indexOf(c.e);
  return c.end === 'b'
    ? { p: c.p, e: c.p.edges[(i + 1) % n], end: 'a' }
    : { p: c.p, e: c.p.edges[(i - 1 + n) % n], end: 'b' };
}
// The same corner seen from the edge stitched to c.e (stitched edges run in opposite directions).
function across(c) {
  const s = stitchOf(c.e.eid);
  if (!s) return null;
  const loc = findEdge(s.e[1 - s.e.indexOf(c.e.eid)]);
  return loc && loc.e !== c.e ? { p: loc.p, e: loc.e, end: c.end === 'a' ? 'b' : 'a' } : null;
}
export const gussetParams = () => ({
  len: Math.max(0.5, parseFloat($('#gs-len').value) || 10),
  width: Math.max(0.5, parseFloat($('#gs-width').value) || 7.5),
});

function pickPoint() {
  if (app.sel && app.sel.kind === 'mark') {
    const m = getMark(app.sel.id);
    if (m && m.type === 'point') return m;
  }
  const pts = app.state.marks.filter((m) => m.type === 'point');
  return pts.length === 1 ? pts[0] : null;
}
// Work out what the gusset would do, without changing anything. Returns { err } or a plan.
export function resolveGusset() {
  const m = pickPoint();
  if (!m)
    return {
      err: 'Place a <b>point</b> on the seam to open (e.g. the sleeve underarm seam), close to the armpit corner, and select it.',
    };
  // panels overlap on the canvas, so look at the stitched edges of every panel (the mark's own panel wins ties)
  const P = m.pts[0];
  let best = null;
  for (const p of app.state.panels)
    for (const e of p.edges) {
      if (!stitchOf(e.eid)) continue;
      const d = paramAtPoint(e, P).d - (p.id === m.panelId ? 1e-6 : 0);
      if (!best || d < best.d) best = { p, e, d };
    }
  if (!best || best.d > 1.5)
    return {
      err: `<b>${esc(m.label)}</b> is not on a stitched seam. Place it on the seam to open.`,
      m,
    };
  const p0 = best.p,
    x0 = {
      p: p0,
      e: best.e,
      end: dist(P, best.e.a) <= dist(P, best.e.b) ? 'a' : 'b',
    };
  const x1 = across(x0);
  if (!x1)
    return {
      err: `That edge of <b>${esc(p0.name)}</b> is not stitched to another edge.`,
      m,
    };
  const y0 = other(x0),
    y1 = other(x1),
    a0 = across(y0),
    a1 = across(y1);
  if (!a0 && !a1) return { m, kind: 'triangle', seams: [[x0, x1]] };
  if (!a0 || !a1) return { err: 'Only one side of this seam continues past the corner.', m };
  const x2 = other(a1),
    x3 = across(x2);
  if (!x3)
    return {
      err: `The seam on <b>${esc(x2.p.name)}</b> at this corner is not stitched.`,
      m,
    };
  const y3 = other(x3),
    back = across(y3);
  if (!back || back.e !== y0.e)
    return {
      err: 'The seams at this corner do not form a four-panel junction (like the underarm).',
      m,
    };
  return {
    m,
    kind: 'diamond',
    seams: [
      [x0, x1],
      [x2, x3],
    ],
    keep: [y0, y1],
  };
}

// Unpick the seam between corner c (on c.e) and its partner cp for length L from the corner.
// Returns the two freed pieces that touch the corner; the rest of the seam stays stitched.
function openSeam(c, cp, L) {
  const st = stitchOf(c.e.eid),
    side = st.e.indexOf(c.e.eid),
    Lc = edgeLen(c.e);
  app.state.stitches = app.state.stitches.filter((s) => s !== st);
  const g = L / Lc;
  if (Lc - L < VEPS) return { near: c.e, nearP: cp.e };
  const f = c.end === 'b' ? 1 - g : g,
    [A, B] = edgeSplit(c.e, paramAtFrac(c.e, f)),
    [Y1, Y2] = edgeSplit(cp.e, paramAtFrac(cp.e, 1 - f));
  c.p.edges.splice(c.p.edges.indexOf(c.e), 1, A, B);
  cp.p.edges.splice(cp.p.edges.indexOf(cp.e), 1, Y1, Y2);
  const near = c.end === 'b' ? B : A,
    nearP = cp.end === 'a' ? Y1 : Y2,
    s = { sid: nid('s'), e: [] };
  s.e[side] = near === A ? B.eid : A.eid;
  s.e[1 - side] = nearP === Y1 ? Y2.eid : Y1.eid;
  if (st.cut) s.cut = true;
  app.state.stitches.push(s);
  return { near, nearP };
}
const tipOf = (edge, end) => (end === 'b' ? edge.a : edge.b);

export function insertGusset() {
  const plan = resolveGusset();
  if (plan.err) {
    toast(plan.err.replace(/<[^>]+>/g, ''), true);
    return;
  }
  const { len, width } = gussetParams();
  const shortest = Math.min(...plan.seams.flat().map((c) => edgeLen(c.e)));
  if (Math.min(len, shortest) < 2 * VEPS) {
    toast('The gusset opening is too short.', true);
    return;
  }
  pushHistory();
  const stBefore = app.state.stitches.length,
    notes = [];
  // 1. open each seam from the corner
  const opened = plan.seams.map(([c, cp]) => {
    const L = Math.min(len, edgeLen(c.e), edgeLen(cp.e));
    if (L < len - 1e-6) notes.push(`opening on ${c.p.name} limited to ${L.toFixed(1)} cm (edge length)`);
    const corner = [world3D(c.p, cornerPt(c)), world3D(cp.p, cornerPt(cp))];
    const r = openSeam(c, cp, L);
    return {
      c,
      cp,
      ...r,
      len: (edgeLen(r.near) + edgeLen(r.nearP)) / 2,
      // direction from the corner to the end of the opening, averaged over both sides of the seam
      dir3: norm3(
        add3(
          norm3(sub3(world3D(c.p, tipOf(r.near, c.end)), corner[0])),
          norm3(sub3(world3D(cp.p, tipOf(r.nearP, cp.end)), corner[1])),
        ),
      ),
      corner,
    };
  });
  // 2. gusset outline in GarmentCode local coordinates (y up). Qa/Qb are the side corners of the opening.
  const X = opened[0],
    Z = opened[1],
    minLen = Math.min(...opened.map((o) => o.len));
  let w = width;
  if (w > 1.8 * minLen) {
    w = 1.8 * minLen;
    notes.push(`width limited to ${w.toFixed(1)} cm`);
  }
  const s = X.c.end === 'b' ? 1 : -1,
    hx = Math.sqrt(X.len ** 2 - (w * w) / 4),
    Qa = [(s * w) / 2, 0],
    Qb = [(-s * w) / 2, 0],
    TX = [0, hx];
  let loc, partners;
  if (Z) {
    const TZ = [0, -Math.sqrt(Z.len ** 2 - (w * w) / 4)];
    // Qa joins P0 and the panel of Z's partner edge; Qb joins X's partner panel and Z's panel
    loc = s > 0 ? [Qa, TX, Qb, TZ] : [TX, Qa, TZ, Qb];
    partners = s > 0 ? [X.near, X.nearP, Z.near, Z.nearP] : [X.near, Z.nearP, Z.near, X.nearP];
  } else {
    loc = s > 0 ? [Qa, TX, Qb] : [TX, Qa, Qb];
    partners = s > 0 ? [X.near, X.nearP, null] : [X.near, null, X.nearP];
  }
  // 3. 3D frame: local x towards Qa, local y along the opened seams (towards the first seam's tip),
  // normal = x × y. Directions are used rather than positions, because the initial 3D placement of
  // neighbouring panels (e.g. sleeve and bodice) can overlap; the simulator pulls the stitches together.
  const qa3 = Z ? mid3(X.corner[0], Z.corner[1]) : X.corner[0],
    qb3 = Z ? mid3(X.corner[1], Z.corner[0]) : X.corner[1],
    c3 = mid3(qa3, qb3),
    xa = norm3(sub3(qa3, qb3)),
    yr = Z ? sub3(X.dir3, Z.dir3) : X.dir3,
    ya = norm3(sub3(yr, mul3(xa, dot3(yr, xa)))),
    za = cross3(xa, ya),
    R = [0, 1, 2].map((i) => [xa[i], ya[i], za[i]]),
    place = { t: c3, rot: matToEuler(R), ox: 0, oy: 0 };
  const p0 = plan.seams[0][0].p,
    edges = lineEdges(loc.map((v) => fromLocal(place, v))),
    g = {
      id: nid('p'),
      name: uniqueName(`${p0.name}_gusset`),
      edges,
      tint: app.tintN++ % TINTS.length,
      place,
      label: p0.label || null,
    };
  app.state.panels.push(g);
  edges.forEach((e, i) => {
    if (partners[i]) app.state.stitches.push({ sid: nid('s'), e: [e.eid, partners[i].eid] });
  });
  // 4. 2D layout only: put the gusset next to the corner, outside the clicked panel
  const cpt = cornerPt(plan.seams[0][0]),
    out = norm(sub(cpt, centroid(panelPts(p0)))),
    gc = centroid(panelPts(g));
  translatePanel(g, sub(add(cpt, mul(out, hx + 3)), gc));
  app.state.marks = app.state.marks.filter((x) => x.id !== plan.m.id);
  app.sel = { kind: 'panel', id: g.id };
  setTool('select');
  renderAll();
  saveSpec();
  toast(
    `Inserted ${plan.kind} gusset ${g.name} (${w.toFixed(1)} cm wide). Stitches: ${stBefore} → ${app.state.stitches.length}.${notes.length ? ' Note: ' + notes.join('; ') + '.' : ''} Specification saved (v${app.spec.version}).`,
  );
}
