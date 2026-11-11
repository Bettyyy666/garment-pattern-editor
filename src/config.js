// Constants: colors, tolerances, storage keys.
export const TINTS = ['#fbfaf6', '#fde9dc', '#e3eefb', '#e8f3df', '#f3e6f5', '#fff3cc', '#dff3f0', '#f6e0e0'];
export const STITCH_COLORS = [
  '#ff6b35',
  '#c03fd1',
  '#00a3a3',
  '#d4a000',
  '#e0336a',
  '#3c8d2f',
  '#7a5cff',
  '#b5651d',
];
// Diverging colormap anchors (matplotlib coolwarm at 0, .25, .5, .75, 1), as in the intrinsic-dart demo.
export const DIVERGING = ['#3b4cc0', '#8db0fe', '#dddcdc', '#f49a7b', '#b40426'];
export const VEPS = 0.05; // cm: a cut closer than this to an existing vertex snaps to it

export const STORAGE_KEY = 'garment-pattern-editor.spec'; // localStorage key for the last saved specification
