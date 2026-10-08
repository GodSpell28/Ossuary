import { BTN_FIRE, BTN_SLOT1, BTN_SLOT2, BTN_SLOT3, BTN_USE, InputLog, type TickInput } from './input';
import { KEY_BITS, tileIndex, type Level } from './level';
import {
  DoorPhase,
  MAX_STEP,
  MAX_TURN,
  MobState,
  createSim,
  isOver,
  lineOfSight,
  step,
  type RunOptions,
  type SimState,
} from './sim';
import { ANGLES, ANGLE_MASK } from './trig';

// A simple automated player for The Charnel Descent: it walks a path to each
// objective in turn (shotgun, red key, lance, blue key, exit), opens doors on
// the way and fights whatever it can see. It only produces inputs, which are
// logged exactly like a person's, so its runs verify the same way. Used to
// prove the level can be finished end to end and to exercise the chain flow
// (finish, then die carrying a relic, then loot) without a human.

export interface BotResult {
  state: SimState;
  inputs: Int32Array;
  outcome: 'finish' | 'death' | 'timeout';
}

const GOALS: { kind: string; done: (s: SimState) => boolean }[] = [
  { kind: 'shotgun', done: (s) => !!(s.player.owned & 2) },
  { kind: 'key_red', done: (s) => !!(s.player.keys & KEY_BITS.red) },
  { kind: 'lance', done: (s) => !!(s.player.owned & 4) },
  { kind: 'key_blue', done: (s) => !!(s.player.keys & KEY_BITS.blue) },
  { kind: 'exit', done: () => false },
];

function toAngle(dx: number, dy: number): number {
  return Math.round((Math.atan2(dy, dx) * ANGLES) / (2 * Math.PI)) & ANGLE_MASK;
}

/** Splits a desired walking direction into forward/strafe inputs relative to facing. */
function walkToward(dx: number, dy: number, facing: number): { forward: number; strafe: number } {
  const rel = Math.atan2(dy, dx) - (facing * 2 * Math.PI) / ANGLES;
  const f = Math.cos(rel);
  const r = Math.sin(rel);
  return { forward: f > 0.38 ? 1 : f < -0.38 ? -1 : 0, strafe: r > 0.38 ? 1 : r < -0.38 ? -1 : 0 };
}

function angleDiff(target: number, current: number): number {
  let d = (target - current) & ANGLE_MASK;
  if (d > ANGLES / 2) d -= ANGLES;
  return d;
}

/** Cheapest walk from `from` to `to`; slime costs more, locked doors are walls. */
function findPath(level: Level, s: SimState, from: number, to: number): number[] {
  const n = level.w * level.h;
  const cost = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  cost[from] = 0;
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && cost[i] < best) (best = cost[i]), (u = i);
    if (u < 0 || u === to) break;
    done[u] = 1;
    const ux = u % level.w;
    const uy = Math.floor(u / level.w);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const v = tileIndex(level, ux + dx, uy + dy);
      if (v < 0 || level.solid[v] || done[v]) continue;
      if (level.floor[v] - level.floor[u] > MAX_STEP) continue;
      const d = level.doorOf[v];
      if (d >= 0) {
        const key = level.doors[d].key;
        if (key && !(s.player.keys & KEY_BITS[key])) continue;
      }
      const c = cost[u] + (level.hurt[v] ? 6 : 1);
      if (c < cost[v]) (cost[v] = c), (prev[v] = u);
    }
  }
  if (!Number.isFinite(cost[to])) return [];
  const path = [to];
  while (path[0] !== from) path.unshift(prev[path[0]]);
  return path;
}

export function playBot(
  level: Level,
  seed: number,
  opts: RunOptions & { maxTicks?: number; engage?: number; delay?: number } = {},
): BotResult {
  const s = createSim(level, seed, opts);
  const log = new InputLog();
  const maxTicks = opts.maxTicks ?? 60 * 60 * 8;
  const engage = (opts.engage ?? 11) * 65536;
  const exitTile = [...level.exit.keys()].find((i) => level.exit[i])!;
  const goalTile = (kind: string) => {
    if (kind === 'exit') return exitTile;
    const t = level.things.find((th) => th.kind === kind)!;
    return tileIndex(level, t.x >> 16, t.y >> 16);
  };

  let prevButtons = 0;
  let path: number[] = [];
  let pathFor = -1;
  let lastPos = { x: s.player.x, y: s.player.y, tick: 0 };
  let wiggle = 0;

  // An optional idle start: every later moment plays out differently.
  for (let i = 0; i < (opts.delay ?? 0); i++) {
    const idle: TickInput = { forward: 0, strafe: 0, turn: 0, buttons: 0 };
    log.push(idle);
    step(s, level, idle);
  }

  while (!isOver(s) && s.tick < maxTicks) {
    const p = s.player;
    const here = tileIndex(level, p.x >> 16, p.y >> 16);
    const goal = GOALS.find((g) => !g.done(s))!;
    let target = goalTile(goal.kind);
    // Hurt: detour to the nearest health within reach first.
    if (p.hp < 55) {
      let bestLen = 18;
      for (const it of s.pickups) {
        if (it.taken || (it.kind !== 'health' && it.kind !== 'armor')) continue;
        if (it.kind === 'armor' && p.armor > 40) continue;
        const t = tileIndex(level, it.x >> 16, it.y >> 16);
        const len = findPath(level, s, here, t).length;
        if (len > 0 && len < bestLen) (bestLen = len), (target = t);
      }
    }
    if (pathFor !== target || s.tick % 15 === 0 || !path.includes(here)) {
      path = findPath(level, s, here, target);
      pathFor = target;
    }

    const inp: TickInput = { forward: 0, strafe: 0, turn: 0, buttons: 0 };
    let want = 0;

    // Nearest live enemy in sight.
    let foe = -1;
    let foeDist = engage;
    for (let i = 0; i < s.mobs.length; i++) {
      const m = s.mobs[i];
      if (m.state === MobState.Dead) continue;
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d < foeDist && lineOfSight(s, level, p.x, p.y, m.x, m.y)) (foeDist = d), (foe = i);
    }

    // Where the path wants to go next.
    let next = -1;
    if (path.length > 1) {
      const idx = path.indexOf(here);
      next = path[Math.min(path.length - 1, Math.max(idx, 0) + 1)];
    }
    const nx = (next % level.w) * 65536 + 32768;
    const ny = Math.floor(next / level.w) * 65536 + 32768;
    const doorAhead =
      next >= 0 &&
      level.doorOf[next] >= 0 &&
      (s.doors[level.doorOf[next]].phase === DoorPhase.Closed || s.doors[level.doorOf[next]].phase === DoorPhase.Closing);

    if (foe >= 0) {
      const m = s.mobs[foe];
      const diff = angleDiff(toAngle(m.x - p.x, m.y - p.y), p.angle);
      inp.turn = Math.max(-MAX_TURN, Math.min(MAX_TURN, diff));
      const tiles = foeDist / 65536;
      // Weapon: lance for anything tough or far, shotgun up close, else pistol.
      // Ranked choices for this foe; take the first that is owned and loaded.
      const ranked = m.kind === 'rusher' && tiles < 4 ? [1, 2, 0] : tiles < 5 ? [2, 1, 0] : [2, 0, 1];
      const loaded = (i: number) => !!(p.owned & (1 << i)) && [p.bullets, p.shells, p.cells][i] > 0;
      const w = ranked.find(loaded) ?? p.weapon;
      if (p.owned & (1 << w) && p.weapon !== w) want = [BTN_SLOT1, BTN_SLOT2, BTN_SLOT3][w];
      if (Math.abs(diff) < 48) want |= BTN_FIRE;
      // Melee foes close by: back straight away. Otherwise keep walking the
      // path while shooting, circle-strafe style, and never stand in slime.
      if (m.kind !== 'caster' && tiles < 2.4) Object.assign(inp, walkToward(p.x - m.x, p.y - m.y, p.angle));
      else if (next >= 0 && !doorAhead && (m.kind === 'caster' || level.hurt[here])) Object.assign(inp, walkToward(nx - p.x, ny - p.y, p.angle));
    } else if (next >= 0) {
      const diff = angleDiff(toAngle(nx - p.x, ny - p.y), p.angle);
      inp.turn = Math.max(-MAX_TURN, Math.min(MAX_TURN, diff));
      inp.forward = Math.abs(diff) < 500 ? 1 : 0;
      if (doorAhead) {
        want |= BTN_USE;
        inp.forward = Math.abs(diff) < 200 ? 0 : inp.forward;
      }
    }

    // Unstick: if barely moved for a second, shuffle sideways for a moment.
    if (s.tick - lastPos.tick >= 60) {
      const moved = Math.hypot(p.x - lastPos.x, p.y - lastPos.y);
      if (moved < 65536 * 0.15 && foe < 0) wiggle = 40;
      lastPos = { x: p.x, y: p.y, tick: s.tick };
    }
    if (wiggle > 0) {
      wiggle--;
      inp.strafe = (s.tick >> 4) & 1 ? 1 : -1;
      inp.forward = 1;
    }

    // Edge-triggered buttons need a release between presses; fire is held.
    const edge = BTN_USE | BTN_SLOT1 | BTN_SLOT2 | BTN_SLOT3;
    inp.buttons = (want & BTN_FIRE) | (want & edge & ~prevButtons);
    prevButtons = inp.buttons;

    log.push(inp);
    step(s, level, inp);
  }

  const outcome = s.finishedAt >= 0 ? 'finish' : s.player.diedAt >= 0 ? 'death' : 'timeout';
  return { state: s, inputs: log.toArray(), outcome };
}
