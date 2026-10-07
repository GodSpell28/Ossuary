import { ONE, angleToRadians, type SimEvent, type SimState } from '@ossuary/sim';

// Every sound is synthesised with Web Audio at play time: noise bursts,
// swept oscillators and filters, in the spirit of jsfxr. Nothing is loaded,
// so there is no audio asset to license. Positional sounds are attenuated by
// distance and panned by direction from the player.

type Voice = (ctx: AudioContext, out: AudioNode, t: number) => void;

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const len = ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private drone: { stop(): void } | null = null;
  private lastPlayed = new Map<string, number>();

  /** Must be called from a user gesture; browsers keep audio suspended until then. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this.startDrone();
    }
    void this.ctx.resume();
  }

  dispose(): void {
    this.drone?.stop();
    void this.ctx?.close();
    this.ctx = null;
  }

  /** Plays the sound for a sim event, placed relative to the player. */
  onEvent(e: SimEvent, s: SimState): void {
    const mobAt = (i: number) => s.mobs[i] && { x: s.mobs[i].x, y: s.mobs[i].y };
    switch (e.type) {
      case 'fire':
        return this.play(['pistol', 'shotgun', 'lance'][e.weapon]);
      case 'dryFire':
        return this.play('click');
      case 'switch':
        return this.play('switch');
      case 'mobWake':
        return this.play('growl', s, mobAt(e.mob));
      case 'mobAttack':
        return this.play(s.mobs[e.mob]?.kind === 'heavy' ? 'heave' : 'swish', s, mobAt(e.mob));
      case 'mobFire':
        return this.play('whoosh', s, mobAt(e.mob));
      case 'mobDeath':
        return this.play(s.mobs[e.mob]?.kind === 'heavy' ? 'collapse' : 'squelch', s, mobAt(e.mob));
      case 'hitMob':
        return this.play('thwack', s, mobAt(e.mob));
      case 'projectileHit':
        return this.play('burst', s, { x: e.x, y: e.y });
      case 'hurt':
        return this.play('oof');
      case 'death':
        return this.play('fall');
      case 'pickup':
        return this.play(e.kind.startsWith('key') ? 'key' : e.kind === 'shotgun' || e.kind === 'lance' ? 'weapon' : 'blip');
      case 'door':
        return this.play(e.opening ? 'doorOpen' : 'doorClose');
      case 'locked':
        return this.play('buzz');
      case 'exit':
        return this.play('escape');
    }
  }

  private play(name: string, s?: SimState, at?: { x: number; y: number }): void {
    const ctx = this.ctx;
    const voice = VOICES[name];
    if (!ctx || !this.master || !voice || ctx.state !== 'running') return;
    // Many mobs waking on one shot would stack into a roar; space them out.
    const now = ctx.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -1) < 0.04) return;
    this.lastPlayed.set(name, now);

    let out: AudioNode = this.master;
    if (s && at) {
      const p = s.player;
      const dx = (at.x - p.x) / ONE;
      const dy = (at.y - p.y) / ONE;
      const dist = Math.hypot(dx, dy);
      if (dist > 24) return;
      const gain = ctx.createGain();
      gain.gain.value = 1 / (1 + dist / 4);
      const pan = ctx.createStereoPanner();
      // Angle of the source relative to facing; positive is to the right.
      const rel = Math.atan2(dy, dx) - angleToRadians(p.angle);
      pan.pan.value = Math.max(-1, Math.min(1, Math.sin(rel)));
      gain.connect(pan).connect(this.master);
      out = gain;
    }
    voice(ctx, out, now);
  }

  private startDrone(): void {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    const gain = ctx.createGain();
    gain.gain.value = 0.07;
    filter.connect(gain).connect(this.master!);
    const oscs = [55, 55.6, 82.4].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = f;
      o.connect(filter);
      o.start();
      return o;
    });
    // A slow breath on the filter.
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 0.07;
    depth.gain.value = 90;
    lfo.connect(depth).connect(filter.frequency);
    lfo.start();
    this.drone = { stop: () => [...oscs, lfo].forEach((o) => o.stop()) };
  }
}

// ---- voices ----

let sharedNoise: AudioBuffer | null = null;
function noise(ctx: AudioContext, out: AudioNode, t: number, dur: number, opts: { lp?: number; hp?: number; gain: number; lpEnd?: number }) {
  if (!sharedNoise || sharedNoise.sampleRate !== ctx.sampleRate) sharedNoise = noiseBuffer(ctx);
  const src = ctx.createBufferSource();
  src.buffer = sharedNoise;
  let node: AudioNode = src;
  if (opts.lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(opts.lp, t);
    if (opts.lpEnd) f.frequency.exponentialRampToValueAtTime(opts.lpEnd, t + dur);
    node.connect(f);
    node = f;
  }
  if (opts.hp) {
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = opts.hp;
    node.connect(f);
    node = f;
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(opts.gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  node.connect(g).connect(out);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

function tone(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  dur: number,
  opts: { type: OscillatorType; from: number; to: number; gain: number; delay?: number },
) {
  const start = t + (opts.delay ?? 0);
  const o = ctx.createOscillator();
  o.type = opts.type;
  o.frequency.setValueAtTime(opts.from, start);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), start + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(opts.gain, start);
  g.gain.exponentialRampToValueAtTime(0.001, start + dur);
  o.connect(g).connect(out);
  o.start(start);
  o.stop(start + dur + 0.02);
}

const VOICES: Record<string, Voice> = {
  pistol: (c, o, t) => {
    noise(c, o, t, 0.16, { lp: 3000, lpEnd: 400, gain: 0.7 });
    tone(c, o, t, 0.1, { type: 'square', from: 180, to: 50, gain: 0.3 });
  },
  shotgun: (c, o, t) => {
    noise(c, o, t, 0.45, { lp: 2400, lpEnd: 120, gain: 1 });
    tone(c, o, t, 0.25, { type: 'sawtooth', from: 120, to: 30, gain: 0.45 });
    // The pump, a beat later.
    tone(c, o, t, 0.06, { type: 'square', from: 300, to: 200, gain: 0.12, delay: 0.42 });
  },
  lance: (c, o, t) => {
    tone(c, o, t, 0.14, { type: 'square', from: 300, to: 1400, gain: 0.18 });
    tone(c, o, t, 0.1, { type: 'sine', from: 900, to: 200, gain: 0.15 });
  },
  click: (c, o, t) => tone(c, o, t, 0.03, { type: 'square', from: 1200, to: 900, gain: 0.15 }),
  switch: (c, o, t) => {
    tone(c, o, t, 0.04, { type: 'square', from: 500, to: 300, gain: 0.1 });
    tone(c, o, t, 0.04, { type: 'square', from: 700, to: 500, gain: 0.1, delay: 0.08 });
  },
  growl: (c, o, t) => {
    tone(c, o, t, 0.5, { type: 'sawtooth', from: 90, to: 55, gain: 0.35 });
    noise(c, o, t, 0.45, { lp: 500, gain: 0.25 });
  },
  swish: (c, o, t) => noise(c, o, t, 0.2, { hp: 1500, lp: 6000, lpEnd: 1200, gain: 0.4 }),
  heave: (c, o, t) => {
    tone(c, o, t, 0.6, { type: 'sawtooth', from: 70, to: 40, gain: 0.5 });
    noise(c, o, t, 0.5, { lp: 300, gain: 0.4 });
  },
  whoosh: (c, o, t) => {
    noise(c, o, t, 0.35, { lp: 900, lpEnd: 3000, gain: 0.35 });
    tone(c, o, t, 0.3, { type: 'triangle', from: 200, to: 500, gain: 0.12 });
  },
  burst: (c, o, t) => {
    noise(c, o, t, 0.3, { lp: 1600, lpEnd: 150, gain: 0.5 });
    tone(c, o, t, 0.15, { type: 'square', from: 140, to: 40, gain: 0.2 });
  },
  thwack: (c, o, t) => noise(c, o, t, 0.08, { lp: 1200, gain: 0.35 }),
  squelch: (c, o, t) => {
    tone(c, o, t, 0.45, { type: 'sawtooth', from: 160, to: 40, gain: 0.35 });
    noise(c, o, t, 0.4, { lp: 700, lpEnd: 100, gain: 0.35 });
  },
  collapse: (c, o, t) => {
    tone(c, o, t, 1.1, { type: 'sawtooth', from: 90, to: 25, gain: 0.5 });
    noise(c, o, t, 1, { lp: 400, lpEnd: 60, gain: 0.6 });
  },
  oof: (c, o, t) => tone(c, o, t, 0.18, { type: 'square', from: 220, to: 90, gain: 0.3 }),
  fall: (c, o, t) => {
    tone(c, o, t, 1.4, { type: 'sawtooth', from: 200, to: 30, gain: 0.4 });
    noise(c, o, t, 1.2, { lp: 800, lpEnd: 80, gain: 0.3 });
  },
  blip: (c, o, t) => {
    tone(c, o, t, 0.07, { type: 'square', from: 660, to: 660, gain: 0.15 });
    tone(c, o, t, 0.09, { type: 'square', from: 990, to: 990, gain: 0.15, delay: 0.07 });
  },
  key: (c, o, t) =>
    [523, 659, 784, 1046].forEach((f, i) => tone(c, o, t, 0.12, { type: 'square', from: f, to: f, gain: 0.13, delay: i * 0.08 })),
  weapon: (c, o, t) => {
    tone(c, o, t, 0.08, { type: 'square', from: 330, to: 330, gain: 0.15 });
    tone(c, o, t, 0.25, { type: 'square', from: 440, to: 880, gain: 0.15, delay: 0.08 });
  },
  doorOpen: (c, o, t) => {
    noise(c, o, t, 0.7, { lp: 300, gain: 0.35 });
    tone(c, o, t, 0.7, { type: 'sawtooth', from: 45, to: 70, gain: 0.2 });
  },
  doorClose: (c, o, t) => {
    noise(c, o, t, 0.7, { lp: 300, gain: 0.3 });
    tone(c, o, t, 0.7, { type: 'sawtooth', from: 70, to: 40, gain: 0.2 });
  },
  buzz: (c, o, t) => tone(c, o, t, 0.3, { type: 'sawtooth', from: 110, to: 105, gain: 0.25 }),
  escape: (c, o, t) =>
    [262, 330, 392, 523, 659].forEach((f, i) =>
      tone(c, o, t, 0.9 - i * 0.1, { type: 'triangle', from: f, to: f, gain: 0.15, delay: i * 0.12 }),
    ),
};
