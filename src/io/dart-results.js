// Solved dart openings for the 2D view: one intrinsic-dart solve (server, io/dart-server.js) per dart, cached by
// everything that changes the result. The key ignores where the panel sits on the canvas, so moving a panel
// reuses its solve. Requests run one at a time; render() is called when a result arrives.
import { DART_DEFAULTS } from '../model/dart-solve.js';
import { app } from '../state.js';
import { refreshDartReadout } from '../ui/dart-editor.js';
import { render } from '../ui/render.js';
import { solveDart } from './dart-server.js';

const cache = new Map(), // dart id -> { key, res }
  queue = new Map(); // dart id -> { pid, key }
let busy = false;

// Translation-invariant key: intrinsic shape + apex relative to the panel start + every solver setting.
function keyOf(p, d) {
  const S = p.shape || {},
    s = S.start || [0, 0],
    r = (v) => Math.round(v * 1e6) / 1e6;
  return JSON.stringify([
    S.len,
    S.turn,
    S.curve,
    S.dir,
    [r(d.at[0] - s[0]), r(d.at[1] - s[1])],
    d.defect,
    d.cut,
    d.legs || 0,
    (p.darts || []).map((x) => x.legs || 0),
    Object.keys(DART_DEFAULTS).map((k) => d[k]),
  ]);
}

async function pump() {
  if (busy) return;
  const next = queue.entries().next();
  if (next.done) return;
  const [did, job] = next.value;
  queue.delete(did);
  const p = app.state.panels.find((x) => x.id === job.pid),
    d = p && (p.darts || []).find((x) => x.id === did);
  if (!d || keyOf(p, d) !== job.key) return pump();
  busy = true;
  let res;
  try {
    res = await solveDart(p, { ...d });
  } finally {
    busy = false;
  }
  cache.set(did, { key: job.key, res });
  render();
  refreshDartReadout();
  pump();
}

// The latest solve of dart d on panel p: { res, current } (res null until one arrives). A missing or out-of-date
// result is queued, except while something is being dragged.
export function dartResult(p, d) {
  const key = keyOf(p, d),
    c = cache.get(d.id),
    current = !!c && c.key === key;
  if (!current && !app.drag && !(queue.has(d.id) && queue.get(d.id).key === key)) {
    queue.set(d.id, { pid: p.id, key });
    setTimeout(pump, 0);
  }
  return { res: c ? c.res : null, current };
}
