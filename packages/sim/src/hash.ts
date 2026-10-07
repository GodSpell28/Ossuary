// FNV-1a over 32-bit words. Used to compare simulation state between the
// client and the verifier.

export class Hasher {
  private h = 0x811c9dc5;

  int(v: number): this {
    v |= 0;
    for (let i = 0; i < 4; i++) {
      this.h ^= (v >>> (i * 8)) & 0xff;
      this.h = Math.imul(this.h, 0x01000193);
    }
    return this;
  }

  digest(): number {
    return this.h >>> 0;
  }
}

export function hex32(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}
