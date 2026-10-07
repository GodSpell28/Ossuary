// mulberry32. State is a single uint32 so it can live inside the sim state and
// be hashed and copied like any other field.

export function nextRandom(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Integer in [0, n). */
export function randomInt(state: { rng: number }, n: number): number {
  return nextRandom(state) % n;
}

/** A standalone generator for non-simulation uses such as texture noise. */
export function makeRng(seed: number): () => number {
  const s = { rng: seed >>> 0 };
  return () => nextRandom(s) / 4294967296;
}

/** Day number since the Unix epoch in UTC. The seed for the daily level. */
export function dayNumber(dateMs: number): number {
  return Math.floor(dateMs / 86_400_000);
}
