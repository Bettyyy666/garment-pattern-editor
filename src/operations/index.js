// Registry of design operations shown in the "Design operations" panel.
// To add one: implement it in its own module under src/operations/, then add an entry here.
//   id      – stable identifier
//   button  – selector of its button in index.html
//   key     – optional single-key shortcut
//   run     – function called on click / shortcut (push history, mutate app.state, renderAll)
import { doSplit } from './split.js';
import { delSel, duplicate, mirror, rotate } from './transform.js';

export const OPERATIONS = [
  { id: 'split', button: '#op-split', key: 's', run: doSplit },
  { id: 'mirror', button: '#op-mirror', key: 'm', run: mirror },
  { id: 'rotate', button: '#op-rotate', key: 'r', run: rotate },
  { id: 'duplicate', button: '#op-dup', run: duplicate },
  { id: 'delete', button: '#op-del', run: delSel },
];
