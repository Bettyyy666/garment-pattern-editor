// 3D panel frames: GarmentCode (Maya) intrinsic xyz Euler angles <-> rotation matrices, and canvas points in 3D.
import { toLocal } from './panels.js';

const D = Math.PI / 180;
// R = Rz * Ry * Rx, as pygarment's rotation.euler_xyz_to_R. Rows of a 3x3 matrix.
export function eulerToMat(e) {
  const [x, y, z] = e.map((v) => (v || 0) * D),
    cx = Math.cos(x),
    sx = Math.sin(x),
    cy = Math.cos(y),
    sy = Math.sin(y),
    cz = Math.cos(z),
    sz = Math.sin(z);
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}
// Port of pygarment's rotation.R_to_euler (degrees).
export function matToEuler(R) {
  const tol = 1e-12;
  let e1, e2, e3;
  if (Math.abs(R[0][0]) < tol && Math.abs(R[1][0]) < tol) {
    e1 = 0;
    e2 = Math.atan2(-R[2][0], R[0][0]);
    e3 = Math.atan2(-R[1][2], R[1][1]);
  } else {
    e1 = Math.atan2(R[1][0], R[0][0]);
    const sp = Math.sin(e1),
      cp = Math.cos(e1);
    e2 = Math.atan2(-R[2][0], cp * R[0][0] + sp * R[1][0]);
    e3 = Math.atan2(sp * R[0][2] - cp * R[1][2], cp * R[1][1] - sp * R[0][1]);
  }
  return [e3 / D, e2 / D, e1 / D];
}
export const matVec = (R, v) => R.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
// World (3D, cm) position of a canvas point that lies on panel p.
export function world3D(p, w) {
  const l = toLocal(p.place, w),
    r = matVec(eulerToMat(p.place.rot), [l[0], l[1], 0]);
  return [r[0] + p.place.t[0], r[1] + p.place.t[1], r[2] + p.place.t[2]];
}
export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const mid3 = (a, b) => mul3(add3(a, b), 0.5);
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm3 = (a) => {
  const l = Math.hypot(...a) || 1;
  return mul3(a, 1 / l);
};
