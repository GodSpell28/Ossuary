import { describe, expect, it } from 'vitest';
import { InputLog, STAND_AND_DIE, createSim, inputsFromBase64, inputsToBase64, isOver, levelForDay, playScript, replay, step, type TickInput } from '../src';

describe('replay', () => {
  const level = levelForDay(20733);

  function playUntilOver(seed: number, input: TickInput, max = 60 * 120) {
    const s = createSim(level, seed);
    const log = new InputLog();
    for (let i = 0; i < max && !isOver(s); i++) {
      log.push(input);
      step(s, level, input);
    }
    return { s, inputs: log.toArray() };
  }

  it('base64 round-trips any input log', () => {
    for (const n of [0, 1, 2, 3, 7, 1000]) {
      const a = new Int32Array(n).map((_, i) => (i * 2654435761) | 0);
      expect(Array.from(inputsFromBase64(inputsToBase64(a)))).toEqual(Array.from(a));
    }
  });

  it('confirms a real death and the tile it happened on', () => {
    const { state: s, inputs } = playScript(level, 20733, STAND_AND_DIE);
    expect(s.player.diedAt).toBeGreaterThan(0);
    const r = replay(level, 20733, inputsFromBase64(inputsToBase64(inputs)));
    expect(r.outcome).toBe('death');
    expect(r.tile).toBe(level.w * (s.player.y >> 16) + (s.player.x >> 16));
    expect(r.ticks).toBe(s.player.diedAt + 1);
  });

  it('a relic changes the outcome, so the verifier must replay with the same one', () => {
    const { inputs } = playScript(level, 20733, STAND_AND_DIE);
    const plain = replay(level, 20733, inputs);
    const armored = replay(level, 20733, inputs, 6);
    expect(armored.stateHash).not.toBe(plain.stateHash);
  });

  it('rejects a log replayed with the wrong seed or with extra input', () => {
    const { s, inputs } = playUntilOver(1, { forward: 0, strafe: 0, turn: 0, buttons: 0 }, 600);
    expect(isOver(s)).toBe(false);
    expect(replay(level, 1, inputs).outcome).toBe('incomplete');
  });
});
