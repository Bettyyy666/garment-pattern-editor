// Darts block of the Selection inspector: the panel's darts and, for the selected one, every parameter of its
// opening as intrinsic-dart takes them (ConeDartModel.optimize: apex, defect, regularization and the boundary
// energy weights; develop: cut angle and cut-length mode). Edits re-solve on the server and redraw the 2D opening.
import { dartResult } from '../io/dart-results.js';
import { DART_DEFAULTS } from '../model/dart-solve.js';
import { fromLocal, toLocal } from '../model/panels.js';
import { app, pushHistory } from '../state.js';
import { $ } from './dom.js';
import { openDart } from './dart-view.js';
import { deleteDart } from '../operations/dart.js';
import { renderAll } from './inspector.js';
import { render } from './render.js';
import { esc } from '../util.js';

const DEG = 180 / Math.PI;
// Unset solver settings read as the demo defaults; they are only written to the dart when edited.
const get = (d, k) => (d[k] === undefined ? DART_DEFAULTS[k] : d[k]);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Apex and cut angle are shown in the panel's own GarmentCode frame (as exported), not canvas coordinates.
const localAt = (p, d) => toLocal(p.place, d.at);
const localCut = (p, d) => {
  const a = toLocal(p.place, d.at),
    b = toLocal(p.place, [d.at[0] + Math.cos(d.cut), d.at[1] + Math.sin(d.cut)]);
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
};
function setLocalCut(p, d, ang) {
  const a = fromLocal(p.place, localAt(p, d)),
    b = fromLocal(p.place, [localAt(p, d)[0] + Math.cos(ang), localAt(p, d)[1] + Math.sin(ang)]);
  d.cut = Math.atan2(b[1] - a[1], b[0] - a[0]);
}

// Parameter rows: [key, label, kind, min, max, step, help]. Values are shown in degrees / cm where noted.
const ROWS = [
  ['x', 'Apex x (cm)', 'num', null, null, 0.1, 'Cone point, panel frame'],
  ['y', 'Apex y (cm)', 'num', null, null, 0.1, 'Cone point, panel frame'],
  ['defect', 'Opening Ω (°)', 'range', 0, 90, 0.5, 'Angle defect: how far the dart opens'],
  ['cut', 'Cut angle (°)', 'range', -180, 180, 0.5, 'Direction of the cut from the apex, panel frame'],
  ['cutMode', 'Cut length', 'select', null, null, null, 'develop(): keep, relax or use the ideal cut length'],
  ['cutW', 'Cut length weight', 'num', 0, null, 0.01, 'Only for Optimize'],
  ['angleW', 'Angle weight', 'num', 0, null, 0.1, 'Boundary turning-angle energy'],
  ['scaleW', 'Scale weight', 'num', 0, null, 0.01, 'Boundary log-scale energy'],
  ['lengthW', 'Length weight', 'num', 0, null, 0.1, 'Boundary length energy'],
  ['smooth', 'Smoothness', 'num', 0, null, 0.01, 'optimize() regularization'],
];
const MODES = [
  ['preserve', 'Preserve'],
  ['optimize', 'Optimize'],
  ['ideal', 'Ideal'],
];

function value(p, d, k) {
  if (k === 'x' || k === 'y') return localAt(p, d)[k === 'x' ? 0 : 1].toFixed(2);
  if (k === 'defect') return (d.defect * DEG).toFixed(1);
  if (k === 'cut') return (localCut(p, d) * DEG).toFixed(1);
  return get(d, k);
}
function apply(p, d, k, raw) {
  if (k === 'cutMode') {
    d.cutMode = raw;
    return true;
  }
  const v = parseFloat(raw);
  if (!Number.isFinite(v)) return false;
  if (k === 'x' || k === 'y') {
    const l = localAt(p, d);
    l[k === 'x' ? 0 : 1] = v;
    const keep = localCut(p, d);
    d.at = fromLocal(p.place, l);
    setLocalCut(p, d, keep);
  } else if (k === 'defect') {
    if (v <= 0 || v >= 180) return false;
    d.defect = v / DEG;
  } else if (k === 'cut') setLocalCut(p, d, wrap(v / DEG));
  else {
    if (v < 0) return false;
    d[k] = v;
  }
  return true;
}

function readout(p, d) {
  const { res, current } = dartResult(p, d);
  if (!res) return '<p class="hint-text">Solving…</p>';
  if (res.offline) return `<p class="hint-text warn-text">${esc(res.error)}</p>`;
  if (res.error) return `<p class="hint-text warn-text">${esc(res.error)}</p>`;
  const g = res.dev.diagnostics,
    f = (x) => x.toFixed(2);
  return `<dl class="kv dart-kv${current ? '' : ' stale'}"><dt>Cut length</dt><dd>${f(g.cut_length)} cm <span class="muted">(ref ${f(g.reference_cut_length)})</span></dd>
    <dt>Boundary factor</dt><dd>${g.factor_min.toFixed(3)} – ${g.factor_max.toFixed(3)}</dd>
    <dt>Closure residual</dt><dd>${g.closure_residual.toExponential(1)}</dd></dl>`;
}
// Called when a solve arrives: refresh only the numbers, so inputs being edited keep focus.
export function refreshDartReadout() {
  const el = $('#dart-readout'),
    p = app.sel && app.sel.kind === 'panel' && app.state.panels.find((x) => x.id === app.sel.id),
    d = p && (p.darts || []).find((x) => x.id === app.dartSel);
  if (el && d) el.innerHTML = readout(p, d);
}

export function dartsHTML(p) {
  const D = p.darts || [];
  if (!D.length)
    return `<h3 class="sub">Darts</h3><p class="hint-text">No darts. Use the <b>Insert dart</b> tool (A): click the apex, then toward the edge. Or draw a line from the apex to the edge, select it and press <b>Add dart</b> (D).</p>`;
  if (!D.some((d) => d.id === app.dartSel)) app.dartSel = D[0].id;
  const d = D.find((x) => x.id === app.dartSel),
    mode = get(d, 'cutMode'),
    aL = get(d, 'angleLocks'),
    sL = get(d, 'scaleLocks');
  const list = D.map(
      (x, j) =>
        `<li><button class="dart-pick" data-dart-pick="${x.id}" aria-current="${x.id === d.id}"><b>Dart ${j + 1}</b><span>${(x.defect * DEG).toFixed(1)}° · cut ${(localCut(p, x) * DEG).toFixed(0)}°${x.legs ? ' · sewn' : ''}</span></button></li>`,
    ).join(''),
    field = ([k, label, kind, min, max, step, help]) => {
      const v = value(p, d, k),
        id = `dp-${k}`,
        lim = `${min !== null ? `min="${min}"` : ''} ${max !== null ? `max="${max}"` : ''} step="${step}"`;
      let input;
      if (kind === 'select')
        input = `<select class="input" id="${id}" data-dp="${k}">${MODES.map(([m, t]) => `<option value="${m}"${mode === m ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
      else if (kind === 'range')
        input = `<div class="dp-range"><input type="range" id="${id}" data-dp="${k}" ${lim} value="${v}"><input class="input num" type="number" data-dp="${k}" ${lim} value="${v}" aria-label="${label}"></div>`;
      else
        input = `<input class="input num" type="number" id="${id}" data-dp="${k}" ${lim} value="${v}"${k === 'cutW' && mode !== 'optimize' ? ' disabled' : ''}>`;
      return `<label for="${id}" title="${help}">${label}</label>${input}`;
    },
    locks = aL.length + sL.length;
  return `<h3 class="sub">Darts <span>intrinsic-dart cone · opening</span></h3>
    <ul class="dart-list">${list}</ul>
    <div class="dart-form">${ROWS.map(field).join('')}</div>
    ${d.legs ? '<p class="hint-text">Sewn dart from the specification: the 2D opening follows these values; its stitched legs in the pattern do not move yet.</p>' : ''}
    <p class="hint-text">${locks ? `${aL.length} angle and ${sL.length} scale locks. ` : 'No boundary locks. '}Set locks in the solver view.${locks ? ' <button class="linkbtn" id="dp-clear-locks">Clear locks</button>' : ''}</p>
    <div id="dart-readout">${readout(p, d)}</div>
    <div class="row-btns"><button class="btn" id="dp-open">Open solver view</button><button class="btn" id="dp-reset" title="Solver settings back to the intrinsic-dart demo defaults">Defaults</button><button class="btn danger" id="dp-del">Delete dart</button></div>`;
}

export function wireDarts(box, p) {
  const d = (p.darts || []).find((x) => x.id === app.dartSel);
  box.querySelectorAll('[data-dart-pick]').forEach((b) =>
    b.addEventListener('click', () => {
      app.dartSel = b.dataset.dartPick;
      renderAll();
    }),
  );
  if (!d) return;
  // Edits are tried on a copy first, so an invalid value changes nothing and leaves no undo step.
  const tryApply = (k, raw) => {
    const t = { ...d };
    if (!apply(p, t, k, raw)) return false;
    Object.assign(d, t);
    return true;
  };
  let pushed = false; // one undo step per slider drag
  box.querySelectorAll('[data-dp]').forEach((inp) => {
    const k = inp.dataset.dp;
    // Sliders update the 2D opening live without rebuilding the inspector (which would end the drag).
    if (inp.type === 'range')
      inp.addEventListener('input', () => {
        if (!pushed) pushHistory();
        pushed = true;
        if (tryApply(k, inp.value)) {
          inp.nextElementSibling.value = inp.value;
          render();
        }
      });
    inp.addEventListener('change', () => {
      if (inp.type === 'range') pushed = false;
      else {
        const t = { ...d };
        if (apply(p, t, k, inp.value)) {
          pushHistory();
          Object.assign(d, t);
        }
      }
      renderAll();
    });
  });
  const on = (id, f) => {
    const b = box.querySelector('#' + id);
    if (b) b.addEventListener('click', f);
  };
  on('dp-open', () => openDart(p.id, d.id));
  on('dp-clear-locks', () => {
    pushHistory();
    d.angleLocks = [];
    d.scaleLocks = [];
    renderAll();
  });
  on('dp-reset', () => {
    pushHistory();
    for (const [k, v] of Object.entries(DART_DEFAULTS)) if (k !== 'defect') d[k] = Array.isArray(v) ? [] : v;
    renderAll();
  });
  on('dp-del', () => deleteDart(p, d));
}
