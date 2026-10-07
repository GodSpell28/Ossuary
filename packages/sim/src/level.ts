import { ONE, units } from './fixed';
import { ANGLES } from './trig';

// A level is a grid of tiles. Each open tile belongs to a sector, which gives
// it floor and ceiling heights, light colours and textures. Solid tiles are
// walls. Door tiles are open tiles whose ceiling sits on the floor until the
// door is used. The sim reads heights, doors, things and exits; textures and
// light are for the renderer.

export type KeyColor = 'red' | 'blue';
export const KEY_BITS: Record<KeyColor, number> = { red: 1, blue: 2 };

export type ThingKind = 'rusher' | 'health' | 'armor' | 'ammo' | 'key_red' | 'key_blue';

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
  /** Something placed in the middle of this tile. */
  thing?: ThingKind;
  /** This tile is a door. Neighbouring door tiles open together. */
  door?: { tex: string; key?: KeyColor };
  /** Standing here ends the run. */
  exit?: boolean;
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

export interface DoorDef {
  tiles: number[];
  tex: string;
  key?: KeyColor;
  /** Fixed point height the door rises to (sector ceiling minus floor). */
  height: number;
}

export interface ThingDef {
  kind: ThingKind;
  x: number;
  y: number;
}

export interface Level {
  name: string;
  w: number;
  h: number;
  solid: Uint8Array;
  /** Fixed point heights per tile. For door tiles, `ceil` is the open height. */
  floor: Int32Array;
  ceil: Int32Array;
  /** Index into `sectors` for open tiles, -1 for walls. */
  sectorOf: Int16Array;
  /** Index into `doors`, -1 if the tile is not a door. */
  doorOf: Int16Array;
  exit: Uint8Array;
  wallTex: string[];
  sectors: Sector[];
  doors: DoorDef[];
  things: ThingDef[];
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
    doorOf: new Int16Array(n).fill(-1),
    exit: new Uint8Array(n),
    wallTex: new Array<string>(n).fill(''),
    sectors,
    doors: [],
    things: [],
    spawn: { tx: -1, ty: -1, angle: 0 },
  };
  const doorEntry: (LegendEntry['door'] | undefined)[] = new Array(n);

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
      if (entry.thing) level.things.push({ kind: entry.thing, x: x * ONE + ONE / 2, y: y * ONE + ONE / 2 });
      if (entry.exit) level.exit[i] = 1;
      if (entry.door) doorEntry[i] = entry.door;
    }
  });

  // Group touching door tiles with the same texture and key into one door.
  for (let i = 0; i < n; i++) {
    const d = doorEntry[i];
    if (!d || level.doorOf[i] >= 0) continue;
    const id = level.doors.length;
    const tiles: number[] = [];
    const stack = [i];
    level.doorOf[i] = id;
    while (stack.length) {
      const t = stack.pop()!;
      tiles.push(t);
      const tx = t % w;
      const ty = (t / w) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nb = tileIndex(level, tx + dx, ty + dy);
        const nd = nb >= 0 ? doorEntry[nb] : undefined;
        if (nd && level.doorOf[nb] < 0 && nd.tex === d.tex && nd.key === d.key) {
          level.doorOf[nb] = id;
          stack.push(nb);
        }
      }
    }
    tiles.sort((a, b) => a - b);
    level.doors.push({ tiles, tex: d.tex, key: d.key, height: level.ceil[i] - level.floor[i] });
  }

  if (level.spawn.tx < 0) throw new Error(`level ${def.name}: no player spawn`);
  return level;
}

export function tileIndex(level: Level, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= level.w || ty >= level.h) return -1;
  return ty * level.w + tx;
}
