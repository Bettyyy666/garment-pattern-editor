// intrinsic-dart cone surface (cone_surface(): apex at the origin, x/y in the solver chart, boundary at z < 0) placed
// on its panel in 3D: x/y follow the panel exactly as its 2D outline does, z runs along the panel normal. The whole
// surface is shifted along the normal so its boundary sits on the panel plane on average (seams stay near their
// flat positions) and the apex stands out on the panel's front side. Pure: no DOM.
import { toCanvas, toMath } from './dart-solve.js';
import { add3, eulerToMat, mul3, world3D } from './frame3d.js';

// Cone vertices as canvas points on the panel plus their offset along the panel normal.
export function coneSamples(p, d, surf) {
  const V = surf.verts,
    n = V.length - 1,
    zc = V.slice(1).reduce((s, q) => s + q[2], 0) / (n || 1),
    a = toMath(d.at);
  return { pts: V.map((q) => toCanvas([a[0] + q[0], a[1] + q[1]])), hn: V.map((q) => q[2] - zc) };
}

// Cone vertices in world space at the panel's rigid GarmentCode placement.
export function coneWorld(p, d, surf) {
  const S = coneSamples(p, d, surf),
    R = eulerToMat(p.place.rot),
    nrm = [R[0][2], R[1][2], R[2][2]];
  return S.pts.map((w, i) => add3(world3D(p, w), mul3(nrm, S.hn[i])));
}
