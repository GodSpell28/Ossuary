import { ONE } from './fixed';

// Angles are integers in [0, ANGLES). 0 faces +x, and increasing angles turn
// right (clockwise seen from above, since +y points south on the map).
export const ANGLE_BITS = 12;
export const ANGLES = 1 << ANGLE_BITS;
export const ANGLE_MASK = ANGLES - 1;
export const ANG90 = ANGLES / 4;
export const ANG180 = ANGLES / 2;

// Math.sin may differ in the last bit between engines, so the table is built
// from a Taylor series using only +, *, / which IEEE 754 rounds identically
// everywhere.
const PI = 3.141592653589793;

function taylorSin(x: number): number {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n < 12; n++) {
    term = (-term * x2) / (2 * n * (2 * n + 1));
    sum += term;
  }
  return sum;
}

const SIN = new Int32Array(ANGLES);
for (let i = 0; i <= ANG90; i++) {
  const v = Math.round(taylorSin((i * (PI / 2)) / ANG90) * ONE);
  SIN[i] = v;
  if (i < ANG90) SIN[ANG180 - i] = v;
  SIN[(ANG180 + i) & ANGLE_MASK] = -v;
  if (i < ANG90) SIN[(ANGLES - i) & ANGLE_MASK] = -v;
}

export function fsin(a: number): number {
  return SIN[a & ANGLE_MASK];
}

export function fcos(a: number): number {
  return SIN[(a + ANG90) & ANGLE_MASK];
}

export function angleToRadians(a: number): number {
  return (a * 2 * Math.PI) / ANGLES;
}
