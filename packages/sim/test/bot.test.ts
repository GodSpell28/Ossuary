import { describe, expect, it } from 'vitest';
import { levelForDay, playBot, replay } from '../src';

describe('bot', () => {
  // A known escape on day 20734's layout. If the rules or the level change,
  // re-find the parameters with apps/verifier's bot search; the point is that
  // the level stays finishable and the bot's run replays exactly.
  it('escapes The Charnel Descent and the run replays to the same finish', () => {
    const level = levelForDay(20734);
    const r = playBot(level, 20734, { engage: 9, delay: 108 });
    expect(r.outcome).toBe('finish');
    expect(r.state.player.kills).toBe(r.state.mobs.length);
    const rep = replay(level, 20734, r.inputs);
    expect(rep.outcome).toBe('finish');
    expect(rep.ticks).toBe(r.state.tick);
  }, 30_000);
});
