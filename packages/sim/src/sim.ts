import { ONE, units } from './fixed';
import { Hasher } from './hash';
import { BTN_FIRE, BTN_USE, type TickInput } from './input';
import { KEY_BITS, tileIndex, type Level, type ThingKind } from './level';
import { randomInt } from './prng';
import { ANGLE_MASK, fcos, fsin } from './trig';

// Fixed 60 Hz step. Everything in here is integer maths on plain numbers:
// no clock, no Math.random, no Math.sin. Math.sqrt is allowed because IEEE 754
// requires it to be correctly rounded. The verifier replays this same code.

export const TICK_RATE = 60;

export const PLAYER_RADIUS = units(16);
export const PLAYER_HEIGHT = units(56);
export const VIEW_HEIGHT = units(41);
/** Highest ledge anything can walk up. */
export const MAX_STEP = units(24);
/** Thrust per tick. With the friction below this tops out near 5 tiles/s. */
export const THRUST = 1400;
/** Velocity is multiplied by FRICTION_NUM/64 every tick. */
export const FRICTION_NUM = 52;
export const GRAVITY = 349;
export const MAX_TURN = 256;

export const MAX_HEALTH = 100;
export const MAX_ARMOR = 100;
export const MAX_AMMO = 200;
export const PISTOL_COOLDOWN = 16;
export const PISTOL_DAMAGE_MIN = 10;
export const PISTOL_DAMAGE_RANGE = 8;
/** Random aim spread in angle units, either side. */
export const PISTOL_SPREAD = 12;
const HITSCAN_STEP = units(8);
const HITSCAN_RANGE = 40 * ONE;
const USE_REACH = units(40);
const WAKE_RADIUS = 12 * ONE;
const SIGHT_RANGE = 20 * ONE;

const DOOR_SPEED = units(4);
const DOOR_WAIT = 240;
/** A door lower than this blocks sight and bullets. */
const DOOR_SIGHT_GAP = units(40);

export enum DoorPhase {
  Closed,
  Opening,
  Open,
  Closing,
}

export enum MobState {
  Idle,
  Chase,
  Attack,
  Pain,
  Dead,
}

export interface MobType {
  hp: number;
  radius: number;
  speed: number;
  reach: number;
  attackTicks: number;
  hitTick: number;
  damageMin: number;
  damageRange: number;
  /** Out of 256. */
  painChance: number;
  painTicks: number;
}

export const MOB_TYPES = {
  rusher: {
    hp: 60,
    radius: units(18),
    speed: 3600,
    reach: units(52),
    attackTicks: 26,
    hitTick: 12,
    damageMin: 6,
    damageRange: 8,
    painChance: 140,
    painTicks: 14,
  },
} satisfies Record<string, MobType>;

export type MobKind = keyof typeof MOB_TYPES;

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  angle: number;
  hp: number;
  armor: number;
  ammo: number;
  keys: number;
  cooldown: number;
  prevButtons: number;
  kills: number;
  /** Tick of death, or -1 while alive. */
  diedAt: number;
}

export interface DoorState {
  phase: DoorPhase;
  /** Fixed point height the door has risen. */
  open: number;
  wait: number;
}

export interface Mob {
  kind: MobKind;
  x: number;
  y: number;
  z: number;
  hp: number;
  state: MobState;
  timer: number;
  /** Wander direction while stuck, and how long to keep it. */
  wx: number;
  wy: number;
  wander: number;
}

export interface Pickup {
  kind: ThingKind;
  x: number;
  y: number;
  taken: boolean;
}

export type SimEvent =
  | { type: 'fire' }
  | { type: 'dryFire' }
  | { type: 'hitMob'; mob: number }
  | { type: 'hitWall'; x: number; y: number }
  | { type: 'mobDeath'; mob: number }
  | { type: 'mobWake'; mob: number }
  | { type: 'mobAttack'; mob: number }
  | { type: 'hurt'; amount: number }
  | { type: 'death'; tile: number }
  | { type: 'pickup'; kind: ThingKind }
  | { type: 'door'; door: number; opening: boolean }
  | { type: 'locked'; door: number }
  | { type: 'exit' };

export interface SimState {
  tick: number;
  rng: number;
  player: PlayerState;
  doors: DoorState[];
  mobs: Mob[];
  pickups: Pickup[];
  /** Tick the exit was reached, or -1. */
  finishedAt: number;
  /** Things that happened during the last step. Not part of the hashed state. */
  events: SimEvent[];
}

export function createSim(level: Level, seed: number): SimState {
  const { tx, ty, angle } = level.spawn;
  const i = tileIndex(level, tx, ty);
  const s: SimState = {
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
      hp: MAX_HEALTH,
      armor: 0,
      ammo: 50,
      keys: 0,
      cooldown: 0,
      prevButtons: 0,
      kills: 0,
      diedAt: -1,
    },
    doors: level.doors.map(() => ({ phase: DoorPhase.Closed, open: 0, wait: 0 })),
    mobs: [],
    pickups: [],
    finishedAt: -1,
    events: [],
  };
  for (const t of level.things) {
    if (t.kind in MOB_TYPES) {
      const kind = t.kind as MobKind;
      s.mobs.push({
        kind,
        x: t.x,
        y: t.y,
        z: level.floor[tileIndex(level, t.x >> 16, t.y >> 16)],
        hp: MOB_TYPES[kind].hp,
        state: MobState.Idle,
        timer: 0,
        wx: 0,
        wy: 0,
        wander: 0,
      });
    } else {
      s.pickups.push({ kind: t.kind, x: t.x, y: t.y, taken: false });
    }
  }
  return s;
}

export function cloneSim(s: SimState): SimState {
  return {
    tick: s.tick,
    rng: s.rng,
    player: { ...s.player },
    doors: s.doors.map((d) => ({ ...d })),
    mobs: s.mobs.map((m) => ({ ...m })),
    pickups: s.pickups.map((p) => ({ ...p })),
    finishedAt: s.finishedAt,
    events: [],
  };
}

export function isOver(s: SimState): boolean {
  return s.player.diedAt >= 0 || s.finishedAt >= 0;
}

export function step(s: SimState, level: Level, input: TickInput): void {
  s.events = [];
  const p = s.player;

  if (!isOver(s)) {
    stepPlayer(s, level, input);
  } else {
    // Momentum dies out after death; nothing else responds to input.
    p.vx = Math.trunc((p.vx * FRICTION_NUM) / 64);
    p.vy = Math.trunc((p.vy * FRICTION_NUM) / 64);
  }
  applyGravity(level, s, p);

  for (let i = 0; i < s.mobs.length; i++) stepMob(s, level, i);
  for (let i = 0; i < s.doors.length; i++) stepDoor(s, level, i);

  s.tick++;
}

// ---- player ----

function stepPlayer(s: SimState, level: Level, input: TickInput): void {
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

  const nx = slideX(s, level, p.x, p.y, p.z, p.vx, PLAYER_RADIUS, -1);
  if (nx !== p.x + p.vx) p.vx = 0;
  p.x = nx;
  const ny = slideY(s, level, p.x, p.y, p.z, p.vy, PLAYER_RADIUS, -1);
  if (ny !== p.y + p.vy) p.vy = 0;
  p.y = ny;

  const pressed = input.buttons & ~p.prevButtons;
  p.prevButtons = input.buttons;
  if (pressed & BTN_USE) useLine(s, level);

  if (p.cooldown > 0) p.cooldown--;
  if (input.buttons & BTN_FIRE && p.cooldown === 0) {
    if (p.ammo > 0) firePistol(s, level);
    else if (pressed & BTN_FIRE) s.events.push({ type: 'dryFire' });
  }

  touchPickups(s);

  const here = tileIndex(level, p.x >> 16, p.y >> 16);
  if (here >= 0 && level.exit[here]) {
    s.finishedAt = s.tick;
    s.events.push({ type: 'exit' });
  }
}

function applyGravity(level: Level, s: SimState, p: { x: number; y: number; z: number; vz: number }): void {
  const floorZ = floorUnder(level, p.x, p.y, PLAYER_RADIUS);
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
}

function damagePlayer(s: SimState, level: Level, amount: number): void {
  const p = s.player;
  if (isOver(s)) return;
  let hit = amount;
  if (p.armor > 0) {
    const saved = Math.min(p.armor, Math.floor(amount / 3));
    p.armor -= saved;
    hit -= saved;
  }
  p.hp -= hit;
  s.events.push({ type: 'hurt', amount: hit });
  if (p.hp <= 0) {
    p.hp = 0;
    p.diedAt = s.tick;
    s.events.push({ type: 'death', tile: tileIndex(level, p.x >> 16, p.y >> 16) });
  }
}

function useLine(s: SimState, level: Level): void {
  const p = s.player;
  const c = fcos(p.angle);
  const sn = fsin(p.angle);
  // Probe a short way ahead, then a little further, for a door tile.
  for (const reach of [PLAYER_RADIUS + units(8), PLAYER_RADIUS + USE_REACH]) {
    const t = tileIndex(level, (p.x + Math.floor((c * reach) / ONE)) >> 16, (p.y + Math.floor((sn * reach) / ONE)) >> 16);
    if (t < 0) return;
    if (level.solid[t]) return;
    const d = level.doorOf[t];
    if (d < 0) continue;
    const def = level.doors[d];
    if (def.key && !(p.keys & KEY_BITS[def.key])) {
      s.events.push({ type: 'locked', door: d });
      return;
    }
    const door = s.doors[d];
    if (door.phase === DoorPhase.Closed || door.phase === DoorPhase.Closing) {
      door.phase = DoorPhase.Opening;
      s.events.push({ type: 'door', door: d, opening: true });
    }
    return;
  }
}

function touchPickups(s: SimState): void {
  const p = s.player;
  const reach = PLAYER_RADIUS + units(12);
  for (const it of s.pickups) {
    if (it.taken || Math.abs(it.x - p.x) > reach || Math.abs(it.y - p.y) > reach) continue;
    let took = true;
    switch (it.kind) {
      case 'health':
        if (p.hp >= MAX_HEALTH) took = false;
        else p.hp = Math.min(MAX_HEALTH, p.hp + 25);
        break;
      case 'armor':
        if (p.armor >= MAX_ARMOR) took = false;
        else p.armor = MAX_ARMOR;
        break;
      case 'ammo':
        if (p.ammo >= MAX_AMMO) took = false;
        else p.ammo = Math.min(MAX_AMMO, p.ammo + 20);
        break;
      case 'key_red':
        p.keys |= KEY_BITS.red;
        break;
      case 'key_blue':
        p.keys |= KEY_BITS.blue;
        break;
      default:
        took = false;
    }
    if (took) {
      it.taken = true;
      s.events.push({ type: 'pickup', kind: it.kind });
    }
  }
}

// ---- weapons ----

function firePistol(s: SimState, level: Level): void {
  const p = s.player;
  p.ammo--;
  p.cooldown = PISTOL_COOLDOWN;
  s.events.push({ type: 'fire' });

  // Gunfire wakes anything close enough to hear it.
  for (let i = 0; i < s.mobs.length; i++) {
    const m = s.mobs[i];
    if (m.state === MobState.Idle && Math.abs(m.x - p.x) < WAKE_RADIUS && Math.abs(m.y - p.y) < WAKE_RADIUS) {
      m.state = MobState.Chase;
      s.events.push({ type: 'mobWake', mob: i });
    }
  }

  const spread = randomInt(s, PISTOL_SPREAD * 2 + 1) - PISTOL_SPREAD;
  const angle = (p.angle + spread) & ANGLE_MASK;
  const hit = hitscan(s, level, p.x, p.y, angle);
  if (hit.mob >= 0) {
    const dmg = PISTOL_DAMAGE_MIN + randomInt(s, PISTOL_DAMAGE_RANGE);
    s.events.push({ type: 'hitMob', mob: hit.mob });
    damageMob(s, hit.mob, dmg);
  } else {
    s.events.push({ type: 'hitWall', x: hit.x, y: hit.y });
  }
}

/** First mob or wall along a ray. Mobs are treated as circles. */
export function hitscan(
  s: SimState,
  level: Level,
  x: number,
  y: number,
  angle: number,
): { mob: number; x: number; y: number; dist: number } {
  const c = fcos(angle);
  const sn = fsin(angle);
  let wall = HITSCAN_RANGE;
  for (let t = HITSCAN_STEP; t < HITSCAN_RANGE; t += HITSCAN_STEP) {
    const tx = x + Math.floor((c * t) / ONE);
    const ty = y + Math.floor((sn * t) / ONE);
    if (blocksSight(s, level, tileIndex(level, tx >> 16, ty >> 16))) {
      wall = t;
      break;
    }
  }
  let best = -1;
  let bestAlong = wall;
  for (let i = 0; i < s.mobs.length; i++) {
    const m = s.mobs[i];
    if (m.state === MobState.Dead) continue;
    const rx = m.x - x;
    const ry = m.y - y;
    const along = Math.floor((rx * c + ry * sn) / ONE);
    const perp = Math.floor((ry * c - rx * sn) / ONE);
    const r = MOB_TYPES[m.kind].radius;
    if (along > 0 && along < bestAlong && Math.abs(perp) < r) {
      best = i;
      bestAlong = along;
    }
  }
  return {
    mob: best,
    x: x + Math.floor((c * bestAlong) / ONE),
    y: y + Math.floor((sn * bestAlong) / ONE),
    dist: bestAlong,
  };
}

function blocksSight(s: SimState, level: Level, t: number): boolean {
  if (t < 0 || level.solid[t]) return true;
  const d = level.doorOf[t];
  return d >= 0 && s.doors[d].open < DOOR_SIGHT_GAP;
}

/** True if nothing solid lies on the straight line between two points. */
export function lineOfSight(s: SimState, level: Level, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.floor(Math.sqrt(dx * dx + dy * dy));
  if (dist === 0) return true;
  for (let t = HITSCAN_STEP; t < dist; t += HITSCAN_STEP) {
    const x = ax + Math.floor((dx * t) / dist);
    const y = ay + Math.floor((dy * t) / dist);
    if (blocksSight(s, level, tileIndex(level, x >> 16, y >> 16))) return false;
  }
  return true;
}

// ---- mobs ----

function damageMob(s: SimState, i: number, dmg: number): void {
  const m = s.mobs[i];
  const type = MOB_TYPES[m.kind];
  m.hp -= dmg;
  if (m.hp <= 0) {
    m.hp = 0;
    m.state = MobState.Dead;
    m.timer = 0;
    s.player.kills++;
    s.events.push({ type: 'mobDeath', mob: i });
    return;
  }
  if (m.state !== MobState.Attack && randomInt(s, 256) < type.painChance) {
    m.state = MobState.Pain;
    m.timer = type.painTicks;
  } else if (m.state === MobState.Idle) {
    m.state = MobState.Chase;
  }
}

function stepMob(s: SimState, level: Level, i: number): void {
  const m = s.mobs[i];
  const type = MOB_TYPES[m.kind];
  const p = s.player;
  const playerAlive = p.diedAt < 0;

  switch (m.state) {
    case MobState.Dead:
      if (m.timer < 600) m.timer++;
      return;

    case MobState.Idle:
      // Look for the player a few times a second, staggered between mobs.
      if (playerAlive && (s.tick + i) % 8 === 0) {
        const dx = p.x - m.x;
        const dy = p.y - m.y;
        if (Math.abs(dx) < SIGHT_RANGE && Math.abs(dy) < SIGHT_RANGE && lineOfSight(s, level, m.x, m.y, p.x, p.y)) {
          m.state = MobState.Chase;
          s.events.push({ type: 'mobWake', mob: i });
        }
      }
      return;

    case MobState.Pain:
      if (--m.timer <= 0) m.state = MobState.Chase;
      return;

    case MobState.Attack:
      m.timer++;
      if (m.timer === type.hitTick && playerAlive && inReach(m, p, type.reach)) {
        damagePlayer(s, level, type.damageMin + randomInt(s, type.damageRange));
      }
      if (m.timer >= type.attackTicks) m.state = MobState.Chase;
      return;

    case MobState.Chase: {
      if (!playerAlive) return;
      if (inReach(m, p, type.reach)) {
        m.state = MobState.Attack;
        m.timer = 0;
        s.events.push({ type: 'mobAttack', mob: i });
        return;
      }
      let vx: number;
      let vy: number;
      if (m.wander > 0) {
        m.wander--;
        vx = m.wx;
        vy = m.wy;
      } else {
        const dx = p.x - m.x;
        const dy = p.y - m.y;
        const len = Math.floor(Math.sqrt(dx * dx + dy * dy)) || 1;
        vx = Math.trunc((dx * type.speed) / len);
        vy = Math.trunc((dy * type.speed) / len);
      }
      const nx = slideX(s, level, m.x, m.y, m.z, vx, type.radius, i);
      const movedX = nx !== m.x;
      m.x = nx;
      const ny = slideY(s, level, m.x, m.y, m.z, vy, type.radius, i);
      const movedY = ny !== m.y;
      m.y = ny;
      m.z = floorUnder(level, m.x, m.y, type.radius);
      if (!movedX && !movedY && m.wander === 0) {
        // Stuck: pick one of eight directions for a moment.
        const dir = randomInt(s, 8);
        const dirs = [
          [1, 0],
          [1, 1],
          [0, 1],
          [-1, 1],
          [-1, 0],
          [-1, -1],
          [0, -1],
          [1, -1],
        ];
        m.wx = dirs[dir][0] * type.speed;
        m.wy = dirs[dir][1] * type.speed;
        m.wander = 20 + randomInt(s, 20);
      }
      return;
    }
  }
}

function inReach(m: Mob, p: PlayerState, reach: number): boolean {
  return Math.abs(m.x - p.x) <= reach && Math.abs(m.y - p.y) <= reach;
}

// ---- doors ----

function stepDoor(s: SimState, level: Level, i: number): void {
  const door = s.doors[i];
  const def = level.doors[i];
  switch (door.phase) {
    case DoorPhase.Opening:
      door.open = Math.min(def.height, door.open + DOOR_SPEED);
      if (door.open === def.height) {
        door.phase = DoorPhase.Open;
        door.wait = DOOR_WAIT;
      }
      break;
    case DoorPhase.Open:
      if (--door.wait <= 0) {
        if (doorOccupied(s, level, i)) door.wait = 30;
        else {
          door.phase = DoorPhase.Closing;
          s.events.push({ type: 'door', door: i, opening: false });
        }
      }
      break;
    case DoorPhase.Closing:
      if (doorOccupied(s, level, i)) {
        door.phase = DoorPhase.Opening;
        s.events.push({ type: 'door', door: i, opening: true });
        break;
      }
      door.open = Math.max(0, door.open - DOOR_SPEED);
      if (door.open === 0) door.phase = DoorPhase.Closed;
      break;
  }
}

function doorOccupied(s: SimState, level: Level, d: number): boolean {
  const p = s.player;
  if (boxTouchesDoor(level, d, p.x, p.y, PLAYER_RADIUS)) return true;
  for (const m of s.mobs) {
    if (m.state !== MobState.Dead && boxTouchesDoor(level, d, m.x, m.y, MOB_TYPES[m.kind].radius)) return true;
  }
  return false;
}

function boxTouchesDoor(level: Level, d: number, x: number, y: number, r: number): boolean {
  for (let ty = (y - r) >> 16; ty <= (y + r - 1) >> 16; ty++) {
    for (let tx = (x - r) >> 16; tx <= (x + r - 1) >> 16; tx++) {
      const t = tileIndex(level, tx, ty);
      if (t >= 0 && level.doorOf[t] === d) return true;
    }
  }
  return false;
}

// ---- movement and collision ----

/** Ceiling of a tile right now, accounting for doors. */
function ceilAt(s: SimState, level: Level, t: number): number {
  const d = level.doorOf[t];
  return d >= 0 ? level.floor[t] + s.doors[d].open : level.ceil[t];
}

/**
 * Moves along x and clamps against walls, ledges, low ceilings and bodies.
 * `self` is the mob index doing the moving, or -1 for the player.
 */
function slideX(s: SimState, level: Level, x: number, y: number, z: number, vx: number, r: number, self: number): number {
  if (vx === 0) return x;
  let nx = x + vx;
  if (blocked(s, level, nx, y, z, r, self, x, y)) {
    if (vx > 0) nx = ((nx + r - 1) >> 16) * ONE - r;
    else nx = (((nx - r) >> 16) + 1) * ONE + r;
    if ((vx > 0 ? nx < x : nx > x) || blocked(s, level, nx, y, z, r, self, x, y)) nx = x;
  }
  return nx;
}

function slideY(s: SimState, level: Level, x: number, y: number, z: number, vy: number, r: number, self: number): number {
  if (vy === 0) return y;
  let ny = y + vy;
  if (blocked(s, level, x, ny, z, r, self, x, y)) {
    if (vy > 0) ny = ((ny + r - 1) >> 16) * ONE - r;
    else ny = (((ny - r) >> 16) + 1) * ONE + r;
    if ((vy > 0 ? ny < y : ny > y) || blocked(s, level, x, ny, z, r, self, x, y)) ny = y;
  }
  return ny;
}

/** (ox, oy) is where the mover was before this move; see the body check below. */
export function blocked(
  s: SimState,
  level: Level,
  x: number,
  y: number,
  z: number,
  r: number,
  self: number,
  ox: number,
  oy: number,
): boolean {
  for (let ty = (y - r) >> 16; ty <= (y + r - 1) >> 16; ty++) {
    for (let tx = (x - r) >> 16; tx <= (x + r - 1) >> 16; tx++) {
      const i = tileIndex(level, tx, ty);
      if (i < 0 || level.solid[i]) return true;
      const f = level.floor[i];
      if (f - z > MAX_STEP) return true;
      if (ceilAt(s, level, i) - Math.max(f, z) < PLAYER_HEIGHT) return true;
    }
  }
  // Bodies: the player and every live mob except the one moving. A move is
  // only refused if it ends overlapping and closer than it started, so two
  // bodies that already overlap can always separate.
  const hits = (bx: number, by: number, br: number) => {
    const reach = r + br;
    if (Math.abs(bx - x) >= reach || Math.abs(by - y) >= reach) return false;
    return Math.max(Math.abs(bx - x), Math.abs(by - y)) <= Math.max(Math.abs(bx - ox), Math.abs(by - oy));
  };
  if (self >= 0) {
    const p = s.player;
    if (p.diedAt < 0 && hits(p.x, p.y, PLAYER_RADIUS)) return true;
  }
  for (let i = 0; i < s.mobs.length; i++) {
    if (i === self) continue;
    const m = s.mobs[i];
    if (m.state !== MobState.Dead && hits(m.x, m.y, MOB_TYPES[m.kind].radius)) return true;
  }
  return false;
}

export function floorUnder(level: Level, x: number, y: number, r: number): number {
  let best = -0x7fffffff;
  for (let ty = (y - r) >> 16; ty <= (y + r - 1) >> 16; ty++) {
    for (let tx = (x - r) >> 16; tx <= (x + r - 1) >> 16; tx++) {
      const i = tileIndex(level, tx, ty);
      if (i >= 0 && !level.solid[i] && level.floor[i] > best) best = level.floor[i];
    }
  }
  return best;
}

// ---- hashing ----

export function hashSim(s: SimState): number {
  const h = new Hasher();
  const p = s.player;
  h.int(s.tick).int(s.rng).int(s.finishedAt);
  h.int(p.x).int(p.y).int(p.z).int(p.vx).int(p.vy).int(p.vz).int(p.angle);
  h.int(p.hp).int(p.armor).int(p.ammo).int(p.keys).int(p.cooldown).int(p.prevButtons).int(p.kills).int(p.diedAt);
  for (const d of s.doors) h.int(d.phase).int(d.open).int(d.wait);
  for (const m of s.mobs) h.int(m.x).int(m.y).int(m.z).int(m.hp).int(m.state).int(m.timer).int(m.wx).int(m.wy).int(m.wander);
  for (const it of s.pickups) h.int(it.taken ? 1 : 0);
  return h.digest();
}
