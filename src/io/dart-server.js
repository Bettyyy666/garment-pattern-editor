// Client for the local dart solver server (server/dart_server.py), which runs intrinsic-dart's own Python code.
// Sends a panel's outline and one dart's settings; returns the solver output reshaped for ui/dart-view.js.
import { dartSettings, fracToIndex, panelOutline, toMath } from '../model/dart-solve.js';

const meshes = new Map(); // outline key -> { points, triangles }; the mesh is only sent when asked for

export async function solveDart(p, d, withMesh = false) {
  dartSettings(d);
  const ol = panelOutline(p),
    aL = [...new Set(d.angleLocks.map((f) => fracToIndex(ol.frac, f)))],
    sL = [...new Set(d.scaleLocks.map((f) => fracToIndex(ol.frac, f)))],
    needMesh = withMesh && !meshes.has(ol.key);
  let r;
  try {
    const resp = await fetch('/api/dart/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outline: ol.vertices,
        cone: toMath(d.at),
        cut_angle: -d.cut,
        defect: d.defect,
        regularization: d.smooth,
        angle_weight: d.angleW,
        scale_weight: d.scaleW,
        length_weight: d.lengthW,
        angle_locks: aL,
        scale_locks: sL,
        cut_length_mode: d.cutMode,
        cut_length_weight: d.cutW,
        include_mesh: needMesh,
      }),
    });
    if (!resp.ok && resp.status === 404) throw new Error('no solver endpoint');
    r = await resp.json();
  } catch {
    return {
      error:
        'The dart solver server is not running. Start the editor with `npm start` (server/dart_server.py) to run intrinsic-dart.',
      offline: true,
    };
  }
  if (r.mesh) meshes.set(ol.key, r.mesh);
  if (!r.vertices) return { error: r.error || 'solver failed' };
  const mesh = meshes.get(ol.key),
    out = {
      pm: {
        frac: ol.frac,
        model: {
          vertices: r.vertices,
          originalTurns: r.original_turns,
          originalLengths: r.original_lengths,
          angleLocked: new Set(aL),
          scaleLocked: new Set(sL),
          mesh: mesh ? { pts: mesh.points, tris: mesh.triangles } : null,
          stats: r.mesh_stats,
        },
      },
      error: r.error,
    };
  if (r.metric)
    out.metric = {
      eta: r.metric.eta,
      curvatureChange: r.metric.curvature_change,
      targetLengths: r.metric.target_lengths,
      defect: r.metric.defect,
      diagnostics: r.metric.diagnostics,
    };
  if (r.development)
    out.dev = {
      cut: r.development.cut,
      boundary: r.development.boundary,
      segmentTargetLengths: r.development.segment_target_lengths,
      segmentCorrectedLengths: r.development.segment_corrected_lengths,
      diagnostics: r.development.diagnostics,
    };
  if (r.surface) {
    const pk = new Set(r.surface.pocket_faces);
    out.surf = {
      verts: r.surface.vertices,
      faces: r.surface.faces,
      pocket: r.surface.faces.map((_, i) => pk.has(i)),
      pitch: r.surface.pitch,
      fans: r.surface.fan_faces.length,
      pockets: r.surface.pockets,
    };
  }
  out.surfError = r.surface_error;
  return out;
}
