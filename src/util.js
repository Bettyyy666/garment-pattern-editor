// Small formatting helpers shared across modules.
export const slug = (s) =>
  String(s)
    .trim()
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'panel';
export const r4 = (n) => Math.round(n * 1e4) / 1e4;
export const f3 = (n) => +n.toFixed(3);
export const dPath = (P, close = true) =>
  'M' + P.map((p) => f3(p[0]) + ' ' + f3(p[1])).join('L') + (close ? 'Z' : '');
export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
