import { describe, expect, it } from 'vitest';
import {
  ANGLES,
  ANG90,
  InputLog,
  ONE,
  PLAYER_RADIUS,
  createSim,
  fcos,
  fsin,
  hashSim,
  makeRng,
  packInput,
  parseLevel,
  provingGrounds,
  step,
  tileIndex,
  unpackInput,
  type TickInput,
} from '../src';

const level = parseLevel(provingGrounds);

function randomInputs(seed: number, n: number): TickInput[] {
  const r = makeRng(seed);
  const out: TickInput[] = [];
  let cur: TickInput = { forward: 0, strafe: 0, turn: 0, buttons: 0 };
  for (let i = 0; i < n; i++) {
    // Hold each input for a while, like a person would.
    if (r() < 0.05) {
      cur = {
        forward: Math.floor(r() * 3) - 1,
        strafe: Math.floor(r() * 3) - 1,
        turn: Math.floor(r() * 61) - 30,
        buttons: Math.floor(r() * 4),
      };
    }
    out.push(cur);
  }
  return out;
}

describe('trig table', () => {
  it('hits the cardinal values exactly', () => {
    expect(fsin(0)).toBe(0);
    expect(fsin(ANG90)).toBe(ONE);
    expect(fcos(0)).toBe(ONE);
    expect(fsin(ANG90 * 3)).toBe(-ONE);
  });

  it('stays within one unit of Math.sin', () => {
    for (let a = 0; a < ANGLES; a++) {
      expect(Math.abs(fsin(a) - Math.sin((a * 2 * Math.PI) / ANGLES) * ONE)).toBeLessThanOrEqual(1);
    }
  });
});

describe('input packing', () => {
  it('round-trips', () => {
    for (const i of randomInputs(7, 500)) expect(unpackInput(packInput(i))).toEqual(i);
    const extreme = { forward: -1, strafe: 1, turn: -256, buttons: 255 };
    expect(unpackInput(packInput(extreme))).toEqual(extreme);
  });
});

describe('level', () => {
  it('parses the proving grounds', () => {
    expect(level.w).toBe(28);
    expect(level.h).toBe(19);
    expect(level.spawn).toEqual({ tx: 3, ty: 2, angle: 0 });
  });
});

describe('simulation', () => {
  it('is deterministic for the same inputs', () => {
    const inputs = randomInputs(42, 20_000);
    const run = () => {
      const s = createSim(level, 1234);
      for (const i of inputs) step(s, level, i);
      return hashSim(s);
    };
    expect(run()).toBe(run());
  });

  it('replays from a packed input log', () => {
    const inputs = randomInputs(99, 5_000);
    const live = createSim(level, 5);
    const log = new InputLog();
    for (const i of inputs) {
      log.push(i);
      step(live, level, i);
    }
    const replay = createSim(level, 5);
    for (const v of log.toArray()) step(replay, level, unpackInput(v));
    expect(hashSim(replay)).toBe(hashSim(live));
  });

  it('never lets the player into a wall', () => {
    const s = createSim(level, 1);
    for (const i of randomInputs(3, 30_000)) {
      step(s, level, i);
      const p = s.player;
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const t = tileIndex(level, (p.x + dx * (PLAYER_RADIUS - 1)) >> 16, (p.y + dy * (PLAYER_RADIUS - 1)) >> 16);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(level.solid[t]).toBe(0);
      }
    }
  });

  it('walks east out of the atrium into the duct', () => {
    const s = createSim(level, 1);
    // Spawn is (3,2) facing east; the duct starts at x=9 on rows 3-4.
    for (let i = 0; i < 20; i++) step(s, level, { forward: 0, strafe: 1, turn: 0, buttons: 0 });
    for (let i = 0; i < 180; i++) step(s, level, { forward: 1, strafe: 0, turn: 0, buttons: 0 });
    expect(s.player.x >> 16).toBeGreaterThanOrEqual(10);
  });
});
