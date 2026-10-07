import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { config } from 'dotenv';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createPublicClient, http, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalanche, avalancheFuji } from 'viem/chains';
import { SIM_FINGERPRINT } from '@ossuary/sim';
import { VerifyError, verifyDeath, verifyFinish, type VerifyDeps } from './verify';

// Replay-and-sign service. Env (falls back to the contracts package locally):
//   VERIFIER_PRIVATE_KEY  key whose address OssuaryGame trusts
//   GAME_ADDRESS          OssuaryGame on Fuji
//   NETWORK               'fuji' (default) or 'mainnet'
//   RPC_URL               optional RPC override (FUJI_RPC_URL also read)
//   ALLOWED_ORIGINS       comma list, default http://localhost:3000
//   PORT                  default 8787

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
config();
config({ path: here('../../../packages/contracts/.env') });

const key = process.env.VERIFIER_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error('VERIFIER_PRIVATE_KEY is not set');
const network = process.env.NETWORK === 'mainnet' ? 'avalanche' : 'fuji';
const chain = network === 'avalanche' ? avalanche : avalancheFuji;
const deployments = here(`../../../packages/contracts/deployments/${network}.json`);
const deployed = existsSync(deployments) ? JSON.parse(readFileSync(deployments, 'utf8')) : {};
const game = (process.env.GAME_ADDRESS ?? deployed.game) as Address | undefined;
const relics = (process.env.RELICS_ADDRESS ?? deployed.relics) as Address | undefined;
if (!game || !relics) throw new Error(`GAME_ADDRESS / RELICS_ADDRESS not set and no deployments/${network}.json found`);

const client = createPublicClient({
  chain,
  transport: http(process.env.RPC_URL ?? (network === 'fuji' ? process.env.FUJI_RPC_URL : undefined)),
});
const runsAbi = parseAbi(['function runs(uint256) view returns (address player, uint32 day, uint64 startedAt, bool open)']);
const relicsAbi = parseAbi(['function balanceOf(address account, uint256 id) view returns (uint256)']);

const deps: VerifyDeps = {
  signer: privateKeyToAccount(key),
  chainId: chain.id,
  game,
  async readRun(runId) {
    const [player, day, , open] = await client.readContract({ address: game, abi: runsAbi, functionName: 'runs', args: [runId] });
    return { player, day: Number(day), open };
  },
  readRelicBalance(player, relicId) {
    return client.readContract({ address: relics, abi: relicsAbi, functionName: 'balanceOf', args: [player, BigInt(relicId)] });
  },
};

const app = new Hono();
const origins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim());
app.use('*', cors({ origin: origins, allowMethods: ['GET', 'POST'] }));

app.get('/', (c) => c.json({ ok: true, network, verifier: deps.signer.address, game, sim: SIM_FINGERPRINT }));

const handle = (fn: typeof verifyDeath | typeof verifyFinish) => async (c: any) => {
  const started = Date.now();
  try {
    const body = await c.req.json();
    const out = await fn(deps, body);
    console.log(`${c.req.path} run ${out.runId} ok in ${Date.now() - started} ms (${out.ticks} ticks)`);
    return c.json(out);
  } catch (e) {
    const status = e instanceof VerifyError ? e.status : 500;
    const message = e instanceof Error ? e.message : String(e);
    console.log(`${c.req.path} rejected: ${message}`);
    return c.json({ error: message }, status);
  }
};

app.post('/verify/death', handle(verifyDeath));
app.post('/verify/finish', handle(verifyFinish));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`verifier ${deps.signer.address} for game ${game} on :${port}, rules ${SIM_FINGERPRINT}`);
});
