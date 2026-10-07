import { ONE, inputsToBase64, type SimEvent } from '@ossuary/sim';
import { hexToString, type Hex } from 'viem';
import type { Engine } from '@/game/engine';
import type { GraveMarker } from '@/game/entities';
import type { ChainLayer, Grave } from './ChainLayer';
import { VERIFIER_URL } from './config';

// Connects one Engine to one ChainLayer. The engine never waits on any of
// this: it plays on while runs are opened, deaths are signed by the verifier
// and recorded, and graves are read back and drawn.
//
//   descend      -> startRun(day)                         (sponsored UserOp)
//   death        -> verifier replays inputs, signs tile   -> recordDeath(...)
//   exit         -> verifier replays inputs, signs time   -> finishRun(...)
//   near a grave -> lootGrave(id)                          (once per grave)

const EPITAPHS = [
  'should have gone left',
  'the door was a lie',
  'i heard it breathing',
  'almost had the key',
  'went in loud',
  'save one bullet',
  'it waits past the duct',
  'count the rushers',
  'the slime was warm',
  'too slow, too proud',
  'bones for the next one',
  'tell them i ran',
];

const LOOT_RADIUS = 0.55;
const GRAVE_POLL_MS = 20_000;

export interface RunControllerEvents {
  message(text: string): void;
  graves(count: number): void;
}

export class RunController {
  private day: number | null = null;
  private runId: Promise<bigint | null> | null = null;
  private runOpen = false;
  /** Resolves once the previous run's death or finish has been written (or given up). */
  private settled: Promise<void> = Promise.resolve();
  private graves: Grave[] = [];
  private looting = new Set<bigint>();
  private shownEpitaph: bigint | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private disposed = false;

  constructor(
    private readonly engine: Engine,
    private readonly layer: ChainLayer,
    private readonly ui: RunControllerEvents,
  ) {}

  async start(): Promise<void> {
    this.day = await this.layer.today();
    // The verifier replays with the chain's day as the seed, so match it.
    if (this.engine.state.tick === 0 && this.engine.seedValue !== this.day) this.engine.restart(this.day);
    await this.refreshGraves();
    this.timers.push(setInterval(() => void this.refreshGraves(), GRAVE_POLL_MS));
    this.timers.push(setInterval(() => this.checkGraves(), 150));
  }

  dispose(): void {
    this.disposed = true;
    this.timers.forEach(clearInterval);
  }

  /** Called on the first simulated tick of each run. */
  onRunStart(): void {
    if (this.day === null) return;
    if (this.engine.seedValue !== this.day) {
      this.ui.message('Day changed. Restart to play today’s level.');
      return;
    }
    this.runOpen = true;
    this.looting.clear();
    const day = this.day;
    // Starting a run abandons any open one on-chain, so the previous grave
    // must land first or its recordDeath would fail with RunClosed.
    this.runId = this.settled
      .then(() => this.layer.startRun(day))
      .then((r) => r.runId)
      .catch((e) => {
        this.runOpen = false;
        this.ui.message(`Could not open the run: ${short(e)}`);
        return null;
      });
  }

  onEvent(e: SimEvent): void {
    if (e.type === 'death') this.settled = this.recordDeath();
    if (e.type === 'exit') this.settled = this.recordFinish();
  }

  private async recordDeath(): Promise<void> {
    const inputs = this.engine.inputLog();
    const runId = await this.runId;
    this.runOpen = false;
    if (runId === null || runId === undefined) return;
    try {
      const held = await this.layer.relics();
      const relicId = held.findIndex((n) => n > 0) + 1;
      const epitaph = EPITAPHS[Number(runId % BigInt(EPITAPHS.length))];
      const v = await this.verify('death', {
        runId: runId.toString(),
        player: this.layer.smartAccount,
        inputs: inputsToBase64(inputs),
        epitaph,
        relicId,
      });
      await this.layer.recordDeath(runId, v.tile, v.epitaph as Hex, v.relicId, v.signature as Hex);
      this.ui.message(`Your grave is on Fuji: “${epitaph}”`);
      await this.refreshGraves();
    } catch (e) {
      this.ui.message(`Grave not recorded: ${short(e)}`);
    }
  }

  private async recordFinish(): Promise<void> {
    const inputs = this.engine.inputLog();
    const runId = await this.runId;
    this.runOpen = false;
    if (runId === null || runId === undefined) return;
    try {
      const v = await this.verify('finish', {
        runId: runId.toString(),
        player: this.layer.smartAccount,
        inputs: inputsToBase64(inputs),
      });
      await this.layer.finishRun(runId, v.timeMs, v.kills, v.replayHash as Hex, v.signature as Hex);
      this.ui.message('Escape recorded on Fuji. A relic is yours.');
    } catch (e) {
      this.ui.message(`Finish not recorded: ${short(e)}`);
    }
  }

  private async verify(kind: 'death' | 'finish', body: object): Promise<any> {
    const res = await fetch(`${VERIFIER_URL}/verify/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`verifier: ${json.error ?? res.status}`);
    return json;
  }

  private async refreshGraves(): Promise<void> {
    if (this.day === null || this.disposed) return;
    try {
      this.graves = await this.layer.graves(this.day);
    } catch {
      return;
    }
    const level = this.engine.levelData;
    const me = this.layer.smartAccount.toLowerCase();
    const markers: GraveMarker[] = this.graves.map((g) => ({
      x: (g.tile % level.w) + 0.5,
      y: Math.floor(g.tile / level.w) + 0.5,
      z: level.floor[g.tile] / ONE,
      tile: g.tile,
      looted: g.looted,
      relic: g.relicId > 0,
      own: g.player.toLowerCase() === me,
    }));
    this.engine.setGraves(markers);
    this.ui.graves(this.graves.length);
  }

  /** Shows epitaphs as the player passes graves, and loots relics. */
  private checkGraves(): void {
    const s = this.engine.state;
    const level = this.engine.levelData;
    const px = s.player.x / ONE;
    const py = s.player.y / ONE;
    const me = this.layer.smartAccount.toLowerCase();
    let nearest: Grave | null = null;
    let best = 1.2;
    for (const g of this.graves) {
      const d = Math.hypot((g.tile % level.w) + 0.5 - px, Math.floor(g.tile / level.w) + 0.5 - py);
      if (d < best) {
        best = d;
        nearest = g;
      }
    }
    if (!nearest) {
      this.shownEpitaph = null;
      return;
    }
    if (this.shownEpitaph !== nearest.id) {
      this.shownEpitaph = nearest.id;
      const who = nearest.player.toLowerCase() === me ? 'you' : `${nearest.player.slice(0, 6)}…${nearest.player.slice(-4)}`;
      this.ui.message(`Here lies ${who}: “${hexToString(nearest.epitaph, { size: 32 })}”`);
    }
    const lootable =
      this.runOpen &&
      s.player.diedAt < 0 &&
      best < LOOT_RADIUS &&
      !nearest.looted &&
      nearest.relicId > 0 &&
      nearest.player.toLowerCase() !== me &&
      !this.looting.has(nearest.id);
    if (lootable) {
      const g = nearest;
      this.looting.add(g.id);
      this.ui.message('You pry the relic from the grave…');
      this.layer
        .lootGrave(g.id)
        .then(() => {
          this.ui.message(`Relic ${g.relicId} taken`);
          return this.refreshGraves();
        })
        .catch((e) => this.ui.message(`Loot failed: ${short(e)}`));
    }
  }
}

function short(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.length > 90 ? `${m.slice(0, 90)}…` : m;
}
