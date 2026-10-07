import { quantise } from './textures';

// Sprite art, drawn with canvas shapes at low resolution and then snapped to
// the game palette with hard alpha. Original work: a bony "rusher", pickups,
// and the pistol seen from the player's hand.

export const SPRITE_SIZE = 64;

type Ctx = CanvasRenderingContext2D;

function draw(w: number, h: number, fn: (c: Ctx) => void): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
  fn(c);
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 110) {
      d[i + 3] = 0;
      continue;
    }
    const q = quantise(d[i], d[i + 1], d[i + 2]);
    d[i] = (q >> 16) & 255;
    d[i + 1] = (q >> 8) & 255;
    d[i + 2] = q & 255;
    d[i + 3] = 255;
  }
  return img;
}

function ellipse(c: Ctx, x: number, y: number, rx: number, ry: number, fill: string, rot = 0) {
  c.fillStyle = fill;
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  c.fill();
}

function limb(c: Ctx, pts: [number, number][], width: number, color: string) {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) c.lineTo(x, y);
  c.stroke();
}

const BONE = '#cbbfa8';
const BONE_SHADE = '#8c8173';
const FLESH = '#5e1510';
const FLESH_DARK = '#3a0c0a';
const EYE = '#e0c060';

interface RusherPose {
  /** Horizontal lean of the torso, pixels. */
  lean: number;
  /** Leg stride: -1, 0, 1. */
  stride: number;
  /** Arms: 'down' walking, 'raise' winding up, 'slash' striking. */
  arms: 'down' | 'raise' | 'slash';
  mouth: boolean;
  flash?: boolean;
}

function rusher(p: RusherPose): ImageData {
  return draw(SPRITE_SIZE, SPRITE_SIZE, (c) => {
    const cx = 32 + p.lean;
    // Legs
    limb(c, [[cx - 4, 40], [cx - 6 - p.stride * 4, 52], [cx - 7 - p.stride * 3, 63]], 3, BONE_SHADE);
    limb(c, [[cx + 4, 40], [cx + 6 + p.stride * 4, 52], [cx + 7 + p.stride * 3, 63]], 3, BONE_SHADE);
    // Pelvis and torso of torn flesh over ribs
    ellipse(c, cx, 39, 7, 4, FLESH_DARK);
    ellipse(c, cx, 29, 9, 11, FLESH);
    for (let i = 0; i < 4; i++) limb(c, [[cx - 7, 22 + i * 4], [cx, 24 + i * 4], [cx + 7, 22 + i * 4]], 1.4, BONE);
    limb(c, [[cx, 19], [cx, 38]], 2, BONE_SHADE);
    // Arms
    const armL: [number, number][] =
      p.arms === 'down'
        ? [[cx - 8, 21], [cx - 13, 32 - p.stride * 2], [cx - 12, 44 - p.stride * 3]]
        : p.arms === 'raise'
          ? [[cx - 8, 21], [cx - 16, 12], [cx - 12, 3]]
          : [[cx - 8, 21], [cx - 6, 30], [cx + 4, 36]];
    const armR: [number, number][] =
      p.arms === 'down'
        ? [[cx + 8, 21], [cx + 13, 32 + p.stride * 2], [cx + 12, 44 + p.stride * 3]]
        : p.arms === 'raise'
          ? [[cx + 8, 21], [cx + 16, 12], [cx + 12, 3]]
          : [[cx + 8, 21], [cx + 6, 30], [cx - 4, 36]];
    for (const arm of [armL, armR]) {
      limb(c, arm, 3, BONE_SHADE);
      const [hx, hy] = arm[arm.length - 1];
      // Three claws
      for (let k = -1; k <= 1; k++) limb(c, [[hx, hy], [hx + k * 3, hy + (p.arms === 'raise' ? -5 : 5)]], 1.2, BONE);
    }
    // Skull
    ellipse(c, cx, 13, 7, 8, BONE);
    ellipse(c, cx + 1, 15, 6, 5, BONE_SHADE);
    ellipse(c, cx - 3, 12, 2, 2, '#0a0908');
    ellipse(c, cx + 3, 12, 2, 2, '#0a0908');
    c.fillStyle = EYE;
    c.fillRect(cx - 4, 11, 2, 2);
    c.fillRect(cx + 2, 11, 2, 2);
    if (p.mouth) {
      ellipse(c, cx, 19, 4, 3, '#0a0908');
      for (let k = -3; k <= 3; k += 2) c.fillRect(cx + k, 17, 1, 2);
    } else {
      c.fillStyle = '#2a2622';
      c.fillRect(cx - 3, 18, 6, 1);
    }
    if (p.flash) {
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = 'rgba(255,255,255,0.55)';
      c.fillRect(0, 0, 64, 64);
      c.globalCompositeOperation = 'source-over';
    }
  });
}

function rusherDeath(stage: number): ImageData {
  return draw(SPRITE_SIZE, SPRITE_SIZE, (c) => {
    // Blood pool grows, the body folds into a heap of bones.
    ellipse(c, 32, 61, 6 + stage * 5, 2 + stage, '#5e1510');
    if (stage === 0) {
      c.save();
      c.translate(32, 60);
      c.rotate(-0.35);
      c.translate(-32, -60);
      // putImageData ignores transforms, so go through a canvas.
      const tmp = document.createElement('canvas');
      tmp.width = tmp.height = SPRITE_SIZE;
      tmp.getContext('2d')!.putImageData(rusher({ lean: 0, stride: 0, arms: 'down', mouth: true, flash: true }), 0, 0);
      c.drawImage(tmp, 0, 0);
      c.restore();
      return;
    }
    const h = stage === 1 ? 14 : 7;
    ellipse(c, 32, 62 - h / 2, 14, h / 2, FLESH);
    for (let i = 0; i < 4; i++) limb(c, [[24 + i * 4, 62 - h], [26 + i * 4, 62]], 1.4, BONE);
    limb(c, [[14, 60], [24, 57]], 3, BONE_SHADE);
    limb(c, [[40, 58], [52, 61]], 3, BONE_SHADE);
    ellipse(c, stage === 1 ? 44 : 47, 62 - h - 2, 6, 5, BONE);
    ellipse(c, stage === 1 ? 42 : 45, 62 - h - 3, 1.5, 1.5, '#0a0908');
  });
}

// ---- caster: a hooded robed figure that throws embers ----

interface CasterPose {
  sway: number;
  hands: 'low' | 'raise' | 'throw';
  flash?: boolean;
}

const ROBE = '#46284e';
const ROBE_DARK = '#2a1830';
const EMBER = '#e0c060';
const EMBER_HOT = '#ffffff';

function caster(p: CasterPose): ImageData {
  return draw(SPRITE_SIZE, SPRITE_SIZE, (c) => {
    const cx = 32 + p.sway;
    // Robe, wide at the hem
    c.fillStyle = ROBE;
    c.beginPath();
    c.moveTo(cx - 6, 18);
    c.lineTo(cx + 6, 18);
    c.lineTo(cx + 13 + p.sway, 63);
    c.lineTo(cx - 13 + p.sway, 63);
    c.closePath();
    c.fill();
    c.fillStyle = ROBE_DARK;
    c.fillRect(cx - 1, 24, 2, 39);
    // Hood with a bone face inside
    ellipse(c, cx, 13, 8, 9, ROBE);
    ellipse(c, cx, 14, 5, 6, '#0a0908');
    ellipse(c, cx, 15, 3, 4, BONE_SHADE);
    c.fillStyle = EYE;
    c.fillRect(cx - 2, 13, 1, 1);
    c.fillRect(cx + 1, 13, 1, 1);
    // Arms and hands
    const hands: [number, number][] =
      p.hands === 'low'
        ? [[cx - 10, 36], [cx + 10, 36]]
        : p.hands === 'raise'
          ? [[cx - 12, 10], [cx + 12, 10]]
          : [[cx - 4, 26], [cx + 4, 26]];
    limb(c, [[cx - 6, 22], hands[0]], 4, ROBE);
    limb(c, [[cx + 6, 22], hands[1]], 4, ROBE);
    for (const [hx, hy] of hands) {
      const r = p.hands === 'low' ? 2 : 4;
      ellipse(c, hx, hy, r, r, EMBER);
      if (p.hands !== 'low') ellipse(c, hx, hy, 2, 2, EMBER_HOT);
    }
    if (p.hands === 'throw') ellipse(c, cx, 24, 6, 6, EMBER);
    if (p.flash) whiteFlash(c);
  });
}

function casterDeath(stage: number): ImageData {
  return draw(SPRITE_SIZE, SPRITE_SIZE, (c) => {
    // The robe collapses into an empty heap with a few embers left in it.
    const h = [30, 16, 7][stage];
    c.fillStyle = ROBE;
    c.beginPath();
    c.moveTo(18, 63);
    c.quadraticCurveTo(32, 63 - h * 2, 46, 63);
    c.closePath();
    c.fill();
    ellipse(c, 32, 63 - h, 5, 4, stage < 2 ? BONE_SHADE : ROBE_DARK);
    ellipse(c, 25, 60, 1.5, 1.5, EMBER);
    if (stage < 2) ellipse(c, 38, 58, 2, 2, EMBER);
  });
}

// ---- heavy: a hulking brute plated in bone ----

interface HeavyPose {
  stride: number;
  arms: 'down' | 'raise' | 'smash';
  flash?: boolean;
}

function heavy(p: HeavyPose): ImageData {
  return draw(SPRITE_SIZE, SPRITE_SIZE, (c) => {
    // Legs like pillars
    c.fillStyle = FLESH_DARK;
    c.fillRect(20 - p.stride * 2, 44, 9, 20);
    c.fillRect(35 + p.stride * 2, 44, 9, 20);
    // Torso
    ellipse(c, 32, 32, 20, 16, FLESH);
    // Bone plates across chest and shoulders
    ellipse(c, 14, 22, 8, 6, BONE);
    ellipse(c, 50, 22, 8, 6, BONE);
    for (let i = 0; i < 3; i++) {
      c.fillStyle = i % 2 ? BONE_SHADE : BONE;
      c.fillRect(22, 26 + i * 6, 20, 4);
    }
    // Small head sunk between the shoulders
    ellipse(c, 32, 15, 6, 6, BONE);
    c.fillStyle = EYE;
    c.fillRect(29, 14, 2, 2);
    c.fillRect(33, 14, 2, 2);
    // Fists
    const fists: [number, number][] =
      p.arms === 'down'
        ? [[8, 44 + p.stride * 2], [56, 44 - p.stride * 2]]
        : p.arms === 'raise'
          ? [[10, 6], [54, 6]]
          : [[22, 50], [42, 50]];
    for (const [fx, fy] of fists) {
      limb(c, [[fx < 32 ? 14 : 50, 24], [fx, fy]], 7, FLESH);
      ellipse(c, fx, fy, 6, 6, BONE_SHADE);
    }
    if (p.flash) whiteFlash(c);
  });
}

function heavyDeath(stage: number): ImageData {
  return draw(SPRITE_SIZE, SPRITE_SIZE, (c) => {
    ellipse(c, 32, 61, 10 + stage * 8, 2 + stage, '#5e1510');
    const h = [26, 14, 8][stage];
    ellipse(c, 32, 63 - h / 2, 22, h / 2, FLESH);
    ellipse(c, 14, 62 - h, 7, 5, BONE);
    ellipse(c, 50, 62 - h, 7, 5, BONE);
    ellipse(c, 32, 62 - h, 5, 4, BONE_SHADE);
  });
}

function whiteFlash(c: Ctx) {
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.fillRect(0, 0, 64, 64);
  c.globalCompositeOperation = 'source-over';
}

// ---- projectiles ----

function emberBall(): ImageData {
  return draw(32, 32, (c) => {
    ellipse(c, 16, 16, 9, 9, '#b8321e');
    ellipse(c, 16, 16, 6, 6, EMBER);
    ellipse(c, 15, 15, 3, 3, EMBER_HOT);
  });
}

function lanceBolt(): ImageData {
  return draw(32, 32, (c) => {
    ellipse(c, 16, 16, 8, 8, '#3a6626');
    ellipse(c, 16, 16, 5, 5, '#9ccc4a');
    ellipse(c, 16, 16, 2, 2, EMBER_HOT);
  });
}

function puff(): ImageData {
  return draw(32, 32, (c) => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ellipse(c, 16 + Math.cos(a) * 7, 16 + Math.sin(a) * 7, 3, 3, i % 2 ? '#e0c060' : '#aa9e8c');
    }
    ellipse(c, 16, 16, 4, 4, '#ffffff');
  });
}

function pickup(fn: (c: Ctx) => void): ImageData {
  return draw(SPRITE_SIZE, SPRITE_SIZE, fn);
}

function healthVial(c: Ctx) {
  c.fillStyle = '#2a2622';
  c.fillRect(27, 42, 10, 4);
  ellipse(c, 32, 54, 9, 9, '#cbbfa8');
  ellipse(c, 32, 55, 7, 7, '#b8321e');
  ellipse(c, 29, 52, 2, 2, '#ffffff');
  c.fillStyle = '#7d4e2c';
  c.fillRect(28, 39, 8, 4);
}

function armorVest(c: Ctx) {
  c.fillStyle = '#36465e';
  c.beginPath();
  c.moveTo(20, 42);
  c.lineTo(28, 40);
  c.lineTo(32, 44);
  c.lineTo(36, 40);
  c.lineTo(44, 42);
  c.lineTo(42, 63);
  c.lineTo(22, 63);
  c.closePath();
  c.fill();
  c.fillStyle = '#7489a3';
  c.fillRect(24, 48, 16, 3);
  c.fillRect(24, 55, 16, 3);
  c.fillStyle = '#5f9a38';
  c.fillRect(30, 46, 4, 14);
}

function ammoBox(c: Ctx) {
  c.fillStyle = '#3a6626';
  c.fillRect(20, 50, 24, 13);
  c.fillStyle = '#23401a';
  c.fillRect(20, 50, 24, 3);
  for (let i = 0; i < 4; i++) {
    c.fillStyle = '#b98447';
    c.fillRect(23 + i * 5, 44, 3, 7);
    c.fillStyle = '#e0c060';
    c.fillRect(23 + i * 5, 43, 3, 2);
  }
}

function shellBox(c: Ctx) {
  c.fillStyle = '#5e1510';
  c.fillRect(20, 50, 24, 13);
  c.fillStyle = '#3a0c0a';
  c.fillRect(20, 50, 24, 3);
  for (let i = 0; i < 4; i++) {
    c.fillStyle = '#b8321e';
    c.fillRect(22 + i * 6, 42, 4, 9);
    c.fillStyle = '#b98447';
    c.fillRect(22 + i * 6, 49, 4, 2);
  }
}

function cellPack(c: Ctx) {
  c.fillStyle = '#232d40';
  c.fillRect(22, 46, 20, 17);
  c.fillStyle = '#9ccc4a';
  c.fillRect(25, 49, 14, 4);
  c.fillRect(25, 56, 14, 4);
  c.fillStyle = '#7489a3';
  c.fillRect(28, 43, 8, 3);
}

function shotgunPickup(c: Ctx) {
  c.fillStyle = '#7d4e2c';
  c.fillRect(10, 54, 16, 5);
  c.fillStyle = '#232d40';
  c.fillRect(24, 53, 30, 3);
  c.fillRect(24, 57, 30, 2);
  c.fillStyle = '#52657e';
  c.fillRect(30, 52, 8, 8);
}

function lancePickup(c: Ctx) {
  limb(c, [[12, 58], [52, 50]], 3, '#b98447');
  limb(c, [[12, 58], [52, 50]], 1, '#e0c060');
  ellipse(c, 54, 49, 5, 5, '#3a6626');
  ellipse(c, 54, 49, 3, 3, '#9ccc4a');
}

function keycard(color: string, light: string) {
  return (c: Ctx) => {
    c.fillStyle = '#1a1714';
    c.fillRect(24, 44, 16, 19);
    c.fillStyle = color;
    c.fillRect(25, 45, 14, 17);
    c.fillStyle = light;
    c.fillRect(27, 47, 10, 4);
    c.fillStyle = '#cbbfa8';
    c.fillRect(27, 55, 10, 2);
  };
}

/** The pistol in the player's right hand, 96x72. Frame 1 has the muzzle flash. */
function pistol(firing: boolean): ImageData {
  return draw(96, 72, (c) => {
    if (firing) {
      ellipse(c, 48, 14, 12, 10, '#e0c060');
      ellipse(c, 48, 15, 7, 6, '#ffffff');
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        limb(c, [[48, 15], [48 + Math.cos(a) * 16, 15 + Math.sin(a) * 13]], 2, '#e0c060');
      }
    }
    // Hand and sleeve
    c.fillStyle = '#45291a';
    c.beginPath();
    c.moveTo(40, 72);
    c.lineTo(46, 52);
    c.lineTo(66, 50);
    c.lineTo(74, 72);
    c.closePath();
    c.fill();
    ellipse(c, 56, 50, 11, 8, '#9a6638');
    ellipse(c, 52, 46, 6, 4, '#b98447');
    // Grip of bone, slide of dark steel
    c.fillStyle = '#aa9e8c';
    c.fillRect(48, 36, 12, 14);
    c.fillStyle = '#232d40';
    c.fillRect(42, 22, 24, 16);
    c.fillStyle = '#36465e';
    c.fillRect(42, 22, 24, 4);
    c.fillStyle = '#141a26';
    c.fillRect(50, 20, 8, 4);
    c.fillStyle = '#0a0908';
    c.fillRect(52, 21, 4, 3);
    // Sights
    c.fillStyle = '#7489a3';
    c.fillRect(44, 20, 2, 3);
    c.fillRect(62, 20, 2, 3);
  });
}

function grave(state: 'full' | 'relic' | 'looted'): ImageData {
  return draw(SPRITE_SIZE, SPRITE_SIZE, (c) => {
    // Disturbed earth
    ellipse(c, 32, 61, 18, 4, state === 'looted' ? '#2b1a10' : '#45291a');
    if (state === 'looted') {
      // Dug up: a dark pit and the stone knocked over.
      ellipse(c, 30, 61, 11, 3, '#0a0908');
      c.save();
      c.translate(44, 58);
      c.rotate(1.2);
      c.fillStyle = '#554e46';
      c.fillRect(-6, -10, 12, 16);
      c.restore();
      limb(c, [[16, 60], [24, 58]], 2, BONE_SHADE);
      return;
    }
    // Headstone
    c.fillStyle = '#6f665b';
    c.beginPath();
    c.moveTo(22, 60);
    c.lineTo(22, 36);
    c.quadraticCurveTo(32, 26, 42, 36);
    c.lineTo(42, 60);
    c.closePath();
    c.fill();
    c.fillStyle = '#8c8173';
    c.fillRect(23, 37, 2, 22);
    c.fillStyle = '#3d3833';
    c.fillRect(30, 38, 4, 14);
    c.fillRect(27, 42, 10, 3);
    limb(c, [[38, 44], [35, 50], [39, 56]], 1, '#3d3833');
    // Skull at its foot
    ellipse(c, 17, 58, 5, 4, BONE);
    ellipse(c, 15, 58, 1.3, 1.3, '#0a0908');
    ellipse(c, 19, 58, 1.3, 1.3, '#0a0908');
    if (state === 'relic') {
      // The relic it holds, glinting above.
      c.fillStyle = '#e0c060';
      c.beginPath();
      c.moveTo(32, 12);
      c.lineTo(37, 18);
      c.lineTo(32, 24);
      c.lineTo(27, 18);
      c.closePath();
      c.fill();
      c.fillStyle = '#ffffff';
      c.fillRect(31, 15, 2, 2);
    }
  });
}

/** Shotgun, 96x72: heavy twin barrels held low. Frame 1 fires. */
function shotgunView(firing: boolean): ImageData {
  return draw(96, 72, (c) => {
    if (firing) {
      ellipse(c, 48, 10, 18, 12, '#e0c060');
      ellipse(c, 48, 11, 10, 7, '#ffffff');
    }
    c.fillStyle = '#45291a';
    c.beginPath();
    c.moveTo(30, 72);
    c.lineTo(38, 50);
    c.lineTo(60, 50);
    c.lineTo(70, 72);
    c.closePath();
    c.fill();
    ellipse(c, 49, 52, 13, 7, '#9a6638');
    // Stock and pump
    c.fillStyle = '#7d4e2c';
    c.fillRect(40, 38, 18, 14);
    c.fillStyle = '#613a22';
    c.fillRect(40, 38, 18, 3);
    // Barrels
    c.fillStyle = '#232d40';
    c.fillRect(40, 16, 8, 24);
    c.fillRect(50, 16, 8, 24);
    c.fillStyle = '#36465e';
    c.fillRect(40, 16, 2, 24);
    c.fillRect(50, 16, 2, 24);
    c.fillStyle = '#0a0908';
    c.fillRect(42, 15, 4, 3);
    c.fillRect(52, 15, 4, 3);
  });
}

/** Ember Lance, 96x72: a brass rod with a green crystal tip. Frame 1 fires. */
function lanceView(firing: boolean): ImageData {
  return draw(96, 72, (c) => {
    c.fillStyle = '#45291a';
    c.beginPath();
    c.moveTo(44, 72);
    c.lineTo(50, 54);
    c.lineTo(68, 54);
    c.lineTo(76, 72);
    c.closePath();
    c.fill();
    ellipse(c, 59, 55, 10, 6, '#9a6638');
    limb(c, [[60, 64], [50, 18]], 7, '#9a6638');
    limb(c, [[60, 64], [50, 18]], 3, '#e0c060');
    for (let i = 0; i < 3; i++) ellipse(c, 57 - i * 2.5, 50 - i * 10, 4, 2, '#7d4e2c');
    ellipse(c, 49, 14, firing ? 10 : 7, firing ? 10 : 8, '#3a6626');
    ellipse(c, 49, 14, firing ? 7 : 4, firing ? 7 : 5, '#9ccc4a');
    if (firing) ellipse(c, 49, 14, 3, 3, '#ffffff');
  });
}

export interface SpriteSet {
  rusher: Record<string, ImageData>;
  caster: Record<string, ImageData>;
  heavy: Record<string, ImageData>;
  pickups: Record<string, ImageData>;
  graves: Record<string, ImageData>;
  projectiles: Record<string, ImageData>;
  /** Per weapon index: [idle, firing]. */
  weapons: ImageData[][];
}

export function paintSprites(): SpriteSet {
  return {
    rusher: {
      walk1: rusher({ lean: 0, stride: 1, arms: 'down', mouth: false }),
      walk2: rusher({ lean: 1, stride: -1, arms: 'down', mouth: false }),
      attack1: rusher({ lean: -1, stride: 0, arms: 'raise', mouth: true }),
      attack2: rusher({ lean: 2, stride: 1, arms: 'slash', mouth: true }),
      pain: rusher({ lean: -3, stride: 0, arms: 'down', mouth: true, flash: true }),
      die1: rusherDeath(0),
      die2: rusherDeath(1),
      corpse: rusherDeath(2),
    },
    caster: {
      walk1: caster({ sway: -1, hands: 'low' }),
      walk2: caster({ sway: 1, hands: 'low' }),
      attack1: caster({ sway: 0, hands: 'raise' }),
      attack2: caster({ sway: 0, hands: 'throw' }),
      pain: caster({ sway: -2, hands: 'low', flash: true }),
      die1: casterDeath(0),
      die2: casterDeath(1),
      corpse: casterDeath(2),
    },
    heavy: {
      walk1: heavy({ stride: 1, arms: 'down' }),
      walk2: heavy({ stride: -1, arms: 'down' }),
      attack1: heavy({ stride: 0, arms: 'raise' }),
      attack2: heavy({ stride: 0, arms: 'smash' }),
      pain: heavy({ stride: 0, arms: 'down', flash: true }),
      die1: heavyDeath(0),
      die2: heavyDeath(1),
      corpse: heavyDeath(2),
    },
    projectiles: { ember: emberBall(), bolt: lanceBolt(), puff: puff() },
    pickups: {
      shells: pickup(shellBox),
      cells: pickup(cellPack),
      shotgun: pickup(shotgunPickup),
      lance: pickup(lancePickup),
      health: pickup(healthVial),
      armor: pickup(armorVest),
      ammo: pickup(ammoBox),
      key_red: pickup(keycard('#b8321e', '#e0c060')),
      key_blue: pickup(keycard('#36465e', '#7489a3')),
    },
    graves: { full: grave('full'), relic: grave('relic'), looted: grave('looted') },
    weapons: [
      [pistol(false), pistol(true)],
      [shotgunView(false), shotgunView(true)],
      [lanceView(false), lanceView(true)],
    ],
  };
}
