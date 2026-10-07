# Ossuary

A Doom 64-style browser FPS where every player descends the same daily level and every death is written to Avalanche as a grave the next player can loot. Built for Team1 India Speedrun: Build Anything on Avalanche.

All code, levels, textures and audio are original. No id Software assets.

## Layout

```
packages/sim/        deterministic 60 Hz simulation (fixed point, LUT trig, seeded PRNG); shared by client and verifier
packages/contracts/  Hardhat 3: OssuaryGame.sol, Relics.sol, tests, deploy script
apps/client/         Next.js app shell, Three.js renderer, Privy + SmoothSend chain layer
apps/verifier/       Hono server that replays input logs and signs results
```

How the gasless transactions work, traced on Fuji: [docs/TRANSACTIONS.md](docs/TRANSACTIONS.md).

Fuji contracts: OssuaryGame `0x2e8c113ff52cc3bbb9748f64c589cf1a0a55b65f`, Relics `0x61393d01bc79756ff3dcc63c380e717d6acc1e9d`.

## Run

```bash
pnpm install
cp apps/client/.env.example apps/client/.env.local   # fill in keys
pnpm --filter @ossuary/verifier start               # replay-and-sign service on :8787
pnpm dev                                             # http://localhost:3000/play
pnpm test
```

Controls: WASD move, mouse look, click fire, E use, Esc release.
