import { InputLog, NO_INPUT, type TickInput } from './input';
import type { Level } from './level';
import { createSim, isOver, step, type RunOptions, type SimState } from './sim';

// Plays a fixed list of (input, ticks) pairs, stopping when the run ends.
// Used by tests, the verifier's tests and the end-to-end chain script.

export type Script = [Partial<TickInput>, number][];

export function playScript(
  level: Level,
  seed: number,
  script: Script,
  opts: RunOptions = {},
): { state: SimState; inputs: Int32Array } {
  const s = createSim(level, seed, opts);
  const log = new InputLog();
  outer: for (const [partial, n] of script) {
    const inp = { ...NO_INPUT, ...partial };
    for (let i = 0; i < n; i++) {
      if (isOver(s)) break outer;
      log.push(inp);
      step(s, level, inp);
    }
  }
  return { state: s, inputs: log.toArray() };
}

/** On The Charnel Descent: open the crypt door, walk into the bone hall and stand there. */
export const STAND_AND_DIE: Script = [
  [{ forward: 1 }, 90],
  [{ buttons: 2 }, 1],
  [{}, 40],
  [{ forward: 1 }, 110],
  [{}, 60 * 180],
];
