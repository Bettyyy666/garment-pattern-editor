// Trace panel outlines from a PNG / JPG pattern image.
import { TINTS } from '../config.js';
import { area, centroid, clean, closestOnSeg, dist } from '../geometry.js';
import { allBox, bbox, defaultPlace, lineEdges, uniqueName } from '../model/panels.js';
import { setSource } from '../spec.js';
import { app, nid, pushHistory } from '../state.js';
import { $ } from '../ui/dom.js';
import { renderAll } from '../ui/inspector.js';
import { toast } from '../ui/toast.js';
import { fit } from '../ui/viewport.js';
import { esc } from '../util.js';

export function commitTrace(replace) {
  if (!app.traceRes || !app.traceRes.contours.length) return;
  const ppc = Math.max(0.01, +$('#tr-scale').value || 3);
  pushHistory();
  if (replace) {
    app.state = { panels: [], marks: [], stitches: [] };
    app.uid = 1;
    app.tintN = 0;
    app.spec = {
      name: app.traceSrc.name.replace(/\.[^.]+$/, '') + '_specification.json',
      version: 0,
      savedAt: null,
      text: '',
      snap: null,
      extra: null,
    };
  }
  let at = [0, 0];
  if (!replace && app.state.panels.length) {
    const b = allBox();
    at = [b.x1 + 12, b.y0];
  }
  app.traceRes.contours.forEach((P, i) => {
    const edges = lineEdges(P.map((p) => [p[0] / ppc + at[0], p[1] / ppc + at[1]]));
    app.state.panels.push({
      id: nid('p'),
      name: uniqueName(`panel_${i + 1}`),
      edges,
      tint: app.tintN++ % TINTS.length,
      place: defaultPlace(edges),
      label: null,
    });
  });
  app.underlay = {
    src: app.traceSrc.url,
    x: at[0],
    y: at[1],
    w: app.traceRes.w / ppc,
    h: app.traceRes.h / ppc,
  };
  app.sel = null;
  app.draft = null;
  $('#trace').hidden = true;
  renderAll();
  fit();
  setSource(
    `Traced image: <b>${esc(app.traceSrc.name)}</b> · ${app.traceRes.contours.length} panels at ${ppc} px/cm (no stitches)`,
  );
  toast(`Traced ${app.traceRes.contours.length} panels. Save to create a specification.`);
}
export function analyzeImage(img, tol, simp) {
  const k = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight)),
    W = Math.max(1, Math.round(img.naturalWidth * k)),
    H = Math.max(1, Math.round(img.naturalHeight * k));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.fillStyle = '#fff';
  cx.fillRect(0, 0, W, H);
  cx.drawImage(img, 0, 0, W, H);
  const d = cx.getImageData(0, 0, W, H).data,
    N = W * H;
  const border = [];
  for (let x = 0; x < W; x++) {
    border.push(x, (H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    border.push(y * W, y * W + W - 1);
  }
  const med = (c) => {
    const v = border.map((i) => d[i * 4 + c]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  const bg = [med(0), med(1), med(2)];
  const bgLike = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const dr = d[i * 4] - bg[0],
      dg = d[i * 4 + 1] - bg[1],
      db = d[i * 4 + 2] - bg[2];
    bgLike[i] = Math.sqrt(dr * dr + dg * dg + db * db) < tol ? 1 : 0;
  }
  const outside = new Uint8Array(N),
    q = new Int32Array(N);
  let qh = 0,
    qt = 0;
  for (const i of border)
    if (bgLike[i] && !outside[i]) {
      outside[i] = 1;
      q[qt++] = i;
    }
  while (qh < qt) {
    const i = q[qh++],
      x = i % W,
      y = (i - x) / W;
    if (x > 0 && bgLike[i - 1] && !outside[i - 1]) {
      outside[i - 1] = 1;
      q[qt++] = i - 1;
    }
    if (x < W - 1 && bgLike[i + 1] && !outside[i + 1]) {
      outside[i + 1] = 1;
      q[qt++] = i + 1;
    }
    if (y > 0 && bgLike[i - W] && !outside[i - W]) {
      outside[i - W] = 1;
      q[qt++] = i - W;
    }
    if (y < H - 1 && bgLike[i + W] && !outside[i + W]) {
      outside[i + W] = 1;
      q[qt++] = i + W;
    }
  }
  const lab = new Int32Array(N);
  let nl = 0;
  const comps = [];
  const minA = Math.max(40, N * 0.0012);
  for (let s = 0; s < N; s++) {
    if (outside[s] || lab[s]) continue;
    nl++;
    let a = 0;
    qh = qt = 0;
    q[qt++] = s;
    lab[s] = nl;
    while (qh < qt) {
      const i = q[qh++],
        x = i % W,
        y = (i - x) / W;
      a++;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (!outside[j] && !lab[j]) {
            lab[j] = nl;
            q[qt++] = j;
          }
        }
    }
    if (a >= minA) comps.push({ id: nl, start: s, area: a });
  }
  const maxA = Math.max(0, ...comps.map((c) => c.area));
  const contours = comps
    .filter((c) => c.area >= maxA * 0.04)
    .map((c) => {
      const raw = mooreTrace(lab, W, H, c.id, c.start % W, (c.start - (c.start % W)) / W);
      return rdpClosed(raw, simp).map((p) => [p[0] / k, p[1] / k]);
    })
    .filter((c) => c.length >= 3 && Math.abs(area(c)) > 4);
  contours.sort((a, b) => {
    const A = bbox([a]),
      B = bbox([b]);
    return Math.abs(A.y0 - B.y0) > Math.min(A.y1 - A.y0, B.y1 - B.y0) * 0.5 ? A.y0 - B.y0 : A.x0 - B.x0;
  });
  return { contours, bg, w: img.naturalWidth, h: img.naturalHeight };
}
export const DIRS = [
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
];
export const dirIdx = (dx, dy) => DIRS.findIndex((d) => d[0] === dx && d[1] === dy);
export function mooreTrace(lab, W, H, id, sx, sy) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && lab[y * W + x] === id;
  const out = [[sx, sy]];
  let cx = sx,
    cy = sy,
    b = 0,
    prevStart = false;
  for (let it = 0; it < W * H * 2; it++) {
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const dd = (b + k) % 8,
        nx = cx + DIRS[dd][0],
        ny = cy + DIRS[dd][1];
      if (inside(nx, ny)) {
        const pd = (b + k + 7) % 8,
          bx = cx + DIRS[pd][0],
          by = cy + DIRS[pd][1];
        cx = nx;
        cy = ny;
        b = dirIdx(bx - cx, by - cy);
        if (b < 0) b = 0;
        moved = true;
        break;
      }
    }
    if (!moved) break;
    if (prevStart && out.length > 1 && cx === out[1][0] && cy === out[1][1]) break;
    prevStart = cx === sx && cy === sy;
    if (!prevStart) out.push([cx, cy]);
  }
  return out;
}
export function rdp(P, eps) {
  if (P.length < 3) return P.slice();
  const a = P[0],
    b = P[P.length - 1];
  let md = -1,
    mi = 0;
  for (let i = 1; i < P.length - 1; i++) {
    const d = closestOnSeg(P[i], a, b).d;
    if (d > md) {
      md = d;
      mi = i;
    }
  }
  if (md > eps) {
    const L = rdp(P.slice(0, mi + 1), eps),
      R = rdp(P.slice(mi), eps);
    return L.slice(0, -1).concat(R);
  }
  return [a, b];
}
export function rdpClosed(P, eps) {
  if (P.length < 4) return P;
  let fi = 0,
    fd = -1;
  for (let i = 1; i < P.length; i++) {
    const d = dist(P[0], P[i]);
    if (d > fd) {
      fd = d;
      fi = i;
    }
  }
  const A = rdp(P.slice(0, fi + 1), eps),
    B = rdp(P.slice(fi).concat([P[0]]), eps);
  return clean(A.slice(0, -1).concat(B.slice(0, -1)));
}
export function openImage(file) {
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      app.traceSrc = { img, url: fr.result, name: file.name };
      $('#trace').hidden = false;
      runTrace();
    };
    img.onerror = () => toast('That image could not be read. Try a PNG or JPG.', true);
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
}
export function runTrace() {
  if (!app.traceSrc) return;
  const tol = +$('#tr-tol').value,
    simp = +$('#tr-simp').value;
  $('#tr-tol-v').textContent = tol;
  $('#tr-simp-v').textContent = simp + ' px';
  app.traceRes = analyzeImage(app.traceSrc.img, tol, simp);
  const cv = $('#trace-prev'),
    img = app.traceSrc.img,
    maxW = Math.min(600, cv.parentElement.clientWidth || 600),
    sc = Math.min(maxW / img.naturalWidth, 340 / img.naturalHeight, 4);
  cv.width = Math.round(img.naturalWidth * sc);
  cv.height = Math.round(img.naturalHeight * sc);
  const c = cv.getContext('2d');
  c.drawImage(img, 0, 0, cv.width, cv.height);
  const acc = getComputedStyle(document.documentElement).getPropertyValue('--chalk').trim() || '#2a63ff';
  app.traceRes.contours.forEach((P, i) => {
    c.beginPath();
    P.forEach((p, j) => (j ? c.lineTo(p[0] * sc, p[1] * sc) : c.moveTo(p[0] * sc, p[1] * sc)));
    c.closePath();
    c.fillStyle = 'rgba(42,99,255,.12)';
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = acc;
    c.stroke();
    P.forEach((p) => {
      c.fillStyle = acc;
      c.fillRect(p[0] * sc - 2, p[1] * sc - 2, 4, 4);
    });
    const m = centroid(P);
    c.fillStyle = '#111';
    c.font = '600 12px system-ui';
    c.textAlign = 'center';
    c.fillText(String(i + 1), m[0] * sc, m[1] * sc + 4);
  });
  const ppc = +$('#tr-scale').value || 3,
    n = app.traceRes.contours.length;
  $('#trace-info').innerHTML = n
    ? `Found <b>${n} panel${n > 1 ? 's' : ''}</b> in ${esc(app.traceSrc.name)} (${img.naturalWidth}×${img.naturalHeight} px ≈ ${(img.naturalWidth / ppc).toFixed(0)}×${(img.naturalHeight / ppc).toFixed(0)} cm).`
    : 'No panels found. Raise the background tolerance, or check that panels are darker than the background.';
  $('#tr-add').disabled = $('#tr-replace').disabled = !n;
}
