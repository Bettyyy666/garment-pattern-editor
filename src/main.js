// Entry point: wires the DOM to modules and boots the app.
import { STORAGE_KEY } from './config.js';
import { OPERATIONS } from './operations/index.js';
import { initPointer } from './ui/pointer.js';
import { initKeyboard } from './ui/keyboard.js';
import { initDartView } from './ui/dart-view.js';
import { initSections } from './ui/sections.js';
import { initView3d } from './ui/view3d.js';
import { loadGarmentCode } from './io/garmentcode.js';
import { commitTrace, runTrace } from './io/image-trace.js';
import { openFile } from './io/open-file.js';
import { addTemplate, loadSample } from './model/panels.js';
import { initDownloads, downloadSpec, fillExport, loadAnyJSON, saveSpec, setSource } from './spec.js';
import { app, pushHistory, redo, undo } from './state.js';
import { $, svg } from './ui/dom.js';
import { renderAll } from './ui/inspector.js';
import { render } from './ui/render.js';
import { toast } from './ui/toast.js';
import { setTool } from './ui/tools.js';
import { fit, rect } from './ui/viewport.js';
import { esc } from './util.js';

document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#undo').onclick = undo;
$('#redo').onclick = redo;
$('#fit').onclick = fit;
const DEFAULT_SPEC = 'examples/default_specification.json';
// Load the default garment (a GarmentCode specification); fall back to the built-in bodice sample.
async function loadDefault() {
  try {
    const r = await fetch(DEFAULT_SPEC);
    if (!r.ok) throw new Error(r.statusText);
    const text = await r.text();
    loadGarmentCode(JSON.parse(text), 'default_specification.json', text);
    setSource(`Showing the default garment <b>${esc(DEFAULT_SPEC)}</b>.`);
  } catch {
    pushHistory();
    loadSample();
    setSource('Showing the built-in bodice sample (the default garment could not be loaded).');
    renderAll();
    fit();
  }
}
$('#reset').onclick = async () => {
  await loadDefault();
  toast('Default garment restored. Undo to go back.');
};
OPERATIONS.forEach((op) => {
  $(op.button).onclick = op.run;
});
$('#op-clear').onclick = () => {
  if (!app.state.marks.length) return;
  pushHistory();
  app.state.marks = [];
  if (app.sel && app.sel.kind === 'mark') app.sel = null;
  renderAll();
};
$('#add-tpl').onclick = () => {
  pushHistory();
  const p = addTemplate($('#tpl').value);
  app.sel = { kind: 'panel', id: p.id };
  renderAll();
  fit();
};
$('#plist').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick]');
  if (b) {
    app.sel = { kind: 'panel', id: b.dataset.pick };
    renderAll();
  }
});
[
  ['grid', 'opt-grid'],
  ['sa', 'opt-sa'],
  ['measure', 'opt-measure'],
  ['verts', 'opt-verts'],
  ['stitch', 'opt-stitch'],
  ['under', 'opt-under'],
].forEach(([k, id]) =>
  $('#' + id).addEventListener('change', (e) => {
    app.opts[k] = e.target.checked;
    render();
  }),
);
['gs-len', 'gs-width'].forEach((id) => $('#' + id).addEventListener('input', renderAll));
$('#save').onclick = saveSpec;
$('#spec-save').onclick = saveSpec;
$('#json-save').onclick = saveSpec;
const openExport = () => {
  fillExport();
  $('#modal').hidden = false;
};
$('#io').onclick = openExport;
$('#spec-view').onclick = openExport;
$('#json-close').onclick = () => ($('#modal').hidden = true);
$('#json-dl').onclick = downloadSpec;
$('#json-copy').onclick = () => {
  const ta = $('#json');
  (navigator.clipboard ? navigator.clipboard.writeText(ta.value) : Promise.reject())
    .then(() => toast('Copied specification JSON.'))
    .catch(() => {
      ta.select();
      toast('Press Ctrl+C / ⌘C to copy the selected JSON.');
    });
};
$('#json-import').onclick = () => {
  try {
    loadAnyJSON($('#json').value, app.spec.name || 'pasted.json');
    $('#modal').hidden = true;
  } catch (err) {
    toast('Import failed: ' + err.message, true);
  }
};
$('#file').addEventListener('change', (e) => {
  openFile(e.target.files[0]);
  e.target.value = '';
});
const mainEl = document.querySelector('main');
['dragenter', 'dragover'].forEach((ev) =>
  mainEl.addEventListener(ev, (e) => {
    e.preventDefault();
    mainEl.classList.add('dragover');
  }),
);
['dragleave', 'drop'].forEach((ev) =>
  mainEl.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === 'dragleave' && mainEl.contains(e.relatedTarget)) return;
    mainEl.classList.remove('dragover');
  }),
);
mainEl.addEventListener('drop', (e) => {
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (f) openFile(f);
});
['tr-tol', 'tr-simp', 'tr-scale'].forEach((id) => $('#' + id).addEventListener('input', runTrace));
$('#tr-cancel').onclick = () => {
  $('#trace').hidden = true;
};
$('#tr-add').onclick = () => commitTrace(false);
$('#tr-replace').onclick = () => commitTrace(true);
['modal', 'trace'].forEach((id) =>
  $('#' + id).addEventListener('click', (e) => {
    if (e.target.id === id) $('#' + id).hidden = true;
  }),
);
addEventListener(
  'keydown',
  (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveSpec();
    }
  },
  true,
);

initSections();
initPointer();
initKeyboard();
initDartView();
initView3d();
initDownloads();

new ResizeObserver(() => {
  if (!app.fitted && rect().width) {
    app.fitted = true;
    fit();
  } else render();
}).observe(svg);
loadSample();
let restored = false;
try {
  const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (s && s.text) {
    loadGarmentCode(JSON.parse(s.text), s.name, s.text, { version: s.version, savedAt: s.savedAt });
    restored = true;
    setSource(
      `Restored your last save: <b>${esc(s.name)}</b> (version ${s.version}). Reset to default or open a file to start over.`,
    );
  }
} catch {}
if (!restored) await loadDefault();
app.undoStack = [];
app.redoStack = [];
setTool('select');
renderAll();
