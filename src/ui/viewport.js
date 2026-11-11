// Canvas pan / zoom and screen <-> world conversion.
import { allBox } from '../model/panels.js';
import { app } from '../state.js';
import { svg } from './dom.js';
import { render } from './render.js';
import { fit3d } from './view3d.js';

export const rect = () => svg.getBoundingClientRect();
export function toWorld(e) {
  const r = rect();
  return [(e.clientX - r.left - app.view.ox) / app.view.s, (e.clientY - r.top - app.view.oy) / app.view.s];
}
export function fit() {
  if (app.view3d.on) return fit3d();
  const r = rect();
  if (!r.width || !app.state.panels.length) return;
  const b = allBox();
  const pad = 48;
  const s = Math.max(
    1,
    Math.min(
      60,
      Math.min((r.width - pad * 2) / (b.x1 - b.x0 || 1), (r.height - pad * 2 - 36) / (b.y1 - b.y0 || 1)),
    ),
  );
  app.view.s = s;
  app.view.ox = (r.width - (b.x1 - b.x0) * s) / 2 - b.x0 * s;
  app.view.oy = (r.height - 36 - (b.y1 - b.y0) * s) / 2 - b.y0 * s;
  render();
}
export function zoomAt(mx, my, ns) {
  ns = Math.max(1, Math.min(80, ns));
  app.view.ox = mx - (mx - app.view.ox) * (ns / app.view.s);
  app.view.oy = my - (my - app.view.oy) * (ns / app.view.s);
  app.view.s = ns;
}
