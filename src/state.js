// Single mutable app store, undo/redo history and id generation.
import { renderAll } from './ui/inspector.js';

export const app = {
  state: { panels: [], marks: [], stitches: [] }, // the pattern document (undoable)
  spec: { name: 'specification.json', version: 0, savedAt: null, text: '', snap: null, extra: null }, // last saved GarmentCode spec
  underlay: null, // traced source image shown under the panels
  sel: null,
  tool: 'select',
  draft: null,
  drag: null,
  hover: null,
  snapInfo: null,
  spaceDown: false,
  view: { s: 12, ox: 0, oy: 0 },
  opts: { grid: true, sa: false, measure: true, verts: false, stitch: true, under: true },
  undoStack: [],
  redoStack: [],
  uid: 1,
  tintN: 0,
  fitted: false,
  lastEvt: null,
  lastDown: null,
  traceSrc: null,
  traceRes: null,
  downloads: null,
};
export const nid = (p) => p + app.uid++;
export const getPanel = (id) => app.state.panels.find((p) => p.id === id),
  getMark = (id) => app.state.marks.find((m) => m.id === id);
export const snapshot = () =>
  JSON.stringify({
    panels: app.state.panels,
    marks: app.state.marks,
    stitches: app.state.stitches,
    uid: app.uid,
    tintN: app.tintN,
  });
export function restore(js) {
  const o = JSON.parse(js);
  app.state = { panels: o.panels, marks: o.marks, stitches: o.stitches || [] };
  app.uid = o.uid;
  app.tintN = o.tintN;
  if (app.sel && !(app.sel.kind === 'panel' ? getPanel(app.sel.id) : getMark(app.sel.id))) app.sel = null;
}
export function pushHistory() {
  app.undoStack.push(snapshot());
  if (app.undoStack.length > 150) app.undoStack.shift();
  app.redoStack = [];
}
export function undo() {
  if (!app.undoStack.length) return;
  app.redoStack.push(snapshot());
  restore(app.undoStack.pop());
  app.draft = null;
  renderAll();
}
export function redo() {
  if (!app.redoStack.length) return;
  app.undoStack.push(snapshot());
  restore(app.redoStack.pop());
  app.draft = null;
  renderAll();
}
