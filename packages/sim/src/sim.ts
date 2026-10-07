import { ONE, units } from './fixed';
import { Hasher } from './hash';
import { BTN_FIRE, BTN_NEXT_WEAPON, BTN_PREV_WEAPON, BTN_SLOT1, BTN_SLOT2, BTN_SLOT3, BTN_USE, type TickInput } from './input';
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
export const MAX_AMMO = { bullets: 200, shells: 50, cells: 300 } as const;
const HITSCAN_STEP = units(8);
const HITSCAN_RANGE = 40 * ONE;
const USE_REACH = units(40);
const WAKE_RADIUS = 12 * ONE;
const SIGHT_RANGE = 20 * ONE;
const SWITCH_TICKS = 14;
const PROJECTILE_RADIUS = units(6);

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

// ---- weapons ----

export type AmmoKind = 'bullets' | 'shells' | 'cells';

export interface WeaponDef {
  name: string;
  ammo: AmmoKind;
  cooldown: number;
  /** Hitscan rays per shot; 0 for a projectile weapon. */
  pellets: number;
  /** Random spread per ray in angle units, either side. */
  spread: number;
  damageMin: number;
  damageRange: number;
  projectileSpeed?: number;
}

export const WEAPONS: WeaponDef[] = [
  { name: 'Pistol', ammo: 'bullets', cooldown: 16, pellets: 1, spread: 12, damageMin: 10, damageRange: 8 },
  { name: 'Shotgun', ammo: 'shells', cooldown: 50, pellets: 7, spread: 70, damageMin: 6, damageRange: 7 },
  { name: 'Ember Lance', ammo: 'cells', cooldown: 7, pellets: 0, spread: 6, damageMin: 13, damageRange: 8, projectileSpeed: 15000 },
];

// ---- relics ----

/** What each relic does while carried into a run. Index = relic ID. */
export const RELICS = [
  null,
  { name: 'Ossified Heart', effect: 'Start with 125 health' },
  { name: "Gunsmith's Knuckle", effect: 'Weapons fire 25% faster' },
  { name: 'Hollow Boots', effect: 'Move 15% faster' },
  { name: 'Ember Tooth', effect: '30% more damage' },
  { name: 'Quiet Shroud', effect: 'Enemies notice you from half as far' },
  { name: 'Bone Plate', effect: 'Start with 50 armor that absorbs more' },
] as const;

export interface RunOptions {
  /** Relic carried into the run, 0 for none. */
  relic?: number;
}

// ---- mobs ----

export interface MobType {
  hp: number;
  radius: number;
  speed: number;
  /** Melee reach, 0 for none. */
  reach: number;
  attackTicks: number;
  /** Tick within an attack when the blow lands or the shot leaves. */
  hitTick: number;
  damageMin: number;
  damageRange: number;
  /** Out of 256. */
  painChance: number;
  painTicks: number;
  ranged?: {
    speed: number;
    range: number;
    cooldownMin: number;
    cooldownRange: number;
    /** Stops closing in at this distance. */
    keepAway: number;
  };
}

export const MOB_TYPES = {
  rusher: {
    hp: 60,
    radius: units(18),
    speed: 3600,
    reach: units(52),
    attackTicks: 26,
    hitTick: 12,
    damageMin: 5,
    damageRange: 7,
    painChance: 150,
    painTicks: 14,
  },
  caster: {
    hp: 70,
    radius: units(18),
    speed: 2200,
    reach: 0,
    attackTicks: 32,
    hitTick: 18,
    damageMin: 8,
    damageRange: 7,
    painChance: 170,
    painTicks: 16,
    ranged: { speed: 6500, range: 16 * ONE, cooldownMin: 60, cooldownRange: 80, keepAway: 5 * ONE },
  },
  heavy: {
    hp: 320,
    radius: units(26),
    speed: 1700,
    reach: units(68),
    attackTicks: 46,
    hitTick: 28,
    damageMin: 16,
    damageRange: 14,
    painChance: 30,
    painTicks: 10,
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
  maxHp: number;
  armor: number;
  bullets: number;
  shells: number;
  cells: number;
  /** Index into WEAPONS. */
  weapon: number;
  /** Bitmask of owned weapons. */
  owned: number;
  /** Ticks left in a weapon switch; no firing meanwhile. */
  switching: number;
  keys: number;
  cooldown: number;
  prevButtons: number;
  kills: number;
  relic: number;
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
  /** Ticks until a ranged mob may shoot again. */
  cooldown: number;
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

export interface Projectile {
  x: number;
  y: number;
  /** Height for rendering only. */
  z: number;
  vx: number;
  vy: number;
  /** -1 for the player, otherwise the mob index that fired it. */
  owner: number;
  damage: number;
}

export type SimEvent =
  | { type: 'fire'; weapon: number }
  | { type: 'dryFire' }
  | { type: 'switch'; weapon: number }
  | { type: 'hitMob'; mob: number }
  | { type: 'hitWall'; x: number; y: number }
  | { type: 'mobDeath'; mob: number }
  | { type: 'mobWake'; mob: number }
  | { type: 'mobAttack'; mob: number }
  | { type: 'mobFire'; mob: number }
  | { type: 'projectileHit'; x: number; y: number; owner: number }
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
  projectiles: Projectile[];
  /** Tick the exit was reached, or -1. */
  finishedAt: number;
  /** Things that happened during the last step. Not part of the hashed state. */
  events: SimEvent[];
}

const OPT_MOBS: [number, MobKind | null][] = [
  [45, 'rusher'],
  [75, 'caster'],
  [82, 'heavy'],
  [100, null],
];
const OPT_ITEMS: [number, ThingKind | null][] = [
  [22, 'health'],
  [42, 'ammo'],
  [56, 'shells'],
  [66, 'cells'],
  [74, 'armor'],
  [100, null],
];

function pick<T>(table: [number, T][], roll: number): T {
  for (const [limit, v] of table) if (roll < limit) return v;
  return table[table.length - 1][1];
}

export function createSim(level: Level, seed: number, opts: RunOptions = {}): SimState {
  const { tx, ty, angle } = level.spawn;
  const i = tileIndex(level, tx, ty);
  const relic = opts.relic && opts.relic >= 1 && opts.relic <= 6 ? opts.relic : 0;
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
      hp: relic === 1 ? 125 : MAX_HEALTH,
      maxHp: relic === 1 ? 125 : MAX_HEALTH,
      armor: relic === 6 ? 50 : 0,
      bullets: 50,
      shells: 0,
      cells: 0,
      weapon: 0,
      owned: 1,
      switching: 0,
      keys: 0,
      cooldown: 0,
      prevButtons: 0,
      kills: 0,
      relic,
      diedAt: -1,
    },
    doors: level.doors.map(() => ({ phase: DoorPhase.Closed, open: 0, wait: 0 })),
    mobs: [],
    pickups: [],
    projectiles: [],
    finishedAt: -1,
    events: [],
  };

  // Optional slots are filled from a separate stream so the day's layout does
  // not shift the gameplay random numbers.
  const layout = { rng: (seed ^ 0x9e3779b9) >>> 0 };
  for (const t of level.things) {
    let kind: ThingKind | null = t.kind;
    if (kind === 'opt_mob') kind = pick(OPT_MOBS, randomInt(layout, 100));
    else if (kind === 'opt_item') kind = pick(OPT_ITEMS, randomInt(layout, 100));
    if (!kind) continue;
    if (kind in MOB_TYPES) {
      const mk = kind as MobKind;
      s.mobs.push({
        kind: mk,
        x: t.x,
        y: t.y,
        z: level.floor[tileIndex(level, t.x >> 16, t.y >> 16)],
        hp: MOB_TYPES[mk].hp,
        state: MobState.Idle,
        timer: 0,
        cooldown: 0,
        wx: 0,
        wy: 0,
        wander: 0,
      });
    } else {
      s.pickups.push({ kind, x: t.x, y: t.y, taken: false });
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
    projectiles: s.projectiles.map((p) => ({ ...p })),
    finishedAt: s.finishedAt,
    events: [],
  };
}

export function isOver(s: SimState): boolean {
  return s.player.diedAt >= 0 || s.finishedAt >= 0;
}

export function ammoFor(p: PlayerState, weapon = p.weapon): number {
  return p[WEAPONS[weapon].ammo];
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
  applyGravity(level, p);

  for (let i = 0; i < s.mobs.length; i++) stepMob(s, level, i);
  stepProjectiles(s, level);
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
  const thrust = p.relic === 3 ? Math.floor((THRUST * 115) / 100) : THRUST;
  // Right of facing (cos a, sin a) is (-sin a, cos a).
  const ax = input.forward * c - input.strafe * sn;
  const ay = input.forward * sn + input.strafe * c;
  p.vx = Math.trunc(((p.vx + Math.trunc((ax * thrust) / ONE)) * FRICTION_NUM) / 64);
  p.vy = Math.trunc(((p.vy + Math.trunc((ay * thrust) / ONE)) * FRICTION_NUM) / 64);

  const nx = slideX(s, level, p.x, p.y, p.z, p.vx, PLAYER_RADIUS, -1);
  if (nx !== p.x + p.vx) p.vx = 0;
  p.x = nx;
  const ny = slideY(s, level, p.x, p.y, p.z, p.vy, PLAYER_RADIUS, -1);
  if (ny !== p.y + p.vy) p.vy = 0;
  p.y = ny;

  const pressed = input.buttons & ~p.prevButtons;
  p.prevButtons = input.buttons;
  if (pressed & BTN_USE) useLine(s, level);
  handleWeaponSwitch(s, pressed);

  if (p.cooldown > 0) p.cooldown--;
  if (p.switching > 0) p.switching--;
  else if (input.buttons & BTN_FIRE && p.cooldown === 0) {
    if (ammoFor(p) > 0) fireWeapon(s, level);
    else if (pressed & BTN_FIRE) s.events.push({ type: 'dryFire' });
  }

  touchPickups(s);

  const here = tileIndex(level, p.x >> 16, p.y >> 16);
  if (here >= 0 && level.hurt[here] && p.z <= level.floor[here] && s.tick % 30 === 0) {
    damagePlayer(s, level, level.hurt[here]);
  }
  if (here >= 0 && level.exit[here]) {
    s.finishedAt = s.tick;
    s.events.push({ type: 'exit' });
  }
}

function handleWeaponSwitch(s: SimState, pressed: number): void {
  const p = s.player;
  let want = -1;
  if (pressed & BTN_SLOT1) want = 0;
  else if (pressed & BTN_SLOT2) want = 1;
  else if (pressed & BTN_SLOT3) want = 2;
  else if (pressed & (BTN_NEXT_WEAPON | BTN_PREV_WEAPON)) {
    const dir = pressed & BTN_NEXT_WEAPON ? 1 : WEAPONS.length - 1;
    for (let k = 1; k < WEAPONS.length; k++) {
      const w = (p.weapon + dir * k) % WEAPONS.length;
      if (p.owned & (1 << w)) {
        want = w;
        break;
      }
    }
  }
  if (want >= 0) selectWeapon(s, want);
}

function selectWeapon(s: SimState, w: number): void {
  const p = s.player;
  if (w === p.weapon || !(p.owned & (1 << w))) return;
  p.weapon = w;
  p.switching = SWITCH_TICKS;
  s.events.push({ type: 'switch', weapon: w });
}

function applyGravity(level: Level, p: { x: number; y: number; z: number; vz: number }): void {
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
    const saved = Math.min(p.armor, Math.floor(amount / (p.relic === 6 ? 2 : 3)));
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

function addAmmo(p: PlayerState, kind: AmmoKind, n: number): boolean {
  if (p[kind] >= MAX_AMMO[kind]) return false;
  p[kind] = Math.min(MAX_AMMO[kind], p[kind] + n);
  return true;
}

function giveWeapon(s: SimState, w: number, ammo: AmmoKind, n: number): boolean {
  const p = s.player;
  const fresh = !(p.owned & (1 << w));
  p.owned |= 1 << w;
  const gotAmmo = addAmmo(p, ammo, n);
  if (fresh) selectWeapon(s, w);
  return fresh || gotAmmo;
}

function touchPickups(s: SimState): void {
  const p = s.player;
  const reach = PLAYER_RADIUS + units(12);
  for (const it of s.pickups) {
    if (it.taken || Math.abs(it.x - p.x) > reach || Math.abs(it.y - p.y) > reach) continue;
    let took = true;
    switch (it.kind) {
      case 'health':
        if (p.hp >= p.maxHp) took = false;
        else p.hp = Math.min(p.maxHp, p.hp + 25);
        break;
      case 'armor':
        if (p.armor >= MAX_ARMOR) took = false;
        else p.armor = MAX_ARMOR;
        break;
      case 'ammo':
        took = addAmmo(p, 'bullets', 20);
        break;
      case 'shells':
        took = addAmmo(p, 'shells', 8);
        break;
      case 'cells':
        took = addAmmo(p, 'cells', 40);
        break;
      case 'shotgun':
        took = giveWeapon(s, 1, 'shells', 8);
        break;
      case 'lance':
        took = giveWeapon(s, 2, 'cells', 60);
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

function playerDamage(s: SimState, w: WeaponDef): number {
  const d = w.damageMin + randomInt(s, w.damageRange);
  return s.player.relic === 4 ? Math.floor((d * 13) / 10) : d;
}

function fireWeapon(s: SimState, level: Level): void {
  const p = s.player;
  const w = WEAPONS[p.weapon];
  p[w.ammo]--;
  p.cooldown = p.relic === 2 ? Math.floor((w.cooldown * 3) / 4) : w.cooldown;
  s.events.push({ type: 'fire', weapon: p.weapon });

  // Gunfire wakes anything close enough to hear it.
  const wake = p.relic === 5 ? WAKE_RADIUS / 2 : WAKE_RADIUS;
  for (let i = 0; i < s.mobs.length; i++) {
    const m = s.mobs[i];
    if (m.state === MobState.Idle && Math.abs(m.x - p.x) < wake && Math.abs(m.y - p.y) < wake) {
      m.state = MobState.Chase;
      s.events.push({ type: 'mobWake', mob: i });
    }
  }

  if (w.projectileSpeed) {
    const spread = randomInt(s, w.spread * 2 + 1) - w.spread;
    const a = (p.angle + spread) & ANGLE_MASK;
    const c = fcos(a);
    const sn = fsin(a);
    s.projectiles.push({
      x: p.x + Math.floor((c * PLAYER_RADIUS) / ONE),
      y: p.y + Math.floor((sn * PLAYER_RADIUS) / ONE),
      z: p.z + units(32),
      vx: Math.floor((c * w.projectileSpeed) / ONE),
      vy: Math.floor((sn * w.projectileSpeed) / ONE),
      owner: -1,
      damage: playerDamage(s, w),
    });
    return;
  }

  // Pellets that hit the same mob add up before damage is applied, so a
  // point-blank shotgun blast counts as one big hit.
  const totals = new Map<number, number>();
  for (let k = 0; k < w.pellets; k++) {
    const spread = randomInt(s, w.spread * 2 + 1) - w.spread;
    const hit = hitscan(s, level, p.x, p.y, (p.angle + spread) & ANGLE_MASK);
    if (hit.mob >= 0) totals.set(hit.mob, (totals.get(hit.mob) ?? 0) + playerDamage(s, w));
    else s.events.push({ type: 'hitWall', x: hit.x, y: hit.y });
  }
  for (const [mob, dmg] of [...totals.entries()].sort((a, b) => a[0] - b[0])) {
    s.events.push({ type: 'hitMob', mob });
    damageMob(s, mob, dmg);
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

// ---- projectiles ----

function stepProjectiles(s: SimState, level: Level): void {
  const keep: Projectile[] = [];
  for (const pr of s.projectiles) {
    if (moveProjectile(s, level, pr)) keep.push(pr);
  }
  s.projectiles = keep;
}

/** Moves one projectile in two half steps. Returns false once it has hit something. */
function moveProjectile(s: SimState, level: Level, pr: Projectile): boolean {
  for (let half = 0; half < 2; half++) {
    pr.x += pr.vx >> 1;
    pr.y += pr.vy >> 1;
    if (blocksSight(s, level, tileIndex(level, pr.x >> 16, pr.y >> 16))) {
      s.events.push({ type: 'projectileHit', x: pr.x, y: pr.y, owner: pr.owner });
      return false;
    }
    if (pr.owner >= 0) {
      const p = s.player;
      const r = PLAYER_RADIUS + PROJECTILE_RADIUS;
      if (p.diedAt < 0 && Math.abs(p.x - pr.x) < r && Math.abs(p.y - pr.y) < r) {
        s.events.push({ type: 'projectileHit', x: pr.x, y: pr.y, owner: pr.owner });
        damagePlayer(s, level, pr.damage);
        return false;
      }
    } else {
      for (let i = 0; i < s.mobs.length; i++) {
        const m = s.mobs[i];
        if (m.state === MobState.Dead) continue;
        const r = MOB_TYPES[m.kind].radius + PROJECTILE_RADIUS;
        if (Math.abs(m.x - pr.x) < r && Math.abs(m.y - pr.y) < r) {
          s.events.push({ type: 'projectileHit', x: pr.x, y: pr.y, owner: pr.owner });
          s.events.push({ type: 'hitMob', mob: i });
          damageMob(s, i, pr.damage);
          return false;
        }
      }
    }
  }
  return true;
}

// ---- mobs ----

function damageMob(s: SimState, i: number, dmg: number): void {
  const m = s.mobs[i];
  if (m.state === MobState.Dead) return;
  const type: MobType = MOB_TYPES[m.kind];
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
  const type: MobType = MOB_TYPES[m.kind];
  const p = s.player;
  const playerAlive = p.diedAt < 0;
  if (m.cooldown > 0) m.cooldown--;

  switch (m.state) {
    case MobState.Dead:
      if (m.timer < 600) m.timer++;
      return;

    case MobState.Idle:
      // Look for the player a few times a second, staggered between mobs.
      if (playerAlive && (s.tick + i) % 8 === 0) {
        const range = p.relic === 5 ? SIGHT_RANGE / 2 : SIGHT_RANGE;
        const dx = p.x - m.x;
        const dy = p.y - m.y;
        if (Math.abs(dx) < range && Math.abs(dy) < range && lineOfSight(s, level, m.x, m.y, p.x, p.y)) {
          m.state = MobState.Chase;
          // Ranged mobs do not open fire the instant they spot you.
          m.cooldown = 30 + randomInt(s, 30);
          s.events.push({ type: 'mobWake', mob: i });
        }
      }
      return;

    case MobState.Pain:
      if (--m.timer <= 0) m.state = MobState.Chase;
      return;

    case MobState.Attack:
      m.timer++;
      if (m.timer === type.hitTick && playerAlive) {
        if (type.ranged) fireAtPlayer(s, i, type);
        else if (inReach(m, p, type.reach)) damagePlayer(s, level, type.damageMin + randomInt(s, type.damageRange));
      }
      if (m.timer >= type.attackTicks) m.state = MobState.Chase;
      return;

    case MobState.Chase: {
      if (!playerAlive) return;
      if (type.reach && inReach(m, p, type.reach)) {
        startAttack(s, m, i);
        return;
      }
      const dx = p.x - m.x;
      const dy = p.y - m.y;
      const dist = Math.floor(Math.sqrt(dx * dx + dy * dy)) || 1;
      if (type.ranged && m.cooldown === 0 && dist < type.ranged.range && (s.tick + i) % 4 === 0) {
        if (lineOfSight(s, level, m.x, m.y, p.x, p.y)) {
          startAttack(s, m, i);
          m.cooldown = type.ranged.cooldownMin + randomInt(s, type.ranged.cooldownRange);
          return;
        }
      }
      if (type.ranged && dist < type.ranged.keepAway && m.wander === 0) return;
      let vx: number;
      let vy: number;
      if (m.wander > 0) {
        m.wander--;
        vx = m.wx;
        vy = m.wy;
      } else {
        vx = Math.trunc((dx * type.speed) / dist);
        vy = Math.trunc((dy * type.speed) / dist);
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

function startAttack(s: SimState, m: Mob, i: number): void {
  m.state = MobState.Attack;
  m.timer = 0;
  s.events.push({ type: 'mobAttack', mob: i });
}

function fireAtPlayer(s: SimState, i: number, type: MobType): void {
  const m = s.mobs[i];
  const p = s.player;
  const ranged = type.ranged!;
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  const dist = Math.floor(Math.sqrt(dx * dx + dy * dy)) || 1;
  s.projectiles.push({
    x: m.x + Math.trunc((dx * type.radius) / dist),
    y: m.y + Math.trunc((dy * type.radius) / dist),
    z: m.z + units(36),
    vx: Math.trunc((dx * ranged.speed) / dist),
    vy: Math.trunc((dy * ranged.speed) / dist),
    owner: i,
    damage: type.damageMin + randomInt(s, type.damageRange),
  });
  s.events.push({ type: 'mobFire', mob: i });
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
      // Mobs never walk off ledges they could not climb back up.
      if (self >= 0 && z - f > MAX_STEP) return true;
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
  h.int(p.hp).int(p.maxHp).int(p.armor).int(p.bullets).int(p.shells).int(p.cells);
  h.int(p.weapon).int(p.owned).int(p.switching).int(p.keys).int(p.cooldown).int(p.prevButtons);
  h.int(p.kills).int(p.relic).int(p.diedAt);
  for (const d of s.doors) h.int(d.phase).int(d.open).int(d.wait);
  for (const m of s.mobs)
    h.int(m.x).int(m.y).int(m.z).int(m.hp).int(m.state).int(m.timer).int(m.cooldown).int(m.wx).int(m.wy).int(m.wander);
  for (const it of s.pickups) h.int(it.taken ? 1 : 0);
  h.int(s.projectiles.length);
  for (const pr of s.projectiles) h.int(pr.x).int(pr.y).int(pr.vx).int(pr.vy).int(pr.owner).int(pr.damage);
  return h.digest();
}
