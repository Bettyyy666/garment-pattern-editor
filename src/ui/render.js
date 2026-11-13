// SVG rendering of the canvas (grid, panels, stitches, marks, drafts).
import { STITCH_COLORS, TINTS } from '../config.js';
import { add, centroid, crSample, mul, norm, pathLen, pointAtFrac, sub } from '../geometry.js';
import { edgeSample } from '../model/edges.js';
import { dartResult, solvedPose } from '../io/dart-results.js';
import { panelOutline, toCanvas } from '../model/dart-solve.js';
import { postCutEdges } from '../model/post-cut.js';
import { rayCut } from '../model/intrinsic.js';
import { markPts } from '../model/marks.js';
import { dPanel, panelPts } from '../model/panels.js';
import { edgeIndex } from '../model/stitches.js';
import { app } from '../state.js';
import { $, world } from './dom.js';
import { constrain } from './snapping.js';
import { rect } from './viewport.js';
import { render3d } from './view3d.js';
import { dPath, esc, f3 } from '../util.js';

export function hoverPt() {
  return app.lastEvt && app.lastEvt.shiftKey && app.draft && app.draft.pts.length
    ? constrain(app.draft.pts[app.draft.pts.length - 1], app.hover)
    : app.snapInfo
      ? app.snapInfo.pt
      : app.hover;
}
// Stitched edges, coloured per stitch. On a darted panel they follow its post-cut outline (the panel as drawn);
// a sewn dart's own leg stitch has no post-cut edge (the dart is closed there) and is not drawn.
export function renderStitches(px, EI) {
  let h = '';
  const selP = app.sel && app.sel.kind === 'panel' ? app.sel.id : null,
    post = new Map(); // panel id -> { edges: Map eid -> polylines, c: post-cut centroid } | null
  const onPanel = (L) => {
    if (!post.has(L.p.id)) {
      const md = mainDart(L.p),
        o = md && opening(L.p, md),
        E = o && postCutEdges(L.p, panelOutline(L.p), o.P, o.cut);
      post.set(L.p.id, E ? { edges: E, c: centroid([o.at, ...o.P]) } : null);
    }
    const pc = post.get(L.p.id);
    return pc ? { lines: pc.edges.get(L.e.eid) || [], c: pc.c } : { lines: [edgeSample(L.e)], c: null };
  };
  app.state.stitches.forEach((st, si) => {
    const locs = st.e.map((e) => EI.get(e));
    if (locs.some((x) => !x)) return;
    const col = STITCH_COLORS[si % STITCH_COLORS.length];
    const hi = selP && locs.some((l) => l.p.id === selP);
    locs.forEach((L) => {
      const { lines, c: pcC } = onPanel(L);
      if (!lines.length) return;
      for (const P of lines)
        h += `<path d="${dPath(P, false)}" fill="none" stroke="${col}" stroke-width="${hi ? 4.5 : 3.2}" stroke-dasharray="${st.cut ? '2 4' : '7 4'}" stroke-linecap="round" vector-effect="non-scaling-stroke" style="pointer-events:none"/>`;
      const P = lines.reduce((a, b) => (pathLen(b) > pathLen(a) ? b : a)),
        m = pointAtFrac(P, 0.5),
        c = pcC || centroid(panelPts(L.p)),
        q = add(m, mul(norm(sub(c, m)), px(12)));
      h += `<circle cx="${f3(q[0])}" cy="${f3(q[1])}" r="${px(8.5)}" fill="${col}" style="pointer-events:none"/><text class="stitch-tag" x="${f3(q[0])}" y="${f3(q[1] + px(3.5))}" font-size="${px(si >= 99 ? 8 : 10)}" text-anchor="middle">${si + 1}</text>`;
    });
  });
  return h;
}
// A dart's solved opening: intrinsic-dart develop()'s developed outline (c+ ... c-), placed at the apex and turned
// by the cut angle the solve was made for (solvedPose), or null before a solve arrives. Closed through that apex it
// is the whole post-cut panel: { P, at, cut (develop's cut on the outline), current }.
const ptxt = (q) => `${f3(q[0])} ${f3(q[1])}`;
function opening(p, d) {
  const { res, current } = dartResult(p, d);
  if (!res || !res.dev) return null;
  const { at: a, cut } = solvedPose(p, res),
    t = -cut,
    c = Math.cos(t),
    s = Math.sin(t);
  return {
    P: res.dev.boundary.map(([x, y]) => add(a, toCanvas([x * c - y * s, x * s + y * c]))),
    at: a,
    cut: res.dev.cut,
    current,
  };
}
// The dart whose post-cut outline stands for a darted panel: the selected dart if it is on the panel, else its
// first (the same one the 3D view shows as a cone surface).
const mainDart = (p) => {
  const D = p.darts || [];
  return D.find((x) => x.id === app.dartSel) || D[0];
};
// One dart: its opening wedge and apex (the opening of the panel's main dart is the panel shape itself; the solver
// opens one dart at a time, so other darts show only their wedge). Before a solve arrives, the reference cut.
function renderDart(p, d, px) {
  const a = d.at,
    sel = app.dartSel === d.id,
    { res, current } = dartResult(p, d),
    o = opening(p, d);
  let h = '';
  if (o) {
    const P = o.P;
    h += `<path class="dart-wedge${current ? '' : ' stale'}" d="M${ptxt(P[0])}L${ptxt(o.at)}L${ptxt(P[P.length - 1])}Z" stroke-width="1.6" vector-effect="non-scaling-stroke" style="pointer-events:none"/>`;
  } else {
    const r = rayCut(panelPts(p), a, d.cut);
    if (r)
      h += `<path class="dart-cut" d="M${ptxt(a)}L${ptxt(r.point)}" stroke-width="1.6" vector-effect="non-scaling-stroke" style="pointer-events:none"/>`;
  }
  const err = res && (res.error || res.offline) && current;
  h += `<circle class="dart-apex${sel ? ' sel' : ''}" data-did="${d.id}" data-dpid="${p.id}" cx="${f3(a[0])}" cy="${f3(a[1])}" r="${px(sel ? 5.5 : 4)}" stroke-width="${px(1.2)}"><title>Dart ${((d.defect * 180) / Math.PI).toFixed(1)}° · click to edit</title></circle>`;
  h += `<text class="dart-tag" x="${f3(a[0] + px(7))}" y="${f3(a[1] - px(7))}" font-size="${px(10)}" stroke-width="${px(3)}">${((d.defect * 180) / Math.PI).toFixed(0)}°${err ? ' !' : ''}</text>`;
  return h;
}
// Dart tool preview: the apex, then the cut from the apex toward the pointer, ending on the boundary.
function renderDartDraft(px) {
  const p = app.state.panels.find((x) => x.id === app.draft.pid),
    a = app.draft.pts[0];
  let h = '';
  if (p && app.hover) {
    const r = rayCut(panelPts(p), a, Math.atan2(app.hover[1] - a[1], app.hover[0] - a[0]));
    if (r)
      h += `<path class="dart-cut" d="M${ptxt(a)}L${ptxt(r.point)}" stroke-width="2" vector-effect="non-scaling-stroke"/><circle class="dart-apex" cx="${f3(r.point[0])}" cy="${f3(r.point[1])}" r="${px(3)}"/>`;
  }
  return (
    h + `<circle class="dart-apex" cx="${f3(a[0])}" cy="${f3(a[1])}" r="${px(5)}" stroke-width="${px(1.2)}"/>`
  );
}
export function render() {
  if (app.view3d.on) render3d();
  const s = app.view.s,
    px = (v) => v / s;
  world.setAttribute('transform', `translate(${f3(app.view.ox)} ${f3(app.view.oy)}) scale(${f3(s)})`);
  let h = '<defs>';
  if (app.opts.grid)
    h += `<pattern id="gmin" width="1" height="1" patternUnits="userSpaceOnUse"><path class="g-min" d="M1 0H0V1" fill="none" stroke-width="${px(1)}"/></pattern>
    <pattern id="gmaj" width="5" height="5" patternUnits="userSpaceOnUse"><path class="g-maj" d="M5 0H0V5" fill="none" stroke-width="${px(1.2)}"/></pattern>`;
  if (app.opts.sa)
    app.state.panels.forEach((p) => {
      h += `<mask id="mk-${p.id}" maskUnits="userSpaceOnUse" x="-5000" y="-5000" width="10000" height="10000"><rect x="-5000" y="-5000" width="10000" height="10000" fill="#fff"/><path d="${dPanel(p)}" fill="#000"/></mask>`;
    });
  h += '</defs>';
  if (app.opts.grid) {
    const r = rect(),
      x0 = Math.floor(-app.view.ox / s) - 5,
      y0 = Math.floor(-app.view.oy / s) - 5,
      w = r.width / s + 10,
      hh = r.height / s + 10;
    if (s >= 4) h += `<rect x="${x0}" y="${y0}" width="${f3(w)}" height="${f3(hh)}" fill="url(#gmin)"/>`;
    h += `<rect x="${Math.floor(x0 / 5) * 5}" y="${Math.floor(y0 / 5) * 5}" width="${f3(w + 5)}" height="${f3(hh + 5)}" fill="url(#gmaj)"/>`;
  }
  if (app.underlay && app.opts.under)
    h += `<image href="${app.underlay.src}" x="${f3(app.underlay.x)}" y="${f3(app.underlay.y)}" width="${f3(app.underlay.w)}" height="${f3(app.underlay.h)}" opacity=".45" preserveAspectRatio="none" style="pointer-events:none"/>`;
  const fo = app.underlay && app.opts.under ? 0.72 : 1;
  for (const p of app.state.panels) {
    const isSel = app.sel && app.sel.kind === 'panel' && app.sel.id === p.id,
      d = dPanel(p);
    if (app.opts.sa)
      h += `<path class="sa-band" d="${d}" fill="none" stroke-width="2" stroke-linejoin="round" mask="url(#mk-${p.id})"/>`;
    const md = mainDart(p),
      post = md && opening(p, md),
      fill = `fill:${TINTS[p.tint % TINTS.length]};fill-opacity:${fo}`;
    if (!post)
      h += `<path class="panel-shape${isSel ? ' sel' : ''}" data-pid="${p.id}" d="${d}" style="${fill}" stroke-width="${isSel ? 2.6 : 1.5}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
    else {
      // Darted panel: the post-cut outline (what the solver outputs) is the panel. The pre-cut outline still takes
      // clicks over its whole area (transparent, underneath) and is drawn on top as a faint dashed reference
      // (View > Pre-cut outline hides the reference).
      h += `<path class="panel-shape precut-hit" data-pid="${p.id}" d="${d}"/>`;
      h += `<path class="panel-shape postcut${isSel ? ' sel' : ''}${post.current ? '' : ' stale'}" data-pid="${p.id}" d="M${ptxt(post.at)}L${post.P.map(ptxt).join('L')}Z" style="${fill}" stroke-width="${isSel ? 2.6 : 1.5}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
      if (app.opts.precut)
        h += `<path class="precut${isSel ? ' sel' : ''}" d="${d}" stroke-width="1.2" stroke-dasharray="5 4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
    }
    if (app.opts.verts)
      p.edges.forEach(
        (e) => (h += `<circle class="vtx" cx="${f3(e.a[0])}" cy="${f3(e.a[1])}" r="${px(2.2)}"/>`),
      );
  }
  if (app.opts.stitch) h += renderStitches(px, edgeIndex());
  for (const p of app.state.panels) {
    const c = centroid(panelPts(p));
    h += `<text class="panel-label" x="${f3(c[0])}" y="${f3(c[1])}" font-size="${px(11)}" stroke-width="${px(3)}" text-anchor="middle">${esc(p.name)}</text>`;
  }
  for (const p of app.state.panels) for (const d of p.darts || []) h += renderDart(p, d, px);
  if (app.draft && app.draft.type === 'dart') h += renderDartDraft(px);
  for (const m of app.state.marks) {
    const isSel = app.sel && app.sel.kind === 'mark' && app.sel.id === m.id;
    if (m.type === 'point') {
      const q = m.pts[0];
      h += `<circle class="mk-dot${isSel ? ' sel' : ''}" cx="${f3(q[0])}" cy="${f3(q[1])}" r="${px(isSel ? 5.5 : 4.5)}" stroke-width="${px(1.5)}"/><circle class="mk-hitdot" data-mid="${m.id}" cx="${f3(q[0])}" cy="${f3(q[1])}" r="${px(10)}"/>`;
    } else {
      const P = markPts(m);
      h += `<path class="mk${isSel ? ' sel' : ''}" d="${dPath(P, false)}" stroke-width="${isSel ? 3 : 2.2}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
      for (const q of m.pts)
        h += `<circle class="mk-dot${isSel ? ' sel' : ''}" cx="${f3(q[0])}" cy="${f3(q[1])}" r="${px(m.type === 'curve' ? 2.8 : 3.5)}" stroke-width="${px(1)}"/>`;
      h += `<path class="mk-hit" data-mid="${m.id}" d="${dPath(P, false)}" stroke-width="14" vector-effect="non-scaling-stroke"/>`;
      if (app.opts.measure) {
        const mid = pointAtFrac(P, 0.5);
        h += `<text class="mk-len" x="${f3(mid[0] + px(8))}" y="${f3(mid[1] - px(8))}" font-size="${px(11)}" stroke-width="${px(3)}">${pathLen(P).toFixed(1)} cm</text>`;
      }
    }
  }
  if (app.draft && app.draft.type !== 'dart') {
    const pts = app.draft.pts.slice();
    if (app.hover) pts.push(hoverPt());
    const P = app.draft.type === 'curve' ? crSample(pts, 12) : pts;
    if (P.length > 1)
      h += `<path class="draft" d="${dPath(P, false)}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    app.draft.pts.forEach(
      (q) =>
        (h += `<circle class="mk-dot" cx="${f3(q[0])}" cy="${f3(q[1])}" r="${px(3.5)}" stroke-width="${px(1)}"/>`),
    );
    if (app.opts.measure && P.length > 1) {
      const e = P[P.length - 1];
      h += `<text class="mk-len" x="${f3(e[0] + px(10))}" y="${f3(e[1] + px(16))}" font-size="${px(11)}" stroke-width="${px(3)}">${pathLen(P).toFixed(1)} cm</text>`;
    }
  }
  if (app.snapInfo && ['point', 'line', 'curve'].includes(app.tool)) {
    const q = app.snapInfo.pt,
      r = px(7);
    h +=
      app.snapInfo.kind === 'corner'
        ? `<rect class="snap" x="${f3(q[0] - r)}" y="${f3(q[1] - r)}" width="${f3(2 * r)}" height="${f3(2 * r)}" stroke-width="${px(2)}"/>`
        : app.snapInfo.kind === 'edge'
          ? `<path class="snap" d="M${f3(q[0])} ${f3(q[1] - r)}L${f3(q[0] + r)} ${f3(q[1])}L${f3(q[0])} ${f3(q[1] + r)}L${f3(q[0] - r)} ${f3(q[1])}Z" stroke-width="${px(2)}"/>`
          : `<circle class="snap" cx="${f3(q[0])}" cy="${f3(q[1])}" r="${r}" stroke-width="${px(2)}"/>`;
  }
  world.innerHTML = h;
  $('#zoom').textContent = Math.round((app.view.s / 12) * 100) + '%';
}
