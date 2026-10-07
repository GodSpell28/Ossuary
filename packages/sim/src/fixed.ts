// 16.16 fixed point. All simulation positions, speeds and heights are plain
// integers in this format. Products stay below 2^53 for any value the game
// uses, so every operation here is exact and identical across JS engines.

export const FRAC_BITS = 16;
export const ONE = 1 << FRAC_BITS;

/** World units per tile. Heights in level files are written in units. */
export const UNITS_PER_TILE = 64;
export const UNIT = ONE / UNITS_PER_TILE;

export function fmul(a: number, b: number): number {
  return Math.floor((a * b) / ONE);
}

export function fdiv(a: number, b: number): number {
  return Math.floor((a * ONE) / b);
}

/** Converts world units (64 per tile) to fixed point. Only for level data. */
export function units(u: number): number {
  return u * UNIT;
}

/** Converts fixed point to a float in tiles. Render side only. */
export function toFloat(f: number): number {
  return f / ONE;
}
