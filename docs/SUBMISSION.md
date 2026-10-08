# Builder Hub submission: copy and paste

Fields in the order the event page lists them. Items marked **TODO** need something only you can produce: the live URL, the video link and the slides link.

## Project name

Ossuary

## One-line description

A Doom 64-style browser FPS where every death becomes a grave on Avalanche, for the next player to find and loot.

## Full description

**What it does.** Ossuary is a retro first-person shooter that runs in the browser. Everyone plays the same hand-built level each day; the day's seed decides which enemies and pickups fill its optional slots. When you die, a grave is written to Avalanche at the exact tile where you fell, holding your epitaph and any relic you carried. Other players see your headstone in the world, read your last words as they pass, and can loot your relic. Reach the exit and your verified time goes on the daily leaderboard, and a relic is minted to you. Relics change your next run: more health, faster firing, quieter footsteps and so on. Die with one and it's buried with you.

**Who it's for.** Players who like short, hard, replayable runs, and who would never install a wallet to play a game. Login is an email. Players never hold AVAX and never see a signing prompt.

**What problem it solves.** On-chain games usually lose players at the wallet popup, and their on-chain state is usually a leaderboard bolted on afterwards. In Ossuary the chain holds the part of the game that has to be shared and permanent: other players' deaths. A grave can't be forged, deleted or moved by any player or by the game's own server. Results can't be faked either: a verifier replays every run from its inputs before anything is written.

## Tech stack (Avalanche-specific parts in bold)

- **Avalanche C-Chain: the live game runs on Fuji; the contracts are also deployed and verified on mainnet.** Two contracts: `OssuaryGame` (runs, graves, loot, best times) and `Relics` (ERC-1155 that only the game contract can mint or burn).
- **Gasless play via ERC-4337 on C-Chain through SmoothSend** (`@smoothsend/sdk/avax`, developer-sponsored mode). Each player gets a SimpleAccount owned by their Privy embedded wallet. Every game write is a sponsored UserOperation. Fuji's fast finality means a grave written on death is visible to others within seconds.
- **EIP-712 verifier signatures bound to the chain ID and contract.** A Hono service replays the input log through the same deterministic simulation the browser ran, then signs the death tile, or the finish time and kill count, taken from the replay.
- Privy (email login, embedded wallets with wallet UIs disabled), viem, Hardhat 3, OpenZeppelin 5.
- Game: TypeScript, Next.js 16, Three.js with a custom low-resolution pipeline. The simulation is deterministic: 60 Hz, fixed point, a seeded PRNG and a Taylor-built trig table. Sound is synthesised with Web Audio.

## Live link

https://ossuarydoom64.vercel.app (leaderboard: https://ossuarydoom64.vercel.app/leaderboard)

Verifier: https://ossuaryverifier-production.up.railway.app

## Contracts (Avalanche mainnet)

- OssuaryGame: https://snowtrace.io/address/0xbb760a0bbcf4f2c68894ec96c667547a84818b12
- Relics: https://snowtrace.io/address/0x6c56140d5a99d20a4b42953f48f2114f52ed25e2
- Linked to each other and to the same verifier key, with source verified on Sourcify (chain 43114). Deployed for about 0.021 AVAX.

## Contracts (Fuji)

- OssuaryGame: https://testnet.snowtrace.io/address/0x2e8c113ff52cc3bbb9748f64c589cf1a0a55b65f
- Relics: https://testnet.snowtrace.io/address/0x61393d01bc79756ff3dcc63c380e717d6acc1e9d
- Both have verified source (Sourcify, also shown on Snowtrace).
- Example sponsored write, the first run started by a real player: https://testnet.snowtrace.io/tx/0x6bd35549c74f5a6aa7e29f9f3316651b435d3dc49744a6c60b3e2d5176abdcdc
- Example verified escape on the final level (1:29.9, 21/21 kills, Relic #1 minted): https://testnet.snowtrace.io/tx/0x2ae6c133c81088fe0dc8553080a759390bb88685dc192958e0041d740b760ee0
- The full loot flow:
  - one player dies carrying Relic #6, which goes into grave #7: https://testnet.snowtrace.io/tx/0xf0673c755768d123dd8fc1bbb86153031257007db0956d3c3cc64bf730570867
  - another player loots it: https://testnet.snowtrace.io/tx/0x8d51b4738852fb0b83b5ddfe66d886f6a6bf57f0b04ae320c2ccf2af1394d5f7

## GitHub

https://github.com/GodSpell28/Ossuary. Setup steps are in the README; the transaction walk-through is in `docs/TRANSACTIONS.md`.

## Slides

**TODO:** paste the slides link.

## Demo video (3 minutes or less)

**TODO:** upload and paste the link. Record with two browser profiles so the grave handoff happens in one take:

1. **0:00–0:20.** Log in with email. Say there's no wallet extension and no AVAX.
2. **0:20–1:10.** Play: show the lighting, a fight, and a grave left by someone else, with its epitaph.
3. **1:10–1:40.** Die on purpose, carve an epitaph, and show the toast. Open the transaction on Snowtrace.
4. **1:40–2:15.** Switch to the second profile, walk to that grave and loot the relic.
5. **2:15–2:40.** Finish a run and show the leaderboard.
6. **2:40–3:00.** Architecture slide: one sentence on SmoothSend sponsorship, one on the replay verifier.

## AI tools used

Claude Code (Anthropic, Claude Opus 5.5) was the main development tool, under my direction and review. It wrote most of:
- the simulation, renderer, contracts, verifier and chain integration
- the procedural textures, sprites and synthesised sound
- the tests
- the documentation

It also decoded on-chain transactions for the write-up. Design decisions, the build plan, the dashboards and accounts (Privy, SmoothSend, faucet funding) and playtesting were mine.
