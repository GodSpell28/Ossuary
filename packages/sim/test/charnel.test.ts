import { describe, expect, it } from 'vitest';
import { KEY_BITS, MAX_STEP, charnelDescent, createSim, parseLevel, tileIndex, type Level } from '../src';

const level = parseLevel(charnelDescent);

/** Tiles reachable on foot from the spawn holding `keys`, honouring step heights. */
function reachable(l: Level, keys: number): Set<number> {
  const start = tileIndex(l, l.spawn.tx, l.spawn.ty);
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const t = queue.shift()!;
    const x = t % l.w;
    const y = Math.floor(t / l.w);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const n = tileIndex(l, x + dx, y + dy);
      if (n < 0 || seen.has(n) || l.solid[n]) continue;
      if (l.floor[n] - l.floor[t] > MAX_STEP) continue;
      const d = l.doorOf[n];
      if (d >= 0 && l.doors[d].key && !(keys & KEY_BITS[l.doors[d].key!])) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen;
}

const thingTile = (kind: string) => {
  const t = level.things.find((th) => th.kind === kind)!;
  return tileIndex(level, t.x >> 16, t.y >> 16);
};

describe('The Charnel Descent', () => {
  it('parses with three doors that need no key and one each for red and blue', () => {
    expect(level.doors.filter((d) => !d.key)).toHaveLength(3);
    expect(level.doors.filter((d) => d.key === 'red')).toHaveLength(1);
    expect(level.doors.filter((d) => d.key === 'blue')).toHaveLength(1);
  });

  it('can be finished: red key, then blue key, then the exit', () => {
    const exits = [...level.exit.keys()].filter((i) => level.exit[i]);
    const none = reachable(level, 0);
    expect(none.has(thingTile('key_red'))).toBe(true);
    expect(none.has(thingTile('key_blue'))).toBe(false);
    expect(exits.some((e) => none.has(e))).toBe(false);

    const red = reachable(level, KEY_BITS.red);
    expect(red.has(thingTile('key_blue'))).toBe(true);
    expect(exits.some((e) => red.has(e))).toBe(false);

    const both = reachable(level, KEY_BITS.red | KEY_BITS.blue);
    expect(exits.some((e) => both.has(e))).toBe(true);
  });

  it('every weapon and key is reachable, and casters sit on ledges', () => {
    const all = reachable(level, KEY_BITS.red | KEY_BITS.blue);
    for (const k of ['shotgun', 'lance', 'key_red', 'key_blue']) expect(all.has(thingTile(k))).toBe(true);
    const casterTiles = level.things.filter((t) => t.kind === 'caster').map((t) => tileIndex(level, t.x >> 16, t.y >> 16));
    expect(casterTiles.some((t) => level.floor[t] > 0)).toBe(true);
  });

  it('fills its optional slots differently on different days', () => {
    const count = (day: number) => createSim(level, day).mobs.length;
    const counts = new Set([20733, 20734, 20735, 20736, 20737].map(count));
    expect(counts.size).toBeGreaterThan(1);
  });
});
