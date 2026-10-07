import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { config } from 'dotenv';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createPublicClient, http, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import { VerifyError, verifyDeath, verifyFinish, type VerifyDeps } from './verify';

// Replay-and-sign service. Env (falls back to the contracts package locally):
//   VERIFIER_PRIVATE_KEY  key whose address OssuaryGame trusts
//   GAME_ADDRESS          OssuaryGame on Fuji
//   FUJI_RPC_URL          optional RPC override
//   ALLOWED_ORIGINS       comma list, default http://localhost:3000
//   PORT                  default 8787

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
config();
config({ path: here('../../../packages/contracts/.env') });

const key = process.env.VERIFIER_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error('VERIFIER_PRIVATE_KEY is not set');
const deployments = here('../../../packages/contracts/deployments/fuji.json');
const game = (process.env.GAME_ADDRESS ??
  (existsSync(deployments) ? JSON.parse(readFileSync(deployments, 'utf8')).game : undefined)) as Address | undefined;
if (!game) throw new Error('GAME_ADDRESS is not set and no deployments/fuji.json found');

const client = createPublicClient({ chain: avalancheFuji, transport: http(process.env.FUJI_RPC_URL) });
const runsAbi = parseAbi(['function runs(uint256) view returns (address player, uint32 day, uint64 startedAt, bool open)']);

const deps: VerifyDeps = {
  signer: privateKeyToAccount(key),
  chainId: avalancheFuji.id,
  game,
  async readRun(runId) {
    const [player, day, , open] = await client.readContract({ address: game, abi: runsAbi, functionName: 'runs', args: [runId] });
    return { player, day: Number(day), open };
  },
};

const app = new Hono();
const origins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim());
app.use('*', cors({ origin: origins, allowMethods: ['GET', 'POST'] }));

app.get('/', (c) => c.json({ ok: true, verifier: deps.signer.address, game }));

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
  console.log(`verifier ${deps.signer.address} for game ${game} on :${port}`);
});
