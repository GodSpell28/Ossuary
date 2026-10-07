import * as THREE from 'three';
import { TEXTURE_PAINTERS, TEX_SIZE } from './textures';

// World surfaces use one small shader: texture times baked vertex light, with
// 0.5 as neutral so lights can brighten as well as darken (the Doom 64 trick),
// then fog to black by view depth.

export const FOG_NEAR = 2;
export const FOG_FAR = 12;

const vertexShader = /* glsl */ `
  attribute vec3 aLight;
  uniform vec2 uScroll;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vLight;
  varying float vDepth;
  void main() {
    vUv = uv + uScroll * uTime;
    vLight = aLight;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec2 vUv;
  varying vec3 vLight;
  varying float vDepth;
  void main() {
    vec3 tex = texture2D(map, vUv).rgb;
    vec3 c = tex * vLight * 2.0;
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    gl_FragColor = vec4(mix(c, vec3(0.0), fog), 1.0);
  }
`;

export interface WorldMaterials {
  get(texId: string): THREE.ShaderMaterial;
  setTime(t: number): void;
  dispose(): void;
}

const SCROLL: Record<string, [number, number]> = {
  slime: [0.05, 0.02],
};

export function createWorldMaterials(): WorldMaterials {
  const time = { value: 0 };
  const cache = new Map<string, THREE.ShaderMaterial>();
  const textures: THREE.Texture[] = [];

  const makeTexture = (id: string): THREE.Texture => {
    const painter = TEXTURE_PAINTERS[id] ?? TEXTURE_PAINTERS.brick;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TEX_SIZE;
    canvas.getContext('2d')!.putImageData(painter(), 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    textures.push(tex);
    return tex;
  };

  return {
    get(id) {
      let m = cache.get(id);
      if (!m) {
        const [sx, sy] = SCROLL[id] ?? [0, 0];
        m = new THREE.ShaderMaterial({
          vertexShader,
          fragmentShader,
          side: THREE.DoubleSide,
          uniforms: {
            map: { value: makeTexture(id) },
            uFogNear: { value: FOG_NEAR },
            uFogFar: { value: FOG_FAR },
            uScroll: { value: new THREE.Vector2(sx, sy) },
            uTime: time,
          },
        });
        cache.set(id, m);
      }
      return m;
    },
    setTime(t) {
      time.value = t;
    },
    dispose() {
      cache.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}
