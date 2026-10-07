import { units } from './fixed';
import { ANGLES } from './trig';

// A level is a grid of tiles. Each open tile belongs to a sector, which gives
// it floor and ceiling heights, light colours and textures. Solid tiles are
// walls. The sim reads only `solid`, `floor` and `ceil`; the rest is for the
// renderer.

export interface SectorDef {
  /** Heights in world units, 64 per tile. */
  floor: number;
  ceil: number;
  /** Light at floor level and at ceiling level, as hex '#rrggbb'. 0x80 is neutral. */
  light: string;
  lightTop?: string;
  floorTex: string;
  ceilTex: string;
  /** Texture for step and lip walls inside this sector. */
  wallTex?: string;
}

export interface LegendEntry {
  /** Solid wall with this texture. */
  wall?: string;
  /** Open tile belonging to this sector. */
  sector?: string;
  /** Player start, facing this many degrees (0 = east, 90 = south). */
  spawn?: number;
}

export interface LevelDef {
  name: string;
  sectors: Record<string, SectorDef>;
  legend: Record<string, LegendEntry>;
  rows: string[];
}

export interface Sector extends SectorDef {
  id: string;
}

export interface Level {
  name: string;
  w: number;
  h: number;
  solid: Uint8Array;
  /** Fixed point heights per tile. */
  floor: Int32Array;
  ceil: Int32Array;
  /** Index into `sectors` for open tiles, -1 for walls. */
  sectorOf: Int16Array;
  wallTex: string[];
  sectors: Sector[];
  spawn: { tx: number; ty: number; angle: number };
}

export function parseLevel(def: LevelDef): Level {
  const h = def.rows.length;
  const w = def.rows[0]?.length ?? 0;
  if (!w || !h) throw new Error(`level ${def.name}: empty`);

  const sectorIds = Object.keys(def.sectors);
  const sectors: Sector[] = sectorIds.map((id) => ({ id, ...def.sectors[id] }));
  const n = w * h;
  const level: Level = {
    name: def.name,
    w,
    h,
    solid: new Uint8Array(n),
    floor: new Int32Array(n),
    ceil: new Int32Array(n),
    sectorOf: new Int16Array(n).fill(-1),
    wallTex: new Array<string>(n).fill(''),
    sectors,
    spawn: { tx: -1, ty: -1, angle: 0 },
  };

  def.rows.forEach((row, y) => {
    if (row.length !== w) {
      throw new Error(`level ${def.name}: row ${y} is ${row.length} wide, expected ${w}`);
    }
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      const entry = def.legend[ch];
      if (!entry) throw new Error(`level ${def.name}: unknown tile '${ch}' at ${x},${y}`);
      const i = y * w + x;
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (entry.wall) {
        level.solid[i] = 1;
        level.wallTex[i] = entry.wall;
        continue;
      }
      if (edge) throw new Error(`level ${def.name}: open tile on the border at ${x},${y}`);
      const s = entry.sector ? sectorIds.indexOf(entry.sector) : -1;
      if (s < 0) throw new Error(`level ${def.name}: tile '${ch}' has no valid sector`);
      level.sectorOf[i] = s;
      level.floor[i] = units(sectors[s].floor);
      level.ceil[i] = units(sectors[s].ceil);
      if (entry.spawn !== undefined) {
        level.spawn = { tx: x, ty: y, angle: Math.round((entry.spawn * ANGLES) / 360) };
      }
    }
  });

  if (level.spawn.tx < 0) throw new Error(`level ${def.name}: no player spawn`);
  return level;
}

export function tileIndex(level: Level, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= level.w || ty >= level.h) return -1;
  return ty * level.w + tx;
}
