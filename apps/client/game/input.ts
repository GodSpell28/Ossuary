import { ANGLES, BTN_FIRE, BTN_USE, MAX_TURN, type TickInput } from '@ossuary/sim';

// Collects keyboard and mouse state between ticks and turns it into one
// integer TickInput per sim tick. Mouse motion is quantised to angle units and
// the fractional remainder carried, so slow mouse movement is never lost.

const RADIANS_PER_PIXEL = 0.0022;
const ANGLE_PER_PIXEL = (RADIANS_PER_PIXEL * ANGLES) / (2 * Math.PI);
const KEY_TURN = 40;

export class InputCollector {
  private keys = new Set<string>();
  private mouseButtons = 0;
  private turnAccum = 0;
  private lookAccum = 0;
  /** Player has control: pointer locked, or the drag-to-look fallback. */
  locked = false;
  private fallback = false;
  private dragging = false;
  /** Cosmetic vertical look, radians. Not part of the simulation. */
  pitch = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
  }

  requestLock(): void {
    // Some embedded browsers refuse pointer lock. Then keyboard still works
    // and dragging with the mouse turns; Esc leaves the fallback mode.
    const enterFallback = () => {
      this.fallback = true;
      this.locked = true;
    };
    try {
      const p = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(enterFallback);
      else if (!this.canvas.requestPointerLock) enterFallback();
    } catch {
      enterFallback();
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** Builds the input for the next tick and consumes accumulated mouse turn. */
  sample(): TickInput {
    if (!this.locked) {
      this.turnAccum = 0;
      return { forward: 0, strafe: 0, turn: 0, buttons: 0 };
    }
    const k = this.keys;
    const forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const keyTurn = (k.has('ArrowRight') ? KEY_TURN : 0) - (k.has('ArrowLeft') ? KEY_TURN : 0);

    const whole = Math.trunc(this.turnAccum);
    this.turnAccum -= whole;
    const turn = Math.max(-MAX_TURN, Math.min(MAX_TURN, whole + keyTurn));

    let buttons = 0;
    if (this.mouseButtons & 1 || k.has('ControlLeft')) buttons |= BTN_FIRE;
    if (k.has('KeyE') || k.has('Space')) buttons |= BTN_USE;
    return { forward, strafe, turn, buttons };
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.fallback && e.code === 'Escape') {
      this.fallback = false;
      this.locked = false;
      this.onBlur();
      return;
    }
    if (!this.locked) return;
    this.keys.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
    this.mouseButtons = 0;
    this.dragging = false;
  };

  private onLockChange = () => {
    if (this.fallback) return;
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) this.onBlur();
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked || (this.fallback && !this.dragging)) return;
    this.turnAccum += e.movementX * ANGLE_PER_PIXEL;
    this.lookAccum = Math.max(-0.5, Math.min(0.5, this.lookAccum - e.movementY * RADIANS_PER_PIXEL));
    this.pitch = this.lookAccum;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.locked) {
      this.requestLock();
      return;
    }
    if (this.fallback) this.dragging = true;
    this.mouseButtons |= 1 << e.button;
  };

  private onMouseUp = (e: MouseEvent) => {
    this.mouseButtons &= ~(1 << e.button);
    if (!this.mouseButtons) this.dragging = false;
  };
}
