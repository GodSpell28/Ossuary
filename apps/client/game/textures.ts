import { makeRng } from '@ossuary/sim';

// Every texture is painted here in code at 64x64 and snapped to one 32-colour
// palette, so the whole game reads as one set. No external art yet.

export const TEX_SIZE = 64;

// prettier-ignore
export const PALETTE: number[] = [
  0x0a0908, 0x1a1714, 0x2a2622, 0x3d3833, 0x554e46, 0x6f665b, 0x8c8173, 0xaa9e8c, 0xcbbfa8,
  0x2b1a10, 0x45291a, 0x613a22, 0x7d4e2c, 0x9a6638, 0xb98447,
  0x3a0c0a, 0x5e1510, 0x8a2116, 0xb8321e,
  0x14260f, 0x23401a, 0x3a6626, 0x5f9a38, 0x9ccc4a,
  0x141a26, 0x232d40, 0x36465e, 0x52657e, 0x7489a3,
  0x2a1830, 0x46284e,
  0xe0c060,
];

const quantCache = new Map<number, number>();

export function quantise(r: number, g: number, b: number): number {
  r = clamp255(r);
  g = clamp255(g);
  b = clamp255(b);
  const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
  const hit = quantCache.get(key);
  if (hit !== undefined) return hit;
  let best = PALETTE[0];
  let bestD = Infinity;
  for (const c of PALETTE) {
    const dr = ((c >> 16) & 255) - r;
    const dg = ((c >> 8) & 255) - g;
    const db = (c & 255) - b;
    const d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  quantCache.set(key, best);
  return best;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

type RGB = [number, number, number];
type Painter = (x: number, y: number) => RGB;

function paint(fn: Painter): ImageData {
  const img = new ImageData(TEX_SIZE, TEX_SIZE);
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const [r, g, b] = fn(x, y);
      const c = quantise(r, g, b);
      const o = (y * TEX_SIZE + x) * 4;
      img.data[o] = (c >> 16) & 255;
      img.data[o + 1] = (c >> 8) & 255;
      img.data[o + 2] = c & 255;
      img.data[o + 3] = 255;
    }
  }
  return img;
}

/** Tileable value noise in [0, 1) with `cells` lattice cells across the texture. */
function valueNoise(seed: number, cells: number): (x: number, y: number) => number {
  const r = makeRng(seed);
  const lattice = Array.from({ length: cells * cells }, () => r());
  const at = (cx: number, cy: number) => lattice[((cy + cells) % cells) * cells + ((cx + cells) % cells)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = (x / TEX_SIZE) * cells;
    const fy = (y / TEX_SIZE) * cells;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = smooth(fx - ix);
    const ty = smooth(fy - iy);
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
    return a + (b - a) * ty;
  };
}

function grain(seed: number): (x: number, y: number) => number {
  const r = makeRng(seed);
  const g = Array.from({ length: TEX_SIZE * TEX_SIZE }, () => r() - 0.5);
  return (x, y) => g[y * TEX_SIZE + x];
}

function brick(): ImageData {
  const r = makeRng(11);
  const n = grain(12);
  const blot = valueNoise(13, 8);
  const tones = Array.from({ length: 16 }, () => 0.75 + r() * 0.4);
  return paint((x, y) => {
    const row = y >> 4;
    const by = y & 15;
    const bx = (x + (row & 1 ? 16 : 0)) & 31;
    const id = row * 2 + (((x + (row & 1 ? 16 : 0)) >> 5) & 1);
    if (by < 2 || bx < 2) return [26, 23, 20];
    const t = tones[id] * (0.8 + blot(x, y) * 0.4);
    let base: RGB = [104 * t, 86 * t, 70 * t];
    if (by === 2 || bx === 2) base = [base[0] + 28, base[1] + 24, base[2] + 20];
    if (by === 15 || bx === 31) base = [base[0] - 30, base[1] - 28, base[2] - 26];
    const g = n(x, y) * 26;
    return [base[0] + g, base[1] + g, base[2] + g];
  });
}

function metal(): ImageData {
  const n = grain(21);
  const rust = valueNoise(22, 4);
  return paint((x, y) => {
    const px = x & 31;
    const py = y & 31;
    if (px === 0 || py === 0) return [20, 26, 38];
    if (px === 1 || py === 1) return [124, 140, 160];
    const rivet = (px === 4 || px === 28) && (py === 4 || py === 28);
    if (rivet) return [200, 196, 180];
    // Rust runs down from the rivets.
    const streak = (px === 4 || px === 28) && py > 4 && rust(x, y) > 0.45 ? 1 : 0;
    const g = n(x, y) * 18;
    if (streak) return [120 + g, 70 + g, 40];
    const shade = 1 - py / 90;
    return [70 * shade + g, 84 * shade + g, 104 * shade + g];
  });
}

function tech(): ImageData {
  const n = grain(31);
  return paint((x, y) => {
    const g = n(x, y) * 14;
    if (y >= 26 && y < 30) {
      // Light strip, brightest in the middle rows.
      const hot = y === 27 || y === 28;
      return hot ? [230, 200, 100] : [160, 120, 60];
    }
    if (y === 25 || y === 30) return [12, 10, 10];
    if ((y > 40 && y < 56 && (x & 3) === 0) || (y === 40 && x > 2)) return [18, 18, 20];
    if (x === 0 || y === 0) return [16, 16, 20];
    return [44 + g, 46 + g, 56 + g];
  });
}

function flagstone(): ImageData {
  const r = makeRng(41);
  const n = grain(42);
  const pts = Array.from({ length: 9 }, () => [r() * TEX_SIZE, r() * TEX_SIZE, 0.7 + r() * 0.4]);
  return paint((x, y) => {
    let d1 = Infinity;
    let d2 = Infinity;
    let tone = 1;
    for (const [px, py, t] of pts) {
      // Wrap so the pattern tiles.
      for (let ox = -TEX_SIZE; ox <= TEX_SIZE; ox += TEX_SIZE) {
        for (let oy = -TEX_SIZE; oy <= TEX_SIZE; oy += TEX_SIZE) {
          const d = Math.hypot(x - px - ox, y - py - oy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            tone = t;
          } else if (d < d2) d2 = d;
        }
      }
    }
    if (d2 - d1 < 1.6) return [22, 20, 18];
    const g = n(x, y) * 22;
    const edge = d2 - d1 < 3.5 ? -14 : 0;
    return [92 * tone + g + edge, 84 * tone + g + edge, 74 * tone + g + edge];
  });
}

function grate(): ImageData {
  const n = grain(51);
  return paint((x, y) => {
    const g = n(x, y) * 16;
    const bx = x & 7;
    const by = y & 7;
    if (bx < 2 || by < 2) {
      const hi = bx === 0 || by === 0;
      return hi ? [128 + g, 120 + g, 104 + g] : [88 + g, 80 + g, 70 + g];
    }
    return [14, 12, 12];
  });
}

function plates(): ImageData {
  const r = makeRng(61);
  const n = grain(62);
  const tones = Array.from({ length: 16 }, () => 0.8 + r() * 0.3);
  return paint((x, y) => {
    const px = x & 15;
    const py = y & 15;
    const t = tones[(y >> 4) * 4 + (x >> 4)];
    const g = n(x, y) * 12;
    if (px === 0 || py === 0) return [20, 18, 16];
    if (px === 1 || py === 1) return [96 * t, 90 * t, 80 * t];
    if (px === 15 || py === 15) return [34, 30, 28];
    return [60 * t + g, 56 * t + g, 50 * t + g];
  });
}

function slime(): ImageData {
  const a = valueNoise(71, 4);
  const b = valueNoise(72, 8);
  return paint((x, y) => {
    const v = a(x, y) * 0.65 + b(x, y) * 0.35;
    if (v > 0.68) return [156, 204, 74];
    return [30 + v * 60, 60 + v * 120, 20 + v * 40];
  });
}

function door(band: RGB | null): () => ImageData {
  return () => {
    const n = grain(81);
    return paint((x, y) => {
      const g = n(x, y) * 14;
      // Frame
      if (x < 3 || x > 60) return [36 + g, 34 + g, 40 + g];
      if (x === 3 || x === 60) return [110, 112, 120];
      // Horizontal ribs
      if (y % 16 === 0) return [24, 22, 26];
      if (y % 16 === 1) return [120 + g, 118 + g, 124 + g];
      if (band && y >= 26 && y < 38) {
        if (y === 26 || y === 37) return [30, 10, 8];
        return [band[0] + g, band[1] + g, band[2] + g];
      }
      // Hazard chevrons along the bottom
      if (y > 52) return ((x + y) >> 2) & 1 ? [200, 160, 60] : [30, 26, 22];
      return [78 + g, 80 + g, 90 + g];
    });
  };
}

function exitSigil(): ImageData {
  const n = grain(91);
  return paint((x, y) => {
    const dx = x - 31.5;
    const dy = y - 31.5;
    const d = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx);
    const ring = Math.abs(d - 24) < 1.6 || Math.abs(d - 18) < 1;
    const spoke = d < 18 && Math.abs(Math.sin(a * 2.5)) < 0.12;
    const g = n(x, y) * 16;
    if (ring || spoke) return [230, 196, 100];
    if (d < 26) return [70 + g, 30 + g, 20 + g];
    return [40 + g, 34 + g, 30 + g];
  });
}

export const TEXTURE_PAINTERS: Record<string, () => ImageData> = {
  door: door(null),
  door_red: door([180, 40, 28]),
  door_blue: door([60, 90, 160]),
  exit: exitSigil,
  brick,
  metal,
  tech,
  flagstone,
  grate,
  plates,
  slime,
};
