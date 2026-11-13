// Target body for the 3D view: lists and loads body meshes + measurements from the local server (server/body.py), and
// uploads a body the user picks (an OBJ in GarmentCode body topology, plus its measurements .yaml if there is one). The loaded body lives on app.body, outside the document (loading one is not an edit); the
// chosen body id is a per-viewer convenience kept in localStorage.
import { app } from '../state.js';
import { $ } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { fit3d } from '../ui/view3d.js';
import { esc } from '../util.js';

const KEY = 'gpe.body';
const remember = (id) => {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // storage unavailable: the choice just isn't remembered
  }
};
const recalled = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export async function loadBody(id) {
  app.bodyNote = '';
  if (!id) {
    app.body = null;
    fit3d();
    return;
  }
  try {
    const r = await fetch('/api/body/' + encodeURIComponent(id));
    if (!r.ok) throw new Error(r.statusText);
    app.body = await r.json();
  } catch {
    app.body = null;
    app.bodyNote = `Body ${id} could not be loaded.`;
  }
  fit3d();
}

async function fillList(sel) {
  let list = [];
  try {
    const r = await fetch('/api/body/list');
    const j = r.ok ? await r.json() : { bodies: [] };
    list = j.bodies || [];
    if (j.error) app.bodyNote = j.error;
  } catch {
    app.bodyNote = 'No body: the server is not running (npm start).';
  }
  sel.innerHTML =
    '<option value="">No body (GarmentCode placement)</option>' +
    list.map((b) => `<option value="${esc(b.id)}">${esc(b.id.replace(/^upload:/, ''))}</option>`).join('');
  return list;
}

// Upload the chosen files: exactly one .obj, at most one .yaml/.yml (GarmentCode body measurements).
async function uploadBody(files, sel) {
  const F = [...files],
    obj = F.filter((f) => /\.obj$/i.test(f.name)),
    yaml = F.filter((f) => /\.ya?ml$/i.test(f.name));
  if (obj.length !== 1 || yaml.length > 1)
    return toast('Choose one body .obj, plus its measurements .yaml if you have one.', true);
  let j;
  try {
    const r = await fetch('/api/body/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: obj[0].name,
        obj: await obj[0].text(),
        yaml: yaml.length ? await yaml[0].text() : null,
      }),
    });
    j = await r.json();
  } catch {
    j = { error: 'The server is not running (npm start).' };
  }
  if (j.error) return toast(`Body not loaded: ${j.error}`, true);
  await fillList(sel);
  sel.value = j.id;
  await loadBody(j.id);
  toast(
    `Body ${obj[0].name} loaded${yaml.length ? ` with ${yaml[0].name}` : '; neck and waist heights estimated from the mesh'}.`,
  );
}

export async function initBody() {
  const sel = $('#body3d'),
    file = $('#body-file');
  $('#body-load').onclick = () => file.click();
  file.addEventListener('change', () => {
    if (file.files.length) uploadBody(file.files, sel);
    file.value = '';
  });
  const list = await fillList(sel);
  const saved = recalled(),
    id =
      saved !== null && (saved === '' || list.some((b) => b.id === saved))
        ? saved
        : list[0]
          ? list[0].id
          : '';
  sel.value = id;
  sel.addEventListener('change', () => {
    remember(sel.value);
    loadBody(sel.value);
  });
  await loadBody(id);
}
