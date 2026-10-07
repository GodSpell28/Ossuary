import { describe, expect, it } from 'vitest';
import {
  BTN_FIRE,
  BTN_SLOT1,
  BTN_SLOT2,
  MOB_TYPES,
  MobState,
  NO_INPUT,
  createSim,
  hashSim,
  parseLevel,
  step,
  type LevelDef,
  type SimEvent,
  type SimState,
  type ThingKind,
  type TickInput,
} from '../src';

const sectors: LevelDef['sectors'] = {
  room: { floor: 0, ceil: 128, light: '#808080', floorTex: 'grate', ceilTex: 'plates' },
  ledge: { floor: 48, ceil: 128, light: '#808080', floorTex: 'grate', ceilTex: 'plates' },
};

function map(rows: string[], things: [ThingKind, number, number][] = []) {
  return parseLevel({
    name: 'test',
    sectors,
    legend: { '#': { wall: 'brick' }, '.': { sector: 'room' }, L: { sector: 'ledge' }, P: { sector: 'room', spawn: 0 } },
    rows,
    things,
  });
}

function run(s: SimState, level: ReturnType<typeof map>, input: TickInput, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    step(s, level, input);
    out.push(...s.events);
  }
  return out;
}

const fire: TickInput = { ...NO_INPUT, buttons: BTN_FIRE };
const fwd: TickInput = { ...NO_INPUT, forward: 1 };

describe('weapons', () => {
  it('picking up the shotgun selects it, and one blast at close range does big damage', () => {
    const level = map(['#########', '#P......#', '#########'], [['shotgun', 2, 1], ['heavy', 5, 1]]);
    const s = createSim(level, 4);
    run(s, level, fwd, 16);
    expect(s.player.weapon).toBe(1);
    expect(s.player.shells).toBe(8);
    run(s, level, NO_INPUT, 20); // finish the switch
    const before = s.mobs[0].hp;
    run(s, level, fire, 1);
    expect(s.player.shells).toBe(7);
    expect(before - s.mobs[0].hp).toBeGreaterThan(30);
  });

  it('switches back with slot keys and ignores unowned slots', () => {
    const level = map(['#####', '#P..#', '#####']);
    const s = createSim(level, 1);
    run(s, level, { ...NO_INPUT, buttons: BTN_SLOT2 }, 1);
    expect(s.player.weapon).toBe(0);
    s.player.owned = 3;
    run(s, level, NO_INPUT, 1);
    run(s, level, { ...NO_INPUT, buttons: BTN_SLOT2 }, 1);
    expect(s.player.weapon).toBe(1);
    run(s, level, NO_INPUT, 1);
    run(s, level, { ...NO_INPUT, buttons: BTN_SLOT1 }, 1);
    expect(s.player.weapon).toBe(0);
  });

  it('the lance fires projectiles that travel and kill', () => {
    const level = map(['############', '#P.........#', '############'], [['lance', 2, 1], ['rusher', 10, 1]]);
    const s = createSim(level, 9);
    run(s, level, fwd, 16);
    expect(s.player.weapon).toBe(2);
    run(s, level, NO_INPUT, 20);
    run(s, level, fire, 1);
    expect(s.projectiles).toHaveLength(1);
    expect(s.projectiles[0].owner).toBe(-1);
    run(s, level, fire, 240);
    expect(s.mobs[0].state).toBe(MobState.Dead);
  });
});

describe('enemies', () => {
  it('a caster on a ledge shoots the player but never steps down', () => {
    const level = map(['############', '#P......LLL#', '#.......LLL#', '############'], [['caster', 9, 1]]);
    const s = createSim(level, 5);
    const ev = run(s, level, NO_INPUT, 60 * 20);
    expect(ev.some((e) => e.type === 'mobFire')).toBe(true);
    expect(ev.some((e) => e.type === 'hurt')).toBe(true);
    expect(s.mobs[0].x >> 16).toBeGreaterThanOrEqual(8);
  });

  it('a heavy is slow and tough', () => {
    const level = map(['##############', '#P...........#', '##############'], [['rusher', 12, 1], ['heavy', 12, 1]]);
    expect(MOB_TYPES.heavy.speed).toBeLessThan(MOB_TYPES.rusher.speed);
    const s = createSim(level, 5);
    run(s, level, fire, 60 * 4);
    // Eight seconds of pistol fire will not drop a heavy behind a rusher.
    expect(s.mobs.some((m) => m.kind === 'heavy' && m.state !== MobState.Dead)).toBe(true);
  });
});

describe('relics', () => {
  const level = map(['#####', '#P..#', '#####']);

  it('change starting stats', () => {
    expect(createSim(level, 1, { relic: 1 }).player.hp).toBe(125);
    expect(createSim(level, 1, { relic: 6 }).player.armor).toBe(50);
    expect(createSim(level, 1, { relic: 99 }).player.relic).toBe(0);
  });

  it('change the simulation, so the same inputs hash differently', () => {
    const long = map(['##############', '#P...........#', '##############']);
    const a = createSim(long, 1);
    const b = createSim(long, 1, { relic: 3 });
    run(a, long, fwd, 40);
    run(b, long, fwd, 40);
    expect(b.player.x).toBeGreaterThan(a.player.x);
    expect(hashSim(a)).not.toBe(hashSim(b));
  });
});

describe('daily variation', () => {
  const slots: [ThingKind, number, number][] = [];
  for (let x = 1; x < 15; x++) slots.push(['opt_mob', x, 2], ['opt_item', x, 3]);
  const level = map(['################', '#P.............#', '#..............#', '#..............#', '################'], slots);
  const layout = (seed: number) => {
    const s = createSim(level, seed);
    return JSON.stringify([s.mobs.map((m) => [m.kind, m.x]), s.pickups.map((p) => [p.kind, p.x])]);
  };

  it('is the same for everyone on a day and differs between days', () => {
    expect(layout(20733)).toBe(layout(20733));
    expect(layout(20733)).not.toBe(layout(20734));
  });
});
