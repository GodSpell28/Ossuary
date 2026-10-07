import * as THREE from 'three';
import { MobState, ONE, PISTOL_COOLDOWN, type SimState } from '@ossuary/sim';
import type { LightSampler } from './levelMesh';
import { FOG_FAR, FOG_NEAR } from './materials';
import { SPRITE_SIZE, paintSprites, type SpriteSet } from './sprites';

// Billboard sprites for mobs and pickups (they turn to face the camera around
// the vertical axis only, like the originals) and the weapon drawn over the
// view in screen space. Both are lit by the sector light where they stand.

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

export class EntityRenderer {
  readonly group = new THREE.Group();
  private textures: Record<string, THREE.Texture> = {};
  private mobMeshes: THREE.Mesh[] = [];
  private pickupMeshes: THREE.Mesh[] = [];
  private geometry = billboardGeometry();
  private sprites: SpriteSet;

  constructor(private readonly light: LightSampler) {
    this.sprites = paintSprites();
    for (const [k, img] of Object.entries(this.sprites.rusher)) this.textures[`rusher.${k}`] = toTexture(img);
    for (const [k, img] of Object.entries(this.sprites.pickups)) this.textures[`pickup.${k}`] = toTexture(img);
    for (const [k, img] of Object.entries(this.sprites.graves)) this.textures[`grave.${k}`] = toTexture(img);
  }

  private graveMeshes: THREE.Mesh[] = [];

  /** Shows graves from the chain. They are scenery: the sim never sees them. */
  setGraves(graves: GraveMarker[]): void {
    while (this.graveMeshes.length > graves.length) {
      const m = this.graveMeshes.pop()!;
      this.group.remove(m);
      (m.material as THREE.Material).dispose();
    }
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

  get pistolFrames(): ImageData[] {
    return this.sprites.pistol;
  }

  /** Creates meshes to match a fresh sim. Call again after a restart. */
  reset(s: SimState): void {
    for (const m of [...this.mobMeshes, ...this.pickupMeshes]) {
      this.group.remove(m);
      (m.material as THREE.Material).dispose();
    }
    this.mobMeshes = s.mobs.map(() => this.add('rusher.walk1'));
    this.pickupMeshes = s.pickups.map((p) => this.add(`pickup.${p.kind}`));
  }

  private add(tex: string): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry, spriteMaterial(this.textures[tex]));
    this.group.add(mesh);
    return mesh;
  }

  update(prev: SimState, cur: SimState, alpha: number, yaw: number): void {
    cur.mobs.forEach((m, i) => {
      const mesh = this.mobMeshes[i];
      const a = prev.mobs[i] ?? m;
      const x = (a.x + (m.x - a.x) * alpha) / ONE;
      const y = (a.y + (m.y - a.y) * alpha) / ONE;
      mesh.position.set(x, m.z / ONE, y);
      mesh.rotation.y = yaw;
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.map.value = this.textures[`rusher.${mobFrame(m.state, m.timer, cur.tick)}`];
      setLight(mat, this.light, x, y);
    });
    for (const m of this.graveMeshes) m.rotation.y = yaw;
    cur.pickups.forEach((p, i) => {
      const mesh = this.pickupMeshes[i];
      mesh.visible = !p.taken;
      if (p.taken) return;
      const x = p.x / ONE;
      const y = p.y / ONE;
      // A slow bob so pickups read as pickups.
      const bob = Math.sin(cur.tick / 20 + i) * 0.03;
      mesh.position.set(x, bob - 0.05, y);
      mesh.rotation.y = yaw;
      setLight(mesh.material as THREE.ShaderMaterial, this.light, x, y, 0.15);
    });
  }

  dispose(): void {
    this.reset({ mobs: [], pickups: [] } as unknown as SimState);
    Object.values(this.textures).forEach((t) => t.dispose());
    this.geometry.dispose();
  }
}

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

function setLight(mat: THREE.ShaderMaterial, light: LightSampler, x: number, y: number, boost = 0): void {
  const [r, g, b] = light.floorAt(x, y);
  (mat.uniforms.uLight.value as THREE.Vector3).set(r + boost, g + boost, b + boost);
}

function mobFrame(state: MobState, timer: number, tick: number): string {
  switch (state) {
    case MobState.Attack:
      return timer < 10 ? 'attack1' : 'attack2';
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

/** The pistol, drawn in the low-res overlay pass with an orthographic camera in pixels. */
export class WeaponView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, 480, 270, 0, -1, 1);
  private frames: THREE.Texture[];
  private mesh: THREE.Mesh;
  private kick = 0;

  constructor(frames: ImageData[], private readonly light: LightSampler) {
    this.frames = frames.map(toTexture);
    // Unit-height quad scaled each frame so the gun is a fixed share of the
    // view height whatever the aspect ratio.
    const aspect = frames[0].width / frames[0].height;
    const g = new THREE.PlaneGeometry(aspect, 1);
    g.translate(0, 0.5, 0);
    this.mesh = new THREE.Mesh(g, spriteMaterial(this.frames[0], false));
    this.scene.add(this.mesh);
  }

  setViewport(width: number, height: number): void {
    this.camera.right = width;
    this.camera.top = height;
    this.camera.updateProjectionMatrix();
  }

  update(s: SimState, bobPhase: number, bobAmount: number, dtSec: number): void {
    const p = s.player;
    const firing = p.cooldown > PISTOL_COOLDOWN - 4;
    if (p.cooldown === PISTOL_COOLDOWN - 1) this.kick = 1;
    this.kick = Math.max(0, this.kick - dtSec * 6);
    const mat = this.mesh.material as THREE.ShaderMaterial;
    mat.uniforms.map.value = this.frames[firing ? 1 : 0];
    const x = p.x / ONE;
    const y = p.y / ONE;
    const [r, g, b] = this.light.floorAt(x, y);
    // Muzzle flash lights the hand.
    const f = firing ? 0.25 : 0.08;
    (mat.uniforms.uLight.value as THREE.Vector3).set(r + f, g + f, b + f * 0.6);

    const dead = p.diedAt >= 0 ? Math.min(1, (s.tick - p.diedAt) / 30) : 0;
    const w = this.camera.right;
    const h = this.camera.top;
    const size = h * 0.42;
    this.mesh.scale.set(size, size, 1);
    this.mesh.position.set(
      w / 2 + h * 0.04 + Math.cos(bobPhase) * h * 0.03 * bobAmount,
      -h * 0.02 + Math.abs(Math.sin(bobPhase)) * h * 0.02 * bobAmount - this.kick * h * 0.025 - dead * size,
      0,
    );
  }

  dispose(): void {
    this.frames.forEach((t) => t.dispose());
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
