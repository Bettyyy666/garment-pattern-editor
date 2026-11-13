// Panel placement around a body for the 3D view: each panel is assigned a body part from its name (torso, left/right
// arm, left/right leg; front or back) and moved rigidly next to it, still flat, a gap away from the body. Torso pieces
// stand in front of / behind the torso facing ±z; sleeves, cuffs and pants lie along the limb axis in front of / behind
// the limb. Heights follow this body (bodice tops at the neck, bands, skirts and pants at the waist). Pure: no DOM.
// Body data comes from server/body.py (cm, y up, +z front, +x = the body's left).
import { add3, cross3, dot3, eulerToMat, mul3, norm3, sub3 } from './frame3d.js';

const GAP = 6; // cm between the body and a panel

// Panel name -> { part: torso|arm|leg, kind, side: left|right|null, face: front|back|null }.
export function classify(name) {
  const t = String(name)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
    has = (re) => t.some((x) => re.test(x)),
    arm = has(/sleeve|cuff|^sl$|^arms?$/),
    leg = !arm && has(/^pants?$|trouser|^legs?$|^shorts?$/),
    kind = arm
      ? has(/cuff/)
        ? 'cuff'
        : 'sleeve'
      : leg
        ? 'pants'
        : has(/^wb$|band|belt/)
          ? 'band'
          : has(/skirt|godet/)
            ? 'skirt'
            : has(/collar|lapel|hood/)
              ? 'collar'
              : 'bodice',
    side = has(/^(left|l|lft)$/) ? 'left' : has(/^(right|r|rt)$/) ? 'right' : null,
    face = has(/^(f|front|fr)$|^f(torso|skirt|bodice|sleeve)|front/)
      ? 'front'
      : has(/^(b|back|bk)$|^b(torso|skirt|bodice|sleeve)|back/)
        ? 'back'
        : null;
  return { part: arm ? 'arm' : leg ? 'leg' : 'torso', kind, side, face };
}

const centroid = (W) => [0, 1, 2].map((k) => W.reduce((s, q) => s + q[k], 0) / W.length);
// Linear interpolation in a table of [x, ...values] rows sorted by x (clamped at the ends).
function interp(rows, x, k) {
  if (x <= rows[0][0]) return rows[0][k];
  const last = rows[rows.length - 1];
  if (x >= last[0]) return last[k];
  let i = 1;
  while (rows[i][0] < x) i++;
  const a = rows[i - 1],
    b = rows[i];
  return a[k] + ((b[k] - a[k]) * (x - a[0])) / (b[0] - a[0] || 1);
}

// The panel's in-plane frame: ap = its local x or y axis, whichever is closer to the body part's axis a (signed
// along a), tp = the other in-plane direction, signed along the target's t0. Points are measured in (ap, tp, ap × tp).
function frame(p, a, t0) {
  const R = eulerToMat(p.place.rot),
    ex = [R[0][0], R[1][0], R[2][0]],
    ey = [R[0][1], R[1][1], R[2][1]],
    n = [R[0][2], R[1][2], R[2][2]],
    ax = Math.abs(dot3(ex, a)) >= Math.abs(dot3(ey, a)) ? ex : ey,
    ap = dot3(ax, a) < 0 ? mul3(ax, -1) : ax;
  let tp = norm3(cross3(n, ap));
  if (dot3(tp, t0) < 0) tp = mul3(tp, -1);
  return { ap, tp, bp: cross3(ap, tp) };
}

// Rigid move of one panel: its frame (ap, tp, bp) at origin c goes to (a, t0, a × t0) at origin O, so the panel stays
// flat and unmirrored. hn (a cone's height above the panel) always points away from the body (r0), so darts bulge
// outward whichever way the panel's own normal points.
function rigid(it, c, O, a, t0, r0) {
  const F = frame(it.p, a, t0),
    b = cross3(a, t0);
  it.map = (q, hn = 0) => {
    const d = sub3(q, c);
    return add3(
      add3(add3(O, mul3(a, dot3(d, F.ap))), add3(mul3(t0, dot3(d, F.tp)), mul3(b, dot3(d, F.bp)))),
      mul3(r0, hn),
    );
  };
}

// Torso pieces: upright, facing ±z, x kept (the midline stays at the body's midline), one vertical shift for the
// family; each stands GAP in front of the body's front-most (or behind its back-most) point over its height range.
function torsoFamily(items, body) {
  const lv = body.levels,
    T = body.trunk,
    pick = (k) => items.filter((it) => it.cls.kind === k),
    ys = (L) => L.flatMap((it) => it.W.map((q) => q[1])),
    maxY = (L) => Math.max(...ys(L)),
    minY = (L) => Math.min(...ys(L));
  let shift = 0;
  if (pick('bodice').length) shift = lv.neck - maxY(pick('bodice'));
  else if (pick('band').length) shift = lv.waist - (maxY(pick('band')) + minY(pick('band'))) / 2;
  else if (pick('skirt').length) shift = lv.waist - maxY(pick('skirt'));
  else if (pick('collar').length) shift = lv.neck - minY(pick('collar'));
  const a = [0, 1, 0];
  for (const it of items) {
    const f = it.cls.face === 'back' ? -1 : 1,
      r0 = [0, 0, f],
      t0 = cross3(a, r0),
      c = centroid(it.W),
      y0 = minY([it]) + shift,
      y1 = maxY([it]) + shift;
    let z = f > 0 ? -Infinity : Infinity;
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const zb = interp(T, y, f > 0 ? 4 : 3);
      z = f > 0 ? Math.max(z, zb) : Math.min(z, zb);
    }
    rigid(it, c, [c[0], c[1] + shift, z + f * GAP], a, t0, r0);
  }
}

// Sleeves / cuffs / pants of one limb: laid along the limb axis, in front of it (front pieces) or behind it (back),
// GAP away from its surface; each panel centred across the limb, the group keeping its own order along it. Sleeves
// start at the shoulder end of the arm, pants at the waist.
function limbFamily(items, limb, body) {
  const a = limb.axis,
    o = limb.origin,
    z = [0, 0, 1],
    rf = norm3(sub3(z, mul3(a, dot3(z, a)))),
    main = items.filter((it) => it.cls.kind === 'sleeve' || it.cls.kind === 'pants'),
    ref = (main.length ? main : items).reduce((m, it) => (it.W.length > m.W.length ? it : m)),
    rc = centroid(ref.W);
  for (const it of items) {
    const r0 = it.cls.face === 'back' ? mul3(rf, -1) : rf;
    Object.assign(it, { r0, t0: cross3(a, r0) });
    it.F = frame(it.p, a, it.t0);
    it.S = it.W.map((q) => dot3(sub3(q, rc), it.F.ap));
  }
  const start = (L) => Math.min(...L.flatMap((it) => it.S)),
    target = items[0].cls.part === 'leg' ? (body.levels.waist - o[1]) / (a[1] || -1) : 0,
    shift = target - start(main.length ? main : items),
    R = (s0, s1) => {
      let r = 0;
      for (let s = s0; s <= s1 + 2; s += 2) r = Math.max(r, interp(limb.radius, s, 1));
      return r;
    };
  for (const it of items) {
    const c = centroid(it.W),
      s0 = Math.min(...it.S) + shift,
      s1 = Math.max(...it.S) + shift,
      sc = dot3(sub3(c, rc), it.F.ap) + shift,
      O = add3(add3(o, mul3(a, sc)), mul3(it.r0, R(s0, s1) + GAP));
    rigid(it, c, O, a, it.t0, it.r0);
  }
}

// items: [{ p, W }] with W the panel outline at its rigid GarmentCode placement (world cm). Sets on each item
// cls (classify + fallbacks) and map(q, hn): rigid world point q, height hn above the panel -> world point next to
// the body. Panels whose body part is missing from the body keep their GarmentCode placement.
export function arrange(items, body) {
  for (const it of items) {
    it.cls = classify(it.p.name);
    const c = centroid(it.W),
      R = eulerToMat(it.p.place.rot),
      n = [R[0][2], R[1][2], R[2][2]];
    if (!it.cls.side) it.cls.side = c[0] >= 0 ? 'left' : 'right';
    if (!it.cls.face) it.cls.face = c[2] >= 0 ? 'front' : 'back'; // GarmentCode: back panels sit at z < 0
    it.map = (q, hn = 0) => add3(q, mul3(n, hn));
  }
  const torso = items.filter((it) => it.cls.part === 'torso');
  if (torso.length && body.trunk && body.trunk.length) torsoFamily(torso, body);
  for (const part of ['arm', 'leg'])
    for (const side of ['left', 'right']) {
      const L = items.filter((it) => it.cls.part === part && it.cls.side === side),
        limb = body.limbs && body.limbs[`${side}_${part}`];
      if (L.length && limb) limbFamily(L, limb, body);
    }
  return items;
}
