# @ossuary/sim — deterministic game simulation and replay

The game logic of Ossuary, written so that a server can replay a run from its inputs and get exactly the same result as the browser did. This is what makes signed, cheat-resistant results possible without trusting the client.

It doubles as a small kit for anyone building a provable browser game on Avalanche:

| Piece | Where | What it gives you |
| --- | --- | --- |
| Deterministic core | `src/fixed.ts`, `src/trig.ts`, `src/prng.ts` | 16.16 fixed point; a sine table built from a Taylor series using only `+ * /`, which IEEE 754 rounds identically everywhere; mulberry32 PRNG kept in state |
| Input log | `src/input.ts`, `src/replay.ts` | Each tick packs into one int32; logs are base64 without `Buffer` or `btoa`, so the same code runs in browsers and Node |
| Replay | `src/replay.ts` | `replay(level, seed, inputs, relic)`: the log must end exactly on the tick the run ended, or it counts as tampered |
| State hash | `src/hash.ts`, `hashSim` | FNV-1a over every field, for comparing client and server |
| Sponsored write queue | `apps/client/chain/ChainLayer.ts` | SmoothSend developer-sponsored UserOperations sent one at a time in nonce order, with signing, submitted and confirmed states |
| Verifier | `apps/verifier` | Reads the run on-chain, replays, signs EIP-712 with values taken from the replay |

## Rules that keep it deterministic

- No `Math.random`, `Date.now`, `performance.now` or `Math.sin` inside a step. `Math.sqrt` is allowed, because IEEE 754 requires correct rounding.
- Integers everywhere. Products stay under 2^53.
- Iterate arrays in index order, never `Map` or `Set` insertion order across hosts.
- Random rolls go through the state's PRNG, in a fixed order. Layout randomness uses a separate stream, so it doesn't shift gameplay rolls.
- The package has no DOM or Three.js imports (`tsconfig` uses `lib: ES2022`, `types: []`), so Node can run it headless.

## Tests

```bash
pnpm test
```

The tests cover:
- 20,000-tick random-input runs hashing identically
- packed log round-trips
- replay of a real death, and logs replayed under the wrong day or relic
- weapons, enemies and relics
- a solvability check that walks the level with step heights and key doors

MIT licensed.
