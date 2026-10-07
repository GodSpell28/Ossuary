import { describe, expect, it } from 'vitest';
import { SIM_FINGERPRINT } from '../src';

describe('rules fingerprint', () => {
  it('is an 8-hex-digit hash, stable within a build', async () => {
    expect(SIM_FINGERPRINT).toMatch(/^[0-9a-f]{8}$/);
    const again = await import('../src/version');
    expect(again.SIM_FINGERPRINT).toBe(SIM_FINGERPRINT);
  });
});
