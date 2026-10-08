import { ONE, RELICS, SIM_FINGERPRINT, inputsToBase64, type SimEvent } from '@ossuary/sim';
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

/** How close, in tiles, the player must stand to a grave to work it. */
const LOOT_RADIUS = 0.8;
const GRAVE_POLL_MS = 20_000;

export interface RunControllerEvents {
  message(text: string): void;
  graves(count: number): void;
  /** The run ended in death and an epitaph can be carved (or null once done). */
  epitaph(defaultText: string | null): void;
  /** What pressing E at a grave would do, or null when not at one. */
  prompt(p: { action: string; button?: string } | null): void;
}

/** Seconds to wait for a typed epitaph before carving the default. */
const EPITAPH_WAIT_S = 25;

export class RunController {
  private day: number | null = null;
  private runId: Promise<bigint | null> | null = null;
  private runOpen = false;
  /** Resolves once the previous run's death or finish has been written (or given up). */
  private settled: Promise<void> = Promise.resolve();
  private graves: Grave[] = [];
  private looting = new Set<bigint>();
  private shownEpitaph: bigint | null = null;
  /** The grave pressing E would loot right now. */
  private lootTarget: Grave | null = null;
  private lastPrompt = '';
  private timers: ReturnType<typeof setInterval>[] = [];
  private carveNow: ((text: string) => void) | null = null;
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
    void this.checkVerifierVersion();
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

  /** Carves the epitaph the player typed (or the default) right away. */
  carve(text: string): void {
    this.carveNow?.(text);
  }

  private askEpitaph(fallback: string): Promise<string> {
    this.ui.epitaph(fallback);
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(fallback), EPITAPH_WAIT_S * 1000);
      const done = (text: string) => {
        clearTimeout(timer);
        this.carveNow = null;
        this.ui.epitaph(null);
        resolve(text.trim().slice(0, 32) || fallback);
      };
      this.carveNow = done;
    });
  }

  private async recordDeath(): Promise<void> {
    const inputs = this.engine.inputLog();
    const relicId = this.engine.relicValue;
    const fallback = EPITAPHS[Math.floor(Math.random() * EPITAPHS.length)];
    const typed = this.askEpitaph(fallback);
    const runId = await this.runId;
    this.runOpen = false;
    if (runId === null || runId === undefined) {
      this.carveNow?.(fallback);
      return;
    }
    try {
      // Epitaphs are 32 bytes on-chain; trim multi-byte text until it fits.
      let epitaph = await typed;
      while (new TextEncoder().encode(epitaph).length > 32) epitaph = epitaph.slice(0, -1);
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
        relicId: this.engine.relicValue,
      });
      await this.layer.finishRun(runId, v.timeMs, v.kills, v.replayHash as Hex, v.signature as Hex);
      this.ui.message('Escape recorded on Fuji. A relic is yours.');
    } catch (e) {
      this.ui.message(`Finish not recorded: ${short(e)}`);
    }
  }

  /**
   * Warns before play if this page runs different game rules from the
   * verifier (an old tab across a deploy). Such a run could never verify.
   */
  private async checkVerifierVersion(): Promise<void> {
    try {
      const res = await fetch(`${VERIFIER_URL}/`);
      const info = (await res.json()) as { sim?: string };
      if (info.sim && info.sim !== SIM_FINGERPRINT) {
        this.ui.message('The game was updated. Reload the page (Ctrl+Shift+R) before playing, or your result cannot be recorded.');
      }
    } catch {
      this.ui.message('The verifier is unreachable right now; deaths and escapes may not be recorded.');
    }
  }

  /**
   * Posts a run to the verifier. Network failures and server errors are
   * retried; a refusal (4xx) is final and its reason is shown.
   */
  private async verify(kind: 'death' | 'finish', body: { inputs: string } & Record<string, unknown>): Promise<any> {
    // Ticks from the captured log itself: the engine may already be on a new run.
    const ticks = Math.floor((body.inputs.replace(/=+$/, '').length * 3) / 16);
    const payload = JSON.stringify({ ...body, sim: SIM_FINGERPRINT, ticks });
    let last: unknown;
    for (const wait of [0, 1500, 4000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        const res = await fetch(`${VERIFIER_URL}/verify/${kind}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload,
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok) return json;
        last = new Error(`verifier: ${json.error ?? res.status}`);
        if (res.status < 500) break;
      } catch (e) {
        last = e;
      }
    }
    throw last;
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

  /** Takes the relic from the grave the player is standing at, if any. Bound to E. */
  lootNearby(): void {
    const g = this.lootTarget;
    if (!g || this.looting.has(g.id)) return;
    this.looting.add(g.id);
    this.lootTarget = null;
    this.setPrompt(null);
    this.ui.message('You pry the relic from the grave…');
    this.layer
      .lootGrave(g.id)
      .then(() => {
        this.ui.message(`${RELICS[g.relicId]?.name ?? `Relic ${g.relicId}`} is yours`);
        return this.refreshGraves();
      })
      .catch((e) => {
        this.looting.delete(g.id);
        this.ui.message(`Loot failed: ${short(e)}`);
      });
  }

  private setPrompt(p: { action: string; button?: string } | null): void {
    const key = JSON.stringify(p);
    if (key === this.lastPrompt) return;
    this.lastPrompt = key;
    this.ui.prompt(p);
  }

  /** Shows epitaphs as the player passes graves, and what E would do at one. */
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
      this.lootTarget = null;
      this.setPrompt(null);
      return;
    }
    if (this.shownEpitaph !== nearest.id) {
      this.shownEpitaph = nearest.id;
      const who = nearest.player.toLowerCase() === me ? 'you' : `${nearest.player.slice(0, 6)}…${nearest.player.slice(-4)}`;
      this.ui.message(`Here lies ${who}: “${hexToString(nearest.epitaph, { size: 32 })}”`);
    }
    this.lootTarget = null;
    if (best >= LOOT_RADIUS || s.player.diedAt >= 0 || s.finishedAt >= 0) {
      this.setPrompt(null);
      return;
    }
    const relic = RELICS[nearest.relicId]?.name;
    if (nearest.player.toLowerCase() === me) this.setPrompt({ action: 'Your own grave' });
    else if (this.looting.has(nearest.id)) this.setPrompt({ action: 'Prying the relic loose…' });
    else if (nearest.looted) this.setPrompt({ action: 'Already looted' });
    else if (!relic) this.setPrompt({ action: 'Nothing was buried here' });
    else if (!this.runOpen) this.setPrompt({ action: `${relic} lies here. Waiting for your run to open on-chain…` });
    else {
      this.lootTarget = nearest;
      this.setPrompt({ action: `Take the ${relic}`, button: 'E' });
    }
  }
}

function short(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.length > 90 ? `${m.slice(0, 90)}…` : m;
}
