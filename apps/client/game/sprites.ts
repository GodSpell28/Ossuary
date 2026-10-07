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

export interface SpriteSet {
  rusher: Record<string, ImageData>;
  pickups: Record<string, ImageData>;
  pistol: ImageData[];
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
    pickups: {
      health: pickup(healthVial),
      armor: pickup(armorVest),
      ammo: pickup(ammoBox),
      key_red: pickup(keycard('#b8321e', '#e0c060')),
      key_blue: pickup(keycard('#36465e', '#7489a3')),
    },
    pistol: [pistol(false), pistol(true)],
  };
}
