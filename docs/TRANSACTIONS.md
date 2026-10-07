# How Ossuary's transactions work

Players never hold AVAX, never install a wallet, and never see a signing prompt. Every game write is an ERC-4337 UserOperation that SmoothSend sponsors. This page traces real transactions on Fuji.

## The cast

| Who | Address (Fuji) | Role |
| --- | --- | --- |
| Player's embedded wallet | e.g. `0x27Fb…61A1` | Created by Privy at email login. Its key signs, nothing else. Holds no AVAX. |
| Player's smart account | e.g. `0x77E6…B57f` | A SimpleAccount owned by the embedded wallet. This is `msg.sender` in the game contract. |
| SimpleAccount factory | `0x5532…72f5` | Deploys the smart account on its first operation, at an address known in advance. |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | Canonical ERC-4337 contract. Checks signatures, charges the paymaster, runs the call. |
| SmoothSend bundler | `0x84c2…Fee1d` | Sends the real transaction and pays gas in AVAX. |
| SmoothSend paymaster | `0x3207…66d8` | Agrees to cover the gas. The project's credit balance pays it back. |
| OssuaryGame | [`0x2e8c…b65f`](https://testnet.snowtrace.io/address/0x2e8c113ff52cc3bbb9748f64c589cf1a0a55b65f) | Runs, graves, loot, best times. |
| Relics | [`0x6139…1e9d`](https://testnet.snowtrace.io/address/0x61393d01bc79756ff3dcc63c380e717d6acc1e9d) | ERC-1155 relics. Only the game contract can mint or burn them. |
| Verifier | `0x9dCE…2297` | Server key. It signs a death or finish only after replaying the run. |

## One write, step by step

This is the first `startRun` from the chain-test page, decoded with `apps/client/scripts/inspect-tx.mts`:
[`0x6bd3…dcdc`](https://testnet.snowtrace.io/tx/0x6bd35549c74f5a6aa7e29f9f3316651b435d3dc49744a6c60b3e2d5176abdcdc).

1. **The game encodes the call.** `ChainLayer` ABI-encodes `startRun(20733)`. The day number comes from the contract's `today()`.
2. **The SDK builds a UserOperation.** The operation contains the following fields:
   - `sender` is the smart account.
   - `nonce` is read from the EntryPoint.
   - `callData` is `account.execute(OssuaryGame, 0, startRun(20733))`.
   - `initCode` deploys the smart account, because this is its first operation.
3. **SmoothSend estimates gas and the paymaster signs.** The paymaster's address and its approval go into `paymasterAndData`. This is the "developer-sponsored" mode.
4. **The embedded wallet signs the operation's hash.** Privy signs inside its iframe with `showWalletUIs: false`, so no popup appears. That 65-byte signature is the only thing the player's key ever produces.
5. **The operation goes to the bundler.** SmoothSend returns a `userOpHash`, and the HUD toast switches to "bundler has it".
6. **The bundler sends a real transaction.** Its own wallet (`0x84c2…`) calls `EntryPoint.handleOps([op], beneficiary)` and pays the AVAX gas.
7. **Everything runs on-chain inside that one transaction:**
   - The EntryPoint deploys the account. Event: `AccountDeployed`.
   - It checks the owner's signature and the paymaster's approval.
   - It calls `account.execute`, which calls `OssuaryGame.startRun`. Event: `RunStarted(runId=2, player=0x77E6…, day=20733)`.
   - It charges the paymaster. Event: `UserOperationEvent(success=true, actualGasCost, actualGasUsed=415844)`.
8. **The client polls `eth_getUserOperationReceipt`** every 250 ms and gets the transaction hash for the Snowtrace link.

Fuji's base fee was 160 wei per gas at the time, so the whole operation cost about 6.7e-11 AVAX. On mainnet SmoothSend charges whichever is larger: 1.5× the gas cost or $0.01 per sponsored operation.

## Why `msg.sender` is the smart account

The contract sees the smart account, not the email wallet. All player state is keyed by `msg.sender`, never `tx.origin`; `tx.origin` would be the bundler. The verifier signs over the smart-account address too.

## A death

Verified end to end on Fuji with `apps/verifier/scripts/e2e-death.ts`, run 3:

| Step | Where | Time |
| --- | --- | --- |
| `startRun(20733)` as above | UserOp → Fuji | 8–13 s, in the background |
| The player dies; the sim emits `death` | browser | instant |
| `POST /verify/death` with the run ID, smart account and the base64 input log | verifier | ~0.3 s |
| The verifier reads `runs(runId)` on-chain: right player, run still open, which day | Fuji RPC | |
| It replays every input through `@ossuary/sim` with the day as the seed. The log must end exactly on the death tick | verifier | |
| It signs EIP-712 `Death(runId, player, tile, epitaph, relicId)`. The tile comes from the replay, not the client | verifier | |
| `recordDeath(runId, tile, epitaph, relicId, sig)` as a sponsored UserOp | UserOp → Fuji | ~9 s, in the background |
| The contract checks the signature against the stored `verifier`, closes the run, and burns any carried relic into the grave. Event: `GraveDug` | Fuji | |
| Every client reads `gravesOf(today)` and draws the grave at that tile | all players | polled every 20 s |

The signature is bound to the run ID, the player, the chain ID and the game contract address, which the EIP-712 domain covers. That means it can't be replayed for another run, by another player, or on another network. The contract tests check each of those cases.

## A finish and a loot

- **Finish:** `POST /verify/finish`. The replay must end exactly on the exit tick. The verifier signs `Finish(runId, player, timeMs, kills, replayHash)`, where the time and kills are from the replay. `finishRun` updates your best time for the day and mints a relic.
- **Loot:** walk onto someone else's grave that holds a relic while your run is open. The client sends `lootGrave(graveId)` without asking the verifier. The contract enforces the rules itself:
  - it can't be your own grave
  - each grave can be looted only once
  - you need an open run on that day

## Ordering

A smart account's operations are ordered by its EntryPoint nonce, so `ChainLayer` sends writes one at a time through a queue. `RunController` also holds the next run's `startRun` until the previous `recordDeath` lands. Starting a run abandons any open one, so a death that landed late would be rejected.

## Latency

About 6.5 s goes to the SDK's sequential calls to SmoothSend's gateway (account defaults, entry points, gas estimate, paymaster signature). The bundler then gets the operation onto Fuji in about 2 s. The game never waits: deaths and loots resolve while you're on the death screen or still playing.
