// Triangulated flat panels for the 3D view next to a body (server: intrinsic-dart's triangulate_polygon), so they
// depth-sort against the body triangles. Cached by the outline relative to its first point, so moving a panel in 2D
// reuses its mesh. One request at a time; the 3D view is redrawn when a mesh arrives.
import { panelOutline, toCanvas } from '../model/dart-solve.js';
import { app } from '../state.js';
import { render3d } from '../ui/view3d.js';

const cache = new Map(), // key -> { pts (outline-relative, solver frame), tris } | { failed }
  queue = new Map(); // key -> relative outline
let busy = false;

function relOutline(p) {
  const V = panelOutline(p).vertices,
    o = V[0],
    rel = V.map((q) => [Math.round((q[0] - o[0]) * 1e4) / 1e4, Math.round((q[1] - o[1]) * 1e4) / 1e4]);
  return { o, rel, key: JSON.stringify(rel) };
}

async function pump() {
  if (busy) return;
  const next = queue.entries().next();
  if (next.done) return;
  const [key, rel] = next.value;
  queue.delete(key);
  busy = true;
  try {
    const r = await fetch('/api/panel/mesh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outline: rel, max_area: 6 }),
    });
    const j = r.ok ? await r.json() : null;
    cache.set(key, j && j.points ? { pts: j.points, tris: j.triangles } : { failed: true });
  } catch {
    cache.set(key, { failed: true });
  } finally {
    busy = false;
  }
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  if (app.view3d.on) render3d();
  pump();
}

// Mesh of panel p in canvas coordinates: { pts, tris }, or null while it is pending or when the server has none.
export function panelMesh(p) {
  const { o, rel, key } = relOutline(p),
    c = cache.get(key);
  if (!c) {
    if (!queue.has(key)) {
      queue.set(key, rel);
      setTimeout(pump, 0);
    }
    return null;
  }
  if (c.failed) return null;
  return { pts: c.pts.map((q) => toCanvas([q[0] + o[0], q[1] + o[1]])), tris: c.tris };
}
