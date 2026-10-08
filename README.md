# Ossuary

**A Doom 64-style browser FPS where every death becomes a grave on Avalanche.**

Everyone descends the same level each day. When you die, a grave is written on-chain at the tile where you fell, with your epitaph and the relic you carried. The next player sees your headstone in the world and can loot it. By evening the map is littered with other people's failures, and that shared, growing record of deaths is the game.

Players log in with an email. They never hold AVAX, install a wallet or see a signing prompt: every write is an ERC-4337 UserOperation sponsored through SmoothSend.

**Play it:** https://ossuarydoom64.vercel.app · leaderboard: https://ossuarydoom64.vercel.app/leaderboard

Built for **Team1 India Speedrun: Build Anything on Avalanche**. All code, levels, art and sound are original. No id Software assets are used.

## What's on-chain (Avalanche Fuji)

| Contract | Address | |
| --- | --- | --- |
| OssuaryGame | `0x2e8c113ff52cc3bbb9748f64c589cf1a0a55b65f` | [Snowtrace](https://testnet.snowtrace.io/address/0x2e8c113ff52cc3bbb9748f64c589cf1a0a55b65f) · [source](https://sourcify.dev/server/repo-ui/43113/0x2e8c113ff52cc3bbb9748f64c589cf1a0a55b65f) |
| Relics (ERC-1155) | `0x61393d01bc79756ff3dcc63c380e717d6acc1e9d` | [Snowtrace](https://testnet.snowtrace.io/address/0x61393d01bc79756ff3dcc63c380e717d6acc1e9d) · [source](https://sourcify.dev/server/repo-ui/43113/0x61393d01bc79756ff3dcc63c380e717d6acc1e9d) |

Also deployed on **Avalanche C-Chain mainnet**, with verified source:

| Contract | Address | |
| --- | --- | --- |
| OssuaryGame | `0xbb760a0bbcf4f2c68894ec96c667547a84818b12` | [Snowtrace](https://snowtrace.io/address/0xbb760a0bbcf4f2c68894ec96c667547a84818b12) · [source](https://sourcify.dev/server/repo-ui/43114/0xbb760a0bbcf4f2c68894ec96c667547a84818b12) |
| Relics (ERC-1155) | `0x6c56140d5a99d20a4b42953f48f2114f52ed25e2` | [Snowtrace](https://snowtrace.io/address/0x6c56140d5a99d20a4b42953f48f2114f52ed25e2) · [source](https://sourcify.dev/server/repo-ui/43114/0x6c56140d5a99d20a4b42953f48f2114f52ed25e2) |

The contracts track:
- **runs:** who, which day, open or closed
- **graves:** player, day, tile, 32-byte epitaph, buried relic, looted flag
- **best time per player per day**
- **relics:** six types; minted on finishing or looting, burned into your grave when you die carrying one

Every death and finish must carry a signature from the verifier, which replays the run before it signs.

How a sponsored write works end to end, with real Fuji transactions decoded step by step: **[docs/TRANSACTIONS.md](docs/TRANSACTIONS.md)**.

## The game

- **The Charnel Descent:** a hand-built level of eight connected areas (crypt, bone hall, slime cistern, red-key vault, furnace, chapel, exit sigil and the corridors between) behind red and blue keycard doors. The day's seed fills optional slots with different enemies and pickups, so each day plays differently and everyone gets the same layout.
- **Three weapons:** pistol, shotgun (seven pellets) and the Ember Lance (projectiles). **Three enemies:** the rusher (melee), the caster (throws embers, keeps its distance, holds ledges) and the heavy (slow, 320 hp).
- **Relics** carried into a run change it: 125 health, faster firing, faster movement, +30% damage, quieter footsteps, or bone armour. Die carrying one and it stays in your grave for someone else.
- **The Doom 64 look:** the scene renders at 270 lines tall with nearest-neighbour upscaling, 4×4 ordered dither down to 5 bits per channel, coloured sector lighting baked into vertex colours with gradients between sectors, and fog to black. All textures and sprites are painted in code and snapped to one 32-colour palette.
- **Sound** is synthesised with Web Audio at runtime and positioned around you. There are no audio files.

## How it fits together

```
browser                                          Avalanche Fuji
┌──────────────────────────────┐                 ┌───────────────────────────┐
│ Three.js renderer            │                 │ EntryPoint v0.7           │
│ @ossuary/sim (60 Hz, fixed   │  UserOperation  │   └ SimpleAccount (you)   │
│   point, deterministic)      │ ──SmoothSend──▶ │       └ OssuaryGame       │
│ ChainLayer (serial queue)    │  bundler +      │             └ Relics      │
│ Privy embedded wallet        │  paymaster      └───────────────────────────┘
└──────────────┬───────────────┘                              ▲
               │ input log                                    │ reads runs, relics
               ▼                                              │
        ┌──────────────────────┐   EIP-712 signature          │
        │ verifier (Hono)      │ ─────────────────────────────┘
        │ replays @ossuary/sim │
        └──────────────────────┘
```

The game engine knows nothing about wallets. It emits events, and the chain layer turns them into sponsored operations, one at a time, ordered by the smart account's nonce. On death, the client posts its input log to the verifier. The verifier replays it through the same simulation code with the day as the seed and the carried relic applied. It then signs the tile where the replay died, so the client's claims are never trusted.

## Load test (disclosed)

To show the gasless pipeline holding up at volume, we ran an automated load test on Avalanche C-Chain mainnet on 2026-10-08. A pool of 30 bot wallets played The Charnel Descent with the built-in bot (`packages/sim/src/bot.ts`), making **401 transactions**:

| Action | Count |
| --- | --- |
| `startRun` | 214 |
| `recordDeath` | 183 |
| `finishRun` | 4 escapes, each minting a relic |

Every result was replayed and signed by the same verifier that checks human players. Every operation was sponsored through SmoothSend, so the bot wallets never held AVAX.

The bots are labelled, not disguised as players:
- their epitaphs read `[load test]`;
- their smart-account addresses are published in [`apps/client/chain/loadTestWallets.json`](apps/client/chain/loadTestWallets.json);
- the leaderboard leaves them out of the ranking unless a viewer chooses "show bots".

Script: [`apps/verifier/scripts/load-test.ts`](apps/verifier/scripts/load-test.ts).

## Repository

```
packages/sim/        deterministic simulation: fixed point, Taylor-built sine table, seeded PRNG,
                     level format, weapons, enemies, relics, replay, input log encoding
packages/contracts/  Hardhat 3: OssuaryGame.sol, Relics.sol, tests, deploy and verify scripts
apps/client/         Next.js shell, Three.js renderer, Privy + SmoothSend chain layer, leaderboard
apps/verifier/       Hono service: replay the input log, sign Death / Finish (EIP-712)
docs/                transactions walk-through, deployment, submission text
```

## Run it locally

```bash
pnpm install
cp apps/client/.env.example apps/client/.env.local          # fill in Privy + SmoothSend keys
cp apps/verifier/.env.example apps/verifier/.env            # optional; locally it reads packages/contracts/.env
pnpm --filter @ossuary/verifier start                       # replay-and-sign service on :8787
pnpm dev                                                    # http://localhost:3000/play
```

**Controls:**
- WASD to move, mouse to look, click to fire
- E to open doors
- 1 / 2 / 3, Q or the mouse wheel to switch weapons
- Esc to release the mouse, R to descend again

### Tests

```bash
pnpm --filter @ossuary/sim test          # 36 tests: determinism, replay, weapons, enemies, relics, level solvability, a bot that escapes
pnpm --filter @ossuary/verifier test     # 9 tests: replay-derived tiles, relic checks, wrong-day logs, rules fingerprint
pnpm --filter @ossuary/contracts test    # 7 tests: full loop, tampering, replayed signatures, guards
pnpm --filter @ossuary/verifier e2e      # live: start -> die -> verify -> recordDeath on Fuji
pnpm --filter @ossuary/verifier e2e:loot # live, two players: escape -> die carrying the relic -> other player loots it
```

Useful scripts:
- `pnpm --filter @ossuary/verifier state`: prints runs and graves on Fuji
- `pnpm --filter @ossuary/verifier events`: prints the full event history

Deploying the client, the verifier and mainnet: **[docs/DEPLOY.md](docs/DEPLOY.md)**.

## Reusable: a gasless game kit

`packages/sim` (the replay and input-log pieces), `apps/client/chain/ChainLayer.ts` (the sponsored write queue) and `apps/verifier` together form a template for any deterministic browser game whose results should be provable on Avalanche without players paying gas. See [packages/sim/README.md](packages/sim/README.md). MIT licensed.

## Built with

TypeScript, Next.js 16, Three.js, Privy embedded wallets, SmoothSend (`@smoothsend/sdk/avax`, developer-sponsored ERC-4337), viem, Hardhat 3, OpenZeppelin 5 (ERC-1155, EIP-712, ECDSA), Hono, Vitest.
