# Ossuary

A Doom 64-style browser FPS where every player descends the same daily level and every death is written to Avalanche as a grave the next player can loot. Built for Team1 India Speedrun: Build Anything on Avalanche.

All code, levels, textures and audio are original. No id Software assets.

## Layout

```
packages/sim/        deterministic 60 Hz simulation (fixed point, LUT trig, seeded PRNG); shared by client and verifier
packages/contracts/  Foundry: OssuaryGame.sol, Relics.sol (not started)
apps/client/         Next.js app shell + Three.js renderer
apps/verifier/       Hono server that replays input logs and signs results (not started)
```

## Run

```bash
pnpm install
cp apps/client/.env.example apps/client/.env.local   # fill in keys
pnpm dev                                             # http://localhost:3000/play
pnpm test
```

Controls: WASD move, mouse look, click fire, E use, Esc release.
