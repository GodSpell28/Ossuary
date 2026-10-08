# Deploying Ossuary

Three pieces go online: the contracts (already on Fuji), the verifier (any Docker host), and the client (Vercel). The steps below need your own accounts and are written to be followed in order.

## 1. Verifier on Railway (or any Docker host)

The verifier holds the key that signs deaths and finishes. It must stay private and always be reachable.

1. Push the repo to GitHub (see the bottom of this page).
2. On [railway.com](https://railway.com): **New Project → Deploy from GitHub repo → GodSpell28/Ossuary**. Railway reads `railway.json` and builds `Dockerfile.verifier`.
3. In the service's **Variables**, add:

| Variable | Value |
| --- | --- |
| `VERIFIER_PRIVATE_KEY` | The `VERIFIER_PRIVATE_KEY` line from `packages/contracts/.env` |
| `ALLOWED_ORIGINS` | Your Vercel URL from step 2, e.g. `https://ossuary.vercel.app` (comma-separate several) |
| `NETWORK` | `fuji` (or `mainnet` after the mainnet deploy) |

4. **Settings → Networking → Generate Domain.** Open `https://<domain>/`; it should return `{"ok":true,"verifier":"0x9dCE…2297",…}`.

Fly.io works the same way: `fly launch --dockerfile Dockerfile.verifier`, then `fly secrets set VERIFIER_PRIVATE_KEY=… ALLOWED_ORIGINS=…`.

## 2. Client on Vercel

1. On [vercel.com](https://vercel.com): **Add New → Project → import GodSpell28/Ossuary**.
2. Set **Root Directory** to `apps/client`. Vercel detects Next.js and the pnpm workspace on its own.
3. Add these **Environment Variables**:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | `cmuyadg0c01jk0ci6c4nbtr85` |
| `NEXT_PUBLIC_SMOOTHSEND_KEY` | Your `pk_nogas_…` key, the publishable one |
| `NEXT_PUBLIC_GAME_ADDRESS` | `0x2e8c113ff52cc3bbb9748f64c589cf1a0a55b65f` |
| `NEXT_PUBLIC_RELICS_ADDRESS` | `0x61393d01bc79756ff3dcc63c380e717d6acc1e9d` |
| `NEXT_PUBLIC_DEPLOY_BLOCK` | `59144966` |
| `NEXT_PUBLIC_VERIFIER_URL` | The Railway domain from step 1, `https://…` |
| `NEXT_PUBLIC_NETWORK` | `fuji` |

4. Deploy, then set `ALLOWED_ORIGINS` on the verifier to the final Vercel URL.

## 3. Allow the new domain

- **Privy dashboard → your app → Configuration → Allowed origins:** add the Vercel URL.
- **SmoothSend dashboard → your project:** add the Vercel URL to the allowed origins (CORS) for the `pk_nogas_` key.

Then open the Vercel URL in a private window on another machine and play a run to the end. That is the plan's "works on a clean machine" check.

## 4. Mainnet (bonus points)

**Contracts deployed on 2026-10-08:**
- OssuaryGame `0xbb760a0bbcf4f2c68894ec96c667547a84818b12`
- Relics `0x6c56140d5a99d20a4b42953f48f2114f52ed25e2`
- deploy block 97047457; addresses recorded in `packages/contracts/deployments/avalanche.json`

Steps 1–4 below are done. What's left to make mainnet *playable* is the SmoothSend credit (step 3) and step 5.

1. **Rotate the SmoothSend secret key** in the dashboard first; the old one was pasted in chat.
2. Fund the mainnet deployer `0x5482EeC17e9514cBb4D3B0E6A45577ff2636Ff46` with about 0.1 AVAX on C-Chain. The deploy costs a few cents; keep the rest small. Its key is `MAINNET_DEPLOYER_PRIVATE_KEY` in `packages/contracts/.env`.
3. Add about $5 of SmoothSend credit for mainnet sponsorship.
4. Deploy and verify:
   ```bash
   pnpm --filter @ossuary/contracts deploy:mainnet
   pnpm --filter @ossuary/contracts exec hardhat verify sourcify --network avalanche <RELICS> "https://ossuary.example/relics/{id}.json"
   pnpm --filter @ossuary/contracts exec hardhat verify sourcify --network avalanche <GAME> <RELICS> 0x9dCE67a5D2b8b7B219a4b7F6c74aBf846D172297
   ```
5. The deploy prints the `NEXT_PUBLIC_*` values. Put them in a second Vercel project, or a second environment, with `NEXT_PUBLIC_NETWORK=mainnet`. Run a second verifier with `NETWORK=mainnet`.

The per-player cooldown in `startRun` (10 s) limits how fast anyone can spend your sponsorship credit.

## Pushing to GitHub

`origin` is already set to `https://github.com/GodSpell28/Ossuary.git`. The credentials cached on this PC belong to `vibhav-14`, which GitHub refused. Either sign in as GodSpell28 when Git prompts, or add vibhav-14 as a collaborator on the repo, then:

```bash
git push -u origin main
```
