// GarmentCode specification JSON <-> editor model.
import { TINTS } from '../config.js';
import { add, dot, len, mul, norm, perpL, sub } from '../geometry.js';
import { stitchedDarts } from '../model/dart-detect.js';
import { arcSpan } from '../model/edges.js';
import { bbox, fromLocal, panelPts, toLocal, translatePanel } from '../model/panels.js';
import { analyzeLoaded, setSource } from '../spec.js';
import { intrinsicBlock } from './intrinsic-analysis.js';
import { app, nid, pushHistory, snapshot } from '../state.js';
import { renderAll } from '../ui/inspector.js';
import { toast } from '../ui/toast.js';
import { fit } from '../ui/viewport.js';
import { esc, r4, slug } from '../util.js';

const DEG = Math.PI / 180;
// Cone-dart solver settings saved per dart (JSON name -> dart field); locks are perimeter fractions from vertex 0.
const DART_KEYS = [
  ['angle_weight', 'angleW'],
  ['scale_weight', 'scaleW'],
  ['length_weight', 'lengthW'],
  ['smoothness', 'smooth'],
  ['cut_length_mode', 'cutMode'],
  ['cut_length_weight', 'cutW'],
  ['angle_locks', 'angleLocks'],
  ['scale_locks', 'scaleLocks'],
];
export const isGarmentCode = (o) =>
  o &&
  ((o.pattern && o.pattern.panels && !Array.isArray(o.pattern.panels)) ||
    (o.panels && !Array.isArray(o.panels) && typeof o.panels === 'object'));
export function parseGarmentCode(o) {
  const pat = o.pattern || o,
    props = o.properties || {},
    unit = 100 / (props.units_in_meter || 100),
    relc = props.curvature_coords !== 'absolute';
  const names = (pat.panel_order || []).filter((n) => pat.panels[n]);
  Object.keys(pat.panels).forEach((n) => {
    if (!names.includes(n)) names.push(n);
  });
  const panels = [],
    emap = {};
  for (const name of names) {
    const pn = pat.panels[name];
    if (!Array.isArray(pn.vertices) || !Array.isArray(pn.edges) || pn.edges.length < 2)
      throw new Error(`Panel "${name}" needs vertices and edges.`);
    const V = pn.vertices.map((v) => [v[0] * unit, v[1] * unit]),
      place = {
        t: (pn.translation || [0, 0, 0]).map((x) => x * unit),
        rot: (pn.rotation || [0, 0, 0]).slice(),
        ox: 0,
        oy: 0,
      },
      W = (v) => fromLocal(place, v);
    emap[name] = [];
    const edges = pn.edges.map((ed) => {
      const [i, j] = ed.endpoints,
        a = V[i],
        b = V[j],
        e = { eid: nid('e'), k: 'line', a: W(a), b: W(b) };
      if (ed.label) e.label = ed.label;
      const cv = ed.curvature;
      if (cv) {
        let type = 'quadratic',
          params;
        if (Array.isArray(cv)) params = [cv];
        else {
          type = cv.type;
          params = cv.params || [];
        }
        const E = sub(b, a),
          abs = (c) => (relc ? add(add(a, mul(E, c[0])), mul(perpL(E), c[1])) : [c[0] * unit, c[1] * unit]);
        if (type === 'quadratic') {
          e.k = 'quad';
          e.c1 = W(abs(params[0]));
        } else if (type === 'cubic') {
          e.k = 'cubic';
          e.c1 = W(abs(params[0]));
          e.c2 = W(abs(params[1]));
        } else if (type === 'circle') {
          const L = len(E),
            r = Math.max(params[0] * unit, L / 2),
            large = !!params[1],
            right = !!params[2];
          const m = mul(add(a, b), 0.5),
            h = Math.sqrt(Math.max(0, r * r - (L * L) / 4)),
            nn = norm(perpL(E)),
            c = large !== right ? add(m, mul(nn, h)) : sub(m, mul(nn, h));
          e.k = 'arc';
          e.ctr = W(c);
          e.r = r;
          e.ccw = !right;
        }
      }
      emap[name].push(e.eid);
      return e;
    });
    // Darts (intrinsic-dart cone points) in panel-local coordinates, angles in degrees: an editor extension.
    const darts = (Array.isArray(pn.darts) ? pn.darts : []).map((d) => {
      const pos = d.position.map((x) => x * unit),
        c = (d.cut_angle || 0) * DEG,
        at = W(pos),
        q = W([pos[0] + Math.cos(c), pos[1] + Math.sin(c)]);
      const st = d.settings || {},
        dart = { id: nid('d'), at, defect: d.defect * DEG, cut: Math.atan2(q[1] - at[1], q[0] - at[0]) };
      for (const [k, key] of DART_KEYS) if (st[k] !== undefined) dart[key] = st[k];
      // Legs: the two panel edges (indices) a stitched dart is sewn from.
      if (Array.isArray(d.legs) && d.legs.every((i) => emap[name][i]))
        dart.legs = d.legs.map((i) => emap[name][i]);
      return dart;
    });
    darts.fromFile = Array.isArray(pn.darts);
    panels.push({ name, edges, darts, place, label: pn.label || null });
  }
  const stitches = (pat.stitches || [])
    .map((st) => ({ sid: nid('s'), e: (st || []).map((sd) => emap[sd.panel] && emap[sd.panel][sd.edge]) }))
    .filter((s) => s.e.length === 2 && s.e.every(Boolean));
  // GarmentCode writes a dart as a stitch between two adjacent edges of one panel: read its apex, Ω and cut.
  for (const p of panels) {
    if (!p.darts.fromFile) p.darts = stitchedDarts(p, stitches).map((d) => ({ id: nid('d'), ...d }));
    delete p.darts.fromFile;
  }
  return { panels, stitches, dropped: (pat.stitches || []).length - stitches.length };
}
export function loadGarmentCode(o, srcName, text, meta) {
  pushHistory();
  app.uid = 1;
  app.tintN = 0;
  app.underlay = null;
  const r = parseGarmentCode(o);
  if (!r.panels.length) throw new Error('No panels found.');
  const panels = r.panels.map((p) => ({
    id: nid('p'),
    name: p.name,
    edges: p.edges,
    darts: p.darts,
    tint: app.tintN++ % TINTS.length,
    place: p.place,
    label: p.label,
  }));
  app.state = { panels, marks: [], stitches: r.stitches };
  const front = panels.filter((p) => p.place.t[2] >= 0),
    back = panels.filter((p) => p.place.t[2] < 0);
  if (front.length && back.length) {
    const bf = bbox(front.map(panelPts)),
      bb = bbox(back.map(panelPts)),
      gx = bf.x1 + 12 - bb.x0;
    back.forEach((p) => translatePanel(p, [gx, 0]));
  }
  app.sel = null;
  app.draft = null;
  app.spec = {
    name: /\.json$/i.test(srcName) ? srcName : 'specification.json',
    version: meta ? meta.version : 0,
    savedAt: meta ? new Date(meta.savedAt) : null,
    text: text || JSON.stringify(o, null, 2),
    snap: snapshot(),
    extra: { parameters: o.parameters, parameter_order: o.parameter_order, properties: o.properties },
  };
  renderAll();
  fit();
  setSource(`GarmentCode: <b>${esc(srcName)}</b> · ${panels.length} panels, ${r.stitches.length} stitches`);
  if (!meta)
    toast(
      `Loaded ${panels.length} panels and ${r.stitches.length} stitches.${r.dropped ? ` ${r.dropped} stitches referenced missing edges and were skipped.` : ''}`,
    );
  analyzeLoaded(!meta);
}
export function relCoord(c, a, b) {
  const e = sub(b, a),
    d = sub(c, a),
    L2 = dot(e, e) || 1;
  return [r4(dot(d, e) / L2), r4(dot(d, perpL(e)) / L2)];
}
export function buildSpec() {
  const panels = {},
    order = [],
    used = new Set(),
    idx = new Map();
  for (const p of app.state.panels) {
    const base = slug(p.name);
    let k = base,
      i = 2;
    while (used.has(k)) k = base + '_' + i++;
    used.add(k);
    order.push(k);
    const L = (q) => toLocal(p.place, q),
      verts = p.edges.map((e) => L(e.a)),
      n = p.edges.length;
    const edges = p.edges.map((e, i) => {
      idx.set(e.eid, { panel: k, edge: i });
      const o = { endpoints: [i, (i + 1) % n] },
        a = verts[i],
        b = verts[(i + 1) % n];
      if (e.k === 'quad') o.curvature = { type: 'quadratic', params: [relCoord(L(e.c1), a, b)] };
      else if (e.k === 'cubic')
        o.curvature = { type: 'cubic', params: [relCoord(L(e.c1), a, b), relCoord(L(e.c2), a, b)] };
      else if (e.k === 'arc') {
        const sp = arcSpan(e)[1];
        o.curvature = { type: 'circle', params: [r4(e.r), Math.abs(sp) > Math.PI ? 1 : 0, e.ccw ? 0 : 1] };
      }
      if (e.label) o.label = e.label;
      return o;
    });
    panels[k] = {
      translation: p.place.t.map(r4),
      rotation: p.place.rot.map(r4),
      vertices: verts.map((v) => [r4(v[0]), r4(v[1])]),
      edges,
      ...(p.darts && p.darts.length
        ? {
            darts: p.darts.map((d) => {
              const a = L(d.at),
                b = L(add(d.at, [Math.cos(d.cut), Math.sin(d.cut)]));
              return {
                position: [r4(a[0]), r4(a[1])],
                defect: r4(d.defect / DEG),
                cut_angle: r4(Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG),
                ...(d.legs ? { legs: d.legs.map((e) => p.edges.findIndex((x) => x.eid === e)) } : {}),
                settings: Object.fromEntries(
                  DART_KEYS.filter(([, key]) => d[key] !== undefined).map(([k, key]) => [k, d[key]]),
                ),
              };
            }),
          }
        : {}),
      ...(intrinsicBlock(p) ? { intrinsic: intrinsicBlock(p) } : {}),
      ...(p.label ? { label: p.label } : {}),
    };
  }
  const stitches = app.state.stitches
    .map((st) => st.e.map((e) => idx.get(e)))
    .filter((s) => s.every(Boolean));
  const x = app.spec.extra || {};
  return {
    pattern: { panels, stitches, panel_order: order },
    parameters: x.parameters || {},
    parameter_order: x.parameter_order || [],
    properties: {
      ...(x.properties || {}),
      curvature_coords: 'relative',
      normalize_panel_translation: false,
      normalized_edge_loops: true,
      units_in_meter: 100,
    },
  };
}
