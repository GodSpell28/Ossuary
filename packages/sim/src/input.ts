// One TickInput per simulation tick. The client records them and the
// verifier replays them, so they pack into a single int32 each.

export const BTN_FIRE = 1;
export const BTN_USE = 2;
export const BTN_NEXT_WEAPON = 4;
export const BTN_PREV_WEAPON = 8;

export interface TickInput {
  /** -1 back, 0, 1 forward */
  forward: number;
  /** -1 left, 0, 1 right */
  strafe: number;
  /** Angle units this tick, clamped to +-MAX_TURN by the sim. */
  turn: number;
  buttons: number;
}

export const NO_INPUT: TickInput = { forward: 0, strafe: 0, turn: 0, buttons: 0 };

export function packInput(i: TickInput): number {
  return (
    ((i.turn & 0xffff) << 16) |
    ((i.buttons & 0xff) << 4) |
    (((i.strafe + 1) & 3) << 2) |
    ((i.forward + 1) & 3)
  );
}

export function unpackInput(v: number): TickInput {
  return {
    forward: (v & 3) - 1,
    strafe: ((v >> 2) & 3) - 1,
    buttons: (v >> 4) & 0xff,
    turn: v >> 16,
  };
}

/** Growable log of packed inputs for one run. */
export class InputLog {
  private buf = new Int32Array(60 * 60 * 10);
  length = 0;

  push(i: TickInput): void {
    if (this.length === this.buf.length) {
      const next = new Int32Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.length++] = packInput(i);
  }

  toArray(): Int32Array {
    return this.buf.slice(0, this.length);
  }
}
