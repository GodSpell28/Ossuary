import * as THREE from 'three';

// Draws the scene into a small render target (270 lines tall) and blits it to
// the canvas with nearest sampling and a 4x4 ordered dither down to 5 bits per
// channel. That is most of the N64-era look.

export const INTERNAL_HEIGHT = 270;

const blitVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const blitFragment = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 uSize;
  varying vec2 vUv;
  // 4x4 Bayer built from two 2x2 levels. Arithmetic only: indexing a local
  // array per pixel is very slow on some D3D11 drivers.
  float bayer2(vec2 a) {
    return 2.0 * abs(a.x - a.y) + a.y;
  }
  float bayer(vec2 p) {
    vec2 lo = mod(p, 2.0);
    vec2 hi = mod(floor(p * 0.5), 2.0);
    return (4.0 * bayer2(lo) + bayer2(hi) + 0.5) / 16.0;
  }
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    vec2 px = floor(vUv * uSize);
    c = floor(c * 31.0 + bayer(px)) / 31.0;
    gl_FragColor = vec4(c, 1.0);
  }
`;

export class LowResPipeline {
  readonly target: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  width = 480;
  height = INTERNAL_HEIGHT;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(this.width, this.height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader: blitVertex,
      fragmentShader: blitFragment,
      uniforms: {
        tScene: { value: this.target.texture },
        uSize: { value: new THREE.Vector2(this.width, this.height) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  /** Matches the internal width to the canvas aspect ratio. */
  setAspect(aspect: number): void {
    this.width = Math.max(1, Math.round(INTERNAL_HEIGHT * aspect));
    this.target.setSize(this.width, this.height);
    (this.material.uniforms.uSize.value as THREE.Vector2).set(this.width, this.height);
  }

  render(renderer: THREE.WebGLRenderer, passes: [THREE.Scene, THREE.Camera][]): void {
    renderer.setRenderTarget(this.target);
    renderer.autoClear = false;
    renderer.clear();
    for (const [scene, camera] of passes) {
      renderer.render(scene, camera);
      renderer.clearDepth();
    }
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCamera);
    renderer.autoClear = true;
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
