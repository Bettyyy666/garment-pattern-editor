// Keyboard shortcuts.
import { OPERATIONS } from '../operations/index.js';
import { delSel } from '../operations/transform.js';
import { app, redo, undo } from '../state.js';
import { $ } from './dom.js';
import { render } from './render.js';
import { finishDraft, setTool } from './tools.js';
import { fit } from './viewport.js';

export const KEYS = { v: 'select', h: 'pan', p: 'point', l: 'line', c: 'curve', e: 'erase' };

export function initKeyboard() {
  addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea,select')) return;
    const k = e.key.toLowerCase(),
      mod = e.metaKey || e.ctrlKey;
    if (mod && k === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (mod && k === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod) return;
    if (e.key === ' ') {
      app.spaceDown = true;
      e.preventDefault();
      return;
    }
    if (KEYS[k]) {
      setTool(KEYS[k]);
      return;
    }
    if (e.key === 'Escape') {
      if (!$('#modal').hidden || !$('#trace').hidden) {
        $('#modal').hidden = true;
        $('#trace').hidden = true;
        return;
      }
      app.draft = null;
      render();
      return;
    }
    if (e.key === 'Enter' && app.draft) {
      finishDraft();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      delSel();
      return;
    }
    if (k === 'f') {
      fit();
      return;
    }
    const op = OPERATIONS.find((o) => o.key === k);
    if (op) {
      op.run();
      return;
    }
  });
  addEventListener('keyup', (e) => {
    if (e.key === ' ') app.spaceDown = false;
  });
}
