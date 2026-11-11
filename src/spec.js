// Saved specification: save, dirty state, export dialog and download.
import { STORAGE_KEY } from './config.js';
import { buildSpec, isGarmentCode, loadGarmentCode } from './io/garmentcode.js';
import { analyzeAll } from './io/intrinsic-analysis.js';
import { app, snapshot } from './state.js';
import { $ } from './ui/dom.js';
import { fmtTime, renderInspector } from './ui/inspector.js';
import { toast } from './ui/toast.js';
import { esc } from './util.js';

export const isDirty = () => app.spec.snap !== snapshot();

// After a specification loads: compute every panel's intrinsic description (io/intrinsic-analysis.js) and, while
// nothing has been edited, write it into the loaded specification text so Export shows it.
export async function analyzeLoaded(rewrite) {
  const snap = app.spec.snap,
    r = await analyzeAll();
  if (r.offline) {
    toast(
      'Intrinsic analysis needs the dart solver server (npm start). Darts were read from the stitches.',
      true,
    );
    return;
  }
  if (rewrite && app.spec.snap === snap && !isDirty()) {
    app.spec.text = JSON.stringify(buildSpec(), null, 2);
    if (!$('#modal').hidden) fillExport();
  }
  const darts = app.state.panels.reduce((s, p) => s + (p.darts || []).length, 0);
  toast(
    `ConeDartModel: edge lengths and turns for ${r.done} panels, ${darts} darts (apex, Ω, cut) stored in the specification.` +
      (r.failed ? ` ${r.failed} panels could not be analyzed.` : ''),
  );
}

export async function saveSpec() {
  await analyzeAll();
  const o = buildSpec();
  app.spec.text = JSON.stringify(o, null, 2);
  app.spec.version++;
  app.spec.savedAt = new Date();
  app.spec.snap = snapshot();
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        name: app.spec.name,
        version: app.spec.version,
        savedAt: app.spec.savedAt.toISOString(),
        text: app.spec.text,
      }),
    );
  } catch {}
  renderInspector();
  if (!$('#modal').hidden) fillExport();
  toast(
    `Saved ${app.spec.name} (v${app.spec.version}): ${Object.keys(o.pattern.panels).length} panels, ${o.pattern.stitches.length} stitches.`,
  );
}
export function loadAnyJSON(text, srcName) {
  const o = JSON.parse(text);
  if (!isGarmentCode(o))
    throw new Error('This is not a GarmentCode specification (expected pattern.panels).');
  loadGarmentCode(o, srcName, text);
}
export function setSource(html) {
  $('#src-info').innerHTML = html;
}
export function fillExport() {
  const dirty = isDirty();
  if (!app.spec.text) {
    $('#json').value = '';
    $('#exp-note').innerHTML =
      'Nothing saved yet. Choose <b>Save</b> to build the specification from the current pattern.';
  } else {
    $('#json').value = app.spec.text;
    $('#exp-note').innerHTML =
      (app.spec.version
        ? `<b>${esc(app.spec.name)}</b>, version ${app.spec.version}, saved ${fmtTime(app.spec.savedAt)}.`
        : `<b>${esc(app.spec.name)}</b> as loaded.`) +
      (dirty ? ' <span class="warn-text">You have unsaved edits that are not in this file.</span>' : '');
  }
  $('#json-save').hidden = !dirty;
  $('#json-dl').disabled = $('#json-copy').disabled = !app.spec.text;
}
export async function downloadSpec() {
  if (!app.spec.text || !app.downloads) return;
  try {
    await app.downloads.save({ filename: app.spec.name, data: app.spec.text });
    toast(`Saved ${app.spec.name} to your device.`);
  } catch (err) {
    if (err && err.code === 'declined') return;
    toast(
      err && err.code === 'rate_limited'
        ? 'A save prompt is already open.'
        : 'Download is not available here. Use Copy instead.',
      true,
    );
  }
}

export function initDownloads() {
  (async () => {
    try {
      app.downloads = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    } catch {
      app.downloads = null;
    }
    $('#json-dl').hidden = !app.downloads;
  })();
}
