// Searches bot variations for a run that escapes a day's layout.
//   pnpm --filter @ossuary/verifier bot-search 20734
import { levelForDay, playBot, replay } from '@ossuary/sim';
const level = levelForDay(0);
const day = Number(process.argv[2] ?? 20734);
let tries = 0, best = 0;
outer: for (const engage of [11, 9, 13, 8, 14, 10, 12]) {
  for (let delay = 0; delay <= 120; delay += 6) {
    tries++;
    const r = playBot(level, day, { engage, delay });
    const p = r.state.player;
    best = Math.max(best, p.kills);
    if (r.outcome === 'finish') {
      const rep = replay(level, day, r.inputs);
      console.log(`FINISH day ${day} engage ${engage} delay ${delay}: ${(r.state.tick / 60).toFixed(1)}s kills ${p.kills}/${r.state.mobs.length} hp ${p.hp} | replay ${rep.outcome} ${rep.timeMs}ms | after ${tries} tries`);
      break outer;
    }
  }
}
console.log(`tries ${tries}, most kills in a failed run ${best}`);
