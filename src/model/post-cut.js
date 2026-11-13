// Panel edges on a dart's post-cut outline. intrinsic-dart's develop() returns the developed boundary as c+ (the cut
// point on outline segment k at fraction t), then the outline vertices k+1, k+2, ... k-1, then (if t > 0) vertex k
// again, then c-. So every reference-outline vertex has a post-cut position, and each panel edge (its run of outline
// segments, panelOutline().seg) becomes a polyline on the post-cut outline; the edge the cut hits splits in two at
// the opening. Edges that are legs of a stitched dart are closed into its mouth on the reference outline and have no
// post-cut counterpart. Pure: no DOM.
import { toMath } from './dart-solve.js';

const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

// ol: panelOutline(p) the dart was solved on; B: the developed boundary already placed on the canvas; cut: { edge,
// fraction } from develop(). Returns Map eid -> polylines (canvas points, running from the edge's a to its b), or
// null when B does not match the outline.
export function postCutEdges(p, ol, B, cut) {
  const n = ol.vertices.length,
    k = cut.edge,
    split = cut.fraction > 1e-9;
  if (B.length !== n + (split ? 2 : 1)) return null;
  // Boundary pieces of outline segment r (two pieces, broken at the opening, for the cut segment).
  const pieces = (r) => {
    const j = (r - k + n) % n;
    if (j === 0) return split ? [[B[n], B[n + 1]], null, [B[0], B[1]]] : [[B[0], B[1]]];
    return [[B[j], B[j + 1]]];
  };
  const out = new Map();
  p.edges.forEach((e, ei) => {
    const R = [];
    for (let r = 0; r < n; r++) if (ol.seg[r] === ei) R.push(r);
    if (!R.length) return out.set(e.eid, []); // a closed dart leg
    // Walk the edge's segments in outline order, from the one whose predecessor belongs to another edge.
    const first = R.find((r) => ol.seg[(r - 1 + n) % n] !== ei) ?? R[0],
      lines = [];
    let cur = null;
    for (let i = 0, r = first; i < R.length; i++, r = (r + 1) % n)
      for (const pc of pieces(r)) {
        if (!pc) {
          cur = null;
          continue;
        }
        if (!cur) lines.push((cur = [pc[0]]));
        cur.push(pc[1]);
      }
    // The outline may run against the edge (it is made counter-clockwise): orient every polyline from a to b.
    const a = toMath(e.a),
      v0 = ol.vertices[first];
    if (d2(v0, a) > d2(v0, toMath(e.b))) {
      lines.reverse();
      lines.forEach((l) => l.reverse());
    }
    out.set(e.eid, lines);
  });
  return out;
}
