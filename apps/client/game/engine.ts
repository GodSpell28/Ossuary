import * as THREE from 'three';
import {
  ANG180,
  ANGLES,
  InputLog,
  ONE,
  TICK_RATE,
  VIEW_HEIGHT,
  angleToRadians,
  cloneSim,
  createSim,
  hashSim,
  hex32,
  DoorPhase,
  KEY_BITS,
  WEAPONS,
  ammoFor,
  useTarget,
  isOver,
  levelForDay,
  step,
  type Level,
  type SimEvent,
  type SimState,
  type TickInput,
} from '@ossuary/sim';
import { EntityRenderer, WeaponView, type GraveMarker } from './entities';
import { InputCollector } from './input';
import { buildDoorMeshes, buildLevelMesh, type LightSampler } from './levelMesh';
import { LowResPipeline } from './lowres';
import { createWorldMaterials, type WorldMaterials } from './materials';

// Owns the renderer and the fixed-step loop. The sim advances in whole 60 Hz
// ticks; rendering interpolates between the last two states. This class knows
// nothing about wallets: chain work subscribes to the events it emits.

const TICK_MS = 1000 / TICK_RATE;
const MAX_FRAME_MS = 250;

export interface EngineStats {
  fps: number;
  tick: number;
  tile: [number, number];
  hash: string;
  simMs: number;
  renderMs: number;
}

export interface HudState {
  locked: boolean;
  hp: number;
  armor: number;
  ammo: number;
  weapon: string;
  /** Bitmask of owned weapons, for the weapon strip. */
  owned: number;
  weaponIndex: number;
  relic: number;
  keys: number;
  kills: number;
  totalMobs: number;
  /** 'playing', or how the run ended. */
  phase: 'playing' | 'dead' | 'escaped';
  /** Run time in ms (from ticks, not the wall clock). */
  timeMs: number;
  /** What pressing E would do right now, e.g. "Open door", or null. */
  prompt: { action: string; button?: string } | null;
}

export interface EngineCallbacks {
  onStats(s: EngineStats): void;
  onHud(h: HudState): void;
  onEvent(e: SimEvent, s: SimState): void;
  /** The first tick of a run is about to be simulated. */
  onRunStart?(): void;
}

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 64);
  private pipeline = new LowResPipeline();
  private materials: WorldMaterials;
  private input: InputCollector;
  private level: Level;
  private light: LightSampler;
  private doorMeshes: THREE.Mesh[];
  private entities: EntityRenderer;
  private weapon: WeaponView;
  private sim!: SimState;
  private prev!: SimState;
  private log = new InputLog();
  private accumulator = 0;
  private lastTime = 0;
  private raf = 0;
  private viewZ = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private frames = 0;
  private fpsTime = 0;
  private fps = 0;
  private statsTime = 0;
  private simMs = 0;
  private renderMs = 0;
  private lastHud = '';
  private relic = 0;
  private resizeObserver: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    private readonly cb: EngineCallbacks,
    private seed: number,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x000000);
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.cursor = 'crosshair';
    container.appendChild(canvas);

    this.level = levelForDay(seed);
    this.materials = createWorldMaterials();
    const world = buildLevelMesh(this.level, this.materials);
    this.light = world.light;
    this.scene.add(world.group);
    this.doorMeshes = buildDoorMeshes(this.level, this.materials, this.light);
    this.doorMeshes.forEach((m) => this.scene.add(m));
    this.entities = new EntityRenderer(this.light, this.level);
    this.scene.add(this.entities.group);
    this.weapon = new WeaponView(this.entities.weaponFrames, this.light);
    this.input = new InputCollector(canvas);

    this.restart(seed);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  start(): void {
    this.lastTime = performance.now();
    this.fpsTime = this.lastTime;
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** Starts a fresh run on the same level, optionally carrying a relic. */
  restart(seed = this.seed, relic = this.relic): void {
    this.seed = seed;
    this.relic = relic;
    this.sim = createSim(this.level, seed, { relic });
    this.prev = cloneSim(this.sim);
    this.log = new InputLog();
    this.viewZ = this.sim.player.z + VIEW_HEIGHT;
    this.accumulator = 0;
    this.entities.reset(this.sim);
    this.lastHud = '';
  }

  requestLock(): void {
    this.input.requestLock();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry) o.geometry.dispose();
    });
    this.entities.dispose();
    this.weapon.dispose();
    this.materials.dispose();
    this.pipeline.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /**
   * Dev only: advances the sim synchronously with a fixed input, recording it
   * like real play. Lets automated tests drive the game without relying on
   * requestAnimationFrame, which browsers throttle in hidden tabs.
   */
  debugRun(input: Partial<TickInput>, ticks: number): SimState {
    const inp: TickInput = { forward: 0, strafe: 0, turn: 0, buttons: 0, ...input };
    for (let i = 0; i < ticks; i++) {
      if (this.sim.tick === 0) this.cb.onRunStart?.();
      this.prev = cloneSim(this.sim);
      if (!isOver(this.sim)) this.log.push(inp);
      step(this.sim, this.level, inp);
      for (const e of this.sim.events) {
        this.entities.onEvent(e, this.sim);
        this.cb.onEvent(e, this.sim);
      }
    }
    this.prev = cloneSim(this.sim);
    return this.sim;
  }

  /** Every input recorded this run, for the verifier. */
  inputLog(): Int32Array {
    return this.log.toArray();
  }

  get state(): SimState {
    return this.sim;
  }

  get seedValue(): number {
    return this.seed;
  }

  get relicValue(): number {
    return this.relic;
  }

  get levelData(): Level {
    return this.level;
  }

  setGraves(graves: GraveMarker[]): void {
    this.entities.setGraves(graves);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pipeline.setAspect(w / h);
    this.weapon.setViewport(this.pipeline.width, this.pipeline.height);
  }

  private frame(now: number): void {
    const dt = Math.min(MAX_FRAME_MS, now - this.lastTime);
    this.lastTime = now;

    const t0 = performance.now();
    // The sim only advances while the player has control. After death or the
    // exit it keeps ticking so corpses fall and doors close, but input stops
    // being recorded.
    if (this.input.locked || isOver(this.sim)) {
      this.accumulator += dt;
      while (this.accumulator >= TICK_MS) {
        const over = isOver(this.sim);
        if (this.sim.tick === 0) this.cb.onRunStart?.();
        const inp = this.input.sample();
        this.prev = cloneSim(this.sim);
        if (!over) this.log.push(inp);
        step(this.sim, this.level, inp);
        for (const e of this.sim.events) {
          this.entities.onEvent(e, this.sim);
          this.cb.onEvent(e, this.sim);
        }
        this.accumulator -= TICK_MS;
      }
    } else {
      this.input.sample();
      this.accumulator = 0;
      this.prev = cloneSim(this.sim);
    }
    const t1 = performance.now();

    const alpha = this.accumulator / TICK_MS;
    const dtSec = dt / 1000;
    this.placeCamera(alpha, dtSec);
    this.doorMeshes.forEach((m, i) => {
      const a = this.prev.doors[i].open;
      const b = this.sim.doors[i].open;
      m.position.y = (this.level.floor[this.level.doors[i].tiles[0]] + a + (b - a) * alpha) / ONE;
    });
    this.entities.update(this.prev, this.sim, alpha, this.camera.rotation.y, dtSec);
    this.weapon.update(this.sim, this.bobPhase, this.bobAmount, dtSec);
    this.materials.setTime(now / 1000);
    this.pipeline.render(this.renderer, [
      [this.scene, this.camera],
      [this.weapon.scene, this.weapon.camera],
    ]);
    this.simMs = t1 - t0;
    this.renderMs = performance.now() - t1;

    this.emitHud();
    this.frames++;
    if (now - this.fpsTime >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsTime));
      this.frames = 0;
      this.fpsTime = now;
    }
    if (now - this.statsTime >= 250) {
      this.statsTime = now;
      const p = this.sim.player;
      this.cb.onStats({
        fps: this.fps,
        tick: this.sim.tick,
        tile: [p.x >> 16, p.y >> 16],
        hash: hex32(hashSim(this.sim)),
        simMs: this.simMs,
        renderMs: this.renderMs,
      });
    }
  }

  private emitHud(): void {
    const s = this.sim;
    const p = s.player;
    const end = p.diedAt >= 0 ? p.diedAt : s.finishedAt >= 0 ? s.finishedAt : s.tick;
    const hud: HudState = {
      locked: this.input.locked,
      hp: p.hp,
      armor: p.armor,
      ammo: ammoFor(p),
      weapon: WEAPONS[p.weapon].name,
      owned: p.owned,
      weaponIndex: p.weapon,
      relic: p.relic,
      keys: p.keys,
      kills: p.kills,
      totalMobs: s.mobs.length,
      phase: p.diedAt >= 0 ? 'dead' : s.finishedAt >= 0 ? 'escaped' : 'playing',
      timeMs: Math.floor((end * 1000) / TICK_RATE),
      prompt: this.doorPrompt(),
    };
    // Only re-render React when something visible changed (time in whole seconds).
    const key = JSON.stringify({ ...hud, timeMs: Math.floor(hud.timeMs / 1000) });
    if (key !== this.lastHud) {
      this.lastHud = key;
      this.cb.onHud(hud);
    }
  }

  private doorPrompt(): HudState['prompt'] {
    const s = this.sim;
    if (isOver(s)) return null;
    const d = useTarget(s, this.level);
    if (d < 0) return null;
    const def = this.level.doors[d];
    if (def.key && !(s.player.keys & KEY_BITS[def.key])) return { action: `Locked: needs the ${def.key} keycard` };
    const phase = s.doors[d].phase;
    if (phase === DoorPhase.Closed || phase === DoorPhase.Closing) {
      return { action: def.key ? `Open the ${def.key} door` : 'Open door', button: 'E' };
    }
    return null;
  }

  private placeCamera(alpha: number, dtSec: number): void {
    const a = this.prev.player;
    const b = this.sim.player;
    const x = (a.x + (b.x - a.x) * alpha) / ONE;
    const y = (a.y + (b.y - a.y) * alpha) / ONE;

    let da = b.angle - a.angle;
    if (da > ANG180) da -= ANGLES;
    if (da < -ANG180) da += ANGLES;
    const angle = a.angle + da * alpha;

    // Step up smoothly, fall with the sim's gravity; sink to the floor on death.
    const deadFor = b.diedAt >= 0 ? Math.min(1, (this.sim.tick - b.diedAt) / 40) : 0;
    const target = b.z + VIEW_HEIGHT * (1 - deadFor * 0.75);
    if (target < this.viewZ) this.viewZ = target;
    else this.viewZ += (target - this.viewZ) * Math.min(1, dtSec * 14);

    const speed = Math.hypot(b.vx, b.vy) / ONE;
    this.bobAmount = Math.min(1, speed * 12);
    this.bobPhase += dtSec * 11 * this.bobAmount;
    const bob = Math.sin(this.bobPhase * 2) * 0.02 * this.bobAmount;

    this.camera.position.set(x, this.viewZ / ONE + bob, y);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = -angleToRadians(angle) - Math.PI / 2;
    this.camera.rotation.x = this.input.pitch;
    this.camera.rotation.z = deadFor * 0.5;
  }
}
