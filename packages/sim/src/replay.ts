import type { Level } from './level';
import { tileIndex } from './level';
import { parseLevel } from './level';
import { charnelDescent } from './levels/charnel';
import { unpackInput } from './input';
import { TICK_RATE, createSim, hashSim, step } from './sim';

// Shared by the client (to know what it will claim) and the verifier (to check
// the claim). A run is fully described by its level, its seed and its packed
// input log, so replaying the log must reproduce the outcome exactly.

const cache = new Map<string, Level>();

/**
 * The level played on a given day. One hand-built map; what changes daily is
 * the seed, which fills its optional enemy and pickup slots.
 */
export function levelForDay(_day: number): Level {
  let l = cache.get(charnelDescent.name);
  if (!l) cache.set(charnelDescent.name, (l = parseLevel(charnelDescent)));
  return l;
}

export interface ReplayResult {
  outcome: 'death' | 'finish' | 'incomplete';
  /** Ticks simulated. */
  ticks: number;
  /** Tile index where the player died or finished. */
  tile: number;
  kills: number;
  /** Run time in milliseconds, from ticks. */
  timeMs: number;
  stateHash: number;
}

/**
 * Replays an input log from the start, carrying the same relic as the run.
 * The client stops logging the moment a run ends, so a valid log ends on
 * exactly the tick of death or exit; any input after that is treated as
 * tampering and the run is 'incomplete'.
 */
export function replay(level: Level, seed: number, inputs: Int32Array, relic = 0): ReplayResult {
  const s = createSim(level, seed, { relic });
  let outcome: ReplayResult['outcome'] = 'incomplete';
  for (let i = 0; i < inputs.length; i++) {
    step(s, level, unpackInput(inputs[i]));
    const ended = s.player.diedAt >= 0 ? 'death' : s.finishedAt >= 0 ? 'finish' : null;
    if (ended) {
      outcome = i === inputs.length - 1 ? ended : 'incomplete';
      break;
    }
  }
  const p = s.player;
  return {
    outcome,
    ticks: s.tick,
    tile: tileIndex(level, p.x >> 16, p.y >> 16),
    kills: p.kills,
    timeMs: Math.floor((s.tick * 1000) / TICK_RATE),
    stateHash: hashSim(s),
  };
}

// Little-endian base64 for input logs, with no dependency on Buffer or btoa
// so it runs the same in browsers, Node and anywhere else.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function inputsToBase64(inputs: Int32Array): string {
  const bytes = new Uint8Array(inputs.length * 4);
  const view = new DataView(bytes.buffer);
  inputs.forEach((v, i) => view.setInt32(i * 4, v, true));
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

export function inputsFromBase64(b64: string): Int32Array {
  const clean = b64.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let j = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0) << 6) |
      (i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0);
    if (j < bytes.length) bytes[j++] = (n >> 16) & 255;
    if (j < bytes.length) bytes[j++] = (n >> 8) & 255;
    if (j < bytes.length) bytes[j++] = n & 255;
  }
  if (bytes.length % 4) throw new Error('input log length is not a multiple of 4 bytes');
  const view = new DataView(bytes.buffer);
  const out = new Int32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt32(i * 4, true);
  return out;
}
