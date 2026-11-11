// Right-hand inspector: specification status, operation hints, selection details, panel list.
import { STITCH_COLORS, TINTS } from '../config.js';
import { area, pathLen, perimeter } from '../geometry.js';
import { markPts } from '../model/marks.js';
import { edgesFromShape } from '../model/intrinsic.js';
import { bbox, panelPts, syncShapes, uniqueName } from '../model/panels.js';
import { edgeIndex } from '../model/stitches.js';
import { DART_DEFECT_DEG, resolveDart } from '../operations/dart.js';
import { gussetParams, resolveGusset } from '../operations/gusset.js';
import { resolveCut, splitTargets } from '../operations/split.js';
import { isDirty } from '../spec.js';
import { app, getMark, getPanel, pushHistory } from '../state.js';
import { $ } from './dom.js';
import { dartsHTML, wireDarts } from './dart-editor.js';
import { toast } from './toast.js';
import { render } from './render.js';
import { esc, slug } from '../util.js';

export const fmtTime = (d) => (d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
export function renderSpec() {
  const dirty = isDirty();
  $('#save').classList.toggle('dirty', dirty);
  $('#spec-name').textContent = app.spec.name;
  const pill = $('#spec-state');
  pill.textContent = dirty
    ? 'Unsaved changes'
    : app.spec.version
      ? 'Saved'
      : app.spec.text
        ? 'As loaded'
        : 'Not saved';
  pill.className = 'pill ' + (dirty ? 'warn' : 'ok');
  $('#spec-meta').textContent = app.spec.version
    ? `Version ${app.spec.version} · saved ${fmtTime(app.spec.savedAt)}`
    : app.spec.text
      ? 'Original file, not saved from the editor yet'
      : 'Save to create the specification from this pattern.';
}
export function renderInspector() {
  $('#undo').disabled = !app.undoStack.length;
  $('#redo').disabled = !app.redoStack.length;
  renderSpec();
  const m = resolveCut(),
    hint = $('#split-hint'),
    btn = $('#op-split');
  if (!m) {
    btn.disabled = true;
    hint.innerHTML = 'Draw a <b>line</b> or <b>curve</b> across a panel, select it, then split.';
  } else {
    const T = splitTargets(m);
    btn.disabled = !T.length;
    hint.innerHTML = T.length
      ? `Splits <b>${T.map((t) => esc(t.p.name)).join(', ')}</b> into ${T.reduce((a, t) => a + t.pieces.length, 0)} pieces along <b>${esc(m.label)}</b>. Stitches on cut edges are split too, and the new seam is stitched.`
      : `<b>${esc(m.label)}</b> doesn't cross a panel edge twice. Extend it past both edges.`;
  }
  const g = resolveGusset(),
    gp = gussetParams();
  $('#op-gusset').disabled = !!g.err;
  $('#gusset-hint').innerHTML = g.err
    ? g.err
    : g.kind === 'diamond'
      ? `Opens <b>${esc(g.seams[0][0].p.name)}</b>–<b>${esc(g.seams[0][1].p.name)}</b> and <b>${esc(g.seams[1][0].p.name)}</b>–<b>${esc(g.seams[1][1].p.name)}</b> for ${gp.len} cm from the corner, keeps the seam across it, and sews in a ${gp.width} cm wide diamond.`
      : `Opens <b>${esc(g.seams[0][0].p.name)}</b>–<b>${esc(g.seams[0][1].p.name)}</b> for ${gp.len} cm from the open end and sews in a ${gp.width} cm wide triangle.`;
  const dr = resolveDart();
  $('#op-dart').disabled = !!dr.err;
  $('#dart-hint').innerHTML = dr.err
    ? esc(dr.err)
    : `Adds a ${DART_DEFECT_DEG}° dart (cone point) to <b>${esc(dr.p.name)}</b>, cut toward the nearest edge.`;
  const panelSel = app.sel && app.sel.kind === 'panel' ? getPanel(app.sel.id) : null;
  ['op-mirror', 'op-rotate', 'op-dup', 'op-del'].forEach(
    (id) => ($('#' + id).disabled = !(panelSel || (id === 'op-del' && app.sel))),
  );
  const box = $('#sel-info');
  if (panelSel) {
    const P = panelPts(panelSel),
      b = bbox([P]),
      EI = edgeIndex();
    const rows = [];
    app.state.stitches.forEach((st, si) => {
      const L = st.e.map((e) => EI.get(e));
      if (L.some((x) => !x)) return;
      L.forEach((l, k) => {
        if (l.p !== panelSel) return;
        const o = L[1 - k];
        rows.push({ si, i: l.i, txt: `edge ${l.i} ↔ ${esc(o.p.name)} · edge ${o.i}`, cut: st.cut });
      });
    });
    rows.sort((a, b) => a.i - b.i);
    box.innerHTML = `<div class="field"><label for="pname">Name</label><input class="input" id="pname" value="${esc(panelSel.name)}"></div>
    <dl class="kv" style="margin:10px 0 0"><dt>Area</dt><dd>${Math.abs(area(P)).toFixed(1)} cm²</dd><dt>Perimeter</dt><dd>${perimeter(P).toFixed(1)} cm</dd>
    <dt>Width × height</dt><dd>${(b.x1 - b.x0).toFixed(1)} × ${(b.y1 - b.y0).toFixed(1)}</dd><dt>Edges</dt><dd>${panelSel.edges.length}</dd>
    ${panelSel.label ? `<dt>Label</dt><dd>${esc(panelSel.label)}</dd>` : ''}<dt>Stitched edges</dt><dd>${rows.length}</dd></dl>
    ${rows.length ? `<ul class="slist">${rows.map((r) => `<li><span class="sdot" style="background:${STITCH_COLORS[r.si % STITCH_COLORS.length]}">${r.si + 1}</span>${r.txt}${r.cut ? ' <em>new seam</em>' : ''}</li>`).join('')}</ul>` : ''}`;
    box.insertAdjacentHTML('beforeend', shapeHTML(panelSel));
    wireShape(box, panelSel);
    $('#pname').addEventListener('change', (e) => {
      const v = slug(e.target.value);
      if (!v || v === panelSel.name) {
        e.target.value = panelSel.name;
        return;
      }
      pushHistory();
      panelSel.name = uniqueName(v, panelSel);
      renderAll();
    });
  } else if (app.sel && app.sel.kind === 'mark') {
    const mk = getMark(app.sel.id),
      pn = mk && getPanel(mk.panelId);
    box.innerHTML = mk
      ? `<dl class="kv" style="margin:0"><dt>Mark</dt><dd>${esc(mk.label)}</dd><dt>Type</dt><dd>${mk.type}</dd>
      ${mk.type === 'point' ? `<dt>Position</dt><dd>${mk.pts[0][0].toFixed(1)}, ${mk.pts[0][1].toFixed(1)}</dd>` : `<dt>Length</dt><dd>${pathLen(markPts(mk)).toFixed(1)} cm</dd><dt>Control points</dt><dd>${mk.pts.length}</dd>`}
      <dt>On panel</dt><dd>${pn ? esc(pn.name) : '—'}</dd></dl>`
      : '';
  } else box.innerHTML = '<p class="hint-text">Nothing selected. Click a panel or a mark.</p>';
  $('#plist').innerHTML =
    app.state.panels
      .map(
        (
          p,
        ) => `<li><button data-pick="${p.id}" aria-current="${!!(app.sel && app.sel.kind === 'panel' && app.sel.id === p.id)}">
    <span class="swatch" style="background:${TINTS[p.tint % TINTS.length]}"></span><span class="nm">${esc(p.name)}</span><span class="ar">${Math.abs(area(panelPts(p))).toFixed(0)} cm²</span></button></li>`,
      )
      .join('') || '<li class="hint-text">No panels. Add one below.</li>';
  $('#stitch-count').textContent = app.state.stitches.length ? `${app.state.stitches.length} stitches` : '';
}
const DEG = 180 / Math.PI;
// Intrinsic shape table (edge length + turning angle) and the panel's darts.
function shapeHTML(p) {
  const S = p.shape,
    num = (attr, v, step, extra = '') =>
      `<input class="input num" ${attr} type="number" step="${step}" value="${v}" ${extra}>`;
  return `<h3 class="sub">Shape <span>edge length · turning angle</span></h3>
    <div class="itab-wrap"><table class="itab"><thead><tr><th>Edge</th><th>Length (cm)</th><th>Turn (°)</th></tr></thead><tbody>
    ${S.len
      .map(
        (l, i) =>
          `<tr><td>${i}${S.curve[i] ? ` <em>${S.curve[i].k}</em>` : ''}</td><td>${num(`data-shape="len" data-i="${i}"`, l.toFixed(2), 0.1, 'min="0.01"')}</td><td>${num(`data-shape="turn" data-i="${i}"`, (S.turn[i] * DEG).toFixed(1), 0.5, i ? '' : 'disabled title="Vertex 0 is set by closure"')}</td></tr>`,
      )
      .join('')}</tbody></table></div>
    ${dartsHTML(p)}`;
}
function wireShape(box, p) {
  box.querySelectorAll('[data-shape]').forEach((inp) =>
    inp.addEventListener('change', () => {
      const k = inp.dataset.shape,
        i = +inp.dataset.i,
        v = parseFloat(inp.value),
        shape = structuredClone(p.shape);
      if (!Number.isFinite(v) || (k === 'len' && v <= 0)) return renderInspector();
      shape[k][i] = k === 'turn' ? v / DEG : v;
      let edges;
      try {
        edges = edgesFromShape(shape, p.edges, k === 'len' ? [i] : []);
      } catch (err) {
        toast(err.message, true);
        return renderInspector();
      }
      pushHistory();
      p.edges = edges;
      renderAll();
    }),
  );
  wireDarts(box, p);
}
export function renderAll() {
  syncShapes();
  render();
  renderInspector();
}
