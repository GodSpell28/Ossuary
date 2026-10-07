import * as THREE from 'three';
import { tileIndex, type Level } from '@ossuary/sim';
import type { WorldMaterials } from './materials';

// Turns the tile grid into one mesh per texture. World axes: three x = tile x,
// three z = tile y, three y = height in tiles. Light colours are baked into a
// per-vertex attribute, averaged at tile corners so neighbouring sectors blend
// into gradients.

export type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

class Batch {
  pos: number[] = [];
  uv: number[] = [];
  light: number[] = [];
  idx: number[] = [];

  quad(p: number[][], uv: number[][], light: RGB[]): void {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(...p[i]);
      this.uv.push(...uv[i]);
      this.light.push(...light[i]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aLight', new THREE.Float32BufferAttribute(this.light, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Light colour at any point on the map, interpolated between tile corners. 0.5 is neutral. */
export interface LightSampler {
  floorAt(x: number, y: number): RGB;
  ceilAt(x: number, y: number): RGB;
}

export function buildLevelMesh(level: Level, materials: WorldMaterials): { group: THREE.Group; light: LightSampler } {
  const { w, h } = level;
  const toTiles = (fixed: number) => fixed / 65536;
  const sectorLights = level.sectors.map((s) => ({
    floor: hexToRgb(s.light),
    ceil: hexToRgb(s.lightTop ?? s.light),
  }));

  // Average light at each tile corner from the open tiles touching it.
  const cw = w + 1;
  const floorCorner: RGB[] = [];
  const ceilCorner: RGB[] = [];
  for (let cy = 0; cy <= h; cy++) {
    for (let cx = 0; cx <= w; cx++) {
      const f: RGB = [0, 0, 0];
      const c: RGB = [0, 0, 0];
      let n = 0;
      for (const [dx, dy] of [
        [-1, -1],
        [0, -1],
        [-1, 0],
        [0, 0],
      ]) {
        const i = tileIndex(level, cx + dx, cy + dy);
        if (i < 0 || level.solid[i]) continue;
        const l = sectorLights[level.sectorOf[i]];
        for (let k = 0; k < 3; k++) {
          f[k] += l.floor[k];
          c[k] += l.ceil[k];
        }
        n++;
      }
      if (n) for (let k = 0; k < 3; k++) (f[k] /= n), (c[k] /= n);
      floorCorner.push(f);
      ceilCorner.push(c);
    }
  }
  const fc = (cx: number, cy: number) => floorCorner[cy * cw + cx];
  const cc = (cx: number, cy: number) => ceilCorner[cy * cw + cx];

  const batches = new Map<string, Batch>();
  const batch = (tex: string) => {
    let b = batches.get(tex);
    if (!b) batches.set(tex, (b = new Batch()));
    return b;
  };

  // Wall sides for an open tile at (x, y), as [neighbour dx, dy, corner1, corner2, u axis].
  // Corners run left to right as seen from inside the tile so textures are not mirrored.
  const sides: [number, number, [number, number], [number, number], (cx: number, cy: number) => number][] = [
    [1, 0, [1, 0], [1, 1], (_cx, cy) => cy],
    [-1, 0, [0, 1], [0, 0], (_cx, cy) => -cy],
    [0, 1, [1, 1], [0, 1], (cx) => -cx],
    [0, -1, [0, 0], [1, 0], (cx) => cx],
  ];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (level.solid[i]) continue;
      const sector = level.sectors[level.sectorOf[i]];
      const floor = toTiles(level.floor[i]);
      const ceil = toTiles(level.ceil[i]);

      batch(sector.floorTex).quad(
        [
          [x, floor, y],
          [x + 1, floor, y],
          [x + 1, floor, y + 1],
          [x, floor, y + 1],
        ],
        [
          [x, -y],
          [x + 1, -y],
          [x + 1, -y - 1],
          [x, -y - 1],
        ],
        [fc(x, y), fc(x + 1, y), fc(x + 1, y + 1), fc(x, y + 1)],
      );
      batch(sector.ceilTex).quad(
        [
          [x, ceil, y],
          [x, ceil, y + 1],
          [x + 1, ceil, y + 1],
          [x + 1, ceil, y],
        ],
        [
          [x, y],
          [x, y + 1],
          [x + 1, y + 1],
          [x + 1, y],
        ],
        [cc(x, y), cc(x, y + 1), cc(x + 1, y + 1), cc(x + 1, y)],
      );

      const lightAt = (cx: number, cy: number, height: number): RGB => {
        const t = Math.min(1, Math.max(0, (height - floor) / (ceil - floor)));
        const a = fc(cx, cy);
        const b = cc(cx, cy);
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      };

      const wall = (tex: string, side: (typeof sides)[number], lo: number, hi: number) => {
        const [, , c1, c2, uOf] = side;
        const x1 = x + c1[0];
        const y1 = y + c1[1];
        const x2 = x + c2[0];
        const y2 = y + c2[1];
        const u1 = uOf(x1, y1);
        const u2 = uOf(x2, y2);
        batch(tex).quad(
          [
            [x1, lo, y1],
            [x2, lo, y2],
            [x2, hi, y2],
            [x1, hi, y1],
          ],
          [
            [u1, lo],
            [u2, lo],
            [u2, hi],
            [u1, hi],
          ],
          [lightAt(x1, y1, lo), lightAt(x2, y2, lo), lightAt(x2, y2, hi), lightAt(x1, y1, hi)],
        );
      };

      for (const side of sides) {
        const n = tileIndex(level, x + side[0], y + side[1]);
        if (n < 0) continue;
        if (level.solid[n]) {
          wall(level.wallTex[n], side, floor, ceil);
          continue;
        }
        const ns = level.sectors[level.sectorOf[n]];
        const nf = toTiles(level.floor[n]);
        const nc = toTiles(level.ceil[n]);
        const stepTex = ns.wallTex ?? sector.wallTex ?? 'metal';
        if (nf > floor) wall(stepTex, side, floor, nf);
        if (nc < ceil) wall(stepTex, side, nc, ceil);
      }
    }
  }

  const group = new THREE.Group();
  batches.forEach((b, tex) => group.add(new THREE.Mesh(b.build(), materials.get(tex))));

  const sample = (grid: RGB[], x: number, y: number): RGB => {
    const cx = Math.max(0, Math.min(w - 1e-6, x));
    const cy = Math.max(0, Math.min(h - 1e-6, y));
    const ix = Math.floor(cx);
    const iy = Math.floor(cy);
    const tx = cx - ix;
    const ty = cy - iy;
    const a = grid[iy * cw + ix];
    const b = grid[iy * cw + ix + 1];
    const c = grid[(iy + 1) * cw + ix];
    const d = grid[(iy + 1) * cw + ix + 1];
    const out: RGB = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const top = a[k] + (b[k] - a[k]) * tx;
      const bot = c[k] + (d[k] - c[k]) * tx;
      out[k] = top + (bot - top) * ty;
    }
    return out;
  };
  return {
    group,
    light: {
      floorAt: (x, y) => sample(floorCorner, x, y),
      ceilAt: (x, y) => sample(ceilCorner, x, y),
    },
  };
}

/** Moving door slabs, one mesh per door, raised by setting position.y. */
export function buildDoorMeshes(level: Level, materials: WorldMaterials, light: LightSampler): THREE.Mesh[] {
  return level.doors.map((door) => {
    const b = new Batch();
    const height = door.height / 65536;
    const mine = new Set(door.tiles);
    for (const t of door.tiles) {
      const x = t % level.w;
      const y = Math.floor(t / level.w);
      const lo = light.floorAt(x + 0.5, y + 0.5);
      const hi = light.ceilAt(x + 0.5, y + 0.5);
      // Same side table as the walls, but faces point out of the door tile.
      const faces: [number, number, [number, number], [number, number]][] = [
        [1, 0, [1, 1], [1, 0]],
        [-1, 0, [0, 0], [0, 1]],
        [0, 1, [0, 1], [1, 1]],
        [0, -1, [1, 0], [0, 0]],
      ];
      for (const [dx, dy, c1, c2] of faces) {
        const n = tileIndex(level, x + dx, y + dy);
        if (n < 0 || level.solid[n] || mine.has(n)) continue;
        // The slab spans the whole door group, so u runs across it.
        const along = dx === 0 ? x : y;
        b.quad(
          [
            [x + c1[0], 0, y + c1[1]],
            [x + c2[0], 0, y + c2[1]],
            [x + c2[0], height, y + c2[1]],
            [x + c1[0], height, y + c1[1]],
          ],
          [
            [along, 0],
            [along + 1, 0],
            [along + 1, 1],
            [along, 1],
          ],
          [lo, lo, hi, hi],
        );
      }
      // Underside, seen while the door rises.
      b.quad(
        [
          [x, 0, y],
          [x + 1, 0, y],
          [x + 1, 0, y + 1],
          [x, 0, y + 1],
        ],
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        [lo, lo, lo, lo],
      );
    }
    const mesh = new THREE.Mesh(b.build(), materials.get(door.tex));
    mesh.position.y = level.floor[door.tiles[0]] / 65536;
    return mesh;
  });
}
