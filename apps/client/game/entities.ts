import * as THREE from 'three';
import { MobState, ONE, WEAPONS, tileIndex, type Level, type SimEvent, type SimState } from '@ossuary/sim';
import type { LightSampler } from './levelMesh';
import { FOG_FAR, FOG_NEAR } from './materials';
import { SPRITE_SIZE, paintSprites, type SpriteSet } from './sprites';

// Billboard sprites for mobs, pickups, projectiles and graves (they turn to
// face the camera around the vertical axis only, like the originals) and the
// weapon drawn over the view in screen space. Everything is lit by the
// sector light where it stands; projectiles are fullbright.

const spriteVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const spriteFragment = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 uLight;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uFog;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vec4 t = texture2D(map, vUv);
    if (t.a < 0.5) discard;
    vec3 c = t.rgb * uLight * 2.0;
    float fog = smoothstep(uFogNear, uFogFar, vDepth) * uFog;
    gl_FragColor = vec4(mix(c, vec3(0.0), fog), 1.0);
  }
`;

function toTexture(img: ImageData): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

function spriteMaterial(map: THREE.Texture, fog = true): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: spriteVertex,
    fragmentShader: spriteFragment,
    uniforms: {
      map: { value: map },
      uLight: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      uFogNear: { value: FOG_NEAR },
      uFogFar: { value: FOG_FAR },
      uFog: { value: fog ? 1 : 0 },
    },
  });
}

/** A 1x1 tile quad with its origin at the bottom centre. */
function billboardGeometry(): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(SPRITE_SIZE / 64, SPRITE_SIZE / 64);
  g.translate(0, SPRITE_SIZE / 128, 0);
  return g;
}

/** A centred quad for projectiles and puffs. */
function centredGeometry(size: number): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(size, size);
}

const MOB_SCALE: Record<string, number> = { rusher: 1, caster: 1, heavy: 1.4 };

export interface GraveMarker {
  /** Tile centre in tiles. */
  x: number;
  y: number;
  z: number;
  tile: number;
  looted: boolean;
  relic: boolean;
  own: boolean;
}

interface Puff {
  mesh: THREE.Mesh;
  age: number;
}

export class EntityRenderer {
  readonly group = new THREE.Group();
  private textures: Record<string, THREE.Texture> = {};
  private mobMeshes: THREE.Mesh[] = [];
  private pickupMeshes: THREE.Mesh[] = [];
  private graveMeshes: THREE.Mesh[] = [];
  private projectileMeshes: THREE.Mesh[] = [];
  private puffs: Puff[] = [];
  private geometry = billboardGeometry();
  private small = centredGeometry(0.4);
  private sprites: SpriteSet;

  constructor(
    private readonly light: LightSampler,
    private readonly level: Level,
  ) {
    this.sprites = paintSprites();
    const sets = { rusher: this.sprites.rusher, caster: this.sprites.caster, heavy: this.sprites.heavy };
    for (const [kind, frames] of Object.entries(sets)) {
      for (const [k, img] of Object.entries(frames)) this.textures[`${kind}.${k}`] = toTexture(img);
    }
    for (const [k, img] of Object.entries(this.sprites.pickups)) this.textures[`pickup.${k}`] = toTexture(img);
    for (const [k, img] of Object.entries(this.sprites.graves)) this.textures[`grave.${k}`] = toTexture(img);
    for (const [k, img] of Object.entries(this.sprites.projectiles)) this.textures[`fx.${k}`] = toTexture(img);
  }

  get weaponFrames(): ImageData[][] {
    return this.sprites.weapons;
  }

  /** Shows graves from the chain. They are scenery: the sim never sees them. */
  setGraves(graves: GraveMarker[]): void {
    while (this.graveMeshes.length > graves.length) this.remove(this.graveMeshes.pop()!);
    while (this.graveMeshes.length < graves.length) this.graveMeshes.push(this.add('grave.full'));
    // Several deaths on one tile fan out so each stone stays visible.
    const perTile = new Map<number, number>();
    graves.forEach((g, i) => {
      const n = perTile.get(g.tile) ?? 0;
      perTile.set(g.tile, n + 1);
      const a = n * 2.4;
      const r = n === 0 ? 0 : 0.18 + 0.04 * n;
      const x = g.x + Math.cos(a) * r;
      const y = g.y + Math.sin(a) * r;
      const mesh = this.graveMeshes[i];
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.map.value = this.textures[`grave.${g.looted ? 'looted' : g.relic ? 'relic' : 'full'}`];
      mesh.position.set(x, g.z, y);
      mesh.scale.setScalar(0.8);
      setLight(mat, this.light, x, y, g.own ? 0.08 : 0);
    });
  }

  /** Creates meshes to match a fresh sim. Call again after a restart. */
  reset(s: SimState): void {
    for (const m of [...this.mobMeshes, ...this.pickupMeshes, ...this.projectileMeshes]) this.remove(m);
    for (const p of this.puffs) this.remove(p.mesh);
    this.puffs = [];
    this.projectileMeshes = [];
    this.mobMeshes = s.mobs.map((m) => {
      const mesh = this.add(`${m.kind}.walk1`);
      mesh.scale.setScalar(MOB_SCALE[m.kind] ?? 1);
      return mesh;
    });
    this.pickupMeshes = s.pickups.map((p) => this.add(`pickup.${p.kind}`));
  }

  private add(tex: string, geometry: THREE.BufferGeometry = this.geometry): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, spriteMaterial(this.textures[tex]));
    this.group.add(mesh);
    return mesh;
  }

  private remove(m: THREE.Mesh): void {
    this.group.remove(m);
    (m.material as THREE.Material).dispose();
  }

  /** Spawns short-lived impact puffs for wall hits and projectile bursts. */
  onEvent(e: SimEvent, s: SimState): void {
    if (e.type !== 'hitWall' && e.type !== 'projectileHit') return;
    const x = e.x / ONE;
    const y = e.y / ONE;
    const mesh = this.add(e.type === 'projectileHit' && e.owner >= 0 ? 'fx.ember' : 'fx.puff', this.small);
    const z = (s.player.z / ONE) + 0.55;
    mesh.position.set(x, z, y);
    (mesh.material as THREE.ShaderMaterial).uniforms.uLight.value.set(0.5, 0.5, 0.5);
    this.puffs.push({ mesh, age: 0 });
    if (this.puffs.length > 40) this.remove(this.puffs.shift()!.mesh);
  }

  update(prev: SimState, cur: SimState, alpha: number, yaw: number, dtSec: number): void {
    cur.mobs.forEach((m, i) => {
      const mesh = this.mobMeshes[i];
      const a = prev.mobs[i] ?? m;
      const x = (a.x + (m.x - a.x) * alpha) / ONE;
      const y = (a.y + (m.y - a.y) * alpha) / ONE;
      mesh.position.set(x, m.z / ONE, y);
      mesh.rotation.y = yaw;
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.map.value = this.textures[`${m.kind}.${mobFrame(m.state, m.timer, cur.tick)}`];
      // Casters glow while they wind up a throw.
      setLight(mat, this.light, x, y, m.kind === 'caster' && m.state === MobState.Attack ? 0.2 : 0);
    });
    cur.pickups.forEach((p, i) => {
      const mesh = this.pickupMeshes[i];
      mesh.visible = !p.taken;
      if (p.taken) return;
      const x = p.x / ONE;
      const y = p.y / ONE;
      // A slow bob so pickups read as pickups.
      const bob = Math.sin(cur.tick / 20 + i) * 0.03;
      mesh.position.set(x, bob - 0.05, y);
      mesh.position.y += this.floorAt(x, y);
      mesh.rotation.y = yaw;
      setLight(mesh.material as THREE.ShaderMaterial, this.light, x, y, 0.15);
    });
    for (const m of this.graveMeshes) m.rotation.y = yaw;

    // Projectiles: a pooled mesh per live projectile, fullbright.
    while (this.projectileMeshes.length < cur.projectiles.length) this.projectileMeshes.push(this.add('fx.ember', this.small));
    this.projectileMeshes.forEach((mesh, i) => {
      const pr = cur.projectiles[i];
      mesh.visible = !!pr;
      if (!pr) return;
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.map.value = this.textures[pr.owner < 0 ? 'fx.bolt' : 'fx.ember'];
      (mat.uniforms.uLight.value as THREE.Vector3).set(0.55, 0.55, 0.55);
      mesh.position.set((pr.x + pr.vx * alpha) / ONE, pr.z / ONE, (pr.y + pr.vy * alpha) / ONE);
      mesh.rotation.y = yaw;
    });

    for (const p of this.puffs) {
      p.age += dtSec;
      p.mesh.rotation.y = yaw;
      p.mesh.scale.setScalar(1 + p.age * 3);
      p.mesh.visible = p.age < 0.18;
    }
    while (this.puffs.length && this.puffs[0].age > 0.3) this.remove(this.puffs.shift()!.mesh);
  }

  private floorAt(x: number, y: number): number {
    const t = tileIndex(this.level, Math.floor(x), Math.floor(y));
    return t >= 0 ? this.level.floor[t] / ONE : 0;
  }

  dispose(): void {
    this.reset({ mobs: [], pickups: [], projectiles: [] } as unknown as SimState);
    this.setGraves([]);
    Object.values(this.textures).forEach((t) => t.dispose());
    this.geometry.dispose();
    this.small.dispose();
  }
}

function setLight(mat: THREE.ShaderMaterial, light: LightSampler, x: number, y: number, boost = 0): void {
  const [r, g, b] = light.floorAt(x, y);
  (mat.uniforms.uLight.value as THREE.Vector3).set(r + boost, g + boost, b + boost);
}

function mobFrame(state: MobState, timer: number, tick: number): string {
  switch (state) {
    case MobState.Attack:
      return timer < 12 ? 'attack1' : 'attack2';
    case MobState.Pain:
      return 'pain';
    case MobState.Dead:
      return timer < 8 ? 'die1' : timer < 16 ? 'die2' : 'corpse';
    case MobState.Chase:
      return (tick >> 3) & 1 ? 'walk2' : 'walk1';
    default:
      return 'walk1';
  }
}

/** The held weapon, drawn in the low-res overlay pass with an orthographic camera in pixels. */
export class WeaponView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, 480, 270, 0, -1, 1);
  private frames: THREE.Texture[][];
  private mesh: THREE.Mesh;
  private kick = 0;
  private lastCooldown = 0;

  constructor(frames: ImageData[][], private readonly light: LightSampler) {
    this.frames = frames.map((pair) => pair.map(toTexture));
    // Unit-height quad scaled each frame so the gun is a fixed share of the
    // view height whatever the aspect ratio.
    const aspect = frames[0][0].width / frames[0][0].height;
    const g = new THREE.PlaneGeometry(aspect, 1);
    g.translate(0, 0.5, 0);
    this.mesh = new THREE.Mesh(g, spriteMaterial(this.frames[0][0], false));
    this.scene.add(this.mesh);
  }

  setViewport(width: number, height: number): void {
    this.camera.right = width;
    this.camera.top = height;
    this.camera.updateProjectionMatrix();
  }

  update(s: SimState, bobPhase: number, bobAmount: number, dtSec: number): void {
    const p = s.player;
    const w = WEAPONS[p.weapon];
    // A fresh shot resets the cooldown upward.
    if (p.cooldown > this.lastCooldown) this.kick = 1;
    this.lastCooldown = p.cooldown;
    const firing = p.cooldown > 0 && w.cooldown - p.cooldown < 4;
    this.kick = Math.max(0, this.kick - dtSec * (p.weapon === 1 ? 3 : 6));
    const mat = this.mesh.material as THREE.ShaderMaterial;
    mat.uniforms.map.value = this.frames[p.weapon][firing ? 1 : 0];
    const x = p.x / ONE;
    const y = p.y / ONE;
    const [r, g, b] = this.light.floorAt(x, y);
    // Muzzle flash lights the hand.
    const f = firing ? 0.25 : 0.08;
    (mat.uniforms.uLight.value as THREE.Vector3).set(r + f, g + f, b + f * 0.6);

    const dead = p.diedAt >= 0 ? Math.min(1, (s.tick - p.diedAt) / 30) : 0;
    // Lower the old weapon and raise the new one during a switch.
    const lowering = p.switching > 0 ? Math.sin((p.switching / 14) * Math.PI) : 0;
    const width = this.camera.right;
    const h = this.camera.top;
    const size = h * 0.42;
    this.mesh.scale.set(size, size, 1);
    this.mesh.position.set(
      width / 2 + h * 0.04 + Math.cos(bobPhase) * h * 0.03 * bobAmount,
      -h * 0.02 +
        Math.abs(Math.sin(bobPhase)) * h * 0.02 * bobAmount -
        this.kick * h * (p.weapon === 1 ? 0.06 : 0.025) -
        dead * size -
        lowering * size * 0.6,
      0,
    );
  }

  dispose(): void {
    this.frames.flat().forEach((t) => t.dispose());
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
