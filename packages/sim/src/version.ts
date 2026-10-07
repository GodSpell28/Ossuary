import { Hasher, hex32 } from './hash';
import { charnelDescent } from './levels/charnel';
import { levelForDay } from './replay';
import { playScript, type Script } from './scripted';
import { MOB_TYPES, RELICS, WEAPONS, hashSim } from './sim';

// A fingerprint of the game rules, computed when the module loads: the level
// data and tuning tables, plus the final state of a short scripted run that
// moves, opens a door, switches weapons, fires and fights. Any change to the
// rules changes it, with no version number to remember to bump.
//
// The client sends it with every result and the verifier compares it with its
// own. A browser tab still running older rules than the verifier (an open tab
// across a deploy, or a hot reload during development) is told to reload,
// instead of failing later with a replay that no longer matches.

const PROBE: Script = [
  [{ forward: 1 }, 90],
  [{ buttons: 2 }, 1],
  [{}, 30],
  [{ buttons: 64 }, 1],
  [{ forward: 1, buttons: 1 }, 80],
  [{ turn: 24, buttons: 1 }, 120],
  [{ strafe: 1, buttons: 1 }, 120],
  [{ forward: -1 }, 60],
];

function fingerprint(): string {
  const h = new Hasher();
  const text = (s: string) => {
    for (let i = 0; i < s.length; i++) h.int(s.charCodeAt(i));
  };
  text(JSON.stringify(charnelDescent));
  text(JSON.stringify(WEAPONS));
  text(JSON.stringify(MOB_TYPES));
  text(JSON.stringify(RELICS));
  const { state } = playScript(levelForDay(0), 20733, PROBE, { relic: 4 });
  h.int(hashSim(state));
  return hex32(h.digest());
}

export const SIM_FINGERPRINT: string = fingerprint();
