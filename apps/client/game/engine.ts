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
  parseLevel,
  provingGrounds,
  step,
  type Level,
  type SimState,
} from '@ossuary/sim';
import { InputCollector } from './input';
import { buildLevelMesh } from './levelMesh';
import { LowResPipeline } from './lowres';
import { createWorldMaterials, type WorldMaterials } from './materials';

// Owns the renderer and the fixed-step loop. The sim advances in whole 60 Hz
// ticks; rendering interpolates between the last two states. This class knows
// nothing about wallets: chain work will subscribe to events it emits.

const TICK_MS = 1000 / TICK_RATE;
const MAX_FRAME_MS = 250;

export interface EngineStats {
  locked: boolean;
  fps: number;
  tick: number;
  tile: [number, number];
  hash: string;
  /** Milliseconds spent in sim and render last frame. */
  simMs: number;
  renderMs: number;
}

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 64);
  private pipeline = new LowResPipeline();
  private materials: WorldMaterials;
  private input: InputCollector;
  private level: Level;
  private sim: SimState;
  private prev: SimState;
  private log = new InputLog();
  private accumulator = 0;
  private lastTime = 0;
  private raf = 0;
  private viewZ = 0;
  private bobPhase = 0;
  private frames = 0;
  private fpsTime = 0;
  private fps = 0;
  private statsTime = 0;
  private simMs = 0;
  private renderMs = 0;
  private resizeObserver: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    private readonly onStats: (s: EngineStats) => void,
    seed: number,
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

    this.level = parseLevel(provingGrounds);
    this.sim = createSim(this.level, seed);
    this.prev = cloneSim(this.sim);
    this.viewZ = this.sim.player.z + VIEW_HEIGHT;

    this.materials = createWorldMaterials();
    this.scene.add(buildLevelMesh(this.level, this.materials));
    this.input = new InputCollector(canvas);

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

  requestLock(): void {
    this.input.requestLock();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.materials.dispose();
    this.pipeline.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /** Every input recorded this run, for the verifier. */
  inputLog(): Int32Array {
    return this.log.toArray();
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pipeline.setAspect(w / h);
  }

  private frame(now: number): void {
    const dt = Math.min(MAX_FRAME_MS, now - this.lastTime);
    this.lastTime = now;

    const t0 = performance.now();
    // Only advance the sim while the player is in control.
    if (this.input.locked) {
      this.accumulator += dt;
      while (this.accumulator >= TICK_MS) {
        const inp = this.input.sample();
        this.prev = cloneSim(this.sim);
        this.log.push(inp);
        step(this.sim, this.level, inp);
        this.accumulator -= TICK_MS;
      }
    } else {
      this.accumulator = 0;
      this.prev = cloneSim(this.sim);
    }

    const t1 = performance.now();
    const alpha = this.accumulator / TICK_MS;
    this.placeCamera(alpha, dt / 1000);
    this.materials.setTime(now / 1000);
    this.pipeline.render(this.renderer, [[this.scene, this.camera]]);
    this.simMs = t1 - t0;
    this.renderMs = performance.now() - t1;

    this.frames++;
    if (now - this.fpsTime >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsTime));
      this.frames = 0;
      this.fpsTime = now;
    }
    if (now - this.statsTime >= 250) {
      this.statsTime = now;
      const p = this.sim.player;
      this.onStats({
        locked: this.input.locked,
        fps: this.fps,
        tick: this.sim.tick,
        tile: [p.x >> 16, p.y >> 16],
        hash: hex32(hashSim(this.sim)),
        simMs: this.simMs,
        renderMs: this.renderMs,
      });
    }
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

    // Step up smoothly, fall with the sim's gravity.
    const target = b.z + VIEW_HEIGHT;
    if (target < this.viewZ) this.viewZ = target;
    else this.viewZ += (target - this.viewZ) * Math.min(1, dtSec * 14);

    const speed = Math.hypot(b.vx, b.vy) / ONE;
    this.bobPhase += dtSec * 11 * Math.min(1, speed * 12);
    const bob = Math.sin(this.bobPhase) * 0.025 * Math.min(1, speed * 12);

    this.camera.position.set(x, this.viewZ / ONE + bob, y);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = -angleToRadians(angle) - Math.PI / 2;
    this.camera.rotation.x = this.input.pitch;
  }
}
