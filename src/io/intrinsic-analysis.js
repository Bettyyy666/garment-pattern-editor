// Intrinsic-dart description of every panel, computed by the local server (POST /api/dart/analyze) inside
// ConeDartModel: boundary edge lengths and turning angles of the reference outline (darts closed), plus each dart's
// apex, Ω and cut. Results are kept per panel outside the document and written into the specification on save.
import { panelOutline, toCanvas, toMath } from '../model/dart-solve.js';
import { toLocal } from '../model/panels.js';
import { app } from '../state.js';
import { r4 } from '../util.js';

const DEG = 180 / Math.PI;
const results = new Map(); // panel id -> { key, block } ; block is the JSON written as panels[k].intrinsic

const dartKey = (p) => JSON.stringify((p.darts || []).map((d) => [d.at, d.defect, d.cut, d.legs || 0]));
const keyOf = (p) => panelOutline(p).key + dartKey(p) + JSON.stringify(p.place);

async function analyzePanel(p) {
  const ol = panelOutline(p),
    D = p.darts || [];
  const resp = await fetch('/api/dart/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      outline: ol.vertices,
      darts: D.map((d) => ({ cone: toMath(d.at), cut_angle: -d.cut, defect: d.defect })),
    }),
  });
  if (!resp.ok) throw new Error(resp.status === 404 ? 'no solver endpoint' : resp.statusText);
  const r = await resp.json();
  if (!r.vertices) return { error: r.error || 'analysis failed' };
  // Solver frame -> panel-local GarmentCode frame (a rotation and a shift, so lengths and turns are unchanged).
  const L = (q) => toLocal(p.place, toCanvas(q)),
    P = (q) => L(q).map(r4),
    rz = (p.place.rot[2] || 0) / DEG,
    ang = (a) => r4(Math.atan2(Math.sin(a - rz), Math.cos(a - rz)) * DEG),
    lens = r.original_lengths,
    turns = r.original_turns,
    edgeLen = (pick) => r4(lens.reduce((s, l, i) => (pick(ol.seg[i]) ? s + l : s), 0)),
    legOf = new Map(D.flatMap((d) => (d.legs || []).map((e) => [p.edges.findIndex((x) => x.eid === e), d]))),
    edges = p.edges.map((_, i) =>
      legOf.has(i) || ol.corner[i] < 0
        ? { edge: i, length: null, turn: null }
        : { edge: i, length: edgeLen((g) => g === i), turn: r4(turns[ol.corner[i]]) },
    );
  return {
    solver: 'intrinsic_dart.cone_dart.ConeDartModel',
    frame: 'panel-local, counterclockwise, darts closed; lengths in cm, turns in radians',
    vertices: r.vertices.map(P),
    vertex_edge: ol.seg,
    original_lengths: lens.map(r4),
    original_turns: turns.map(r4),
    // Per panel edge: summed length of its outline segments and the turn at its start vertex. Dart legs are
    // closed in the reference outline, so they are null; each dart's mouth length and turn are under darts.
    edges,
    darts: D.map((d, k) => {
      const a = r.darts[k] || {},
        legs = d.legs ? d.legs.map((e) => p.edges.findIndex((x) => x.eid === e)) : null,
        o = {
          apex: P(toMath(d.at)),
          defect: r4(d.defect * DEG),
          cut_angle: ang(-d.cut),
          // A stitched dart's legs are closed into one mouth segment of the reference outline.
          ...(legs
            ? {
                legs,
                mouth_length: edgeLen((g) => g === -1 - k),
                mouth_turn: ol.corner[legs[0]] >= 0 ? r4(turns[ol.corner[legs[0]]]) : null,
              }
            : {}),
        };
      if (a.error) o.error = a.error;
      if (a.cut)
        o.cut = {
          point: P(a.cut.point),
          outline_edge: a.cut.edge,
          fraction: r4(a.cut.fraction),
          length: r4(a.cut.length),
        };
      return o;
    }),
    operator_diagnostics: r.operator_diagnostics,
    mesh_stats: r.mesh_stats,
  };
}

// Analyze every panel whose outline, darts or frame changed since its last analysis. Resolves to
// { done, failed, offline }; never throws.
export async function analyzeAll() {
  const out = { done: 0, failed: 0, offline: false };
  for (const p of app.state.panels) {
    const key = keyOf(p);
    if (results.has(p.id) && results.get(p.id).key === key) continue;
    try {
      const block = await analyzePanel(p);
      results.set(p.id, { key, block });
      if (block.error) out.failed++;
      else out.done++;
    } catch {
      out.offline = true;
      break;
    }
  }
  return out;
}

// The stored analysis of panel p if it still matches the panel, else null.
export function intrinsicBlock(p) {
  const r = results.get(p.id);
  return r && r.key === keyOf(p) ? r.block : null;
}
