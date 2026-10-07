import { ONE, units } from './fixed';
import { Hasher } from './hash';
import type { Level } from './level';
import { tileIndex } from './level';
import { ANGLE_MASK, fcos, fsin } from './trig';
import type { TickInput } from './input';

// Fixed 60 Hz step. Everything in here is integer maths on plain numbers:
// no clock, no Math.random, no Math.sin. The verifier replays the same code.

export const TICK_RATE = 60;

export const PLAYER_RADIUS = units(16);
export const PLAYER_HEIGHT = units(56);
export const VIEW_HEIGHT = units(41);
/** Highest ledge the player can walk up. */
export const MAX_STEP = units(24);
/** Thrust per tick. With the friction below this tops out near 5 tiles/s. */
export const THRUST = 1400;
/** Velocity is multiplied by FRICTION_NUM/64 every tick. */
export const FRICTION_NUM = 52;
export const GRAVITY = 349;
export const MAX_TURN = 256;

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  angle: number;
}

export interface SimState {
  tick: number;
  rng: number;
  player: PlayerState;
}

export function createSim(level: Level, seed: number): SimState {
  const { tx, ty, angle } = level.spawn;
  const i = tileIndex(level, tx, ty);
  return {
    tick: 0,
    rng: seed >>> 0,
    player: {
      x: tx * ONE + ONE / 2,
      y: ty * ONE + ONE / 2,
      z: level.floor[i],
      vx: 0,
      vy: 0,
      vz: 0,
      angle,
    },
  };
}

export function cloneSim(s: SimState): SimState {
  return { tick: s.tick, rng: s.rng, player: { ...s.player } };
}

export function step(s: SimState, level: Level, input: TickInput): void {
  const p = s.player;

  const turn = Math.max(-MAX_TURN, Math.min(MAX_TURN, input.turn | 0));
  p.angle = (p.angle + turn) & ANGLE_MASK;

  const c = fcos(p.angle);
  const sn = fsin(p.angle);
  // Right of facing (cos a, sin a) is (-sin a, cos a).
  const ax = input.forward * c - input.strafe * sn;
  const ay = input.forward * sn + input.strafe * c;
  p.vx = Math.trunc(((p.vx + Math.trunc((ax * THRUST) / ONE)) * FRICTION_NUM) / 64);
  p.vy = Math.trunc(((p.vy + Math.trunc((ay * THRUST) / ONE)) * FRICTION_NUM) / 64);

  moveX(p, level);
  moveY(p, level);

  const floorZ = floorUnder(level, p.x, p.y);
  if (p.z <= floorZ) {
    // Stepping up is instant here; the renderer smooths the view.
    p.z = floorZ;
    p.vz = 0;
  } else {
    p.vz -= GRAVITY;
    p.z += p.vz;
    if (p.z < floorZ) {
      p.z = floorZ;
      p.vz = 0;
    }
  }

  s.tick++;
}

function moveX(p: PlayerState, level: Level): void {
  if (p.vx === 0) return;
  let nx = p.x + p.vx;
  if (blocked(level, nx, p.y, p.z)) {
    if (p.vx > 0) nx = ((nx + PLAYER_RADIUS - 1) >> 16) * ONE - PLAYER_RADIUS;
    else nx = (((nx - PLAYER_RADIUS) >> 16) + 1) * ONE + PLAYER_RADIUS;
    if (blocked(level, nx, p.y, p.z)) nx = p.x;
    p.vx = 0;
  }
  p.x = nx;
}

function moveY(p: PlayerState, level: Level): void {
  if (p.vy === 0) return;
  let ny = p.y + p.vy;
  if (blocked(level, p.x, ny, p.z)) {
    if (p.vy > 0) ny = ((ny + PLAYER_RADIUS - 1) >> 16) * ONE - PLAYER_RADIUS;
    else ny = (((ny - PLAYER_RADIUS) >> 16) + 1) * ONE + PLAYER_RADIUS;
    if (blocked(level, p.x, ny, p.z)) ny = p.y;
    p.vy = 0;
  }
  p.y = ny;
}

/** Tile range covered by a player-sized box centred on (x, y). */
function boxTiles(x: number, y: number): [number, number, number, number] {
  return [
    (x - PLAYER_RADIUS) >> 16,
    (y - PLAYER_RADIUS) >> 16,
    (x + PLAYER_RADIUS - 1) >> 16,
    (y + PLAYER_RADIUS - 1) >> 16,
  ];
}

export function blocked(level: Level, x: number, y: number, z: number): boolean {
  const [x0, y0, x1, y1] = boxTiles(x, y);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const i = tileIndex(level, tx, ty);
      if (i < 0 || level.solid[i]) return true;
      const f = level.floor[i];
      if (f - z > MAX_STEP) return true;
      if (level.ceil[i] - Math.max(f, z) < PLAYER_HEIGHT) return true;
    }
  }
  return false;
}

export function floorUnder(level: Level, x: number, y: number): number {
  const [x0, y0, x1, y1] = boxTiles(x, y);
  let best = -0x7fffffff;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const i = tileIndex(level, tx, ty);
      if (i >= 0 && !level.solid[i] && level.floor[i] > best) best = level.floor[i];
    }
  }
  return best;
}

export function hashSim(s: SimState): number {
  const p = s.player;
  return new Hasher()
    .int(s.tick)
    .int(s.rng)
    .int(p.x)
    .int(p.y)
    .int(p.z)
    .int(p.vx)
    .int(p.vy)
    .int(p.vz)
    .int(p.angle)
    .digest();
}
