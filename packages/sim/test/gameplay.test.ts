import { describe, expect, it } from 'vitest';
import {
  BTN_FIRE,
  BTN_USE,
  DoorPhase,
  MobState,
  NO_INPUT,
  createSim,
  hashSim,
  parseLevel,
  step,
  useTarget,
  type LevelDef,
  type SimEvent,
  type SimState,
  type TickInput,
} from '../src';

const sectors: LevelDef['sectors'] = {
  room: { floor: 0, ceil: 128, light: '#808080', floorTex: 'grate', ceilTex: 'plates' },
  hall: { floor: 0, ceil: 96, light: '#808080', floorTex: 'grate', ceilTex: 'plates' },
};

function map(rows: string[], extra: LevelDef['legend'] = {}) {
  return parseLevel({
    name: 'test',
    sectors,
    legend: {
      '#': { wall: 'brick' },
      '.': { sector: 'room' },
      P: { sector: 'room', spawn: 0 },
      D: { sector: 'hall', door: { tex: 'door' } },
      R: { sector: 'hall', door: { tex: 'door_red', key: 'red' } },
      k: { sector: 'room', thing: 'key_red' },
      r: { sector: 'room', thing: 'rusher' },
      h: { sector: 'room', thing: 'health' },
      x: { sector: 'room', exit: true },
      ...extra,
    },
    rows,
  });
}

function run(s: SimState, level: ReturnType<typeof map>, input: TickInput, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    step(s, level, input);
    events.push(...s.events);
  }
  return events;
}

const fwd: TickInput = { forward: 1, strafe: 0, turn: 0, buttons: 0 };
const use: TickInput = { forward: 0, strafe: 0, turn: 0, buttons: BTN_USE };
const fire: TickInput = { forward: 0, strafe: 0, turn: 0, buttons: BTN_FIRE };

describe('doors', () => {
  const level = map(['#######', '#P.D..#', '#..D..#', '#######']);

  it('groups touching door tiles into one door', () => {
    expect(level.doors).toHaveLength(1);
    expect(level.doors[0].tiles).toHaveLength(2);
  });

  it('blocks until used, opens, then closes again', () => {
    const s = createSim(level, 1);
    run(s, level, fwd, 60);
    expect(s.player.x >> 16).toBe(2); // stopped in front of the door
    const ev = run(s, level, use, 1);
    expect(ev).toContainEqual({ type: 'door', door: 0, opening: true });
    run(s, level, NO_INPUT, 40);
    expect(s.doors[0].phase).toBe(DoorPhase.Open);
    run(s, level, fwd, 90);
    expect(s.player.x >> 16).toBeGreaterThanOrEqual(4); // walked through
    run(s, level, NO_INPUT, 300);
    expect(s.doors[0].phase).toBe(DoorPhase.Closed);
  });

  it('stays shut without the key and opens with it', () => {
    const locked = map(['#######', '#P.R..#', '#######']);
    const s = createSim(locked, 1);
    run(s, locked, fwd, 60);
    expect(run(s, locked, use, 1)).toContainEqual({ type: 'locked', door: 0 });

    const keyed = map(['#######', '#Pk.R.#', '#######']);
    const t = createSim(keyed, 1);
    const ev = run(t, keyed, fwd, 60);
    expect(ev).toContainEqual({ type: 'pickup', kind: 'key_red' });
    run(t, keyed, NO_INPUT, 1);
    expect(run(t, keyed, use, 1)).toContainEqual({ type: 'door', door: 0, opening: true });
  });
});

describe('combat', () => {
  it('the pistol kills a rusher in line of fire', () => {
    const level = map(['##########', '#P......r#', '##########']);
    const s = createSim(level, 7);
    // Alternate press and release is not needed: fire is automatic while held.
    const ev = run(s, level, fire, 60 * 6);
    expect(ev.some((e) => e.type === 'hitMob')).toBe(true);
    expect(s.mobs[0].state).toBe(MobState.Dead);
    expect(s.player.kills).toBe(1);
    expect(s.player.bullets).toBeLessThan(50);
  });

  it('a rusher wakes, closes in and kills an idle player, leaving a death tile', () => {
    const level = map(['########', '#P....r#', '########']);
    const s = createSim(level, 3);
    const ev = run(s, level, NO_INPUT, 60 * 40);
    expect(ev.some((e) => e.type === 'mobWake')).toBe(true);
    expect(ev.some((e) => e.type === 'hurt')).toBe(true);
    const death = ev.find((e) => e.type === 'death');
    expect(death).toEqual({ type: 'death', tile: level.w * 1 + 1 });
    expect(s.player.diedAt).toBeGreaterThan(0);
    expect(s.player.hp).toBe(0);
  });

  it('walls stop line of sight', () => {
    const level = map(['#########', '#P.#...r#', '#########']);
    const s = createSim(level, 3);
    run(s, level, NO_INPUT, 600);
    expect(s.mobs[0].state).toBe(MobState.Idle);
  });
});

describe('pickups and exit', () => {
  it('health is only taken when hurt', () => {
    const level = map(['#######', '#P.h..#', '#######']);
    const s = createSim(level, 1);
    run(s, level, fwd, 60);
    expect(s.pickups[0].taken).toBe(false);
    s.player.hp = 50;
    run(s, level, { ...fwd, forward: -1 }, 60);
    expect(s.pickups[0].taken).toBe(true);
    expect(s.player.hp).toBe(75);
  });

  it('reaching the exit finishes the run and freezes input', () => {
    const level = map(['######', '#P..x#', '######']);
    const s = createSim(level, 1);
    const ev = run(s, level, fwd, 120);
    expect(ev).toContainEqual({ type: 'exit' });
    expect(s.finishedAt).toBeGreaterThan(0);
    const x = s.player.x;
    run(s, level, { forward: -1, strafe: 0, turn: 0, buttons: 0 }, 60);
    expect(Math.abs(s.player.x - x)).toBeLessThan(65536 / 4);
  });
});

describe('determinism with combat', () => {
  it('same inputs, same fight', () => {
    const level = map(['############', '#P........r#', '#....r.....#', '#..........#', '############']);
    const inputs: TickInput[] = [];
    let seed = 12345;
    for (let i = 0; i < 6000; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      inputs.push({
        forward: ((seed >>> 8) % 3) - 1,
        strafe: ((seed >>> 12) % 3) - 1,
        turn: ((seed >>> 16) % 41) - 20,
        buttons: (seed >>> 24) & 3,
      });
    }
    const go = () => {
      const s = createSim(level, 99);
      for (const i of inputs) step(s, level, i);
      return [hashSim(s), s.player.kills, s.player.hp];
    };
    const a = go();
    expect(go()).toEqual(a);
  });
});

describe('use target', () => {
  it('reports the door ahead without changing anything', () => {
    const level = map(['#######', '#P.D..#', '#######']);
    const s = createSim(level, 1);
    expect(useTarget(s, level)).toBe(-1); // two tiles away
    run(s, level, fwd, 60);
    const before = hashSim(s);
    expect(useTarget(s, level)).toBe(0);
    expect(hashSim(s)).toBe(before);
    s.player.angle = 2048; // face away
    expect(useTarget(s, level)).toBe(-1);
  });
});
