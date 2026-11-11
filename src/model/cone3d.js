// intrinsic-dart cone surface (cone_surface(): apex at the origin, x/y in the solver chart, boundary at z < 0) placed
// on its panel in 3D: x/y follow the panel exactly as its 2D outline does, z runs along the panel normal. The whole
// surface is shifted along the normal so its boundary sits on the panel plane on average (seams stay near their
// flat positions) and the apex stands out on the panel's front side. Pure: no DOM.
import { toCanvas, toMath } from './dart-solve.js';
import { eulerToMat, matVec } from './frame3d.js';
import { toLocal } from './panels.js';

export function coneWorld(p, d, surf) {
  const V = surf.verts,
    n = V.length - 1,
    zc = V.slice(1).reduce((s, q) => s + q[2], 0) / (n || 1),
    a = toMath(d.at),
    R = eulerToMat(p.place.rot),
    t = p.place.t;
  return V.map((q) => {
    const l = toLocal(p.place, toCanvas([a[0] + q[0], a[1] + q[1]])),
      r = matVec(R, [l[0], l[1], q[2] - zc]);
    return [r[0] + t[0], r[1] + t[1], r[2] + t[2]];
  });
}
